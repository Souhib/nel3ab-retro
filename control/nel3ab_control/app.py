"""The control plane: rooms, names, pads. Never a frame (ADR D12)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.routing import APIRoute

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.routes import me as me_routes
from nel3ab_control.api.routes import rooms as rooms_routes
from nel3ab_control.api.ws import socketio_app
from nel3ab_control.journal import Journal
from nel3ab_control.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Opens the HTTP client once, and the room with it."""
    settings: Settings = app.state.settings
    async with httpx.AsyncClient() as client:
        app.state.client = client
        app.state.rooms = RoomController(settings, client)
        app.state.people = PeopleController(settings.state_file)
        # Le journal balaie AVANT de servir: un service rallumé après trois
        # semaines d'arrêt ne doit pas garder trois semaines de séances au
        # prétexte qu'aucun jour n'a tourné pendant qu'il dormait.
        app.state.journal = Journal(
            settings.journal_dir, settings.journal_days, settings.journal_zone
        )
        app.state.journal.sweep()
        try:
            yield
        finally:
            app.state.journal.close()


def operation_id(route: APIRoute) -> str:
    """Names an operation after its function, not after its URL.

    Without this, FastAPI derives `readRoomApiRoomGet` from the path and method,
    and the generated TypeScript client carries that name into every call site.
    Moving a route then renames a function in the front end for no reason. The
    cost is that two endpoint functions may not share a name, which the OpenAPI
    document would reject anyway.
    """
    return route.name


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds the app.

    A factory rather than a module-level app so a test can build one with its own
    settings and its own worker, and so nothing connects at import time.
    """
    app = FastAPI(
        title="nel3ab control",
        summary="Who is here, which game, which pad.",
        lifespan=lifespan,
        generate_unique_id_function=operation_id,
    )
    app.state.settings = settings or Settings()
    app.include_router(me_routes.router)
    app.include_router(rooms_routes.router)
    app.mount("/socket.io", socketio_app)
    return app


app = create_app()
