"""Une fermeture doit atteindre les spectateurs même sans changement de place."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from anyio import Lock

from nel3ab_control.api.ws import server


@pytest.mark.parametrize("after, expected", [(None, 2), (0, 1)])
async def test_game_changes_are_pushed_without_input_connections(
    monkeypatch: pytest.MonkeyPatch, after: int | None, expected: int
) -> None:
    game = SimpleNamespace(index=0)
    rooms = SimpleNamespace(
        recovery=None,
        recovering=Lock(),
        synchronise=AsyncMock(return_value=False),
        library=AsyncMock(side_effect=[([], game), ([], None if after is None else game)]),
    )
    # La boucle parcourt les salles ÉVEILLÉES, celles dont quelqu'un s'est déjà
    # occupé: une salle que personne n'a ouverte n'a pas de worker à interroger.
    state = SimpleNamespace(
        people=SimpleNamespace(live=lambda _salle=None: {"spectator"}),
        rooms=rooms,
        salons=SimpleNamespace(eveilles=lambda: [(1, rooms)]),
        journal=object(),
    )
    broadcast = AsyncMock()
    monkeypatch.setattr(server, "broadcast", broadcast)
    monkeypatch.setattr(
        server.anyio, "sleep", AsyncMock(side_effect=[None, None, asyncio.CancelledError()])
    )
    with pytest.raises(asyncio.CancelledError):
        await server.follow_seats(state)
    assert broadcast.await_count == expected
    assert state.rooms.synchronise.await_count == 2
