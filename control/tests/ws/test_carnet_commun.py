"""Le carnet commun (D12), de la socket jusqu'au carnet de chacun.

Contre un vrai serveur et deux identités: Alice tient une place, Benoît
regarde puis prend la place 2. Chacun lit ensuite SON carnet. Le chemin est
celui du salon: l'annonce « aucune manette » ouvre le regard, la place le
ferme, et la liste des parties relit les deux fichiers.
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
from nel3ab_control.personnes import empreinte
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


async def _page(url: str, who: dict[str, str]) -> socketio.AsyncClient:
    page = socketio.AsyncClient()
    await page.connect(url, auth={"salle": 2}, headers=who)
    await asyncio.sleep(0.2)
    return page


async def _seat(page: socketio.AsyncClient, port: int | None) -> None:
    """Une annonce de place. Plus d'une demi-seconde après la précédente:
    `seat` en ignore une seconde plus rapprochée (`ROOM_EVERY`)."""
    await page.emit("seat", {"port": port})
    await asyncio.sleep(0.6)


async def _parties(url: str, who: dict[str, str]) -> list[dict]:
    async with httpx.AsyncClient(base_url=url) as client:
        reponse = await client.get("/api/me/parties", headers=who)
    assert reponse.status_code == 200, reponse.text
    return reponse.json()["parties"]


async def test_qui_regarde_puis_joue_est_dans_le_carnet_de_l_autre_et_reciproquement(
    served: tuple[str, FastAPI],
) -> None:
    url, app = served
    alice = await _page(url, ALICE)
    benoit = await _page(url, BENOIT)
    try:
        await _assis(alice, benoit)
        # Pendant le regard: Alice voit Benoît regarder, sans place.
        (partie,) = await _parties(url, ALICE)
        assert partie["en_cours"] is True
        assert (partie["avec"], partie["regardaient"]) == ([], ["Benoit"])
        # Benoît prend la place 2: il joue avec Alice, et elle avec lui.
        await _seat(benoit, 2)
        (partie,) = await _parties(url, ALICE)
        assert partie["avec"] == [{"nom": "Benoit", "place": 2}]
        (sienne,) = await _parties(url, BENOIT)
        assert sienne["avec"] == [{"nom": "Alice", "place": 1}]
    finally:
        await alice.disconnect()
        await benoit.disconnect()
    await asyncio.sleep(0.3)
    lignes = app.state.parties.lire("benoit@example.com")
    assert [ligne["quoi"] for ligne in lignes] == [
        "regard_debut",
        "regard_fin",
        "place_debut",
        "place_fin",
    ]
    tout = json.dumps(await _parties(url, ALICE))
    assert "@" not in tout and empreinte("benoit@example.com") not in tout


async def _assis(alice: socketio.AsyncClient, benoit: socketio.AsyncClient) -> None:
    await _seat(alice, 1)
    await _seat(benoit, None)


async def test_une_page_de_banc_qui_regarde_n_apparait_dans_aucun_carnet(
    served: tuple[str, FastAPI],
) -> None:
    """Le jumeau: mes pilotes regardent sous ma propre identité."""
    url, app = served
    alice = await _page(url, ALICE)
    banc = socketio.AsyncClient()
    await banc.connect(url, auth={"salle": 2, "banc": True}, headers=BENOIT)
    await asyncio.sleep(0.2)
    try:
        await _seat(alice, 1)
        await _seat(banc, None)
        (partie,) = await _parties(url, ALICE)
        assert partie["regardaient"] == []
    finally:
        await alice.disconnect()
        await banc.disconnect()
    assert app.state.parties.lire("benoit@example.com") == []
