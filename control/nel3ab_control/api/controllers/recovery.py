"""Une reprise demandée par une personne, jamais déduite d'un onglet ouvert."""

from dataclasses import dataclass, field
from uuid import uuid4

# Choix d'interface du 6 septembre 2026, pas une mesure d'absence : vingt
# secondes pour lire l'avertissement, puis quarante pour confirmer la reprise.
# Une minute borne aussi les demandes abandonnées et protège un refus du spam.
ANSWER_WITHIN = 20.0
EXPIRES_AFTER = 60.0


@dataclass
class Recovery:
    asker: str
    login: str | None
    targets: list[str]
    source: str
    target: str
    port: int | None
    expected: str
    started: float
    id: str = field(default_factory=lambda: uuid4().hex)
    accepted: bool = False

    def remaining(self, now: float) -> float:
        return 0 if self.accepted else max(0, self.started + ANSWER_WITHIN - now)

    def expired(self, now: float) -> bool:
        return now >= self.started + EXPIRES_AFTER

    def respond(self, sid: str, now: float) -> None:
        if sid not in self.targets or self.expired(now):
            raise ValueError("Cette demande ne t'est plus adressée.")
        self.accepted = True

    def finish(self, sid: str, now: float) -> None:
        if sid != self.asker or self.expired(now):
            raise ValueError("Cette demande n'est plus disponible.")
        if self.remaining(now) > 0:
            raise ValueError("Laisse encore le temps de répondre.")
