"""« Première fois dans cette salle », du journal des parties jusqu'à chaque page.

Contre un vrai serveur: les pages reçoivent l'état de la salle par la socket,
comme dans la salle. Le drapeau doit être le même pour toutes les pages, sans
qu'aucune adresse ne parte avec lui.
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
from fastapi import FastAPI

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.app import create_app
from nel3ab_control.parties import Parties
from nel3ab_control.settings import Settings

LIBRARY = {
    "current": 0,
    "roms": [
        {"name": "Super Smash Bros Melee", "key": "Super Smash Bros Melee.rvz", "console": "gc"}
    ],
}

ALICE = {"Tailscale-User-Login": "alice@example.com", "Tailscale-User-Name": "Alice"}
BENOIT = {"Tailscale-User-Login": "benoit@example.com", "Tailscale-User-Name": "Benoit"}


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.fixture
async def served(tmp_path: Path) -> AsyncIterator[tuple[str, FastAPI]]:
    def worker(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=LIBRARY)

    settings = Settings(
        worker_url="http://worker.test",
        state_file=tmp_path / "people.json",
        journal_dir=tmp_path / "sessions",
        salles_dir=tmp_path / "salles",
        parties_dir=tmp_path / "parties",
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
        app.state.salons.poser(
            numero, RoomController(settings, app.state.client, numero, app.state.parties)
        )
    yield f"http://127.0.0.1:{port}", app
    server.should_exit = True
    await task


async def _page(
    url: str, who: dict[str, str], heard: list[dict], **auth: object
) -> socketio.AsyncClient:
    page = socketio.AsyncClient()
    page.on("room", heard.append)
    await page.connect(url, auth={"salle": 2, **auth}, headers=who)
    await asyncio.sleep(0.2)
    return page


async def _assis(page: socketio.AsyncClient, port: int) -> None:
    await page.emit("seat", {"port": port})
    await asyncio.sleep(0.3)


async def test_chaque_page_recoit_la_meme_premiere_fois_puis_un_retour(
    served: tuple[str, FastAPI],
) -> None:
    url, app = served
    vu_par_alice: list[dict] = []
    vu_par_benoit: list[dict] = []
    alice = await _page(url, ALICE, vu_par_alice)
    benoit = await _page(url, BENOIT, vu_par_benoit)
    try:
        await _assis(alice, 1)
        assert vu_par_alice[-1]["seats"][0]["premiere"] is True
        assert vu_par_benoit[-1]["seats"][0]["premiere"] is True
        await alice.disconnect()
        await asyncio.sleep(0.3)
        assert vu_par_benoit[-1]["seats"][0]["premiere"] is None

        revenue: list[dict] = []
        alice = await _page(url, ALICE, revenue)
        await _assis(alice, 1)
        # Le jumeau: la même personne revient, ce n'est plus une première.
        assert revenue[-1]["seats"][0]["premiere"] is False
        assert vu_par_benoit[-1]["seats"][0]["premiere"] is False
        # Et quelqu'un d'autre, la première fois, l'est.
        await _assis(benoit, 2)
        assert vu_par_benoit[-1]["seats"][1]["premiere"] is True

        tout = json.dumps(vu_par_alice + vu_par_benoit + revenue)
        assert "@" not in tout, "une adresse est partie avec l'état de la salle"
    finally:
        await alice.disconnect()
        await benoit.disconnect()

    parties: Parties = app.state.parties
    lignes = parties.lire("alice@example.com")
    assert [ligne["quoi"] for ligne in lignes] == [
        "place_debut",
        "place_fin",
        "place_debut",
        "place_fin",
    ]
    assert {ligne["salle"] for ligne in lignes} == {2}
    assert lignes[0]["jeu"]["cle"] == "Super Smash Bros Melee.rvz"
    assert lignes[1]["raison"] == "deconnectee"


async def test_sans_identite_ou_depuis_un_banc_le_salon_ne_sait_pas(
    served: tuple[str, FastAPI], tmp_path: Path
) -> None:
    """Le jumeau: rien, et pas faux. La page retombe alors sur sa propre mémoire."""
    url, app = served
    vu: list[dict] = []
    anonyme = await _page(url, {}, vu, name="quelqu'un")
    banc = await _page(url, ALICE, [], banc=True)
    try:
        await _assis(anonyme, 3)
        await _assis(banc, 4)
        assert vu[-1]["seats"][2]["player"] == "quelqu'un"
        assert vu[-1]["seats"][2]["premiere"] is None
        assert vu[-1]["seats"][3]["player"] == "Alice"
        assert vu[-1]["seats"][3]["premiere"] is None
    finally:
        await anonyme.disconnect()
        await banc.disconnect()
    assert app.state.parties.lire("alice@example.com") == []
    assert not (tmp_path / "parties").exists()
