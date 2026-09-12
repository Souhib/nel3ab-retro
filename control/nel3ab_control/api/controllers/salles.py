"""Les salles: combien il y en a, lesquelles sont allumées, qui les allume.

À ne pas confondre avec `rooms`, qui décrit UNE salle, ses places et son jeu.
Ce module-ci ne connaît rien de ce qui s'y passe: il ouvre et il ferme.

La vérité vient de systemd, pas d'un dictionnaire en mémoire. Un plan de
contrôle qui redémarre ne doit pas oublier les salles ouvertes; une liste tenue
ici serait fausse dès le premier redémarrage, et fausse d'une manière que
personne ne verrait avant d'avoir perdu une partie.

Trois emplacements, pas plus, décidé le 12 septembre 2026. La limite n'est pas
le nombre de salles mais ce qu'elles font tourner: une seule peut jouer à un jeu
Switch. La demande de trop ne fait pas la queue, elle est refusée tout de suite
avec de quoi comprendre.
"""

import time
from collections.abc import Awaitable, Callable, Sequence
from pathlib import Path

import anyio
import httpx
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


def adresse(numero: int) -> str:
    """Où joindre le worker de cette salle, de machine à machine.

    Les mêmes ports que le modèle d'unité, et pour la même raison qu'eux: le
    numéro s'insère dans le port plutôt que de se calculer. 8110 pour la salle
    1, 8120 pour la deuxième.
    """
    return f"http://127.0.0.1:81{numero}0"


def controle(numero: int) -> str:
    """Où DIRE quelque chose au worker de cette salle.

    Un autre port que celui des pages, et que le proxy ne relaie pas: c'est ce
    qui empêche un navigateur de se déclarer propriétaire. Même façon de compter
    que `adresse`, et pour la même raison.
    """
    return f"127.0.0.1:81{numero}1"


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

#: Ce qui demande à une salle quelles manettes sont tenues, par son adresse de
#: contrôle. Rend un reçu par place, `None` pour une place libre, et `None` tout
#: court quand la salle n'a rien répondu d'exploitable.
LecteurPlaces = Callable[[str], Awaitable[list[str | None] | None]]


async def par_le_systeme(commande: Sequence[str]) -> tuple[int, str]:
    """Le vrai lanceur. Injecté, pour que les essais n'aient pas besoin de systemd."""
    fini = await anyio.run_process(list(commande), check=False)
    dit = (fini.stdout + fini.stderr).decode(errors="replace").strip()
    return fini.returncode, dit


