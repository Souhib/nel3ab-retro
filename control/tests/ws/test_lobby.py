"""The lobby, against a real server and a real client.

Not a unit test with a fake session: what is worth checking here is the seam
itself. The handlers reach into the ASGI scope to find the room, which depends on
how the socket app is mounted — the sort of coupling that keeps working in a
unit test and fails the moment it is served.
"""

import asyncio
import socket
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import socketio
import uvicorn

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.app import create_app
from nel3ab_control.settings import Settings

LIBRARY = {"current": 0, "roms": ["Super Smash Bros Melee"]}


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.fixture
async def served(tmp_path: Path) -> AsyncIterator[tuple[str, RoomController]]:
    """A control plane on a real port, with a fake worker behind it."""

    def worker(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=LIBRARY)

    settings = Settings(worker_url="http://worker.test", state_file=tmp_path / "people.json")
    app = create_app(settings)
    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    )
    task = asyncio.create_task(server.serve())
    for _ in range(100):
        await asyncio.sleep(0.05)
        if server.started:
            break
    # The fake worker replaces the client the lifespan opened.
    app.state.client = httpx.AsyncClient(transport=httpx.MockTransport(worker))
    app.state.rooms = RoomController(settings, app.state.client)
    yield f"http://127.0.0.1:{port}", app.state.rooms
    server.should_exit = True
    await task


async def test_a_page_that_takes_a_pad_is_broadcast_to_everybody(
    served: tuple[str, RoomController],
) -> None:
    url, rooms = served
    heard: list[dict] = []

    watcher = socketio.AsyncClient()
    watcher.on("room", heard.append)
    await watcher.connect(url, auth={"name": "Yassine"}, socketio_path="/socket.io")

    player = socketio.AsyncClient()
    await player.connect(url, auth={"name": "Souhib"}, socketio_path="/socket.io")
    await player.emit("seat", {"port": 2})
    await asyncio.sleep(0.3)

    assert heard, "the watcher was told nothing at all"
    seats = heard[-1]["seats"]
    assert seats[1] == {"port": 2, "player": "Souhib"}
    assert rooms.seats()[1].player == "Souhib"

    await player.disconnect()
    await asyncio.sleep(0.3)
    assert rooms.seats()[1].player is None, "leaving must give the pad back"
    await watcher.disconnect()


async def test_the_lobby_knows_who_it_is_from_the_proxy(
    served: tuple[str, RoomController],
) -> None:
    """L'identité arrive sur la MONTÉE EN GRADE de la WebSocket.

    C'est ce qui évite un jeton à faire circuler entre une route et une socket,
    et c'est le seul endroit où ça se vérifie: le gestionnaire lit la portée ASGI
    de la poignée de main, pas celle d'une requête HTTP ordinaire.
    """
    url, _rooms = served
    heard: list[dict] = []

    watcher = socketio.AsyncClient()
    watcher.on("room", heard.append)
    await watcher.connect(url, socketio_path="/socket.io")

    known = socketio.AsyncClient()
    await known.connect(
        url,
        socketio_path="/socket.io",
        # Le prénom envoyé par le client dit « Imposteur »; l'en-tête du proxy dit
        # Souhib. C'est l'en-tête qui doit gagner.
        auth={"name": "Imposteur"},
        headers={
            "Tailscale-User-Login": "souhib.t@hotmail.fr",
            "Tailscale-User-Name": "Souhib Trabelsi",
        },
    )
    await asyncio.sleep(0.3)

    people = heard[-1]["people"]
    names = {person["name"] for person in people}
    assert "Souhib" in names
    assert "Imposteur" not in names
    logins = {person["login"] for person in people}
    assert "souhib.t@hotmail.fr" in logins

    await known.disconnect()
    await watcher.disconnect()
