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

import logging
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

import anyio
import httpx
from anyio import to_thread
from fastapi import HTTPException, status

from nel3ab_control import session_salle
from nel3ab_control.api.schemas.salle import DernierJeu, Salle
from nel3ab_control.catalogue import Catalogue, freshest
from nel3ab_control.consoles import CONSOLES
from nel3ab_control.session_salle import Ouverture, demarrage_actuel
from nel3ab_control.settings import Settings
from nel3ab_control.worker import valid_key

LOG = logging.getLogger(__name__)

#: Les emplacements que cette machine accepte de tenir.
#:
#: Trois, décidé le 12 septembre 2026. La limite n'est pas le nombre de salles
#: mais ce qu'elles font tourner: une seule peut jouer à un jeu Switch, parce
#: que Ryubing coûte bien plus cher que Dolphin. Voir `switch.py`.
SALLES: tuple[int, ...] = (1, 2, 3)

#: Le marqueur qui dit au worker « ouverte, mais sans jeu ».
SANS_JEU = session_salle.SANS_JEU

#: Ce que le salon demande à systemd d'une salle, en UNE question.
#:
#: Lu par nom (`Nom=valeur`) et jamais par position: `systemctl show -p A -p B`
#: rend les propriétés dans son propre ordre, pas dans celui qu'on demande
#: (relu sur lgf le 23 novembre 2026, systemd 255). Avec `--value`, plusieurs
#: valeurs sans nom ne se lisent donc pas.
PROPRIETES = (
    "ActiveEnterTimestampMonotonic",
    "InactiveEnterTimestampMonotonic",
    "InactiveExitTimestampMonotonic",
    "ExecMainStatus",
    "Result",
)

#: Combien de temps une unité peut rester INACTIVE pour que ce soit une relance.
#:
#: Un changement de jeu fait sortir le worker et systemd 255 le fait passer par
#: l'état inactif le temps d'un pas: « Deactivated successfully » à
#: 07:09:06.65 et `InactiveExitTimestamp` à 07:09:06, puis deux secondes en
#: « activating » (`RestartSec=2`) avant d'être actif à 07:09:08 (journal de la
#: salle 1, 22 novembre 2026). Une salle fermée puis rallumée reste inactive le
#: temps de sa fermeture, des minutes en pratique. Une seconde sépare les deux
#: sans dépendre de `RestartSec`, qui se passe en « activating ».
PAUSE_DE_RELANCE_S = 1.0

#: Ce que systemd dit d'une salle. Trois valeurs et pas deux: voir `unite`.
EtatUnite = Literal["ouverte", "redemarre", "fermee"]

#: Pourquoi une salle est fermée, lu dans systemd. Voir `_fermee`.
RaisonFermeture = Literal["inactivite", "arret", "panne"]

