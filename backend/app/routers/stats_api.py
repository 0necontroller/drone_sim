"""REST endpoints for Mission and Detection CRUD operations."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Mission, Detection
from app.schemas import DetectionOut, DetectionUpdate, MissionOut

router = APIRouter(prefix="/api/v1/stats", tags=["stats"])


@router.get("/missions", response_model=List[MissionOut])
def get_missions(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    missions = db.query(Mission).order_by(Mission.start_time.desc()).offset(skip).limit(limit).all()
    return missions


@router.get("/detections", response_model=List[DetectionOut])
def get_detections(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    detections = db.query(Detection).order_by(Detection.timestamp.desc()).offset(skip).limit(limit).all()
    return detections


@router.patch("/detections/{detection_id}", response_model=DetectionOut)
def update_detection(detection_id: int, updates: DetectionUpdate, db: Session = Depends(get_db)):
    db_detection = db.query(Detection).filter(Detection.id == detection_id).first()
    if not db_detection:
        raise HTTPException(status_code=404, detail="Detection not found")

    if updates.dispatched is not None:
        db_detection.dispatched = updates.dispatched
    if updates.status is not None:
        db_detection.status = updates.status

    db.commit()
    db.refresh(db_detection)
    return db_detection
