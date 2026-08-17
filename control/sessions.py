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
    "mesures": lambda line: _seen(line.get("vu") or {}),
    "plainte": lambda line: f"** ÇA SACCADE ** {_state(line.get('vu') or {})}",
}


def _state(vu: dict[str, Any]) -> str:
    """L'état à l'instant d'un signalement, sans les compteurs.

    Sans eux à dessein. Un signalement tombe où la personne clique, donc au
    milieu de la fenêtre de dix secondes: un clic arrivé juste après une remise
    à zéro affichait « 0/0 peintes » sur une séance parfaitement normale, ce qui
    se lit comme une panne totale. Ce sont des compteurs de fenêtre, et une
    fenêtre de quatre dixièmes de seconde ne compte rien.

    Ce qui reste sont les JAUGES, vraies à l'instant où on les lit quelle que
    soit la fenêtre. Les images, c'est la bande qui les dit, et sur deux minutes
    plutôt que sur un fragment.
    """
    said = f"gigue {vu.get('gigue', 0)} ms  horaire {vu.get('horaire') or 0} ms"
    if vu.get("demi"):
        said += "  [réduit]"
    return said


def _seen(vu: dict[str, Any]) -> str:
    """Ce qu'une fenêtre de dix secondes a donné, sur une ligne.

    Trois chiffres et pas quinze. Le relevé complet est dans le fichier et se lit
    au besoin; ce qui doit sauter aux yeux en parcourant une soirée est ce qui
    distingue une fenêtre saine d'une fenêtre qui rame:

    - les images JETÉES, qui ont expliqué à elles seules deux des trois pannes
      de la semaine;
    - la GIGUE, qui dit si c'est la liaison plutôt que la machine;
    - l'HORAIRE, le retard que la page s'ajoute pour compenser, et qui est la
      conséquence visible des deux autres.

    Le format transporté suit, parce que « il est passé en réduit » change la
    lecture de tout ce qui vient après.
    """
    lost = vu.get("jetées", 0)
    said = f"{vu.get('peintes', 0):>4}/{vu.get('vues', 0):<4} peintes"
    if lost:
        said += f"  {lost} jetées"
    said += f"  gigue {vu.get('gigue', 0)} ms  horaire {vu.get('horaire') or 0} ms"
    if vu.get("demi"):
        said += "  [réduit]"
    trous = (vu.get("son") or {}).get("trous", 0)
    if trous:
        said += f"  {trous} trous de son"
    return said


def _lasted(seconds: float) -> str:
    if seconds < 90:
        return f"{seconds:.0f} s"
    return f"{seconds / 60:.0f} min"


#: Combien de secondes la bande dessine.
BAND = 120

#: Ce que chaque caractère de la bande veut dire.
#:
#: Quatre états et pas un chiffre par seconde. Cent vingt nombres alignés ne se
#: lisent pas; une bande se lit d'un coup d'oeil, et ce qu'on cherche devant un
#: signalement est une FORME — trois secondes qui rament au milieu de dix qui
#: vont bien — plutôt qu'une valeur.
LEGEND = ". sain   : images jetées   ! file vidée   espace: rien mesuré"


def _band(fin: dict[str, Any]) -> list[str]:
    """Les deux minutes avant un signalement, en une bande de caractères.

    Les lignes sont datées en secondes NÉGATIVES avant le signalement, et on les
    place à leur rang plutôt que les unes après les autres: un onglet passé en
    arrière-plan voit ses minuteurs ralentis par le navigateur, et ses secondes
    manquantes doivent laisser un trou visible. Une bande sans trou qui couvre
    deux minutes avec vingt lignes mentirait sur ce qu'elle a mesuré.
    """
    columns = fin.get("colonnes") or []
    rows = fin.get("lignes") or []
    if not columns or not rows:
        return []
    where = {name: index for index, name in enumerate(columns)}

    def at(row: list[Any], name: str) -> int:
        found = where.get(name)
        return int(row[found]) if found is not None and found < len(row) else 0

    strip = [" "] * (BAND + 1)
    worst: tuple[int, list[Any]] | None = None
    for row in rows:
        when = at(row, "s")
        if not -BAND <= when <= 0:
            continue
        lost, dry = at(row, "jetées"), at(row, "affamées")
        strip[BAND + when] = "!" if dry else ":" if lost else "."
        hurt = dry * 1000 + lost
        if hurt > 0 and (worst is None or hurt > worst[0]):
            worst = (hurt, row)

    seen = [row for row in rows if -BAND <= at(row, "s") <= 0]
    painted = sum(at(row, "peintes") for row in seen)
    arrived = sum(at(row, "vues") for row in seen)
    said = [
        f"deux minutes avant: {''.join(strip)}",
        f"({LEGEND})",
        f"sur ces {len(seen)} secondes: {painted} peintes sur {arrived} arrivées, "
        f"{sum(at(row, 'jetées') for row in seen)} jetées, "
        f"{sum(at(row, 'affamées') for row in seen)} fois la file vide",
    ]
    if worst is not None:
        row = worst[1]
        said.append(
            f"pire seconde: {at(row, 's')} s, {at(row, 'jetées')} jetées, "
            f"{at(row, 'affamées')} fois la file vide, gigue {at(row, 'gigue')} ms"
        )
    return said


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
            if event["quoi"] in ("mesures", "plainte"):
                # Déjà longues, et leur contexte est dans les lignes voisines.
                print(f"    {_hour(event)}  {told}")
                for extra in _band((event.get("vu") or {}).get("fin") or {}):
                    print(f"              {extra}")
                continue
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
