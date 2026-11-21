"""Deux salles ouvertes en même temps, contre un vrai serveur.

Le salon tient les présents de toutes les salles ensemble, et chaque salle a son
contrôleur. L'audit du 20 novembre 2026 a relevé des chemins qui retombaient sur
la salle 1 sans le dire: le chef retenu était une seule valeur pour toutes les
salles, et la reprise du rôle de chef prenait toujours le contrôleur de la
salle 1. Ces essais ouvrent des pages dans deux salles avec des gens différents.
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

ALICE = {"Tailscale-User-Login": "alice@example.com", "Tailscale-User-Name": "Alice"}
BENOIT = {"Tailscale-User-Login": "benoit@example.com", "Tailscale-User-Name": "Benoit"}
CAMILLE = {"Tailscale-User-Login": "camille@example.com", "Tailscale-User-Name": "Camille"}


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.fixture
async def served(tmp_path: Path) -> AsyncIterator[str]:
    """Un salon sur un vrai port, et TROIS salles sur le même faux worker.

    Les trois sont posées dans le registre avant la première page. Sinon le
    registre fabriquerait pour la salle 2 un contrôleur pointé sur les vrais
    ports de la salle 2, puisqu'il les déduit du numéro.
    """

    def worker(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=LIBRARY)

    settings = Settings(
        worker_url="http://worker.test",
        state_file=tmp_path / "people.json",
        journal_dir=tmp_path / "sessions",
        salles_dir=tmp_path / "salles",
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
    assert server.started, "le salon d'essai n'a pas démarré"
    app.state.client = httpx.AsyncClient(transport=httpx.MockTransport(worker))
    for numero in (1, 2, 3):
        app.state.salons.poser(numero, RoomController(settings, app.state.client, numero))
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    await task


async def _page(
    url: str, salle: int, who: dict[str, str], heard: dict[str, list[dict]]
) -> socketio.AsyncClient:
    """Une page de cette salle, qui retient ce qu'elle reçoit, événement par événement."""
    page = socketio.AsyncClient()
    for event in ("room", "recovery"):
        page.on(event, lambda data, event=event: heard.setdefault(event, []).append(data))
    await page.connect(url, auth={"salle": salle}, headers=who)
    await asyncio.sleep(0.2)
    return page


async def test_a_chief_recovery_asked_in_room_two_never_reaches_room_one(served: str) -> None:
    """La reprise prenait le contrôleur et le chef de la salle 1, quelle que soit
    la page qui la demandait.

    L'ordre d'arrivée est la condition de l'essai: la page de la salle 1 arrive
    EN DERNIER, pour que le chef retenu en commun soit le sien au moment où
    Camille demande. Dans l'autre ordre, le chef commun aurait été Benoît, et
    l'essai serait vert sans correctif.
    """
    alice: dict[str, list[dict]] = {}
    benoit: dict[str, list[dict]] = {}
    camille: dict[str, list[dict]] = {}
    pages = [
        await _page(served, 2, BENOIT, benoit),
        await _page(served, 2, CAMILLE, camille),
        await _page(served, 1, ALICE, alice),
    ]
    try:
        asked = await pages[1].call("recover", {"action": "begin", "port": None}, timeout=2)
        await asyncio.sleep(0.3)

        assert asked["ok"] is True, asked
        assert alice.get("recovery") is None, "la salle 1 a reçu une demande de la salle 2"
        # Le jumeau: la demande arrive bien à quelqu'un, et c'est au chef de
        # la salle 2. Une reprise qui n'atteindrait personne passerait la ligne
        # du dessus.
        told = benoit.get("recovery") or []
        assert [notice["to"] for notice in told] == ["Benoit"], told
        assert [notice["asking"] for notice in camille.get("recovery") or []] == [True]
    finally:
        for page in pages:
            await page.disconnect()


async def test_each_room_announces_its_own_chief(served: str) -> None:
    """Deux chefs en même temps, un par salle, et chacun reste le sien.

    Le chef retenu était une seule valeur: décrire la salle 2 le remplaçait
    par le premier présent de la salle 2, puis décrire la salle 1 le remplaçait
    à nouveau. Ici, chaque page entend le chef de SA salle.
    """
    alice: dict[str, list[dict]] = {}
    benoit: dict[str, list[dict]] = {}
    pages = [await _page(served, 1, ALICE, alice), await _page(served, 2, BENOIT, benoit)]
    try:
        assert alice["room"][-1]["owner"]["name"] == "Alice"
        assert [person["name"] for person in alice["room"][-1]["people"]] == ["Alice"]
        assert benoit["room"][-1]["owner"]["name"] == "Benoit"
        assert [person["name"] for person in benoit["room"][-1]["people"]] == ["Benoit"]
    finally:
        for page in pages:
            await page.disconnect()
