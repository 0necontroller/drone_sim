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

from dotenv import load_dotenv
from typing import Any, Dict, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

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
    global controller_ws
    await ws.accept()
    async with controller_lock:
        controller_ws = ws
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
            elif payload_type == "camera":
                frame_b64 = payload.get("frame")
                if not frame_b64:
                    continue
                try:
                    frame = base64.b64decode(frame_b64)
                except Exception:
                    continue
                
                # --- LIVE INJECT YOLO PROCESSING ---
                if yolo_model is not None:
                    try:
                        # 1. Convert JPEG byte string into a NumPy Matrix (OpenCV format)
                        nparr = np.frombuffer(frame, np.uint8)
                        cv_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                        if cv_img is not None:
                            # 2. Run inference (classes=0 filters for pedestrians only)
                            results = yolo_model.predict(source=cv_img, classes=[0,2], conf=0.40, verbose=False)
                            
                            # 3. Draw bounding boxes over the image matrix
                            for result in results:
                                names = result.names
                                for box in result.boxes:
                                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                                    conf = float(box.conf)
                                    cls_id = int(box.cls.item())
                                    label = names[cls_id].capitalize() # e.g., "Person", "Car", "Truck"
                                    
                                    # Set box color based on classification (Green for People, Blue for Vehicles)
                                    box_color = (0, 255, 0) if cls_id == 0 else (255, 100, 0)
                                    
                                    # Draw bounding box and the detected type label
                                    cv2.rectangle(cv_img, (x1, y1), (x2, y2), box_color, 2)
                                    cv2.putText(cv_img, f"{label} {conf:.2f}", (x1, y1 - 10),
                                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, box_color, 2)
                            
                            # 4. Re-compress the annotated matrix back into standard JPEG bytes
                            _, encoded_img = cv2.imencode('.jpg', cv_img)
                            frame = encoded_img.tobytes()
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
