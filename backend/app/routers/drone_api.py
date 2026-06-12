"""REST endpoints for the drone API."""
from __future__ import annotations

import asyncio
import json
import math
import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from shapely.geometry import LineString, Polygon
from sqlalchemy.orm import Session

from app.broadcast import broadcast_dashboard
from app.database import get_db
from app.models import Mission
from app.state import connections, controller_lock, flight, state

router = APIRouter(prefix="/api/v1/drone", tags=["drone"])


# ── Telemetry ─────────────────────────────────────────────────────────────────

@router.get("/telemetry")
async def get_telemetry() -> JSONResponse:
    async with state.lock:
        return JSONResponse(
            {"telemetry": state.telemetry, "telemetry_ts": state.telemetry_ts}
        )


# ── Camera MJPEG ──────────────────────────────────────────────────────────────

@router.get("/camera.mjpeg")
async def camera_mjpeg() -> StreamingResponse:
    async def _gen():
        boundary = b"--frame"
        while True:
            async with state.camera_lock:
                frame = state.camera_frame
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


# ── Point cloud ───────────────────────────────────────────────────────────────

@router.get("/pointcloud")
async def get_pointcloud() -> JSONResponse:
    async with state.pointcloud_lock:
        return JSONResponse(
            {"points": state.pointcloud_points, "timestamp": state.pointcloud_ts}
        )


# ── Supervisor world state ────────────────────────────────────────────────────

@router.get("/world")
async def get_world_state() -> JSONResponse:
    async with state.lock:
        return JSONResponse(state.supervisor_state)


# ── Mission planning ──────────────────────────────────────────────────────────

@router.post("/plan_flight")
async def plan_flight(body: dict, db: Session = Depends(get_db)) -> JSONResponse:
    """Generate a lawnmower flight path and start the autonomous mission.

    Body: ``{"polygon": [[x,y], ...], "altitude": 11.0, "strip_width": 10.0}``
    """
    raw_poly = body.get("polygon", [])
    altitude = float(body.get("altitude", 11.0))
    strip_w  = float(body.get("strip_width", 10.0))

    if len(raw_poly) < 3:
        return JSONResponse({"error": "polygon must have >= 3 points"}, status_code=400)

    try:
        poly = Polygon(raw_poly)
        if not poly.is_valid:
            poly = poly.buffer(0)
        minx, miny, maxx, maxy = poly.bounds

        waypoints: list = []
        going_right = True
        y = miny + strip_w / 2.0

        while y <= maxy:
            inter = poly.intersection(LineString([(minx, y), (maxx, y)]))
            if not inter.is_empty:
                if inter.geom_type == "LineString":
                    lines = [inter]
                elif inter.geom_type in ("MultiLineString", "GeometryCollection"):
                    lines = [g for g in inter.geoms if g.geom_type == "LineString"]
                else:
                    lines = []
                lines.sort(key=lambda l: l.coords[0][0])
                if not going_right:
                    lines = lines[::-1]
                for seg in lines:
                    coords = list(seg.coords)
                    if len(coords) >= 2:
                        p1, p2 = coords[0], coords[-1]
                        if going_right:
                            waypoints += [[p1[0], p1[1], altitude], [p2[0], p2[1], altitude]]
                        else:
                            waypoints += [[p2[0], p2[1], altitude], [p1[0], p1[1], altitude]]
                going_right = not going_right
            y += strip_w

        # End previous mission if it exists
        if flight.current_mission_id:
            old_mission = db.query(Mission).filter(Mission.id == flight.current_mission_id).first()
            if old_mission:
                old_mission.status = "completed"
                old_mission.end_time = time.time()
                db.commit()

        # Create new mission in DB
        new_mission = Mission(
            start_time=time.time(),
            status="active",
            waypoints_json=json.dumps(waypoints)
        )
        db.add(new_mission)
        db.commit()
        db.refresh(new_mission)

        flight.active_flight_path   = [[w[0], w[1]] for w in waypoints]
        flight.active_waypoints_3d  = waypoints
        flight.current_waypoint_idx = 0
        flight.autonomous_mode      = True
        flight.returning_home       = False
        flight.current_mission_id   = new_mission.id

        await broadcast_dashboard(
            {"type": "flight_plan", "waypoints": waypoints, "timestamp": time.time()}
        )
        async with controller_lock:
            if connections.controller_ws is not None:
                await connections.controller_ws.send_text(
                    json.dumps({"type": "waypoints", "waypoints": waypoints})
                )
        return JSONResponse({"waypoints": waypoints, "count": len(waypoints)})

    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/stop_autonomous")
async def stop_autonomous() -> JSONResponse:
    flight.autonomous_mode      = False
    flight.returning_home       = True
    flight.active_waypoints_3d  = []
    flight.active_flight_path   = []

    async with controller_lock:
        if connections.controller_ws is not None:
            await connections.controller_ws.send_text(
                json.dumps({"type": "waypoints", "waypoints": []})
            )
    return JSONResponse({"status": "returning_home"})
