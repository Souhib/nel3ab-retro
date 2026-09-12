"""The control plane: rooms, names, pads. Never a frame (ADR D12)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio
import httpx
from fastapi import FastAPI
from fastapi.routing import APIRoute

from nel3ab_control.api.controllers.bindings import (
    BindingsController,
    RoomBindingsController,
)
from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.salles import SallesController
from nel3ab_control.api.controllers.salons import Salons
from nel3ab_control.api.routes import accueil as accueil_routes
from nel3ab_control.api.routes import me as me_routes
from nel3ab_control.api.routes import rooms as rooms_routes
from nel3ab_control.api.routes import salles as salles_routes
from nel3ab_control.api.ws import socketio_app
from nel3ab_control.api.ws.server import allow_origins, follow_seats
from nel3ab_control.journal import Journal
from nel3ab_control.settings import Settings
from nel3ab_control.worker import read_seats


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Opens the HTTP client once, and the room with it."""
    settings: Settings = app.state.settings
    async with httpx.AsyncClient() as client:
        app.state.client = client
        # Un contrôleur PAR salle, créé au premier besoin. `state.rooms` reste
        # celui de la salle 1 tant que tous les appelants ne disent pas la leur:
        # un défaut explicite vaut mieux qu'une adresse écrite à la main, qui est
        # exactement ce qui a fait rendre 503 à tout le salon après la bascule.
        app.state.salons = Salons(settings, client)
        app.state.rooms = app.state.salons.pour(1)
        # Les salles de la machine. Elle interroge systemd pour savoir qui
        # tourne, et les workers pour le jeu et les places. Tout ce qu'elle tient
        # d'un worker reste FACULTATIF: une salle qui se tait est décrite sans
        # ces détails, jamais retirée de la liste ni remontée en erreur.
        app.state.salles = SallesController(settings, client=client, lire_places=read_seats)
        app.state.people = PeopleController(settings.state_file)
        app.state.bindings = BindingsController(settings.bindings_file)
        app.state.room_bindings = RoomBindingsController(settings.room_bindings_file)
        # Le journal balaie AVANT de servir: un service rallumé après trois
        # semaines d'arrêt ne doit pas garder trois semaines de séances au
        # prétexte qu'aucun jour n'a tourné pendant qu'il dormait.
        app.state.journal = Journal(
            settings.journal_dir, settings.journal_days, settings.journal_zone
        )
        app.state.journal.sweep()
        try:
            async with anyio.create_task_group() as group:
                group.start_soon(follow_seats, app.state)
                try:
                    yield
                finally:
                    group.cancel_scope.cancel()
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
    allow_origins(app.state.settings.origins)
    app.include_router(accueil_routes.router)
    app.include_router(me_routes.router)
    app.include_router(rooms_routes.router)
    app.include_router(salles_routes.router)
    app.mount("/socket.io", socketio_app)
    return app


app = create_app()