#: Le code de sortie du worker qui ferme une salle faute d'activité
#: (`nap.rs`), que `RestartPreventExitStatus=42` empêche de relancer.
SORTIE_INACTIVITE = "42"


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
        horloge: Callable[[], float] = time.monotonic,
        demarrage: Callable[[], str | None] = demarrage_actuel,
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
        #: L'horloge MONOTONE qui mesure l'ancienneté d'une salle. Passée plutôt
        #: que lue en dur, pour qu'un essai donne la même au faux systemd. Le
        #: 13 septembre 2026, le faux calculait son horodatage sur la vraie
        #: horloge: sur un runner démarré depuis moins de cinq minutes, il
        #: devenait négatif, et l'essai échouait en CI tout en passant ici.
        #: Figer `time.monotonic` pour tout le processus aurait aussi figé la
        #: boucle d'asyncio, qui mesure le temps avec elle.
        self._horloge = horloge
        #: L'identifiant du démarrage de la machine: l'horloge monotone repart à
        #: zéro à chaque démarrage, et un repère d'ouverture d'avant ne vaut rien.
        self._demarrage = demarrage

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
        # Les dossiers des trois salles et la bibliothèque, lus en une fois sur
        # un fil: une lecture de disque sur la boucle bloquerait tout le salon.
        dossiers, catalogue = await to_thread.run_sync(self._lire_dossiers)
        salles = []
        for numero in SALLES:
            dossier = dossiers[numero]
            dernier = _dernier_jeu(dossier.retenu, catalogue)
            mot = await self._mot(numero)
            etat = _etat_du_mot(mot)
            ouverte = etat == "ouverte"
            # Une seule question à systemd par salle, quel que soit son état:
            # l'ouverture pour une salle allumée, l'heure et la raison de la
            # fermeture pour une salle éteinte.
            systeme = await self._systemd(numero)
            # « deactivating » est une salle fermée pour la liste, mais elle n'a
            # pas encore d'heure de fermeture: son dernier passage par l'inactif
            # est celui de son dernier changement de jeu.
            fermee_depuis, fermee_pour = (
                self._fermee(systeme) if mot in ("inactive", "failed") else (None, None)
            )
            vu = await self._joue(numero) if ouverte else None
            if etat == "redemarre" and dossier.sur_son_menu is False and dernier is not None:
                # Une salle qui redémarre pour un changement de jeu a déjà écrit
                # ce jeu et retiré le marqueur « sans jeu » avant de sortir
                # (`remember_choice`, worker/main.rs): c'est lui qui revient.
                # Sans le marqueur lisible, on ne sait pas: rien.
                vu = _joue_retenu(dernier, catalogue)
            salles.append(
                Salle(
                    numero=numero,
                    ouverte=ouverte,
                    redemarre=etat == "redemarre",
                    chemin=chemin(numero),
                    jeu=vu.nom if vu else None,
                    cle=vu.cle if vu else None,
                    console=vu.console if vu else None,
                    switch=vu.switch if vu else False,
                    repond=vu.repond if vu and etat == "ouverte" else None,
                    dernier_jeu=dernier,
                    fermee_depuis=fermee_depuis,
                    fermee_pour=fermee_pour,
                    # Une salle fermée n'a personne: le demander pour elle
                    # laisserait passer un fantôme si le registre traînait.
                    gens=list(present(numero)) if ouverte and present else [],
                    # Une salle fermée ne tourne DEPUIS rien et n'a pas de
                    # places: l'interroger ferait attendre la liste entière pour
                    # la salle la plus morte.
                    ouverte_depuis=self._ouverte_depuis(dossier.ouverture, systeme)
                    if etat != "fermee"
                    else None,
                    jeu_depuis=self._age(systeme.get("ActiveEnterTimestampMonotonic"))
                    if ouverte
                    else None,
                    places=await self._places(numero) if ouverte else None,
                )
            )
        return salles

    async def _joue(self, numero: int) -> "Joue | None":
        """Ce que cette salle fait tourner, demandé à elle-même.

        À la salle plutôt qu'à un registre: elle est la seule à savoir ce qui
        tourne vraiment chez elle, et un registre tenu ici serait faux dès
        qu'un joueur change de jeu sans passer par le salon.

        Un worker qui ne répond pas rend « aucun jeu connu » plutôt qu'une
        erreur: la liste doit rester affichable même si une salle boude. Il le
        rend en le DISANT (`repond` faux), pour que l'accueil distingue une
        salle muette d'une salle sur son menu. Rien sans client: on n'a pas
        demandé, ce qui n'est ni l'un ni l'autre.
        """
        if self._client is None:
            return None
        try:
            reponse = await self._client.get(f"{adresse(numero)}/roms", timeout=2.0)
            reponse.raise_for_status()
            dit = reponse.json()
        except (httpx.HTTPError, ValueError):
            return Joue(repond=False)
        if not isinstance(dit, dict):
            return Joue(repond=False)
        courant = dit.get("current")
        jeux = dit.get("roms") or []
        if not isinstance(jeux, list) or not isinstance(courant, int):
            return Joue(repond=True)
        if not 0 <= courant < len(jeux) or not isinstance(jeux[courant], dict):
            return Joue(repond=True)
        joue = jeux[courant]
        nom, cle, console = joue.get("name"), joue.get("key"), joue.get("console")
        return Joue(
            repond=True,
            nom=nom if isinstance(nom, str) else None,
            cle=cle if isinstance(cle, str) and valid_key(cle) else None,
            console=_console_connue(console),
            # « Joue à la Switch » veut dire « tient la place Switch de la
            # machine »: le groupe de verrou du manifeste, et non la liste de
            # ses consoles.
            switch=CONSOLES.lock(str(console)) == "switch",
        )

    def _lire_dossiers(self) -> tuple[dict[int, "Dossier"], Catalogue | None]:
        """Ce que le salon lit dans le dossier de chaque salle, et la bibliothèque.

        Appelée sur un fil. La bibliothèque n'est lue que si une salle a retenu
        un jeu: c'est elle qui donne son titre.
        """
        racine = self._settings.salles_dir
        dossiers = {
            numero: Dossier(
                retenu=session_salle.jeu_retenu(racine, numero),
                sur_son_menu=session_salle.sur_son_menu(racine, numero),
                ouverture=session_salle.lire_ouverture(racine, numero),
            )
            for numero in SALLES
        }
        catalogue = freshest(racine) if any(d.retenu for d in dossiers.values()) else None
        return dossiers, catalogue

    async def _systemd(self, numero: int) -> dict[str, str]:
        """Ce que systemd dit de cette salle, par nom de propriété.

        Vide quand systemd ne répond pas: chaque lecture retombe alors sur rien.

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
        commande = ["systemctl", "show"]
        for propriete in PROPRIETES:
            commande += ["-p", propriete]
        code, dit = await self._lancer([*commande, unite(numero)])
        if code != 0:
            return {}
        lu: dict[str, str] = {}
        for ligne in dit.splitlines():
            nom, egal, valeur = ligne.partition("=")
            if egal and nom in PROPRIETES:
                lu[nom] = valeur.strip()
        return lu

    def _age(self, microsecondes: str | int | None) -> int | None:
        """Les secondes écoulées depuis cet instant d'horloge monotone, ou rien.

        `0` est ce que systemd rend pour une unité qui n'a jamais démarré. Le
        rendre tel quel afficherait « ouverte depuis 0 seconde », c'est-à-dire
        une absence déguisée en mesure.
        """
        try:
            instant = int(microsecondes) if microsecondes is not None else 0
        except ValueError:
            return None
        if instant <= 0:
            return None
        age = self._horloge() - instant / 1_000_000
        return int(age) if age >= 0 else None

    def _fermee(self, systeme: dict[str, str]) -> tuple[int | None, RaisonFermeture | None]:
        """Depuis combien de secondes une salle ÉTEINTE l'est, et pourquoi.

        systemd le sait sans aucun droit (relu le 23 novembre 2026 sur la salle
        1, fermée la veille faute d'activité: `ActiveState=failed`,
        `Result=exit-code`, `ExecMainStatus=42`). Trois raisons:

        - « inactivite »: le worker est sorti avec le code 42 (`nap.rs`);
        - « arret »: une sortie propre, c'est-à-dire `systemctl stop` (le salon,
          l'administrateur);
        - « panne »: tout le reste, dont systemd qui renonce à relancer.

        Qui a fermé n'est pas publié: le journal des séances le garde déjà.
        Une unité jamais démarrée depuis le démarrage de la machine rend `0`:
        rien, ni heure ni raison.
        """
        depuis = self._age(systeme.get("InactiveEnterTimestampMonotonic"))
        if depuis is None:
            return None, None
        resultat = systeme.get("Result")
        if resultat == "exit-code" and systeme.get("ExecMainStatus") == SORTIE_INACTIVITE:
            return depuis, "inactivite"
        if resultat == "success":
            return depuis, "arret"
        return depuis, "panne" if resultat else None

    def _ouverte_depuis(self, repere: Ouverture | None, systeme: dict[str, str]) -> int | None:
        """Depuis quand le SALON a ouvert cette salle, ou rien.

        Le repère `ouverte-le` est posé par `ouvrir`, après que systemd a pris
        le démarrage, et retiré par `fermer`. Il est écarté dans trois cas:

        - il vient d'un autre démarrage de la machine (l'horloge a repris à 0);
        - la salle n'est pas ouverte ni relancée (`systeme` vide);
        - la salle s'est fermée seule après lui puis a été rallumée hors du
          salon: sa dernière pause inactive a duré plus que `PAUSE_DE_RELANCE_S`
          et a fini après le repère. Une relance de changement de jeu passe
          par l'inactif le temps d'un pas: elle ne périme pas le repère.

        Ce qui n'est pas couvert: une salle fermée seule, rallumée à la main
        hors du salon, PUIS relancée par un changement de jeu. La pause longue
        n'est plus la dernière, et l'ancien repère passe. systemd ne garde que
        la dernière pause.
        """
        if not systeme:
            return None
        if repere is None or repere.demarrage != self._demarrage():
            return None
        try:
            entree = int(systeme.get("InactiveEnterTimestampMonotonic", "0"))
            sortie = int(systeme.get("InactiveExitTimestampMonotonic", "0"))
        except ValueError:
            return None
        pause_longue = sortie - entree > PAUSE_DE_RELANCE_S * 1_000_000
        if repere.monotone_us < sortie and pause_longue:
            return None
        return self._age(repere.monotone_us)

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

    async def _mot(self, numero: int) -> str:
        """Le mot que `systemctl is-active` rend pour cette salle, tel quel."""
        code, dit = await self._lancer(["systemctl", "is-active", unite(numero)])
        return "active" if code == 0 else dit.strip()

    async def unite(self, numero: int) -> EtatUnite:
        """Ce que systemd dit de cette salle: elle tourne, il la relance, ou rien.

        SANS sudo, et c'est délibéré: lire un état ne demande aucun droit, et
        tout ce qui passe par sudo est une ligne de plus qu'un service joignable
        par le réseau peut faire tourner en tant que root.

        Le MOT, et pas seulement le code. Le worker sort à chaque changement de
        jeu, et `Restart=always` le relance deux secondes plus tard
        (`RestartSec=2`, `deploy/nel3ab-worker@.service`). Pendant ces deux
        secondes, `is-active` répond « activating » avec le code 3, le même
        qu'une unité arrêtée. Lire le code seul disait la salle fermée: la page
        d'un joueur affichait « La salle 1 est fermée. » à chaque changement de
        jeu, et « ouvrir une salle » pouvait reprendre cet emplacement, y poser
        le marqueur « sans jeu » et faire revenir la partie sur son menu
        (relecture du 22 novembre 2026). « deactivating » reste une salle
        fermée: c'est aussi l'état d'une salle qu'on ferme, et la page ne croit
        une salle fermée qu'après deux réponses espacées (`front/src/media/veille.ts`).
        """
        return _etat_du_mot(await self._mot(numero))

    async def ouvrir(self) -> Salle:
        """Allume le premier emplacement libre, ou refuse."""
        for numero in SALLES:
            # Une salle que systemd relance n'est PAS libre: voir `unite`.
            if await self.unite(numero) != "fermee":
                continue
            try:
                self._preparer(numero)
            except OSError as erreur:
                # Un dossier de salle remplacé par un lien, ou illisible: la
                # salle ne démarre pas, et la raison remonte au lieu d'une 500.
                raise SalleRebelle(
                    numero, f"son dossier est refusé ({erreur.strerror})"
                ) from erreur
            code, dit = await self._lancer(["sudo", "-n", "systemctl", "start", unite(numero)])
            if code != 0:
                raise SalleRebelle(numero, dit)
            self._noter_ouverture(numero)
            return Salle(numero=numero, ouverte=True, chemin=chemin(numero))
        raise PlusDeSalle

    async def fermer(self, numero: int) -> Salle:
        """Éteint une salle. Éteindre une salle déjà éteinte ne fait rien."""
        if numero not in SALLES:
            raise SalleInconnue(numero)
        code, dit = await self._lancer(["sudo", "-n", "systemctl", "stop", unite(numero)])
        if code != 0:
            raise SalleRebelle(numero, dit)
        session_salle.retirer_ouverture(self._settings.salles_dir, numero)
        return Salle(numero=numero, ouverte=False, chemin=chemin(numero))

    def _noter_ouverture(self, numero: int) -> None:
        """Pose le repère d'ouverture, APRÈS que systemd a pris le démarrage.

        Après et pas avant: posé avant, il précéderait la sortie de l'état
        inactif, et une salle fermée depuis une heure le verrait périmé dès son
        ouverture (voir `_ouverte_depuis`). Un repère qu'on ne peut pas écrire
        laisse la salle ouverte, sans ancienneté connue.
        """
        demarrage = self._demarrage()
        if demarrage is None:
            return
        repere = Ouverture(demarrage=demarrage, monotone_us=int(self._horloge() * 1_000_000))
        try:
            session_salle.poser_ouverture(self._settings.salles_dir, numero, repere)
        except OSError:
            LOG.warning("le repère d'ouverture de la salle %s n'a pas pu être posé", numero)

    def _preparer(self, numero: int) -> None:
        """Une salle qu'on ouvre arrive sur son menu, pas sur un jeu.

        Sans ce marqueur, le worker relance le dernier jeu retenu dans ce
        dossier, et une salle qu'on vient d'ouvrir démarrerait un émulateur que
        personne n'a demandé. Posé ici plutôt que par l'unité: systemd sait
        créer un dossier, pas y écrire un fichier.

        Par le descripteur du dossier, sans suivre de lien (ADR D36): un lien
        laissé à ce nom par un moteur est retiré, pas suivi.
        """
        with session_salle.dossier(self._settings.salles_dir, numero, creer=True) as fd:
            session_salle.poser_vide(fd, SANS_JEU)


def _etat_du_mot(mot: str) -> EtatUnite:
    """Le mot de `systemctl is-active`, ramené aux trois états d'une salle."""
    if mot == "active":
        return "ouverte"
    return "redemarre" if mot == "activating" else "fermee"


