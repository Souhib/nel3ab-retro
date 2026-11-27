#!/usr/bin/env python3
"""Les compilations de shaders d'une partie Switch, fenêtre de capture par fenêtre.

Le 26 novembre 2026, pendant Smash, le pilote Mesa a écrit 120 entrées nouvelles
dans le cache du jeu, en six rafales, et les 8 fenêtres de 5 s de la capture qui
en contenaient une avaient toutes un trou de plus de 30 ms (constats RYU-1 et
DON-2). Rien ne le disait: il a fallu croiser à la main le cache, le journal du
worker, le journal du moteur et les relevés de la boîte noire. Cet outil le fait
après chaque partie, sans rien lancer et sans rien écrire.

Pour chaque fenêtre de la capture (journal du worker), il range:

- les entrées Mesa nouvelles, datées par leur fichier, hors `index` et `marker`;
- les lignes « GPU processing thread is too slow » et « Background pipeline
  compile missed on draw » du moteur. Ryubing ne les écrit qu'une fois par
  programme nouveau (ShaderCollection.cs:157 et 677-680): elles ne comptent pas
  les compilations;
- l'étiquette « compilation » quand une entrée Mesa tombe dans la fenêtre, et
  « chargement » quand un relevé de la boîte noire qui la chevauche voit le fil
  de décompression du jeu (`<ResInflateThre`) à 15 % d'un cœur ou plus.

`shared.toc`, le cache de programmes de Ryubing, n'a pas d'heure par programme:
un en-tête de 32 octets, puis 8 octets par programme (DiskCacheHostStorage.cs:27
et 219). L'outil en dit le nombre au départ (« Loading N shaders » du moteur), à
la fin, et la fenêtre de sa dernière écriture.

# L'heure du moteur

Ryubing date ses lignes d'un chronomètre remis à zéro une fois après sa bannière
(Logger.cs:153). Avec `--heures-docker`, une copie du journal du conteneur faite
avec `docker logs --timestamps` (celle d'une capture de la boîte noire), l'heure
de départ est l'écart le plus petit entre l'heure Docker et l'heure du moteur,
sur les lignes d'après la remise à zéro; la copie doit partager au moins dix
lignes avec le journal du moteur, sinon elle vient d'une autre partie et l'outil
refuse. Sans elle, il prend l'heure du nom du fichier, à la seconde près, et le
dit.

    python3 tools/compilations-switch.py \\
        --journal-worker worker.log \\
        --mesa ~/.local/state/nel3ab/switch/01006a800016e000/mesa \\
        --toc ~/.local/state/nel3ab/switch/01006a800016e000/cache/shader/shared.toc \\
        --journal-moteur .../Logs/Ryujinx_…_2026-11-26_23-32-33.log \\
        --heures-docker ~/.local/state/nel3ab/boite-noire/captures/<dossier>/emulateur.log \\
        --releves ~/.local/state/nel3ab/boite-noire/releves/2026-11-27.jsonl

`worker.log` vient de `journalctl -u nel3ab-worker@1 --since … --until …
-o short-iso-precise`. Une partie sans fenêtre de capture (Dolphin, encodé par
le worker) écrit « non mesuré ». `--json` rend le résultat pour un autre outil.
"""

import argparse
import json
import os
import re
import sys
from datetime import UTC, datetime, timedelta, tzinfo
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

#: La période des rapports de la capture (`spikes/switch-room/capture.py`).
FENETRE_S = 5.0
#: À partir de quelle part d'un cœur le fil de décompression dit « chargement ».
#: Choisi sur la seule partie du 26 novembre 2026 (DON-9): à revoir sur d'autres jeux.
CHARGEMENT_PCT = 15.0
FIL_CHARGEMENT = "<ResInflateThre"
ENTETE_TOC, ENTREE_TOC = 32, 8
HORS_MESA = ("index", "marker")
LENT = "GPU processing thread is too slow"
MANQUE = "Background pipeline compile missed on draw"
NON_MESURE = "non mesuré"
#: Combien de lignes une copie Docker doit partager avec le journal du moteur.
LIGNES_COMMUNES = 10

