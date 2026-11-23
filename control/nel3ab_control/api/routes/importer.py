"""La page de dépôt: déposer des jeux, les voir reconnus, puis rangés.

Servie par le salon, comme l'accueil, et pour la même raison: la page de la
salle n'existe que pendant qu'une salle tourne, et importer un jeu ne doit pas
demander de lancer un émulateur.

Trois fichiers à côté, assemblés une fois au démarrage: le HTML, son module
JavaScript (`importer.mjs`, qu'un essai exécute aussi sous Node pour comparer
son estimation et son empreinte à celles du serveur), et Bobine, posé par
`bobine.garnir`. Les polices sont celles de l'accueil, embarquées: la page ne
fait aucune requête vers un autre site.
"""

import html
import json
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from nel3ab_control.api.routes import bobine, retro
from nel3ab_control.api.routes.accueil import faces, regie
from nel3ab_control.imports.destinations import noms
from nel3ab_control.imports.traitement import rangees

router = APIRouter(tags=["importer"])

DOSSIER = Path(__file__).parent
SCRIPT = DOSSIER / "importer.mjs"


def enumerer(mots: list[str]) -> str:
    """« A, B et C », comme on le dit. Sans aucun mot, « d'aucune console »."""
    if len(mots) <= 1:
        return mots[0] if mots else "d'aucune console"
    return f"{', '.join(mots[:-1])} et {mots[-1]}"


def noms_en_json(lus: dict[str, str]) -> str:
    """Les noms des consoles, à poser dans un `<script type="application/json">`.

    Sans `<`: un nom qui contiendrait `</script>` fermerait l'élément. JSON lit
    la suite `\\u003c` comme le même caractère.
    """
    return json.dumps(lus, ensure_ascii=False).replace("<", "\\u003c")


def assembler() -> str:
    """La page complète: polices, Bobine, ce que dit le manifeste, puis le module en dernier.

    Ce qui se range tout de suite et le nom de chaque console viennent du
    manifeste et des règles de l'import (`traitement.rangees`,
    `destinations.noms`): écrits à la main dans la page, ils avaient oublié la
    Xbox 360 rangée par l'import depuis le 21 novembre 2026.

    Le module est posé APRÈS `garnir`: une marque `<!--BOBINE:…-->` écrite dans
    une chaîne du script serait sinon remplacée par un dessin.
    """
    page = (DOSSIER / "importer.html").read_text(encoding="utf-8")
    page = page.replace("/*__RANGEES__*/", html.escape(enumerer(rangees())))
    page = page.replace("/*__CONSOLES__*/", noms_en_json(noms()))
    page = retro.garnir(
        bobine.garnir(page.replace("/*__POLICES__*/", faces()).replace("/*__REGIE__*/", regie()))
    )
    return page.replace("/*__SCRIPT__*/", SCRIPT.read_text(encoding="utf-8"))


PAGE = assembler()


@router.get("/importer", response_class=HTMLResponse, include_in_schema=False)
async def read_importer() -> HTMLResponse:
    """La page de dépôt. Hors du contrat OpenAPI: c'est une page, pas une ressource.

    Elle se sert à tout le monde, et c'est l'API qui refuse: la page demande
    `/api/imports/droits` et le dit en clair à qui ne peut pas importer.
    """
    return HTMLResponse(PAGE)
