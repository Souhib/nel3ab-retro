#!/usr/bin/env python3
"""Relit une partie Xbox 360: les images par seconde du jeu, fenêtre par fenêtre.

Xenia préfixe chacune de ses lignes par le compteur d'images que le jeu a
présentées (« f:0002566 »), et `--guest_scheduler_stats` lui fait écrire une
ligne par seconde. `xenia.sh` horodate chaque ligne (heure UTC, horloge
monotone). Le rapport entre les deux donne la cadence du jeu lui-même, avant
toute capture, tout encodage et tout réseau.

    python3 spikes/xbox360/releve.py <emplacement>/xenia-horodate.log [fenêtre_s]

Ce que ce relevé ne dit pas: ce que les joueurs ont vu. La cadence de la page
est dans la boîte noire (`just boite-noire`), et l'image par seconde envoyée
dans le journal de la salle.
"""

from __future__ import annotations

import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

LIGNE = re.compile(r"^(\S+) (\d+\.\d+) (.)> f:(\d{7}) ")


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


def main(argv: list[str]) -> int:
    if not 1 <= len(argv) <= 2:
        sys.stderr.write("usage: releve.py <xenia-horodate.log> [fenêtre_s]\n")
        return 2
    largeur = float(argv[1]) if len(argv) == 2 else 5.0
    lignes = Path(argv[0]).read_text(encoding="utf-8", errors="replace").splitlines()
    sys.stdout.write(resume(fenetres(lignes, largeur)) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
