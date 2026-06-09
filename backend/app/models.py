"""SQLAlchemy models for Missions and Detections."""
from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base

class Mission(Base):
    __tablename__ = "missions"

    id = Column(Integer, primary_key=True, index=True)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=True)
    status = Column(String, default="active")  # active, completed
    waypoints_json = Column(String, nullable=True)

    detections = relationship("Detection", back_populates="mission")


class Detection(Base):
    __tablename__ = "detections"

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id"))
    timestamp = Column(Float, nullable=False)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    radius = Column(Float, default=4.0)
    dispatched = Column(Boolean, default=False)
    status = Column(String, default="pending")  # pending, rescued, false_alarm

    mission = relationship("Mission", back_populates="detections")
