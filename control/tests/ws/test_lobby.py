"""The lobby, against a real server and a real client.

Not a unit test with a fake session: what is worth checking here is the seam
itself. The handlers reach into the ASGI scope to find the room, which depends on
how the socket app is mounted — the sort of coupling that keeps working in a
unit test and fails the moment it is served.
"""

import asyncio
import json
import shlex
import socket
from collections.abc import AsyncIterator
from pathlib import Path

import anyio
import httpx
import pytest
import socketio
import uvicorn
from anyio.abc import SocketAttribute, SocketStream
from anyio.lowlevel import checkpoint
from socketio.exceptions import ConnectionError as SocketConnectionError

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.schemas.error import WorkerUnreachable
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
    assert seats[1] == {"port": 2, "player": "Souhib", "held": None, "claim": None}
    assert rooms.seats()[1].player == "Souhib"

    await player.disconnect()
    await asyncio.sleep(0.3)
    assert rooms.seats()[1].player is None, "leaving must give the pad back"
    await watcher.disconnect()


async def test_invalid_messages_do_not_stop_another_players_broadcast(
    served: tuple[str, RoomController],
) -> None:
    """L'accusé de réception attend le gestionnaire, sans sommeil de livraison."""
    url, rooms = served
    watcher = socketio.AsyncClient()
    sender = socketio.AsyncClient()
    heard: asyncio.Queue[dict] = asyncio.Queue()
    watcher.on("room", heard.put_nowait)
    try:
        await watcher.connect(url, auth={"name": "Yassine"})
        await sender.connect(url, auth={"name": "Souhib"})
        await sender.call("seat", "pas un objet", timeout=2)
        await watcher.call("seat", {"port": 2}, timeout=2)
        async with asyncio.timeout(2):
            room = await heard.get()
            while room["seats"][1]["player"] != "Yassine":
                room = await heard.get()
        assert rooms.seats()[1].player == "Yassine"
        assert {person["name"] for person in room["people"]} == {"Souhib", "Yassine"}
    finally:
        await sender.disconnect()
        await watcher.disconnect()


async def test_a_failed_connect_is_refused_and_the_next_one_can_join(
    served: tuple[str, RoomController],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url, rooms = served
    rejected = socketio.AsyncClient()
    accepted = socketio.AsyncClient()
    failures: list[dict] = []
    heard: asyncio.Queue[dict] = asyncio.Queue()
    rejected.on("connect_error", failures.append)
    accepted.on("room", heard.put_nowait)
    original = rooms.describe

    async def offline(_people=None):
        raise WorkerUnreachable("http://worker.test")

    try:
        monkeypatch.setattr(rooms, "describe", offline)
        with pytest.raises(SocketConnectionError):
            await rejected.connect(url, auth={"name": "Fantôme"})
        assert failures, "le serveur doit envoyer CONNECT_ERROR, pas laisser expirer l'attente"
        monkeypatch.setattr(rooms, "describe", original)
        await accepted.connect(url, auth={"name": "Souhib"})
        async with asyncio.timeout(2):
            room = await heard.get()
        assert [person["name"] for person in room["people"]] == ["Souhib"]
    finally:
        await rejected.disconnect()
        await accepted.disconnect()


async def test_an_object_used_as_a_name_is_refused_over_socketio(
    served: tuple[str, RoomController],
) -> None:
    url, _rooms = served
    client = socketio.AsyncClient()
    failures: list[dict] = []
    client.on("connect_error", failures.append)
    try:
        with pytest.raises(SocketConnectionError):
            await client.connect(url, auth={"name": {"bad": "name"}})
        assert failures
    finally:
        await client.disconnect()


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
            "Tailscale-User-Login": "souhib@example.com",
            "Tailscale-User-Name": "Souhib Trabelsi",
        },
    )
    await asyncio.sleep(0.3)

    people = heard[-1]["people"]
    names = {person["name"] for person in people}
    assert "Souhib" in names
    assert "Imposteur" not in names
    logins = {person["login"] for person in people}
    assert "souhib@example.com" in logins

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
        headers={"Tailscale-User-Login": "souhib@example.com", "Tailscale-User-Name": "Souhib"},
    )
    second = socketio.AsyncClient()
    await second.connect(
        url,
        socketio_path="/socket.io",
        headers={"Tailscale-User-Login": "vincent@example.com", "Tailscale-User-Name": "Vincent"},
    )
    await asyncio.sleep(0.3)
    assert heard[-1]["owner"]["login"] == "souhib@example.com"

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


