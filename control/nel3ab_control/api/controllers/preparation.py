"""Préparer un jeu ensemble, sans modifier le jeu qui tourne encore."""

from secrets import token_hex

from pydantic import BaseModel, Field


class Participant(BaseModel):
    port: int
    claim: str
    name: str | None = None
    pad: int | None = None
    ready: bool = False


class Preparation(BaseModel):
    id: str = Field(default_factory=lambda: token_hex(8))
    game: int
    save: int
    starter: str
    allowed: list[int]
    players: list[Participant]

    def synchronise(self, seats: list[tuple[int, str, str | None]]) -> bool:
        """Une nouvelle attribution doit confirmer son propre choix."""
        previous = {player.claim: player for player in self.players}
        self.players = [
            Participant(
                port=port,
                claim=claim,
                name=name,
                pad=previous[claim].pad if claim in previous else None,
                ready=previous[claim].ready if claim in previous else False,
            )
            for port, claim, name in seats
        ]
        return any(player.claim == self.starter for player in self.players)

    def choose(self, claim: str, pad: int, ready: bool) -> None:
        if pad not in self.allowed:
            raise ValueError("Cette configuration n'est pas proposée pour ce jeu.")
        player = next((p for p in self.players if p.claim == claim), None)
        if player is None:
            raise ValueError("Prends une manette pour préparer ton jeu.")
        player.pad = pad
        player.ready = ready

    def launch(self, claim: str) -> list[int]:
        if claim != self.starter:
            raise ValueError("La personne qui prépare le jeu confirme son lancement.")
        if not self.players or any(not p.ready or p.pad is None for p in self.players):
            raise ValueError("Chaque joueur doit confirmer sa configuration.")
        # Les places encore libres gardent un appareil compatible pour un ami
        # qui arriverait après le lancement. Elles ne bloquent pas les présents.
        pads = [self.allowed[0]] * 4
        for player in self.players:
            if player.pad is None:
                raise ValueError("Cette manette n'est pas prête.")
            pads[player.port - 1] = player.pad
        return pads
