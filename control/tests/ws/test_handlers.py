"""Ce que le salon accepte de lire dans un message, avant d'en faire quoi que ce soit.

Ici plutôt qu'à travers une socket, parce que ce sont des fonctions pures: les
faire tourner par un vrai serveur ajouterait une seconde par cas et n'ajouterait
aucune information.
"""

import asyncio
import json
from collections.abc import Callable
from pathlib import Path

import pytest
import socketio

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.ws.handlers import (
    COMPLAINT_EVERY,
    ROOM_EVERY,
    VITALS_EVERY,
    _port,
    too_soon,
)
from tests.ws import test_lobby
from tests.ws.test_lobby import served

#: La fixture du salon sur un vrai port, importée de `test_lobby.py` pour que les
#: deux fichiers éprouvent le même montage. Nommée ici pour que pytest la voie.
__all__ = ["served"]


def test_a_port_is_one_of_the_four_seats() -> None:
    assert [_port({"port": n}) for n in (1, 2, 3, 4)] == [1, 2, 3, 4]
    # Une chaîne qui contient un nombre reste un nombre: ce qui arrive d'une
    # page traverse du JSON, et une page peut envoyer "2".
    assert _port({"port": "2"}) == 2


def test_anything_that_is_not_one_of_the_four_seats_is_nothing() -> None:
    """Le jumeau négatif, et il n'était tenu par rien jusqu'au 19 août 2026.

    J'ai supprimé la plage `1 <= port <= 4` et toute la suite est restée verte,
    alors que cette plage est la seule chose qui empêche une page de retenir une
    manette inventée.
    """
    for wrong in ({}, {"port": 0}, {"port": -1}, {"port": 5}, {"port": 2**40}):
        assert _port(wrong) is None, wrong
    # Et ce qui n'est pas un nombre du tout, ce qui levait une `TypeError`
    # quand `seat` appelait `int()` en direct.
    for wrong in ({"port": "trois"}, {"port": None}, {"port": {"a": 1}}, {"port": [1]}):
        assert _port(wrong) is None, wrong


def test_the_first_message_of_a_page_is_never_too_soon() -> None:
    """Une page qui vient d'arriver doit pouvoir parler tout de suite: c'est la
    fenêtre où les problèmes de liaison se voient le mieux."""
    assert too_soon(None, 1000.0, ROOM_EVERY) is False


def test_a_second_message_inside_the_gap_is_refused_and_after_it_is_not() -> None:
    assert too_soon(1000.0, 1000.0 + ROOM_EVERY / 2, ROOM_EVERY) is True
    assert too_soon(1000.0, 1000.0 + ROOM_EVERY, ROOM_EVERY) is False


def test_the_room_gap_is_shorter_than_the_measurement_gap() -> None:
    """Les deux ne protègent pas la même chose et ne doivent pas se confondre.

    Un geste de salle est humain et rare, mais on ne veut pas qu'attendre gêne
    quelqu'un qui prend une manette. Un relevé arrive tout seul six fois par
    minute, donc il peut attendre bien plus longtemps.
    """
    assert 0 < ROOM_EVERY < VITALS_EVERY


async def _derniere(heard: asyncio.Queue[dict], ok: Callable[[dict], bool]) -> dict:
    """La première diffusion qui vérifie `ok`, sous deux secondes."""
    async with asyncio.timeout(2):
        room = await heard.get()
        while not ok(room):
            room = await heard.get()
    return room


def _marque(room: dict, nom: str) -> bool | None:
    """La marque « au menu » de cette personne, ou rien si elle n'est pas encore là."""
    return next((p["au_menu"] for p in room["people"] if p["name"] == nom), None)


async def test_a_page_that_opens_its_menu_is_marked_for_the_others(
    served: tuple[str, RoomController],
) -> None:
    """D15: « au menu » sur la place de qui a ouvert son menu, puis plus rien."""
    url, _rooms = served
    heard: asyncio.Queue[dict] = asyncio.Queue()
    watcher, joueur = socketio.AsyncClient(), socketio.AsyncClient()
    watcher.on("room", heard.put_nowait)
    try:
        await watcher.connect(url, auth={"name": "Yassine"})
        await joueur.connect(url, auth={"name": "Souhib"})

        assert await joueur.call("menu", {"ouvert": True}, timeout=2) == {"ok": True}
        await _derniere(heard, lambda room: _marque(room, "Souhib") is True)
        assert await joueur.call("menu", {"ouvert": False}, timeout=2) == {"ok": True}
        room = await _derniere(heard, lambda room: _marque(room, "Souhib") is False)
        assert _marque(room, "Yassine") is False
    finally:
        await joueur.disconnect()
        await watcher.disconnect()


async def test_a_page_that_leaves_without_closing_its_menu_drops_the_mark(
    served: tuple[str, RoomController],
) -> None:
    """Le jumeau: la même personne reste sur un autre appareil, sans marque."""
    url, rooms = served
    heard: asyncio.Queue[dict] = asyncio.Queue()
    watcher, tel, pc = socketio.AsyncClient(), socketio.AsyncClient(), socketio.AsyncClient()
    watcher.on("room", heard.put_nowait)
    try:
        await watcher.connect(url, auth={"name": "Yassine"})
        await tel.connect(url, auth={"name": "Souhib"})
        await pc.connect(url, auth={"name": "Souhib"})
        await tel.call("menu", {"ouvert": True}, timeout=2)
        await _derniere(heard, lambda room: _marque(room, "Souhib") is True)

        await tel.disconnect()

        room = await _derniere(heard, lambda room: _marque(room, "Souhib") is False)
        assert [p["name"] for p in room["people"]].count("Souhib") == 1
        # Et la session partie ne reste pas dans l'ensemble: le calcul par
        # personne l'ignorerait, mais chaque page fermée menu ouvert y laisserait
        # une entrée pour la vie du salon.
        assert rooms._au_menu == set()
    finally:
        await pc.disconnect()
        await watcher.disconnect()


