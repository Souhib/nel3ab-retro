"""Script d'essai: un adaptateur d'aujourd'hui, servi par le `serve` du socle.

Jamais lancé par une salle. `test_differentiel.py` le fait exécuter par l'amorce
du banc doré, dans un interpréteur neuf, à la place du script d'une console:

    MOTEURS_DIFFERENTIEL=docker/switch-room.py python3 differentiel.py <rom> <titre> ...

Le script d'origine fait tout ce qu'il fait d'habitude, sauf que son `serve` est
celui de `moteurs.socle.salle`. Chaque scénario doré doit alors rendre son doré:
c'est ce qui prouve que la copie de `serve` dans le socle ne change aucune
commande. Pour la Switch, le plan de Ryubing reste calculé dans `serve`, après
la lecture de l'image, comme dans switch-room.py.
"""

import importlib.util
import os
import sys
from pathlib import Path

DEPOT = Path(__file__).resolve().parents[2]
sys.path.append(str(DEPOT))

from moteurs.socle import salle  # noqa: E402 -- le dépôt vient d'être ajouté au chemin


def principal() -> None:
    cible = DEPOT / os.environ["MOTEURS_DIFFERENTIEL"]
    spec = importlib.util.spec_from_file_location("adaptateur", cible)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # La Switch 2 et la Xbox 360 chargent switch-room.py sous le nom `room`.
    room = getattr(module, "room", module)

    def serve(config, rom, slot, pads, launch=None, snapshot=room.backup):
        plan = launch if launch is not None else (lambda: room.ryubing_launch(config, rom, slot))
        salle.serve(config, rom, slot, pads, plan, snapshot)

    room.serve = serve
    module.main()


if __name__ == "__main__":
    principal()
