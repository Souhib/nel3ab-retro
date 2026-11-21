"""La bibliothèque des jeux, sans salle ouverte. No logic here."""

from anyio import to_thread
from fastapi import APIRouter, status

from nel3ab_control.api.schemas.error import NoCatalogue
from nel3ab_control.catalogue import Catalogue, freshest
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
