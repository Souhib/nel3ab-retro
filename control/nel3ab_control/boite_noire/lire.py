"""Relire la boîte noire: la machine et les pages, rangées sur la même horloge.

Le relevé de la machine et la mesure des pages sont écrits par deux services
différents, à des rythmes différents: deux secondes pour l'un, dix pour l'autre.
Les ranger par tranches de dix secondes sur l'heure des joueurs est ce qui les
rend lisibles ensemble, et c'est tout ce que ce module fait. Pas de verdict: ce
qu'on cherche après une plainte ne se connaît pas d'avance.
"""

import json
from collections import defaultdict
from datetime import date, datetime, time
from pathlib import Path
from statistics import mean, median
from typing import Any


def charger(fichier: Path) -> list[dict[str, Any]]:
    """Les lignes datées d'un fichier JSONL; une ligne cassée est sautée."""
    try:
        brutes = fichier.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    lignes: list[dict[str, Any]] = []
    for brute in brutes:
        try:
            ligne = json.loads(brute)
        except ValueError:
            continue
        if isinstance(ligne, dict) and isinstance(ligne.get("quand"), str):
            lignes.append(ligne)
    return lignes


def _instant(ligne: dict[str, Any]) -> datetime | None:
    try:
        quand = datetime.fromisoformat(ligne["quand"])
    except (ValueError, KeyError, TypeError):
        return None
    return quand if quand.tzinfo is not None else None


def _nombre(valeur: object) -> float | None:
    if isinstance(valeur, bool) or not isinstance(valeur, int | float):
        return None
    return float(valeur)


def tranches(
    releves: list[dict[str, Any]],
    pages: list[dict[str, Any]],
    pas_s: int = 10,
    debut: time | None = None,
    fin: time | None = None,
) -> list[dict[str, Any]]:
    """Une entrée par tranche de `pas_s` secondes où quelque chose a été écrit."""
    seaux: dict[datetime, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(list))

    def cle(quand: datetime) -> datetime:
        return quand.replace(second=quand.second - quand.second % pas_s, microsecond=0)

    for ligne in releves:
        quand = _instant(ligne)
        if ligne.get("quoi") != "relevé" or quand is None:
            continue
        seau = seaux[cle(quand)]
        for moteur in ligne.get("moteurs") or []:
            if not isinstance(moteur, dict):
                continue
            if (pct := _nombre(moteur.get("cpu_pct"))) is not None:
                seau["moteur_pct"].append(pct)
            fils = moteur.get("fils") or []
            if fils and isinstance(fils[0], dict):
                seau["fil"].append(
                    (_nombre(fils[0].get("cpu_pct")) or 0.0, str(fils[0].get("nom")))
                )
            objets = moteur.get("objets_gpu")
            if isinstance(objets, dict) and (nombre := _nombre(objets.get("objets"))) is not None:
                seau["objets"].append(nombre)
        gpu = ligne.get("gpu") or {}
        if (occupe := _nombre(gpu.get("occupe_pct"))) is not None:
            seau["gpu"].append(occupe)
        if gpu.get("horloge"):
            seau["horloge"].append(str(gpu["horloge"]))
        if (tctl := _nombre((ligne.get("capteurs") or {}).get("k10temp/Tctl"))) is not None:
            seau["tctl"].append(tctl)
        frequences = [_nombre(mhz) for mhz in (ligne.get("cpu") or {}).get("mhz") or []]
        if frequences and all(mhz is not None for mhz in frequences):
            seau["mhz"].append(mean(mhz for mhz in frequences if mhz is not None))
        if (blocs := _nombre((ligne.get("allocateur_vram") or {}).get("blocs_libres"))) is not None:
            seau["blocs"].append(blocs)
        if (cout := _nombre((ligne.get("boite_noire") or {}).get("cpu_pct"))) is not None:
            seau["boite_noire"].append(cout)

    for ligne in pages:
        quand = _instant(ligne)
        if ligne.get("quoi") != "mesures" or ligne.get("banc") or quand is None:
            continue
        cadence = _nombre((ligne.get("vu") or {}).get("jeuHz"))
        if cadence is None or cadence <= 0:
            continue
        seau = seaux[cle(quand)]
        seau["cadence"].append(cadence)
        seau["visites"].append(ligne.get("visite"))

    resultat: list[dict[str, Any]] = []
    for quand in sorted(seaux):
        if (debut and quand.time() < debut) or (fin and quand.time() > fin):
            continue
        seau = seaux[quand]
        entree: dict[str, Any] = {"quand": quand}
        if seau["cadence"]:
            entree["pages"] = {
                "mediane": median(seau["cadence"]),
                "min": min(seau["cadence"]),
                "pages": len(set(seau["visites"])),
            }
        if seau["fil"]:
            pct, nom = max(seau["fil"])
            entree["fil"] = {"nom": nom, "cpu_pct": pct}
        for nom, valeurs, calcul in (
            ("moteur_pct", seau["moteur_pct"], max),
            ("gpu_pct", seau["gpu"], mean),
            ("tctl", seau["tctl"], max),
            ("mhz", seau["mhz"], mean),
            ("boite_noire_pct", seau["boite_noire"], mean),
        ):
            if valeurs:
                entree[nom] = round(calcul(valeurs), 1)
        for nom, valeurs in (
            ("horloge", seau["horloge"]),
            ("blocs", seau["blocs"]),
            ("objets", seau["objets"]),
        ):
            if valeurs:
                entree[nom] = valeurs[-1]
        resultat.append(entree)
    return resultat


def captures(dossier: Path, jour: date) -> list[dict[str, Any]]:
    """Les captures d'un jour, dans l'ordre, telles que `capture.json` les décrit."""
    trouvees: list[dict[str, Any]] = []
    try:
        dossiers = sorted(dossier.iterdir())
    except OSError:
        return trouvees
    for chemin in dossiers:
        if not chemin.name.startswith(jour.isoformat()):
            continue
        try:
            meta = json.loads((chemin / "capture.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            trouvees.append({"dossier": chemin.name, "incomplete": True})
            continue
        if isinstance(meta, dict):
            trouvees.append({"dossier": chemin.name, **meta})
    return trouvees
