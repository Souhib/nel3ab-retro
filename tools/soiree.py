#!/usr/bin/env python3
"""Ce qu'une soirée de jeu a montré, personne par personne.

Relit ce que la machine garde d'elle-même, sans rien lancer:

- le journal des séances du salon, où chaque page envoie ses relevés toutes les
  dix secondes (images reçues et jetées, trous de son, volume, format);
- les captures de la boîte noire, avec la portée de chaque gel (salle ou page);
- le journal des workers, pour les chaînes cassées de chaque spectateur.

Écrit le 23 septembre 2026 pour la première soirée « batterie de tests »: la
sourdine ferme désormais la socket du son, et une personne qui coupe puis remet
le son donne une comparaison réelle, sur sa propre liaison, entre l'image avec
son et l'image sans. C'est la mesure qui décide de la proposition d'amendement
de D10 (`docs/adr/proposition-d10-opus.md`), avec celle du banc.

    python3 tools/soiree.py 2026-09-23
    python3 tools/soiree.py 2026-09-23 --depuis 20:00

Les pilotes d'essai (`banc`) sont écartés. Rien n'est écrit.
"""

import argparse
import json
import statistics
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ETAT = Path.home() / ".local/state/nel3ab"
GEL_MS = 500
#: Un gel qui tombe dans ces secondes après un changement de jeu est d'abord un
#: démarrage: le 25 septembre 2026, les 35,6 s « gelées » à 00:29 suivaient de
#: 53 s le lancement de Smash Ultimate, dont la capture a attendu 30 s son
#: premier paquet. La boîte noire a eu raison de le prendre; le rapport doit dire
#: que ce n'était pas en pleine partie.
APRES_CHANGEMENT_S = 120


def fenetres(jour: str, depuis: str | None) -> list[dict]:
    """Les relevés de dix secondes des vraies pages, dans l'ordre."""
    fichier = ETAT / "sessions" / f"{jour}.jsonl"
    if not fichier.exists():
        raise SystemExit(f"aucun journal des séances pour {jour}: {fichier}")
    lignes = []
    for brute in fichier.read_text(encoding="utf-8").splitlines():
        try:
            ligne = json.loads(brute)
        except ValueError:
            continue
        if ligne.get("banc"):
            continue
        if depuis and ligne.get("quand", "")[11:16] < depuis:
            continue
        lignes.append(ligne)
    return lignes


def resume_personne(mesures: list[dict]) -> dict:
    vus = [m["vu"] for m in mesures if isinstance(m.get("vu"), dict)]
    arrivees = [v.get("vues", 0) / max(v.get("s", 10), 1) for v in vus]
    pires = [v["arrivées"][2] for v in vus if isinstance(v.get("arrivées"), list)]
    son = [v.get("son", {}) for v in vus]
    return {
        "fenêtres": len(vus),
        "images/s (médiane)": round(statistics.median(arrivees), 1) if arrivees else None,
        "jetées": sum(v.get("jetées", 0) for v in vus),
        "affamées": sum(v.get("affamées", 0) for v in vus),
        f"fenêtres gelées (≥{GEL_MS} ms)": sum(1 for p in pires if p >= GEL_MS),
        "pire écart (ms)": max(pires) if pires else None,
        "format réduit": f"{sum(1 for v in vus if v.get('demi'))}/{len(vus)}",
        "trous de son": sum(s.get("trous", 0) for s in son),
        "fenêtres en sourdine": sum(1 for s in son if s.get("gain", 1) == 0),
    }


def sourdine_contre_son(mesures: list[dict]) -> dict | None:
    """La comparaison naturelle: les fenêtres en sourdine contre les autres.

    Une fenêtre compte « en sourdine » si le volume est à zéro ET qu'aucun
    morceau de son n'est arrivé: la seconde condition prouve que la socket était
    vraiment fermée, et pas seulement le volume baissé. Les fenêtres de
    transition (volume à zéro, morceaux encore reçus) sont écartées."""
    avec, sans = [], []
    for m in mesures:
        v = m.get("vu") or {}
        s = v.get("son") or {}
        if v.get("demi") is None:
            continue
        if s.get("gain", 1) == 0 and s.get("morceaux", 0) == 0:
            sans.append(v)
        elif s.get("gain", 0) > 0 and s.get("morceaux", 0) > 0:
            avec.append(v)
    if not sans or not avec:
        return None

    def lire(groupe: list[dict]) -> dict:
        pires = [v["arrivées"][2] for v in groupe if isinstance(v.get("arrivées"), list)]
        return {
            "fenêtres": len(groupe),
            "images/s": round(
                statistics.mean(v.get("vues", 0) / max(v.get("s", 10), 1) for v in groupe), 1
            ),
            "jetées par fenêtre": round(statistics.mean(v.get("jetées", 0) for v in groupe), 2),
            "gels par fenêtre": round(sum(1 for p in pires if p >= GEL_MS) / len(groupe), 3),
        }

    return {"avec le son": lire(avec), "en sourdine": lire(sans)}


