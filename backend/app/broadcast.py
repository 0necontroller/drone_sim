"""Broadcast helper — send a JSON payload to all dashboard WebSocket clients."""
from __future__ import annotations

import json

from app.state import dashboard_clients


async def broadcast_dashboard(payload: dict) -> None:
    dead: list = []
    text = json.dumps(payload)
    for ws in dashboard_clients:
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        dashboard_clients.discard(ws)
