"""Les salles de la machine: les lister, en ouvrir une, la fermer. No logic here."""

from typing import Annotated

from fastapi import APIRouter, Body, HTTPException, status

from nel3ab_control.api.controllers.salles import PresencesDuSalon, SurUnJeu
from nel3ab_control.api.schemas.salle import OuvrirSalle, Salle
from nel3ab_control.dependencies import CallerDep, PeopleDep, SallesDep, SalonsDep, SettingsDep
from nel3ab_control.parties import JeuJoue

router = APIRouter(prefix="/api", tags=["salles"])


@router.get("/salles", response_model=list[Salle])
async def read_salles(salles: SallesDep, people: PeopleDep, salons: SalonsDep) -> list[Salle]:
    """Toutes les salles, ouvertes ou non, et qui s'y trouve.

    Sans identité: la liste est ce que le salon montre à qui arrive, et exiger
    de savoir qui demande la rendrait invisible à celui qui vient jouer. Savoir
    QUI est là n'est pas savoir qui demande: la première est publique dans le
    tailnet, la seconde serait une condition d'entrée.

    Les deux dépendances sont assemblées ICI, et pas dans le contrôleur des
    salles: celui-ci interroge systemd et les salles, et ce qu'il sait doit
    survivre à un worker mort. Seul le pseudo sort, jamais l'adresse: il y avait
    un repli sur l'adresse quand le pseudo était vide, et une adresse est souvent
    un courriel. Un pseudo vide n'arrive pas par une page; s'il arrivait, la
    liste dirait « quelqu'un » plutôt que l'adresse.
    """
    return await salles.etat(PresencesDuSalon(people, salons.eveilles))


@router.post("/salles", response_model=Salle, status_code=status.HTTP_201_CREATED)
async def open_salle(
    salles: SallesDep,
    caller: CallerDep,
    people: PeopleDep,
    salons: SalonsDep,
    demande: Annotated[OuvrirSalle | None, Body()] = None,
) -> Salle:
    """Ouvre la salle demandée, ou le premier emplacement libre, ou refuse.

    Sans corps, le comportement d'avant le 23 novembre 2026: le premier
    emplacement libre. Avec `numero`, cette salle-là ou un refus (D17). Avec
    `cle` et `sauvegarde`, la salle démarre directement sur ce jeu, pour la
    personne qui l'ouvre: son identité vient du proxy, comme pour un lancement.

    Demande une identité, n'importe laquelle. Ouvrir un emplacement libre ne
    décide rien de la partie de quelqu'un d'autre, mais allume un émulateur sur
    la carte graphique commune: le salon doit savoir qui l'a demandé. Avant le
    21 novembre 2026, une page étrangère ouverte chez un membre pouvait le faire.
    """
    if caller is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="aucune identité: ouvrir une salle demande de savoir qui l'ouvre",
        )
    login, affiche = caller
    sur = (
        SurUnJeu(cle=demande.cle, sauvegarde=demande.sauvegarde, login=login)
        if demande and demande.cle is not None and demande.sauvegarde is not None
        else None
    )
    ouverte = await salles.ouvrir(demande.numero if demande else None, sur)
    if sur and ouverte.cle and ouverte.jeu:
        # Au journal des parties et au chrono des démarrages, APRÈS l'accord de
        # systemd, par la même entrée que les deux lancements de la socket.
        salons.pour(ouverte.numero).lance(
            login,
            people.name_for(login, affiche),
            JeuJoue(cle=ouverte.cle, console=ouverte.console or "?", titre=ouverte.jeu),
            sur.sauvegarde,
        )
    return ouverte


@router.delete("/salles/{numero}", response_model=Salle)
async def close_salle(
    numero: int,
    salles: SallesDep,
    caller: CallerDep,
    people: PeopleDep,
    settings: SettingsDep,
    salons: SalonsDep,
) -> Salle:
    """Ferme une salle, et le jeu qui tourne avec.

    Réservé au chef de CETTE salle et à l'administrateur. Fermer arrête la
    partie de tous ceux qui y jouent: c'est la décision du chef, comme changer
    de jeu, et pas celle de quiconque passe par la liste. L'administrateur le
    peut aussi, sans y être, pour rendre la place quand une salle reste
    bloquée. Une salle où personne n'est connecté n'a pas de chef: seul
    l'administrateur la ferme avant la fermeture automatique d'une demi-heure.

    Le chef est celui que le salon tient pour cette salle, le même que la page
    affiche: pas un nom envoyé par la demande.
    """
    if caller is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="aucune identité: fermer une salle demande de savoir qui la ferme",
        )
    login, _ = caller
    chef = people.owner(numero)
    if not settings.is_admin(login) and (chef is None or chef[0] != login):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="seul le chef de cette salle, ou la personne qui tient la machine, la ferme",
        )
    fermee = await salles.fermer(numero)
    # Les places de cette salle se terminent au journal des parties, une fois
    # le worker vraiment arrêté: un arrêt refusé n'a fermé la partie de personne.
    salons.fermee(numero)
    return fermee
