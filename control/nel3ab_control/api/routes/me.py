"""Qui je suis, et comment je veux qu'on m'appelle. No logic here."""

from fastapi import APIRouter, HTTPException, status

from nel3ab_control.api.schemas.player import Identity, Me
from nel3ab_control.dependencies import CallerDep, PeopleDep

router = APIRouter(prefix="/api", tags=["me"])


@router.get("/me", response_model=Me)
async def read_me(caller: CallerDep, people: PeopleDep) -> Me:
    """L'identité que le proxy garantit, et le pseudo qui va avec.

    Rend `login: null` quand aucun proxy n'est devant, ce qui est le cas en
    développement. Ce n'est pas une erreur: la page retombe alors sur un prénom
    gardé dans le navigateur, comme avant.
    """
    if caller is None:
        return Me(login=None, name="", display="")
    login, display = caller
    return Me(login=login, name=people.name_for(login, display), display=display)


@router.put("/me", response_model=Me)
async def rename_me(claim: Identity, caller: CallerDep, people: PeopleDep) -> Me:
    """Change son propre pseudo, et rien d'autre.

    Le pseudo est écrit sous l'adresse que le PROXY donne, jamais sous une
    adresse envoyée par le client: c'est la différence entre choisir son nom et
    choisir celui de quelqu'un d'autre.
    """
    if caller is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="aucune identité: cette salle n'est pas derrière son proxy",
        )
    login, display = caller
    try:
        kept = await people.rename(login, claim.name)
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    return Me(login=login, name=kept, display=display)