_JOURNAL = re.compile(r"^(\S+) \S+ \S+: (\{.*\})\s*$")
_MOTEUR = re.compile(r"^(\d+):(\d\d):(\d\d)\.(\d{3}) (.*)$")
_DOCKER = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z (.*)$")
_NOM = re.compile(r"_(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d)-(\d\d)\.log$")
_CHARGES = re.compile(r"Loading (\d+) shaders from the cache")


class RefusError(Exception):
    """Une entrée qui ne permet pas de conclure: l'outil s'arrête et dit pourquoi."""


def fenetres(texte: str) -> list[tuple[datetime, datetime, int, float]]:
    """Les fenêtres pleines de la capture: début, fin, images, pire écart.

    Une fenêtre commence à la fin de la précédente quand elles se suivent, pour
    qu'aucun instant ne tombe entre deux; après un trou de la capture, cinq
    secondes avant sa fin. Le demi-format a ses propres fenêtres et n'est pas lu.
    """
    lues: list[tuple[datetime, int, float]] = []
    for ligne in texte.splitlines():
        trouve = _JOURNAL.match(ligne)
        if not trouve:
            continue
        try:
            fin = datetime.fromisoformat(trouve.group(1))
            rapport = json.loads(trouve.group(2))
        except ValueError:
            continue
        if not isinstance(rapport, dict) or rapport.get("half") is not False:
            continue
        images, ecarts = rapport.get("frames"), rapport.get("gap_ms")
        if fin.tzinfo is None or not isinstance(images, int) or not isinstance(ecarts, list):
            continue
        if len(ecarts) == 3 and isinstance(ecarts[2], int | float):
            lues.append((fin, images, float(ecarts[2])))
    lues.sort()
    rangees: list[tuple[datetime, datetime, int, float]] = []
    for rang, (fin, images, pire) in enumerate(lues):
        debut = fin - timedelta(seconds=FENETRE_S)
        if rang:
            precedente = lues[rang - 1][0]
            if (fin - precedente).total_seconds() <= 1.5 * FENETRE_S:
                debut = precedente
        rangees.append((debut, fin, images, pire))
    return rangees


def entrees_mesa(dossier: Path) -> list[datetime]:
    """L'heure de chaque entrée du cache Mesa, hors `index` et `marker`."""
    heures: list[datetime] = []
    for racine, _, fichiers in os.walk(dossier):
        for nom in fichiers:
            if nom in HORS_MESA:
                continue
            try:
                ns = os.stat(Path(racine) / nom).st_mtime_ns
            except OSError:
                continue
            heures.append(datetime.fromtimestamp(ns / 1e9, UTC))
    return sorted(heures)


def _relatif(ligne: str) -> tuple[timedelta, str] | None:
    trouve = _MOTEUR.match(ligne)
    if not trouve:
        return None
    heures, minutes, secondes, millis = (int(trouve.group(i)) for i in range(1, 5))
    duree = timedelta(hours=heures, minutes=minutes, seconds=secondes, milliseconds=millis)
    return duree, trouve.group(5)


def t0_docker(docker: str, moteur: str) -> datetime:
    """L'heure du zéro du chronomètre du moteur, lue dans une copie `--timestamps`."""
    ecarts: list[tuple[datetime, str]] = []
    for ligne in docker.splitlines():
        trouve = _DOCKER.match(ligne)
        if not trouve:
            continue
        lu = _relatif(trouve.group(3))
        if lu is None:
            continue
        fraction = (trouve.group(2) or "0")[:6].ljust(6, "0")
        heure = datetime.fromisoformat(trouve.group(1)).replace(
            tzinfo=UTC, microsecond=int(fraction)
        )
        ecarts.append((heure - lu[0], trouve.group(3)))
    if not ecarts:
        raise RefusError("la copie Docker n'a aucune ligne datée du moteur")
    dernier = ecarts[-1][0]
    # Les lignes d'après la dernière remise à zéro: leur écart est celui de la fin.
    apres = [
        (ecart, texte) for ecart, texte in ecarts if abs((ecart - dernier).total_seconds()) < 0.5
    ]
    communes = set(moteur.splitlines()) & {texte for _, texte in apres}
    if len(communes) < LIGNES_COMMUNES:
        raise RefusError(
            f"la copie Docker ne partage que {len(communes)} lignes avec le journal du "
            f"moteur (il en faut {LIGNES_COMMUNES}): elle vient d'une autre partie"
        )
    return min(ecart for ecart, _ in apres)


