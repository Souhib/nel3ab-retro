"""What the room is, assembled from what the worker knows and what pages claim.

The split matters and is stated in ADR D12: the worker is the only thing that
knows which pad is really held, because it is the one applying the buttons. This
controller knows what each page TOLD it, which is what lets a seat carry a name.
The two can disagree for a second after a reconnection, and the page believes the
worker.
"""

import httpx

from nel3ab_control.api.schemas.error import SeatTaken, WorkerUnreachable
from nel3ab_control.api.schemas.room import Game, Room, Seat
from nel3ab_control.settings import Settings


class RoomController:
    """The single room, in memory.

    In memory because there is one machine, one GPU and one emulator: a database
    would be a second source of truth for state that dies with the process
    anyway. When a second room appears, this is what changes.
    """

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._claims: dict[int, str] = {}

    async def library(self) -> tuple[list[Game], Game | None]:
        """Every game the worker found, and the one it is running."""
        try:
            response = await self._client.get(f"{self._settings.worker_url}/roms", timeout=2.0)
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise WorkerUnreachable(self._settings.worker_url) from error

        payload = response.json()
        games = [Game(index=index, name=name) for index, name in enumerate(payload.get("roms", []))]
        current = payload.get("current")
        running = games[current] if isinstance(current, int) and current < len(games) else None
        return games, running

    def seats(self) -> list[Seat]:
        """Every pad, with the name of whoever claims it."""
        return [
            Seat(port=port, player=self._claims.get(port))
            for port in range(1, self._settings.players + 1)
        ]

    def claim(self, port: int, player: str) -> None:
        """Records that somebody says they hold a pad.

        Refuses a pad somebody else claims. Re-claiming your own is not an error:
        a page that reconnects says the same thing again, and treating that as a
        conflict would lock a player out of the seat they are sitting in.
        """
        held = self._claims.get(port)
        if held is not None and held != player:
            raise SeatTaken(port)
        self._claims[port] = player

    def release(self, player: str) -> None:
        """Forgets every pad this player claimed."""
        self._claims = {port: who for port, who in self._claims.items() if who != player}

    async def describe(self) -> Room:
        """The whole room, as a page needs to render it."""
        library, running = await self.library()
        return Room(
            name=self._settings.room_name,
            game=running,
            library=library,
            seats=self.seats(),
            media_url=self._settings.worker_public_url,
        )
