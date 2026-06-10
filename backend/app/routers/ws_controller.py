"""Controller WebSocket endpoint — the main Webots-to-backend data pipeline.

Receives five message types from the Webots controller:
  - ``telemetry``       → store + broadcast + run autonomous nav state machine
  - ``camera``          → run YOLO, annotate, geo-tag, store, signal WebRTC event
  - ``pointcloud``      → broadcast with drone pose for world-space projection
  - ``supervisor_state``→ store + broadcast
  - ``slam_scan``       → update SLAM map + broadcast PNG
"""
from __future__ import annotations

import asyncio
import base64
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.broadcast import broadcast_dashboard
from app.database import SessionLocal
from app.models import Detection
from app.services.pathfinding import astar_next_waypoint
from app.services.yolo_service import process_frame
from app.slam_engine import (
    LIDAR_SCAN_SIZE,
    SLAM_MAP_METERS,
    SLAM_MAP_PIXELS,
    slam_engine,
    slam_lock,
    slam_map_bytes,
    slam_thread_lock,
)
from app.state import connections, controller_lock, flight, state

router = APIRouter(prefix="/api/v1/drone", tags=["drone-controller"])

DETECTION_IMAGE_DIR = Path(__file__).resolve().parents[2] / "static" / "detections"
DETECTION_IMAGE_URL = "/static/detections"
SUPERVISOR_MATCH_THRESHOLD_M = 8.0


# ─────────────────────────────────────────────────────────────────────────────
# SLAM Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _run_slam_update(scan, pose):
    """Synchronous SLAM update + PNG generation to be run in a thread."""
    with slam_thread_lock:
        slam_engine.update(scan, pose=pose, should_update_map=True)
        slam_engine.getmap(slam_map_bytes)
        x_mm, y_mm, theta_deg = slam_engine.getpos()

        # Generate PNG from the map bytes (single channel 0-255)
        arr = np.frombuffer(slam_map_bytes, dtype=np.uint8).reshape(
            (SLAM_MAP_PIXELS, SLAM_MAP_PIXELS)
        )
        _, enc = cv2.imencode(".png", arr)
        map_b64 = base64.b64encode(enc).decode("ascii")
        return map_b64, x_mm, y_mm, theta_deg


def _existing_detection_by_id(ped_id: str) -> dict | None:
    return next((p for p in flight.detected_people if p.get("id") == ped_id), None)


def _distance_2d(a: dict, b: dict) -> float:
    return math.sqrt((float(a["x"]) - float(b["x"])) ** 2 + (float(a["y"]) - float(b["y"])) ** 2)


def _closest_unstored_pedestrian(point: dict, pedestrians: list[dict]) -> dict | None:
    candidates = [
        ped for ped in pedestrians
        if ped.get("id") and not _existing_detection_by_id(ped["id"])
    ]
    if not candidates:
        return None

    closest = min(candidates, key=lambda ped: _distance_2d(point, ped))
    if _distance_2d(point, closest) > SUPERVISOR_MATCH_THRESHOLD_M:
        return None

    return {
        "id": closest["id"],
        "x": closest["x"],
        "y": closest["y"],
    }


def _save_detection_image(det: dict, frame: bytes | None) -> str | None:
    if not frame:
        return None

    DETECTION_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    ped_id = str(det.get("id", "PED_UNKNOWN"))
    safe_id = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in ped_id)
    filename = f"mission_{flight.current_mission_id or 0}_{safe_id}_{int(time.time() * 1000)}.jpg"
    path = DETECTION_IMAGE_DIR / filename

    try:
        arr = np.frombuffer(frame, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            path.write_bytes(frame)
            return f"{DETECTION_IMAGE_URL}/{filename}"

        label = f"{ped_id}  x={float(det.get('x', 0.0)):.1f}m  y={float(det.get('y', 0.0)):.1f}m"
        cv2.rectangle(img, (0, 0), (min(img.shape[1], 430), 34), (0, 0, 0), -1)
        cv2.putText(
            img, label, (10, 23),
            cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 255, 136), 2,
        )
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return f"{DETECTION_IMAGE_URL}/{filename}"
    except Exception as exc:
        print(f"[Camera] Error saving detection image: {exc}")
        return None


