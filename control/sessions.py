"""Relire une soirée.

Le journal est du JSONL, donc `grep` suffit techniquement. Ce script existe parce
que « techniquement suffisant » n'est pas « lu »: une ligne de deux cent
vingt-quatre octets pleine de guillemets se déchiffre, elle ne se lit pas, et un
outil de diagnostic qu'on renonce à ouvrir ne diagnostique rien.

Il ne fait donc que trois choses, et pas une de plus:

- ranger les événements par visite, parce que c'est l'unité qui a du sens: une
  personne, un chargement de page, du début à la fin;
- cacher les pilotes d'essai par défaut, parce qu'ils sont dix fois plus nombreux
  que les vraies parties;
- dire l'heure en clair, puisque c'est par l'heure qu'on cherche.

Aucune analyse, aucune moyenne, aucun verdict. Ce qu'on cherche ici, on ne le
connaît pas d'avance: c'est le propre d'une plainte. Un résumé qui décide à
l'avance de ce qui est intéressant est un résumé qui cache le reste.

    just sessions              la journée d'aujourd'hui
    just sessions 2026-08-16   celle-là
    just sessions 2026-08-16 kitaru   seulement ce qui le concerne
"""

import json
import sys
from collections import defaultdict
from datetime import datetime
from typing import Any

from nel3ab_control.settings import Settings

#: Le même dossier que le service, demandé aux RÉGLAGES plutôt que recopié: deux
#: chemins à garder d'accord sont deux chemins qui finissent par diverger, et
#: celui-ci se règle par l'environnement.
FOLDER = Settings().journal_dir

#: Comment chaque événement se raconte. La forme est fixe pour que deux lignes
#: voisines s'alignent à l'oeil.
SAYS = {
    "arrivée": lambda line: "arrive",
    "départ": lambda line: f"part après {_lasted(line.get('secondes') or 0)}",
    "place": lambda line: (
        f"prend la manette {line['place']}" if line.get("place") else "rend sa manette"
    ),
    "pseudo": lambda line: f"s'appelait {line.get('avant')}",
    "demande": lambda line: f"demande la manette {line.get('place')}",
    "réponse": lambda line: (
        ("accepte" if line.get("accordé") else "refuse") + f" pour la manette {line.get('place')}"
    ),
    "propriétaire": lambda line: f"décide maintenant (place {line.get('place') or 'aucune'})",
}


def _lasted(seconds: float) -> str:
    if seconds < 90:
        return f"{seconds:.0f} s"
    return f"{seconds / 60:.0f} min"


def _hour(line: dict[str, Any]) -> str:
    try:
        return datetime.fromisoformat(line["quand"]).strftime("%H:%M:%S")
    except (KeyError, ValueError):
        return "??:??:??"


def main(argv: list[str]) -> int:
    today = datetime.now().astimezone().strftime("%Y-%m-%d")
    day = next((arg for arg in argv if arg[:2].isdigit()), today)
    wanted = next((arg.lower() for arg in argv if not arg[:2].isdigit()), None)
    path = FOLDER / f"{day}.jsonl"
    if not path.exists():
        # Dire ce qui EXISTE plutôt que seulement ce qui manque: la rétention est
        # de deux jours, et « rien pour cette date » se confond sinon avec « le
        # journal ne marche pas ».
        known = sorted(p.stem for p in FOLDER.glob("*.jsonl")) if FOLDER.exists() else []
        print(f"rien pour le {day}.")
        print(f"journées gardées: {', '.join(known) or 'aucune'}")
        return 1

    lines = [json.loads(raw) for raw in path.read_text(encoding="utf-8").splitlines() if raw]
    visits: dict[str, list[dict[str, Any]]] = defaultdict(list)
    loose: list[dict[str, Any]] = []
    benched = 0
    for line in lines:
        if line.get("banc"):
            benched += 1
            continue
        visit = line.get("visite")
        if visit:
            visits[visit].append(line)
        else:
            loose.append(line)

    if wanted:
        visits = {
            visit: events
            for visit, events in visits.items()
            if any(
                wanted in str(event.get(field) or "").lower()
                for event in events
                for field in ("pseudo", "login")
            )
        }

    count = len(visits)
    print(f"{day} — {count} visite{'s' if count > 1 else ''}, {len(lines)} événements", end="")
    print(f", {benched} de banc écartés" if benched else "")
    for visit, events in sorted(visits.items(), key=lambda pair: pair[1][0]["quand"]):
        who = events[-1].get("pseudo") or "quelqu'un"
        login = events[-1].get("login")
        print(f"\n  {who}" + (f" <{login}>" if login else " (sans identité)") + f"  [{visit}]")
        for event in events:
            told = SAYS.get(event["quoi"], lambda line: line["quoi"])(event)
            salle = event.get("salle") or {}
            around = f"{salle.get('présents', '?')} présents"
            jeu = salle.get("jeu")
            print(f"    {_hour(event)}  {told:<34} {around}" + (f", {jeu}" if jeu else ""))

    # Ce qui n'appartient à personne: les changements de propriétaire, qui sont un
    # fait de la SALLE et pas d'une visite. Les ranger sous une visite au hasard
    # les rendrait faux.
    if loose and not wanted:
        print("\n  la salle")
        for event in loose:
            told = SAYS.get(event["quoi"], lambda line: line["quoi"])(event)
            print(f"    {_hour(event)}  {told}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
