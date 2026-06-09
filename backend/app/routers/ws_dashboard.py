"""Dashboard WebSocket endpoint — relays telemetry to browsers and control commands to the drone."""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.state import connections, controller_lock, dashboard_clients, flight, state

router = APIRouter(prefix="/api/v1/drone", tags=["drone-ws"])


@router.websocket("/ws")
async def drone_ws(ws: WebSocket) -> None:
    await ws.accept()
    dashboard_clients.add(ws)

    # ── Initial state burst ────────────────────────────────────────────────────
    async with state.lock:
        await ws.send_text(json.dumps({
            "type":         "hello",
            "telemetry":    state.telemetry,
            "telemetry_ts": state.telemetry_ts,
        }))
    await ws.send_text(json.dumps({
        "type":      "detections",
        "people":    flight.detected_people,
        "timestamp": time.time(),
    }))

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
                    "roll":            float(command.get("roll",           0.0)),
                    "pitch":           float(command.get("pitch",          0.0)),
                    "yaw":             float(command.get("yaw",            0.0)),
                    "altitude_delta":  float(command.get("altitude_delta", 0.0)),
                    "target_altitude": command.get("target_altitude"),
                }
                state.command_ts = time.time()

            # Forward to Webots only when not in autonomous mode
            if not flight.autonomous_mode:
                async with controller_lock:
                    if connections.controller_ws is not None:
                        await connections.controller_ws.send_text(json.dumps({
                            "type":      "control",
                            "command":   state.command,
                            "timestamp": state.command_ts,
                        }))

    except WebSocketDisconnect:
        dashboard_clients.discard(ws)
