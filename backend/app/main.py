from __future__ import annotations

import asyncio
import base64
import fractions
import io
import json
import os
import time
import cv2
import numpy as np
import math

from dotenv import load_dotenv
from typing import Any, Dict, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

# ── SLAM & PATH PLANNING ──────────────────────────────────────────────────────
from bresenham import bresenham
from breezyslam.algorithms import RMHC_SLAM
from breezyslam.sensors import Laser
from shapely.geometry import Polygon, LineString, Point


try:
    from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate
    from aiortc import RTCConfiguration, RTCIceServer
    from aiortc.contrib.media import MediaStreamTrack
    from aiortc.sdp import candidate_from_sdp
    import av
    from PIL import Image
    AIORTC_AVAILABLE = True
except Exception:
    AIORTC_AVAILABLE = False

from pathlib import Path
from ultralytics import YOLO

# 1. Dynamically get the absolute folder path of app/main.py
SCRIPT_DIR = Path(__file__).resolve().parent

MODEL_PATH = SCRIPT_DIR / "yolo26n.pt"


# Load YOLO globally once when FastAPI initializes (using Nano for real-time speed)
try:
    yolo_model = YOLO(str(MODEL_PATH))
except Exception as e:
    print(f"Warning: Could not load YOLO model: {e}")
    yolo_model = None


# ── SLAM State and Engine ─────────────────────────────────────────────────────
SLAM_MAP_PIXELS = 800        # 800×800 grid
SLAM_MAP_METERS = 40.0       # covers a 40m × 40m area
SLAM_RESOLUTION  = SLAM_MAP_METERS / SLAM_MAP_PIXELS  # 0.05 m/pixel

# Sensor profile — must match your Webots LiDAR horizontal resolution
LIDAR_SCAN_SIZE = 360        # set to lidar.getHorizontalResolution() in Webots

slam_sensor = Laser(
    scan_size=LIDAR_SCAN_SIZE,
    scan_rate_hz=10,
    detection_angle_degrees=360,
    distance_no_detection_mm=6000,
)
slam_engine = RMHC_SLAM(slam_sensor, SLAM_MAP_PIXELS, SLAM_MAP_METERS)
slam_map_bytes = bytearray(SLAM_MAP_PIXELS * SLAM_MAP_PIXELS)
slam_lock = asyncio.Lock()

# Shared state for detections and flight plan
detected_people: list[dict] = []          # [{x, y, ts}, ...]
active_flight_path: list[list[float]] = []  # [[x,y], [x,y], ...]
active_waypoints_3d: list[list[float]] = [] # [[x,y,z], ...]
current_waypoint_idx: int = 0
autonomous_mode: bool = False
returning_home: bool = False
home_x: float = 0.0
home_y: float = 0.0
home_set: bool = False
# ──────────────────────────────────────────────────────────────────────────────


load_dotenv()

app = FastAPI(title="Drone Control API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DroneState:
    def __init__(self) -> None:
        self.telemetry: Dict[str, Any] = {}
        self.telemetry_ts: float = 0.0
        self.command: Dict[str, Any] = {
            "roll": 0.0,
            "pitch": 0.0,
            "yaw": 0.0,
            "altitude_delta": 0.0,
        }
        self.command_ts: float = 0.0
        self.camera_frame: Optional[bytes] = None
        self.camera_ts: float = 0.0
        self.pointcloud_points: list = []
        self.pointcloud_ts: float = 0.0
        self.lock = asyncio.Lock()
        self.camera_lock = asyncio.Lock()
        self.pointcloud_lock = asyncio.Lock()


state = DroneState()

dashboard_clients: Set[WebSocket] = set()
controller_ws: Optional[WebSocket] = None
controller_lock = asyncio.Lock()

rtc_peers: Set[RTCPeerConnection] = set()


async def broadcast_dashboard(payload: Dict[str, Any]) -> None:
    dead_clients = []
    for ws in dashboard_clients:
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            dead_clients.append(ws)
    for ws in dead_clients:
        dashboard_clients.discard(ws)


@app.get("/api/v1/drone/telemetry")
async def get_telemetry() -> JSONResponse:
    async with state.lock:
        payload = {
            "telemetry": state.telemetry,
            "telemetry_ts": state.telemetry_ts,
        }
    return JSONResponse(payload)


@app.get("/api/v1/drone/camera.mjpeg")
async def camera_mjpeg() -> StreamingResponse:
    async def frame_generator():
        boundary = b"--frame"
        while True:
            async with state.camera_lock:
                frame = state.camera_frame
            if frame:
                headers = (
                    boundary
                    + b"\r\nContent-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii")
                )
                yield headers + frame + b"\r\n"
            await asyncio.sleep(0.1)

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/api/v1/drone/pointcloud")
async def pointcloud_data() -> JSONResponse:
    async with state.pointcloud_lock:
        points = state.pointcloud_points
        ts = state.pointcloud_ts
    return JSONResponse({"points": points, "timestamp": ts})


