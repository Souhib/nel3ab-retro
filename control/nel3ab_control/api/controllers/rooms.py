"""What the room is, assembled from what the worker knows and what pages claim.

The split matters and is stated in ADR D12: the worker is the only thing that
knows which pad is really held, because it is the one applying the buttons. This
controller knows what each page TOLD it, which is what lets a seat carry a name.
The two can disagree for a second after a reconnection, and the page believes the
worker.
"""

from collections.abc import Container
from time import monotonic

import httpx

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.schemas.error import NoSuchSeat, SeatTaken, WorkerUnreachable
from nel3ab_control.api.schemas.player import Person
from nel3ab_control.api.schemas.room import Game, Room, Seat
from nel3ab_control.settings import Settings

#: What a GameCube has, and therefore the most a room can ever serve.
PADS_MAX = 4

#: Combien de temps une demande de manette attend une réponse, en secondes.
#:
#: Dix. Assez pour lever les yeux de la partie et décider, trop court pour qu'on
#: ait oublié la question. La page compte à rebours, et ce nombre-ci est ce qui
#: rend ce compte vrai plutôt que décoratif.
ASK_LASTS = 10.0


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
        #: Le propriétaire déjà inscrit au journal, pour n'y écrire que les
        #: changements. Sans ça, chaque diffusion répéterait la même ligne.
        self.noted_owner: tuple[str | None, int] = (None, 0)
        #: Port -> (session qui demande, instant de la demande).
        #:
        #: Gardé ici plutôt que passé par les pages: sans ça, celui qui demande
        #: devrait envoyer l'identifiant de socket de celui à qui il demande, et
        #: une page apprendrait comment adresser une autre page. Le serveur sait
        #: déjà qui tient quoi; il n'a pas besoin qu'on le lui dise.
        self._asks: dict[int, tuple[str, float]] = {}

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
        # Le worker décrivait ses jeux par un simple nom; il en dit maintenant
        # quatre choses. On accepte encore l'ancienne forme parce que le worker
        # et ce service se redémarrent séparément, et qu'une salle muette
        # pendant les cinq secondes de décalage est une salle en panne.
        games = [_game(index, entry) for index, entry in enumerate(payload.get("roms", []))]
        current = payload.get("current")
        # `0 <=` et pas seulement `<`: un index négatif compte depuis la fin en
        # Python, donc `current = -1` désignait le dernier jeu de la liste au
        # lieu de ne désigner personne.
        running = games[current] if isinstance(current, int) and 0 <= current < len(games) else None
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

    def known_game(self) -> str | None:
        """Le jeu qui tourne, d'après la DERNIÈRE réponse du worker.

        Sans l'appeler. Le journal en a besoin à chaque événement, et une trace
        qui ajoute un aller-retour réseau au chemin d'un joueur est une trace qui
        coûte ce qu'elle prétend mesurer.
        """
        if self._known is None:
            return None
        _games, running = self._known
        return running.name if running else None

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

    def real(self, port: int) -> bool:
        """Vrai quand ce numéro est une place de cette salle.

        Une seule définition de « une place existe », ici, parce que c'est ici
        que les places sont retenues. La répéter chez chaque appelant serait une
        deuxième définition à tenir d'accord, et le 19 août 2026 un appelant
        l'avait déjà oubliée: le gestionnaire `seat` passait `int(port)` sans
        borne, et retenir la place 1 099 511 627 776 marchait.
        """
        return 1 <= port <= self._players

    def claim(self, port: int, session: str, name: str) -> None:
        """Records that a SESSION says it holds a pad.

        Refuses a pad another session claims. Re-claiming one's own is not an
        error: a page that reconnects says the same thing again, and treating
        that as a conflict would lock a player out of the seat they are sitting
        in.

        Refuse aussi une place qui n'existe pas. Sans ce refus, le dictionnaire
        des places accepte n'importe quel entier et grossit sans borne, ce qui
        est une fuite mémoire qu'une page suffit à provoquer.
        """
        if not self.real(port):
            raise NoSuchSeat(port)
        held = self._claims.get(port)
        if held is not None and held != session:
            raise SeatTaken(port)
        # Une session tient UNE place. Sans cette ligne, une page qui recharge et
        # à qui le worker donne un autre port occupait les deux, et son nom
        # s'affichait sous deux numéros — rapporté le 5 septembre 2026 comme
        # « mon nom apparaît sous joueur 1 alors que je suis 2 ».
        #
        # C'est le worker qui attribue les ports, jamais nous: cette table n'est
        # qu'une copie de sa décision, et une copie qui garde deux valeurs pour
        # une seule vérité finit toujours par montrer la mauvaise.
        self._claims = {at: who for at, who in self._claims.items() if who != session or at == port}
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

    def forget_absent(self, live: Container[str]) -> list[int]:
        """Rend les places dont la session n'est plus là. Dit lesquelles.

        # Pourquoi ça ne peut pas attendre la déconnexion

        Une page qui recharge ouvre sa nouvelle socket AVANT que l'ancienne soit
        déclarée partie. Le worker, lui, a déjà réattribué le port: il ne compte
        que les tuyaux vivants. Pendant cette fenêtre, la nouvelle annonce
        tombait sur une place que l'ancienne tenait encore, `SeatTaken` était
        levée, et personne ne rattrapait rien — le gestionnaire mourait avant de
        prévenir la salle, qui restait donc sur l'affichage d'avant.

        Rendre d'abord ce qui est mort transforme ce conflit en non-événement.

        # Ce que ça ne fait PAS

        Rendre une place que quelqu'un tient encore. C'est le jumeau qui compte:
        un balayage qui viderait tout passerait l'essai du dessus et arracherait
        la manette de quelqu'un en train de jouer.
        """
        gone = [at for at, who in self._claims.items() if who not in live]
        for at in gone:
            who = self._claims.pop(at)
            self._named.pop(who, None)
        return gone

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

    def asked(self, port: int, asker: str, now: float | None = None) -> None:
        """Retient qui demande cette place, en attendant la réponse."""
        self._asks[port] = (asker, monotonic() if now is None else now)

    def take_ask(self, port: int, now: float | None = None) -> str | None:
        """Rend qui demandait, et oublie la demande. Rien si elle a expiré.

        Une demande sans réponse s'éteint au bout de `ASK_LASTS`. Sans ça, un
        « oui » tapé cinq minutes plus tard téléporterait une manette au milieu
        d'une partie, et celui qui avait demandé aurait oublié depuis longtemps
        qu'il avait demandé.

        Le temps est **monotone** et pas l'heure: régler l'horloge de la machine
        ne doit pas faire expirer ou ressusciter une demande.
        """
        found = self._asks.pop(port, None)
        if found is None:
            return None
        asker, when = found
        elapsed = (monotonic() if now is None else now) - when
        return None if elapsed > ASK_LASTS else asker

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
            ask_lasts=ASK_LASTS,
            media_url=self._settings.worker_public_url,
        )


def _game(index: int, entry: object) -> Game:
    """Un jeu, tel que le worker le décrit.

    Deux formes acceptées: un nom seul, qui est ce que le worker disait avant
    d'apprendre à lire les jaquettes, et un objet qui porte aussi ce que le
    disque dit de lui-même.
    """
    if isinstance(entry, str):
        return Game(index=index, name=entry)
    if isinstance(entry, dict):
        return Game(
            index=index,
            name=str(entry.get("name", "")),
            maker=entry.get("maker"),
            about=entry.get("about"),
            art=bool(entry.get("art", False)),
            console=str(entry.get("console", "?")),
        )
    return Game(index=index, name=str(entry))