async def test_what_the_browser_measures_is_written_but_never_believed(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """Le relevé du navigateur arrive au journal, rangé sous sa propre clé.

    Sous sa propre clé, et c'est l'assertion qui compte: une page qui envoie un
    champ `login` ne doit pas pouvoir se réécrire une identité, ni faire tomber
    le gestionnaire sur un argument en double. Le salon écrit ce qu'on lui dit,
    à côté de ce qu'il sait, jamais par-dessus.
    """
    url, _rooms = served

    player = socketio.AsyncClient()
    await player.connect(
        url,
        socketio_path="/socket.io",
        auth={"name": "Kitaru", "visite": "cccc3333"},
        headers={"Tailscale-User-Login": "kitaru@example.com", "Tailscale-User-Name": "Kitaru"},
    )
    await player.emit("mesures", {"vues": 600, "peintes": 412, "login": "quelqu-un-d-autre"})
    await asyncio.sleep(0.3)
    await player.disconnect()
    await asyncio.sleep(0.2)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]
    (measured,) = [line for line in lines if line["quoi"] == "mesures"]

    assert measured["vu"]["vues"] == 600
    assert measured["vu"]["peintes"] == 412
    # L'identité reste celle du proxy, et la tentative est visible sans être crue.
    assert measured["login"] == "kitaru@example.com"
    assert measured["vu"]["login"] == "quelqu-un-d-autre"


async def test_a_measurement_too_big_to_be_one_is_dropped(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """Le jumeau: sans borne, une page fait grossir le journal aussi vite qu'elle
    écrit, et le balayage de deux jours n'y peut rien puisqu'il est journalier.

    Les deux moitiés comptent. Une borne qui refuse tout laisserait passer le
    test d'au-dessus à condition qu'il n'existe pas.
    """
    url, _rooms = served

    player = socketio.AsyncClient()
    await player.connect(url, socketio_path="/socket.io", auth={"visite": "dddd4444"})
    await player.emit("mesures", {"bavardage": "x" * 4096})
    await asyncio.sleep(0.3)
    await player.disconnect()
    await asyncio.sleep(0.2)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]

    assert [line for line in lines if line["quoi"] == "mesures"] == []


async def test_one_page_cannot_fill_the_disk_with_measurements(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """La taille d'un relevé était bornée, son DÉBIT ne l'était pas.

    Mesuré le 17 août 2026 contre le vrai service: une seule page émettant en
    boucle a fait écrire 22,6 Mo en trente secondes, soit 2,7 Go par heure. Le
    balayage de deux jours n'y peut rien puisqu'il efface des journées entières,
    et un disque plein sur cette machine emporte les parties en cours.

    Le test envoie cinquante relevés d'affilée et en attend UN.
    """
    url, _rooms = served

    page = socketio.AsyncClient()
    await page.connect(url, socketio_path="/socket.io", auth={"visite": "eeee5555"})
    for _ in range(50):
        await page.emit("mesures", {"vues": 600, "peintes": 599})
    await asyncio.sleep(0.5)
    await page.disconnect()
    await asyncio.sleep(0.2)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]

    assert len([line for line in lines if line["quoi"] == "mesures"]) == 1


async def test_the_first_measurement_of_a_page_is_never_refused(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """Le jumeau, et il compte autant.

    Une limite qui refuserait aussi le premier relevé satisferait le test
    d'au-dessus en ne gardant rien du tout. Et le premier est celui qu'on veut
    le plus: une page qui vient d'arriver sur une mauvaise liaison le montre
    tout de suite.
    """
    url, _rooms = served

    page = socketio.AsyncClient()
    await page.connect(url, socketio_path="/socket.io", auth={"visite": "eeee6666"})
    await page.emit("mesures", {"vues": 600, "peintes": 599})
    await asyncio.sleep(0.4)
    await page.disconnect()
    await asyncio.sleep(0.2)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]

    assert len([line for line in lines if line["quoi"] == "mesures"]) == 1


async def test_taking_a_seat_in_a_loop_writes_one_line_and_not_fifty(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """La classe, et pas seulement la charge utile.

    Le premier audit avait borné le débit des relevés. Quatre gestionnaires sur
    six étaient restés dehors, et ceux-là font PLUS de travail qu'un relevé: un
    `seat` écrit au journal, appelle le worker et diffuse à toute la salle. Une
    page qui en envoie en boucle multipliait donc son propre trafic par le
    nombre de personnes présentes.
    """
    url, _rooms = served

    page = socketio.AsyncClient()
    await page.connect(url, socketio_path="/socket.io", auth={"visite": "aaaa1111"})
    for _ in range(50):
        await page.emit("seat", {"port": 1})
    await asyncio.sleep(0.5)
    await page.disconnect()
    await asyncio.sleep(0.2)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]

    assert len([line for line in lines if line["quoi"] == "place"]) == 1


