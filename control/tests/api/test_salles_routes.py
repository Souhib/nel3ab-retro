"""Qui peut ouvrir et fermer une salle, par les vraies routes.

Le défaut relevé par l'audit du 20 novembre 2026: `DELETE /api/salles/{n}`
arrêtait le worker, donc la partie en cours, sans demander qui appelait, et
`POST /api/salles` allumait une salle pour n'importe qui. Fermer une salle est
une décision sur la partie des autres: elle revient au chef de CETTE salle, ou à
la personne qui tient la machine (`NEL3AB_ADMIN`).

Le systemd est celui de papier de `conftest.py`: ces essais lisent ce qu'on lui
a demandé, et aucune vraie salle ne s'allume ni ne s'éteint.
"""

import httpx
import pytest
from fastapi import FastAPI

from tests.conftest import SOUHIB, VINCENT
from tests.faux_systeme import FauxSysteme

YASSINE = {"Tailscale-User-Login": "yassine@example.com", "Tailscale-User-Name": "Yassine"}


def _ordres(systeme: FauxSysteme) -> list[list[str]]:
    """Ce qu'on a demandé à systemd d'allumer ou d'éteindre, sans les lectures."""
    return [c for c in systeme.commandes if "start" in c or "stop" in c]


@pytest.fixture
def salle_deux(app: FastAPI, systeme: FauxSysteme) -> None:
    """La salle 2 tourne, Yassine y est arrivé le premier, Vincent ensuite.

    Souhib n'y est pas: c'est l'administrateur des réglages d'essai, et il doit
    pouvoir la fermer sans y être.
    """
    systeme.allumees.add(2)
    app.state.people.arrived("sid-yassine", "yassine@example.com", "Yassine", 2)
    app.state.people.arrived("sid-vincent", "vincent@example.com", "Vincent", 2)


async def test_opening_a_room_needs_an_identity(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    answer = await client.post("/api/salles")

    assert answer.status_code == 401
    assert _ordres(systeme) == []


async def test_anybody_identified_may_open_a_free_room(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Le jumeau: ouvrir un emplacement libre ne décide rien de la partie de
    quelqu'un d'autre, donc toute identité suffit."""
    answer = await client.post("/api/salles", headers=VINCENT)

    assert answer.status_code == 201
    assert _ordres(systeme) == [["sudo", "-n", "systemctl", "start", "nel3ab-worker@1"]]


@pytest.mark.usefixtures("salle_deux")
async def test_closing_a_room_needs_an_identity(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    answer = await client.delete("/api/salles/2")

    assert answer.status_code == 401
    assert _ordres(systeme) == []
    assert 2 in systeme.allumees


@pytest.mark.usefixtures("salle_deux")
async def test_somebody_who_is_not_the_chief_cannot_close_the_room(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Vincent est dans la salle, mais il n'en est pas le chef."""
    answer = await client.delete("/api/salles/2", headers=VINCENT)

    assert answer.status_code == 403
    assert _ordres(systeme) == []
    assert 2 in systeme.allumees


@pytest.mark.usefixtures("salle_deux")
async def test_the_chief_of_another_room_cannot_close_this_one(
    app: FastAPI, client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Être chef quelque part ne donne rien ailleurs."""
    systeme.allumees.add(1)
    app.state.people.arrived("sid-camille", "camille@example.com", "Camille", 1)

    answer = await client.delete(
        "/api/salles/2",
        headers={"Tailscale-User-Login": "camille@example.com", "Tailscale-User-Name": "Camille"},
    )

    assert answer.status_code == 403
    assert _ordres(systeme) == []


@pytest.mark.usefixtures("salle_deux")
async def test_the_chief_of_the_room_may_close_it(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Le jumeau qui compte: sans lui, une route qui refuserait tout passerait
    les trois essais du dessus."""
    answer = await client.delete("/api/salles/2", headers=YASSINE)

    assert answer.status_code == 200
    assert _ordres(systeme) == [["sudo", "-n", "systemctl", "stop", "nel3ab-worker@2"]]


@pytest.mark.usefixtures("salle_deux")
async def test_the_admin_may_close_a_room_without_being_in_it(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    answer = await client.delete("/api/salles/2", headers=SOUHIB)

    assert answer.status_code == 200
    assert _ordres(systeme) == [["sudo", "-n", "systemctl", "stop", "nel3ab-worker@2"]]


async def test_an_empty_room_is_closed_by_the_admin_only(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Une salle où personne n'est connecté n'a pas de chef.

    Elle se ferme d'elle-même après une demi-heure. Avant, la fermer demande
    l'administrateur: sinon quiconque pourrait éteindre une salle dont le chef
    vient de recharger sa page.
    """
    systeme.allumees.add(3)

    refused = await client.delete("/api/salles/3", headers=VINCENT)
    assert refused.status_code == 403
    assert _ordres(systeme) == []

    closed = await client.delete("/api/salles/3", headers=SOUHIB)
    assert closed.status_code == 200
    assert 3 not in systeme.allumees


async def test_a_room_that_does_not_exist_is_still_unknown_to_the_admin(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    assert (await client.delete("/api/salles/9", headers=SOUHIB)).status_code == 404
    assert _ordres(systeme) == []
