"""La bibliothèque des jeux, sans salle ouverte. No logic here."""

from anyio import to_thread
from fastapi import APIRouter, HTTPException, Request, Response, status

from nel3ab_control.api.schemas.error import NoCatalogue
from nel3ab_control.catalogue import (
    ART_MAX,
    Catalogue,
    ImageRefuseeError,
    art_of,
    deposer_image,
    freshest,
    retirer_image,
)
from nel3ab_control.dependencies import AdminDep, SettingsDep

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


async def _corps_borne(request: Request, plafond: int) -> bytes | None:
    """Le corps de la demande, ou rien s'il dépasse `plafond`.

    Lu par morceaux et arrêté au-delà: lire tout le corps d'abord mettrait en
    mémoire ce qu'on envoie, quelle que soit sa taille.
    """
    recu = bytearray()
    async for morceau in request.stream():
        recu += morceau
        if len(recu) > plafond:
            return None
    return bytes(recu)


_JEU_INCONNU = "ce jeu n'est pas dans la bibliothèque, ou son fichier est introuvable"


@router.put(
    "/catalogue/art/{cle}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses={
        status.HTTP_404_NOT_FOUND: {"description": _JEU_INCONNU},
        status.HTTP_413_CONTENT_TOO_LARGE: {"description": "L'image dépasse un Mio."},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Une image que la salle ne montrerait pas."
        },
    },
)
async def deposit_art(
    cle: str, request: Request, settings: SettingsDep, _admin: AdminDep
) -> Response:
    """Dépose l'image d'un jeu, à côté de lui: `<jeu>.nel3ab.png` (ADR D45).

    Réservé à l'administrateur, comme la liste de qui dépose: l'image s'affiche
    chez tout le monde. Le corps est le PNG lui-même. Elle passe avant la
    bannière d'un jeu GameCube ou Wii, et sert d'image à un jeu Switch ou Xbox
    360. Une salle la lit à son prochain démarrage; rien n'est téléchargé.
    """
    contenu = await _corps_borne(request, ART_MAX)
    if contenu is None:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="l'image dépasse un Mio"
        )
    try:
        trouve = await to_thread.run_sync(
            deposer_image, settings.salles_dir, settings.rom_dir, cle, contenu
        )
    except ImageRefuseeError as refus:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(refus)
        ) from refus
    if not trouve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_JEU_INCONNU)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/catalogue/art/{cle}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses={status.HTTP_404_NOT_FOUND: {"description": _JEU_INCONNU}},
)
async def remove_art(cle: str, settings: SettingsDep, _admin: AdminDep) -> Response:
    """Retire l'image déposée d'un jeu; la bannière du disque revient."""
    trouve = await to_thread.run_sync(retirer_image, settings.salles_dir, settings.rom_dir, cle)
    if not trouve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_JEU_INCONNU)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
