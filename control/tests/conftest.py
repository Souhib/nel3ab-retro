"""What every test needs: an app whose worker is a fake, and a client for it."""

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.app import create_app
from nel3ab_control.settings import Settings

LIBRARY = {
    "players": 4,
    "current": 1,
    "roms": [
        {"name": "Mario Kart Double Dash", "maker": None, "about": None, "art": False},
        {
            "name": "Super Smash Bros Melee",
            "maker": "Nintendo/HAL Laboratory,Inc.",
            "about": "Let the melee begin!",
            "art": True,
        },
    ],
}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # Les pseudos vont dans un dossier jetable: un test qui écrit dans le vrai
    # fichier renommerait quelqu'un pour de bon.
    return Settings(
        room_name="Salon d'essai",
        worker_url="http://worker.test",
        state_file=tmp_path / "people.json",
        # Et les réglages de manette, pour exactement la même raison. Oubliés au
        # premier jet, les tests écrivaient dans le VRAI fichier: ils auraient
        # remplacé les manettes de quelqu'un par celles d'un test.
        bindings_file=tmp_path / "bindings.json",
        # La référence de la salle, jetable aussi: un essai qui publie dans le
        # vrai fichier remplacerait la configuration de tout le monde.
        room_bindings_file=tmp_path / "room-bindings.json",
        # Et une adresse qui a le droit de publier, sinon aucun essai ne
        # pourrait couvrir le chemin qui écrit.
        admin="souhib@example.com",
        # Et le journal aussi, pour la même raison ET une pire: le journal
        # BALAIE ce qu'il trouve de trop vieux. Une suite de tests pointée sur le
        # vrai dossier effacerait la soirée qu'on voulait relire, et le premier
        # jet de ce fichier l'a fait.
        journal_dir=tmp_path / "sessions",
    )


#: L'en-tête que le proxy Tailscale écrit, et que le client ne peut pas forger.
SOUHIB = {
    "Tailscale-User-Login": "souhib@example.com",
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
async def app(settings: Settings, worker: httpx.MockTransport) -> AsyncIterator[FastAPI]:
    """L'application, avec un faux worker derrière."""
    built = create_app(settings)
    async with LifespanManager(built):
        built.state.client = httpx.AsyncClient(transport=worker)
        built.state.rooms = RoomController(settings, built.state.client)
        yield built


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://control.test"
    ) as http:
        yield http


@pytest.fixture
def rooms(app: FastAPI) -> RoomController:
    """Le contrôleur derrière ce client.

    Par le contrôleur et non par une route: réserver une place passe par la
    socket du salon, qui sait QUELLE session parle. Une route HTTP ne le sait
    pas, et celle qui existait a été retirée pour cette raison.
    """
    controller: RoomController = app.state.rooms
    return controller
