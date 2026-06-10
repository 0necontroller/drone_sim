"""Background worker for the real drone footage demo."""
import asyncio
import base64
import math
import time
from pathlib import Path

import cv2

from app.broadcast import broadcast_demo
from app.services.yolo_service import process_frame
from app.state import state

VIDEO_PATH = Path(__file__).resolve().parent.parent / "real_drone.mp4"

async def run_demo_loop():
    """Reads the video, runs YOLO, generates dummy telemetry, and broadcasts."""
    if not VIDEO_PATH.exists():
        print(f"[Demo] Video not found at {VIDEO_PATH}")
        return

    cap = cv2.VideoCapture(str(VIDEO_PATH))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_time = 1.0 / fps

    start_time = time.time()
    
    # Dummy flight trajectory parameters
    center_x, center_y = -50.0, -50.0
    radius = 30.0
    speed = 0.5  # radians per second
    altitude = 11.0

    detected_people = []

    while True:
        loop_start = time.time()
        
        ret, frame = cap.read()
        if not ret:
            # Loop the video
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        # Generate dummy telemetry
        elapsed = time.time() - start_time
        angle = elapsed * speed
        drone_x = center_x + math.cos(angle) * radius
        drone_y = center_y + math.sin(angle) * radius
        drone_yaw = angle + math.pi / 2  # Facing tangent to the circle
        
        telem = {
            "x": drone_x,
            "y": drone_y,
            "z": altitude,
            "roll": 0.0,
            "pitch": -0.2, # slight forward pitch
            "yaw": drone_yaw,
            "time": elapsed
        }

        # Broadcast telemetry
        await broadcast_demo({
            "type": "telemetry",
            "data": telem,
            "timestamp": time.time()
        })

        # Encode frame to bytes for process_frame
        _, enc = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 65])
        frame_bytes = enc.tobytes()

        # Run YOLO in background thread to not block the event loop
        annotated_bytes, geo_dets, _person_seen = await asyncio.to_thread(
            process_frame, frame_bytes, telem, True
        )

        # Deduplicate dummy detections
        new_dets = []
        for det in geo_dets:
            if not any(
                math.sqrt((det["x"] - p["x"]) ** 2 + (det["y"] - p["y"]) ** 2) < 4.0
                for p in detected_people
            ):
                det_data = {**det, "ts": time.time()}
                detected_people.append(det_data)
                new_dets.append(det_data)

        if geo_dets:
            await broadcast_demo({
                "type": "detections",
                "people": detected_people,
                "timestamp": time.time(),
            })

        # Update demo camera state
        async with state.demo_camera_lock:
            state.demo_camera_frame = annotated_bytes
        state.demo_new_frame_event.set()

        # Sleep to maintain FPS
        compute_time = time.time() - loop_start
        sleep_time = max(0, frame_time - compute_time)
        await asyncio.sleep(sleep_time)

def start_demo_worker():
    asyncio.create_task(run_demo_loop())
