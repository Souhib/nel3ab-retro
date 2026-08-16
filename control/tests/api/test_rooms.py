"""The room a page reads, and the pads it claims."""

import httpx
import pytest

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.schemas.error import SeatTaken, WorkerUnreachable
from nel3ab_control.settings import Settings


async def test_the_room_reports_the_game_the_worker_is_running(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/room")

    assert response.status_code == 200
    room = response.json()
    assert room["name"] == "Salon d'essai"
    assert room["game"] == {"index": 1, "name": "Super Smash Bros Melee"}
    assert [game["name"] for game in room["library"]] == [
        "Mario Kart Double Dash",
        "Super Smash Bros Melee",
    ]


async def test_every_pad_is_listed_even_when_nobody_holds_it(client: httpx.AsyncClient) -> None:
    """A page draws four seats whether or not anybody sits in them."""
    room = (await client.get("/api/room")).json()

    assert [seat["port"] for seat in room["seats"]] == [1, 2, 3, 4]
    assert all(seat["player"] is None for seat in room["seats"])


async def test_a_claimed_pad_carries_the_name(client: httpx.AsyncClient) -> None:
    await client.post("/api/room/seats/2", json={"name": "Souhib"})

    room = (await client.get("/api/room")).json()
    assert room["seats"][1] == {"port": 2, "player": "Souhib"}


async def test_a_pad_somebody_else_claims_is_refused(client: httpx.AsyncClient) -> None:
    await client.post("/api/room/seats/1", json={"name": "Souhib"})

    response = await client.post("/api/room/seats/1", json={"name": "Yassine"})

    assert response.status_code == 409
    room = (await client.get("/api/room")).json()
    assert room["seats"][0]["player"] == "Souhib", "the refusal must not have moved anything"


async def test_claiming_your_own_pad_again_is_not_a_conflict(client: httpx.AsyncClient) -> None:
    """A page that reconnects says the same thing again, and being told no would
    lock a player out of the seat they are sitting in."""
    await client.post("/api/room/seats/3", json={"name": "Souhib"})

    response = await client.post("/api/room/seats/3", json={"name": "Souhib"})

    assert response.status_code == 204


async def test_leaving_gives_back_every_pad_that_player_held() -> None:
    settings = Settings(worker_url="http://worker.test")
    rooms = RoomController(settings, httpx.AsyncClient())
    rooms.claim(1, "Souhib")
    rooms.claim(2, "Souhib")
    rooms.claim(3, "Yassine")

    rooms.release("Souhib")

    assert [seat.player for seat in rooms.seats()] == [None, None, "Yassine", None]


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
    rooms.claim(2, "Souhib")

    with pytest.raises(SeatTaken) as raised:
        rooms.claim(2, "Yassine")

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
