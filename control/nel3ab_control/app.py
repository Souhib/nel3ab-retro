"""The control plane: rooms, names, pads. Never a frame (ADR D12)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.routes import rooms as rooms_routes
from nel3ab_control.api.ws import socketio_app
from nel3ab_control.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Opens the HTTP client once, and the room with it."""
    settings: Settings = app.state.settings
    async with httpx.AsyncClient() as client:
        app.state.client = client
        app.state.rooms = RoomController(settings, client)
        yield


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds the app.

    A factory rather than a module-level app so a test can build one with its own
    settings and its own worker, and so nothing connects at import time.
    """
    app = FastAPI(
        title="nel3ab control",
        summary="Who is here, which game, which pad.",
        lifespan=lifespan,
    )
    app.state.settings = settings or Settings()
    app.include_router(rooms_routes.router)
    app.mount("/socket.io", socketio_app)
    return app


app = create_app()
