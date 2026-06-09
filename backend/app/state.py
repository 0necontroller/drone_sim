"""Shared drone state + flight state + connection singletons for the backend."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set


# ─────────────────────────────────────────────────────────────────────────────
# Per-frame sensor data + async locks
# ─────────────────────────────────────────────────────────────────────────────

class DroneState:
    def __init__(self) -> None:
        self.telemetry: Dict[str, Any] = {}
        self.telemetry_ts: float = 0.0
        self.command: Dict[str, Any] = {
            "roll": 0.0, "pitch": 0.0, "yaw": 0.0, "altitude_delta": 0.0,
        }
        self.command_ts: float = 0.0
        self.camera_frame: Optional[bytes] = None
        self.camera_ts: float = 0.0
        self.pointcloud_points: list = []
        self.pointcloud_ts: float = 0.0
        self.supervisor_state: dict = {}

        self.lock            = asyncio.Lock()
        self.camera_lock     = asyncio.Lock()
        self.pointcloud_lock = asyncio.Lock()

        # Fired whenever a fresh camera frame is stored.
        # The WebRTC CameraTrack awaits this event instead of sleeping blindly.
        self.new_frame_event = asyncio.Event()


# ─────────────────────────────────────────────────────────────────────────────
# Autonomous / mission flight state
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FlightState:
    """Mutable navigation state shared across routers.

    Always mutate *attributes* in-place (``flight.autonomous_mode = True``).
    Never rebind the ``flight`` module-level name itself.
    """
    detected_people:     list  = field(default_factory=list)
    active_flight_path:  list  = field(default_factory=list)
    active_waypoints_3d: list  = field(default_factory=list)
    current_waypoint_idx: int  = 0
    autonomous_mode:     bool  = False
    returning_home:      bool  = False
    home_x:              float = 0.0
    home_y:              float = 0.0
    home_set:            bool  = False
    current_mission_id:  Optional[int] = None


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket connection holders
# ─────────────────────────────────────────────────────────────────────────────

class _Connections:
    """Holds WebSocket singletons that are reassigned at runtime.

    Stored as object attributes so cross-module mutation works without
    ``global`` declarations.
    """
    controller_ws: Any = None


# ─────────────────────────────────────────────────────────────────────────────
# Module-level singletons — import these directly; never rebind the names
# ─────────────────────────────────────────────────────────────────────────────

state       = DroneState()
flight      = FlightState()
connections = _Connections()

dashboard_clients: Set = set()
controller_lock        = asyncio.Lock()
rtc_peers: Set         = set()
