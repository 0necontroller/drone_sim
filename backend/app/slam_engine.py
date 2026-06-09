"""SLAM engine setup — singleton instances shared across the backend."""
from __future__ import annotations

import asyncio

from breezyslam.algorithms import RMHC_SLAM
from breezyslam.sensors import Laser

SLAM_MAP_PIXELS = 800
SLAM_MAP_METERS = 40.0
SLAM_RESOLUTION = SLAM_MAP_METERS / SLAM_MAP_PIXELS   # 0.05 m/pixel
LIDAR_SCAN_SIZE = 360   # must match Webots lidar.getHorizontalResolution()

_sensor = Laser(
    scan_size=LIDAR_SCAN_SIZE,
    scan_rate_hz=10,
    detection_angle_degrees=360,
    distance_no_detection_mm=6000,
)

slam_engine    = RMHC_SLAM(_sensor, SLAM_MAP_PIXELS, SLAM_MAP_METERS)
slam_map_bytes = bytearray(SLAM_MAP_PIXELS * SLAM_MAP_PIXELS)
slam_lock      = asyncio.Lock()
