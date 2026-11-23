"""Les places tenues d'une salle, telles que le journal des parties les raconte.

Le contrôleur de salle tient QUI a quelle prise; ce module tient depuis QUAND,
pendant quel jeu, lancé par qui et dans quelle sauvegarde. Il écrit au journal
des parties (`nel3ab_control.parties`) un début et une fin pour chaque place.

Il est appelé par le contrôleur de salle à chaque changement de ses places, et
seulement par lui: c'est le seul qui les change, donc le seul endroit où une
fin de place ne peut pas être oubliée par un nouveau chemin.

# La sauvegarde de qui

Décision de Souhib, 21 novembre 2026: quand plusieurs personnes jouent, la
sauvegarde appartient à celle qui a lancé le jeu, sauf « tout débloqué », commune
à tout le monde. Chaque début de place retient donc le dernier lancement de CE
jeu dans cette salle. Un jeu qui tournait avant le salon n'a pas de lancement
connu: sa place le dit (`lance` vaut rien, la sauvegarde est inconnue), plutôt
que d'en inventer un.
"""

import secrets
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic

from nel3ab_control.parties import EMPLACEMENTS, Fin, JeuJoue, Parties, Sauvegarde, sauvegarde_de
from nel3ab_control.personnes import empreinte


@dataclass(frozen=True)
class Lancement:
    """Qui a lancé un jeu dans cette salle, et dans quelle sauvegarde."""

    #: L'empreinte de l'adresse de qui a lancé, ou rien sans identité.
    par: str | None
    pseudo: str
    jeu: JeuJoue
    sauvegarde: Sauvegarde
    #: L'adresse de qui a lancé, en mémoire seulement: jamais écrite au journal
    #: ni publiée. Elle sert à calculer son repère pour la salle (`Room.lancement`).
    login: str | None = None
    #: Combien de changements de jeu la salle avait vus à ce lancement.
    vus: int = 0

    def ligne(self) -> dict[str, str | None]:
        return {"empreinte": self.par, "pseudo": self.pseudo}


@dataclass(frozen=True)
class PlaceOuverte:
    """Une place dont le début est écrit et la fin pas encore."""

    id: str
    login: str
    port: int
    jeu: JeuJoue | None
    #: Sur l'horloge monotone: régler l'heure de la machine ne change pas une durée.
    depuis: float
    #: Le numéro du dernier ordre de changement de jeu au moment du début.
    generation: int