async def _store_supervisor_detections(new_detections: list[dict]) -> list[dict]:
    if not new_detections:
        return []

    async with state.camera_lock:
        frame = state.camera_frame

    stored = []
    for det in new_detections:
        ped_id = det.get("id")
        if not ped_id or _existing_detection_by_id(ped_id):
            continue

        det_data = {
            **det,
            "ts": time.time(),
            "image_url": _save_detection_image(det, frame),
        }
        flight.detected_people.append(det_data)
        stored.append(det_data)
        print(f"[Supervisor] Stored {ped_id} at x={det['x']:.2f}, y={det['y']:.2f}")

    if stored and flight.current_mission_id:
        db = SessionLocal()
        try:
            for det in stored:
                db.add(Detection(
                    mission_id=flight.current_mission_id,
                    timestamp=det["ts"],
                    x=det["x"],
                    y=det["y"],
                    radius=4.0,
                    dispatched=False,
                    status="pending"
                ))
            db.commit()
        except Exception as e:
            print(f"[Supervisor] Error saving detections to DB: {e}")
        finally:
            db.close()

    if stored:
        await broadcast_dashboard({
            "type":      "detections",
            "people":    flight.detected_people,
            "timestamp": time.time(),
        })

    return stored


def _enrich_supervisor_detection(det: dict) -> dict:
    existing = _existing_detection_by_id(det.get("id"))
    if not existing:
        return det
    enriched = {**det}
    for key in ("ts", "image_url", "world_pos"):
        if key in existing and existing[key] is not None:
            enriched[key] = existing[key]
    return enriched


async def _match_yolo_to_supervisor(geo_dets: list[dict], telem: dict) -> list[dict]:
    async with state.lock:
        supervisor_state = dict(state.supervisor_state or {})

    pedestrians = supervisor_state.get("all_pedestrians") or []
    if not pedestrians:
        return []

    matched: dict[str, dict] = {}
    for geo in geo_dets:
        ped = _closest_unstored_pedestrian(geo, pedestrians)
        if ped:
            matched[ped["id"]] = ped

    if matched:
        return list(matched.values())

    drone_point = {"x": telem.get("x", 0.0), "y": telem.get("y", 0.0)}
    ped = _closest_unstored_pedestrian(drone_point, pedestrians)
    return [ped] if ped else []


# ─────────────────────────────────────────────────────────────────────────────
# Main endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.websocket("/controller")
async def drone_controller(ws: WebSocket) -> None:
    await ws.accept()
    async with controller_lock:
        connections.controller_ws = ws

    # Replay active waypoints to newly connected controller
    if flight.active_waypoints_3d and flight.autonomous_mode:
        try:
            await ws.send_text(json.dumps({
                "type":      "waypoints",
                "waypoints": flight.active_waypoints_3d,
            }))
        except Exception as exc:
            print(f"[ControllerWS] Failed to relay waypoints: {exc}")

    try:
        while True:
            message = await ws.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue

            ptype = payload.get("type")
            if ptype == "telemetry":
                await _handle_telemetry(payload, ws)
            elif ptype == "camera":
                await _handle_camera(payload)
            elif ptype == "pointcloud":
                await _handle_pointcloud(payload)
            elif ptype == "supervisor_state":
                await _handle_supervisor_state(payload)
            elif ptype == "slam_scan":
                await _handle_slam_scan(payload)

    except WebSocketDisconnect:
        async with controller_lock:
            if connections.controller_ws is ws:
                connections.controller_ws = None


# ─────────────────────────────────────────────────────────────────────────────
# Telemetry + autonomous navigation
# ─────────────────────────────────────────────────────────────────────────────

