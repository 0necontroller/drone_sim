# Comprehensive Technical Documentation: Autonomous Search & Rescue Drone System

## 1. Executive Summary & Simulation Philosophy

### The Webots Advantage
Our project leverages **Webots** as a high-fidelity robotic simulator to bridge the gap between algorithmic theory and physical deployment. Webots provides a deterministic environment where gravity, wind, and material properties are modeled, allowing us to validate our **DJI Mavic 2 Pro** flight controller without risking expensive hardware.

### Objectives & Real-World Translation
Our primary goal is to solve the "Time-to-Rescue" bottleneck in emergency services. By automating the search pattern and person identification, we reduce human operator fatigue. 
- **Translation:** The Python code used in our `mavicpy` controller and FastAPI backend is designed to be **platform-agnostic**. The sensor extraction logic (LiDAR/GPS/IMU) mimics standard ROS (Robot Operating System) topics, meaning this entire stack can be flashed onto a real-world onboard computer (e.g., NVIDIA Jetson) with minimal refactoring of the core logic.

---

## 2. Role Deep-Dives

### I. Computer Vision & Human Detection (The "Eyes")
**Focus:** Real-time object identification, 3D-to-2D geo-tagging, and subject deduplication.

*   **Domain Vocabulary:** 
    *   **Inference:** The process of running live data through a trained neural network.
    *   **Back-Projection:** Calculating a world-coordinate (X, Y) by projecting a camera pixel through a 3D rotation matrix.
    *   **Exclusion Zone:** A spatial buffer used to prevent logging the same physical person multiple times.
    *   **Confidence Threshold:** The minimum probability required for the model to "believe" a detection is a human.
*   **The Problem (The "Turn" Issue):** When a drone turns or circles, the same person appears at different pixel coordinates in every frame. We cannot rely on simple pixel-tracking.
*   **Technical Implementation:** 
    1.  **Detection:** We use **YOLOv8** (specifically `yolo26n.pt`) optimized for CPU inference at 5 FPS.
    2.  **Geo-Tagging:** For every detected person, we take the drone's current `GPS (x, y, z)` and `IMU (roll, pitch, yaw)`. We build a **Rotation Matrix (R)** and project a ray from the camera lens through the bounding box center to find the exact intersection with the ground plane ($Z=0$).
    3.  **Deduplication:** We compare the calculated $(X, Y)$ against a `detected_people` list in our state. If the new coordinate is within **4.0 meters** of an existing entry, it is discarded as a duplicate.
*   **Detailed Code Example:**
    ```python
    # Logic from yolo_service.py: Projecting a pixel to world coordinates
    def _project_to_ground(u, v, drone_xyz, R):
        # build camera ray in local frame
        ray_c = np.array([(u - w/2)/fx, (v - h/2)/fx, 1.0])
        # Transform ray: Camera -> Drone -> World
        ray_w = R @ R_gimbal @ ray_c
        # Intersection with ground (z=0)
        t = -drone_xyz[2] / ray_w[2]
        return {"x": drone_xyz[0] + t*ray_w[0], "y": drone_xyz[1] + t*ray_w[1]}
    ```

### II. Autonomous Flight & Trajectory Planning (The "Brain")
**Focus:** Mission area coverage, high-level pathfinding, and decision making.

*   **Domain Vocabulary:** 
    *   **Lawnmower Pattern:** A systematic "Parallel Sweep" search pattern covering a polygon.
    *   **A* (A-Star):** A heuristic-based search algorithm that finds the shortest obstacle-free path.
    *   **Waypoints:** A series of 3D coordinates $(X, Y, Z)$ the drone must visit.
    *   **Crosstrack Error:** The distance between the drone's actual position and the intended flight line.
*   **Technical Implementation:** 
    1.  **Mission Generation:** We use the `Shapely` library to take a user-defined polygon and intersect it with a horizontal "strip" grid (width = 10m). This generates a sequence of waypoints that ensures 100% visual coverage of the area.
    2.  **Obstacle Avoidance (A*):** Every 100ms, the drone checks the straight-line path to the next waypoint. If our **SLAM Mapping** role reports an obstacle (tree/building), the A* algorithm is triggered. It treats the environment as an **800x800 grid** and finds a "local waypoint" that steers the drone around the object.
    3.  **Flight Dynamics:** The drone maintains a constant **11.0m altitude** to clear the 10m forest canopy while keeping the camera close enough for high-confidence YOLO hits.
*   **Detailed Code Example:**
    ```python
    # Logic from pathfinding.py: A* Grid Search
    while open_set:
        curr = heapq.heappop(open_set)
        if curr == goal: break # Found path
        for neighbor in neighbors(curr):
            if occupancy_grid[neighbor] > 150: continue # Obstacle detected!
            new_g = g_score[curr] + dist(curr, neighbor)
            if new_g < g_score[neighbor]:
                g_score[neighbor] = new_g
                f_score = new_g + heuristic(neighbor, goal)
                heapq.heappush(open_set, (f_score, neighbor))
    ```

### III. SLAM & Geospatial Mapping (The "Memory")
**Focus:** Sensor data ingestion, occupancy grid construction, and localization.

*   **Domain Vocabulary:** 
    *   **SLAM:** Simultaneous Localization and Mapping.
    *   **Occupancy Grid:** A 2D map where each pixel represents the probability of an obstacle (0 = free, 255 = wall).
    *   **LiDAR:** Light Detection and Ranging; sends laser pulses to measure distance.
    *   **BreezySLAM:** A lightweight, high-performance SLAM algorithm for 2D lidar.
*   **Technical Implementation:** 
    1.  **Sensor Fusion:** We ingest 360-degree LiDAR scans at 10Hz. We synchronize these scans with the **IMU's Yaw** to ensure that as the drone rotates, the map remains oriented correctly (North stays North).
    2.  **Mapping:** We use the `RMHC_SLAM` algorithm to update a **400m x 400m global map**. Because our LiDAR is on a drone, we extract a "slice" of data between 1m and 5m below the drone (the height where trees and buildings are most dangerous).
    3.  **Visualization:** The raw byte-array of the SLAM map is converted into a base64-encoded PNG and streamed to the frontend dashboard every second.
*   **Detailed Code Example:**
    ```python
    # Logic from slam_engine.py: Mapping Webots to Grid
    # Shift drone position (-200..200) to grid coordinates (0..400)
    shifted_pose = (
        (telemetry["x"] + 200.0) * 1000.0, # meters to mm
        (telemetry["y"] + 200.0) * 1000.0,
        telemetry["yaw"] * (180.0 / math.pi) # radians to degrees
    )
    # Update SLAM with 360 laser scan
    slam_engine.update(scan, pose=shifted_pose)
    ```

---

## 3. System Integration: How the Roles Connect

The project's success relies on a "Circular Dependency" of data:

1.  **Mapping → Planning:** The **SLAM Occupancy Grid** is the environment the **A* Algorithm** "lives" in. Without the Map, the Flight Planner has no concept of obstacles.
2.  **Planning → Detection:** The **Flight Planner** maintains the steady flight height and velocity. This stability prevents "motion blur" in the camera feed, ensuring the **Detection role** receives high-quality frames for YOLO.
3.  **Detection → Mapping:** When the Detection role identifies a human, it uses the **Mapping role's coordinate system** to tag the location in the global SQLite database.
4.  **All → User:** The **FastAPI Backend** acts as the central hub, multiplexing all three roles' data into a single unified WebSocket stream for the **Frontend Dashboard**.
