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


def _recues_par_seconde(vu: dict[str, Any]) -> float | None:
    """Les images arrivées à la page par seconde, ou `jeuHz` pour les lignes sans ce compte.

    `jeuHz` n'est pas un compte: c'est l'inverse de l'écart MÉDIAN entre deux
    images reçues. Il donne le pas de Sway (62 pour un jeu à 60, les sorties
    sans écran de wlroots 0.17 composant toutes les 16 ms), et, quand la page
    a moins de trente écarts, la cadence de son ÉCRAN: le 21 novembre 2026,
    pendant le gel de Sonic, il valait 250 alors que la page recevait
    0,1 image par seconde.
    """
    vues, duree = _nombre(vu.get("vues")), _nombre(vu.get("s"))
    if vues is not None and duree is not None and duree > 0:
        return vues / duree
    ancienne = _nombre(vu.get("jeuHz"))
    return ancienne if ancienne is not None and ancienne > 0 else None


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
        cadence = _recues_par_seconde(ligne.get("vu") or {})
        if cadence is None:
            continue
        seau = seaux[cle(quand)]
        seau["cadence"].append(cadence)
        seau["visites"].append(ligne.get("visite"))
        # Ce que les pages écrivent depuis le 14 septembre 2026. Les lignes d'avant
        # n'ont ni l'un ni l'autre, et leur tranche n'en invente pas.
        vu = ligne.get("vu") or {}
        if (aller := _nombre((vu.get("manette") or {}).get("allerRetour"))) is not None:
            seau["aller_retour"].append(aller)
        arrivees = vu.get("arrivées")
        pire = _nombre(arrivees[2]) if isinstance(arrivees, list) and len(arrivees) == 3 else None
        # Zéro n'est pas un écart: c'est ce qu'écrit une page qui a reçu moins de
        # deux images dans sa fenêtre. Le 21 novembre 2026, une tranche du gel de
        # Sonic affichait ainsi « reçue 0 ms ». L'attente de l'image suivante,
        # écrite par les pages depuis ce jour, dit le gel pendant qu'il dure.
        pire = max(pire or 0.0, _nombre(vu.get("attente")) or 0.0)
        if pire > 0:
            seau["arrivee_max"].append(pire)

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
            # Le PIRE des pages: un arrêt du jeu tombe sur toutes à la fois, une
            # liaison qui hoquette sur une seule, et le pire montre les deux.
            ("arrivee_max", seau["arrivee_max"], max),
            ("aller_retour", seau["aller_retour"], max),
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
