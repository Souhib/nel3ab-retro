"""Les salles: combien il y en a, lesquelles sont allumées, qui les allume.

À ne pas confondre avec `rooms`, qui décrit UNE salle, ses places et son jeu.
Ce module-ci ne connaît rien de ce qui s'y passe: il ouvre et il ferme.

La vérité vient de systemd, pas d'un dictionnaire en mémoire. Un plan de
contrôle qui redémarre ne doit pas oublier les salles ouvertes; une liste tenue
ici serait fausse dès le premier redémarrage, et fausse d'une manière que
personne ne verrait avant d'avoir perdu une partie.

Deux emplacements, pas plus, décidé le 12 septembre 2026: la machine a une carte
graphique et deux émulateurs y tiennent. La troisième demande ne fait pas la
queue, elle est refusée tout de suite avec de quoi comprendre.
"""

from collections.abc import Awaitable, Callable, Sequence
from pathlib import Path

import anyio
from fastapi import HTTPException, status

from nel3ab_control.api.schemas.salle import Salle
from nel3ab_control.settings import Settings

#: Les emplacements que cette machine accepte de tenir.
#:
#: Trois, décidé le 12 septembre 2026. La limite n'est pas le nombre de salles
#: mais ce qu'elles font tourner: une seule peut jouer à un jeu Switch, parce
#: que Ryubing coûte bien plus cher que Dolphin. Voir `switch.py`.
SALLES: tuple[int, ...] = (1, 2, 3)

#: Le marqueur qui dit au worker « ouverte, mais sans jeu ».
SANS_JEU = "game-closed"


def unite(numero: int) -> str:
    """Le nom de l'instance systemd d'une salle."""
    return f"nel3ab-worker@{numero}"


def chemin(numero: int) -> str:
    """L'adresse sous laquelle le proxy sert cette salle."""
    return f"/r/{numero}/"


class PlusDeSalle(HTTPException):
    """Les deux emplacements sont pris.

    Un refus immédiat plutôt qu'une file d'attente, demandé le 12 septembre
    2026: attendre sans savoir combien de temps est pire que se voir dire non.
    """

    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"déjà {len(SALLES)} salles ouvertes, le serveur ne peut pas en "
                "tenir plus ; revenez plus tard"
            ),
        )


class SalleInconnue(HTTPException):
    """Ce numéro n'est pas un emplacement de cette machine."""

    def __init__(self, numero: int) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"la salle {numero} n'existe pas",
        )


class SalleRebelle(HTTPException):
    """systemd a refusé d'allumer ou d'éteindre.

    Rapporté plutôt qu'avalé: une salle qu'on croit ouverte et qui ne l'est pas
    envoie quelqu'un sur une page morte sans lui dire pourquoi.
    """

    def __init__(self, numero: int, dit: str) -> None:
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"la salle {numero} n'a pas obéi: {dit}",
        )


#: Ce qui exécute une ligne de commande et rend son code et ce qu'elle a dit.
Lanceur = Callable[[Sequence[str]], Awaitable[tuple[int, str]]]


async def par_le_systeme(commande: Sequence[str]) -> tuple[int, str]:
    """Le vrai lanceur. Injecté, pour que les essais n'aient pas besoin de systemd."""
    fini = await anyio.run_process(list(commande), check=False)
    dit = (fini.stdout + fini.stderr).decode(errors="replace").strip()
    return fini.returncode, dit


class SallesController:
    """Ouvre et ferme les salles de cette machine."""

    def __init__(self, settings: Settings, lancer: Lanceur = par_le_systeme) -> None:
        self._settings = settings
        self._lancer = lancer

    async def etat(self) -> list[Salle]:
        """Toutes les salles, ouvertes ou non."""
        return [
            Salle(numero=numero, ouverte=await self.ouverte(numero), chemin=chemin(numero))
            for numero in SALLES
        ]

    async def ouverte(self, numero: int) -> bool:
        """Cette salle tourne-t-elle ?

        SANS sudo, et c'est délibéré: lire un état ne demande aucun droit, et
        tout ce qui passe par sudo est une ligne de plus qu'un service joignable
        par le réseau peut faire tourner en tant que root.
        """
        code, _ = await self._lancer(["systemctl", "is-active", unite(numero)])
        return code == 0

    async def ouvrir(self) -> Salle:
        """Allume le premier emplacement libre, ou refuse."""
        for numero in SALLES:
            if await self.ouverte(numero):
                continue
            self._preparer(numero)
            code, dit = await self._lancer(["sudo", "-n", "systemctl", "start", unite(numero)])
            if code != 0:
                raise SalleRebelle(numero, dit)
            return Salle(numero=numero, ouverte=True, chemin=chemin(numero))
        raise PlusDeSalle

    async def fermer(self, numero: int) -> Salle:
        """Éteint une salle. Éteindre une salle déjà éteinte ne fait rien."""
        if numero not in SALLES:
            raise SalleInconnue(numero)
        code, dit = await self._lancer(["sudo", "-n", "systemctl", "stop", unite(numero)])
        if code != 0:
            raise SalleRebelle(numero, dit)
        return Salle(numero=numero, ouverte=False, chemin=chemin(numero))

    def _preparer(self, numero: int) -> None:
        """Une salle qu'on ouvre arrive sur son menu, pas sur un jeu.

        Sans ce marqueur, le worker relance le dernier jeu retenu dans ce
        dossier, et une salle qu'on vient d'ouvrir démarrerait un émulateur que
        personne n'a demandé. Posé ici plutôt que par l'unité: systemd sait
        créer un dossier, pas y écrire un fichier.
        """
        dossier: Path = self._settings.salles_dir / str(numero)
        dossier.mkdir(parents=True, exist_ok=True)
        (dossier / SANS_JEU).touch()