def captures(jour: str, changements: list[datetime]) -> list[str]:
    dossier = ETAT / "boite-noire" / "captures"
    sortie = []
    for chemin in sorted(dossier.glob(f"{jour}T*-chute")):
        try:
            d = json.loads((chemin / "capture.json").read_text())
        except (OSError, ValueError):
            continue
        det = d.get("details", {})
        quand = datetime.strptime(chemin.name[:19], "%Y-%m-%dT%H-%M-%S")
        juste_apres = [
            (quand - c).total_seconds()
            for c in changements
            if 0 <= (quand - c).total_seconds() <= APRES_CHANGEMENT_S
        ]
        note = f"  {int(min(juste_apres))} s après un changement de jeu" if juste_apres else ""
        sortie.append(
            f"{chemin.name[11:19]}  {det.get('cause')}  portée {det.get('portee', '?')}"
            f"  page {det.get('page') or '-'}  gel {det.get('gel_ms')} ms  {det.get('jeu')}{note}"
        )
    return sortie


def chaines_cassees(jour: str) -> dict:
    """Les spectateurs qui n'ont pas suivi, d'après les workers de toutes les salles."""
    debut = datetime.fromisoformat(jour)
    fin = debut + timedelta(days=1, hours=6)
    sortie = subprocess.run(
        ["journalctl", "-u", "nel3ab-worker@*", "--since", str(debut), "--until", str(fin),
         "-o", "cat", "--no-pager"],
        capture_output=True, text=True, check=False,
    ).stdout
    cumul: dict = defaultdict(lambda: {"chaînes cassées": 0, "images manquées": 0})
    for brute in sortie.splitlines():
        try:
            champs = json.loads(brute).get("fields", {})
        except ValueError:
            continue
        if champs.get("message") != "ce spectateur ne suit pas":
            continue
        cle = f"spectateur {champs.get('viewer')} ({champs.get('stream')})"
        cumul[cle]["chaînes cassées"] += champs.get("breaks_now", 0)
        cumul[cle]["images manquées"] += champs.get("missed_now", 0)
    return dict(cumul)


def main() -> None:
    lecteur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    lecteur.add_argument("jour", help="AAAA-MM-JJ")
    lecteur.add_argument("--depuis", help="HH:MM, heure de Paris")
    args = lecteur.parse_args()

    lignes = fenetres(args.jour, args.depuis)
    changements = [
        datetime.fromisoformat(ligne["quand"]).replace(tzinfo=None)
        for ligne in fenetres(args.jour, None)
        if ligne.get("quoi") == "changement" and ligne.get("quand")
    ]
    par_personne: dict = defaultdict(list)
    qualite = defaultdict(int)
    sourdines: dict = defaultdict(list)
    for ligne in lignes:
        if ligne.get("quoi") == "mesures":
            par_personne[ligne.get("pseudo") or ligne.get("visite")].append(ligne)
        if ligne.get("quoi") == "son":
            qui = ligne.get("pseudo") or ligne.get("visite")
            sourdines[qui].append(f"{ligne.get('quand', '')[11:19]} {ligne.get('etat')}")
        if ligne.get("quoi") == "qualité":
            qualite[f"{ligne.get('pseudo')}: {ligne.get('choix')}"] += 1

    print(f"# Soirée du {args.jour}" + (f", depuis {args.depuis}" if args.depuis else ""))
    for qui, mesures in sorted(par_personne.items()):
        print(f"\n## {qui}")
        for cle, valeur in resume_personne(mesures).items():
            print(f"  {cle:28} {valeur}")
        if sourdines.get(qui):
            # Écrit par le salon depuis le 23 septembre 2026, à la seconde.
            print(f"  sourdine: {', '.join(sourdines[qui])}")
        comparaison = sourdine_contre_son(mesures)
        if comparaison:
            print("  sourdine contre son:")
            for groupe, chiffres in comparaison.items():
                print(f"    {groupe:14} {chiffres}")

    print("\n## Propositions de format réduit")
    for cle, nombre in sorted(qualite.items()) or [("aucune", 0)]:
        print(f"  {cle} ×{nombre}" if nombre else f"  {cle}")

    print("\n## Gels capturés par la boîte noire")
    for ligne in captures(args.jour, changements) or ["  aucun"]:
        print(f"  {ligne}")

    print("\n## Chaînes cassées, par spectateur (journal des workers)")
    for cle, chiffres in sorted(chaines_cassees(args.jour).items()) or [("aucune", {})]:
        print(f"  {cle} {chiffres}")


if __name__ == "__main__":
    main()
