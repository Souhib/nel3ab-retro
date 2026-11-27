"""Relire la boîte noire d'une soirée, par tranches de dix secondes.

La machine et les pages sur la même ligne: la cadence que les joueurs ont vue, le
fil le plus occupé de l'émulateur, le GPU, la température, l'allocateur de la
mémoire vidéo, et ce que la boîte noire elle-même a coûté. Puis les captures du
jour, avec leur raison.

    just boite-noire                          aujourd'hui
    just boite-noire 2026-09-14               ce jour-là
    just boite-noire 2026-09-14 00:15-00:40   seulement cette plage
    just boite-noire 2026-11-27 --phases 00:33-00:36,00:36-00:39
                                              ces phases côte à côte

Comparer des phases refuse celles qui n'ont pas tourné sur le même noyau
(`lire.comparer_phases`), et sort alors avec le code 2.
"""

import sys
from datetime import date, datetime, time
from typing import Any

from nel3ab_control.boite_noire.lire import (
    NoyauxDifferentsError,
    captures,
    charger,
    comparer_phases,
    tranches,
)
from nel3ab_control.journal import _zone
from nel3ab_control.settings import Settings


def _plage(texte: str) -> tuple[time, time]:
    debut, _, fin = texte.partition("-")
    return time.fromisoformat(debut), time.fromisoformat(fin)


def _ligne(entree: dict[str, Any]) -> str:
    morceaux = [entree["quand"].strftime("%H:%M:%S")]
    pages = entree.get("pages")
    morceaux.append(
        f"pages {pages['mediane']:4.0f} img/s (min {pages['min']:3.0f}, {pages['pages']})"
        if pages
        else "pages      -"
    )
    fil = entree.get("fil")
    morceaux.append(f"{fil['nom'][:16]:16} {fil['cpu_pct']:5.1f} %" if fil else " " * 24)
    for cle, forme in (
        ("arrivee_max", "reçue {:4.0f} ms"),
        ("aller_retour", "manette {:3.0f} ms"),
        ("moteur_pct", "moteur {:5.0f} %"),
        ("gpu_pct", "gpu {:3.0f} %"),
        ("horloge", "{:>8}"),
        ("tctl", "{:4.1f} °C"),
        ("mhz", "{:4.0f} MHz"),
        ("blocs", "blocs {:>7.0f}"),
        ("objets", "objets {:>6.0f}"),
        ("boite_noire_pct", "bn {:3.1f} %"),
    ):
        if cle in entree:
            morceaux.append(forme.format(entree[cle]))
    return "  ".join(morceaux)


def _phases(releves: list[dict[str, Any]], pages: list[dict[str, Any]], texte: str) -> None:
    """Les phases côte à côte, ou le refus de les comparer."""
    try:
        phases = comparer_phases(releves, pages, [_plage(une) for une in texte.split(",")])
    except NoyauxDifferentsError as refus:
        print(f"comparaison refusée: {refus}", file=sys.stderr)
        raise SystemExit(2) from refus
    for phase in phases:
        fil = phase["fil_pct_mediane"]
        cadence = phase["pages_mediane"]
        print(
            f"{phase['phase']}  noyau {phase['noyau']}  {phase['releves']} relevés  "
            + (f"fil principal {fil:5.1f} %  " if fil is not None else "fil principal -  ")
            + (f"pages {cadence:4.0f} img/s" if cadence is not None else "pages -")
        )


def main(arguments: list[str]) -> None:
    reglages = Settings()
    jour = datetime.now(tz=_zone(reglages.journal_zone)).date()
    debut = fin = None
    phases: str | None = None
    restants = list(arguments)
    while restants:
        argument = restants.pop(0)
        if argument == "--phases":
            if not restants:
                raise SystemExit("--phases attend une liste: 00:33-00:36,00:36-00:39")
            phases = restants.pop(0)
        elif "-" in argument and ":" in argument:
            debut, fin = _plage(argument)
        else:
            jour = date.fromisoformat(argument)
    releves = charger(reglages.boite_noire_dir / "releves" / f"{jour.isoformat()}.jsonl")
    pages = charger(reglages.journal_dir / f"{jour.isoformat()}.jsonl")
    if phases is not None:
        _phases(releves, pages, phases)
        return
    lignes = tranches(releves, pages, debut=debut, fin=fin)
    # L'heure est celle des joueurs, pas l'UTC des journaux des salles: le
    # 21 novembre 2026, l'écart d'une heure a fait chercher une partie au mauvais
    # endroit. « pages » compte les images arrivées, médiane et minimum des pages.
    print(f"{jour.isoformat()}, heure de {reglages.journal_zone}; pages: images reçues par seconde")
    if not lignes:
        garde = reglages.boite_noire_jours
        print(f"rien d'écrit le {jour.isoformat()}: la boîte noire garde {garde} jours")
    for entree in lignes:
        print(_ligne(entree))
    trouvees = captures(reglages.boite_noire_dir / "captures", jour)
    if trouvees:
        print(f"\ncaptures du {jour.isoformat()}:")
    for capture in trouvees:
        chute = capture.get("details") or {}
        mediane = f", médiane {chute['mediane']} img/s" if chute.get("mediane") is not None else ""
        echecs = [cle for cle, code in (capture.get("codes") or {}).items() if code != 0]
        print(
            f"  {capture['dossier']}  {capture.get('raison', '?')}{mediane}"
            + (f"  (échecs: {', '.join(echecs)})" if echecs else "")
        )


if __name__ == "__main__":
    main(sys.argv[1:])
