"""La bibliothèque des jeux, sans salle ouverte. No logic here."""

from anyio import to_thread
from fastapi import APIRouter, HTTPException, Response, status

from nel3ab_control.api.schemas.error import NoCatalogue
from nel3ab_control.catalogue import Catalogue, art_of, freshest
from nel3ab_control.dependencies import SettingsDep

router = APIRouter(prefix="/api", tags=["catalogue"])


@router.get(
    "/catalogue",
    response_model=Catalogue,
    responses={status.HTTP_404_NOT_FOUND: {"description": "Aucune salle n'a écrit sa liste."}},
)
async def read_catalogue(settings: SettingsDep) -> Catalogue:
    """Les jeux de la machine, lus dans le fichier qu'une salle a écrit (ADR D24).

    Ni worker ni Docker ici : le salon lit ce qu'une salle a déjà balayé, avec
    ses clés et ses titres nettoyés. Sans identité, comme la liste des salles :
    elle ne dit que ce que chaque page de salle publie déjà à `/roms`.
    """
    # Hors de la boucle d'événements: lire quelques fichiers est court, mais un
    # disque occupé par un import ne doit pas faire attendre les sockets.
    found = await to_thread.run_sync(freshest, settings.salles_dir)
    if found is None:
        raise NoCatalogue()
    return found


@router.get(
    "/catalogue/art/{cle}",
    response_class=Response,
    responses={
        status.HTTP_200_OK: {"content": {"image/png": {}}, "description": "L'image du jeu."},
        status.HTTP_404_NOT_FOUND: {"description": "Ce jeu n'a pas d'image que le salon sert."},
    },
)
async def read_art(cle: str, settings: SettingsDep) -> Response:
    """L'image d'un jeu, sans salle ouverte (ADR D45).

    Celle que la salle sert déjà à `/r/N/art/{index}.png` pendant qu'elle
    tourne: la bannière d'un disque GameCube, celle d'une sauvegarde Wii, ou
    l'image que le propriétaire a déposée à côté du jeu. Rien n'est téléchargé.
    Sans identité, comme le catalogue. Toutes les absences se ressemblent (404):
    un jeu inconnu, sans image ou au fichier refusé ne s'affichent pas.
    """
    image = await to_thread.run_sync(art_of, settings.salles_dir, cle)
    if image is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ce jeu n'a pas d'image à montrer"
        )
    # `nosniff`: le fichier vient d'un dossier qu'un conteneur peut écrire, et
    # le navigateur ne doit le lire que comme l'image annoncée.
    return Response(
        content=image, media_type="image/png", headers={"X-Content-Type-Options": "nosniff"}
    )
