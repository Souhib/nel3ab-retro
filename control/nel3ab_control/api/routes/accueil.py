"""La page d'accueil: la liste des salles, et de quoi en ouvrir une.

Servie par le salon et pas par un worker, et c'est tout le point: tant que la
racine menait à une salle, il fallait qu'une salle tourne pour qu'une page
existe. Une machine où personne ne joue n'aurait rien montré du tout.

Le HTML est un fichier à côté, pas une chaîne dans le code: une page qu'on ne
peut pas ouvrir dans un navigateur pour la regarder est une page qu'on ne
corrige jamais.
"""

import base64
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["accueil"])

#: La page, lue une fois au démarrage. Elle ne dépend de personne: tout ce
#: qu'elle montre, elle le demande à `/api/salles` depuis le navigateur.
#: Les caractères, embarqués dans la page plutôt que servis par une route.
#:
#: La règle du projet interdit de dépendre d'un SERVICE tiers pour afficher la
#: page d'accueil d'une machine privée. Elle n'interdit pas un caractère: ces
#: deux polices sont sous licence OFL, sous-ensemblées ici même, et servies par
#: cette machine. Embarquées en base64 parce que le plan de contrôle ne sert
#: aucun fichier statique, et parce que la page de la salle est déjà un fichier
#: unique où tout est inclus: une seule requête, aucun clignotement de police.
#:
#: Le dépôt garde les vrais `.woff2`, pas une chaîne base64: on peut les
#: ouvrir, vérifier leur licence et les remplacer.
POLICES = (
    ("Anybody", 700, "anybody-large700.woff2"),
    ("Anybody", 600, "anybody-texte600.woff2"),
    ("Anybody", 400, "anybody-courant400.woff2"),
    ("Departure", 400, "departure-regie.woff2"),
)


def _faces() -> str:
    """Les règles `@font-face`, avec chaque fichier encodé dans la page."""
    dossier = Path(__file__).parent / "polices"
    regles = []
    for nom, graisse, fichier in POLICES:
        octets = (dossier / fichier).read_bytes()
        code = base64.b64encode(octets).decode("ascii")
        regles.append(
            f"@font-face{{font-family:'{nom}';font-style:normal;"
            f"font-weight:{graisse};font-display:swap;"
            f"src:url(data:font/woff2;base64,{code}) format('woff2')}}"
        )
    return "\n".join(regles)


PAGE = (
    (Path(__file__).parent / "accueil.html")
    .read_text(encoding="utf-8")
    .replace("/*__POLICES__*/", _faces())
)


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def read_accueil() -> HTMLResponse:
    """La liste des salles.

    Hors du contrat OpenAPI: c'est une page, pas une ressource, et l'inscrire au
    schéma ajouterait au client TypeScript de la salle une fonction qui rend du
    HTML et que personne n'appellera jamais.
    """
    return HTMLResponse(PAGE)