async def test_a_seat_that_is_not_a_seat_is_ignored_rather_than_recorded(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """Trois formes qui ne veulent rien dire, et qui ne doivent rien faire.

    `seat` appelait `int(port)` sans borne pendant que `ask` et `answer`
    passaient déjà par `_port`. Un nombre énorme retenait une place inventée, ce
    qui fait grossir le dictionnaire des places sans limite, et un objet levait
    une `TypeError` que personne ne rattrapait.

    Le jumeau positif est le test au-dessus: sans lui, un gestionnaire qui ne
    ferait plus rien du tout passerait celui-ci.
    """
    url, rooms = served

    for index, wrong in enumerate([{"port": 999999}, {"port": "trois"}, {"port": {"a": 1}}]):
        page = socketio.AsyncClient()
        await page.connect(url, socketio_path="/socket.io", auth={"visite": f"bbbb{index}222"})
        await page.emit("seat", wrong)
        await asyncio.sleep(0.3)
        await page.disconnect()
        await asyncio.sleep(0.1)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]

    assert [line for line in lines if line["quoi"] == "place"] == []
    assert rooms.seats() == [seat for seat in rooms.seats() if seat.player is None]


async def test_a_pad_only_page_says_so_when_it_arrives(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """Un téléphone qui ne sert que de manette ne décode ni image ni son.

    Il n'envoie donc AUCUN relevé, puisqu'il n'y a rien à mesurer. Sans ce
    drapeau, il se lit exactement comme une page dont la vidéo est cassée, ce
    qui est la question la plus fréquente devant un journal.
    """
    url, _rooms = served

    page = socketio.AsyncClient()
    await page.connect(
        url, socketio_path="/socket.io", auth={"visite": "cccc3333", "manette": True}
    )
    await asyncio.sleep(0.3)
    await page.disconnect()
    await asyncio.sleep(0.2)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]
    arrival = next(line for line in lines if line["quoi"] == "arrivée")

    assert arrival["manette"] is True