def t0_nom(chemin: Path) -> datetime | None:
    """L'heure du nom du journal de Ryubing, à la seconde, en UTC (le conteneur)."""
    trouve = _NOM.search(chemin.name)
    if not trouve:
        return None
    jour, h, m, s = trouve.groups()
    return datetime.fromisoformat(f"{jour}T{h}:{m}:{s}+00:00")


def avertissements(moteur: str, t0: datetime) -> list[tuple[datetime, str]]:
    """Les lignes « too slow » et « missed on draw », à l'heure du mur."""
    vus: list[tuple[datetime, str]] = []
    for ligne in moteur.splitlines():
        lu = _relatif(ligne)
        if lu is None:
            continue
        if LENT in lu[1]:
            vus.append((t0 + lu[0], "lents"))
        elif MANQUE in lu[1]:
            vus.append((t0 + lu[0], "manques"))
    return vus


def chargements(releves: str) -> list[tuple[datetime, datetime]]:
    """Les intervalles de relevé où le fil de décompression a pris 15 % ou plus."""
    vus: list[tuple[datetime, datetime]] = []
    for brute in releves.splitlines():
        try:
            ligne = json.loads(brute)
            fin = datetime.fromisoformat(ligne["quand"])
            duree = float(ligne["intervalle_s"])
        except (ValueError, KeyError, TypeError):
            continue
        if ligne.get("quoi") != "relevé" or fin.tzinfo is None:
            continue
        for moteur in ligne.get("moteurs") or []:
            for fil in (moteur.get("fils") or []) if isinstance(moteur, dict) else []:
                pct = fil.get("cpu_pct") if isinstance(fil, dict) else None
                if (
                    str(fil.get("nom", "")).startswith(FIL_CHARGEMENT)
                    and isinstance(pct, int | float)
                    and pct >= CHARGEMENT_PCT
                ):
                    vus.append((fin - timedelta(seconds=duree), fin))
    return vus


def ranger(
    capture: str,
    mesa: list[datetime],
    toc: tuple[int, datetime] | None,
    charges: int | None,
    vus: list[tuple[datetime, str]],
    lourds: list[tuple[datetime, datetime]],
    zone: tzinfo,
) -> dict[str, Any]:
    """Une entrée par fenêtre de capture, ou « non mesuré » sans capture."""
    rangees = fenetres(capture)
    resultat: dict[str, Any] = {}
    if toc is None:
        resultat["toc"] = NON_MESURE
    else:
        programmes, ecrit = toc
        resultat["toc"] = {
            "au_depart": charges if charges is not None else NON_MESURE,
            "a_la_fin": programmes,
            "nouveaux": programmes - charges if charges is not None else NON_MESURE,
            "derniere_ecriture": ecrit.astimezone(zone).strftime("%H:%M:%S.%f")[:12],
        }
    if not rangees:
        resultat["fenetres"] = NON_MESURE
        return resultat
    debut_partie, fin_partie = rangees[0][0], rangees[-1][1]
    resultat["mesa_pendant"] = sum(1 for heure in mesa if debut_partie < heure <= fin_partie)
    lignes: list[dict[str, Any]] = []
    for debut, fin, images, pire in rangees:
        dans = sum(1 for heure in mesa if debut < heure <= fin)
        une: dict[str, Any] = {
            "fin": fin.astimezone(zone).strftime("%H:%M:%S"),
            "pire_ms": pire,
            "images": images,
            "mesa": dans,
            "lents": sum(1 for heure, genre in vus if genre == "lents" and debut < heure <= fin),
            "manques": sum(
                1 for heure, genre in vus if genre == "manques" and debut < heure <= fin
            ),
        }
        etiquettes = []
        if dans or (toc is not None and debut < toc[1] <= fin):
            etiquettes.append("compilation")
        if any(bas < fin and haut > debut for bas, haut in lourds):
            etiquettes.append("chargement")
        une["etiquettes"] = etiquettes
        if toc is not None and debut < toc[1] <= fin:
            une["toc_derniere_ecriture"] = True
        lignes.append(une)
    resultat["fenetres"] = lignes
    return resultat


