from controller import Robot, Keyboard
import cv2
import numpy as np

robot = Robot()
timestep = int(robot.getBasicTimeStep())

# DEVICES
camera = robot.getDevice("camera")
camera.enable(timestep)

gps = robot.getDevice("gps")
gps.enable(timestep)

imu = robot.getDevice("inertial unit")
imu.enable(timestep)

gyro = robot.getDevice("gyro")
gyro.enable(timestep)

keyboard = Keyboard()
keyboard.enable(timestep)

# MOTORS
front_left_motor = robot.getDevice("front left propeller")
front_right_motor = robot.getDevice("front right propeller")
rear_left_motor = robot.getDevice("rear left propeller")
rear_right_motor = robot.getDevice("rear right propeller")

motors = [
    front_left_motor,
    front_right_motor,
    rear_left_motor,
    rear_right_motor
]

for motor in motors:
    motor.setPosition(float('inf'))
    motor.setVelocity(1.0)

# FLIGHT CONSTANTS
k_vertical_thrust = 68.5
target_altitude = 1.0

print("Drone AI Controller Started")

while robot.step(timestep) != -1:

    # ========= CAMERA =========
    width = camera.getWidth()
    height = camera.getHeight()

    image = camera.getImage()

    frame = np.frombuffer(image, np.uint8).reshape(
        (height, width, 4)
    )

    frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

    cv2.imshow("Drone Camera", frame)
    cv2.waitKey(1)

    # ========= GPS =========
    position = gps.getValues()

    print(
        f"X={position[0]:.2f}, "
        f"Y={position[1]:.2f}, "
        f"Z={position[2]:.2f}"
    )

    # ========= BASIC TAKEOFF =========
    front_left_motor.setVelocity(k_vertical_thrust)
    front_right_motor.setVelocity(-k_vertical_thrust)
    rear_left_motor.setVelocity(-k_vertical_thrust)
    rear_right_motor.setVelocity(k_vertical_thrust)