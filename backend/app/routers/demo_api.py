"""REST and WebSocket endpoints for the Demo Dashboard."""
from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse

from app.state import demo_clients, state

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])

# ── Telemetry WebSocket ───────────────────────────────────────────────────────

@router.websocket("/ws")
async def demo_ws(ws: WebSocket) -> None:
    await ws.accept()
    demo_clients.add(ws)

    # Initial state burst
    await ws.send_text(json.dumps({
        "type": "hello",
        "telemetry": {},
        "telemetry_ts": time.time(),
    }))

    try:
        while True:
            # We don't process commands in the demo, just keep connection alive
            message = await ws.receive_text()
    except WebSocketDisconnect:
        demo_clients.discard(ws)


# ── Camera MJPEG ──────────────────────────────────────────────────────────────

@router.get("/camera.mjpeg")
async def demo_camera_mjpeg() -> StreamingResponse:
    async def _gen():
        boundary = b"--frame"
        while True:
            async with state.demo_camera_lock:
                frame = state.demo_camera_frame
            if frame:
                header = (
                    boundary
                    + b"\r\nContent-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(frame)}\r\n\r\n".encode()
                )
                yield header + frame + b"\r\n"
            await asyncio.sleep(0.05)   # poll at 20 fps max

    return StreamingResponse(
        _gen(), media_type="multipart/x-mixed-replace; boundary=frame"
    )
