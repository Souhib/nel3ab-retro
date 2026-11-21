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

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from nel3ab_control.api.routes import bobine
from nel3ab_control.api.routes.accueil import faces

router = APIRouter(tags=["importer"])

DOSSIER = Path(__file__).parent
SCRIPT = DOSSIER / "importer.mjs"


def assembler() -> str:
    """La page complète: polices, Bobine, puis le module en dernier.

    Le module est posé APRÈS `garnir`: une marque `<!--BOBINE:…-->` écrite dans
    une chaîne du script serait sinon remplacée par un dessin.
    """
    page = (DOSSIER / "importer.html").read_text(encoding="utf-8")
    page = bobine.garnir(page.replace("/*__POLICES__*/", faces()))
    return page.replace("/*__SCRIPT__*/", SCRIPT.read_text(encoding="utf-8"))


PAGE = assembler()


@router.get("/importer", response_class=HTMLResponse, include_in_schema=False)
async def read_importer() -> HTMLResponse:
    """La page de dépôt. Hors du contrat OpenAPI: c'est une page, pas une ressource.

    Elle se sert à tout le monde, et c'est l'API qui refuse: la page demande
    `/api/imports/droits` et le dit en clair à qui ne peut pas importer.
    """
    return HTMLResponse(PAGE)
