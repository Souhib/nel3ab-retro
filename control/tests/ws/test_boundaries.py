"""Les entrées du salon ne doivent ni casser sa lecture ni laisser de fantôme.

Les contrôleurs et les gestionnaires sont réels. Seule la livraison Socket.IO
est remplacée ici, pour imposer l'échec exactement après l'ajout d'une présence.
Le fichier test_lobby éprouve aussi ces gardes à travers une vraie connexion.
"""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from socketio.exceptions import ConnectionRefusedError as Refused

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.schemas.error import WorkerUnreachable
from nel3ab_control.api.schemas.player import NAME_MAX
from nel3ab_control.api.ws import handlers
from nel3ab_control.journal import Journal
from nel3ab_control.settings import Settings


@pytest.fixture
async def lobby(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    settings = Settings(state_file=tmp_path / "people.json", journal_dir=tmp_path / "journal")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"roms": ["Melee"], "current": 0})
        )
    ) as client:
        rooms = RoomController(settings, client)
        people = PeopleController(settings.state_file)
        journal = Journal(settings.journal_dir, settings.journal_days, settings.journal_zone)
        session: dict = {}

        async def save(_sid: str, value: dict) -> None:
            session.clear()
            session.update(value)

        # Le second argument est la salle. Ce double l'accepte et l'ignore: ces
        # essais montent une seule salle, et la variante à un argument aurait
        # laissé croire que le numéro ne circule pas.
        monkeypatch.setattr(handlers, "_state", lambda _environ, _salle=1: (rooms, people, journal))
        monkeypatch.setattr(handlers, "caller_of", AsyncMock(return_value=None))
        monkeypatch.setattr(handlers.sio, "save_session", save)
        monkeypatch.setattr(
            handlers.sio, "get_session", AsyncMock(side_effect=lambda _: dict(session))
        )
        monkeypatch.setattr(handlers.sio, "get_environ", lambda _: {"asgi.scope": {}})
        monkeypatch.setattr(handlers.sio, "enter_room", AsyncMock())
        leave = AsyncMock()
        monkeypatch.setattr(handlers.sio, "leave_room", leave)
        emit = AsyncMock()
        monkeypatch.setattr(handlers.sio, "emit", emit)
        yield SimpleNamespace(rooms=rooms, people=people, session=session, leave=leave, emit=emit)
        journal.close()


@pytest.mark.parametrize(
    "auth",
    [
        "x",
        [1],
        {"name": {}},
        {"name": [1]},
        {"name": 42},
        {"name": " "},
        {"name": "x" * (NAME_MAX + 1)},
    ],
)
async def test_an_invalid_name_is_refused_before_it_enters_the_room(lobby, auth: object) -> None:
    with pytest.raises(Refused):
        await handlers.connect("bad", {"asgi.scope": {}}, auth)
    assert lobby.people.live() == set()
    assert lobby.people.sessions() == {}


@pytest.mark.parametrize(
    "auth, expected",
    [
        (None, "quelqu'un"),
        ({}, "quelqu'un"),
        ({"name": "  Souhib  "}, "Souhib"),
        ({"name": "x" * NAME_MAX}, "x" * NAME_MAX),
    ],
)
async def test_a_valid_arrival_can_be_described(lobby, auth: object, expected: str) -> None:
    await handlers.connect("good", {"asgi.scope": {}}, auth)
    described = await lobby.rooms.describe(lobby.people)
    assert [person.name for person in described.people] == [expected]
    assert lobby.people.live() == {"good"}


