"""Relire la boîte noire d'une soirée, par tranches de dix secondes.

La machine et les pages sur la même ligne: la cadence que les joueurs ont vue, le
fil le plus occupé de l'émulateur, le GPU, la température, l'allocateur de la
mémoire vidéo, et ce que la boîte noire elle-même a coûté. Puis les captures du
jour, avec leur raison.

    just boite-noire                          aujourd'hui
    just boite-noire 2026-09-14               ce jour-là
    just boite-noire 2026-09-14 00:15-00:40   seulement cette plage
"""

import sys
from datetime import date, datetime, time
from typing import Any

from nel3ab_control.boite_noire.lire import captures, charger, tranches
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


def main(arguments: list[str]) -> None:
    reglages = Settings()
    jour = datetime.now(tz=_zone(reglages.journal_zone)).date()
    debut = fin = None
    for argument in arguments:
        if "-" in argument and ":" in argument:
            debut, fin = _plage(argument)
        else:
            jour = date.fromisoformat(argument)
    releves = charger(reglages.boite_noire_dir / "releves" / f"{jour.isoformat()}.jsonl")
    pages = charger(reglages.journal_dir / f"{jour.isoformat()}.jsonl")
    lignes = tranches(releves, pages, debut=debut, fin=fin)
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
        mediane = f", médiane {chute['mediane']} img/s" if "mediane" in chute else ""
        echecs = [cle for cle, code in (capture.get("codes") or {}).items() if code != 0]
        print(
            f"  {capture['dossier']}  {capture.get('raison', '?')}{mediane}"
            + (f"  (échecs: {', '.join(echecs)})" if echecs else "")
        )


if __name__ == "__main__":
    main(sys.argv[1:])