def _lire(chemin: Path | None) -> str:
    if chemin is None:
        return ""
    try:
        return chemin.read_text(encoding="utf-8", errors="replace")
    except OSError as erreur:
        raise RefusError(f"{chemin}: {erreur.strerror}") from erreur


def main(arguments: list[str]) -> int:
    lecteur = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    lecteur.add_argument("--journal-worker", type=Path, required=True)
    lecteur.add_argument("--mesa", type=Path)
    lecteur.add_argument("--toc", type=Path)
    lecteur.add_argument("--journal-moteur", type=Path)
    lecteur.add_argument("--heures-docker", type=Path)
    lecteur.add_argument("--t0", type=datetime.fromisoformat)
    lecteur.add_argument("--releves", type=Path)
    lecteur.add_argument("--zone", default="Europe/Paris")
    lecteur.add_argument("--json", action="store_true")
    options = lecteur.parse_args(arguments)
    zone = ZoneInfo(options.zone)
    try:
        moteur = _lire(options.journal_moteur)
        t0, source = None, NON_MESURE
        if options.t0 is not None:
            t0, source = options.t0, "--t0"
        elif options.heures_docker is not None:
            t0, source = t0_docker(_lire(options.heures_docker), moteur), "docker"
        elif options.journal_moteur is not None:
            t0 = t0_nom(options.journal_moteur)
            source = "nom du fichier, à la seconde" if t0 else NON_MESURE
        toc = None
        if options.toc is not None:
            infos = options.toc.stat()
            toc = (
                (infos.st_size - ENTETE_TOC) // ENTREE_TOC,
                datetime.fromtimestamp(infos.st_mtime_ns / 1e9, UTC),
            )
        charges = _CHARGES.search(moteur)
        resultat = ranger(
            _lire(options.journal_worker),
            entrees_mesa(options.mesa) if options.mesa else [],
            toc,
            int(charges.group(1)) if charges else None,
            avertissements(moteur, t0) if t0 else [],
            chargements(_lire(options.releves)),
            zone,
        )
    except (RefusError, OSError) as refus:
        sys.stderr.write(f"compilations-switch: {refus}\n")
        return 2
    resultat = {
        "t0": {"heure": t0.isoformat() if t0 else NON_MESURE, "source": source},
        "zone": options.zone,
        **resultat,
    }
    sys.stdout.write("\n".join(_texte(resultat, source, options.json)) + "\n")
    return 0


def _texte(resultat: dict[str, Any], source: str, en_json: bool) -> list[str]:
    """Le résultat pour un terminal, ou en JSON pour un autre outil."""
    if en_json:
        return [json.dumps(resultat, ensure_ascii=False, indent=1)]
    lignes = [
        f"heure du moteur: {resultat['t0']['heure']} ({source}); heures de {resultat['zone']}",
        f"shared.toc: {resultat['toc']}",
    ]
    if resultat["fenetres"] == NON_MESURE:
        return [*lignes, f"fenêtres de capture: {NON_MESURE}"]
    lignes.append(f"entrées Mesa pendant la capture: {resultat['mesa_pendant']}")
    for une in resultat["fenetres"]:
        if une["mesa"] or une["lents"] or une["manques"] or une["etiquettes"]:
            lignes.append(
                f"{une['fin']}  {une['pire_ms']:7.1f} ms  mesa {une['mesa']:3d}  "
                f"lents {une['lents']}  manques {une['manques']}  {' '.join(une['etiquettes'])}"
            )
    return lignes


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
