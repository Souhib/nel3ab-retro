"""Ce que les réponses publiques disent des gens: un pseudo et un repère, jamais l'adresse.

L'audit du 20 novembre 2026 a relevé que `GET /api/room` rendait l'adresse de
connexion de chaque présent, à qui le demandait. Ces essais relisent la réponse
ENTIÈRE, pas seulement les champs connus.
"""

import hashlib
import json
import re
import stat
from pathlib import Path

import httpx
from fastapi import FastAPI

from nel3ab_control.api.controllers.people import PeopleController
from tests.conftest import SOUHIB, VINCENT

COURRIEL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")


def _arrive(app: FastAPI) -> None:
    """Souhib arrive le premier dans la salle 1, Vincent ensuite."""
    app.state.people.arrived("sid-souhib", "souhib@example.com", "Souhib", 1)
    app.state.people.arrived("sid-vincent", "vincent@example.com", "Vincent", 1)


async def test_reading_the_room_shows_no_address(client: httpx.AsyncClient, app: FastAPI) -> None:
    _arrive(app)

    for who in ({}, SOUHIB, VINCENT):
        said = (await client.get("/api/room", headers=who)).text
        assert COURRIEL.search(said) is None, (who, COURRIEL.search(said))
    # Le jumeau: la réponse dit toujours qui est là, et qui est le chef.
    room = (await client.get("/api/room")).json()
    assert [person["name"] for person in room["people"]] == ["Souhib", "Vincent"]
    assert room["owner"]["name"] == "Souhib"


async def test_reading_the_room_says_who_is_asking(client: httpx.AsyncClient, app: FastAPI) -> None:
    """`moi` dépend de qui demande, et de lui seul."""
    _arrive(app)

    seen = {
        name: (await client.get("/api/room", headers=who)).json()
        for name, who in (("souhib", SOUHIB), ("vincent", VINCENT), ("personne", {}))
    }

    assert {name: [p.get("moi") for p in room["people"]] for name, room in seen.items()} == {
        "souhib": [True, False],
        "vincent": [False, True],
        "personne": [False, False],
    }
    assert {name: room["owner"].get("moi") for name, room in seen.items()} == {
        "souhib": True,
        "vincent": False,
        "personne": False,
    }


async def test_the_list_of_rooms_shows_no_address_even_without_a_name(
    client: httpx.AsyncClient, app: FastAPI, systeme
) -> None:
    """La liste du salon retombait sur l'adresse quand le pseudo était vide.

    Le cas ne se produit pas par une page aujourd'hui, mais la ligne existait,
    et une adresse est souvent un courriel.
    """
    systeme.allumees.add(2)
    app.state.people.arrived("sid-sans-nom", "sans.nom@example.com", "", 2)
    app.state.people.arrived("sid-vincent", "vincent@example.com", "Vincent", 2)

    said = (await client.get("/api/salles")).text

    assert COURRIEL.search(said) is None, COURRIEL.search(said)
    gens = next(salle["gens"] for salle in json.loads(said) if salle["numero"] == 2)
    assert "Vincent" in gens


def test_the_mark_is_stable_across_a_restart(tmp_path: Path) -> None:
    """Le secret est gardé à côté des pseudos: un salon relancé donne les mêmes
    repères, donc une page ouverte avant le redémarrage reconnaît encore les
    siens."""
    before = PeopleController(tmp_path / "people.json").repere("souhib@example.com")
    after = PeopleController(tmp_path / "people.json").repere("souhib@example.com")

    assert before is not None
    assert re.fullmatch(r"[0-9a-f]{16}", before)
    assert after == before


def test_the_mark_cannot_be_recomputed_from_the_address(tmp_path: Path) -> None:
    """Le jumeau: un repère tiré de l'adresse seule se recalculerait.

    Quiconque devine une adresse vérifierait alors si elle est dans la salle.
    Le secret de la machine change tout: deux salons ne donnent pas le même
    repère, et le repère n'est pas l'empreinte de l'adresse.
    """
    one = PeopleController(tmp_path / "un" / "people.json").repere("souhib@example.com")
    two = PeopleController(tmp_path / "deux" / "people.json").repere("souhib@example.com")

    assert one != two
    assert one != hashlib.sha256(b"souhib@example.com").hexdigest()[:16]
    assert PeopleController(tmp_path / "un" / "people.json").repere(None) is None


def test_the_secret_lives_beside_the_names_and_only_its_owner_reads_it(tmp_path: Path) -> None:
    store = tmp_path / "etat" / "people.json"

    PeopleController(store).repere("souhib@example.com")

    secret = store.parent / "reperes.secret"
    assert secret.is_file()
    assert stat.S_IMODE(secret.stat().st_mode) == 0o600
    assert len(bytes.fromhex(secret.read_text(encoding="ascii"))) == 32


def test_a_damaged_secret_is_replaced_rather_than_trusted(tmp_path: Path) -> None:
    """Un secret tronqué par une coupure ne doit ni casser la salle, ni devenir
    une clé courte. Il est remplacé, et les repères changent une fois."""
    store = tmp_path / "people.json"
    (tmp_path / "reperes.secret").write_text("abc", encoding="ascii")

    mark = PeopleController(store).repere("souhib@example.com")

    assert mark is not None
    assert len(bytes.fromhex((tmp_path / "reperes.secret").read_text(encoding="ascii"))) == 32
    assert PeopleController(store).repere("souhib@example.com") == mark


def test_nobody_is_given_a_secret_they_do_not_need(tmp_path: Path) -> None:
    """Le secret naît au premier repère demandé, pas à la construction: un
    contrôleur qui ne décrit personne n'écrit rien sur le disque."""
    PeopleController(tmp_path / "people.json")

    assert not (tmp_path / "reperes.secret").exists()
