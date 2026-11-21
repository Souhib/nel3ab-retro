#!/usr/bin/env python3
"""Recopie la sortie de Xenia telle quelle, et l'écrit horodatée dans un fichier.

Chaque ligne du fichier commence par l'heure UTC et l'horloge monotone du
conteneur, en secondes. La sortie brute continue vers le journal du conteneur,
que la boîte noire relit pendant un ralentissement.
"""

import sys
import time
from datetime import UTC, datetime


def main() -> None:
    with open(sys.argv[1], "a", buffering=1, encoding="utf-8", errors="replace") as journal:
        for ligne in sys.stdin.buffer:
            texte = ligne.decode("utf-8", "replace").rstrip("\n")
            maintenant = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            journal.write(f"{maintenant} {time.monotonic():.3f} {texte}\n")
            sys.stdout.write(texte + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
