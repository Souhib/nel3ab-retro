"""Un systemd de papier, partagé par les essais qui ouvrent et ferment des salles.

À part et pas dans `test_salles.py`: l'application d'essai de `conftest.py` en a
besoin aussi. Sans lui, son contrôleur des salles garde le vrai lanceur, et un
essai qui appelle `POST /api/salles` lancerait `sudo systemctl start` sur la
machine qui héberge les vraies parties.
"""

import time
from collections.abc import Callable, Mapping, Sequence


class FauxSysteme:
    """Un systemd de papier: il note ce qu'on lui demande et répond ce qu'on veut."""

    def __init__(
        self,
        allumees: Sequence[int] = (),
        refuse: bool = False,
        relancees: Sequence[int] = (),
        depuis: Mapping[int, float] | None = None,
        horloge: Callable[[], float] = time.monotonic,
    ) -> None:
        self.allumees = set(allumees)
        #: Les salles que systemd est en train de relancer: le worker est sorti
        #: (un changement de jeu, un plantage) et `RestartSec` court encore.
        #: `systemctl is-active` dit alors « activating », avec le code 3, comme
        #: pour une unité arrêtée: seul le mot les distingue.
        self.relancees = set(relancees)
        self.refuse = refuse
        #: Depuis combien de SECONDES chaque salle tourne. Absente d'ici, une
        #: salle répond comme une unité qui n'a jamais démarré.
        self.depuis = dict(depuis or {})
        #: La MÊME horloge que celle du contrôleur, jamais la vraie. Voir
        #: `HORLOGE` dans `test_salles.py`.
        self.horloge = horloge
        self.commandes: list[list[str]] = []

    async def __call__(self, commande: Sequence[str]) -> tuple[int, str]:
        self.commandes.append(list(commande))
        numero = int(commande[-1].split("@")[1])
        if "is-active" in commande:
            if numero in self.allumees:
                return 0, "active"
            return (3, "activating") if numero in self.relancees else (3, "inactive")
        if "show" in commande:
            # systemd rend des MICROSECONDES d'horloge monotone prises au
            # démarrage de l'unité, et `0` pour une unité jamais démarrée.
            age = self.depuis.get(numero)
            if age is None:
                return 0, "0"
            return 0, str(int((self.horloge() - age) * 1_000_000))
        if self.refuse:
            return 1, "Unit not found."
        if "start" in commande:
            self.allumees.add(numero)
        else:
            self.allumees.discard(numero)
        return 0, ""