async def test_ready_then_launch_does_not_share_the_repeated_click_quota(
    lobby, monkeypatch: pytest.MonkeyPatch
) -> None:
    from nel3ab_control import worker
    from nel3ab_control.api.schemas.room import Game

    await handlers.connect("good", {"asgi.scope": {}}, {"name": "Alice"})
    claim = "a" * 32 + "-1"
    lobby.rooms.observe_seats([claim, None, None, None])
    lobby.rooms.claim(1, "good", "Alice", claim)
    monkeypatch.setattr(lobby.rooms, "synchronise", AsyncMock())
    game = Game(index=0, name="Mario Kart Wii", console="wii")
    monkeypatch.setattr(lobby.rooms, "library", AsyncMock(return_value=([game], game)))
    monkeypatch.setattr(handlers, "may_decide", AsyncMock(return_value=True))
    launched = AsyncMock(return_value=True)
    monkeypatch.setattr(worker, "launch_prepared", launched)
    monkeypatch.setattr(handlers, "monotonic", lambda: 200.0)
    assert await handlers.preparation("good", {"action": "begin", "game": 0}) == {"ok": True}
    assert lobby.rooms.preparation is not None
    identity = lobby.rooms.preparation.id
    ready = {"action": "choose", "id": identity, "pad": 1, "ready": True}
    assert await handlers.preparation("good", ready) == {"ok": True}
    assert "Attends" in (await handlers.preparation("good", ready))["error"]
    launch = {"action": "launch", "id": identity}
    assert await handlers.preparation("good", launch) == {"ok": True}
    launched.assert_awaited_once()
    assert "Attends" in (await handlers.preparation("good", launch))["error"]
    assert lobby.rooms.preparation is None