@dataclass(frozen=True)
class Joue:
    """Ce qu'une salle allumée a répondu à `GET /roms`, ou le jeu qui revient."""

    #: Faux quand la salle n'a rien répondu d'exploitable.
    repond: bool
    nom: str | None = None
    cle: str | None = None
    console: str | None = None
    switch: bool = False


@dataclass(frozen=True)
class Dossier:
    """Ce que le salon a lu dans le dossier de session d'une salle."""

    retenu: session_salle.JeuRetenu | None
    sur_son_menu: bool | None
    ouverture: Ouverture | None


def _console_connue(code: object) -> str | None:
    """Le code d'une console du manifeste, ou rien pour « ? » et l'inconnu."""
    return code if isinstance(code, str) and CONSOLES.console(code) is not None else None


def _dernier_jeu(
    retenu: session_salle.JeuRetenu | None, catalogue: Catalogue | None
) -> DernierJeu | None:
    """Le jeu retenu, avec son titre, s'il est encore dans la bibliothèque.

    Rien quand la clé n'y est plus: un titre inventé à partir du nom de fichier
    dirait un jeu que la salle ne peut plus lancer.
    """
    if retenu is None or catalogue is None:
        return None
    jeu = next((one for one in catalogue.games if one.key == retenu.cle), None)
    if jeu is None:
        return None
    return DernierJeu(
        cle=jeu.key, titre=jeu.name, quand=datetime.fromtimestamp(retenu.choisi, tz=UTC)
    )


def _joue_retenu(dernier: DernierJeu, catalogue: Catalogue | None) -> Joue:
    """Le jeu qui revient après une relance, tel que la bibliothèque le décrit."""
    jeux = catalogue.games if catalogue else []
    console = next((one.console for one in jeux if one.key == dernier.cle), None)
    return Joue(
        repond=False,
        nom=dernier.titre,
        cle=dernier.cle,
        console=_console_connue(console),
        switch=console is not None and CONSOLES.lock(console) == "switch",
    )
