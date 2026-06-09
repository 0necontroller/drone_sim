"""Background WebSocket client thread for the Mavic controller."""
from __future__ import annotations

import asyncio
import json
import queue
import threading
from typing import Callable

WS_URL = "ws://127.0.0.1:8001/api/v1/drone/controller"


class WsClient:
    """Thread-safe WebSocket client that runs in a daemon background thread.

    Messages are queued with a drop-on-full strategy so a slow network
    never blocks the Webots simulation step.
    """

    def __init__(
        self,
        on_control:   Callable[[dict], None],
        on_waypoints: Callable[[list], None],
        on_yolo_hit:  Callable[[], None],
    ) -> None:
        self._on_control   = on_control
        self._on_waypoints = on_waypoints
        self._on_yolo_hit  = on_yolo_hit
        self._outgoing: queue.Queue = queue.Queue(maxsize=3)

    def start(self) -> None:
        threading.Thread(target=self._run, daemon=True).start()

    def queue_send(self, payload: dict) -> None:
        """Enqueue a payload; discard the oldest frame if the queue is full."""
        try:
            self._outgoing.put_nowait(payload)
        except queue.Full:
            try:
                self._outgoing.get_nowait()
                self._outgoing.put_nowait(payload)
            except queue.Empty:
                pass

    # ── internals ─────────────────────────────────────────────────────────────

    def _run(self) -> None:
        asyncio.run(self._loop())

    async def _loop(self) -> None:
        try:
            import websockets
        except ImportError:
            print("[WsClient] 'websockets' not available — remote control disabled")
            return

        while True:
            try:
                async with websockets.connect(
                    WS_URL, ping_interval=20, ping_timeout=20
                ) as ws:
                    sender   = asyncio.create_task(self._sender(ws))
                    receiver = asyncio.create_task(self._receiver(ws))
                    done, pending = await asyncio.wait(
                        [sender, receiver],
                        return_when=asyncio.FIRST_EXCEPTION,
                    )
                    for t in pending:
                        t.cancel()
                    for t in done:
                        t.result()          # re-raise so outer loop reconnects
            except Exception:
                await asyncio.sleep(1.0)   # brief backoff before reconnect

    async def _sender(self, ws) -> None:
        loop = asyncio.get_event_loop()
        while True:
            payload = await loop.run_in_executor(None, self._outgoing.get)
            await ws.send(json.dumps(payload))

    async def _receiver(self, ws) -> None:
        while True:
            msg = await ws.recv()
            try:
                payload = json.loads(msg)
            except json.JSONDecodeError:
                continue
            ptype = payload.get("type")
            if ptype == "control":
                self._on_control(payload.get("command", payload))
            elif ptype == "waypoints":
                self._on_waypoints(payload.get("waypoints", []))
            elif ptype == "yolo_hit":
                self._on_yolo_hit()
