"""Drone Control API — application factory."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import drone_api, rtc, ws_controller, ws_dashboard

app = FastAPI(title="Drone Control API", version="0.2.0")

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
