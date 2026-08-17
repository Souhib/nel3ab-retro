"""The lobby, against a real server and a real client.

Not a unit test with a fake session: what is worth checking here is the seam
itself. The handlers reach into the ASGI scope to find the room, which depends on
how the socket app is mounted — the sort of coupling that keeps working in a
unit test and fails the moment it is served.
"""

import asyncio
import json
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

    settings = Settings(
        worker_url="http://worker.test",
        state_file=tmp_path / "people.json",
        # Jetable: le journal EFFACE ce qu'il juge trop vieux, donc une suite
        # pointée sur le vrai dossier détruirait la soirée qu'on voulait relire.
        journal_dir=tmp_path / "sessions",
    )
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


async def test_the_first_identified_arrival_owns_the_room(
    served: tuple[str, RoomController],
) -> None:
    """Le premier arrivé décide, et quand il part ça passe au suivant.

    Pas de titre à réclamer: personne ne veut cliquer sur « prendre la salle »
    avant de jouer, et une salle qui se remplit a toujours un premier.
    """
    url, _rooms = served
    heard: list[dict] = []

    watcher = socketio.AsyncClient()
    watcher.on("room", heard.append)
    await watcher.connect(url, socketio_path="/socket.io")

    first = socketio.AsyncClient()
    await first.connect(
        url,
        socketio_path="/socket.io",
        headers={"Tailscale-User-Login": "souhib.t@hotmail.fr", "Tailscale-User-Name": "Souhib"},
    )
    second = socketio.AsyncClient()
    await second.connect(
        url,
        socketio_path="/socket.io",
        headers={"Tailscale-User-Login": "vincent@example.com", "Tailscale-User-Name": "Vincent"},
    )
    await asyncio.sleep(0.3)
    assert heard[-1]["owner"]["login"] == "souhib.t@hotmail.fr"

    # Le propriétaire s'en va: la salle ne reste pas sans personne pour décider.
    await first.disconnect()
    await asyncio.sleep(0.3)
    assert heard[-1]["owner"]["login"] == "vincent@example.com"

    await second.disconnect()
    await asyncio.sleep(0.3)
    # Le spectateur anonyme reste, et n'hérite de rien: il faut une identité.
    assert heard[-1]["owner"] is None

    await watcher.disconnect()


async def test_a_pad_is_asked_for_and_given(served: tuple[str, RoomController]) -> None:
    """Une demande, une réponse, et la place qui change de main.

    Le demandeur n'envoie qu'un numéro de port: il n'apprend jamais comment
    adresser la page d'en face, et c'est le serveur qui sait qui tient quoi.
    """
    url, rooms = served
    asked: list[dict] = []
    answered: list[dict] = []

    holder = socketio.AsyncClient()
    holder.on("asked", asked.append)
    await holder.connect(url, auth={"name": "Souhib"}, socketio_path="/socket.io")
    await holder.emit("seat", {"port": 2})
    await asyncio.sleep(0.2)

    asker = socketio.AsyncClient()
    asker.on("answered", answered.append)
    await asker.connect(url, auth={"name": "Vincent"}, socketio_path="/socket.io")
    await asker.emit("ask", {"port": 2})
    await asyncio.sleep(0.3)

    assert asked == [{"from": "Vincent", "port": 2}]
    assert rooms.seats()[1].player == "Souhib"

    await holder.emit("answer", {"port": 2, "ok": True})
    await asyncio.sleep(0.3)

    assert answered == [{"ok": True, "port": 2, "from": "Souhib"}]
    # La place est libérée ICI aussi: sans ça la salle l'afficherait encore au
    # nom de l'ancien pendant que l'autre s'y branche.
    assert rooms.seats()[1].player is None

    await holder.disconnect()
    await asker.disconnect()


async def test_a_refusal_says_no_and_changes_nothing(served: tuple[str, RoomController]) -> None:
    """Le jumeau négatif: refuser doit être une réponse, pas un silence."""
    url, rooms = served
    answered: list[dict] = []

    holder = socketio.AsyncClient()
    await holder.connect(url, auth={"name": "Souhib"}, socketio_path="/socket.io")
    await holder.emit("seat", {"port": 3})
    await asyncio.sleep(0.2)

    asker = socketio.AsyncClient()
    asker.on("answered", answered.append)
    await asker.connect(url, auth={"name": "Vincent"}, socketio_path="/socket.io")
    await asker.emit("ask", {"port": 3})
    await asyncio.sleep(0.2)
    await holder.emit("answer", {"port": 3, "ok": False})
    await asyncio.sleep(0.3)

    assert answered == [{"ok": False, "port": 3, "from": "Souhib"}]
    assert rooms.seats()[2].player == "Souhib"

    await holder.disconnect()
    await asker.disconnect()


