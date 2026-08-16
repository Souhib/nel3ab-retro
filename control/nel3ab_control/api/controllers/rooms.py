"""What the room is, assembled from what the worker knows and what pages claim.

The split matters and is stated in ADR D12: the worker is the only thing that
knows which pad is really held, because it is the one applying the buttons. This
controller knows what each page TOLD it, which is what lets a seat carry a name.
The two can disagree for a second after a reconnection, and the page believes the
worker.
"""

import httpx

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.schemas.error import SeatTaken, WorkerUnreachable
from nel3ab_control.api.schemas.player import Person
from nel3ab_control.api.schemas.room import Game, Room, Seat
from nel3ab_control.settings import Settings

#: What a GameCube has, and therefore the most a room can ever serve.
PADS_MAX = 4


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
        self._players = PADS_MAX

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
        # How many pads the room has, from the only thing that knows: the worker
        # is what tells Dolphin which ports hold a controller when it boots. It
        # was configured here as well, which made two settings that had to agree
        # and nothing that made them.
        players = payload.get("players")
        self._players = (
            players if isinstance(players, int) and 1 <= players <= PADS_MAX else PADS_MAX
        )
        return games, running

    def seats(self) -> list[Seat]:
        """Every pad, with the name of whoever claims it.

        Uses the count the worker last reported. Before the first `library()`
        call there is nothing to have reported, so it describes a full room of
        four: showing a pad that turns out not to exist is a wrong label for a
        second, and hiding one that does is a player who cannot sit down.
        """
        return [
            Seat(port=port, player=self._claims.get(port)) for port in range(1, self._players + 1)
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

    def rename(self, was: str, now: str) -> None:
        """Une place suit son occupant quand il change de pseudo.

        Sans ça, changer de pseudo laisserait une manette retenue au nom de
        quelqu'un qui n'existe plus, et personne ne pourrait la reprendre sans la
        prendre à un fantôme.
        """
        self._claims = {port: now if who == was else who for port, who in self._claims.items()}

    async def describe(self, people: PeopleController | None = None) -> Room:
        """Toute la salle, telle qu'une page a besoin de la dessiner."""
        library, running = await self.library()
        seats = self.seats()
        held = {seat.player: seat.port for seat in seats if seat.player}
        present = people.present() if people else []
        return Room(
            name=self._settings.room_name,
            game=running,
            library=library,
            seats=seats,
            people=[Person(name=name, login=login, seat=held.get(name)) for login, name in present],
            media_url=self._settings.worker_public_url,
        )
