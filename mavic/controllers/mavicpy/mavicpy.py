"""mavicpy controller."""

from controller import Robot
import sys

try:
    import numpy as np
except ImportError:
    sys.exit("Warning: 'numpy' module not found.")


def clamp(value, value_min, value_max):
    return min(max(value, value_min), value_max)


class Mavic(Robot):
    K_VERTICAL_THRUST = 68.5
    K_VERTICAL_OFFSET = 0.6
    K_VERTICAL_P = 3.0
    K_ROLL_P = 50.0
    K_PITCH_P = 30.0

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

        self.target_altitude = 1.0

    def run(self):
        while self.step(self.time_step) != -1:
            time = self.getTime()

            roll, pitch, yaw = self.imu.getRollPitchYaw()
            altitude = self.gps.getValues()[2]
            roll_velocity, pitch_velocity, _ = self.gyro.getValues()

            led_state = int(time) % 2
            self.front_left_led.set(led_state)
            self.front_right_led.set(1 - led_state)

            # Stabilize the camera using gyro feedback.
            self.camera_roll_motor.setPosition(-0.115 * roll_velocity)
            self.camera_pitch_motor.setPosition(-0.1 * pitch_velocity)

            roll_disturbance = 0.0
            pitch_disturbance = 0.0
            yaw_disturbance = 0.0

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

            self.front_left_motor.setVelocity(front_left_motor_input)
            self.front_right_motor.setVelocity(-front_right_motor_input)
            self.rear_left_motor.setVelocity(-rear_left_motor_input)
            self.rear_right_motor.setVelocity(rear_right_motor_input)


robot = Mavic()
robot.run()
