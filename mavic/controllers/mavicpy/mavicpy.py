"""mavicpy — Webots controller entry point.

All logic lives in mavic.py and its helper modules:
  flight_control.py  — motor math + PID constants
  ws_client.py       — background WebSocket thread
  sensors.py         — camera / LiDAR / SLAM / telemetry helpers
  supervisor.py      — SupervisorManager (pedestrian tracking, visualization)
  mavic.py           — Mavic class + simulation run-loop
"""
from mavic import Mavic

robot = Mavic()
robot.run()