async def _handle_telemetry(payload: dict, ws: WebSocket) -> None:
    data = payload.get("data", {})

    async with state.lock:
        state.telemetry    = data
        state.telemetry_ts = payload.get("timestamp", time.time())

    await broadcast_dashboard({
        "type":      "telemetry",
        "data":      data,
        "timestamp": state.telemetry_ts,
    })

    drone_x   = data.get("x",   0.0)
    drone_y   = data.get("y",   0.0)
    drone_z   = data.get("z",   0.0)
    drone_yaw = data.get("yaw", 0.0)

    # Record home position on first telemetry packet
    if not flight.home_set and data.get("x") is not None:
        flight.home_x   = drone_x
        flight.home_y   = drone_y
        flight.home_set = True

    # ── Autonomous nav state machine ──────────────────────────────────────────
    target_wp   = None
    target_alt  = 11.0
    should_land = False

    if flight.autonomous_mode and flight.active_flight_path:
        if flight.current_waypoint_idx < len(flight.active_flight_path):
            target_wp = flight.active_flight_path[flight.current_waypoint_idx]
            dist = math.sqrt((target_wp[0] - drone_x) ** 2 + (target_wp[1] - drone_y) ** 2)
            if dist < 1.5:
                flight.current_waypoint_idx += 1
                if flight.current_waypoint_idx < len(flight.active_flight_path):
                    target_wp = flight.active_flight_path[flight.current_waypoint_idx]
                else:
                    target_wp = None

        if target_wp is None:   # mission complete
            flight.autonomous_mode      = False
            flight.returning_home       = True
            flight.active_waypoints_3d  = []
            await broadcast_dashboard({"type": "mission_complete", "timestamp": time.time()})
            async with controller_lock:
                if connections.controller_ws is not None:
                    await connections.controller_ws.send_text(
                        json.dumps({"type": "waypoints", "waypoints": []})
                    )

    # ── Return-to-home state machine ──────────────────────────────────────────
    if flight.returning_home:
        target_wp  = [flight.home_x, flight.home_y]
        d_home     = math.sqrt((flight.home_x - drone_x) ** 2 + (flight.home_y - drone_y) ** 2)
        if d_home < 1.2:
            should_land = True
            target_alt  = 0.0
            if drone_z < 0.25:
                flight.returning_home = False
                target_wp = None

    # ── Autopilot command ─────────────────────────────────────────────────────
    if (flight.autonomous_mode or flight.returning_home) and (target_wp is not None or should_land):
        if target_wp is not None:
            async with slam_lock:
                current_map = bytearray(slam_map_bytes)
            
            local_wp_x, local_wp_y = await asyncio.to_thread(
                astar_next_waypoint,
                drone_x, drone_y,
                target_wp[0], target_wp[1],
                current_map, SLAM_MAP_PIXELS, SLAM_MAP_METERS
            )

            bearing  = math.atan2(local_wp_y - drone_y, local_wp_x - drone_x)
            yaw_err  = bearing - drone_yaw
            while yaw_err >  math.pi: yaw_err -= 2 * math.pi
            while yaw_err < -math.pi: yaw_err += 2 * math.pi
            dist = math.sqrt((target_wp[0] - drone_x) ** 2 + (target_wp[1] - drone_y) ** 2)
        else:
            yaw_err = dist = 0.0

        if drone_z >= 5.0 or should_land:
            yaw_cmd = float(max(-1.5, min(1.5, yaw_err * 1.5))) if not should_land else 0.0
            if not should_land and abs(yaw_err) < 0.35:
                pitch_cmd = -1.5 if dist > 2.0 else -0.5
            else:
                pitch_cmd = 0.0
        else:
            yaw_cmd = pitch_cmd = 0.0

        alt_delta = max(-0.5, min(0.5, target_alt - drone_z))

        async with controller_lock:
            if connections.controller_ws is not None:
                await connections.controller_ws.send_text(json.dumps({
                    "type": "control",
                    "command": {
                        "roll": 0.0, "pitch": pitch_cmd, "yaw": yaw_cmd,
                        "altitude_delta": alt_delta, "target_altitude": target_alt,
                    },
                    "timestamp": time.time(),
                }))


# ─────────────────────────────────────────────────────────────────────────────
# Camera
# ─────────────────────────────────────────────────────────────────────────────