@app.post("/api/v1/drone/plan_flight")
async def plan_flight(body: dict) -> JSONResponse:
    """
    Body: {
      "polygon": [[x, y], ...],      # in Webots meters
      "altitude": 6.0,
      "strip_width": 5.0,             # metres between lawnmower passes
      "coordinate_type": "meters"     # "meters" | "gps"
    }
    Returns: { "waypoints": [[x,y,z], ...] }
    """
    raw_poly = body.get("polygon", [])
    altitude  = float(body.get("altitude", 6.0))
    strip_w   = float(body.get("strip_width", 5.0))

    if len(raw_poly) < 3:
        return JSONResponse({"error": "polygon must have >= 3 points"}, status_code=400)

    try:
        poly = Polygon(raw_poly)
        if not poly.is_valid:
            poly = poly.buffer(0)
            if not poly.is_valid:
                return JSONResponse({"error": "invalid polygon geometry"}, status_code=400)

        minx, miny, maxx, maxy = poly.bounds

        waypoints = []
        going_right = True
        y = miny + strip_w / 2.0

        while y <= maxy:
            line = LineString([(minx, y), (maxx, y)])
            intersection = poly.intersection(line)
            
            if not intersection.is_empty:
                lines = []
                if intersection.geom_type == 'LineString':
                    lines.append(intersection)
                elif intersection.geom_type == 'MultiLineString':
                    lines.extend(intersection.geoms)
                elif intersection.geom_type == 'GeometryCollection':
                    for geom in intersection.geoms:
                        if geom.geom_type == 'LineString':
                            lines.append(geom)

                lines.sort(key=lambda l: l.coords[0][0])
                
                if not going_right:
                    lines = lines[::-1]
                
                for l in lines:
                    coords = list(l.coords)
                    if len(coords) >= 2:
                        p1 = coords[0]
                        p2 = coords[-1]
                        if going_right:
                            waypoints.append([p1[0], p1[1], altitude])
                            waypoints.append([p2[0], p2[1], altitude])
                        else:
                            waypoints.append([p2[0], p2[1], altitude])
                            waypoints.append([p1[0], p1[1], altitude])
                
                going_right = not going_right
            
            y += strip_w

        global active_flight_path, current_waypoint_idx, autonomous_mode, returning_home, active_waypoints_3d
        active_flight_path = [[w[0], w[1]] for w in waypoints]
        active_waypoints_3d = waypoints
        current_waypoint_idx = 0
        autonomous_mode = True
        returning_home = False

        await broadcast_dashboard({
            "type": "flight_plan",
            "waypoints": waypoints,
            "timestamp": time.time(),
        })
        
        # Forward waypoints to the Webots controller
        async with controller_lock:
            if controller_ws is not None:
                await controller_ws.send_text(json.dumps({
                    "type": "waypoints",
                    "waypoints": waypoints
                }))
                
        return JSONResponse({"waypoints": waypoints, "count": len(waypoints)})
    except Exception as e:
        return JSONResponse({"error": f"Failed to plan flight path: {str(e)}"}, status_code=500)


