from contextlib import asynccontextmanager
from pathlib import Path

import redis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import admin, auth, guest, push, staff
from app.core.config import get_settings
from app.db import models
from app.db.migrations import apply_startup_migrations
from app.db.seed import seed_database
from app.db.session import SessionLocal, engine
from app.realtime import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    models.Base.metadata.create_all(bind=engine)
    apply_startup_migrations()
    with SessionLocal() as db:
        seed_database(db)
    yield


settings = get_settings()
Path("uploads/menu").mkdir(parents=True, exist_ok=True)
app = FastAPI(title="Millenium Dynamic QR Ordering API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:5173", "http://127.0.0.1:5174"],
    # Also allow the dev frontend when opened from another device on the same Wi-Fi
    # (e.g. a phone hitting http://192.168.x.x:5174 or http://10.x.x.x:5174) instead of localhost.
    allow_origin_regex=r"http://(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1]))\.\d{1,3}\.\d{1,3}:5174",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(guest.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(staff.router, prefix="/api")
app.include_router(push.router, prefix="/api")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/api/health")
def health_check() -> dict:
    redis_status = "unavailable"
    try:
        client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.25)
        redis_status = "ok" if client.ping() else "unavailable"
    except redis.RedisError:
        redis_status = "unavailable"

    return {"status": "ok", "database": "configured", "redis": redis_status}


@app.websocket("/ws/orders")
async def orders_socket(websocket: WebSocket) -> None:
    await websocket_channel(websocket, "orders")


@app.websocket("/ws/menu")
async def menu_socket(websocket: WebSocket) -> None:
    await websocket_channel(websocket, "menu")


@app.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: int) -> None:
    await websocket_channel(websocket, f"session:{session_id}")


async def websocket_channel(websocket: WebSocket, channel: str) -> None:
    await manager.connect(channel, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(channel, websocket)