async def test_an_ordinary_page_carries_no_pad_only_mark(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """Le jumeau, et il porte sur la TAILLE autant que sur la vérité.

    Un `false` sur chaque ligne de chaque événement ferait trois cents
    kilo-octets par soirée pour dire « normal ».
    """
    url, _rooms = served

    page = socketio.AsyncClient()
    await page.connect(url, socketio_path="/socket.io", auth={"visite": "dddd4444"})
    await asyncio.sleep(0.3)
    await page.disconnect()
    await asyncio.sleep(0.2)

    written = sorted((tmp_path / "sessions").glob("*.jsonl"))[0]
    lines = [json.loads(line) for line in written.read_text(encoding="utf-8").splitlines()]
    arrival = next(
        line for line in lines if line["quoi"] == "arrivée" and line["visite"] == "dddd4444"
    )

    assert "manette" not in arrival


async def test_a_game_change_is_announced_to_everybody_else(
    served: tuple[str, RoomController],
) -> None:
    """Le changement de jeu prévient toute la salle, pas seulement l'auteur.

    Le défaut que ça corrige: seul celui qui cliquait voyait l'écran de
    chargement. Les autres regardaient dix secondes de noir sans savoir si la
    salle était cassée, parce que le worker qui aurait pu les prévenir est
    justement ce qui s'arrête.
    """
    url, _rooms = served
    told: list[dict] = []

    boss = socketio.AsyncClient()
    mine: list[dict] = []
    boss.on("booting", mine.append)
    await boss.connect(url, auth={"name": "Souhib"}, socketio_path="/socket.io")

    watcher = socketio.AsyncClient()
    watcher.on("booting", told.append)
    await watcher.connect(url, auth={"name": "Vincent"}, socketio_path="/socket.io")
    await asyncio.sleep(0.2)

    await boss.emit("booting", {"jeu": 0, "sauvegarde": 1})
    await asyncio.sleep(0.3)

    # Le NOM vient de la bibliothèque du serveur, pas de la page: une page
    # n'écrit pas le texte que les autres liront.
    assert told == [{"game": "Super Smash Bros Melee", "save": "tout débloqué", "saveSlot": 1}]
    # Et pas à l'auteur: sa page a déjà posé l'écran sans attendre le salon, et
    # le lui renvoyer remettrait son compteur d'images à zéro.
    assert mine == []

    await boss.disconnect()
    await watcher.disconnect()


async def test_the_worker_decides_who_may_warn_the_room(
    served: tuple[str, RoomController],
) -> None:
    """Celui que le WORKER laisse décider peut prévenir la salle, propriétaire ou non.

    Le cas exact qui a fait écrire ceci: le propriétaire élu est parti se
    coucher sans fermer son onglet, le worker rend donc la salle à qui la prend,
    et ce gestionnaire jetait quand même l'annonce parce qu'il tranchait sur SON
    propriétaire à lui. Celui qui cliquait voyait son écran de chargement, tous
    les autres dix secondes de noir.

    Le faux worker répond `yes` sans regarder la place: ce qui est vérifié ici
    est que la réponse du worker l'emporte sur l'élection du plan de contrôle,
    pas la règle des trois minutes, qui est vérifiée là où elle vit.
    """
    url, rooms = served
    told: list[dict] = []

    async def listener(stream: SocketStream) -> None:
        async with stream:
            await stream.receive(64)
            await stream.send(b"yes\n")

    async with await anyio.create_tcp_listener(local_host="127.0.0.1", local_port=0) as worker:
        port = worker.extra(SocketAttribute.local_address)[1]  # noqa: S610
        rooms.settings.worker_control = f"127.0.0.1:{port}"
        async with anyio.create_task_group() as group:
            group.start_soon(worker.serve, listener)

            # Des IDENTITÉS, et pas des pseudonymes: sans elles il n'y a pas de
            # propriétaire élu du tout, l'ancienne règle laisse tout passer, et
            # cet essai passerait sans rien prouver. Vérifié en remettant
            # l'ancien code: il devient rouge.
            boss = socketio.AsyncClient()
            await boss.connect(
                url,
                socketio_path="/socket.io",
                headers={
                    "Tailscale-User-Login": "souhib@example.com",
                    "Tailscale-User-Name": "Souhib",
                },
            )

            watcher = socketio.AsyncClient()
            watcher.on("booting", told.append)
            await watcher.connect(
                url,
                socketio_path="/socket.io",
                headers={
                    "Tailscale-User-Login": "vincent@example.com",
                    "Tailscale-User-Name": "Vincent",
                },
            )

            other = socketio.AsyncClient()
            await other.connect(
                url,
                socketio_path="/socket.io",
                headers={
                    "Tailscale-User-Login": "yannis@example.com",
                    "Tailscale-User-Name": "Yannis",
                },
            )
            await other.emit("seat", {"port": 2})
            await asyncio.sleep(0.3)

            await other.emit("booting", {"jeu": 0, "sauvegarde": 1})
            await asyncio.sleep(0.4)

            await boss.disconnect()
            await watcher.disconnect()
            await other.disconnect()
            group.cancel_scope.cancel()

    assert told == [{"game": "Super Smash Bros Melee", "save": "tout débloqué", "saveSlot": 1}]


async def test_a_worker_that_refuses_stops_the_announcement(
    served: tuple[str, RoomController],
) -> None:
    """Le jumeau, et il porte tout le contrôle.

    Sans lui, un gestionnaire qui relaierait TOUT passerait l'essai du dessus
    sans rien vérifier, et n'importe quelle page pourrait poser un écran de
    chargement sur celui des autres.
    """
    url, rooms = served
    told: list[dict] = []

    async def listener(stream: SocketStream) -> None:
        async with stream:
            await stream.receive(64)
            await stream.send(b"no\n")

    async with await anyio.create_tcp_listener(local_host="127.0.0.1", local_port=0) as worker:
        port = worker.extra(SocketAttribute.local_address)[1]  # noqa: S610
        rooms.settings.worker_control = f"127.0.0.1:{port}"
        async with anyio.create_task_group() as group:
            group.start_soon(worker.serve, listener)

            watcher = socketio.AsyncClient()
            watcher.on("booting", told.append)
            await watcher.connect(url, auth={"name": "Vincent"}, socketio_path="/socket.io")

            # Le propriétaire élu LUI-MÊME: le refus du worker l'emporte dans les
            # deux sens, sinon la règle ne serait qu'un assouplissement.
            boss = socketio.AsyncClient()
            await boss.connect(
                url,
                socketio_path="/socket.io",
                headers={
                    "Tailscale-User-Login": "souhib@example.com",
                    "Tailscale-User-Name": "Souhib",
                },
            )
            await boss.emit("seat", {"port": 1})
            await asyncio.sleep(0.3)

            await boss.emit("booting", {"jeu": 0, "sauvegarde": 1})
            await asyncio.sleep(0.4)

            await watcher.disconnect()
            await boss.disconnect()
            group.cancel_scope.cancel()

    assert told == []


async def test_an_announcement_naming_a_game_that_is_not_there_says_nothing(
    served: tuple[str, RoomController],
) -> None:
    """Le jumeau: un indice hors de la bibliothèque ne doit rien diffuser.

    Sans ce contrôle, il ne resterait rien entre une page et l'écran des autres:
    l'indice sert à CHOISIR dans une liste, et une liste où tout indice est
    valable n'est plus une liste.
    """
    url, _rooms = served
    told: list[dict] = []

    watcher = socketio.AsyncClient()
    watcher.on("booting", told.append)
    await watcher.connect(url, auth={"name": "Vincent"}, socketio_path="/socket.io")

    liar = socketio.AsyncClient()
    await liar.connect(url, auth={"name": "Souhib"}, socketio_path="/socket.io")
    await asyncio.sleep(0.2)

    for bad in (
        {"jeu": 7, "sauvegarde": 0},
        {"jeu": -1, "sauvegarde": 0},
        {"jeu": 0, "sauvegarde": 9},
    ):
        await liar.emit("booting", bad)
        await asyncio.sleep(0.6)

    assert told == []

    await liar.disconnect()
    await watcher.disconnect()


async def test_only_the_one_who_decides_can_announce(
    served: tuple[str, RoomController],
) -> None:
    """Qui ne décide pas du jeu ne peut pas non plus annoncer un changement.

    Sinon n'importe quelle page cacherait le jeu de toute la salle derrière un
    écran de chargement qui ne mène nulle part. La règle est celle de la salle,
    pas une deuxième inventée ici: le propriétaire, ou tout le monde quand il n'y
    a aucune identité.
    """
    url, _rooms = served
    told: list[dict] = []

    watcher = socketio.AsyncClient()
    watcher.on("booting", told.append)
    await watcher.connect(url, socketio_path="/socket.io")

    owner = socketio.AsyncClient()
    await owner.connect(
        url,
        socketio_path="/socket.io",
        headers={"Tailscale-User-Login": "souhib@example.com", "Tailscale-User-Name": "Souhib"},
    )
    other = socketio.AsyncClient()
    await other.connect(
        url,
        socketio_path="/socket.io",
        headers={"Tailscale-User-Login": "vincent@example.com", "Tailscale-User-Name": "Vincent"},
    )
    await asyncio.sleep(0.3)

    await other.emit("booting", {"jeu": 0, "sauvegarde": 0})
    await asyncio.sleep(0.4)
    assert told == [], "une page qui ne décide pas ne doit rien diffuser"

    # Le jumeau, dans la même vie de salle: le propriétaire, lui, passe. Sans
    # cette moitié, un gestionnaire qui refuserait TOUT satisferait le test.
    await owner.emit("booting", {"jeu": 0, "sauvegarde": 0})
    await asyncio.sleep(0.4)
    assert told == [{"game": "Super Smash Bros Melee", "save": "partie neuve", "saveSlot": 0}]

    await owner.disconnect()
    await other.disconnect()
    await watcher.disconnect()


def test_the_two_save_names_say_the_same_thing_on_both_sides() -> None:
    """Les libellés du salon et ceux de la page ne peuvent pas diverger.

    Ils existent en deux exemplaires, parce que le serveur refuse d'afficher un
    texte écrit par une page. Deux exemplaires qui divergent donneraient à celui
    qui lance et à ceux qui regardent deux versions du même écran, et rien ne le
    dirait: les deux écrans sont sur des machines différentes.
    """
    from nel3ab_control.api.ws.handlers import SAVES

    source = (Path(__file__).parents[3] / "front/src/lib/saves.ts").read_text(encoding="utf-8")
    for code, label in enumerate(SAVES):
        assert f'id: {code}, label: "{label}"' in source, f"la page ne nomme plus {code} ainsi"


async def test_only_the_holder_may_answer(served: tuple[str, RoomController]) -> None:
    """Celui qui demande ne peut pas répondre « oui » à sa propre demande.

    Le défaut du 5 septembre 2026: la réponse n'était pas rapprochée du
    porteur. N'importe quelle page pouvait envoyer « oui » et libérer la place
    de quelqu'un en train de jouer, ce qui est la prise que « demander au lieu
    de prendre » existe pour empêcher.
    """
    url, rooms = served
    answered: list[dict] = []

    holder = socketio.AsyncClient()
    await holder.connect(url, auth={"name": "Souhib"}, socketio_path="/socket.io")
    await holder.emit("seat", {"port": 2})
    await asyncio.sleep(0.2)

    asker = socketio.AsyncClient()
    asker.on("answered", answered.append)
    await asker.connect(url, auth={"name": "Vincent"}, socketio_path="/socket.io")
    await asker.emit("ask", {"port": 2})
    await asyncio.sleep(0.2)
    # Le demandeur se répond à lui-même.
    await asker.emit("answer", {"port": 2, "ok": True})
    await asyncio.sleep(0.3)

    assert answered == [], "personne ne doit recevoir de réponse"
    assert rooms.seats()[1].player == "Souhib", "la place n'a pas bougé"

    # Et la demande n'a pas été consommée par le faux « oui »: le vrai porteur
    # peut encore y répondre. Sans ce jumeau, un refus qui aurait quand même
    # effacé la demande passerait les deux assertions du dessus.
    await holder.emit("answer", {"port": 2, "ok": True})
    await asyncio.sleep(0.3)
    assert answered == [{"ok": True, "port": 2, "from": "Souhib"}]

    await holder.disconnect()
    await asker.disconnect()


async def test_a_foreign_origin_cannot_open_the_lobby(served: tuple[str, RoomController]) -> None:
    """Un site étranger ouvert dans le navigateur d'un membre ne parle pas à la salle.

    Le défaut du 5 septembre 2026: `cors_allowed_origins=[]` voulait dire « même
    origine seulement » dans le commentaire, et « aucun contrôle » pour la
    bibliothèque. Vérifié avec une origine forgée sur la vraie salle: poignée de
    main acceptée, et le service identifiait la session, par `whois` sur
    l'adresse du membre, comme le membre lui-même.
    """
    url, _rooms = served

    stranger = socketio.AsyncClient()
    with pytest.raises(SocketConnectionError):
        await stranger.connect(
            url,
            auth={"name": "Intrus"},
            socketio_path="/socket.io",
            headers={"Origin": "https://evil.example"},
        )

    # Le jumeau: l'origine de la page, elle, entre. Sans lui, un contrôle qui
    # refuserait tout passerait l'assertion du dessus et fermerait la salle.
    page = socketio.AsyncClient()
    await page.connect(
        url,
        auth={"name": "Souhib"},
        socketio_path="/socket.io",
        headers={"Origin": "https://nel3ab.app"},
    )
    assert page.connected
    await page.disconnect()


async def test_both_deployed_doors_share_names_but_foreign_origins_are_refused(
    served: tuple[str, RoomController],
) -> None:
    """Lit la valeur livrée à systemd, pas une liste recopiée dans le test."""
    from nel3ab_control.api.ws.server import allow_origins

    unit = Path(__file__).parents[3] / "deploy/nel3ab-control.service"
    lines = [line for line in unit.read_text().splitlines() if line.startswith("Environment=")]
    environment = dict(shlex.split(line.partition("=")[2])[0].split("=", 1) for line in lines)
    allow_origins(json.loads(environment["NEL3AB_ORIGINS"]))
    url, _rooms = served
    clients: list[socketio.AsyncClient] = []
    try:
        for origin in ["https://nel3ab.app", "https://lgf.tail3bd01c.ts.net:8443"]:
            page = socketio.AsyncClient()
            clients.append(page)
            await page.connect(url, auth={"name": "Ami"}, headers={"Origin": origin})
            assert page.connected
        for origin in ["https://evil.example", "https://lgf.tail3bd01c.ts.net:8444"]:
            stranger = socketio.AsyncClient()
            with pytest.raises(SocketConnectionError):
                await stranger.connect(url, headers={"Origin": origin})
            assert not stranger.connected
    finally:
        for page in clients:
            if page.connected:
                await page.disconnect()


async def test_collective_preparation_reaches_everyone_and_keeps_each_choice(
    served: tuple[str, RoomController],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Vrais clients et port de contrôle jetable ; aucun processus de la salle."""
    from nel3ab_control.api.ws import handlers

    url, rooms = served
    claims = ["a" * 32 + "-1", "a" * 32 + "-2", "-", "-"]
    launches: list[str] = []

    async def worker(stream: SocketStream) -> None:
        async with stream:
            line = b""
            while b"\n" not in line:
                line += await stream.receive(320)
            command = line.decode().strip()
            if command == "seats":
                await stream.send((" ".join(claims) + "\n").encode())
            elif command.startswith("decides"):
                await stream.send(b"yes\n" if command == "decides 1" else b"no\n")
            elif command.startswith("launch"):
                launches.append(command)
                # L'accusé peut arriver dans deux lectures TCP.
                await stream.send(b"o")
                await checkpoint()
                await stream.send(b"k\n")
            else:
                await stream.send(b"ok\n")

    async def catalog(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "current": 0,
                "roms": [
                    {"name": "Mario Kart Wii", "console": "wii", "art": False},
                ],
            },
        )

    # La cadence a ses essais propres. Celui-ci enchaîne des réponses acquittées
    # pour vérifier la préparation, sans attendre un délai arbitraire par clic.
    monkeypatch.setattr(handlers, "ROOM_EVERY", 0)
    async with httpx.AsyncClient(transport=httpx.MockTransport(catalog)) as client:
        monkeypatch.setattr(rooms, "_client", client)
        async with await anyio.create_tcp_listener(
            local_host="127.0.0.1", local_port=0
        ) as listener:
            port = listener.extra(SocketAttribute.local_address)[1]  # noqa: S610
            rooms.settings.worker_control = f"127.0.0.1:{port}"
            async with anyio.create_task_group() as group:
                group.start_soon(listener.serve, worker)
                players = [socketio.AsyncClient() for _ in range(3)]
                heard: asyncio.Queue[dict] = asyncio.Queue()
                booting: asyncio.Queue[dict] = asyncio.Queue()
                players[2].on("room", heard.put_nowait)
                players[2].on("booting", booting.put_nowait)
                try:
                    for player, name in zip(players, ["Souhib", "Yassine", "Vincent"], strict=True):
                        await player.connect(url, auth={"name": name})
                    for index, player in enumerate(players[:2]):
                        await player.call("seat", {"port": index + 1, "claim": claims[index]})
                    assert [s.player for s in rooms.seats()] == ["Souhib", "Yassine", None, None]
                    assert "error" in await players[1].call(
                        "preparation", {"action": "begin", "game": 0}
                    )
                    assert await players[0].call(
                        "preparation", {"action": "begin", "game": 0, "save": 1}
                    ) == {"ok": True}
                    assert rooms.preparation is not None
                    preparation_id = rooms.preparation.id
                    async with asyncio.timeout(3):
                        pushed = await heard.get()
                        while pushed.get("preparation") is None:
                            pushed = await heard.get()
                    assert [p["name"] for p in pushed["preparation"]["players"]] == [
                        "Souhib",
                        "Yassine",
                    ]

                    async def act(index: int, **action):
                        return await players[index].call(
                            "preparation", {"id": preparation_id, **action}
                        )

                    assert "error" in await act(2, action="choose", pad=0, ready=True)
                    assert "error" in await act(1, action="choose", pad=2, ready=True)
                    assert await act(0, action="choose", pad=0, ready=True) == {"ok": True}
                    assert "error" in await act(0, action="launch")
                    assert launches == []
                    assert await act(1, action="choose", pad=1, ready=True) == {"ok": True}
                    assert await act(0, action="launch") == {"ok": True}
                    # Le tiret final est l'identité de qui lance: vide ici, faute
                    # de proxy devant le salon, et le worker retombera donc sur
                    # la partie neuve.
                    assert launches == [f"launch 1 {claims[0]} 0 1 0 1 1 1 {' '.join(claims)} -"]
                    async with asyncio.timeout(3):
                        announcement = await booting.get()
                    assert announcement["pads"] == {claims[0]: 0, claims[1]: 1}
                    assert announcement["saveSlot"] == 1
                    assert rooms.preparation is None
                    assert "error" in await act(0, action="launch")
                finally:
                    for player in players:
                        await player.disconnect()
                    group.cancel_scope.cancel()


async def test_old_page_and_reconnection_do_not_become_false_spectators(served, monkeypatch):
    from itertools import count
    from unittest.mock import AsyncMock

    from nel3ab_control.api.controllers import rooms as module
    from nel3ab_control.api.ws import handlers

    url, rooms = served
    first, second = "a" * 32 + "-1", "a" * 32 + "-2"
    observed = [first, second, None, None]
    monkeypatch.setattr(module, "read_seats", AsyncMock(side_effect=lambda _: list(observed)))
    ticks = count(100)
    monkeypatch.setattr(handlers, "monotonic", lambda: float(next(ticks)))
    await rooms.synchronise()
    old, current, watcher = [socketio.AsyncClient() for _ in range(3)]
    heard: asyncio.Queue[dict] = asyncio.Queue()
    watcher.on("room", heard.put_nowait)

    async def pushed(predicate):
        async with asyncio.timeout(3):
            while True:
                room = await heard.get()
                if predicate(room):
                    return room

    try:
        for page, name in [(old, "Alice"), (current, "Benoit"), (watcher, "Camille")]:
            await page.connect(url, auth={"name": name})
        await watcher.call("seat", {"port": None, "claim": None})
        await old.call("seat", {"port": 1})
        await current.call("seat", {"port": 2, "claim": second})
        room = await pushed(lambda r: r["seats"][1]["player"] == "Benoit")
        assert room["seats"][0]["held"] is True
        assert room["seats"][0]["player"] is None
        persons = {p["name"]: p for p in room["people"]}
        assert persons["Alice"]["seat_pending"] is True
        assert persons["Camille"]["seat_pending"] is False
        assert persons["Camille"]["seat"] is None
        # Une page actualisée conserve son vrai port, sans déduire le nom de l'ordre d'arrivée.
        await old.call("seat", {"port": 1, "claim": first})
        room = await pushed(lambda r: r["seats"][0]["player"] == "Alice")
        assert [s["player"] for s in room["seats"]] == ["Alice", "Benoit", None, None]
        assert all(not p["seat_pending"] for p in room["people"])
        # Le salon seul redémarre : le repère de la manette reste le même.
        await current.disconnect()
        await current.connect(url, auth={"name": "Benoit"})
        await current.call("seat", {"port": 2, "claim": second})
        await pushed(lambda r: r["seats"][1]["player"] == "Benoit")
        observed[0] = None
        await old.call("seat", {"port": None, "claim": None})
        room = await pushed(
            lambda r: any(
                p["name"] == "Alice" and p["seat"] is None and not p["seat_pending"]
                for p in r["people"]
            )
        )
        assert room["seats"][0]["player"] is None
        assert room["seats"][1]["player"] == "Benoit"
    finally:
        for page in [old, current, watcher]:
            await page.disconnect()


async def test_une_preparation_s_ouvre_aussi_pour_un_jeu_gamecube(
    served: tuple[str, RoomController],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """La GameCube passe par la préparation depuis le 12 septembre 2026.

    Elle se lançait en deux pressions, sans passer par le salon, et seul le
    salon certifie QUI lance: « ta sauvegarde » retombait donc en silence sur la
    partie neuve pour ces jeux-là.

    Le jumeau est dans le même essai: un disque dont la console est inconnue
    reste dehors, parce qu'on ne sait pas quel appareil lui présenter.
    """
    from nel3ab_control.api.ws import handlers

    url, rooms = served
    claim = "b" * 32 + "-1"

    async def worker(stream: SocketStream) -> None:
        async with stream:
            line = b""
            while b"\n" not in line:
                line += await stream.receive(320)
            command = line.decode().strip()
            if command == "seats":
                await stream.send((" ".join([claim, "-", "-", "-"]) + "\n").encode())
            elif command.startswith("decides"):
                await stream.send(b"yes\n")
            else:
                await stream.send(b"ok\n")

    async def catalog(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "current": None,
                "roms": [
                    {"name": "Super Smash Bros Melee", "console": "gc", "art": False},
                    {"name": "Un disque muet", "art": False},
                ],
            },
        )

    monkeypatch.setattr(handlers, "ROOM_EVERY", 0)
    async with httpx.AsyncClient(transport=httpx.MockTransport(catalog)) as client:
        monkeypatch.setattr(rooms, "_client", client)
        async with await anyio.create_tcp_listener(
            local_host="127.0.0.1", local_port=0
        ) as listener:
            port = listener.extra(SocketAttribute.local_address)[1]  # noqa: S610
            rooms.settings.worker_control = f"127.0.0.1:{port}"
            async with anyio.create_task_group() as group:
                group.start_soon(listener.serve, worker)
                player = socketio.AsyncClient()
                await player.connect(url, auth={"name": "Souhib"}, socketio_path="/socket.io")
                await player.call("seat", {"port": 1, "claim": claim})

                ouvert = await player.call("preparation", {"action": "begin", "game": 0, "save": 2})
                assert ouvert == {"ok": True}
                assert rooms.preparation is not None

                rooms.preparation = None
                refuse = await player.call("preparation", {"action": "begin", "game": 1, "save": 0})
                assert "error" in refuse, "un disque sans console est entré en préparation"
                assert rooms.preparation is None

                await player.disconnect()
                group.cancel_scope.cancel()
