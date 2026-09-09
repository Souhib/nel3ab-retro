"""Les noms suivent l'attribution du worker, même sous des annonces retardées."""

import pytest

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.schemas.error import SeatTaken

OLD = "a" * 32 + "-1"
NEW = "a" * 32 + "-2"
RESTARTED = "b" * 32 + "-1"


def test_a_reconnected_session_replaces_the_old_name(rooms: RoomController) -> None:
    rooms.observe_seats([OLD, None, None, None])
    rooms.claim(1, "old", "Souhib", OLD)
    rooms.observe_seats([NEW, None, None, None])
    assert rooms.seats()[0].player is None
    rooms.claim(1, "new", "Yassine", NEW)
    rooms.release("old")
    assert rooms.seats()[0].player == "Yassine"
    assert rooms.seats()[0].claim == NEW


def test_a_late_announcement_cannot_swap_names(rooms: RoomController) -> None:
    rooms.observe_seats([NEW, OLD, None, None])
    rooms.claim(1, "new", "Yassine", NEW)
    rooms.claim(2, "old", "Souhib", OLD)
    with pytest.raises(SeatTaken):
        rooms.claim(1, "old", "Souhib", OLD)
    assert [s.player for s in rooms.seats()] == ["Yassine", "Souhib", None, None]


def test_a_worker_restart_does_not_reuse_a_name(rooms: RoomController) -> None:
    rooms.observe_seats([OLD, None, None, None])
    rooms.claim(1, "old", "Souhib", OLD)
    rooms.observe_seats([RESTARTED, None, None, None])
    assert rooms.seat_of("old") is None
    with pytest.raises(SeatTaken):
        rooms.claim(1, "old", "Souhib", OLD)


def test_an_unchanged_assignment_keeps_the_name(rooms: RoomController) -> None:
    rooms.observe_seats([OLD, None, None, None])
    rooms.claim(1, "old", "Souhib", OLD)
    assert rooms.observe_seats([OLD, None, None, None]) is False
    assert rooms.seats()[0].player == "Souhib"
    assert rooms.announced("old", 1, OLD)
    assert not rooms.announced("old", 1, NEW)


def test_a_spectator_releases_only_their_own_assignment(rooms: RoomController) -> None:
    rooms.observe_seats([OLD, NEW, None, None])
    rooms.claim(1, "one", "Souhib", OLD)
    rooms.claim(2, "two", "Yassine", NEW)
    rooms.observe_seats([None, NEW, None, None])
    assert rooms.seats()[0].held is False
    assert rooms.seats()[0].player is None
    assert rooms.seats()[1].player == "Yassine"


def test_a_public_receipt_does_not_replace_another_present_session(rooms: RoomController) -> None:
    rooms.observe_seats([OLD, None, None, None])
    rooms.claim(1, "one", "Souhib", OLD)
    with pytest.raises(SeatTaken):
        rooms.claim(1, "two", "Yassine", OLD)
    assert rooms.seats()[0].player == "Souhib"


async def test_a_missing_worker_reply_does_not_mean_four_free_pads(rooms, monkeypatch) -> None:
    from unittest.mock import AsyncMock

    from nel3ab_control.api.controllers import rooms as module

    rooms.observe_seats([OLD, None, None, None])
    rooms.claim(1, "one", "Souhib", OLD)
    monkeypatch.setattr(module, "read_seats", AsyncMock(return_value=None))
    assert await rooms.synchronise() is False
    assert rooms.seats()[0].player == "Souhib"
    assert rooms.seats()[0].held is True
    monkeypatch.setattr(module, "read_seats", AsyncMock(return_value=[None] * 4))
    assert await rooms.synchronise() is True
    assert rooms.seats()[0].player is None
    assert rooms.seats()[0].held is False


async def test_a_person_without_a_confirmed_seat_is_not_a_spectator(rooms, settings) -> None:
    from nel3ab_control.api.controllers.people import PeopleController

    people = PeopleController(settings.state_file)
    people.arrived("one", "alice", "Alice")
    rooms.observe_seats([OLD, None, None, None])
    with pytest.raises(SeatTaken):
        rooms.claim(1, "one", "Alice")  # Une page ancienne ne connaît pas le repère.
    room = await rooms.describe(people)
    assert room.people[0].model_dump().get("seat_pending") is True
    assert room.seats[0].player is None  # Ne pas inventer l'association manquante.
    rooms.claim(1, "one", "Alice", OLD)
    room = await rooms.describe(people)
    assert room.people[0].seat == 1
    assert room.people[0].model_dump().get("seat_pending") is False
    rooms.observe_seats([NEW, None, None, None])
    room = await rooms.describe(people)
    assert room.people[0].seat is None
    assert room.people[0].model_dump().get("seat_pending") is True
    assert rooms.watch("one") is True
    assert rooms.watch("one") is False
    room = await rooms.describe(people)
    assert room.people[0].seat is None
    assert room.people[0].model_dump().get("seat_pending") is False
    with pytest.raises(SeatTaken):
        rooms.claim(1, "one", "Alice", OLD)
    assert (await rooms.describe(people)).people[0].model_dump().get("seat_pending") is True
    rooms.release("one")
    assert not rooms.announced("one", None, None)


async def test_a_spectator_tab_cannot_hide_the_same_person_playing(rooms, settings) -> None:
    from nel3ab_control.api.controllers.people import PeopleController

    people = PeopleController(settings.state_file)
    people.arrived("pad", "alice", "Alice")
    people.arrived("screen", "alice", "Alice")
    rooms.observe_seats([OLD, None, None, None])
    rooms.claim(1, "pad", "Alice", OLD)
    rooms.watch("screen")
    person = (await rooms.describe(people)).people[0]
    assert person.seat == 1
    assert person.seat_pending is False
    rooms.observe_seats([NEW, None, None, None])
    person = (await rooms.describe(people)).people[0]
    assert person.seat is None
    assert person.seat_pending is True
