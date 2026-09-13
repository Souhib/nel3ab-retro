#!/usr/bin/env python3
"""Le chemin COMPLET: un clic dans la page change l'extension, sans rien relancer.

`extension-a-chaud.py` prouve que Dolphin échange sur ordre extérieur. Celui-ci
prouve que l'ordre part bien de la page et arrive jusqu'à Dolphin — c'est-à-dire
les cinq couches entre les deux, qu'aucun essai unitaire ne traverse.

Ce qui est vérifié, et le troisième point est le seul qui compte pour la personne
qui joue:

1. la page envoie l'opcode quatre sur sa socket de manette;
2. Dolphin détache puis attache l'extension demandée, dans son journal;
3. l'émulateur ne redémarre PAS: c'est le même processus avant et après.

Le troisième a son propre observable, l'identifiant du processus Dolphin. Sans
lui, un redémarrage donnerait exactement les mêmes lignes de journal et
passerait pour une réussite — la panne qu'on est en train de supprimer, déguisée
en preuve qu'elle est supprimée.
"""

import json
import os
import re
import subprocess
import sys
import time
from urllib.parse import urlparse

# L'adresse ET l'unité, déduites ensemble.
#
# Ce fichier visait `http://localhost:8100/` et `journalctl -u nel3ab-worker`,
# deux choses mortes depuis la bascule multi-salles: plus rien n'écoute sur
# 8100, et l'unité s'appelle `nel3ab-worker@N`. Les deux lectures de journal
# rendaient donc le vide, `dolphin_pid()` et `presented()` rendaient `None`, et
# l'essai se plantait sur sa propre hypothèse au lieu de décrire un défaut.
#
# La règle de déduction est celle de `spikes/m3-browser-drive/open.mjs`, écrite
# une seconde fois parce qu'elle traverse une frontière de langage. Le port mort
# 8100 est refusé explicitement: il donnerait la salle 0, qui n'existe pas.
WORKER = os.environ.get("NEL3AB_URL", "http://localhost:8110/")


def _salle(url: str) -> int | None:
    """Le numéro de salle, lu dans le port `81N0` ou dans le chemin `/r/N/`."""
    lu = urlparse(url)
    par_port = re.fullmatch(r"81([1-9])0", str(lu.port or ""))
    if par_port:
        return int(par_port.group(1))
    par_chemin = re.match(r"^/r/([1-9]\d*)/", lu.path or "")
    return int(par_chemin.group(1)) if par_chemin else None


SALLE = _salle(WORKER)
if SALLE is None:
    print(f"RIEN TESTÉ — impossible de déduire la salle de « {WORKER} ».", file=sys.stderr)
    raise SystemExit(1)
UNITE = f"nel3ab-worker@{SALLE}"
SWITCH = re.compile(r"Switching to Extension (\d+) \(Wiimote 0")

bad = 0


def check(ok: bool, what: str) -> None:
    global bad
    if not ok:
        bad += 1
    print(f"  {'ok  ' if ok else 'RATÉ'}   {what}")


def dolphin_pid() -> str | None:
    """L'identifiant du processus Dolphin, vu par le journal du worker."""
    out = subprocess.run(
        ["journalctl", "-u", UNITE, "-n", "400", "--no-pager", "-o", "cat"],
        capture_output=True, text=True, check=False,
    ).stdout
    last = None
    for line in out.splitlines():
        if '"message":"Dolphin started"' in line:
            try:
                last = str(json.loads(line)["fields"]["pid"])
            except (ValueError, KeyError):
                continue
    return last


def presented() -> str | None:
    """Quelle manette la salle présente, d'après le journal du worker.

    Lu ici et non dans la page: la page n'expose pas cette information, et
    l'inventer un crochet pour un essai serait une seconde vérité à tenir. Le
    worker, lui, l'écrit à chaque démarrage.
    """
    out = subprocess.run(
        ["journalctl", "-u", UNITE, "-n", "600", "--no-pager", "-o", "cat"],
        capture_output=True, text=True, check=False,
    ).stdout
    last = None
    for line in out.splitlines():
        if '"message":"la manette que la salle présente"' in line:
            try:
                last = json.loads(line)["fields"]["pads"]
            except (ValueError, KeyError):
                continue
    return last


def main() -> int:
    # Sans Wiimote il n'y a rien à brancher, et un pilote qui passerait à vide
    # serait pire que pas de pilote: il annoncerait une preuve qu'il n'a pas.
    shown = presented()
    if shown not in ("wiimote", "guitare"):
        print(f"  la salle présente « {shown} » et non une Wiimote: rien à brancher.")
        print("  (relance la salle sur un jeu Wii réglé en Wiimote)")
        return 64

    before = dolphin_pid()
    check(before is not None, f"un Dolphin tourne (pid {before})")

    driver = os.path.join(os.path.dirname(__file__), "..", "m3-browser-drive", "extension.mjs")
    run = subprocess.run(["node", driver, WORKER], capture_output=True, text=True, check=False)
    print(run.stdout.rstrip())
    if run.returncode != 0:
        print(run.stderr[-2000:], file=sys.stderr)
        return 1

    time.sleep(2)
    after = dolphin_pid()
    check(
        before is not None and before == after,
        f"le même Dolphin qu'avant, donc rien n'a relancé (pid {before} puis {after})",
    )

    print("\nPASS" if not bad else f"\nÉCHEC ({bad})")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
