"""Préparer un jeu ensemble, sans modifier le jeu qui tourne encore."""

from math import ceil
from secrets import token_hex
from time import monotonic
from typing import Protocol

from pydantic import BaseModel, Field, PrivateAttr

#: Combien de secondes le chef attend avant de pouvoir lancer sans un joueur.
#:
#: Un joueur assis qui ne répondait pas bloquait tout le monde: le lancement
#: exigeait que chacun soit prêt, et le chef n'avait que « Annuler le
#: lancement » (audit P6, 22 novembre 2026). Vingt secondes, c'est le temps de
#: tester trois touches et de confirmer; c'est aussi la reprise d'une place, qui
#: attend vingt secondes sans réponse avant de se proposer. Pas mesuré sur une
#: soirée: c'est un choix, à corriger sur ce que les joueurs ressentent.
ATTENTE_SANS = 20.0


class GameLike(Protocol):
    """Ce qu'il faut d'un jeu pour le reconnaître: sa position et sa clé."""

    @property
    def index(self) -> int: ...

    @property
    def key(self) -> str | None: ...


class Participant(BaseModel):
    port: int
    claim: str
    name: str | None = None
    pad: int | None = None
    ready: bool = False
    #: Quand cette attribution est arrivée dans la préparation, sur l'horloge
    #: monotone du salon. Ni publiée ni décrite au contrat, comme `_ouverte`:
    #: « Lancer sans attendre » compte depuis l'arrivée du dernier absent, et
    #: la page compte depuis qu'ELLE l'a vu arriver, donc toujours plus tard.
    _arrivee: float = PrivateAttr(default_factory=monotonic)


class Preparation(BaseModel):
    id: str = Field(default_factory=lambda: token_hex(8))
    game: int = Field(
        description="La position du jeu quand la préparation a commencé. Pour l'affichage."
    )
    key: str | None = Field(
        default=None,
        description=(
            "La clé du jeu, son nom de fichier, qui le désigne même si la liste a "
            "changé depuis (ADR D23). Nulle quand le worker n'en publiait pas."
        ),
    )
    save: int
    starter: str
    allowed: list[int]
    players: list[Participant]
    #: Quand la préparation s'est ouverte, sur l'horloge monotone du salon. Ni
    #: publiée ni décrite au contrat: la page compte son propre délai, qui part
    #: forcément après celui-ci, donc elle ne propose jamais trop tôt.
    _ouverte: float = PrivateAttr(default_factory=monotonic)

    @property
    def ouverte_a(self) -> float:
        """L'instant d'ouverture, pour qui veut compter le délai."""
        return self._ouverte

    def names(self, game: "GameLike") -> bool:
        """Ce jeu est-il celui qu'on prépare ? Par sa clé quand on la connaît."""
        if self.key is not None:
            return game.key == self.key
        return game.index == self.game

    def directe(self) -> bool:
        """Le chef est seul à jouer, et le jeu ne propose qu'un appareil.

        Il n'y a alors rien à attendre ni à choisir: le choix de la sauvegarde
        suffit à lancer (audit P6). Il fallait sept gestes et trois
        confirmations de la même décision.
        """
        return (
            len(self.allowed) == 1
            and len(self.players) == 1
            and self.players[0].claim == self.starter
        )

    def synchronise(
        self,
        seats: list[tuple[int, str, str | None]],
        *,
        solo: bool = False,
        maintenant: float | None = None,
    ) -> bool:
        """Une nouvelle attribution doit confirmer son propre choix.

        Une attribution déjà là garde son heure d'arrivée; une nouvelle prend
        `maintenant`, l'horloge monotone du salon par défaut.
        """
        previous = {player.claim: player for player in self.players}
        arrivee = monotonic() if maintenant is None else maintenant
        players: list[Participant] = []
        for port, claim, name in seats:
            if solo and claim != self.starter:
                continue
            avant = previous.get(claim)
            player = Participant(
                port=port,
                claim=claim,
                name=name,
                pad=avant.pad if avant is not None else None,
                ready=avant.ready if avant is not None else False,
            )
            player._arrivee = avant._arrivee if avant is not None else arrivee
            players.append(player)
        self.players = players
        return any(player.claim == self.starter for player in self.players)

    def choose(self, claim: str, pad: int, ready: bool) -> None:
        if pad not in self.allowed:
            raise ValueError("Cette configuration n'est pas proposée pour ce jeu.")
        player = next((p for p in self.players if p.claim == claim), None)
        if player is None:
            raise ValueError("Prends une place pour préparer ton jeu.")
        player.pad = pad
        player.ready = ready

    def launch(
        self,
        claim: str,
        *,
        pad: int | None = None,
        sans_attendre: bool = False,
        maintenant: float | None = None,
    ) -> list[int]:
        """Les appareils des quatre places, ou un refus qui dit pourquoi.

        `pad` est le choix du chef, confirmé par le lancement lui-même: « Je
        suis prêt » puis « Lancer » disaient deux fois la même chose.
        `sans_attendre` lance sans les joueurs qui n'ont pas confirmé, une fois
        `ATTENTE_SANS` écoulé depuis l'arrivée du dernier d'entre eux. Ils
        gardent leur place, avec l'appareil qu'ils avaient choisi ou, à défaut,
        le premier proposé.
        """
        if claim != self.starter:
            raise ValueError("La personne qui prépare le jeu confirme son lancement.")
        if pad is not None:
            self.choose(claim, pad, True)
        absents = [p for p in self.players if not p.ready or p.pad is None]
        if absents and not sans_attendre:
            raise ValueError("Chaque joueur doit confirmer sa configuration.")
        if any(p.claim == self.starter for p in absents):
            raise ValueError("Choisis ta configuration, puis lance.")
        if not self.players:
            raise ValueError("Chaque joueur doit confirmer sa configuration.")
        if absents:
            # Depuis l'arrivée du DERNIER absent, et non depuis l'ouverture:
            # quelqu'un qui s'assoit à 19 s se prépare peut-être encore à 20 s
            # (relecture du 22 novembre 2026).
            depuis = max(max(p._arrivee for p in absents), self._ouverte)
            ecoule = (monotonic() if maintenant is None else maintenant) - depuis
            if ecoule < ATTENTE_SANS:
                reste = ceil(ATTENTE_SANS - ecoule)
                raise ValueError(f"Attends encore {reste} s : un joueur se prépare peut-être.")
        # Les places encore libres gardent un appareil compatible pour un ami
        # qui arriverait après le lancement. Elles ne bloquent pas les présents.
        pads = [self.allowed[0]] * 4
        for player in self.players:
            choisi = player.pad if player.pad in self.allowed else None
            pads[player.port - 1] = self.allowed[0] if choisi is None else choisi
        return pads
