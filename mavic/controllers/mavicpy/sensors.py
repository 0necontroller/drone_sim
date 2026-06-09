"""Sensor-data capture helpers — accept device objects, return plain Python data."""
from __future__ import annotations

import base64
import io
from typing import Optional

import numpy as np

try:
    from PIL import Image
    _PIL = True
except ImportError:
    _PIL = False


def capture_camera_jpeg(camera, quality: int = 65) -> Optional[str]:
    """Encode the current camera frame as a base64 JPEG string, or None on failure."""
    if not _PIL:
        return None
    try:
        w, h = camera.getWidth(), camera.getHeight()
        raw  = camera.getImage()
        img  = Image.frombuffer("RGBA", (w, h), raw, "raw", "BGRA", 0, 1).convert("RGB")
        buf  = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as exc:
        print(f"[Sensors] Camera capture failed: {exc}")
        return None


def get_lidar_points_with_pose(lidar, gps, imu) -> Optional[dict]:
    """Return drone-local LiDAR points plus the 6-DOF GPS+IMU pose snapshot.

    Returns ``{'points': [[x,y,z], ...], 'pose': {x,y,z,roll,pitch,yaw}}``
    or ``None`` if the LiDAR returned no valid points.
    """
    try:
        raw = lidar.getPointCloud()
        if not raw:
            return None
        points = [
            [round(float(p.x), 3), round(float(p.y), 3), round(float(p.z), 3)]
            for p in raw
            if np.isfinite(p.x) and np.isfinite(p.y) and np.isfinite(p.z)
        ]
        if not points:
            return None
        gx, gy, gz     = gps.getValues()
        ro, pi_, ya    = imu.getRollPitchYaw()
        return {
            "points": points,
            "pose": {
                "x":     round(float(gx),  4),
                "y":     round(float(gy),  4),
                "z":     round(float(gz),  4),
                "roll":  round(float(ro),  5),
                "pitch": round(float(pi_), 5),
                "yaw":   round(float(ya),  5),
            },
        }
    except Exception as exc:
        print(f"[Sensors] LiDAR capture failed: {exc}")
        return None


def extract_slam_slice(lidar, lidar_res: int) -> Optional[list]:
    """Produce a 1-D distance array (mm) at the obstacle-height band for BreezySLAM."""
    try:
        pc = lidar.getPointCloud()
        if not pc:
            return None
        scan_mm = [6000.0] * lidar_res
        for i, pt in enumerate(pc):
            if not (np.isfinite(pt.x) and np.isfinite(pt.y) and np.isfinite(pt.z)):
                continue
            if -5.0 < pt.z < -1.0:          # 1–5 m below drone = tree/structure band
                idx = i % lidar_res
                d   = float(np.sqrt(pt.x ** 2 + pt.y ** 2)) * 1000.0
                if d < scan_mm[idx]:
                    scan_mm[idx] = d
        return scan_mm
    except Exception as exc:
        print(f"[Sensors] SLAM slice failed: {exc}")
        return None


def read_telemetry(gps, imu, gyro, sim_time: float, target_altitude: float) -> dict:
    """Snapshot all flight sensors into a flat dict ready for broadcast."""
    x, y, z            = gps.getValues()
    roll, pitch, yaw   = imu.getRollPitchYaw()
    roll_v, pitch_v, _ = gyro.getValues()
    return {
        "time": sim_time,
        "roll": roll, "pitch": pitch, "yaw": yaw,
        "x": x, "y": y, "z": z,
        "altitude": z,
        "roll_velocity": roll_v, "pitch_velocity": pitch_v,
        "target_altitude": target_altitude,
    }
