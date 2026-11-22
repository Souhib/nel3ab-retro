#!/usr/bin/env python3
"""Canari: la salle Xbox 360 servie par moteurs/socle et moteurs/xenia.

AUCUNE salle ne le lance aujourd'hui. Le worker lance `docker/xbox360-room.py`
(form.script du manifeste); ce fichier ne sert qu'à la salle que le
propriétaire choisit, par `NEL3AB_XBOX360_ADAPTER` dans un ajout de son unité.
La procédure, l'essai à faire et le retour arrière sont dans docs/xbox360.md.

Le banc doré exige que ce script et l'ancien rendent les mêmes commandes pour
chaque scénario Xbox 360 (docker/test_salles_dore.py).
"""

import sys
from pathlib import Path

DEPOT = Path(__file__).resolve().parents[1]
# À la fin du chemin: la bibliothèque standard passe toujours avant le dépôt.
sys.path.append(str(DEPOT))

from moteurs.socle.salle import principal  # noqa: E402 -- le dépôt vient d'être ajouté

if __name__ == "__main__":
    principal("x360")
