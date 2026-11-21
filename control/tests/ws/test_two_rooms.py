"""Deux salles ouvertes en même temps, contre un vrai serveur.

Le salon tient les présents de toutes les salles ensemble, et chaque salle a son
contrôleur. L'audit du 20 novembre 2026 a relevé des chemins qui retombaient sur
la salle 1 sans le dire: le chef retenu était une seule valeur pour toutes les
salles, et la reprise du rôle de chef prenait toujours le contrôleur de la
salle 1. Ces essais ouvrent des pages dans deux salles avec des gens différents.
"""

import asyncio
import json
import re
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


#: Ce qui ressemble à une adresse de courriel, où que ce soit dans un message.
COURRIEL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")


async def test_no_address_is_broadcast_to_the_pages(served: str) -> None:
    """L'état de la salle portait l'adresse de chaque présent, et du chef.

    Cet état part vers toutes les pages de la salle, invités partagés compris.
    Une adresse de connexion est souvent un courriel: c'était le carnet
    d'adresses de la soirée, envoyé à chacun. Relevé par l'audit du 20 novembre
    2026. Toute la charge est relue, pas seulement les champs connus: un champ
    ajouté demain qui la recopierait serait vu aussi.
    """
    benoit: dict[str, list[dict]] = {}
    camille: dict[str, list[dict]] = {}
    pages = [await _page(served, 2, BENOIT, benoit), await _page(served, 2, CAMILLE, camille)]
    try:
        for heard in (benoit, camille):
            said = json.dumps(heard["room"], ensure_ascii=False)
            assert COURRIEL.search(said) is None, COURRIEL.search(said)
        # Le jumeau: la salle dit toujours QUI est là, par le pseudo.
        last = camille["room"][-1]
        assert [person["name"] for person in last["people"]] == ["Benoit", "Camille"]
        assert last["owner"]["name"] == "Benoit"
    finally:
        for page in pages:
            await page.disconnect()


async def test_each_page_is_told_which_person_it_is(served: str) -> None:
    """`moi` est calculé pour CHAQUE page qui reçoit l'état.

    La page reconnaissait le chef et sa propre ligne en comparant les
    adresses. Sans adresse, il lui faut ce booléen, et il ne peut pas être le
    même pour tout le monde: chacun doit se voir, lui seul.
    """
    benoit: dict[str, list[dict]] = {}
    camille: dict[str, list[dict]] = {}
    anonyme: dict[str, list[dict]] = {}
    pages = [
        await _page(served, 2, BENOIT, benoit),
        await _page(served, 2, CAMILLE, camille),
        await _page(served, 2, {}, anonyme),
    ]
    try:
        seen = {
            "benoit": benoit["room"][-1],
            "camille": camille["room"][-1],
            "anonyme": anonyme["room"][-1],
        }
        assert [len(room["people"]) for room in seen.values()] == [3, 3, 3]
        moi = {who: [p.get("moi") for p in room["people"]] for who, room in seen.items()}
        assert moi == {
            "benoit": [True, False, False],
            "camille": [False, True, False],
            # Sans identité, personne n'est « moi »: même pas un anonyme qui
            # porterait le même pseudo.
            "anonyme": [False, False, False],
        }
        assert [room["owner"].get("moi") for room in seen.values()] == [True, False, False]
    finally:
        for page in pages:
            await page.disconnect()


async def test_the_same_person_has_the_same_mark_everywhere(served: str) -> None:
    """Le repère est stable: deux appareils de Benoît, deux salles, une seule
    marque. Deux personnes différentes n'ont pas la même. C'est ce qui permet à
    la page de reconnaître le chef dans la liste sans connaître son adresse."""
    one: dict[str, list[dict]] = {}
    two: dict[str, list[dict]] = {}
    pages = [
        await _page(served, 1, BENOIT, one),
        await _page(served, 2, BENOIT, two),
        await _page(served, 2, CAMILLE, two),
    ]
    try:
        benoit_one = one["room"][-1]["people"][0]
        benoit_two, camille = two["room"][-1]["people"]
        assert re.fullmatch(r"[0-9a-f]{16}", benoit_one.get("id") or ""), benoit_one
        assert benoit_one["id"] == benoit_two["id"]
        assert camille["id"] != benoit_two["id"]
        assert two["room"][-1]["owner"]["id"] == benoit_two["id"]
    finally:
        for page in pages:
            await page.disconnect()
