"""SupervisorManager — pedestrian tracking, detection validation, Webots visualization."""
from __future__ import annotations

import math


class SupervisorManager:
    """Wraps all Webots Supervisor operations that relate to pedestrian detection
    and flight-path visualization.
    """

    DETECTION_THRESHOLD = 8.0   # metres — drone must be within this to validate a YOLO hit

    def __init__(self, robot, map_width: float, map_length: float) -> None:
        self._robot = robot
        self.map_width  = map_width
        self.map_length = map_length
        self._ped_nodes: dict             = {}
        self._confirmed_detections: dict  = {}   # {ped_id: [x, y, z]}
        self._last_drawn_count: int       = 0
        self._discover_pedestrians()

    # ── Setup ──────────────────────────────────────────────────────────────────

    def _discover_pedestrians(self) -> None:
        for i in range(50):
            name = f"PED_{i}"
            node = self._robot.getFromDef(name)
            if node:
                self._ped_nodes[name] = node
            else:
                break
        print(
            f"[Supervisor] Found {len(self._ped_nodes)} pedestrian nodes: "
            f"{list(self._ped_nodes.keys())}"
        )

    # ── Pedestrian positions ───────────────────────────────────────────────────

    def _get_pedestrian_positions(self) -> dict:
        return {
            pid: [round(float(v), 3) for v in node.getPosition()]
            for pid, node in self._ped_nodes.items()
        }

    # ── Detection validation ───────────────────────────────────────────────────

    def validate_detection(self, drone_xyz: list, yolo_fired: bool) -> list:
        """Return list of *newly* confirmed detections when a YOLO hit occurs."""
        if not yolo_fired:
            return []
        ped_positions = self._get_pedestrian_positions()
        new = []
        for pid, pos in ped_positions.items():
            if pid in self._confirmed_detections:
                continue
            dist = math.sqrt(
                (drone_xyz[0] - pos[0]) ** 2 +
                (drone_xyz[1] - pos[1]) ** 2 +
                (drone_xyz[2] - pos[2]) ** 2
            )
            if dist <= self.DETECTION_THRESHOLD:
                self._confirmed_detections[pid] = pos
                new.append({"id": pid, "x": pos[0], "y": pos[2], "world_pos": pos})
                print(f"[Supervisor] ✅ {pid} confirmed at {pos} (dist={dist:.2f}m)")
        return new

    # ── Payload builder ────────────────────────────────────────────────────────

    def build_payload(self, sim_time: float, drone_xyz: list) -> dict:
        all_peds = self._get_pedestrian_positions()
        return {
            "type":      "supervisor_state",
            "timestamp": sim_time,
            "map": {
                "width":    self.map_width,
                "length":   self.map_length,
                "origin_x": -(self.map_width  / 2.0),
                "origin_z": -(self.map_length / 2.0),
            },
            "drone": {
                "x": round(float(drone_xyz[0]), 3),
                "y": round(float(drone_xyz[2]), 3),
            },
            "confirmed_detections": [
                {"id": pid, "x": pos[0], "y": pos[2]}
                for pid, pos in self._confirmed_detections.items()
            ],
            "all_pedestrians": [
                {
                    "id": pid, "x": pos[0], "y": pos[2],
                    "detected": pid in self._confirmed_detections,
                }
                for pid, pos in all_peds.items()
            ],
        }

    # ── Webots visualization ───────────────────────────────────────────────────

    def update_visualization(self, waypoints: list) -> None:
        """Draw (or redraw) waypoint spheres and a flight-path line in Webots."""
        try:
            # Remove previous markers
            for idx in range(self._last_drawn_count):
                node = self._robot.getFromDef(f"WAYPOINT_{idx}")
                if node:
                    node.remove()
            fp = self._robot.getFromDef("FLIGHT_PATH")
            if fp:
                fp.remove()
            self._last_drawn_count = 0
            if not waypoints:
                return

            children = self._robot.getRoot().getField("children")

            for idx, wp in enumerate(waypoints):
                x, y = wp[0], wp[1]
                z    = wp[2] if len(wp) > 2 else 6.0
                children.importMFNodeFromString(-1, f"""
                    DEF WAYPOINT_{idx} Solid {{
                      translation {x} {y} {z}
                      children [ Shape {{
                        appearance Appearance {{ material Material {{
                          diffuseColor 1 0 0  emissiveColor 1 0 0 }} }}
                        geometry Sphere {{ radius 0.25 }}
                      }} ]
                    }}""")

            self._last_drawn_count = len(waypoints)

            if len(waypoints) > 1:
                coords  = " , ".join(
                    f"{wp[0]} {wp[1]} {wp[2] if len(wp) > 2 else 6.0}"
                    for wp in waypoints
                )
                indices = " ".join(str(i) for i in range(len(waypoints))) + " -1"
                children.importMFNodeFromString(-1, f"""
                    DEF FLIGHT_PATH Shape {{
                      appearance Appearance {{ material Material {{
                        diffuseColor 0 1 0  emissiveColor 0 1 0 }} }}
                      geometry IndexedLineSet {{
                        coord Coordinate {{ point [ {coords} ] }}
                        coordIndex [ {indices} ]
                      }}
                    }}""")

        except Exception as exc:
            print(f"[Supervisor] Visualization error: {exc}")