async def test_an_answer_nobody_asked_for_is_ignored(served: tuple[str, RoomController]) -> None:
    """Sans demande en attente, une réponse ne libère rien.

    Sinon n'importe quelle page pourrait libérer la manette de n'importe qui en
    répondant à une question que personne n'a posée.
    """
    url, rooms = served

    holder = socketio.AsyncClient()
    await holder.connect(url, auth={"name": "Souhib"}, socketio_path="/socket.io")
    await holder.emit("seat", {"port": 1})
    await asyncio.sleep(0.2)

    intruder = socketio.AsyncClient()
    await intruder.connect(url, auth={"name": "Quelqu'un"}, socketio_path="/socket.io")
    await intruder.emit("answer", {"port": 1, "ok": True})
    await asyncio.sleep(0.3)

    assert rooms.seats()[0].player == "Souhib"

    await holder.disconnect()
    await intruder.disconnect()


async def test_a_whole_visit_can_be_replayed_from_the_journal(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """La question à laquelle rien ne savait répondre: qui a joué, quand, où.

    Contre un vrai serveur et un vrai client, parce que c'est la COUTURE qui a
    manqué et pas le module: le numéro de visite naît dans la page, voyage dans
    la poignée de main Socket.IO, se range dans la session du serveur, et doit
    ressortir sur chaque ligne. Un test unitaire du journal écrirait ce numéro
    lui-même et ne prouverait rien de ce trajet.
    """
    url, _rooms = served

    player = socketio.AsyncClient()
    await player.connect(
        url,
        socketio_path="/socket.io",
        auth={"name": "Kitaru", "visite": "3f9a2c1b", "banc": False},
        headers={"Tailscale-User-Login": "kitaru@example.com", "Tailscale-User-Name": "Kitaru"},
    )
    await player.emit("seat", {"port": 2})
    await asyncio.sleep(0.3)
    await player.disconnect()
    await asyncio.sleep(0.3)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))
    assert written, "une soirée entière et pas une ligne écrite"
    lines = [json.loads(line) for line in written[0].read_text(encoding="utf-8").splitlines()]
    mine = [line for line in lines if line.get("visite") == "3f9a2c1b"]

    assert [line["quoi"] for line in mine] == ["arrivée", "place", "départ"]
    assert {line["login"] for line in mine} == {"kitaru@example.com"}
    assert mine[1]["place"] == 2
    # La durée de la séance, qui est ce qui distingue « il est parti » de « il a
    # été déconnecté onze fois de suite ».
    assert mine[2]["secondes"] >= 0
    # Et l'état de la salle voyage avec, donc une ligne seule dit déjà qui tenait
    # quoi sans qu'on rejoue le fichier.
    assert mine[1]["salle"]["places"] == {"2": "Kitaru"}


async def test_a_test_driver_says_so_and_a_person_does_not(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """Le jumeau qui rend le journal lisible.

    Mes pilotes ouvrent la salle des dizaines de fois par soirée et prennent de
    vraies places. Sans ce drapeau ils y sont indiscernables d'un joueur, et une
    trace noyée dans son propre bruit ne sert à rien le jour où il faut chercher.

    Les deux moitiés comptent: un drapeau toujours vrai cacherait tout le monde,
    un drapeau toujours faux ne cacherait personne.
    """
    url, _rooms = served

    robot = socketio.AsyncClient()
    await robot.connect(
        url, socketio_path="/socket.io", auth={"name": "banc", "visite": "aaaa1111", "banc": True}
    )
    person = socketio.AsyncClient()
    await person.connect(
        url, socketio_path="/socket.io", auth={"name": "Souhib", "visite": "bbbb2222"}
    )
    await asyncio.sleep(0.3)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]
    banc = {line["visite"]: line["banc"] for line in lines if line.get("visite")}

    assert banc["aaaa1111"] is True
    assert banc["bbbb2222"] is False

    await robot.disconnect()
    await person.disconnect()