async def test_a_failed_initial_broadcast_removes_the_arrival(
    lobby, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = handlers.broadcast
    failing = AsyncMock(side_effect=WorkerUnreachable("http://worker.test"))
    monkeypatch.setattr(handlers, "broadcast", failing)
    with pytest.raises(Refused):
        await handlers.connect("failed", {"asgi.scope": {}}, {"name": "Fantôme"})
    failing.assert_awaited_once()
    assert lobby.people.live() == set()
    assert lobby.people.owner() is None
    # La pièce de la SALLE 1: la diffusion est cloisonnée par salle depuis le
    # 12 septembre 2026, et une socket ne quitte que la sienne.
    lobby.leave.assert_awaited_once_with("failed", handlers.piece(1))
    monkeypatch.setattr(handlers, "broadcast", original)
    await handlers.connect("next", {"asgi.scope": {}}, {"name": "Souhib"})
    described = await lobby.rooms.describe(lobby.people)
    assert [person.name for person in described.people] == ["Souhib"]


@pytest.mark.parametrize("data", ["x", 5, [1], [], False, None])
async def test_a_non_object_event_cannot_release_a_seat(lobby, data: object) -> None:
    await handlers.connect("good", {"asgi.scope": {}}, {"name": "Souhib"})
    lobby.rooms.claim(2, "good", "Souhib")
    await handlers.seat("good", data)
    assert lobby.rooms.seat_of("good") == 2
    assert "last_seat" in lobby.session, "le message mal formé consomme aussi son tour"


async def test_an_object_can_still_release_a_seat(lobby) -> None:
    await handlers.connect("good", {"asgi.scope": {}}, {"name": "Souhib"})
    lobby.rooms.claim(2, "good", "Souhib")
    await handlers.seat("good", {"port": None})
    assert lobby.rooms.seat_of("good") is None


@pytest.mark.parametrize("name", [{}, [1], 42, " ", "x" * (NAME_MAX + 1)])
async def test_an_invalid_rename_keeps_the_previous_name(lobby, name: object) -> None:
    await handlers.connect("good", {"asgi.scope": {}}, {"name": "Souhib"})
    lobby.rooms.claim(2, "good", "Souhib")
    await handlers.rename("good", {"name": name})
    assert lobby.session["name"] == "Souhib"
    assert lobby.people.present() == [(None, "Souhib")]
    assert lobby.rooms.seats()[1].player == "Souhib"


async def test_a_valid_rename_updates_the_presence_and_seat(lobby) -> None:
    await handlers.connect("good", {"asgi.scope": {}}, {"name": "Souhib"})
    lobby.rooms.claim(2, "good", "Souhib")
    await handlers.rename("good", {"name": "  Yassine  "})
    assert lobby.session["name"] == "Yassine"
    assert lobby.people.present() == [(None, "Yassine")]
    assert lobby.rooms.seats()[1].player == "Yassine"


async def test_the_first_spectator_announcement_is_broadcast(lobby) -> None:
    await handlers.connect("good", {"asgi.scope": {}}, {"name": "Alice"})
    before = await lobby.rooms.describe(lobby.people)
    assert before.people[0].model_dump().get("seat_pending") is True
    await handlers.seat("good", {"port": None, "claim": None})
    after = await lobby.rooms.describe(lobby.people)
    assert after.people[0].seat is None
    assert after.people[0].model_dump().get("seat_pending") is False
    assert lobby.emit.await_args.args[1]["people"][0]["seat_pending"] is False


@pytest.mark.parametrize(
    "as_boss, occupied, accepted",
    [(True, True, True), (True, False, True), (False, True, False), (False, False, False)],
)
async def test_only_the_authenticated_chief_can_close_even_as_spectator(
    lobby, monkeypatch: pytest.MonkeyPatch, as_boss: bool, occupied: bool, accepted: bool
) -> None:
    from nel3ab_control import worker

    lobby.people.arrived("chief", "chief@example.test", "Chef")
    lobby.people.arrived("other", "other@example.test", "Autre")
    lobby.session.update(
        login="chief@example.test" if as_boss else "other@example.test", name="Chef"
    )
    observed = ["a" * 32 + "-1" if occupied else None, None, None, None]
    monkeypatch.setattr(worker, "read_seats", AsyncMock(return_value=observed))
    stopped = AsyncMock(return_value=True)
    monkeypatch.setattr(worker, "stop_game", stopped)
    result = await handlers.close_game("chief" if as_boss else "other", {"game": 0})
    assert (result.get("ok") is True) == accepted
    assert stopped.await_count == int(accepted)
    if accepted:
        stopped.assert_awaited_once_with(
            lobby.rooms.settings.worker_control, [r or "-" for r in observed]
        )


@pytest.mark.parametrize(
    "observed, game, reply", [(None, 0, True), ([None] * 4, 9, True), ([None] * 4, 0, False)]
)
async def test_a_failed_close_is_reported_without_inventing_an_idle_room(
    lobby, monkeypatch: pytest.MonkeyPatch, observed, game: int, reply: bool
) -> None:
    from nel3ab_control import worker

    lobby.people.arrived("chief", "chief@example.test", "Chef")
    lobby.session.update(login="chief@example.test", name="Chef")
    monkeypatch.setattr(worker, "read_seats", AsyncMock(return_value=observed))
    stopped = AsyncMock(return_value=reply)
    monkeypatch.setattr(worker, "stop_game", stopped)
    assert "error" in await handlers.close_game("chief", {"game": game})
    assert (await lobby.rooms.describe(lobby.people)).game is not None


async def test_report_acknowledges_the_journal_and_names_a_refusal(lobby, monkeypatch):
    from nel3ab_control.connection import Connection

    monkeypatch.setattr(
        handlers, "read_connection", AsyncMock(return_value=Connection(kind="direct"))
    )
    await handlers.connect("good", {"asgi.scope": {}}, {"name": "Alice"})
    good = await handlers.plainte("good", {"peintes": 60})
    assert good["ok"] is True
    refused = await handlers.plainte("good", {"peintes": 60})
    assert refused["ok"] is False
    assert "rapprochée" in refused["error"]
    lobby.session.pop("last_plainte")
    journal = handlers._state({})[2]

    def lose(*args, **kwargs):
        journal._dropped += 1

    monkeypatch.setattr(journal, "write", lose)
    assert (await handlers.plainte("good", {"peintes": 60}))["ok"] is False
