"""Le carnet de jeu: ce que j'ai joué, où, chez qui, et mes sauvegardes. No logic here.

Quatre lectures et une page. Toutes partent de l'identité que le proxy garantit
(`CallerDep`) et d'elle seule: aucune ne prend d'adresse en paramètre, donc
personne ne peut demander le carnet d'un autre. Sans identité, 401.

Le travail de lecture (journal, dossiers de sauvegarde, catalogue) passe sur un
fil: il lit des fichiers, et une lecture de disque sur la boucle retarderait
chaque page de la salle.
"""

from pathlib import Path
from typing import Annotated

from anyio import to_thread
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import HTMLResponse

from nel3ab_control.api.controllers.profil import Carnet
from nel3ab_control.api.controllers.salons import Salons
from nel3ab_control.api.routes import bobine
from nel3ab_control.api.routes.accueil import faces, regie
from nel3ab_control.api.schemas.profil import Emplacement, JeuProfil, PageParties, Profil
from nel3ab_control.catalogue import freshest
from nel3ab_control.dependencies import CallerDep, PartiesDep, PeopleDep, SalonsDep, SettingsDep
from nel3ab_control.parties import JeuJoue, Parties
from nel3ab_control.personnes import empreinte
from nel3ab_control.sauvegardes import mesurer, racine_adaptateur, trouver
from nel3ab_control.settings import Settings

router = APIRouter(prefix="/api/me", tags=["profil"])
page = APIRouter(tags=["profil"])

#: Ce qu'une page du carnet demande au plus d'un coup.
LIMITE_MAX = 100


def _qui(caller: tuple[str, str] | None) -> tuple[str, str]:
    if caller is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="aucune identité: le carnet de jeu se lit depuis le tailnet, à son nom",
        )
    return caller


def _assembler(
    login: str, settings: Settings, parties: Parties, ouvertes: dict[str, float]
) -> Carnet:
    """Tout ce que le carnet lit sur le disque, sur un fil."""
    trouvees = trouver(
        login,
        settings.personal_save_root,
        racine_adaptateur(settings.switch_config),
        racine_adaptateur(settings.switch2_config),
    )
    catalogue = freshest(settings.salles_dir)
    jeux = (
        [
            JeuJoue(cle=jeu.key, console=jeu.console, titre=jeu.name, titre_id=jeu.title_id)
            for jeu in catalogue.games
        ]
        if catalogue
        else []
    )
    return Carnet(
        moi=empreinte(login),
        lignes=parties.lire(login),
        ouvertes=ouvertes,
        sauvegardes=[(trouvee, mesurer(trouvee)) for trouvee in trouvees],
        catalogue=jeux,
    )


async def _carnet(login: str, settings: Settings, parties: Parties, salons: Salons) -> Carnet:
    # Les places ouvertes sont lues ICI, sur la boucle qui les tient, puis
    # passées au fil: il ne touche à rien de ce que la salle modifie.
    ouvertes: dict[str, float] = {}
    for _numero, rooms in salons.eveilles():
        ouvertes.update(rooms.tablee.ouvertes(login))
    return await to_thread.run_sync(_assembler, login, settings, parties, ouvertes)


@router.get("/profil", response_model=Profil)
async def read_my_profile(
    caller: CallerDep,
    people: PeopleDep,
    settings: SettingsDep,
    parties: PartiesDep,
    salons: SalonsDep,
) -> Profil:
    """Mon pseudo, depuis quand le carnet me suit, mes jeux et mon temps de jeu."""
    login, display = _qui(caller)
    carnet = await _carnet(login, settings, parties, salons)
    return carnet.profil(people.name_for(login, display))


@router.get("/jeux", response_model=list[JeuProfil])
async def read_my_games(
    caller: CallerDep, settings: SettingsDep, parties: PartiesDep, salons: SalonsDep
) -> list[JeuProfil]:
    """Chaque jeu joué, avec chez qui, et ma sauvegarde quand elle existe."""
    login, _ = _qui(caller)
    return (await _carnet(login, settings, parties, salons)).jeux()


@router.get("/parties", response_model=PageParties)
async def read_my_plays(
    caller: CallerDep,
    settings: SettingsDep,
    parties: PartiesDep,
    salons: SalonsDep,
    avant: Annotated[
        str | None,
        Query(
            pattern=r"^[0-9a-f]{16}$",
            description="L'`id` de la dernière partie de la page précédente.",
        ),
    ] = None,
    limite: Annotated[int, Query(ge=1, le=LIMITE_MAX)] = 50,
) -> PageParties:
    """Mes parties, de la plus récente à la plus ancienne."""
    login, _ = _qui(caller)
    carnet = await _carnet(login, settings, parties, salons)
    try:
        return carnet.parties(avant, limite)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="ce curseur ne désigne aucune de tes parties: recharge la liste",
        ) from error


@router.get("/sauvegardes", response_model=list[Emplacement])
async def read_my_saves(
    caller: CallerDep, settings: SettingsDep, parties: PartiesDep, salons: SalonsDep
) -> list[Emplacement]:
    """Mes sauvegardes personnelles, par jeu et par console.

    Celles qui sont à moi parce que j'ai lancé le jeu. Une partie jouée chez
    quelqu'un d'autre s'écrit dans SA sauvegarde, et « tout débloqué » est
    commune: ni l'une ni l'autre n'apparaît ici.
    """
    login, _ = _qui(caller)
    return (await _carnet(login, settings, parties, salons)).emplacements()


#: La page, garnie une fois au démarrage: polices, régie et Bobine.
PAGE = bobine.garnir(
    (Path(__file__).parent / "profil.html")
    .read_text(encoding="utf-8")
    .replace("/*__POLICES__*/", faces())
    .replace("/*__REGIE__*/", regie())
)


@page.get("/profil", response_class=HTMLResponse, include_in_schema=False)
async def read_profil_page() -> HTMLResponse:
    """Le carnet de jeu. Une page, pas une ressource: hors du contrat OpenAPI.

    Servie à tout le monde: c'est la page qui demande l'identité, par les
    lectures ci-dessus. Sans identité, elle le dit au lieu de montrer un carnet
    vide qui passerait pour celui de quelqu'un qui n'a jamais joué.
    """
    return HTMLResponse(PAGE)
