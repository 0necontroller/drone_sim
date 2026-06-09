"""Controller WebSocket endpoint — the main Webots-to-backend data pipeline.

Receives five message types from the Webots controller:
  - ``telemetry``       → store + broadcast + run autonomous nav state machine
  - ``camera``          → run YOLO, annotate, geo-tag, store, signal WebRTC event
  - ``pointcloud``      → broadcast with drone pose for world-space projection
  - ``supervisor_state``→ store + broadcast
  - ``slam_scan``       → update SLAM map + broadcast PNG
"""
from __future__ import annotations

import base64
import json
import math
import time

import cv2
import numpy as np

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.broadcast import broadcast_dashboard
from app.services.yolo_service import process_frame
from app.slam_engine import (
    LIDAR_SCAN_SIZE,
    SLAM_MAP_METERS,
    SLAM_MAP_PIXELS,
    slam_engine,
    slam_lock,
    slam_map_bytes,
)
from app.state import connections, controller_lock, flight, state

router = APIRouter(prefix="/api/v1/drone", tags=["drone-controller"])


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
    target_alt  = 6.0
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
            bearing  = math.atan2(target_wp[1] - drone_y, target_wp[0] - drone_x)
            yaw_err  = bearing - drone_yaw
            while yaw_err >  math.pi: yaw_err -= 2 * math.pi
            while yaw_err < -math.pi: yaw_err += 2 * math.pi
            dist = math.sqrt((target_wp[0] - drone_x) ** 2 + (target_wp[1] - drone_y) ** 2)
        else:
            yaw_err = dist = 0.0

        if drone_z >= 5.0 or should_land:
            yaw_cmd = float(max(-0.4, min(0.4, yaw_err * 0.5))) if not should_land else 0.0
            if not should_land and abs(yaw_err) < 0.25:
                pitch_cmd = -0.5 if dist > 2.0 else -0.2
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

    # Run YOLO (throttled to 5 fps inside process_frame)
    frame, geo_dets = await process_frame(frame, telem, is_searching)

    # Deduplicate detections with a 4 m exclusion zone
    for det in geo_dets:
        if not any(
            math.sqrt((det["x"] - p["x"]) ** 2 + (det["y"] - p["y"]) ** 2) < 4.0
            for p in flight.detected_people
        ):
            flight.detected_people.append({**det, "ts": time.time()})
            print(f"[Camera] New detection at x={det['x']:.2f}, y={det['y']:.2f}")

    if geo_dets:
        await broadcast_dashboard({
            "type":      "detections",
            "people":    flight.detected_people,
            "timestamp": time.time(),
        })
        # Notify the Webots controller for supervisor cross-validation
        async with controller_lock:
            if connections.controller_ws is not None:
                try:
                    await connections.controller_ws.send_text(
                        json.dumps({"type": "yolo_hit", "timestamp": time.time()})
                    )
                except Exception:
                    pass

    # Store frame + signal WebRTC track
    async with state.camera_lock:
        state.camera_frame = frame
        state.camera_ts    = payload.get("timestamp", time.time())
    state.new_frame_event.set()   # wake CameraTrack.recv()


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
    async with state.lock:
        state.supervisor_state = payload
    await broadcast_dashboard({
        "type":                 "supervisor_state",
        "map":                  payload.get("map"),
        "drone":                payload.get("drone"),
        "confirmed_detections": payload.get("confirmed_detections", []),
        "new_detections":       payload.get("new_detections", []),
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

    async with slam_lock:
        slam_engine.update(
            scan,
            pose=(
                telem.get("x",   0.0) * 1000.0,
                telem.get("y",   0.0) * 1000.0,
                telem.get("yaw", 0.0) * (180.0 / math.pi),
            ),
            should_update_map=True,
        )
        slam_engine.getmap(slam_map_bytes)
        x_mm, y_mm, theta_deg = slam_engine.getpos()

    np_map  = np.frombuffer(slam_map_bytes, dtype=np.uint8).reshape(
        (SLAM_MAP_PIXELS, SLAM_MAP_PIXELS)
    )
    _, png  = cv2.imencode(".png", np_map)
    map_b64 = base64.b64encode(png).decode("ascii")

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
