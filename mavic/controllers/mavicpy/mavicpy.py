"""mavicpy controller."""

from controller import Supervisor
import base64
import io
import json
import queue
import sys
import threading
import time

try:
    import asyncio
    import websockets
    WEBSOCKETS_AVAILABLE = True
except Exception:
    WEBSOCKETS_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False

try:
    import numpy as np
except ImportError:
    sys.exit("Warning: 'numpy' module not found.")


def clamp(value, value_min, value_max):
    return min(max(value, value_min), value_max)


class Mavic(Supervisor):
    K_VERTICAL_THRUST = 68.5
    K_VERTICAL_OFFSET = 0.6
    K_VERTICAL_P = 3.0
    K_ROLL_P = 50.0
    K_PITCH_P = 30.0
    COMMAND_TIMEOUT = 0.5
    TELEMETRY_PERIOD = 0.1
    CAMERA_PERIOD = 0.2
    POINTCLOUD_PERIOD = 1.0
    SLAM_PERIOD = 0.1
    WS_URL = "ws://127.0.0.1:8001/api/v1/drone/controller"

    def __init__(self):
        super().__init__()

        self.time_step = int(self.getBasicTimeStep())

        # Get and enable devices.
        self.camera = self.getDevice("camera")
        self.camera.enable(self.time_step)
        self.front_left_led = self.getDevice("front left led")
        self.front_right_led = self.getDevice("front right led")
        self.imu = self.getDevice("inertial unit")
        self.imu.enable(self.time_step)
        self.gps = self.getDevice("gps")
        self.gps.enable(self.time_step)
        self.compass = self.getDevice("compass")
        self.compass.enable(self.time_step)
        self.gyro = self.getDevice("gyro")
        self.gyro.enable(self.time_step)
        self.keyboard = self.getKeyboard()
        self.keyboard.enable(self.time_step)
        self.camera_roll_motor = self.getDevice("camera roll")
        self.camera_pitch_motor = self.getDevice("camera pitch")

        self.lidar = None
        try:
            self.lidar = self.getDevice("lidar")
            self.lidar.enable(self.time_step)
            self.lidar.enablePointCloud()
        except Exception:
            self.lidar = None

        self.front_left_motor = self.getDevice("front left propeller")
        self.front_right_motor = self.getDevice("front right propeller")
        self.rear_left_motor = self.getDevice("rear left propeller")
        self.rear_right_motor = self.getDevice("rear right propeller")
        motors = [
            self.front_left_motor,
            self.front_right_motor,
            self.rear_left_motor,
            self.rear_right_motor,
        ]
        for motor in motors:
            motor.setPosition(float("inf"))
            motor.setVelocity(1.0)

        self.target_altitude = 0.0
        self._last_telemetry_time = 0.0
        self._last_camera_time = 0.0
        self._last_pointcloud_time = 0.0
        self._last_slam_time = 0.0
        self._command_ts = 0.0
        self._last_altitude_command_ts = 0.0
        self._command = {
            "roll": 0.0,
            "pitch": 0.0,
            "yaw": 0.0,
            "altitude_delta": 0.0,
            "target_altitude": None,
        }
        self._command_lock = threading.Lock()
        self._outgoing = queue.Queue(maxsize=3)

        self._pending_waypoints = None
        self._waypoints_lock = threading.Lock()
        self._last_drawn_count = 0

        # ── Supervisor: YOLO-hit flag ─────────────────────────────────────────
        self._yolo_fired_this_frame = False
        self._yolo_lock = threading.Lock()

        # ── Supervisor: World & Pedestrian Setup ──────────────────────────────
        self.map_width  = 50.0   # fallback default in metres
        self.map_length = 50.0

        floor_node = self.getFromDef("FLOOR")
        if floor_node:
            size_field = floor_node.getField("size")
            if size_field:
                vec = size_field.getSFVec2f()
                self.map_width  = float(vec[0])
                self.map_length = float(vec[1])
                print(f"[Supervisor] Map: {self.map_width}m × {self.map_length}m")
            else:
                # RectangleArena uses 'floorSize' instead of 'size'
                size_field = floor_node.getField("floorSize")
                if size_field:
                    vec = size_field.getSFVec2f()
                    self.map_width  = float(vec[0])
                    self.map_length = float(vec[1])
                    print(f"[Supervisor] Map (floorSize): {self.map_width}m × {self.map_length}m")
        else:
            print("[Supervisor] WARNING: FLOOR node not found — using default 50×50m")

        # Discover all pedestrian nodes: PED_0, PED_1, … PED_N
        self._ped_nodes: dict = {}
        for i in range(50):
            def_name = f"PED_{i}"
            node = self.getFromDef(def_name)
            if node:
                self._ped_nodes[def_name] = node
            else:
                break   # stop at first gap
        print(f"[Supervisor] Found {len(self._ped_nodes)} pedestrian nodes: {list(self._ped_nodes.keys())}")

        # Detection state
        self._confirmed_detections: dict = {}   # {ped_id: [x, y, z]}
        self._detection_threshold = 8.0         # metres — drone must be within this to validate
        self._last_supervisor_time = 0.0
        self.SUPERVISOR_PERIOD = 0.2            # check every 200 ms
        # ─────────────────────────────────────────────────────────────────────

        if WEBSOCKETS_AVAILABLE:
            self._start_ws_thread()
        else:
            print("WebSocket client not available; remote control disabled.")
        if not PIL_AVAILABLE:
            print("Pillow not available; camera streaming disabled.")

    def _start_ws_thread(self):
        thread = threading.Thread(target=self._run_ws, daemon=True)
        thread.start()

    def _run_ws(self):
        asyncio.run(self._ws_loop())

    async def _ws_loop(self):
        while True:
            try:
                async with websockets.connect(self.WS_URL, ping_interval=20, ping_timeout=20) as ws:
                    sender = asyncio.create_task(self._ws_sender(ws))
                    receiver = asyncio.create_task(self._ws_receiver(ws))
                    done, pending = await asyncio.wait(
                        [sender, receiver], return_when=asyncio.FIRST_EXCEPTION
                    )
                    for task in pending:
                        task.cancel()
                    for task in done:
                        task.result()
            except Exception:
                await asyncio.sleep(1.0)

    async def _ws_sender(self, ws):
        loop = asyncio.get_event_loop()
        while True:
            payload = await loop.run_in_executor(None, self._outgoing.get)
            await ws.send(json.dumps(payload))

    async def _ws_receiver(self, ws):
        while True:
            message = await ws.recv()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            payload_type = payload.get("type")
            if payload_type == "control":
                command = payload.get("command", payload)
                with self._command_lock:
                    self._command = {
                        "roll": float(command.get("roll", 0.0)),
                        "pitch": float(command.get("pitch", 0.0)),
                        "yaw": float(command.get("yaw", 0.0)),
                        "altitude_delta": float(command.get("altitude_delta", 0.0)),
                        "target_altitude": command.get("target_altitude"),
                    }
                    self._command_ts = time.time()
            elif payload_type == "waypoints":
                wps = payload.get("waypoints", [])
                with self._waypoints_lock:
                    self._pending_waypoints = wps
            elif payload_type == "yolo_hit":
                with self._yolo_lock:
                    self._yolo_fired_this_frame = True

    def _queue_send(self, payload):
        try:
            self._outgoing.put_nowait(payload)
        except queue.Full:
            try:
                _ = self._outgoing.get_nowait()
                self._outgoing.put_nowait(payload)
            except queue.Empty:
                pass

    def run(self):
        while self.step(self.time_step) != -1:
            sim_time = self.getTime()

            # Check for new waypoints to visualize
            with self._waypoints_lock:
                if self._pending_waypoints is not None:
                    waypoints_to_draw = self._pending_waypoints
                    self._pending_waypoints = None
                else:
                    waypoints_to_draw = None

            if waypoints_to_draw is not None:
                self.update_waypoints_visualization(waypoints_to_draw)

            roll, pitch, yaw = self.imu.getRollPitchYaw()
            altitude = self.gps.getValues()[2]
            roll_velocity, pitch_velocity, _ = self.gyro.getValues()

            led_state = int(sim_time) % 2
            self.front_left_led.set(led_state)
            self.front_right_led.set(1 - led_state)

            # Stabilize the camera using gyro feedback, and tilt it down by 0.349 rad (~20 deg) to scan the ground.
            # Clamp position commands to [-0.5, 0.5] to respect Webots motor joint limits and avoid warnings.
            camera_roll_pos = clamp(-0.115 * roll_velocity, -0.5, 0.5)
            camera_pitch_pos = clamp(0.349 - 0.1 * pitch_velocity, -0.5, 0.5)
            self.camera_roll_motor.setPosition(camera_roll_pos)
            self.camera_pitch_motor.setPosition(camera_pitch_pos)

            roll_disturbance = 0.0
            pitch_disturbance = 0.0
            yaw_disturbance = 0.0

            remote_active = time.time() - self._command_ts < self.COMMAND_TIMEOUT
            if remote_active:
                with self._command_lock:
                    command = dict(self._command)
                roll_disturbance = command["roll"]
                pitch_disturbance = command["pitch"]
                yaw_disturbance = command["yaw"]

                if command.get("target_altitude") is not None:
                    self.target_altitude = float(command["target_altitude"])
                elif command.get("altitude_delta") and self._command_ts != self._last_altitude_command_ts:
                    self.target_altitude = clamp(
                        self.target_altitude + float(command["altitude_delta"]), 0.5, 50.0
                    )
                    self._last_altitude_command_ts = self._command_ts
            else:
                key = self.keyboard.getKey()
                while key > 0:
                    if key == self.keyboard.UP:
                        pitch_disturbance = -2.0
                    elif key == self.keyboard.DOWN:
                        pitch_disturbance = 2.0
                    elif key == self.keyboard.RIGHT:
                        yaw_disturbance = -1.3
                    elif key == self.keyboard.LEFT:
                        yaw_disturbance = 1.3
                    elif key == (self.keyboard.SHIFT + self.keyboard.RIGHT):
                        roll_disturbance = -1.0
                    elif key == (self.keyboard.SHIFT + self.keyboard.LEFT):
                        roll_disturbance = 1.0
                    elif key == (self.keyboard.SHIFT + self.keyboard.UP):
                        self.target_altitude += 0.05
                        print(f"target altitude: {self.target_altitude:.2f} [m]")
                    elif key == (self.keyboard.SHIFT + self.keyboard.DOWN):
                        self.target_altitude -= 0.05
                        print(f"target altitude: {self.target_altitude:.2f} [m]")
                    key = self.keyboard.getKey()

            roll_input = self.K_ROLL_P * clamp(roll, -1.0, 1.0) + roll_velocity + roll_disturbance
            pitch_input = self.K_PITCH_P * clamp(pitch, -1.0, 1.0) + pitch_velocity + pitch_disturbance
            yaw_input = yaw_disturbance
            clamped_difference_altitude = clamp(
                self.target_altitude - altitude + self.K_VERTICAL_OFFSET, -1.0, 1.0
            )
            vertical_input = self.K_VERTICAL_P * pow(clamped_difference_altitude, 3.0)

            front_left_motor_input = (
                self.K_VERTICAL_THRUST + vertical_input - roll_input + pitch_input - yaw_input
            )
            front_right_motor_input = (
                self.K_VERTICAL_THRUST + vertical_input + roll_input + pitch_input + yaw_input
            )
            rear_left_motor_input = (
                self.K_VERTICAL_THRUST + vertical_input - roll_input - pitch_input + yaw_input
            )
            rear_right_motor_input = (
                self.K_VERTICAL_THRUST + vertical_input + roll_input - pitch_input - yaw_input
            )

            if self.target_altitude <= 0.15:
                self.front_left_motor.setVelocity(0.0)
                self.front_right_motor.setVelocity(0.0)
                self.rear_left_motor.setVelocity(0.0)
                self.rear_right_motor.setVelocity(0.0)
            else:
                self.front_left_motor.setVelocity(front_left_motor_input)
                self.front_right_motor.setVelocity(-front_right_motor_input)
                self.rear_left_motor.setVelocity(-rear_left_motor_input)
                self.rear_right_motor.setVelocity(rear_right_motor_input)

            if WEBSOCKETS_AVAILABLE and sim_time - self._last_telemetry_time >= self.TELEMETRY_PERIOD:
                x_pos, y_pos, z_pos = self.gps.getValues()
                telemetry = {
                    "time": sim_time,
                    "roll": roll,
                    "pitch": pitch,
                    "yaw": yaw,
                    "x": x_pos,
                    "y": y_pos,
                    "z": z_pos,
                    "altitude": altitude,
                    "roll_velocity": roll_velocity,
                    "pitch_velocity": pitch_velocity,
                    "target_altitude": self.target_altitude,
                }
                self._queue_send(
                    {"type": "telemetry", "data": telemetry, "timestamp": sim_time}
                )
                self._last_telemetry_time = sim_time

            if (
                WEBSOCKETS_AVAILABLE
                and PIL_AVAILABLE
                and sim_time - self._last_camera_time >= self.CAMERA_PERIOD
            ):
                try:
                    width = self.camera.getWidth()
                    height = self.camera.getHeight()
                    raw = self.camera.getImage()
                    frame = np.frombuffer(raw, dtype=np.uint8)
                    frame = frame.reshape((height, width, 4))
                    rgb = frame[:, :, :3][:, :, ::-1]
                    image = Image.fromarray(rgb, "RGB")
                    buffer = io.BytesIO()
                    image.save(buffer, format="JPEG", quality=70)
                    frame_b64 = base64.b64encode(buffer.getvalue()).decode("ascii")
                    self._queue_send(
                        {"type": "camera", "frame": frame_b64, "timestamp": sim_time}
                    )
                    self._last_camera_time = sim_time

                except Exception as exc:
                    print(f"Camera capture failed: {exc}")
                    self._last_camera_time = sim_time

            if (
                WEBSOCKETS_AVAILABLE
                and self.lidar is not None
                and sim_time - self._last_pointcloud_time >= self.POINTCLOUD_PERIOD
            ):
                try:
                    points = self._get_lidar_points()
                    if points:
                        self._queue_send(
                            {"type": "pointcloud", "points": points, "timestamp": sim_time}
                        )
                    self._last_pointcloud_time = sim_time
                except Exception as exc:
                    print(f"Point cloud capture failed: {exc}")
                    self._last_pointcloud_time = sim_time

            if (
                WEBSOCKETS_AVAILABLE
                and self.lidar is not None
                and sim_time - self._last_slam_time >= self.SLAM_PERIOD
            ):
                try:
                    scan = self._extract_2d_lidar_slice()
                    if scan:
                        self._queue_send({
                            "type": "slam_scan",
                            "scan": scan,
                            "drone_rpy": list(self.imu.getRollPitchYaw()),
                            "timestamp": sim_time,
                        })
                    self._last_slam_time = sim_time
                except Exception as exc:
                    print(f"SLAM scan failed: {exc}")
                    self._last_slam_time = sim_time

            # ── Supervisor: Validate detections & broadcast state ─────────────
            if sim_time - self._last_supervisor_time >= self.SUPERVISOR_PERIOD:
                drone_xyz = list(self.gps.getValues())

                # Read and reset the YOLO-hit flag
                with self._yolo_lock:
                    yolo_fired = self._yolo_fired_this_frame
                    self._yolo_fired_this_frame = False

                # Validate YOLO hit against ground-truth pedestrian positions
                new_detections = self._validate_yolo_detection(drone_xyz, yolo_fired)

                # Always broadcast full supervisor state
                if WEBSOCKETS_AVAILABLE:
                    payload = self._build_supervisor_payload(sim_time)
                    if new_detections:
                        payload["new_detections"] = new_detections
                    self._queue_send(payload)

                self._last_supervisor_time = sim_time
            # ─────────────────────────────────────────────────────────────────

    # ── Supervisor methods ────────────────────────────────────────────────────

    def _get_pedestrian_positions(self) -> dict:
        """
        Returns current world-space [X, Y, Z] for every pedestrian node.
        Webots: X is right, Z is forward/depth, Y is height (up).
        """
        positions = {}
        for ped_id, node in self._ped_nodes.items():
            pos = node.getPosition()   # [x, y, z] in world frame
            positions[ped_id] = [
                round(float(pos[0]), 3),
                round(float(pos[1]), 3),
                round(float(pos[2]), 3),
            ]
        return positions

    def _validate_yolo_detection(self, drone_xyz: list, yolo_fired: bool) -> list:
        """
        When YOLO fires (detected a person in this frame), find which real
        pedestrian is closest to the drone and within the detection threshold.
        New detections are recorded in _confirmed_detections (deduplicated by DEF name).

        Returns list of newly confirmed detections: [{id, x, y, world_pos}, ...]
        """
        if not yolo_fired:
            return []

        ped_positions = self._get_pedestrian_positions()
        new_detections = []

        for ped_id, ped_pos in ped_positions.items():
            if ped_id in self._confirmed_detections:
                continue   # already confirmed — skip

            dist = (
                (drone_xyz[0] - ped_pos[0]) ** 2
                + (drone_xyz[1] - ped_pos[1]) ** 2
                + (drone_xyz[2] - ped_pos[2]) ** 2
            ) ** 0.5

            if dist <= self._detection_threshold:
                self._confirmed_detections[ped_id] = ped_pos
                new_detections.append({
                    "id": ped_id,
                    "x": ped_pos[0],
                    "y": ped_pos[2],   # Webots Z → map Y (ground plane)
                    "world_pos": ped_pos,
                })
                print(
                    f"[Supervisor] ✅ Confirmed new person: {ped_id} "
                    f"at {ped_pos} (dist={dist:.2f}m)"
                )

        return new_detections

    def _build_supervisor_payload(self, sim_time: float) -> dict:
        """
        Packages the full supervisor state for the frontend:
        - Map dimensions (from FLOOR node)
        - All confirmed (deduplicated) detections
        - All current pedestrian positions (demo overlay)
        - Drone world position
        """
        drone_pos = self.gps.getValues()   # [x, y, z]
        all_ped_positions = self._get_pedestrian_positions()

        return {
            "type": "supervisor_state",
            "timestamp": sim_time,
            "map": {
                "width":    self.map_width,
                "length":   self.map_length,
                "origin_x": -(self.map_width  / 2.0),
                "origin_z": -(self.map_length / 2.0),
            },
            "drone": {
                "x": round(float(drone_pos[0]), 3),
                "y": round(float(drone_pos[2]), 3),   # Webots Z → map Y
            },
            "confirmed_detections": [
                {"id": pid, "x": pos[0], "y": pos[2]}
                for pid, pos in self._confirmed_detections.items()
            ],
            # Demo overlay — shows all pedestrians; remove in production
            "all_pedestrians": [
                {
                    "id": pid,
                    "x": pos[0],
                    "y": pos[2],
                    "detected": pid in self._confirmed_detections,
                }
                for pid, pos in all_ped_positions.items()
            ],
        }

    # ─────────────────────────────────────────────────────────────────────────

    def _get_lidar_points(self):
        """Extract (x, y, z) points from LiDAR point cloud, filtering invalid values."""
        raw_points = self.lidar.getPointCloud()
        if not raw_points:
            return []

        points = []
        for p in raw_points:
            if np.isfinite(p.x) and np.isfinite(p.y) and np.isfinite(p.z):
                points.append([
                    round(float(p.x), 3),
                    round(float(p.y), 3),
                    round(float(p.z), 3),
                ])
        return points

    def _extract_2d_lidar_slice(self) -> list | None:
        """
        Collapse the 3D point cloud to a 1D array of distances (mm) at a height
        band that captures tree trunks and structures (1 m – 5 m above drone base).
        BreezySLAM expects one distance per angular bin.
        """
        if self.lidar is None:
            return None
        point_cloud = self.lidar.getPointCloud()
        if not point_cloud:
            return None

        lidar_res = self.lidar.getHorizontalResolution()
        scan_mm = [6000.0] * lidar_res   # default = max range (no detection)

        for i, pt in enumerate(point_cloud):
            if not (np.isfinite(pt.x) and np.isfinite(pt.y) and np.isfinite(pt.z)):
                continue
            # Height filter: capture obstacles 1–5 m above the ground (drone is at ~6 m)
            # pt.z is relative to the drone; obstacles below drone are negative
            rel_z = pt.z  # negative = below drone
            if -5.0 < rel_z < -1.0:   # between 1 m and 5 m below drone = tree range
                idx = i % lidar_res
                dist_mm = float(np.sqrt(pt.x**2 + pt.y**2)) * 1000.0
                if dist_mm < scan_mm[idx]:
                    scan_mm[idx] = dist_mm

        return scan_mm

    def update_waypoints_visualization(self, waypoints):
        """Draw waypoint spheres and line trajectory in Webots UI using Supervisor API."""
        try:
            # 1. Clean up previous waypoints
            for idx in range(self._last_drawn_count):
                node = self.getFromDef(f"WAYPOINT_{idx}")
                if node:
                    node.remove()

            # 2. Clean up previous flight path line
            path_node = self.getFromDef("FLIGHT_PATH")
            if path_node:
                path_node.remove()

            self._last_drawn_count = 0

            if not waypoints:
                return

            # 3. Retrieve children field of world root
            root_node = self.getRoot()
            children_field = root_node.getField("children")

            # 4. Import new waypoint spheres
            for idx, wp in enumerate(waypoints):
                wp_def_name = f"WAYPOINT_{idx}"
                x = wp[0]
                y = wp[1]
                z = wp[2] if len(wp) > 2 else 6.0

                vrml_string = f"""
                DEF {wp_def_name} Solid {{
                  translation {x} {y} {z}
                  children [
                    Shape {{
                      appearance Appearance {{
                        material Material {{ diffuseColor 1 0 0 emissiveColor 1 0 0 }}
                      }}
                      geometry Sphere {{ radius 0.25 }}
                    }}
                  ]
                }}
                """
                children_field.importMFNodeFromString(-1, vrml_string)

            self._last_drawn_count = len(waypoints)

            # 5. Import new flight path line connecting waypoints
            if len(waypoints) > 1:
                coord_strings = []
                index_strings = []
                for idx, wp in enumerate(waypoints):
                    x = wp[0]
                    y = wp[1]
                    z = wp[2] if len(wp) > 2 else 6.0
                    coord_strings.append(f"{x} {y} {z}")
                    index_strings.append(str(idx))
                index_strings.append("-1")

                vertices_block = ", ".join(coord_strings)
                indices_block = ", ".join(index_strings)

                line_vrml = f"""
                DEF FLIGHT_PATH Shape {{
                  appearance Appearance {{
                    material Material {{ diffuseColor 0 1 0 emissiveColor 0 1 0 }}
                  }}
                  geometry IndexedLineSet {{
                    coord Coordinate {{
                      point [ {vertices_block} ]
                    }}
                    coordIndex [ {indices_block} ]
                  }}
                }}
                """
                children_field.importMFNodeFromString(-1, line_vrml)

        except Exception as e:
            print(f"Error updating waypoint visualization: {e}")


robot = Mavic()
robot.run()
