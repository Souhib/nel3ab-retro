"""L'emplacement de sauvegarde d'une salle: son nom, son chemin, son verrou.

Repris de `docker/switch-room.py` (SLOT, puis le début des trois `main()`), où
il reste jusqu'à la bascule de chaque console.
"""

import fcntl
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

#: Les emplacements de sauvegarde qu'une salle peut demander.
#:
#: Les deux de la salle, ou celui d'une personne. Un SEUL segment, sans barre ni
#: point: ce texte vient du worker et sert à construire un chemin sous l'état
#: des jeux, donc un `..` ou une barre y ouvrirait n'importe quel dossier.
SLOT = r"^(neuve|debloquee|joueur-[a-z0-9][a-z0-9-]*)$"


def valide(choix: str) -> bool:
    return re.fullmatch(SLOT, choix) is not None


def chemin(state: str, titre: str, choix: str) -> Path:
    """`<state>/<titre en minuscules>/<emplacement>`, comme `unlocked::directories`.

    Les minuscules ne changent rien à la Switch ni à la Switch 2, qui n'acceptent
    que des minuscules; la Xbox 360 les impose déjà (xbox360-room.py).
    """
    return Path(state).resolve() / titre.lower() / choix


@contextmanager
def tenu(emplacement: Path) -> Iterator[None]:
    """L'emplacement, créé et verrouillé pour toute la partie, ou un refus immédiat."""
    emplacement.mkdir(parents=True, exist_ok=True)
    with (emplacement / "running.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
