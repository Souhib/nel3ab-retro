"""Les salles de la machine: les lister, en ouvrir une, la fermer. No logic here."""

from fastapi import APIRouter, status

from nel3ab_control.api.schemas.salle import Salle
from nel3ab_control.dependencies import PeopleDep, SallesDep

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
async def open_salle(salles: SallesDep) -> Salle:
    """Ouvre le premier emplacement libre, ou refuse quand il n'y en a plus."""
    return await salles.ouvrir()


@router.delete("/salles/{numero}", response_model=Salle)
async def close_salle(numero: int, salles: SallesDep) -> Salle:
    """Ferme une salle, et le jeu qui tourne avec.

    Sans condition de propriétaire pour l'instant: la salle se ferme d'elle-même
    après une demi-heure sans personne, et ce bouton-ci sert à rendre la place
    tout de suite plutôt qu'à prendre une décision sur la partie de quelqu'un.
    """
    return await salles.fermer(numero)
