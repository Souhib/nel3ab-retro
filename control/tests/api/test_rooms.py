"""The room a page reads, and the pads it claims."""

import httpx
import pytest

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.schemas.error import NoSuchSeat, SeatTaken, WorkerUnreachable
from nel3ab_control.settings import Settings
from tests.conftest import LIBRARY


async def test_the_room_reports_the_game_the_worker_is_running(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/room")

    assert response.status_code == 200
    room = response.json()
    assert room["name"] == "Salon d'essai"
    assert room["game"] == {
        "index": 1,
        "name": "Super Smash Bros Melee",
        "maker": "Nintendo/HAL Laboratory,Inc.",
        "about": "Let the melee begin!",
        "art": True,
    }
    assert [game["name"] for game in room["library"]] == [
        "Mario Kart Double Dash",
        "Super Smash Bros Melee",
    ]


async def test_every_pad_is_listed_even_when_nobody_holds_it(client: httpx.AsyncClient) -> None:
    """A page draws four seats whether or not anybody sits in them."""
    room = (await client.get("/api/room")).json()

    assert [seat["port"] for seat in room["seats"]] == [1, 2, 3, 4]
    assert all(seat["player"] is None for seat in room["seats"])


async def test_a_claimed_pad_carries_the_name(
    client: httpx.AsyncClient, rooms: RoomController
) -> None:
    rooms.claim(2, "sid-souhib", "Souhib")

    room = (await client.get("/api/room")).json()
    assert room["seats"][1] == {"port": 2, "player": "Souhib"}


async def test_a_pad_another_session_claims_is_refused(
    client: httpx.AsyncClient, rooms: RoomController
) -> None:
    rooms.claim(1, "sid-souhib", "Souhib")

    with pytest.raises(SeatTaken):
        rooms.claim(1, "sid-yassine", "Yassine")

    room = (await client.get("/api/room")).json()
    assert room["seats"][0]["player"] == "Souhib", "le refus ne doit rien avoir déplacé"


async def test_claiming_your_own_pad_again_is_not_a_conflict(rooms: RoomController) -> None:
    """Une page qui se reconnecte redit la même chose, et lui répondre non
    l'enfermerait dehors de la place où elle est assise."""
    rooms.claim(3, "sid-souhib", "Souhib")

    rooms.claim(3, "sid-souhib", "Souhib")

    assert rooms.seat_of("sid-souhib") == 3


async def test_leaving_gives_back_only_that_session_s_pads() -> None:
    """Le coeur du modèle: une place appartient à une SESSION, pas à un nom.

    La même personne peut ouvrir la salle sur deux appareils. Avec des places
    rangées par nom, fermer un onglet libérait la manette de l'autre machine, et
    la salle affichait quelqu'un comme parti alors qu'il jouait encore.
    """
    settings = Settings(worker_url="http://worker.test")
    rooms = RoomController(settings, httpx.AsyncClient())
    rooms.claim(1, "portable", "Souhib")
    rooms.claim(2, "bureau", "Souhib")
    rooms.claim(3, "sid-yassine", "Yassine")

    rooms.release("portable")

    assert [seat.player for seat in rooms.seats()] == [None, "Souhib", "Yassine", None]


async def test_a_worker_that_does_not_answer_says_so() -> None:
    """A room that cannot be described says why, rather than reporting an empty
    library that reads as "you own no games"."""

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nobody there")

    settings = Settings(worker_url="http://worker.test")
    rooms = RoomController(settings, httpx.AsyncClient(transport=httpx.MockTransport(refuse)))

    with pytest.raises(WorkerUnreachable) as raised:
        await rooms.library()

    assert raised.value.status_code == 503
    assert "worker.test" in raised.value.detail


async def test_a_seat_conflict_names_the_pad() -> None:
    """The error a page shows has to say WHICH pad, or the player cannot act on it."""
    settings = Settings()
    rooms = RoomController(settings, httpx.AsyncClient())
    rooms.claim(2, "sid-souhib", "Souhib")

    with pytest.raises(SeatTaken) as raised:
        rooms.claim(2, "sid-yassine", "Yassine")

    assert "2" in raised.value.detail


async def test_the_room_lists_everybody_not_only_the_pads(client: httpx.AsyncClient) -> None:
    """Une salle où quelqu'un regarde sans manette avait l'air vide.

    Les places ne disent que ceux qui jouent. La liste des présents dit aussi les
    spectateurs, ce qui est la moitié d'une soirée à quatre manettes.
    """
    room = (await client.get("/api/room")).json()

    # Personne n'est connecté au salon dans ce test: la liste est vide et les
    # places existent quand même. C'est la distinction qui compte.
    assert room["people"] == []
    assert len(room["seats"]) == 4


async def test_a_room_without_identities_has_no_owner(client: httpx.AsyncClient) -> None:
    """Sans proxy devant, tout le monde est anonyme et personne ne décide.

    C'est le développement local et les pilotes de navigateur. La salle retombe
    alors sur sa règle d'avant, où tenir une manette suffit à changer de jeu:
    refuser tout serait une salle où personne ne peut plus rien.
    """
    room = (await client.get("/api/room")).json()

    assert room["owner"] is None


async def test_a_worker_that_goes_away_does_not_take_the_lobby_with_it(
    settings: Settings, worker: httpx.MockTransport
) -> None:
    """Changer de jeu REDÉMARRE le worker, et toutes les pages se reconnectent
    pendant ce redémarrage.

    Sans ce repli, chaque connexion et chaque départ faisait échouer la diffusion
    du salon: la salle ne disait plus qui était là, et le journal se remplissait
    de traces pour un worker qui revenait cinq secondes plus tard.
    """
    alive = {"ok": True}

    def flaky(request: httpx.Request) -> httpx.Response:
        if not alive["ok"]:
            raise httpx.ConnectError("le worker redémarre")
        return httpx.Response(200, json=LIBRARY)

    async with httpx.AsyncClient(transport=httpx.MockTransport(flaky)) as http:
        rooms = RoomController(settings, http)
        first = await rooms.describe()
        assert first.game is not None

        alive["ok"] = False
        during = await rooms.describe()
        assert [game.name for game in during.library] == [game.name for game in first.library]


async def test_a_worker_that_was_never_there_is_an_error(
    settings: Settings,
) -> None:
    """Le jumeau négatif: une salle qui n'a JAMAIS su quels jeux elle a n'est pas
    une salle qui a perdu le contact, et se taire là cacherait une panne."""

    def dead(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("aucun worker")

    async with httpx.AsyncClient(transport=httpx.MockTransport(dead)) as http:
        with pytest.raises(WorkerUnreachable):
            await RoomController(settings, http).describe()


def test_an_unanswered_request_expires(rooms: RoomController) -> None:
    """Un « oui » tapé cinq minutes plus tard téléporterait une manette au
    milieu d'une partie, et celui qui avait demandé aurait oublié la question."""
    rooms.asked(2, "sid-vincent", now=100.0)

    assert rooms.take_ask(2, now=109.0) == "sid-vincent"

    rooms.asked(2, "sid-vincent", now=100.0)
    assert rooms.take_ask(2, now=111.0) is None


def test_an_expired_request_is_forgotten_not_kept(rooms: RoomController) -> None:
    """Le jumeau négatif: une demande expirée ne doit pas rester à traîner et
    répondre plus tard à la question suivante."""
    rooms.asked(3, "sid-vincent", now=100.0)
    assert rooms.take_ask(3, now=200.0) is None

    assert rooms.take_ask(3, now=200.0) is None


async def test_a_worker_that_still_lists_plain_names_is_understood(
    settings: Settings,
) -> None:
    """Le worker et ce service redémarrent séparément.

    Pendant les quelques secondes où l'un est neuf et l'autre pas, la salle doit
    continuer à répondre. Un nom seul est ce que le worker disait avant
    d'apprendre à lire les jaquettes.
    """

    def old_worker(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"players": 4, "current": 0, "roms": ["Melee"]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(old_worker)) as http:
        library, running = await RoomController(settings, http).library()

    assert [game.name for game in library] == ["Melee"]
    assert running is not None
    assert running.art is False, "sans jaquette plutôt qu'avec une qui n'existe pas"


def test_a_seat_that_does_not_exist_cannot_be_claimed(settings: Settings) -> None:
    """Le dictionnaire des places n'accepte que des places.

    Sans ce refus, `claim(2**40, ...)` marchait: la salle retenait une place que
    personne ne peut voir ni libérer, et une page pouvait en créer autant qu'elle
    voulait. Une définition de « une place existe » vit ici, parce que c'est ici
    que les places sont retenues.
    """
    rooms = RoomController(settings, httpx.AsyncClient())

    for absurd in (0, -1, 5, 999999, 2**40):
        with pytest.raises(NoSuchSeat):
            rooms.claim(absurd, "sid-souhib", "Souhib")

    assert all(seat.player is None for seat in rooms.seats())


def test_the_four_real_seats_are_still_claimable(settings: Settings) -> None:
    """Le jumeau. Une borne qui refuserait tout satisferait le test au-dessus."""
    rooms = RoomController(settings, httpx.AsyncClient())

    for port in (1, 2, 3, 4):
        rooms.claim(port, f"sid-{port}", f"joueur {port}")

    assert [seat.player for seat in rooms.seats()] == [
        "joueur 1",
        "joueur 2",
        "joueur 3",
        "joueur 4",
    ]
