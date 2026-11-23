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

from nel3ab_control.api.routes import bobine, retro

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
#:
#: Pixelify Sans depuis le 23 novembre 2026, pour les titres du thème rétro
#: (ADR D37): une police variable, d'où une plage de graisses plutôt qu'une
#: graisse (provenance et sous-ensemble dans `polices/PixelifySans-PROVENANCE.txt`).
POLICES = (
    ("Anybody", "700", "anybody-large700.woff2"),
    ("Anybody", "600", "anybody-texte600.woff2"),
    ("Anybody", "400", "anybody-courant400.woff2"),
    ("Departure", "400", "departure-regie.woff2"),
    ("Pixelify Sans", "400 700", "pixelify-titres.woff2"),
)


def faces() -> str:
    """Les règles `@font-face`, avec chaque fichier encodé dans la page.

    Publique parce que les autres pages du salon (dépôt de jeux, carnet de jeu)
    les embarquent aussi: une seule façon de servir leurs caractères.
    """
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


def regie() -> str:
    """Les jetons de la régie, communs à la salle et aux pages du salon.

    `regie.css` est la copie de `front/src/regie.css`, que
    `front/src/lib/regie.test.ts` compare octet pour octet. Une page la pose par
    ``/*__REGIE__*/`` dans son ``<style>``, avant ses propres règles: les deux
    thèmes, nuit et jour, et le système qui choisit entre eux.
    """
    return (Path(__file__).parent / "regie.css").read_text(encoding="utf-8")


PAGE = retro.garnir(
    bobine.garnir(
        (Path(__file__).parent / "accueil.html")
        .read_text(encoding="utf-8")
        .replace("/*__POLICES__*/", faces())
        .replace("/*__REGIE__*/", regie())
    )
)


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def read_accueil() -> HTMLResponse:
    """La liste des salles.

    Hors du contrat OpenAPI: c'est une page, pas une ressource, et l'inscrire au
    schéma ajouterait au client TypeScript de la salle une fonction qui rend du
    HTML et que personne n'appellera jamais.
    """
    return HTMLResponse(PAGE)
