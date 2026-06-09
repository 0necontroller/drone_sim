"""A* Pathfinding on the SLAM 2D occupancy grid."""
import heapq
import math

def world_to_grid(x: float, y: float, map_pixels: int, map_meters: float) -> tuple[int, int]:
    """Convert Webots world coordinates (-200 to +200) to grid coordinates (0 to map_pixels-1)."""
    shifted_x = x + (map_meters / 2.0)
    shifted_y = y + (map_meters / 2.0)
    
    grid_x = int((shifted_x / map_meters) * map_pixels)
    grid_y = int((shifted_y / map_meters) * map_pixels)
    
    grid_x = max(0, min(map_pixels - 1, grid_x))
    grid_y = max(0, min(map_pixels - 1, grid_y))
    return grid_x, grid_y

def grid_to_world(gx: int, gy: int, map_pixels: int, map_meters: float) -> tuple[float, float]:
    shifted_x = (gx / float(map_pixels)) * map_meters
    shifted_y = (gy / float(map_pixels)) * map_meters
    return shifted_x - (map_meters / 2.0), shifted_y - (map_meters / 2.0)

def astar_next_waypoint(
    drone_x: float, drone_y: float,
    target_x: float, target_y: float,
    map_bytes: bytearray, map_pixels: int, map_meters: float
) -> tuple[float, float]:
    """
    Run A* to find a safe path to the target.
    Returns the *next* immediate coordinate (local_target_x, local_target_y) for the drone to fly to.
    If no obstacles are in the way, it returns (target_x, target_y).
    """
    start_gx, start_gy = world_to_grid(drone_x, drone_y, map_pixels, map_meters)
    goal_gx, goal_gy   = world_to_grid(target_x, target_y, map_pixels, map_meters)

    if start_gx == goal_gx and start_gy == goal_gy:
        return target_x, target_y

    def is_obstacle(gx: int, gy: int) -> bool:
        # Provide a small safety margin: 1 pixel around the check
        for dy in [-1, 0, 1]:
            for dx in [-1, 0, 1]:
                ny, nx = gy + dy, gx + dx
                if 0 <= nx < map_pixels and 0 <= ny < map_pixels:
                    idx = ny * map_pixels + nx
                    # 127 is usually unexplored/free. 255 is obstacle.
                    if map_bytes[idx] > 150:
                        return True
        return False

    def is_line_free(x0, y0, x1, y1):
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        x, y = x0, y0
        sx = -1 if x0 > x1 else 1
        sy = -1 if y0 > y1 else 1
        if dx > dy:
            err = dx / 2.0
            while x != x1:
                if is_obstacle(x, y): return False
                err -= dy
                if err < 0:
                    y += sy
                    err += dx
                x += sx
        else:
            err = dy / 2.0
            while y != y1:
                if is_obstacle(x, y): return False
                err -= dx
                if err < 0:
                    x += sx
                    err += dy
                y += sy
        return True

    if is_line_free(start_gx, start_gy, goal_gx, goal_gy):
        return target_x, target_y

    # Need A* 
    open_set = []
    heapq.heappush(open_set, (0, start_gx, start_gy))
    came_from = {}
    g_score = {(start_gx, start_gy): 0}
    
    max_nodes = 3000  # Cap search to avoid blocking event loop
    nodes_expanded = 0

    while open_set and nodes_expanded < max_nodes:
        _, curr_x, curr_y = heapq.heappop(open_set)
        nodes_expanded += 1

        if curr_x == goal_gx and curr_y == goal_gy:
            break

        for dx, dy in [(-1,0), (1,0), (0,-1), (0,1), (-1,-1), (-1,1), (1,-1), (1,1)]:
            nx, ny = curr_x + dx, curr_y + dy
            if 0 <= nx < map_pixels and 0 <= ny < map_pixels:
                if is_obstacle(nx, ny):
                    continue
                cost = 1.414 if dx != 0 and dy != 0 else 1.0
                tentative_g = g_score[(curr_x, curr_y)] + cost

                if tentative_g < g_score.get((nx, ny), float('inf')):
                    came_from[(nx, ny)] = (curr_x, curr_y)
                    g_score[(nx, ny)] = tentative_g
                    h = math.sqrt((goal_gx - nx)**2 + (goal_gy - ny)**2)
                    heapq.heappush(open_set, (tentative_g + h, nx, ny))

    if (goal_gx, goal_gy) not in came_from:
        best_node = None
        best_h = float('inf')
        for node in g_score:
            h = math.sqrt((goal_gx - node[0])**2 + (goal_gy - node[1])**2)
            if h < best_h:
                best_h = h
                best_node = node
        if best_node is None or best_node == (start_gx, start_gy):
            return target_x, target_y 
        curr_x, curr_y = best_node
    else:
        curr_x, curr_y = goal_gx, goal_gy

    path = []
    while (curr_x, curr_y) != (start_gx, start_gy):
        path.append((curr_x, curr_y))
        curr_x, curr_y = came_from[(curr_x, curr_y)]
    path.reverse()

    # Lookahead: navigate to a point 3 meters (6 pixels) ahead on the path
    lookahead = min(6, len(path) - 1)
    if lookahead >= 0:
        next_gx, next_gy = path[lookahead]
        return grid_to_world(next_gx, next_gy, map_pixels, map_meters)
    
    return target_x, target_y
