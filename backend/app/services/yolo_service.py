"""YOLO inference + geo-tagging service.

Provides ``process_frame()`` — a single async call that:
  1. Decodes the JPEG frame
  2. Runs YOLO (if a mission is active and enough time has passed)
  3. Draws bounding boxes
  4. Back-projects person bounding-box centres to world (x, y) coordinates
  5. Returns (annotated_jpeg_bytes, [geo_detections], person_seen)

YOLO is throttled to at most YOLO_FPS_MAX runs per second to avoid
saturating the CPU when the camera is running at 20 fps.
"""
from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

# ── YOLO model ────────────────────────────────────────────────────────────────
_MODEL_PATH = Path(__file__).resolve().parent.parent / "yolo26n.pt"

try:
    from ultralytics import YOLO as _YOLO
    yolo_model = _YOLO(str(_MODEL_PATH))
    print(f"[YOLO] Model loaded from {_MODEL_PATH}")
except Exception as _e:
    print(f"[YOLO] Warning: could not load model: {_e}")
    yolo_model = None

# ── Throttle ──────────────────────────────────────────────────────────────────
YOLO_FPS_MAX   = 5
_YOLO_INTERVAL = 1.0 / YOLO_FPS_MAX
_last_yolo_run: float = 0.0

# ── Camera/gimbal constants ───────────────────────────────────────────────────
GIMBAL_PITCH = 0.349   # ~20° down
HFOV         = 1.047   # ~60° horizontal FOV


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def process_frame(
    frame: bytes,
    telem: dict,
    is_searching: bool,
) -> tuple[bytes, list, bool]:
    """Run YOLO on *frame* and return ``(annotated_jpeg, geo_detections, person_seen)``.

    If the mission is not active, or the throttle interval has not elapsed,
    the original frame is returned unchanged with an empty detection list.
    """
    global _last_yolo_run

    if not is_searching or yolo_model is None:
        return frame, [], False

    now = time.monotonic()
    if now - _last_yolo_run < _YOLO_INTERVAL:
        return frame, [], False
    _last_yolo_run = now

    try:
        arr = np.frombuffer(frame, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return frame, [], False

        results = yolo_model.predict(source=img, classes=[0, 2], conf=0.40, verbose=False)
        h_img, w_img = img.shape[:2]
        fx = (w_img / 2.0) / math.tan(HFOV / 2.0)

        drone_xyz = [telem.get("x", 0.0), telem.get("y", 0.0), telem.get("z", 6.0)]
        R = _build_rotation(
            telem.get("roll", 0.0),
            telem.get("pitch", 0.0),
            telem.get("yaw", 0.0),
        )

        geo_dets: list[dict] = []
        person_seen = False

        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls.item())
                conf   = float(box.conf)
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                label  = result.names[cls_id].capitalize()
                color  = (0, 255, 0) if cls_id == 0 else (255, 100, 0)

                cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                cv2.putText(
                    img, f"{label} {conf:.2f}", (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2,
                )

                if cls_id == 0:   # persons only for geo-tagging
                    person_seen = True
                    u, v = (x1 + x2) / 2.0, (y1 + y2) / 2.0
                    geo = _project_to_ground(u, v, w_img, h_img, fx, drone_xyz, R)
                    if geo:
                        geo_dets.append(geo)

        _, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 65])
        return enc.tobytes(), geo_dets, person_seen

    except Exception as exc:
        print(f"[YOLO] Processing error: {exc}")
        return frame, [], False


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _build_rotation(roll: float, pitch: float, yaw: float) -> "np.ndarray":
    """Build the drone→world rotation matrix R = Rz(yaw)·Rx(pitch)·Ry(roll)."""
    cr, sr = math.cos(roll),  math.sin(roll)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw),   math.sin(yaw)
    R_z = np.array([[cy, -sy, 0], [sy,  cy, 0], [0, 0, 1]], dtype=float)
    R_x = np.array([[1,   0,  0], [0,  cp, -sp], [0, sp, cp]], dtype=float)
    R_y = np.array([[cr,  0, sr], [0,   1,  0], [-sr, 0, cr]], dtype=float)
    return R_z @ R_x @ R_y


def _project_to_ground(
    u: float, v: float,
    w: float, h: float,
    fx: float,
    drone_xyz: list,
    R: "np.ndarray",
) -> Optional[dict]:
    """Back-project a bounding-box centre to the ground plane.

    Returns ``{'x': float, 'y': float}`` in Webots world coordinates,
    or ``None`` if the ray points skyward.
    """
    gp = GIMBAL_PITCH
    R_gimbal = np.array(
        [[1, 0, 0], [0, math.cos(gp), math.sin(gp)], [0, -math.sin(gp), math.cos(gp)]],
        dtype=float,
    )
    ray_c = np.array([(u - w / 2) / fx, (v - h / 2) / fx, 1.0])
    ray_c /= np.linalg.norm(ray_c)
    # Camera (x_c, y_c, z_c) → drone body (x_d=x_c, y_d=z_c, z_d=-y_c)
    ray_d = R_gimbal @ np.array([ray_c[0], ray_c[2], -ray_c[1]])
    ray_w = R @ ray_d

    if ray_w[2] >= 0:          # ray points upward — skip
        return None

    drone_z = drone_xyz[2]
    t       = -drone_z / ray_w[2]
    return {
        "x": round(float(drone_xyz[0] + t * ray_w[0]), 2),
        "y": round(float(drone_xyz[1] + t * ray_w[1]), 2),
    }
