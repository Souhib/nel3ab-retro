#!/usr/bin/env python3
"""Relit une partie Xbox 360: les images par seconde du jeu, fenêtre par fenêtre.

Xenia préfixe chacune de ses lignes par le compteur d'images que le jeu a
présentées (« f:0002566 »), et `--guest_scheduler_stats` lui fait écrire une
ligne par seconde. `xenia.sh` horodate chaque ligne (heure UTC, horloge
monotone). Le rapport entre les deux donne la cadence du jeu lui-même, avant
toute capture, tout encodage et tout réseau.

    python3 spikes/xbox360/releve.py <emplacement>/xenia-horodate.log [fenêtre_s]
        [--capture <lignes du journal de la salle>]
    python3 spikes/xbox360/releve.py --bornes <emplacement>/xenia-horodate.log

Le compteur du jeu ne dit pas ce que les joueurs ont vu. Le 21 novembre 2026,
il donnait 59,5 images par seconde pendant que l'image envoyée était figée:
Xenia continuait le jeu mais ne présentait plus rien. Avec `--capture`, le
relevé lit aussi ce que la capture de la salle a reçu de Sway (ses lignes
`frames` et `capture_quiet`), et nomme le cas où l'image s'arrête pendant que
le jeu tourne. `just xbox360-releve` prend ces lignes dans le journal du
worker, entre la première et la dernière ligne de la partie (`--bornes`).
"""

from __future__ import annotations

import itertools
import json
import math
import re
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

LIGNE = re.compile(r"^(\S+) (\d+\.\d+) (.)> f:(\d{7}) ")
#: Une ligne du journal du worker, en `journalctl -o short-iso-precise`.
JOURNAL = re.compile(r"^(\S+) \S+ [^:]+: (\{.*\})\s*$")
#: Sous cette cadence, le jeu lui-même ralentit: un trou dans l'image n'est
#: alors pas un défaut de l'affichage. Le même seuil que les fenêtres lentes.
LENT = 25.0
#: Un trou d'image plus long que ce seuil se voit (celui de la page, `FREEZE_MS`).
TROU_MS = 500.0


@dataclass(frozen=True)
class Fenetre:
    debut: str
    secondes: float
    images: int
    ips: float
    shaders: int
    erreurs: int


def fenetres(lignes: list[str], largeur: float = 5.0) -> list[Fenetre]:
    """Découpe la partie en fenêtres de `largeur` secondes, de la première image à la dernière."""
    points = []
    for ligne in lignes:
        prise = LIGNE.match(ligne)
        if prise:
            heure, mono, sorte, image = prise.groups()
            texte = ligne[prise.end() :]
            points.append((heure, float(mono), int(image), sorte, texte))
    # La partie commence à la première image présentée: le chargement de Xenia avant
    # n'est pas une cadence.
    points = [p for p in points if p[2] > 0]
    sortie: list[Fenetre] = []
    if len(points) < 2:
        return sortie
    debut = 0
    while debut < len(points) - 1:
        fin = debut
        while fin + 1 < len(points) and points[fin + 1][1] - points[debut][1] <= largeur:
            fin += 1
        fin = max(fin, debut + 1)
        duree = points[fin][1] - points[debut][1]
        images = points[fin][2] - points[debut][2]
        tranche = points[debut : fin + 1]
        sortie.append(
            Fenetre(
                debut=points[debut][0],
                secondes=round(duree, 3),
                images=images,
                ips=round(images / duree, 1) if duree > 0 else 0.0,
                shaders=sum("pipeline not ready" in p[4] for p in tranche),
                erreurs=sum(p[3] == "!" for p in tranche),
            )
        )
        debut = fin
    return sortie


@dataclass(frozen=True)
class Capture:
    """Une ligne de la capture de la salle: ce que Sway lui a donné.

    `images` et `pire_ms` couvrent les cinq secondes avant `quand`; `silence`
    est un `capture_quiet` (plus rien depuis trois secondes), `relance` une
    capture arrêtée de force pour être relancée.
    """

    quand: datetime
    images: int | None = None
    pire_ms: float | None = None
    silence: bool = False
    relance: bool = False


def _heure(texte: str) -> datetime | None:
    try:
        quand = datetime.fromisoformat(texte.replace("Z", "+00:00"))
    except ValueError:
        return None
    return quand if quand.tzinfo is not None else None


def captures(lignes: list[str]) -> list[Capture]:
    """Les lignes de capture d'un extrait du journal du worker, dans l'ordre."""
    sortie: list[Capture] = []
    for ligne in lignes:
        prise = JOURNAL.match(ligne)
        if not prise or (quand := _heure(prise.group(1))) is None:
            continue
        try:
            champs = json.loads(prise.group(2))
        except ValueError:
            continue
        if not isinstance(champs, dict):
            continue
        if "frames" in champs:
            trous = champs.get("gap_ms") or []
            sortie.append(
                Capture(quand, int(champs["frames"]), float(trous[-1]) if trous else None)
            )
        elif "capture_quiet" in champs:
            sortie.append(Capture(quand, silence=True))
        elif "capture_child_forced" in champs:
            sortie.append(Capture(quand, relance=True))
    return sortie


def _images_du_jeu(lignes: list[str]) -> list[tuple[datetime, int]]:
    points = []
    for ligne in lignes:
        prise = LIGNE.match(ligne)
        if prise and (quand := _heure(prise.group(1))) is not None:
            points.append((quand, int(prise.group(4))))
    return points


