"""What every test needs: an app whose worker is a fake, and a client for it."""

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from asgi_lifespan import LifespanManager

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.app import create_app
from nel3ab_control.settings import Settings

LIBRARY = {
    "players": 4,
    "current": 1,
    "roms": ["Mario Kart Double Dash", "Super Smash Bros Melee"],
}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # Les pseudos vont dans un dossier jetable: un test qui écrit dans le vrai
    # fichier renommerait quelqu'un pour de bon.
    return Settings(
        room_name="Salon d'essai",
        worker_url="http://worker.test",
        state_file=tmp_path / "people.json",
    )


#: L'en-tête que le proxy Tailscale écrit, et que le client ne peut pas forger.
SOUHIB = {
    "Tailscale-User-Login": "souhib.t@hotmail.fr",
    "Tailscale-User-Name": "Souhib Trabelsi",
}
VINCENT = {"Tailscale-User-Login": "vincent@example.com", "Tailscale-User-Name": "Vincent Lemaire"}


@pytest.fixture
def worker() -> httpx.MockTransport:
    """A worker that answers the library and nothing else.

    A fake at the HTTP boundary rather than a patched controller: the thing worth
    testing is that this service reads what the worker really sends, and a mocked
    controller would test the mock.
    """

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/roms":
            return httpx.Response(200, json=LIBRARY)
        return httpx.Response(404)

    return httpx.MockTransport(handle)


@pytest.fixture
async def client(
    settings: Settings, worker: httpx.MockTransport
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings)
    async with LifespanManager(app):
        app.state.client = httpx.AsyncClient(transport=worker)
        app.state.rooms = RoomController(settings, app.state.client)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://control.test"
        ) as http:
            yield http
