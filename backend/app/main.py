"""Drone Control API — application factory."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import demo_api, drone_api, rtc, stats_api, ws_controller, ws_dashboard
from app.services.demo_worker import start_demo_worker

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Drone Control API", version="0.2.0")

@app.on_event("startup")
async def startup_event():
    start_demo_worker()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(drone_api.router)
app.include_router(ws_dashboard.router)
app.include_router(ws_controller.router)
app.include_router(rtc.router)
app.include_router(stats_api.router)
app.include_router(demo_api.router)
