"""Pydantic schemas for API requests and responses."""
from pydantic import BaseModel
from typing import List, Optional

# --- Detections ---
class DetectionBase(BaseModel):
    x: float
    y: float
    radius: float = 4.0
    timestamp: float
    dispatched: bool = False
    status: str = "pending"

class DetectionCreate(DetectionBase):
    pass

class DetectionUpdate(BaseModel):
    dispatched: Optional[bool] = None
    status: Optional[str] = None

class DetectionOut(DetectionBase):
    id: int
    mission_id: int

    class Config:
        orm_mode = True


# --- Missions ---
class MissionBase(BaseModel):
    start_time: float
    status: str = "active"
    waypoints_json: Optional[str] = None

class MissionCreate(MissionBase):
    pass

class MissionOut(MissionBase):
    id: int
    end_time: Optional[float] = None
    detections: List[DetectionOut] = []

    class Config:
        orm_mode = True
