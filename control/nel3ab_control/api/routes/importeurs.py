"""Qui peut déposer des jeux: la liste de l'administrateur. Aucune logique ici.

Hors du contrat OpenAPI, comme les routes d'import: seule la page `/importer`
les appelle. Chaque route exige l'administrateur (401 sans identité, 403 pour
une autre), et les écritures passent aussi par la garde d'origine de
l'application, comme toute écriture du salon.

`{login}` est l'adresse de la personne, telle que la liste la donne. Une
adresse n'a pas de barre oblique, donc elle tient dans un seul segment.
"""

from fastapi import APIRouter

from nel3ab_control.api.schemas.imports import Personnes, PersonneVue
from nel3ab_control.dependencies import AdminDep, ImporteursDep

router = APIRouter(prefix="/api/importeurs", tags=["importeurs"], include_in_schema=False)


@router.get("", response_model=Personnes)
async def list_people(_admin: AdminDep, importeurs: ImporteursDep) -> Personnes:
    """Les personnes qui ont accès au salon, avec leur droit de déposer."""
    return await importeurs.lister()


@router.put("/{login}", response_model=PersonneVue)
async def grant_import(login: str, _admin: AdminDep, importeurs: ImporteursDep) -> PersonneVue:
    """Donne le droit de déposer. Répéter la demande ne change rien."""
    return await importeurs.donner(login)


@router.delete("/{login}", response_model=PersonneVue)
async def revoke_import(login: str, _admin: AdminDep, importeurs: ImporteursDep) -> PersonneVue:
    """Reprend le droit donné depuis la page. 409 pour l'administrateur et la configuration."""
    return await importeurs.reprendre(login)