def cadence_du_jeu(
    points: list[tuple[datetime, int]], debut: datetime, fin: datetime
) -> float | None:
    """Les images par seconde du jeu entre deux instants, ou None sans mesure."""
    dedans = [p for p in points if debut <= p[0] <= fin]
    if len(dedans) < 2 or dedans[-1][0] <= dedans[0][0]:
        return None
    secondes = (dedans[-1][0] - dedans[0][0]).total_seconds()
    return (dedans[-1][1] - dedans[0][1]) / secondes


def bornes(lignes: list[str]) -> tuple[int, int] | None:
    """Les secondes Unix qui encadrent la partie, pour `journalctl --since/--until`."""
    heures = [quand for ligne in lignes if (quand := _heure(ligne.split(" ", 1)[0]))]
    if not heures:
        return None
    return math.floor(heures[0].timestamp()), math.ceil(heures[-1].timestamp())


def image_et_jeu(lignes: list[str], vues: list[Capture]) -> str:
    """Ce que la salle a reçu, rapproché de ce que le jeu faisait au même moment."""
    if not vues:
        return "image reçue par la salle: aucune ligne de capture dans cet extrait du journal"
    points = _images_du_jeu(lignes)
    tranches = [c for c in vues if c.images is not None]
    silences = [c for c in vues if c.silence]
    # Un silence est déclaré trois secondes après la dernière image reçue.
    figees = [
        c
        for c in silences
        if (ips := cadence_du_jeu(points, c.quand - timedelta(seconds=3), c.quand)) is not None
        and ips >= LENT
    ]
    trous = [c for c in tranches if c.pire_ms is not None and c.pire_ms > TROU_MS]
    du_jeu = [
        c
        for c in trous
        if any(
            (ips := cadence_du_jeu(points, a[0], b[0])) is not None and ips < LENT
            for a, b in itertools.pairwise(points)
            if c.quand - timedelta(seconds=5) <= a[0] and b[0] <= c.quand + timedelta(seconds=1)
        )
    ]
    sortie = []
    if tranches:
        ips = [c.images / 5 for c in tranches]
        sortie.append(
            f"image reçue par la salle: {len(tranches)} tranches de 5 s, "
            f"médiane {statistics.median(ips):.1f} images/s, minimum {min(ips):.1f}"
        )
    sortie.append(
        f"silences de la capture: {len(silences)}, relances forcées: {sum(c.relance for c in vues)}"
    )
    sortie.append(
        f"trous de plus de {TROU_MS:.0f} ms dans l'image reçue: {len(trous)}, "
        f"dont {len(du_jeu)} pendant un ralentissement du jeu lui-même"
    )
    if figees:
        sortie.append(
            f"IMAGE FIGÉE PENDANT QUE LE JEU TOURNAIT: {len(figees)} fois, la première à "
            f"{figees[0].quand.astimezone().isoformat(timespec='seconds')}"
        )
    else:
        sortie.append("image figée pendant que le jeu tournait: jamais")
    return "\n".join(sortie)


def resume(sortie: list[Fenetre]) -> str:
    if not sortie:
        return "Aucune image présentée dans ce journal."
    ips = [f.ips for f in sortie]
    total = sum(f.secondes for f in sortie)
    images = sum(f.images for f in sortie)
    pire = sorted(sortie, key=lambda f: f.ips)[:5]
    lignes = [
        f"{images} images en {total:.0f} s: {images / total:.1f} images/s en moyenne",
        f"par fenêtre: médiane {statistics.median(ips):.1f}, minimum {min(ips):.1f}, "
        f"maximum {max(ips):.1f}",
        f"fenêtres sous 25 images/s: {sum(i < 25 for i in ips)} sur {len(ips)}",
        f"lignes « pipeline not ready » (shaders en compilation): {sum(f.shaders for f in sortie)}",
        f"lignes d'erreur: {sum(f.erreurs for f in sortie)}",
        "les cinq pires fenêtres:",
        *(f"  {f.debut}  {f.ips:5.1f} images/s ({f.images} en {f.secondes} s)" for f in pire),
    ]
    return "\n".join(lignes)


def _lire(chemin: str) -> list[str]:
    return Path(chemin).read_text(encoding="utf-8", errors="replace").splitlines()


def main(argv: list[str]) -> int:
    usage = "usage: releve.py <xenia-horodate.log> [fenêtre_s] [--capture <journal>]\n"
    if argv[:1] == ["--bornes"] and len(argv) == 2:
        if (paire := bornes(_lire(argv[1]))) is None:
            sys.stderr.write("aucune ligne horodatée dans ce journal\n")
            return 1
        sys.stdout.write(f"{paire[0]} {paire[1]}\n")
        return 0
    capture = None
    if "--capture" in argv:
        position = argv.index("--capture")
        if position + 1 >= len(argv):
            sys.stderr.write(usage)
            return 2
        capture = argv[position + 1]
        argv = argv[:position] + argv[position + 2 :]
    if not 1 <= len(argv) <= 2:
        sys.stderr.write(usage)
        return 2
    largeur = float(argv[1]) if len(argv) == 2 else 5.0
    lignes = _lire(argv[0])
    sys.stdout.write(resume(fenetres(lignes, largeur)) + "\n")
    if capture is not None:
        sys.stdout.write(image_et_jeu(lignes, captures(_lire(capture))) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
