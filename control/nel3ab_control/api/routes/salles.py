"""Les salles de la machine: les lister, en ouvrir une, la fermer. No logic here."""

from fastapi import APIRouter, HTTPException, status

from nel3ab_control.api.schemas.salle import Salle
from nel3ab_control.dependencies import CallerDep, PeopleDep, SallesDep, SettingsDep

router = APIRouter(prefix="/api", tags=["salles"])


@router.get("/salles", response_model=list[Salle])
async def read_salles(salles: SallesDep, people: PeopleDep) -> list[Salle]:
    """Toutes les salles, ouvertes ou non, et qui s'y trouve.

    Sans identité: la liste est ce que le salon montre à qui arrive, et exiger
    de savoir qui demande la rendrait invisible à celui qui vient jouer. Savoir
    QUI est là n'est pas savoir qui demande: la première est publique dans le
    tailnet, la seconde serait une condition d'entrée.

    Les deux dépendances sont assemblées ICI, et pas dans le contrôleur des
    salles: celui-ci interroge systemd et les salles, et ce qu'il sait doit
    survivre à un worker mort. Le pseudo l'emporte sur l'adresse, parce que
    c'est un nom que ses amis reconnaissent et pas un identifiant.
    """
    return await salles.etat(
        lambda numero: [name or login or "" for login, name in people.present(numero)],
    )


@router.post("/salles", response_model=Salle, status_code=status.HTTP_201_CREATED)
async def open_salle(salles: SallesDep, caller: CallerDep) -> Salle:
    """Ouvre le premier emplacement libre, ou refuse quand il n'y en a plus.

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
    return await salles.ouvrir()


@router.delete("/salles/{numero}", response_model=Salle)
async def close_salle(
    numero: int,
    salles: SallesDep,
    caller: CallerDep,
    people: PeopleDep,
    settings: SettingsDep,
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
    return await salles.fermer(numero)
