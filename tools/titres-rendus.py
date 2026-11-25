#!/usr/bin/env python3
"""Chaque titre d'une page Markdown arrive dans sa page construite.

Le 24 novembre 2026, un `</script` écrit dans un bout de code du carnet et de
l'ADR a fait couper leur rendu à cet endroit : le site s'arrêtait au salon,
deuxième passage, et à D41 ; tout ce qui suivait, glossaire compris, n'était
plus servi. `zensical build --strict` ne l'a pas vu, et `just docs` est resté
vert pendant un jour, jusqu'à ce qu'un lien de l'état du projet vise une
entrée perdue (relecture finale du 25 novembre 2026).

Ce contrôle compte, pour chaque page nommée, les titres du Markdown (hors des
blocs de code) et les titres munis d'un identifiant dans le HTML construit.
Un écart dit que la page est coupée. Avant de lire les vraies pages, il
éprouve son compte sur un texte fautif fabriqué ici : un contrôle qui ne
saurait pas refuser ne prouverait rien.

    python3 tools/titres-rendus.py docs/carnet-de-bord.md site/carnet-de-bord/index.html ...
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TITRE_HTML = re.compile(r"<h[1-6][^>]*\sid=\"")


def titres_markdown(texte: str) -> int:
    """Les lignes de titre, hors code : `#` à `######` suivis d'une espace.

    Une ligne de texte qui commence par `#` sans espace (« #laSalleCote »)
    est aussi un titre pour le Markdown du site : elle n'est pas comptée
    ici, et l'écart la dénonce (25 novembre 2026, carnet).
    """
    dans_le_code = False
    compte = 0
    for ligne in texte.splitlines():
        if ligne.lstrip().startswith("```"):
            dans_le_code = not dans_le_code
            continue
        if not dans_le_code and re.match(r"#{1,6} ", ligne):
            compte += 1
    return compte


def titres_html(texte: str) -> int:
    """Les titres munis d'un identifiant dans la page construite."""
    return len(TITRE_HTML.findall(texte))


def eprouver() -> list[str]:
    """Le compte refuse une page coupée ou un titre en trop, et laisse passer
    une page entière. Rend ce qu'il n'a pas su refuser."""
    markdown = "# A\n\n```\n# pas un titre\n```\n\n## B\n\n### C\n"
    entiere = '<h1 id="a">A</h1><h2 id="b">B</h2><h3 id="c">C</h3>'
    coupee = '<h1 id="a">A</h1><h2 id="b">B</h2><p>`</p>'
    # Un « #mot » en tête de ligne devient un titre rendu de plus.
    en_trop = '<h1 id="a">A</h1><h1 id="mot">mot</h1><h2 id="b">B</h2><h3 id="c">C</h3>'
    attendus = titres_markdown(markdown)
    rates = []
    if attendus != 3:
        rates.append(f"le bloc de code compte comme titre ({attendus} au lieu de 3)")
    if titres_html(entiere) != attendus:
        rates.append("une page entière refusée à tort")
    if titres_html(coupee) == attendus:
        rates.append("une page coupée acceptée à tort")
    if titres_html(en_trop) == attendus:
        rates.append("un titre en trop accepté à tort")
    return rates


def main(arguments: list[str]) -> int:
    rates = eprouver()
    if rates:
        entete = "le contrôle des titres rendus ne sait plus refuser :"
        sys.stderr.write(entete + "\n  " + "\n  ".join(rates) + "\n")
        return 2
    if len(arguments) % 2 != 0 or not arguments:
        sys.stderr.write("usage: titres-rendus.py <page.md> <page.html> [...]\n")
        return 2
    fautes = []
    for source, construite in zip(arguments[::2], arguments[1::2], strict=True):
        attendus = titres_markdown(Path(source).read_text(encoding="utf-8"))
        rendus = titres_html(Path(construite).read_text(encoding="utf-8"))
        if attendus != rendus:
            fautes.append(f"{source} : {attendus} titres écrits, {rendus} rendus dans {construite}")
        else:
            sys.stdout.write(f"{source} : {attendus} titres, tous rendus\n")
    if fautes:
        sys.stderr.write("\n".join(fautes) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
