"""WebRTC camera endpoint with asyncio.Event-based frame delivery.

The key optimization over the original implementation:
  - ``CameraTrack.recv()`` waits on ``state.new_frame_event`` instead of
    sleeping a fixed 1/fps interval.
  - When the controller sends a new camera frame, the event fires and the
    WebRTC peer receives it immediately (~0 ms latency beyond network RTT).
  - If no new frame arrives within 3 frame-periods, the last frame is
    re-delivered (fallback) to keep the stream alive.
"""
from __future__ import annotations

import asyncio
import fractions
import io
import json
import os
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.state import rtc_peers, state

router = APIRouter(prefix="/api/v1/drone", tags=["drone-rtc"])

try:
    from aiortc import (
        RTCConfiguration,
        RTCIceServer,
        RTCPeerConnection,
        RTCSessionDescription,
    )
    from aiortc.contrib.media import MediaStreamTrack
    from aiortc.sdp import candidate_from_sdp
    import av
    from PIL import Image

    AIORTC_AVAILABLE = True
except Exception:
    AIORTC_AVAILABLE = False


# ── ICE server loader ─────────────────────────────────────────────────────────

def _load_ice_servers() -> list:
    raw = os.getenv("RTC_ICE_SERVERS", "")
    if not raw:
        return []
    try:
        entries = json.loads(raw)
    except json.JSONDecodeError:
        return []
    out = []
    for e in entries:
        urls = e.get("urls") if isinstance(e, dict) else None
        if urls:
            out.append(RTCIceServer(
                urls=urls,
                username=e.get("username"),
                credential=e.get("credential"),
            ))
    return out


# ── Camera track ──────────────────────────────────────────────────────────────

if AIORTC_AVAILABLE:
    class CameraTrack(MediaStreamTrack):
        """Video track that delivers frames driven by ``state.new_frame_event``.

        Replaces the naïve ``asyncio.sleep(1/fps)`` approach: the track only
        wakes up when a real new frame is stored, so the client sees every
        camera update as soon as it arrives.
        """
        kind = "video"

        def __init__(self, fps: int = 30) -> None:
            super().__init__()
            self._fps           = fps
            self._time_base     = fractions.Fraction(1, fps)
            self._pts           = 0
            # Allow up to 3 frame-intervals before re-delivering the last frame
            self._frame_timeout = (1.0 / fps) * 3

        async def recv(self) -> "av.VideoFrame":
            # Block until a new frame is signalled, or timeout and re-use last
            try:
                await asyncio.wait_for(
                    state.new_frame_event.wait(),
                    timeout=self._frame_timeout,
                )
                state.new_frame_event.clear()
            except asyncio.TimeoutError:
                pass

            async with state.camera_lock:
                frame_bytes: Optional[bytes] = state.camera_frame

            if frame_bytes:
                try:
                    img = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
                except Exception:
                    img = Image.new("RGB", (1280, 720))
            else:
                img = Image.new("RGB", (1280, 720))

            av_frame           = av.VideoFrame.from_image(img)
            av_frame.pts       = self._pts
            av_frame.time_base = self._time_base
            self._pts         += 1
            return av_frame


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/rtc")
async def drone_rtc(ws: WebSocket) -> None:
    await ws.accept()
    if not AIORTC_AVAILABLE:
        await ws.close(code=1011)
        return

    pc = RTCPeerConnection(RTCConfiguration(iceServers=_load_ice_servers()))
    rtc_peers.add(pc)
    pc.addTrack(CameraTrack(fps=30))

    @pc.on("icecandidate")
    async def on_icecandidate(candidate):
        if not candidate:
            return
        candidate_str = getattr(candidate, "candidate", None) or candidate.to_sdp()
        await ws.send_text(json.dumps({
            "type": "ice",
            "candidate": {
                "candidate":     candidate_str,
                "sdpMid":        candidate.sdpMid,
                "sdpMLineIndex": candidate.sdpMLineIndex,
            },
        }))

    try:
        while True:
            message = await ws.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue

            if payload.get("type") == "offer":
                desc = RTCSessionDescription(
                    sdp=payload.get("sdp"),
                    type=payload.get("sdpType", "offer"),
                )
                await pc.setRemoteDescription(desc)
                answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await ws.send_text(json.dumps({
                    "type":    "answer",
                    "sdp":     pc.localDescription.sdp,
                    "sdpType": pc.localDescription.type,
                }))

            elif payload.get("type") == "ice":
                cand = payload.get("candidate", {})
                cand_str = cand.get("candidate")
                if not cand_str:
                    continue
                ice = candidate_from_sdp(cand_str)
                ice.sdpMid        = cand.get("sdpMid")
                ice.sdpMLineIndex = cand.get("sdpMLineIndex")
                await pc.addIceCandidate(ice)

    except WebSocketDisconnect:
        pass
    finally:
        rtc_peers.discard(pc)
        await pc.close()
