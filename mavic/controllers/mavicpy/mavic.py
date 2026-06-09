"""Mavic drone controller — main class."""
from __future__ import annotations

import threading
import time

from controller import Supervisor

from flight_control import (
    CAMERA_PERIOD,
    COMMAND_TIMEOUT,
    POINTCLOUD_PERIOD,
    SLAM_PERIOD,
    SUPERVISOR_PERIOD,
    TELEMETRY_PERIOD,
    clamp,
    compute_motor_inputs,
)
from sensors import (
    capture_camera_jpeg,
    extract_slam_slice,
    get_lidar_points_with_pose,
    read_telemetry,
)
from supervisor import SupervisorManager
from ws_client import WsClient


class Mavic(Supervisor):
    """Full Mavic drone controller with WebSocket telemetry, camera, LiDAR and
    Supervisor pedestrian detection.
    """

    def __init__(self) -> None:
        super().__init__()
        self.time_step = int(self.getBasicTimeStep())

        # ── Devices ───────────────────────────────────────────────────────────
        self.camera = self.getDevice("camera")
        self.camera.enable(self.time_step)

        self.imu = self.getDevice("inertial unit")
        self.imu.enable(self.time_step)

        self.gps = self.getDevice("gps")
        self.gps.enable(self.time_step)

        self.compass = self.getDevice("compass")
        self.compass.enable(self.time_step)

        self.gyro = self.getDevice("gyro")
        self.gyro.enable(self.time_step)

        self.keyboard = self.getDevice("keyboard")
        if self.keyboard is not None:
            self.keyboard.enable(self.time_step)
        else:
            print("[Mavic] No keyboard device — manual keyboard control disabled")

        self.front_left_led  = self.getDevice("front left led")
        self.front_right_led = self.getDevice("front right led")
        self.camera_roll_motor  = self.getDevice("camera roll")
        self.camera_pitch_motor = self.getDevice("camera pitch")

        # Motors
        self._fl = self.getDevice("front left propeller")
        self._fr = self.getDevice("front right propeller")
        self._rl = self.getDevice("rear left propeller")
        self._rr = self.getDevice("rear right propeller")
        for m in (self._fl, self._fr, self._rl, self._rr):
            m.setPosition(float("inf"))
            m.setVelocity(1.0)

        # LiDAR
        self.lidar     = None
        self._lidar_res = 360
        try:
            self.lidar = self.getDevice("lidar")
            self.lidar.enable(self.time_step)
            self.lidar.enablePointCloud()
            self._lidar_res = self.lidar.getHorizontalResolution()
        except Exception:
            self.lidar = None

        # ── Flight state ──────────────────────────────────────────────────────
        self.target_altitude: float = 0.0
        self._command: dict = {
            "roll": 0.0, "pitch": 0.0, "yaw": 0.0,
            "altitude_delta": 0.0, "target_altitude": None,
        }
        self._command_lock         = threading.Lock()
        self._command_ts: float    = 0.0
        self._last_alt_cmd_ts: float = 0.0

        self._pending_waypoints: list | None = None
        self._waypoints_lock = threading.Lock()

        self._yolo_fired: bool = False
        self._yolo_lock        = threading.Lock()

        # ── Timing ────────────────────────────────────────────────────────────
        self._t_telem:      float = 0.0
        self._t_camera:     float = 0.0
        self._t_pc:         float = 0.0
        self._t_slam:       float = 0.0
        self._t_supervisor: float = 0.0

        # ── Supervisor manager ────────────────────────────────────────────────
        map_w, map_l = self._read_map_size()
        self.supervisor_mgr = SupervisorManager(self, map_w, map_l)

        # ── WebSocket client ──────────────────────────────────────────────────
        self.ws = WsClient(
            on_control=self._on_control,
            on_waypoints=self._on_waypoints,
            on_yolo_hit=self._on_yolo_hit,
        )
        self.ws.start()

    # ── Map size discovery ────────────────────────────────────────────────────

    def _read_map_size(self) -> tuple[float, float]:
        w, l = 50.0, 50.0
        floor = self.getFromDef("FLOOR")
        if floor:
            for name in ("size", "floorSize"):
                sf = floor.getField(name)
                if sf:
                    v = sf.getSFVec2f()
                    w, l = float(v[0]), float(v[1])
                    print(f"[Mavic] Map ({name}): {w}m × {l}m")
                    break
        else:
            print("[Mavic] FLOOR node not found — using default 50×50m")
        return w, l

    # ── WebSocket callbacks ───────────────────────────────────────────────────

    def _on_control(self, command: dict) -> None:
        with self._command_lock:
            self._command = {
                "roll":            float(command.get("roll",           0.0)),
                "pitch":           float(command.get("pitch",          0.0)),
                "yaw":             float(command.get("yaw",            0.0)),
                "altitude_delta":  float(command.get("altitude_delta", 0.0)),
                "target_altitude": command.get("target_altitude"),
            }
            self._command_ts = time.time()

    def _on_waypoints(self, waypoints: list) -> None:
        with self._waypoints_lock:
            self._pending_waypoints = waypoints

    def _on_yolo_hit(self) -> None:
        with self._yolo_lock:
            self._yolo_fired = True

    # ── Main simulation loop ──────────────────────────────────────────────────

    def run(self) -> None:
        while self.step(self.time_step) != -1:
            now = self.getTime()

            # ── Waypoint visualization ───────────────────────────────────────
            with self._waypoints_lock:
                wps, self._pending_waypoints = self._pending_waypoints, None
            if wps is not None:
                self.supervisor_mgr.update_visualization(wps)

            # ── Sensor reads ─────────────────────────────────────────────────
            roll, pitch, yaw = self.imu.getRollPitchYaw()
            altitude          = self.gps.getValues()[2]
            roll_v, pitch_v, _ = self.gyro.getValues()

            # ── LEDs ─────────────────────────────────────────────────────────
            led = int(now) % 2
            self.front_left_led.set(led)
            self.front_right_led.set(1 - led)

            # ── Camera stabilisation ─────────────────────────────────────────
            self.camera_roll_motor.setPosition(clamp(-0.115 * roll_v,        -0.5, 0.5))
            self.camera_pitch_motor.setPosition(clamp(0.349 - 0.1 * pitch_v, -0.5, 0.5))

            # ── Control input ────────────────────────────────────────────────
            rd = pd = yd = 0.0
            if time.time() - self._command_ts < COMMAND_TIMEOUT:
                with self._command_lock:
                    cmd = dict(self._command)
                rd, pd, yd = cmd["roll"], cmd["pitch"], cmd["yaw"]
                if cmd.get("target_altitude") is not None:
                    self.target_altitude = float(cmd["target_altitude"])
                elif cmd.get("altitude_delta") and self._command_ts != self._last_alt_cmd_ts:
                    self.target_altitude = clamp(
                        self.target_altitude + float(cmd["altitude_delta"]), 0.5, 50.0
                    )
                    self._last_alt_cmd_ts = self._command_ts
            elif self.keyboard is not None:
                key = self.keyboard.getKey()
                while key > 0:
                    if   key == self.keyboard.UP:    pd = -2.0
                    elif key == self.keyboard.DOWN:  pd =  2.0
                    elif key == self.keyboard.RIGHT: yd = -1.3
                    elif key == self.keyboard.LEFT:  yd =  1.3
                    elif key == (self.keyboard.SHIFT + self.keyboard.RIGHT): rd = -1.0
                    elif key == (self.keyboard.SHIFT + self.keyboard.LEFT):  rd =  1.0
                    elif key == (self.keyboard.SHIFT + self.keyboard.UP):
                        self.target_altitude += 0.05
                    elif key == (self.keyboard.SHIFT + self.keyboard.DOWN):
                        self.target_altitude -= 0.05
                    key = self.keyboard.getKey()

            # ── Motors ───────────────────────────────────────────────────────
            if self.target_altitude <= 0.15:
                for m in (self._fl, self._fr, self._rl, self._rr):
                    m.setVelocity(0.0)
            else:
                fl, fr, rl, rr = compute_motor_inputs(
                    roll, pitch, roll_v, pitch_v,
                    altitude, self.target_altitude,
                    rd, pd, yd,
                )
                self._fl.setVelocity(fl)
                self._fr.setVelocity(-fr)
                self._rl.setVelocity(-rl)
                self._rr.setVelocity(rr)

            # ── Telemetry ────────────────────────────────────────────────────
            if now - self._t_telem >= TELEMETRY_PERIOD:
                telem = read_telemetry(self.gps, self.imu, self.gyro, now, self.target_altitude)
                self.ws.queue_send({"type": "telemetry", "data": telem, "timestamp": now})
                self._t_telem = now

            # ── Camera ───────────────────────────────────────────────────────
            if now - self._t_camera >= CAMERA_PERIOD:
                b64 = capture_camera_jpeg(self.camera, quality=65)
                if b64:
                    self.ws.queue_send({"type": "camera", "frame": b64, "timestamp": now})
                self._t_camera = now

            # ── LiDAR point cloud ─────────────────────────────────────────────
            if self.lidar and now - self._t_pc >= POINTCLOUD_PERIOD:
                pc = get_lidar_points_with_pose(self.lidar, self.gps, self.imu)
                if pc:
                    self.ws.queue_send({"type": "pointcloud", **pc, "timestamp": now})
                self._t_pc = now

            # ── SLAM scan ────────────────────────────────────────────────────
            if self.lidar and now - self._t_slam >= SLAM_PERIOD:
                scan = extract_slam_slice(self.lidar, self._lidar_res)
                if scan:
                    self.ws.queue_send({
                        "type":      "slam_scan",
                        "scan":      scan,
                        "drone_rpy": list(self.imu.getRollPitchYaw()),
                        "timestamp": now,
                    })
                self._t_slam = now

            # ── Supervisor ───────────────────────────────────────────────────
            if now - self._t_supervisor >= SUPERVISOR_PERIOD:
                drone_xyz = list(self.gps.getValues())
                with self._yolo_lock:
                    fired, self._yolo_fired = self._yolo_fired, False
                new_dets = self.supervisor_mgr.validate_detection(drone_xyz, fired)
                payload  = self.supervisor_mgr.build_payload(now, drone_xyz)
                if new_dets:
                    payload["new_detections"] = new_dets
                self.ws.queue_send(payload)
                self._t_supervisor = now
