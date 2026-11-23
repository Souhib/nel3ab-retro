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
    systeme.demarrer(2)
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
    systeme.demarrer(1)
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
    systeme.demarrer(3)

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


@pytest.mark.usefixtures("salle_deux")
async def test_closing_a_room_ends_its_seats_in_the_play_journal(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    """Fermer la salle termine les places qu'elle tenait, avec leur raison.

    Le jumeau d'abord: une fermeture refusée ne termine la partie de personne.
    """
    rooms = app.state.salons.pour(2)
    rooms.claim(1, "sid-yassine", "Yassine", login="yassine@example.com")
    refus = await client.delete("/api/salles/2", headers=VINCENT)
    assert refus.status_code == 403
    assert [ligne["quoi"] for ligne in app.state.parties.lire("yassine@example.com")] == [
        "place_debut"
    ]

    assert (await client.delete("/api/salles/2", headers=YASSINE)).status_code == 200
    lignes = app.state.parties.lire("yassine@example.com")
    assert [(ligne["quoi"], ligne.get("raison")) for ligne in lignes] == [
        ("place_debut", None),
        ("place_fin", "salle_fermee"),
    ]


async def _salle(client: httpx.AsyncClient, numero: int) -> dict:
    reponse = await client.get("/api/salles")
    assert reponse.status_code == 200
    return next(salle for salle in reponse.json() if salle["numero"] == numero)


@pytest.mark.usefixtures("salle_deux")
async def test_the_list_names_the_chief_of_each_room(client: httpx.AsyncClient) -> None:
    """D01: l'accueil dit qui choisit le jeu, le premier arrivé identifié."""
    assert (await _salle(client, 2))["chef"] == "Yassine"


async def test_a_closed_room_has_no_chief(app: FastAPI, client: httpx.AsyncClient) -> None:
    """Le jumeau: même si le registre traînait, une salle fermée n'a pas de chef."""
    app.state.people.arrived("sid-yassine", "yassine@example.com", "Yassine", 3)

    assert (await _salle(client, 3))["chef"] is None


async def test_a_room_of_anonymous_pages_has_no_chief(
    app: FastAPI, client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Sans identité, tenir une manette suffit: personne n'est « chef »."""
    systeme.demarrer(2)
    app.state.people.arrived("sid-a", None, "Ami", 2)
    app.state.people.arrived("sid-b", None, "Bo", 2)

    salle = await _salle(client, 2)

    assert salle["chef"] is None
    assert sorted(salle["gens"]) == ["Ami", "Bo"]


async def test_the_list_says_who_holds_which_pad_and_who_watches(
    app: FastAPI, client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """D02: Nour tient la manette 1, mémé regarde. Aucune question de plus au
    worker: le contrôleur de la salle garde ce qu'il sait déjà."""
    systeme.demarrer(2)
    people, rooms = app.state.people, app.state.salons.pour(2)
    people.arrived("sid-nour", "nour@example.com", "Nour", 2)
    people.arrived("sid-meme", "meme@example.com", "mémé", 2)
    rooms.claim(1, "sid-nour", "Nour", login="nour@example.com")
    rooms.watch("sid-meme")

    salle = await _salle(client, 2)

    assert salle["sieges"][0] == {"port": 1, "nom": "Nour", "tenu": None}
    assert [siege["nom"] for siege in salle["sieges"][1:]] == [None, None, None]
    assert salle["regardent"] == ["mémé"]
    assert "nour@example.com" not in str(salle) and "meme@example.com" not in str(salle)


async def test_somebody_still_waiting_for_a_pad_is_not_a_spectator(
    app: FastAPI, client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Le jumeau: arriver sans encore avoir de manette n'est pas regarder."""
    systeme.demarrer(2)
    app.state.people.arrived("sid-lu", "lu@example.com", "Lu", 2)

    assert (await _salle(client, 2))["regardent"] == []


async def test_one_person_on_two_devices_watches_once(
    app: FastAPI, client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    systeme.demarrer(2)
    people, rooms = app.state.people, app.state.salons.pour(2)
    for sid in ("sid-tel", "sid-pc"):
        people.arrived(sid, "lu@example.com", "Lu", 2)
        rooms.watch(sid)

    assert (await _salle(client, 2))["regardent"] == ["Lu"]


async def test_an_anonymous_spectator_is_somebody_not_an_address(
    app: FastAPI, client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    systeme.demarrer(2)
    app.state.people.arrived("sid-x", None, "", 2)
    app.state.salons.pour(2).watch("sid-x")

    assert (await _salle(client, 2))["regardent"] == ["quelqu'un"]


async def test_a_closed_room_has_no_seats_and_nobody_watching(client: httpx.AsyncClient) -> None:
    salle = await _salle(client, 3)

    assert (salle["sieges"], salle["regardent"]) == ([], [])


async def test_an_open_room_nobody_follows_does_not_guess_its_seats(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Personne de connecté: le salon ne lit plus ses places, et une lecture
    vieille de plusieurs minutes dirait des manettes tenues qui ne le sont plus."""
    systeme.demarrer(2)

    assert (await _salle(client, 2))["sieges"] is None


async def test_a_named_room_is_opened_and_not_another(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """D17: « Ouvrir la salle 3 » ouvre la 3, même quand la 1 est libre."""
    answer = await client.post("/api/salles", headers=VINCENT, json={"numero": 3})

    assert answer.status_code == 201
    assert answer.json()["numero"] == 3
    assert _ordres(systeme) == [["sudo", "-n", "systemctl", "start", "nel3ab-worker@3"]]


async def test_a_named_room_that_is_open_or_restarting_is_refused(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Le jumeau: une salle ouverte, ou que systemd relance, n'est pas libre, et
    la demande n'ouvre pas une autre salle à la place."""
    systeme.demarrer(1)
    systeme.unite(2).etat = "activating"
    avant = _ordres(systeme)

    ouverte = await client.post("/api/salles", headers=VINCENT, json={"numero": 1})
    relancee = await client.post("/api/salles", headers=VINCENT, json={"numero": 2})

    assert (ouverte.status_code, relancee.status_code) == (409, 409)
    assert _ordres(systeme) == avant


async def test_a_room_that_does_not_exist_cannot_be_opened(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    assert (
        await client.post("/api/salles", headers=VINCENT, json={"numero": 7})
    ).status_code == 404
    assert (
        await client.post("/api/salles", headers=VINCENT, json={"numero": 0})
    ).status_code == 422
    assert _ordres(systeme) == []


async def test_without_a_body_the_first_free_room_opens_as_before(
    client: httpx.AsyncClient, systeme: FauxSysteme
) -> None:
    """Le jumeau sans corps: la page d'avant ouvre encore une salle."""
    systeme.demarrer(1)

    answer = await client.post("/api/salles", headers=VINCENT)

    assert answer.status_code == 201
    assert answer.json()["numero"] == 2
