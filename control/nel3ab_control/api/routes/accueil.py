"""La page d'accueil: la liste des salles, et de quoi en ouvrir une.

Servie par le salon et pas par un worker, et c'est tout le point: tant que la
racine menait à une salle, il fallait qu'une salle tourne pour qu'une page
existe. Une machine où personne ne joue n'aurait rien montré du tout.

Le HTML est un fichier à côté, pas une chaîne dans le code: une page qu'on ne
peut pas ouvrir dans un navigateur pour la regarder est une page qu'on ne
corrige jamais.
"""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["accueil"])

#: La page, lue une fois au démarrage. Elle ne dépend de personne: tout ce
#: qu'elle montre, elle le demande à `/api/salles` depuis le navigateur.
PAGE = (Path(__file__).parent / "accueil.html").read_text(encoding="utf-8")


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def read_accueil() -> HTMLResponse:
    """La liste des salles.

    Hors du contrat OpenAPI: c'est une page, pas une ressource, et l'inscrire au
    schéma ajouterait au client TypeScript de la salle une fonction qui rend du
    HTML et que personne n'appellera jamais.
    """
    return HTMLResponse(PAGE)
