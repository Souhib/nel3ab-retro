"""What routes ask for, and where it comes from."""

from typing import Annotated

import httpx
from fastapi import Depends, Request

from nel3ab_control.api.controllers.rooms import RoomController
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


SettingsDep = Annotated[Settings, Depends(get_settings)]
ClientDep = Annotated[httpx.AsyncClient, Depends(get_client)]
RoomsDep = Annotated[RoomController, Depends(get_rooms)]
