"""Qui je suis, et comment je veux qu'on m'appelle. No logic here."""

from fastapi import APIRouter, HTTPException, status

from nel3ab_control.api.schemas.player import Bindings, Identity, Me
from nel3ab_control.dependencies import BindingsDep, CallerDep, PeopleDep, SettingsDep

router = APIRouter(prefix="/api", tags=["me"])


@router.get("/me", response_model=Me)
async def read_me(caller: CallerDep, people: PeopleDep, settings: SettingsDep) -> Me:
    """L'identité que le proxy garantit, et le pseudo qui va avec.

    Rend `login: null` quand aucun proxy n'est devant, ce qui est le cas en
    développement. Ce n'est pas une erreur: la page retombe alors sur un prénom
    gardé dans le navigateur, comme avant.
    """
    if caller is None:
        return Me(login=None, name="", display="")
    login, display = caller
    # La MÊME comparaison que la route qui publie, mise en minuscules des deux
    # côtés pour la même raison. Deux lectures d'une même règle finissent par
    # diverger: celle-ci ne décide de rien, elle dit seulement quel bouton
    # montrer, et c'est l'autre qui refuse.
    return Me(
        login=login,
        name=people.name_for(login, display),
        display=display,
        publishes=login == settings.admin.strip().lower(),
    )


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


@router.get("/me/bindings", response_model=Bindings)
async def read_bindings(caller: CallerDep, bindings: BindingsDep) -> Bindings:
    """Les réglages de manette de celui qui demande.

    Vides quand aucun proxy n'est devant: sans identité il n'y a pas de dossier à
    ouvrir, et la page garde alors ses réglages dans le navigateur, comme avant.
    Ce n'est pas une erreur, c'est la salle sans son proxy.
    """
    if caller is None:
        return Bindings()
    login, _ = caller
    return Bindings(**bindings.of(login))


@router.put("/me/bindings", response_model=Bindings)
async def keep_bindings(kept: Bindings, caller: CallerDep, bindings: BindingsDep) -> Bindings:
    """Garde ses propres réglages, et ceux de personne d'autre.

    Sous l'adresse que le PROXY donne, jamais sous une adresse envoyée par le
    client: c'est la même règle que pour le pseudo, et c'est la différence entre
    régler sa manette et régler celle de quelqu'un d'autre.
    """
    if caller is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="aucune identité: cette salle n'est pas derrière son proxy",
        )
    login, _ = caller
    try:
        await bindings.keep(login, kept.model_dump())
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    return kept
