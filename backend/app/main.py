from __future__ import annotations

import asyncio
import base64
import fractions
import io
import json
import os
import time

from dotenv import load_dotenv
from typing import Any, Dict, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

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
        self.lock = asyncio.Lock()
        self.camera_lock = asyncio.Lock()


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
                async with state.camera_lock:
                    state.camera_frame = frame
                    state.camera_ts = payload.get("timestamp", time.time())
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