@app.post("/api/v1/drone/stop_autonomous")
async def stop_autonomous() -> JSONResponse:
    global autonomous_mode, returning_home, active_waypoints_3d, active_flight_path
    autonomous_mode = False
    returning_home = True
    active_waypoints_3d = []
    active_flight_path = []
    
    # Clear waypoints on the Webots controller
    async with controller_lock:
        if controller_ws is not None:
            await controller_ws.send_text(json.dumps({
                "type": "waypoints",
                "waypoints": []
            }))
            
    return JSONResponse({"status": "returning_home"})


if AIORTC_AVAILABLE:
    class CameraTrack(MediaStreamTrack):
        kind = "video"

        def __init__(self, fps: int = 30) -> None:
            super().__init__()
            self._fps = fps
            self._time_base = fractions.Fraction(1, fps)
            self._pts = 0

        async def recv(self) -> av.VideoFrame:
            await asyncio.sleep(1 / self._fps)
            async with state.camera_lock:
                frame_bytes = state.camera_frame
            if frame_bytes:
                try:
                    image = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
                except Exception:
                    image = Image.new("RGB", (1280, 720), (0, 0, 0))
            else:
                image = Image.new("RGB", (1280, 720), (0, 0, 0))

            frame = av.VideoFrame.from_image(image)
            frame.pts = self._pts
            frame.time_base = self._time_base
            self._pts += 1
            return frame


@app.websocket("/api/v1/drone/ws")
async def drone_ws(ws: WebSocket) -> None:
    global autonomous_mode
    await ws.accept()
    dashboard_clients.add(ws)
    async with state.lock:
        await ws.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "telemetry": state.telemetry,
                    "telemetry_ts": state.telemetry_ts,
                }
            )
        )
    # Immediately send existing detections to the newly connected client
    await ws.send_text(
        json.dumps(
            {
                "type": "detections",
                "people": detected_people,
                "timestamp": time.time(),
            }
        )
    )
    try:
        while True:
            message = await ws.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if payload.get("type") != "control":
                continue
            command = payload.get("command", payload)
            async with state.lock:
                state.command = {
                    "roll": float(command.get("roll", 0.0)),
                    "pitch": float(command.get("pitch", 0.0)),
                    "yaw": float(command.get("yaw", 0.0)),
                    "altitude_delta": float(command.get("altitude_delta", 0.0)),
                    "target_altitude": command.get("target_altitude"),
                }
                state.command_ts = time.time()
            if not autonomous_mode:
                async with controller_lock:
                    if controller_ws is not None:
                        await controller_ws.send_text(
                            json.dumps(
                                {
                                    "type": "control",
                                    "command": state.command,
                                    "timestamp": state.command_ts,
                                }
                            )
                        )
    except WebSocketDisconnect:
        dashboard_clients.discard(ws)


