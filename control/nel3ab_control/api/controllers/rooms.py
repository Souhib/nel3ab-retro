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
        #: Port -> la SESSION qui l'a annoncé, pas le nom de qui la tient.
        #:
        #: Par session, parce qu'un nom n'est pas unique: la même personne peut
        #: ouvrir la salle sur deux appareils. Avec des places rangées par nom,
        #: fermer un onglet libérait la place de l'autre appareil, et deux
        #: appareils d'une même personne se confondaient en une seule ligne.
        self._claims: dict[int, str] = {}
        self._players = PADS_MAX
        #: La dernière bibliothèque obtenue, gardée pour survivre à un worker qui
        #: redémarre. Voir `library`.
        self._known: tuple[list[Game], Game | None] | None = None
        #: Session -> le nom sous lequel elle s'est assise, pour l'afficher.
        self._named: dict[str, str] = {}
        #: La dernière place annoncée au worker, pour ne pas le rappeler pour
        #: rien. Publique parce que c'est le salon qui la tient à jour.
        self.told_owner = 0
        #: Port -> la session qui demande à en prendre la manette.
        #:
        #: Gardé ici plutôt que passé par les pages: sans ça, celui qui demande
        #: devrait envoyer l'identifiant de socket de celui à qui il demande, et
        #: une page apprendrait comment adresser une autre page. Le serveur sait
        #: déjà qui tient quoi; il n'a pas besoin qu'on le lui dise.
        self._asks: dict[int, str] = {}

    @property
    def settings(self) -> Settings:
        """Les réglages, pour qui doit joindre le worker."""
        return self._settings

    async def library(self) -> tuple[list[Game], Game | None]:
        """Every game the worker found, and the one it is running.

        Garde la dernière réponse et s'en sert quand le worker ne répond pas.

        Ce n'est pas de la prudence générale, c'est un cas précis et fréquent:
        **changer de jeu redémarre le worker**, et chaque page se reconnecte au
        salon pendant ce redémarrage. Sans ce repli, chaque connexion, chaque
        départ et chaque changement de pseudo faisait échouer la diffusion, la
        salle ne disait plus qui était là, et le journal se remplissait de traces.

        Le premier appel n'a rien à garder: là, un worker injoignable reste une
        erreur, parce qu'une salle qui n'a jamais su quels jeux elle a n'est pas
        une salle qui a perdu le contact.
        """
        try:
            response = await self._client.get(f"{self._settings.worker_url}/roms", timeout=2.0)
            response.raise_for_status()
        except httpx.HTTPError as error:
            if self._known is not None:
                return self._known
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
        self._known = (games, running)
        return games, running

    def seats(self) -> list[Seat]:
        """Every pad, with the name of whoever claims it.

        Uses the count the worker last reported. Before the first `library()`
        call there is nothing to have reported, so it describes a full room of
        four: showing a pad that turns out not to exist is a wrong label for a
        second, and hiding one that does is a player who cannot sit down.
        """
        return [
            Seat(port=port, player=self._named.get(self._claims.get(port) or ""))
            for port in range(1, self._players + 1)
        ]

    def claim(self, port: int, session: str, name: str) -> None:
        """Records that a SESSION says it holds a pad.

        Refuses a pad another session claims. Re-claiming one's own is not an
        error: a page that reconnects says the same thing again, and treating
        that as a conflict would lock a player out of the seat they are sitting
        in.
        """
        held = self._claims.get(port)
        if held is not None and held != session:
            raise SeatTaken(port)
        self._claims[port] = session
        self._named[session] = name

    def release(self, session: str) -> None:
        """Forgets every pad THIS session claimed.

        Cette session-là et pas toutes celles du même nom: fermer un onglet ne
        doit pas libérer la manette que la même personne tient sur son autre
        machine.
        """
        self._claims = {port: who for port, who in self._claims.items() if who != session}
        self._named.pop(session, None)

    def rename(self, session: str, now: str) -> None:
        """Une place suit son occupant quand il change de pseudo.

        Sans ça, changer de pseudo laisserait une manette retenue au nom de
        quelqu'un qui n'existe plus.
        """
        if session in self._named:
            self._named[session] = now

    def holder_of(self, port: int) -> str | None:
        """La session qui tient cette place."""
        return self._claims.get(port)

    def asked(self, port: int, asker: str) -> None:
        """Retient qui demande cette place, en attendant la réponse."""
        self._asks[port] = asker

    def take_ask(self, port: int) -> str | None:
        """Rend qui demandait, et oublie la demande."""
        return self._asks.pop(port, None)

    def free(self, port: int) -> None:
        """Libère une place, parce que celui qui la tenait la cède."""
        self._claims.pop(port, None)

    def seat_of(self, session: str) -> int | None:
        """La place que cette session tient, s'il y en a une."""
        for port, who in self._claims.items():
            if who == session:
                return port
        return None

    async def describe(self, people: PeopleController | None = None) -> Room:
        """Toute la salle, telle qu'une page a besoin de la dessiner."""
        library, running = await self.library()
        seats = self.seats()
        present = people.present() if people else []
        boss = people.owner() if people else None
        # La place d'une personne se trouve par ses SESSIONS: le nom ne suffit
        # pas, deux appareils d'une même personne portent le même.
        held = {
            login_or_name: port
            for login_or_name, sessions in (people.sessions() if people else {}).items()
            for session in sessions
            if (port := self.seat_of(session)) is not None
        }
        return Room(
            name=self._settings.room_name,
            game=running,
            library=library,
            seats=seats,
            owner=(
                Person(name=boss[1], login=boss[0], seat=held.get(boss[0] or boss[1]))
                if boss
                else None
            ),
            people=[
                Person(name=name, login=login, seat=held.get(login or name))
                for login, name in present
            ],
            media_url=self._settings.worker_public_url,
        )
