"""The room, read and changed. No logic here: that is the controller's job."""

from fastapi import APIRouter, HTTPException, status

from nel3ab_control.api.schemas.player import Bindings
from nel3ab_control.api.schemas.room import Room
from nel3ab_control.dependencies import (
    CallerDep,
    PeopleDep,
    RoomBindingsDep,
    RoomsDep,
    SettingsDep,
)

router = APIRouter(prefix="/api", tags=["room"])


@router.get("/room", response_model=Room)
async def read_room(rooms: RoomsDep, people: PeopleDep) -> Room:
    """What is loaded, what else could be, who claims which pad, and who is here."""
    return await rooms.describe(people)


@router.get("/room/bindings", response_model=Bindings)
async def read_room_bindings(reference: RoomBindingsDep) -> Bindings:
    """La configuration de référence de la salle.

    Sans identité aussi, contrairement au dossier personnel: la référence est ce
    que la salle propose à qui entre, et exiger de savoir qui demande la rendrait
    invisible exactement à ceux qui n'ont encore rien réglé.

    Vide quand personne ne l'a publiée. La page se comporte alors comme avant.
    """
    return Bindings(**reference.read())


@router.put("/room/bindings", response_model=Bindings)
async def publish_room_bindings(
    kept: Bindings,
    caller: CallerDep,
    settings: SettingsDep,
    reference: RoomBindingsDep,
) -> Bindings:
    """Remplace la référence de la salle. Une seule personne le peut.

    # Pourquoi une adresse écrite dans la configuration et pas le propriétaire

    La salle a déjà une notion de propriétaire, et elle ne convient pas ici: elle
    est faite pour décider du jeu en cours, elle change quand quelqu'un part, et
    depuis peu elle se donne toute seule quand le propriétaire s'absente trois
    minutes. Rendre la référence modifiable par ce propriétaire-là voudrait dire
    que n'importe qui peut l'écraser pendant qu'on mange.

    Une référence à laquelle on veut pouvoir revenir QUOI QU'IL ARRIVE ne peut
    pas dépendre d'un titre qui tourne. Elle dépend d'une adresse, écrite dans
    l'unité systemd, que rien dans la salle ne peut changer.

    Vide veut dire personne, et c'est le défaut: une salle fraîchement déployée
    n'a pas de référence et se comporte exactement comme avant.
    """
    if caller is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="aucune identité: cette salle n'est pas derrière son proxy",
        )
    login, _ = caller
    # Mise en minuscules des DEUX côtés. L'identité arrive déjà normalisée
    # (`identity.from_headers` et `whois` font `.strip().lower()`), la
    # configuration non: une adresse écrite avec une majuscule dans l'unité
    # systemd ne correspondrait alors jamais, et la personne se verrait refuser
    # sa propre salle sans comprendre.
    #
    # Pas de garde sur une adresse VIDE ici, et c'est délibéré: les deux chemins
    # d'identité refusent déjà une adresse vide, donc `caller` ne peut pas en
    # porter une. Une adresse d'administrateur vide ne correspond donc à
    # personne, ce qui EST le défaut voulu. Ajouter la garde quand même donnerait
    # une ligne qui ne peut pas s'exécuter, c'est-à-dire une protection qu'on
    # croit avoir.
    if login != settings.admin.strip().lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="seule la personne qui tient la salle publie sa configuration",
        )
    try:
        await reference.publish(kept.model_dump())
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    return kept