@app.websocket("/api/v1/drone/controller")
async def drone_controller(ws: WebSocket) -> None:
    global controller_ws, autonomous_mode, active_flight_path, current_waypoint_idx, detected_people, active_waypoints_3d, returning_home, home_x, home_y, home_set
    await ws.accept()
    async with controller_lock:
        controller_ws = ws
        
    # Send existing active waypoints to the newly connected controller so it draws them
    if active_waypoints_3d and autonomous_mode:
        try:
            await ws.send_text(json.dumps({
                "type": "waypoints",
                "waypoints": active_waypoints_3d
            }))
        except Exception as e:
            print(f"Failed to send initial waypoints to controller: {e}")
    try:
        while True:
            message = await ws.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            payload_type = payload.get("type")
            if payload_type == "telemetry":
                async with state.lock:
                    state.telemetry = payload.get("data", {})
                    state.telemetry_ts = payload.get("timestamp", time.time())
                await broadcast_dashboard(
                    {
                        "type": "telemetry",
                        "data": state.telemetry,
                        "timestamp": state.telemetry_ts,
                    }
                )

                # 1. Telemetry coordinates & home initialization
                telem_data = state.telemetry
                drone_x = telem_data.get("x", 0.0)
                drone_y = telem_data.get("y", 0.0)
                drone_z = telem_data.get("z", 0.0)
                drone_yaw = telem_data.get("yaw", 0.0)

                if not home_set and telem_data.get("x") is not None:
                    home_x = drone_x
                    home_y = drone_y
                    home_set = True

                # 2. Autonomous Waypoint & Return Home State Machine
                target_wp = None
                target_alt = 6.0
                should_land = False

                if autonomous_mode and active_flight_path:
                    if current_waypoint_idx < len(active_flight_path):
                        target_wp = active_flight_path[current_waypoint_idx]
                        dist = math.sqrt((target_wp[0]-drone_x)**2 + (target_wp[1]-drone_y)**2)
                        if dist < 1.5:  # Waypoint radius
                            current_waypoint_idx += 1
                            if current_waypoint_idx < len(active_flight_path):
                                target_wp = active_flight_path[current_waypoint_idx]
                            else:
                                target_wp = None
                    
                    if target_wp is None:
                        # Search mission completed -> transition to Return to Launch
                        autonomous_mode = False
                        returning_home = True
                        active_waypoints_3d = []
                        await broadcast_dashboard({"type": "mission_complete", "timestamp": time.time()})
                        
                        # Clear waypoints on the Webots controller
                        async with controller_lock:
                            if controller_ws is not None:
                                await controller_ws.send_text(json.dumps({
                                    "type": "waypoints",
                                    "waypoints": []
                                }))

                if returning_home:
                    target_wp = [home_x, home_y]
                    dist_home = math.sqrt((home_x - drone_x)**2 + (home_y - drone_y)**2)
                    
                    # If we are horizontally close to home spawn point, descend vertically
                    if dist_home < 1.2:
                        should_land = True
                        target_alt = 0.0
                        
                        # Once safely on the ground, terminate navigation loop
                        if drone_z < 0.25:
                            returning_home = False
                            target_wp = None

                # Execute autopilot navigation if active
                if (autonomous_mode or returning_home) and (target_wp is not None or should_land):
                    if target_wp is not None:
                        bearing = math.atan2(target_wp[1]-drone_y, target_wp[0]-drone_x)
                        yaw_err = bearing - drone_yaw
                        while yaw_err >  math.pi: yaw_err -= 2*math.pi
                        while yaw_err < -math.pi: yaw_err += 2*math.pi
                        dist = math.sqrt((target_wp[0]-drone_x)**2 + (target_wp[1]-drone_y)**2)
                    else:
                        yaw_err = 0.0
                        dist = 0.0

                    # Only steer & pitch if we are at safe target altitude, OR if landing
                    if drone_z >= 5.0 or should_land:
                        # Limit yaw rate to 0.4 to prevent gyroscopic instability/tumbling
                        yaw_cmd = float(max(-0.4, min(0.4, yaw_err * 0.5))) if not should_land else 0.0
                        if not should_land and abs(yaw_err) < 0.25:
                            # Use a moderate pitch of -0.5 for stable forward flight
                            pitch_cmd = -0.5 if dist > 2.0 else -0.2
                        else:
                            pitch_cmd = 0.0
                    else:
                        yaw_cmd = 0.0
                        pitch_cmd = 0.0

                    alt_delta = max(-0.5, min(0.5, target_alt - drone_z))

                    auto_command = {
                        "roll": 0.0,
                        "pitch": pitch_cmd,
                        "yaw": yaw_cmd,
                        "altitude_delta": alt_delta,
                        "target_altitude": target_alt,
                    }
                    async with controller_lock:
                        if controller_ws is not None:
                            await controller_ws.send_text(json.dumps({
                                "type": "control",
                                "command": auto_command,
                                "timestamp": time.time(),
                            }))
            elif payload_type == "camera":
                frame_b64 = payload.get("frame")
                if not frame_b64:
                    continue
                try:
                    frame = base64.b64decode(frame_b64)
                except Exception:
                    continue
                
                # --- LIVE INJECT YOLO PROCESSING ---
                is_searching = (
                    autonomous_mode 
                    and active_flight_path 
                    and 0 < current_waypoint_idx < len(active_flight_path)
                )

                if yolo_model is not None and is_searching:
                    try:
                        # 1. Convert JPEG byte string into a NumPy Matrix (OpenCV format)
                        nparr = np.frombuffer(frame, np.uint8)
                        cv_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                        if cv_img is not None:
                            # 2. Run inference (classes=0 filters for pedestrians only)
                            results = yolo_model.predict(source=cv_img, classes=[0,2], conf=0.40, verbose=False)
                            
                            # 3. Draw bounding boxes over the image matrix
                            any_detected = False
                            for result in results:
                                names = result.names
                                for box in result.boxes:
                                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                                    conf = float(box.conf)
                                    cls_id = int(box.cls.item())
                                    label = names[cls_id].capitalize() # e.g., "Person", "Car"
                                    any_detected = True
                                    print(f"[YOLO] Detected {label} (class {cls_id}) with confidence {conf:.2f}")
                                    
                                    # Set box color based on classification (Green for People, Blue for Vehicles)
                                    box_color = (0, 255, 0) if cls_id == 0 else (255, 100, 0)
                                    
                                    # Draw bounding box and the detected type label
                                    cv2.rectangle(cv_img, (x1, y1), (x2, y2), box_color, 2)
                                    cv2.putText(cv_img, f"{label} {conf:.2f}", (x1, y1 - 10),
                                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, box_color, 2)
                            
                            if any_detected:
                                # 4. Re-compress the annotated matrix back into standard JPEG bytes
                                _, encoded_img = cv2.imencode('.jpg', cv_img)
                                frame = encoded_img.tobytes()

                            # After YOLO inference, also project detections to world coordinates
                            geo_detections = []
                            async with state.lock:
                                telem = dict(state.telemetry)

                            drone_xyz = [telem.get("x", 0.0), telem.get("y", 0.0), telem.get("z", 6.0)]
                            drone_rpy = [telem.get("roll", 0.0), telem.get("pitch", 0.0), telem.get("yaw", 0.0)]
                            GIMBAL_PITCH = 0.349   # ~20° down — adjust to match your camera mount
                            HFOV         = 1.047   # ~60° — check your Webots Camera HFOV field

                            h_img, w_img = cv_img.shape[:2]
                            fx = (w_img / 2.0) / np.tan(HFOV / 2.0)
                            fy = fx

                            for result in results:
                                for box in result.boxes:
                                    cls_id = int(box.cls.item())
                                    if cls_id != 0:   # persons only for geo-tagging
                                        continue
                                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                                    u = (x1 + x2) / 2.0
                                    v = (y1 + y2) / 2.0

                                    # Convert camera-space ray to drone-space
                                    # Camera: +X is right, +Y is down, +Z is forward
                                    # Drone: +X is right, +Y is forward, +Z is up
                                    # So: x_d = x_c, y_d = z_c, z_d = -y_c
                                    ray_c = np.array([(u - w_img/2) / fx, (v - h_img/2) / fy, 1.0])
                                    ray_c /= np.linalg.norm(ray_c)
                                    
                                    ray_drone_unpitched = np.array([
                                        ray_c[0],   # x_d = x_c
                                        ray_c[2],   # y_d = z_c
                                        -ray_c[1]   # z_d = -y_c
                                    ])

                                    # Apply gimbal pitch rotation around local drone X-axis (tilting down is rotation by -gp)
                                    gp = GIMBAL_PITCH
                                    R_gimbal = np.array([
                                        [1, 0, 0],
                                        [0, np.cos(gp), np.sin(gp)],
                                        [0, -np.sin(gp), np.cos(gp)]
                                    ])
                                    ray_drone = R_gimbal @ ray_drone_unpitched

                                    # Apply drone roll/pitch/yaw orientation:
                                    # In Webots ENU:
                                    # - Roll (r) is around Y-axis (longitudinal)
                                    # - Pitch (p) is around X-axis (lateral)
                                    # - Yaw (y_ang) is around Z-axis (vertical)
                                    r, p, y_ang = drone_rpy
                                    
                                    # Yaw matrix (around Z)
                                    R_z = np.array([
                                        [np.cos(y_ang), -np.sin(y_ang), 0],
                                        [np.sin(y_ang),  np.cos(y_ang), 0],
                                        [0,              0,             1]
                                    ])
                                    # Pitch matrix (around X)
                                    R_x = np.array([
                                        [1, 0, 0],
                                        [0, np.cos(p), -np.sin(p)],
                                        [0, np.sin(p),  np.cos(p)]
                                    ])
                                    # Roll matrix (around Y)
                                    R_y = np.array([
                                        [np.cos(r), 0, np.sin(r)],
                                        [0,         1, 0        ],
                                        [-np.sin(r), 0, np.cos(r)]
                                    ])
                                    
                                    R_drone = R_z @ R_x @ R_y
                                    ray_world = R_drone @ ray_drone

                                    print(f"[Geo] u={u:.1f}, v={v:.1f}, ray_world[2]={ray_world[2]:.4f}")

                                    if ray_world[2] >= 0:
                                        print(f"[Geo] Warning: ray points skyward (ray_world[2] = {ray_world[2]:.4f}). Ignoring.")
                                        continue

                                    drone_z = drone_xyz[2]
                                    t = -drone_z / ray_world[2]
                                    world_x = drone_xyz[0] + t * ray_world[0]
                                    world_y = drone_xyz[1] + t * ray_world[1]

                                    print(f"[Geo] Projected victim coordinates: x={world_x:.2f}, y={world_y:.2f} (drone_z={drone_z:.2f}, t={t:.2f})")
                                    geo_detections.append({"x": round(float(world_x), 2), "y": round(float(world_y), 2)})

                            # Deduplicate and store using 4.0m Euclidean distance zone check
                            for det in geo_detections:
                                if not any(
                                    math.sqrt((det["x"] - p["x"])**2 + (det["y"] - p["y"])**2) < 4.0
                                    for p in detected_people
                                ):
                                    new_person = {**det, "ts": time.time()}
                                    detected_people.append(new_person)
                                    print(f"[Geo] Logged NEW victim at x={new_person['x']:.2f}, y={new_person['y']:.2f}")
                                else:
                                    print(f"[Geo] Merged redundant detection at x={det['x']:.2f}, y={det['y']:.2f} into existing zone")

                            # Broadcast updated detections
                            if geo_detections:
                                await broadcast_dashboard({
                                    "type": "detections",
                                    "people": detected_people,
                                    "timestamp": time.time(),
                                })
                    except Exception as img_err:
                        # Fallback to saving raw frames if image manipulation fails
                        print(f"YOLO Processing failed, bypassing: {img_err}")
                # -----------------------------------

                async with state.camera_lock:
                    state.camera_frame = frame
                    state.camera_ts = payload.get("timestamp", time.time())
            elif payload_type == "pointcloud":
                points = payload.get("points", [])
                ts = payload.get("timestamp", time.time())
                async with state.pointcloud_lock:
                    state.pointcloud_points = points
                    state.pointcloud_ts = ts
                await broadcast_dashboard(
                    {
                        "type": "pointcloud",
                        "points": points,
                        "timestamp": ts,
                    }
                )
            elif payload_type == "slam_scan":
                scan_data = payload.get("scan", [])
                drone_rpy = payload.get("drone_rpy", [0.0, 0.0, 0.0])
                if scan_data and len(scan_data) == LIDAR_SCAN_SIZE:
                    async with state.lock:
                        telem = dict(state.telemetry)
                    async with slam_lock:
                        gps_x_mm = telem.get("x", 0.0) * 1000.0
                        gps_y_mm = telem.get("y", 0.0) * 1000.0
                        gps_yaw_deg = telem.get("yaw", 0.0) * (180.0 / 3.14159)
                        
                        slam_engine.update(scan_data, pose=(gps_x_mm, gps_y_mm, gps_yaw_deg), should_update_map=True)
                        slam_engine.getmap(slam_map_bytes)
                        x_mm, y_mm, theta_deg = slam_engine.getpos()

                    np_map = np.frombuffer(slam_map_bytes, dtype=np.uint8).reshape(
                        (SLAM_MAP_PIXELS, SLAM_MAP_PIXELS)
                    )
                    _, png_buf = cv2.imencode(".png", np_map)
                    map_b64 = base64.b64encode(png_buf).decode("ascii")

                    await broadcast_dashboard({
                        "type": "slam_update",
                        "map_b64": map_b64,
                        "map_pixels": SLAM_MAP_PIXELS,
                        "map_meters": SLAM_MAP_METERS,
                        "slam_x_mm": x_mm,
                        "slam_y_mm": y_mm,
                        "slam_theta_deg": theta_deg,
                        "timestamp": payload.get("timestamp", time.time()),
                    })
    except WebSocketDisconnect:
        async with controller_lock:
            if controller_ws is ws:
                controller_ws = None