async def _handle_camera(payload: dict) -> None:
    frame_b64 = payload.get("frame")
    if not frame_b64:
        return
    try:
        frame = base64.b64decode(frame_b64)
    except Exception:
        return

    async with state.lock:
        telem = dict(state.telemetry)

    drone_z = telem.get("z", 0.0)
    is_searching = (
        flight.autonomous_mode
        and flight.active_flight_path
        and flight.current_waypoint_idx < len(flight.active_flight_path)
        and drone_z > 1.0
    )

    # Run YOLO (throttled to 5 fps inside process_frame) in a background thread.
    # YOLO still annotates every inference frame; Supervisor owns persisted IDs.
    frame, geo_dets, person_seen = await asyncio.to_thread(
        process_frame, frame, telem, is_searching
    )

    # Store frame + signal WebRTC track before Supervisor may request a snapshot.
    async with state.camera_lock:
        state.camera_frame = frame
        state.camera_ts    = payload.get("timestamp", time.time())
    state.new_frame_event.set()   # wake CameraTrack.recv()

    if person_seen:
        matched_detections = await _match_yolo_to_supervisor(geo_dets, telem)
        await _store_supervisor_detections(matched_detections)

        # Notify the Webots controller for supervisor cross-validation
        async with controller_lock:
            if connections.controller_ws is not None:
                try:
                    await connections.controller_ws.send_text(
                        json.dumps({"type": "yolo_hit", "timestamp": time.time()})
                    )
                except Exception:
                    pass


# ─────────────────────────────────────────────────────────────────────────────
# Point cloud
# ─────────────────────────────────────────────────────────────────────────────

async def _handle_pointcloud(payload: dict) -> None:
    pts = payload.get("points", [])
    ts  = payload.get("timestamp", time.time())
    async with state.pointcloud_lock:
        state.pointcloud_points = pts
        state.pointcloud_ts     = ts
    await broadcast_dashboard({
        "type":      "pointcloud",
        "points":    pts,
        "pose":      payload.get("pose"),   # 6-DOF pose for world-space projection
        "timestamp": ts,
    })


# ─────────────────────────────────────────────────────────────────────────────
# Supervisor state
# ─────────────────────────────────────────────────────────────────────────────

async def _handle_supervisor_state(payload: dict) -> None:
    await _store_supervisor_detections(payload.get("new_detections", []))
    confirmed_detections = [
        _enrich_supervisor_detection(det)
        for det in payload.get("confirmed_detections", [])
    ]
    new_detections = [
        _enrich_supervisor_detection(det)
        for det in payload.get("new_detections", [])
    ]

    async with state.lock:
        state.supervisor_state = {
            **payload,
            "confirmed_detections": confirmed_detections,
            "new_detections": new_detections,
        }
    await broadcast_dashboard({
        "type":                 "supervisor_state",
        "map":                  payload.get("map"),
        "drone":                payload.get("drone"),
        "confirmed_detections": confirmed_detections,
        "new_detections":       new_detections,
        "all_pedestrians":      payload.get("all_pedestrians", []),
        "timestamp":            payload.get("timestamp"),
    })


# ─────────────────────────────────────────────────────────────────────────────
# SLAM
# ─────────────────────────────────────────────────────────────────────────────

async def _handle_slam_scan(payload: dict) -> None:
    scan = payload.get("scan", [])
    if not scan or len(scan) != LIDAR_SCAN_SIZE:
        return

    async with state.lock:
        telem = dict(state.telemetry)

    # Shift pose to align Webots (-200..200) with SLAM (0..400)
    pose = (
        (telem.get("x",   0.0) + 200.0) * 1000.0,
        (telem.get("y",   0.0) + 200.0) * 1000.0,
        telem.get("yaw", 0.0) * (180.0 / math.pi),
    )

    # Run SLAM + PNG generation in a background thread
    map_b64, x_mm, y_mm, theta_deg = await asyncio.to_thread(_run_slam_update, scan, pose)

    await broadcast_dashboard({
        "type":           "slam_update",
        "map_b64":        map_b64,
        "map_pixels":     SLAM_MAP_PIXELS,
        "map_meters":     SLAM_MAP_METERS,
        "slam_x_mm":      x_mm,
        "slam_y_mm":      y_mm,
        "slam_theta_deg": theta_deg,
        "timestamp":      payload.get("timestamp", time.time()),
    })