class Tablee:
    """Les places ouvertes d'UNE salle, et leur trace durable."""

    def __init__(
        self, salle: int, parties: Parties, horloge: Callable[[], float] = monotonic
    ) -> None:
        self.salle = salle
        self._parties = parties
        self._horloge = horloge
        #: Session -> sa place ouverte. Une session tient une place au plus.
        self._ouvertes: dict[str, PlaceOuverte] = {}
        #: Session -> « est-ce sa première fois dans cette salle », pour l'état
        #: public. Gardé tant que la session tient sa place.
        self._premieres: dict[str, bool] = {}
        #: Le jeu qui tourne, d'après la dernière bibliothèque lue.
        self._jeu: JeuJoue | None = None
        self._jeu_connu = False
        #: Le dernier lancement de chaque jeu dans cette salle, par identité du jeu.
        self._lancements: dict[str, Lancement] = {}
        #: Compte les ordres de changement de jeu (lancer, fermer). Une place
        #: perdue après un tel ordre a perdu son jeu, pas sa prise.
        self._generation = 0
        #: Compte les changements de jeu VUS dans la bibliothèque, quel que soit
        #: le chemin qui les a faits. Voir `lancement_courant`.
        self._changements = 0

    @property
    def parties(self) -> Parties:
        return self._parties

    def premiere(self, session: str | None) -> bool | None:
        """Vrai si cette session tient sa première place dans cette salle.

        Rien quand on ne sait pas: pas d'identité, une page de banc, ou un
        journal illisible. La page retombe alors sur sa propre mémoire.
        """
        if session is None:
            return None
        return self._premieres.get(session)

    def assis(self, session: str, login: str | None, port: int) -> None:
        """Une session tient cette prise. Écrit un début si la place est nouvelle.

        Sans identité, rien n'est écrit: il n'y a pas de fichier à qui
        l'attribuer, et la session n'a pas de première fois connue.
        """
        ouverte = self._ouvertes.get(session)
        if ouverte is not None and ouverte.port == port:
            return
        if ouverte is not None:
            self.leve(session, Fin.QUITTEE)
        if login is None:
            self._premieres.pop(session, None)
            return
        deja = self._parties.deja_assis(login, self.salle)
        if deja is None:
            self._premieres.pop(session, None)
        else:
            self._premieres[session] = not deja
        self._commence(session, login, port, self._jeu)

    def leve(self, session: str, raison: Fin) -> None:
        """La place de cette session se termine. Rien si elle n'en tenait pas."""
        self._premieres.pop(session, None)
        ouverte = self._ouvertes.pop(session, None)
        if ouverte is not None:
            self._termine(ouverte, raison)

    def perdue(self, session: str) -> Fin:
        """Pourquoi le worker a repris la prise de cette session.

        Après un ordre de changement de jeu, c'est le jeu qui a changé: le
        worker redémarre et redonne toutes les prises. Sans ordre, quelqu'un
        d'autre a eu cette prise.
        """
        ouverte = self._ouvertes.get(session)
        if ouverte is not None and ouverte.generation < self._generation:
            return Fin.JEU_CHANGE
        return Fin.REMPLACEE

    def jeu(self, courant: JeuJoue | None) -> None:
        """Le jeu qui tourne, lu à chaque bibliothèque. Un changement coupe les places.

        Chaque place ouverte sur un autre jeu se termine (« jeu changé ») et
        reprend aussitôt sur le nouveau, sans changer de prise ni de première
        fois. Le premier jeu lu remplace aussi un jeu inconnu: une place prise
        avant la première bibliothèque n'était pas « sur le menu ».
        """
        if self._jeu_connu and courant == self._jeu:
            return
        self._jeu, self._jeu_connu = courant, True
        self._changements += 1
        for session, ouverte in list(self._ouvertes.items()):
            if ouverte.jeu == courant:
                continue
            del self._ouvertes[session]
            self._termine(ouverte, Fin.JEU_CHANGE)
            self._commence(session, ouverte.login, ouverte.port, courant)

    def lance(self, login: str | None, pseudo: str, jeu: JeuJoue, emplacement: int | None) -> None:
        """Quelqu'un a lancé ce jeu, et le worker a pris l'ordre.

        `emplacement` est le code de la préparation, ou rien pour un lancement
        qui ne passe pas par elle et ne nomme donc personne au worker. La ligne
        `lancement` va au fichier de qui lance, s'il a une identité.
        """
        sauvegarde = sauvegarde_de(emplacement, login)
        self._generation += 1
        self._lancements[jeu.identite()] = Lancement(
            par=empreinte(login) if login else None,
            pseudo=pseudo,
            jeu=jeu,
            sauvegarde=sauvegarde,
            login=login,
            vus=self._changements,
        )
        if login is not None:
            self._parties.ecrire(
                login,
                "lancement",
                salle=self.salle,
                jeu=jeu.ligne(),
                emplacement=EMPLACEMENTS[emplacement] if emplacement is not None else None,
                sauvegarde=sauvegarde.value,
            )

    def lancement_courant(self) -> Lancement | None:
        """Qui a lancé le jeu qui tourne, et dans quelle sauvegarde, ou rien.

        Rien quand aucun jeu ne tourne, quand le salon n'a vu aucun lancement de
        ce jeu (il tournait avant le redémarrage du salon), et quand le jeu a
        changé plus d'une fois depuis ce lancement: revenu ensuite par un chemin
        qui ne passe pas par le salon, il n'a pas été lancé par cette personne.
        Un lancement attend UN changement, celui vers son jeu, ou aucun quand on
        relance le jeu qui tourne déjà.
        """
        if not self._jeu_connu or self._jeu is None:
            return None
        lancement = self._lancements.get(self._jeu.identite())
        if lancement is None or self._changements - lancement.vus > 1:
            return None
        return lancement

    def arrete(self) -> None:
        """Le jeu a été fermé: les prises que le worker reprend ont perdu leur jeu."""
        self._generation += 1

    def fermee(self) -> None:
        """La salle ferme: toutes ses places se terminent."""
        for session in list(self._ouvertes):
            self.leve(session, Fin.SALLE_FERMEE)
        self._jeu, self._jeu_connu = None, False

    def ouvertes(self, login: str) -> dict[str, float]:
        """Les places ouvertes de cette personne: leur `id`, et leurs secondes."""
        maintenant = self._horloge()
        return {
            ouverte.id: max(0.0, maintenant - ouverte.depuis)
            for ouverte in self._ouvertes.values()
            if ouverte.login == login
        }

    def _commence(self, session: str, login: str, port: int, jeu: JeuJoue | None) -> None:
        lancement = self._lancements.get(jeu.identite()) if jeu else None
        ouverte = PlaceOuverte(
            id=secrets.token_hex(8),
            login=login,
            port=port,
            jeu=jeu,
            depuis=self._horloge(),
            generation=self._generation,
        )
        self._ouvertes[session] = ouverte
        self._parties.assis(login, self.salle)
        self._parties.ecrire(
            login,
            "place_debut",
            id=ouverte.id,
            salle=self.salle,
            place=port,
            jeu=jeu.ligne() if jeu else None,
            lance=lancement.ligne() if lancement else None,
            sauvegarde=(lancement.sauvegarde if lancement else Sauvegarde.INCONNUE).value,
        )

    def _termine(self, ouverte: PlaceOuverte, raison: Fin) -> None:
        self._parties.ecrire(
            ouverte.login,
            "place_fin",
            id=ouverte.id,
            salle=self.salle,
            secondes=round(max(0.0, self._horloge() - ouverte.depuis), 1),
            raison=raison.value,
        )
