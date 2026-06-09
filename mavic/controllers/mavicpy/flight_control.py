"""Pure motor-math helpers — no Webots API dependencies."""
from __future__ import annotations

# ── Timing constants ────────────────────────────────────────────────────────
COMMAND_TIMEOUT   = 2.0
TELEMETRY_PERIOD  = 0.1
CAMERA_PERIOD     = 0.05   # 20 fps  ← was 0.2 (5 fps)
POINTCLOUD_PERIOD = 1.0
SLAM_PERIOD       = 0.1
SUPERVISOR_PERIOD = 0.2

# ── PID / thrust constants ───────────────────────────────────────────────────
K_VERTICAL_THRUST = 68.5
K_VERTICAL_OFFSET = 0.6
K_VERTICAL_P      = 3.0
K_ROLL_P          = 50.0
K_PITCH_P         = 30.0


def clamp(value: float, lo: float, hi: float) -> float:
    return min(max(value, lo), hi)


def compute_motor_inputs(
    roll: float,
    pitch: float,
    roll_velocity: float,
    pitch_velocity: float,
    altitude: float,
    target_altitude: float,
    roll_d: float,
    pitch_d: float,
    yaw_d: float,
) -> tuple[float, float, float, float]:
    """Return (front_left, front_right, rear_left, rear_right) motor velocities."""
    roll_input  = K_ROLL_P  * clamp(roll,  -1.0, 1.0) + roll_velocity  + roll_d
    pitch_input = K_PITCH_P * clamp(pitch, -1.0, 1.0) + pitch_velocity + pitch_d
    yaw_input   = yaw_d
    clamped_alt = clamp(target_altitude - altitude + K_VERTICAL_OFFSET, -1.0, 1.0)
    vertical    = K_VERTICAL_P * pow(clamped_alt, 3.0)

    fl = K_VERTICAL_THRUST + vertical - roll_input + pitch_input - yaw_input
    fr = K_VERTICAL_THRUST + vertical + roll_input + pitch_input + yaw_input
    rl = K_VERTICAL_THRUST + vertical - roll_input - pitch_input + yaw_input
    rr = K_VERTICAL_THRUST + vertical + roll_input - pitch_input - yaw_input
    return fl, fr, rl, rr
