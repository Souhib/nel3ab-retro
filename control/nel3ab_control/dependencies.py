"""What routes ask for, and where it comes from."""

from typing import Annotated

import httpx
from fastapi import Depends, Request

from nel3ab_control.api.controllers.bindings import (
    BindingsController,
    RoomBindingsController,
)
from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.identity import caller_of
from nel3ab_control.settings import Settings


def get_settings(request: Request) -> Settings:
    """The settings this app was built with."""
    return request.app.state.settings


def get_client(request: Request) -> httpx.AsyncClient:
    """The shared HTTP client, opened once for the life of the app.

    Shared rather than per-request: a new client per call means a new connection
    pool per call, which is a TCP handshake to the worker every time a page asks
    what game is loaded.
    """
    return request.app.state.client


def get_rooms(request: Request) -> RoomController:
    """The single room."""
    return request.app.state.rooms


def get_people(request: Request) -> PeopleController:
    """Les pseudos et les présents."""
    return request.app.state.people


def get_bindings(request: Request) -> BindingsController:
    """Les réglages de manette de chacun."""
    return request.app.state.bindings


def get_room_bindings(request: Request) -> RoomBindingsController:
    """La configuration de référence de la salle."""
    return request.app.state.room_bindings


async def get_caller(request: Request) -> tuple[str, str] | None:
    """Qui appelle, d'après le proxy, ou rien.

    Établit l'IDENTITÉ et s'arrête là. Ce qu'on a le droit de faire avec est la
    décision des contrôleurs, et mélanger les deux ici rendrait chaque règle
    invisible depuis la route qui l'applique.

    Rendre `None` plutôt que refuser: sans proxy devant, la salle marche encore,
    elle ne sait juste pas qui est qui. Le développement local et les pilotes de
    navigateur passent par là.
    """
    return await caller_of(request.scope)


SettingsDep = Annotated[Settings, Depends(get_settings)]
PeopleDep = Annotated[PeopleController, Depends(get_people)]
BindingsDep = Annotated[BindingsController, Depends(get_bindings)]
RoomBindingsDep = Annotated[RoomBindingsController, Depends(get_room_bindings)]
CallerDep = Annotated[tuple[str, str] | None, Depends(get_caller)]
ClientDep = Annotated[httpx.AsyncClient, Depends(get_client)]
RoomsDep = Annotated[RoomController, Depends(get_rooms)]
