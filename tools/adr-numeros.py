#!/usr/bin/env python3
"""Les numéros des décisions de l'ADR : en ordre, sans doublon, sans trou.

Le thème rétro a réservé ses numéros d'avance (D37 à D46) pour huit chantiers
menés en parallèle, puis les a fusionnés dans un autre ordre que celui des
réservations. La règle de la partition (« un chantier qui fusionne hors de
cet ordre prend le prochain numéro libre ») ne vivait que dans un fichier de
travail : à l'intégration finale du 24 novembre 2026, rien n'aurait refusé
deux « ### D47 » écrits par deux chantiers, ni un amendement rangé sous la
mauvaise décision. `just docs` lance ce contrôle avant le site.

Ce qu'il exige :

- chaque `### D<n> —` ou `### D<n>:` est une décision, et chaque numéro n'en
  a qu'une ;
- les numéros vont de D1 au plus grand sans trou ;
- ils se suivent dans l'ordre, sauf D15, écrit avant D13 et D14 dès la
  première version du document (août 2026) et gardé à sa place, comme
  `### D6 amended` qui le suit ;
- un amendement (`#### D<n> …`) est rangé sous sa décision, avant la
  suivante.

Avant de lire le vrai fichier, il éprouve chaque règle sur un texte fautif
fabriqué ici : un contrôle qui ne saurait pas refuser ne prouverait rien.

    python3 tools/adr-numeros.py [docs/adr/0001-architecture.md]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DECISION = re.compile(r"^### D(\d+)(?:\s+—|:)")
AMENDEMENT_ANCIEN = re.compile(r"^### D(\d+) amended\b")
AMENDEMENT = re.compile(r"^#### D(\d+)\b")
# D15 précède D13 et D14 depuis la première version du document.
ORDRE_ANCIEN = [*range(1, 13), 15, 13, 14]


def fautes(texte: str) -> list[str]:
    """Ce qui ne va pas dans les numéros de `texte`, ou rien."""
    trouvees: list[str] = []
    numeros: list[int] = []
    courante: int | None = None
    vues: set[int] = set()
    for ligne_no, ligne in enumerate(texte.splitlines(), start=1):
        if m := DECISION.match(ligne):
            n = int(m.group(1))
            if n in vues:
                trouvees.append(f"ligne {ligne_no} : D{n} est déjà une décision")
            vues.add(n)
            numeros.append(n)
            courante = n
        elif m := AMENDEMENT_ANCIEN.match(ligne):
            n = int(m.group(1))
            if n not in vues:
                trouvees.append(f"ligne {ligne_no} : D{n} amendée avant d'être décidée")
        elif m := AMENDEMENT.match(ligne):
            n = int(m.group(1))
            if n != courante:
                trouvees.append(f"ligne {ligne_no} : un amendement de D{n} rangé sous D{courante}")
    if not numeros:
        return ["aucune décision trouvée"]
    attendu = ORDRE_ANCIEN + list(range(len(ORDRE_ANCIEN) + 1, max(numeros) + 1))
    if numeros != attendu:
        for i, (lu, voulu) in enumerate(zip(numeros, attendu, strict=False)):
            if lu != voulu:
                trouvees.append(f"décision n° {i + 1} : D{lu} là où D{voulu} était attendue")
                break
        else:
            trouvees.append(f"{len(numeros)} décisions lues, {len(attendu)} attendues")
    return trouvees


def _texte(*numeros: int, amendements: dict[int, int] | None = None) -> str:
    """Un ADR fabriqué : `### Dn — titre` pour chaque numéro, et
    `#### Dm amendment` après la décision d'indice donné."""
    lignes: list[str] = []
    for i, n in enumerate(numeros):
        lignes.append(f"### D{n} — décision {n}")
        for apres, m in (amendements or {}).items():
            if apres == i:
                lignes.append(f"#### D{m} amendment, 2026-11-24")
    return "\n".join(lignes)


def eprouver() -> list[str]:
    """Chaque règle doit refuser son texte fautif, et laisser passer le bon."""
    bon = [*ORDRE_ANCIEN, 16, 17]
    cas = {
        "le bon texte": (_texte(*bon, amendements={len(bon) - 1: 17}), False),
        "un doublon": (_texte(*bon, 17), True),
        "un trou": (_texte(*bon, 19), True),
        "le désordre": (_texte(*ORDRE_ANCIEN, 17, 16), True),
        "un amendement mal rangé": (_texte(*bon, amendements={len(bon) - 1: 16}), True),
    }
    rates = []
    for nom, (texte, fautif) in cas.items():
        if bool(fautes(texte)) != fautif:
            rates.append(f"{nom} : {'accepté' if fautif else 'refusé'} à tort")
    return rates


def main() -> int:
    rates = eprouver()
    if rates:
        entete = "le contrôle des numéros ne sait plus refuser :"
        sys.stderr.write(entete + "\n  " + "\n  ".join(rates) + "\n")
        return 2
    chemin = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/adr/0001-architecture.md")
    trouvees = fautes(chemin.read_text(encoding="utf-8"))
    if trouvees:
        sys.stderr.write(f"{chemin} :\n  " + "\n  ".join(trouvees) + "\n")
        return 1
    sys.stdout.write(f"{chemin} : numéros des décisions en ordre, sans doublon ni trou\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