def _load_ice_servers():
    value = os.getenv("RTC_ICE_SERVERS", "")
    if not value:
        return []
    try:
        raw_servers = json.loads(value)
    except json.JSONDecodeError:
        return []
    servers = []
    for entry in raw_servers:
        urls = entry.get("urls") if isinstance(entry, dict) else None
        if not urls:
            continue
        servers.append(
            RTCIceServer(
                urls=urls,
                username=entry.get("username"),
                credential=entry.get("credential"),
            )
        )
    return servers


@app.websocket("/api/v1/drone/rtc")
async def drone_rtc(ws: WebSocket) -> None:
    await ws.accept()
    if not AIORTC_AVAILABLE:
        await ws.close(code=1011)
        return

    ice_servers = _load_ice_servers()
    pc = RTCPeerConnection(RTCConfiguration(iceServers=ice_servers))
    rtc_peers.add(pc)
    pc.addTrack(CameraTrack(fps=30))

    @pc.on("icecandidate")
    async def on_icecandidate(candidate):
        if not candidate:
            return
        candidate_str = getattr(candidate, "candidate", None)
        if not candidate_str:
            candidate_str = candidate.to_sdp()
        await ws.send_text(
            json.dumps(
                {
                    "type": "ice",
                    "candidate": {
                        "candidate": candidate_str,
                        "sdpMid": candidate.sdpMid,
                        "sdpMLineIndex": candidate.sdpMLineIndex,
                    },
                }
            )
        )

    try:
        while True:
            message = await ws.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue

            if payload.get("type") == "offer":
                description = RTCSessionDescription(
                    sdp=payload.get("sdp"),
                    type=payload.get("sdpType", "offer"),
                )
                await pc.setRemoteDescription(description)
                answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "answer",
                            "sdp": pc.localDescription.sdp,
                            "sdpType": pc.localDescription.type,
                        }
                    )
                )
            elif payload.get("type") == "ice":
                candidate = payload.get("candidate", {})
                candidate_str = candidate.get("candidate")
                if not candidate_str:
                    continue
                ice_candidate = candidate_from_sdp(candidate_str)
                ice_candidate.sdpMid = candidate.get("sdpMid")
                ice_candidate.sdpMLineIndex = candidate.get("sdpMLineIndex")
                await pc.addIceCandidate(ice_candidate)
    except WebSocketDisconnect:
        pass
    finally:
        rtc_peers.discard(pc)
        await pc.close()
