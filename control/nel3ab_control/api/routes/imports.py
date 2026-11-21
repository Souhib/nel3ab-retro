"""Déposer un jeu: les routes. Aucune logique ici, c'est le travail du contrôleur.

# Hors du contrat OpenAPI

Ces routes ne servent qu'à la page `/importer`, écrite à la main comme
l'accueil. Les inscrire au schéma ajouterait au client TypeScript de la SALLE
sept fonctions qu'elle n'appellera jamais, et ferait régénérer ce client, donc
changer l'empreinte de la page compilée dans le worker, pour rien.

# Qui peut appeler

Toutes, sauf `/droits`, exigent une identité (401 sans elle) admise à importer
(403 sinon): l'administrateur, une adresse de `NEL3AB_IMPORTEURS`, ou une
adresse que l'administrateur a nommée depuis la page (`imports/droits.py`). Elles le
vérifient elles-mêmes, en plus de toute garde posée sur l'application entière.
"""

from fastapi import APIRouter, Query, Request, Response, status

from nel3ab_control.api.controllers.imports import longueur_annoncee
from nel3ab_control.api.schemas.imports import DemandeEnvoi, Droits, EnvoiVu
from nel3ab_control.dependencies import (
    CallerDep,
    ImporteurDep,
    ImportsDep,
    RegistreDep,
    SettingsDep,
)
from nel3ab_control.imports.droits import peut_importer

router = APIRouter(prefix="/api/imports", tags=["imports"], include_in_schema=False)


@router.get("/droits", response_model=Droits)
async def read_import_rights(
    caller: CallerDep, settings: SettingsDep, registre: RegistreDep
) -> Droits:
    """Si cette personne peut déposer un jeu, pour que l'accueil montre le lien.

    Sans identité, la réponse est « non » plutôt qu'un 401: l'accueil la pose à
    tout le monde, et un refus rouge dans la console de chaque visiteur ne dit
    rien de plus qu'un lien absent.
    """
    login = caller[0] if caller else None
    return Droits(
        peut_importer=peut_importer(login, settings, registre),
        administrateur=bool(login) and settings.is_admin(login.strip().lower()),
    )


@router.get("", response_model=list[EnvoiVu])
async def list_imports(login: ImporteurDep, imports: ImportsDep) -> list[EnvoiVu]:
    """Les envois de cette personne (tous, pour l'administrateur)."""
    return await imports.lister(login)


@router.post("", response_model=EnvoiVu, status_code=status.HTTP_201_CREATED)
async def create_import(demande: DemandeEnvoi, login: ImporteurDep, imports: ImportsDep) -> EnvoiVu:
    """Annonce un fichier. 409 s'il est déjà là ou déjà en route."""
    return await imports.creer(demande, login)


@router.get("/{ident}", response_model=EnvoiVu)
async def read_import(ident: str, login: ImporteurDep, imports: ImportsDep) -> EnvoiVu:
    """Où en est un envoi: son décalage, son état, ce qu'on a reconnu."""
    return await imports.lire(ident, login)


@router.put("/{ident}", response_model=EnvoiVu)
async def send_import_chunk(
    ident: str,
    request: Request,
    login: ImporteurDep,
    imports: ImportsDep,
    decalage: int = Query(ge=0),
) -> EnvoiVu:
    """Un morceau brut, écrit à `decalage`. Le corps n'est jamais lu en entier."""
    longueur = longueur_annoncee(request.headers)
    return await imports.recevoir(ident, decalage, longueur, request.stream(), login)


@router.post("/{ident}/fin", response_model=EnvoiVu, status_code=status.HTTP_202_ACCEPTED)
async def finish_import(ident: str, login: ImporteurDep, imports: ImportsDep) -> EnvoiVu:
    """Lance la vérification et le rangement. La page relit l'état ensuite."""
    return await imports.finir(ident, login)


@router.delete("/{ident}", status_code=status.HTTP_204_NO_CONTENT)
async def abandon_import(ident: str, login: ImporteurDep, imports: ImportsDep) -> Response:
    """Abandonne un envoi et efface sa quarantaine. Un jeu rangé reste rangé."""
    await imports.abandonner(ident, login)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