class SallesController:
    """Ouvre et ferme les salles de cette machine."""

    def __init__(
        self,
        settings: Settings,
        lancer: Lanceur = par_le_systeme,
        client: httpx.AsyncClient | None = None,
        lire_places: LecteurPlaces | None = None,
    ) -> None:
        self._settings = settings
        self._lancer = lancer
        #: Pour demander à chaque salle ce qu'elle joue. Absent en essai, et la
        #: liste dit alors seulement qui est ouverte: une salle qu'on ne peut
        #: pas interroger n'a pas de jeu CONNU, ce qui n'est pas « pas de jeu ».
        self._client = client
        #: Pour demander à chaque salle quelles manettes sont tenues. Absent en
        #: essai, et la liste ne dit alors rien des places. Absent PAR DÉFAUT, et
        #: c'est le point: le vrai lecteur ouvre une connexion vers le worker de
        #: cette machine, qui écoute pour de vrai, et un essai ne doit jamais
        #: dépendre de lui.
        self._lire_places = lire_places

    async def etat(
        self,
        present: Callable[[int], list[str]] | None = None,
    ) -> list[Salle]:
        """Toutes les salles, ouvertes ou non, ce qu'elles jouent et qui y est.

        `present` dit qui se trouve dans une salle. En PARAMÈTRE plutôt que
        retenu à la construction, et c'est délibéré: cette classe interroge
        systemd et les salles elles-mêmes, et ce qu'elle sait doit survivre à un
        worker mort. Lui donner un second contrôleur la ferait dépendre de
        l'état d'un troisième, pour une information qu'elle ne fait que relayer.

        Absent, la liste ne dit personne. C'est le cas des essais, et c'est plus
        honnête qu'une liste vide qui prétendrait que la salle est déserte.
        """
        salles = []
        for numero in SALLES:
            ouverte = await self.ouverte(numero)
            jeu, switch = await self._joue(numero) if ouverte else (None, False)
            salles.append(
                Salle(
                    numero=numero,
                    ouverte=ouverte,
                    chemin=chemin(numero),
                    jeu=jeu,
                    switch=switch,
                    # Une salle fermée n'a personne: le demander pour elle
                    # laisserait passer un fantôme si le registre traînait.
                    gens=list(present(numero)) if ouverte and present else [],
                    # Une salle fermée ne tourne DEPUIS rien et n'a pas de
                    # places: l'interroger ferait attendre la liste entière pour
                    # la salle la plus morte.
                    ouverte_depuis=await self._depuis(numero) if ouverte else None,
                    places=await self._places(numero) if ouverte else None,
                )
            )
        return salles

    async def _joue(self, numero: int) -> tuple[str | None, bool]:
        """Ce que cette salle fait tourner, demandé à elle-même.

        À la salle plutôt qu'à un registre: elle est la seule à savoir ce qui
        tourne vraiment chez elle, et un registre tenu ici serait faux dès
        qu'un joueur change de jeu sans passer par le salon.

        Un worker qui ne répond pas rend « aucun jeu connu » plutôt qu'une
        erreur: la liste doit rester affichable même si une salle boude.
        """
        if self._client is None:
            return None, False
        try:
            reponse = await self._client.get(f"{adresse(numero)}/roms", timeout=2.0)
            reponse.raise_for_status()
            dit = reponse.json()
        except (httpx.HTTPError, ValueError):
            return None, False
        courant = dit.get("current")
        jeux = dit.get("roms") or []
        if not isinstance(courant, int) or not 0 <= courant < len(jeux):
            return None, False
        joue = jeux[courant]
        return joue.get("name"), joue.get("console") == "switch"

    async def _depuis(self, numero: int) -> int | None:
        """Depuis combien de secondes cette salle tourne, demandé à systemd.

        L'horloge MONOTONE plutôt que l'horodatage lisible. systemd écrit aussi
        « Sat 2026-09-12 23:19:54 UTC », qu'il faudrait analyser avec son jour,
        son mois et son fuseau; une analyse qui se trompe de fuseau rend une
        ancienneté fausse, pas une ancienneté absente, et une valeur fausse est
        pire que pas de valeur. Des microsecondes depuis le démarrage de la
        machine ne se lisent que d'une façon. Les deux ont été comparées sur
        cette machine le 12 septembre 2026: 0,7 seconde d'écart sur 264, soit le
        délai entre les deux questions.

        L'unité est le dernier mot de la commande, comme partout dans ce fichier.
        """
        code, dit = await self._lancer(
            [
                "systemctl",
                "show",
                "--value",
                "-p",
                "ActiveEnterTimestampMonotonic",
                unite(numero),
            ]
        )
        if code != 0:
            return None
        try:
            demarree = int(dit.strip())
        except ValueError:
            return None
        # `0` est ce que systemd rend pour une unité qui n'a jamais démarré. Le
        # rendre tel quel afficherait « ouverte depuis 0 seconde », c'est-à-dire
        # une absence déguisée en mesure.
        if demarree <= 0:
            return None
        age = time.monotonic() - demarree / 1_000_000
        return int(age) if age >= 0 else None

    async def _places(self, numero: int) -> int | None:
        """Combien de manettes personne ne tient, demandé à la salle elle-même.

        À elle plutôt qu'au salon, et ce n'est pas la même question: le salon
        sait qui est CONNECTÉ, ce qui n'est pas qui tient une manette. Quelqu'un
        qui regarde sans jouer ferait compter occupée une place qui est libre.

        Une salle qui se tait rend « on ne sait pas », jamais quatre places
        libres: c'est l'annonce qui enverrait du monde sur une salle pleine.
        """
        if self._lire_places is None:
            return None
        places = await self._lire_places(controle(numero))
        if places is None:
            return None
        return sum(1 for tenue in places if tenue is None)

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