async def test_a_menu_message_that_is_not_a_boolean_is_refused(
    served: tuple[str, RoomController],
) -> None:
    """Le jumeau: « oui » n'est pas vrai, et rien n'est marqué."""
    url, rooms = served
    page = socketio.AsyncClient()
    try:
        await page.connect(url, auth={"name": "Souhib"})
        for faux in ({"ouvert": "oui"}, {"ouvert": 1}, {}):
            reponse = await page.call("menu", faux, timeout=2)
            assert reponse["ok"] is False, faux
            await asyncio.sleep(ROOM_EVERY)
        room = await rooms.describe(None)
        assert room.people == [] or not any(person.au_menu for person in room.people)
        assert rooms._au_menu == set()
    finally:
        await page.disconnect()


async def test_opening_then_closing_at_once_does_not_leave_the_mark(
    served: tuple[str, RoomController],
) -> None:
    """La cadence par mot: refermer dans la même demi-seconde passe."""
    url, rooms = served
    page = socketio.AsyncClient()
    try:
        await page.connect(url, auth={"name": "Souhib"})
        assert await page.call("menu", {"ouvert": True}, timeout=2) == {"ok": True}
        assert await page.call("menu", {"ouvert": False}, timeout=2) == {"ok": True}
        assert rooms._au_menu == set()
    finally:
        await page.disconnect()


def _lignes(dossier: Path, quoi: str) -> list[dict]:
    """Les lignes de cet événement dans le journal des séances d'essai."""
    lignes = []
    for fichier in sorted(dossier.glob("*.jsonl")):
        lignes += [json.loads(ligne) for ligne in fichier.read_text(encoding="utf-8").splitlines()]
    return [ligne for ligne in lignes if ligne["quoi"] == quoi]


async def test_a_complaint_says_what_it_is_about(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """D20: « l'image, le son, la manette ou autre chose », écrit au journal."""
    url, _rooms = served
    page = socketio.AsyncClient()
    try:
        await page.connect(url, auth={"name": "Souhib", "visite": "pppp1111"})
        assert await page.call("plainte_quoi", {"quoi": "son"}, timeout=2) == {"ok": True}
    finally:
        await page.disconnect()
    await asyncio.sleep(0.2)

    (ligne,) = _lignes(tmp_path / "sessions", "plainte_quoi")
    assert (ligne["motif"], ligne["visite"]) == ("son", "pppp1111")


async def test_a_complaint_word_the_page_invented_is_not_written(
    served: tuple[str, RoomController], tmp_path: Path
) -> None:
    """Le jumeau: une page ne choisit pas le texte du journal."""
    url, _rooms = served
    page = socketio.AsyncClient()
    try:
        await page.connect(url, auth={"name": "Souhib"})
        reponse = await page.call("plainte_quoi", {"quoi": "tout casser"}, timeout=2)
    finally:
        await page.disconnect()
    await asyncio.sleep(0.2)

    assert reponse["ok"] is False
    assert _lignes(tmp_path / "sessions", "plainte_quoi") == []


async def test_a_refusal_says_how_long_to_wait(served: tuple[str, RoomController]) -> None:
    """D20: « Déjà signalé, dans 19 s » plutôt que « plus tard »."""
    url, _rooms = served
    page = socketio.AsyncClient()
    try:
        await page.connect(url, auth={"name": "Souhib"})
        premiere = await page.call("plainte", {}, timeout=2)
        # Une seconde et demie d'écart: une attente qui ne décompte pas, toujours
        # vingt secondes, passerait un essai sans écart.
        await asyncio.sleep(1.5)
        seconde = await page.call("plainte", {}, timeout=2)
    finally:
        await page.disconnect()

    assert premiere["ok"] is True
    assert seconde["ok"] is False
    assert COMPLAINT_EVERY - 3 < seconde["reste_s"] <= COMPLAINT_EVERY - 1.5


async def test_an_accepted_message_carries_no_wait(served: tuple[str, RoomController]) -> None:
    """Le jumeau: un message accepté ne dit pas d'attendre."""
    url, _rooms = served
    page = socketio.AsyncClient()
    try:
        await page.connect(url, auth={"name": "Souhib"})
        reponse = await page.call("plainte", {}, timeout=2)
    finally:
        await page.disconnect()

    assert "reste_s" not in reponse


async def test_a_launch_announced_by_a_page_starts_the_startup_clock(
    served: tuple[str, RoomController], monkeypatch: pytest.MonkeyPatch
) -> None:
    """D05, par le câblage: le gestionnaire `booting` passe par `rooms.lance`, qui
    note le lancement au journal des parties ET démarre le chrono. Un appel direct
    à `rooms.tablee.lance`, comme avant, laisserait le chrono arrêté."""
    monkeypatch.setattr(
        test_lobby,
        "LIBRARY",
        {"current": None, "roms": [{"name": "Melee", "console": "gc", "key": "Melee.rvz"}]},
    )
    url, rooms = served
    page = socketio.AsyncClient()
    try:
        await page.connect(url, auth={"name": "Souhib"})
        await page.call("booting", {"jeu": 0, "sauvegarde": 0}, timeout=2)
    finally:
        await page.disconnect()

    attente = rooms.demarrages._attentes.get(1)
    assert attente is not None
    assert (attente.cle, attente.console) == ("Melee.rvz", "gc")
