"""Le délai seul ne permet ni de changer de cible ni de répondre pour elle."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.ws import recovery
from nel3ab_control.journal import Journal
from nel3ab_control.settings import Settings


@pytest.fixture
async def room(tmp_path, monkeypatch):
    settings = Settings(state_file=tmp_path / "people.json", journal_dir=tmp_path / "journal")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"roms": ["Melee"], "current": 0})
        )
    ) as client:
        rooms = RoomController(settings, client)
        people = PeopleController(settings.state_file)
        journal = Journal(settings.journal_dir, settings.journal_days, settings.journal_zone)
        sessions = {
            "lu": {"login": "lu", "name": "Lu"},
            "lu-phone": {"login": "lu", "name": "Lu"},
            "souhib": {"login": "souhib", "name": "Souhib"},
            "other": {"login": "other", "name": "Camille"},
        }
        for sid, person in sessions.items():
            people.arrived(sid, person["login"], person["name"])
        clock = [100.0]
        receipt = "a" * 32 + "-1"
        observed = [None, receipt, None, None]
        rooms.observe_seats(observed)
        rooms.claim(2, "lu", "Lu", receipt)
        monkeypatch.setattr(recovery, "monotonic", lambda: clock[0])
        monkeypatch.setattr(recovery, "_state", lambda _: (rooms, people, journal))
        monkeypatch.setattr(recovery.sio, "get_environ", lambda _: {})

        async def save(sid, value):
            sessions[sid] = value

        monkeypatch.setattr(recovery.sio, "save_session", save)
        monkeypatch.setattr(
            recovery.sio, "get_session", AsyncMock(side_effect=lambda sid: sessions[sid])
        )
        emit = AsyncMock()
        monkeypatch.setattr(recovery.sio, "emit", emit)
        monkeypatch.setattr(recovery, "read_seats", AsyncMock(side_effect=lambda _: list(observed)))
        broadcast = AsyncMock()
        monkeypatch.setattr(recovery, "broadcast", broadcast)
        yield SimpleNamespace(
            rooms=rooms,
            people=people,
            clock=clock,
            observed=observed,
            sessions=sessions,
            emit=emit,
            broadcast=broadcast,
        )
        journal.close()


async def begin(room, port=None):
    answer = await recovery.recover("souhib", {"action": "begin", "port": port})
    assert answer["ok"], answer
    request = room.rooms.recovery
    assert request is not None
    return request.id


async def test_a_silent_spectator_does_not_keep_the_crown_forever(room):
    request = await begin(room)
    targets = [call.kwargs["to"] for call in room.emit.await_args_list]
    assert targets == ["souhib", "lu", "lu-phone"]
    answer = await recovery.recover("souhib", {"action": "finish", "id": request})
    assert not answer["ok"]
    assert room.people.owner() == ("lu", "Lu")
    room.clock[0] += 20
    answer = await recovery.recover("souhib", {"action": "finish", "id": request})
    assert answer["ok"]
    assert room.people.owner() == ("souhib", "Souhib")
    assert room.rooms.told_owner == -1
    room.broadcast.assert_awaited_once()


@pytest.mark.parametrize("action", ["answer", "finish", "cancel"])
async def test_another_person_cannot_answer_confirm_or_cancel(room, action):
    request = await begin(room)
    room.clock[0] += 20
    answer = await recovery.recover("other", {"action": action, "id": request, "ok": True})
    assert not answer["ok"]
    assert room.people.owner() == ("lu", "Lu")
    assert room.rooms.recovery is not None
    assert not room.rooms.recovery.accepted


async def test_another_device_of_the_chief_can_refuse_and_is_not_spammed(room):
    request = await begin(room)
    answer = await recovery.recover("lu-phone", {"action": "answer", "id": request, "ok": False})
    assert answer["ok"]
    room.clock[0] += 20
    assert not (await recovery.recover("souhib", {"action": "finish", "id": request}))["ok"]
    assert not (await recovery.recover("souhib", {"action": "begin"}))["ok"]
    assert room.people.owner() == ("lu", "Lu")
    room.clock[0] += 40
    assert (await recovery.recover("souhib", {"action": "begin"}))["ok"]


async def test_a_granted_request_can_be_confirmed_immediately(room):
    request = await begin(room)
    assert (await recovery.recover("lu", {"action": "answer", "id": request, "ok": True}))["ok"]
    assert room.people.owner() == ("lu", "Lu")
    assert (await recovery.recover("souhib", {"action": "finish", "id": request}))["ok"]
    assert room.people.owner() == ("souhib", "Souhib")


@pytest.mark.parametrize("change", ["left", "owner", "expired"])
async def test_a_request_does_not_outlive_its_people_or_deadline(room, change):
    request = await begin(room)
    if change == "left":
        room.people.left("souhib")
    elif change == "owner":
        assert room.people.transfer_owner("lu", "other")
    else:
        room.clock[0] += 60
    await recovery.expire(room.rooms, room.people)
    assert room.rooms.recovery is None
    assert not (await recovery.recover("souhib", {"action": "finish", "id": request}))["ok"]
    assert room.people.owner() != ("souhib", "Souhib")


async def test_one_request_cannot_replace_another(room):
    request = await begin(room)
    assert not (await recovery.recover("other", {"action": "begin"}))["ok"]
    assert room.rooms.recovery is not None
    assert room.rooms.recovery.id == request


async def test_refusing_a_pad_does_not_erase_the_chiefs_refusal(room):
    request = await begin(room)
    assert (await recovery.recover("lu", {"action": "answer", "id": request, "ok": False}))["ok"]
    room.clock[0] += 1
    assert (await recovery.recover("other", {"action": "begin", "port": 2}))["ok"]
    pending = room.rooms.recovery
    assert pending is not None
    assert (await recovery.recover("lu", {"action": "answer", "id": pending.id, "ok": False}))["ok"]
    answer = await recovery.recover("souhib", {"action": "begin"})
    assert not answer["ok"]
    assert "minute" in answer["error"]


async def test_repeated_begin_cancel_cannot_notify_at_unlimited_speed(room):
    request = await begin(room)
    assert (await recovery.recover("souhib", {"action": "cancel", "id": request}))["ok"]
    answer = await recovery.recover("souhib", {"action": "begin"})
    assert not answer["ok"]
    assert "instant" in answer["error"]
    room.clock[0] += 0.5
    assert (await recovery.recover("souhib", {"action": "begin"}))["ok"]


async def test_the_pad_recovery_returns_the_exact_attribution_without_renaming_it(room):
    request = await begin(room, 2)
    room.clock[0] += 20
    answer = await recovery.recover("souhib", {"action": "finish", "id": request})
    assert answer == {"ok": True, "port": 2, "claim": room.observed[1]}
    # Seule la nouvelle socket worker pourra remplacer ce nom.
    assert room.rooms.seats()[1].player == "Lu"
    assert room.people.owner() == ("lu", "Lu")


@pytest.mark.parametrize("changed", [None, "b" * 32 + "-2"])
async def test_a_late_reply_cannot_take_a_different_pad_occupant(room, changed):
    request = await begin(room, 2)
    room.clock[0] += 20
    room.observed[1] = changed
    answer = await recovery.recover("souhib", {"action": "finish", "id": request})
    assert not answer["ok"]
    assert "changé" in answer["error"]
    assert room.rooms.seats()[1].player is None


async def test_a_request_does_not_guess_when_the_worker_cannot_answer(room, monkeypatch):
    request = await begin(room, 2)
    room.clock[0] += 20
    monkeypatch.setattr(recovery, "read_seats", AsyncMock(return_value=None))
    assert not (await recovery.recover("souhib", {"action": "finish", "id": request}))["ok"]
    assert room.rooms.seats()[1].player == "Lu"


@pytest.mark.parametrize(
    "payload",
    [None, [], "owner", {"action": "begin", "port": True}, {"action": "begin", "port": 0}],
)
async def test_invalid_payloads_cannot_start_a_request(room, payload):
    assert not (await recovery.recover("souhib", payload))["ok"]
    assert room.rooms.recovery is None
