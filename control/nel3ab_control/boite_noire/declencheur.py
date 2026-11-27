"""Quand la cadence chute, le dire, une fois.

Les pages envoient déjà leur cadence au salon toutes les dix secondes, et le salon
l'écrit dans son journal. La boîte noire relit ces lignes au lieu de demander au
salon de la prévenir: le salon ne change pas, et une boîte noire en panne ne peut
pas gêner la salle.

# La règle

Une salle chute quand la médiane de la cadence de ses pages, sur les trente
dernières secondes, reste sous le seuil, et qu'au moins trois mesures le disent.
Une mesure seule ne suffit pas: une page qui recharge ou un onglet mis en arrière
plan en envoient une mauvaise. Après une chute de cadence, la même salle se tait
cinq minutes, sinon une soirée lente remplirait le disque de profils identiques.
Un gel a sa propre pause, plus courte: voir plus bas.

# Le seuil suit le plafond du jeu

Le seuil ordinaire, 50, vient des jeux à 60 images par seconde. Un jeu que sa
politique de lancement plafonne plus bas vit toujours sous ce seuil. Le 11
novembre 2026, Zelda sur Switch 2, plafonné à 30, « chutait » donc dès sa
troisième mesure, se taisait cinq minutes, puis recommençait: six captures de
cadence sur sept portaient une médiane de 30,0. La seule vraie chute du jour, 15
à 17 images par seconde pendant un transcodage sur la même carte graphique, est
tombée dans un de ces silences et n'a pas été saisie.

Un jeu de la table `plafonds` chute donc sous une PART de son plafond, 0,9 par
défaut, soit 27 pour un plafond de 30. La page arrondit sa cadence à l'entier et
la comparaison est stricte: la salle chute à une médiane de 26,5 ou moins.

La cadence se juge sur les mesures du jeu EN COURS. Quand une salle passe de
Zelda à un jeu à 60, les 30 encore dans la fenêtre sont ceux de Zelda, et les
compter ferait chuter le nouveau jeu avant sa première image lente.

# La seconde règle: le GEL

Le 16 septembre 2026, deux joueurs ont signalé des mini-freezes et la boîte noire
n'a rien capturé. Leurs pages perdaient une seconde d'images toutes les deux
minutes et demie, mais la MÉDIANE de la cadence restait à 60: un trou d'une
seconde sur dix ne la déplace pas. La règle du dessus ne voit que ce qui dure.

Une seule mesure suffit ici, parce qu'un trou d'une demi-seconde ne s'invente pas:
la page mesure l'écart entre deux images REÇUES, et une page en arrière-plan
continue d'en recevoir.

Un gel ne fait taire la salle qu'UNE MINUTE (`pause_gel`), et pas cinq comme une
chute de cadence. Le 27 novembre 2026, la pause de cinq minutes ouverte par le trou
de 1 488 ms de 00:33:23 aurait couvert le gel de 543 ms de 00:36:14: la pause
elle-même faisait perdre les gels distincts. Une minute laisse finir la capture
(dix secondes de profil), et une soirée qui gèle sans arrêt prend au plus une
capture par minute et par salle, de 2 à 5 Mo chacune (captures du 27 novembre).

Ce qui borne vraiment le disque est ailleurs: un MÊME gel ne prend qu'une capture,
même s'il dure ou se voit dans plusieurs fenêtres de suite. Une page garde ses six
cents derniers écarts (`video.ts`): quand elle reçoit peu d'images, le même trou
reste le pire de plusieurs fenêtres. Et pendant un gel qui dure, la page écrit
une attente qui grandit de dix secondes par fenêtre. Une fenêtre continue donc le
gel de la fenêtre d'avant de la même page, à trente secondes au plus, quand elle
n'a reçu aucune image, quand son pire couvre l'attente qui courait, ou quand son
pire est le même avec moins de six cents images reçues.

# La portée d'un gel: la salle, ou une page

Le 22 septembre 2026 à 23:25, la boîte noire a pris une capture complète, profil
de l'émulateur compris, pour un gel de 8,9 s qui ne touchait que la page de Hyde:
les deux autres recevaient leurs images à 19 et 29 ms près au même instant. Le
profil décrivait une salle qui allait bien. Un gel porte donc une PORTÉE:

- « salle » quand deux pages au moins ont gelé dans la fenêtre, ou quand il n'y a
  qu'une page, puisque rien ne permet alors de dire que la salle allait bien;
- « page » quand une seule page a gelé pendant que les autres recevaient.

Une chute de cadence est toujours de salle: la médiane réunit toutes les pages.
Chaque portée a sa pause. Une page qui tousse ne fait pas taire la vraie chute de
salle qui la suit; une chute de salle, qui couvre déjà les pages, fait taire les
gels de page qui la suivent.

Les pilotes d'essai (`banc`) et les pages sans jeu sont ignorés: le premier
remplirait la boîte de ses propres essais, le second mesure un menu.

# Le démarrage d'un jeu n'est pas un gel

Le 27 novembre 2026 à 00:33:15, la boîte noire a pris une capture « gel » de
33 386 ms. La page attendait la première image de Smash depuis 33 s: c'était le
chargement du jeu. La pause qu'elle a ouverte a fait taire le vrai gel de 543 ms
de 00:36:14, qui n'a eu ni profil, ni image, ni journal.

Une salle est donc « en démarrage » quand elle change de jeu, quand le salon écrit
qu'une de ses pages en lance un (`changement`, même jeu compris), ou quand la
première fenêtre qu'on voit de son jeu dit que la page ne le voit pas encore
tourner. Elle le reste jusqu'à la première fenêtre où la page le voit tourner
(une cadence, ou une attente d'image en partie), et cette fenêtre-là, qui porte le
trou du chargement, compte encore comme démarrage. Un trou de démarrage au-dessus du seuil
est rendu une fois, avec la cause « démarrage »: le service l'écrit sans capture,
et il n'ouvre aucune pause.

Le démarrage se ferme aussi PAGE PAR PAGE. Une salle a jusqu'à quatre joueurs,
et chaque page reçoit sa première image un instant après la première: sa fenêtre
porte le même trou de chargement. Rejoué le 27 novembre 2026 sur les mesures de
Smash recopiées pour trois pages, la deuxième et la troisième prenaient une
capture « gel » de 33 386 ms, et la minute de pause de la salle taisait le vrai
trou de 1 488 ms qui suivait. Chaque page reste donc en démarrage jusqu'à sa
propre première fenêtre où elle voit le jeu tourner, comprise, pourvu qu'elle
vienne dans les trente secondes (`fenetre`) après celle qui a fermé le démarrage
de la salle. Une page arrivée plus tard en pleine partie n'a pas de chargement.

Ce que ça coûte: un vrai gel dans la première fenêtre d'images de chaque page n'est
plus capturé. Et une fenêtre qui commence avant un `changement` porte encore des
images de l'ancien jeu: elle ne met pas fin au démarrage, même si elle a une cadence.
"""

import json
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, tzinfo
from pathlib import Path
from statistics import median
from typing import Any

#: Combien d'écarts entre deux images la page garde pour ses `arrivées`: la
#: fenêtre de `video.ts` (`new Window(600)`). Un trou y reste jusqu'à ce que six
#: cents images de plus soient arrivées.
ECARTS_GARDES = 600


@dataclass(frozen=True)
class Chute:
    """Une salle qui va mal: cadence tombée, ou image gelée un instant.

    Les deux voyagent dans le même objet parce que la suite est la même, une
    capture. `cause` dit laquelle des deux règles a parlé, et c'est ce qu'on lit
    dans le journal en ouvrant le dossier de la capture.
    """

    salle: int | None
    #: La médiane des cadences mesurées, nulle quand aucune page n'en mesurait:
    #: une page figée ne dit plus de cadence (voir `_cadence`).
    mediane: float | None
    mesures: int
    pages: int
    jeu: str
    cause: str = "cadence"
    #: Le pire écart entre deux images reçues sur la fenêtre, en millisecondes.
    #: Nul quand la cause est la cadence, ou quand aucune page ne le mesure (les
    #: lignes d'avant le 14 septembre 2026 ne portent pas ce champ).
    gel_ms: float | None = None
    #: « salle » ou « page »: voir la portée d'un gel dans l'en-tête du module.
    portee: str = "salle"
    #: La visite qui a gelé seule, quand la portée est « page ».
    page: str | None = None


@dataclass(frozen=True)
class _Mesure:
    quand: datetime
    visite: str
    cadence: float | None
    jeu: str
    #: Le pire écart entre deux images reçues, ou l'attente de la suivante quand
    #: elle est plus longue, tel que la page le rapporte.
    gel_ms: float = 0.0
    #: Prise pendant le démarrage du jeu: voir l'en-tête du module.
    demarrage: bool = False
    #: Le rang de la mesure dans la vie du déclencheur, qui l'identifie.
    rang: int = 0
    #: Le rang de la mesure qui a commencé ce gel: le même pour toutes les
    #: fenêtres d'un même gel d'une page.
    suite: int = 0
    #: Ce que la page a écrit: images reçues, pire écart, attente; `None` absent.
    vues: float | None = None
    pire: float | None = None
    attente: float | None = None


@dataclass
class _Partie:
    """Le jeu d'une salle, et ce qui en est encore au démarrage."""

    jeu: str
    #: Vrai tant qu'aucune page de la salle n'a vu le jeu tourner.
    demarrage: bool
    #: L'instant du `changement` qui a ouvert le démarrage. Une fenêtre qui commence
    #: avant lui porte des images de l'ancien jeu et ne le ferme pas.
    depuis: datetime | None = None
    #: La fin de la fenêtre qui a fermé le démarrage de la salle.
    fin: datetime | None = None
    #: Les pages qui ont vu le jeu tourner depuis: leur démarrage est fini.
    en_jeu: set[str] = field(default_factory=set)


def _nombre(valeur: object) -> float | None:
    if isinstance(valeur, bool) or not isinstance(valeur, int | float):
        return None
    return float(valeur)


def _quand(ligne: dict[str, Any]) -> datetime | None:
    """L'heure d'une ligne du salon, ou rien si elle n'a pas de fuseau."""
    try:
        quand = datetime.fromisoformat(str(ligne.get("quand")))
    except ValueError:
        return None
    return quand if quand.tzinfo is not None else None


def _cadence(vu: dict[str, Any]) -> float | None:
    """La cadence de la source que la page a mesurée, ou None.

    Depuis le 21 novembre 2026, une page qui n'a pas assez d'écarts écrit zéro au
    lieu de la cadence de son écran: pendant le gel de Sonic, elle annonçait 250.
    Zéro veut donc dire « pas mesuré », et la mesure garde quand même son gel.
    """
    cadence = _nombre(vu.get("jeuHz"))
    return cadence if cadence is not None and cadence > 0 else None


def _mediane(mesures: list[_Mesure]) -> float | None:
    cadences = [m.cadence for m in mesures if m.cadence is not None]
    return round(median(cadences), 1) if cadences else None


class Declencheur:
    """Accumule les mesures des pages et dit quelles salles chutent."""

    def __init__(
        self,
        seuil: float = 50.0,
        fenetre: timedelta = timedelta(seconds=30),
        pause: timedelta = timedelta(minutes=5),
        minimum: int = 3,
        seuil_gel_ms: float = 500.0,
        plafonds: Mapping[str, float] | None = None,
        part_plafond: float = 0.9,
        pause_gel: timedelta = timedelta(minutes=1),
    ) -> None:
        self._seuil = seuil
        self._seuil_gel = seuil_gel_ms
        self._plafonds = dict(plafonds or {})
        self._part_plafond = part_plafond
        self._fenetre = fenetre
        self._pause = pause
        self._pause_gel = pause_gel
        self._minimum = minimum
        self._mesures: dict[int | None, deque[_Mesure]] = {}
        #: La dernière capture de chaque salle et portée: son heure et sa cause,
        #: qui choisit la durée de la pause.
        self._derniere: dict[tuple[int | None, str], tuple[datetime, str]] = {}
        self._parties: dict[int | None, _Partie] = {}
        #: La salle de chaque visite, d'après ses mesures: la ligne `changement`
        #: du salon ne porte pas le numéro de la salle. Une entrée par visite
        #: de la vie du service, quelques dizaines par soirée: rien à balayer.
        self._salle_de: dict[str, int | None] = {}
        self._rang = 0
        #: Les mesures de démarrage déjà rendues, pour ne les écrire qu'une fois.
        self._demarrages_dits: set[int] = set()
        #: La dernière mesure de chaque visite, que la suivante peut continuer.
        self._derniere_de: dict[str, _Mesure] = {}
        #: Les gels déjà couverts par une capture, par le rang qui les a commencés.
        self._gels_pris: set[int] = set()

    def lire(self, ligne: dict[str, Any]) -> None:
        """Retient une ligne du journal du salon si c'est une mesure utile."""
        if ligne.get("banc"):
            return
        if ligne.get("quoi") == "changement":
            self._changement(ligne)
            return
        if ligne.get("quoi") != "mesures":
            return
        vu, salle = ligne.get("vu"), ligne.get("salle")
        if not isinstance(vu, dict) or not isinstance(salle, dict) or not salle.get("jeu"):
            return
        cadence = _cadence(vu)
        quand = _quand(ligne)
        if quand is None:
            return
        numero = salle.get("numéro")
        if isinstance(numero, bool) or not isinstance(numero, int):
            numero = None
        visite = str(ligne.get("visite") or "")
        self._salle_de[visite] = numero
        demarrage = self._demarrage(numero, visite, str(salle["jeu"]), cadence, quand, vu)
        arrivees = vu.get("arrivées")
        pire = _nombre(arrivees[2]) if isinstance(arrivees, list) and len(arrivees) == 3 else None
        # L'attente de l'image suivante dit le gel PENDANT qu'il dure; les
        # arrivées ne le disent qu'une fois l'image revenue.
        attente = _nombre(vu.get("attente"))
        gel = max(pire or 0.0, attente or 0.0)
        if cadence is None and gel <= 0:
            return
        self._rang += 1
        mesure = _Mesure(
            quand,
            visite,
            cadence,
            str(salle["jeu"]),
            gel,
            demarrage,
            rang=self._rang,
            suite=self._rang,
            vues=_nombre(vu.get("vues")),
            pire=pire,
            attente=attente,
        )
        precedente = self._derniere_de.get(visite)
        if precedente is not None and self._meme_gel(precedente, mesure):
            mesure = replace(mesure, suite=precedente.suite)
        self._derniere_de[visite] = mesure
        self._mesures.setdefault(numero, deque()).append(mesure)

    def _meme_gel(self, avant: _Mesure, apres: _Mesure) -> bool:
        """Vrai si la fenêtre `apres` de la même page continue le gel de `avant`."""
        seuil = self._seuil_gel
        if (
            avant.gel_ms < seuil
            or apres.gel_ms < seuil
            or apres.quand - avant.quand > self._fenetre
        ):
            return False
        # Aucune image depuis: c'est la même attente qui continue.
        if apres.vues == 0:
            return True
        # L'attente qui courait a fini dans cette fenêtre, par un trou au moins aussi long.
        if (
            avant.attente is not None
            and avant.attente >= seuil
            and (apres.pire or 0) >= avant.attente
        ):
            return True
        # Le même trou, encore parmi les six cents derniers écarts de la page.
        return (
            avant.pire is not None
            and avant.pire >= seuil
            and apres.pire == avant.pire
            and (apres.vues is None or apres.vues < ECARTS_GARDES)
        )

    def _changement(self, ligne: dict[str, Any]) -> None:
        """Une page lance un jeu: sa salle repart en démarrage, même jeu compris."""
        quand = _quand(ligne)
        visite = str(ligne.get("visite") or "")
        jeu = ligne.get("jeu")
        if quand is None or visite not in self._salle_de or not isinstance(jeu, str) or not jeu:
            return
        self._parties[self._salle_de[visite]] = _Partie(jeu, demarrage=True, depuis=quand)

    def _demarrage(
        self,
        numero: int | None,
        visite: str,
        jeu: str,
        cadence: float | None,
        quand: datetime,
        vu: dict[str, Any],
    ) -> bool:
        """Vrai si cette fenêtre tombe dans le démarrage du jeu, pour cette page.

        La première fenêtre où une page voit le jeu tourner ferme son démarrage, et
        elle en fait encore partie: c'est elle qui porte le trou entre « pas
        d'image » et la première image. La première de toutes ferme celui de la
        salle; les autres pages ont encore `fenetre` pour fermer le leur. La page
        voit le jeu tourner quand elle mesure une cadence, ou quand elle attend une
        image EN PARTIE: elle n'écrit `attente` qu'une fois le démarrage fini de son
        côté (`vitals.ts`). Une page figée au milieu d'une partie, comme Sonic le
        21 novembre 2026, n'a plus de cadence mais attend: c'est un gel, pas un
        chargement.
        """
        en_jeu = cadence is not None or (_nombre(vu.get("attente")) or 0.0) > 0
        partie = self._parties.get(numero)
        if partie is None or partie.jeu != jeu:
            # Un jeu qu'on voit pour la première fois. Si la salle en avait un
            # autre, cette fenêtre porte encore ses images: elle ouvre le
            # démarrage sans le fermer. Sinon, la page dit si le jeu charge
            # encore ou si la boîte noire arrive en pleine partie.
            change = partie is not None
            partie = _Partie(jeu, demarrage=change or not en_jeu, depuis=quand if change else None)
            self._parties[numero] = partie
            return partie.demarrage
        ouvert = partie.demarrage or (
            partie.fin is not None and quand - partie.fin <= self._fenetre
        )
        if not ouvert or visite in partie.en_jeu:
            return False
        duree = _nombre(vu.get("s")) or 10.0
        commence = quand - timedelta(seconds=duree)
        if en_jeu and (partie.depuis is None or commence >= partie.depuis):
            partie.en_jeu.add(visite)
            if partie.demarrage:
                partie.demarrage, partie.fin = False, quand
        return True

    def evaluer(self, maintenant: datetime) -> list[Chute]:
        """Les salles qui chutent à cet instant, et qui n'ont pas déjà été signalées."""
        chutes: list[Chute] = []
        limite = maintenant - self._fenetre
        for numero, mesures in self._mesures.items():
            while mesures and mesures[0].quand < limite:
                mesures.popleft()
            if not mesures:
                continue
            jeu = mesures[-1].jeu
            demarrage = self._demarrage_a_dire(numero, mesures)
            if demarrage is not None:
                chutes.append(demarrage)
            du_jeu = [m for m in mesures if m.jeu == jeu and m.cadence is not None]
            cadence = median(m.cadence for m in du_jeu if m.cadence is not None) if du_jeu else None
            # Le trou d'un démarrage n'est pas un gel: il est rendu à part, ci-dessus.
            en_partie = [m for m in mesures if not m.demarrage]
            gels = [m for m in en_partie if m.gel_ms >= self._seuil_gel]
            # Un gel qu'une capture couvre déjà n'en demande pas une seconde,
            # même s'il dure ou se voit encore dans les fenêtres suivantes.
            pire = max((m.gel_ms for m in gels if m.suite not in self._gels_pris), default=0.0)
            # La cadence d'abord: quand les deux règles parlent, « le jeu tourne
            # à 40 images par seconde » explique mieux qu'un trou isolé.
            page: str | None = None
            jugees: list[_Mesure] = list(mesures)
            if (
                cadence is not None
                and len(du_jeu) >= self._minimum
                and cadence < self._seuil_de(jeu)
            ):
                cause, gel, portee = "cadence", None, "salle"
                jugees = du_jeu
            elif pire >= self._seuil_gel:
                cause, gel = "gel", pire
                jugees = en_partie
                gelees = {m.visite for m in gels}
                if len(gelees) == 1 and len({m.visite for m in mesures}) > 1:
                    portee, page = "page", next(iter(gelees))
                else:
                    portee = "salle"
            else:
                continue
            if self._se_tait(numero, portee, maintenant):
                continue
            self._derniere[(numero, portee)] = (maintenant, cause)
            self._gels_pris.update(m.suite for m in gels)
            chutes.append(
                Chute(
                    salle=numero,
                    mediane=_mediane(jugees),
                    mesures=len(jugees),
                    pages=len({mesure.visite for mesure in jugees}),
                    jeu=jeu,
                    cause=cause,
                    gel_ms=gel,
                    portee=portee,
                    page=page,
                )
            )
        # Oublier ce qui est sorti des fenêtres: le service tourne des semaines.
        # La dernière mesure d'une page reste, tant qu'une suivante peut la
        # continuer, et avec elle le gel qu'elle porte.
        for visite, derniere in list(self._derniere_de.items()):
            if derniere.quand < limite:
                del self._derniere_de[visite]
        vivantes = [m for mesures in self._mesures.values() for m in mesures]
        self._demarrages_dits &= {m.rang for m in vivantes}
        self._gels_pris &= {m.suite for m in [*vivantes, *self._derniere_de.values()]}
        return chutes

    def _demarrage_a_dire(self, numero: int | None, mesures: deque[_Mesure]) -> Chute | None:
        """Le trou de démarrage pas encore rendu, s'il dépasse le seuil d'un gel.

        Sans pause: un démarrage n'est pas une capture, et il ne fait taire rien.
        """
        nouvelles = [
            m
            for m in mesures
            if m.demarrage and m.gel_ms >= self._seuil_gel and m.rang not in self._demarrages_dits
        ]
        if not nouvelles:
            return None
        self._demarrages_dits.update(m.rang for m in nouvelles)
        return Chute(
            salle=numero,
            mediane=_mediane(nouvelles),
            mesures=len(nouvelles),
            pages=len({m.visite for m in nouvelles}),
            jeu=nouvelles[-1].jeu,
            cause="démarrage",
            gel_ms=max(m.gel_ms for m in nouvelles),
        )

    def _seuil_de(self, jeu: str) -> float:
        """Sous quelle médiane ce jeu chute: une part de son plafond s'il en a un."""
        plafond = self._plafonds.get(jeu)
        if plafond is None:
            return self._seuil
        # Arrondi: 0,9 fois 30 doit valoir 27 et pas 27,000000000000004, sinon une
        # médiane de 27 tout rond chuterait.
        return round(plafond * self._part_plafond, 6)

    def _se_tait(self, numero: int | None, portee: str, maintenant: datetime) -> bool:
        """Vrai si une chute de cette portée, ou une de salle, a parlé il y a peu.

        « Peu » dépend de la cause de la capture qui a parlé: une minute après un
        gel, cinq après une chute de cadence.
        """
        portees = ("salle",) if portee == "salle" else ("salle", "page")
        for p in portees:
            derniere = self._derniere.get((numero, p))
            if derniere is None:
                continue
            quand, cause = derniere
            if maintenant - quand < (self._pause_gel if cause == "gel" else self._pause):
                return True
        return False


class Suiveur:
    """Rend les lignes AJOUTÉES au journal du salon depuis la lecture précédente.

    Au premier appel, il part de la FIN du fichier du jour: une boîte noire qui
    redémarre ne doit pas rejouer toute la soirée et déclencher des captures sur
    des chutes finies depuis longtemps. Au changement de jour, il lit le nouveau
    fichier depuis le début.

    Un fichier REMPLACÉ se relit depuis le début lui aussi, et le remplacement se
    reconnaît à son inode, l'identité du fichier pour le système. La première
    version le reconnaissait à sa taille, plus courte qu'avant: son test a
    remplacé le fichier par un plus LONG, et la ligne nouvelle a été perdue. Une
    troncature sur place se reconnaît encore à la taille. Reste invisible un
    fichier tronqué puis réécrit plus long sous le même inode; le salon n'écrit
    qu'en ajout, donc ce cas n'arrive pas.
    """

    def __init__(self, dossier: Path, zone: tzinfo) -> None:
        self._dossier = dossier
        self._zone = zone
        self._fichier: Path | None = None
        self._inode: int | None = None
        self._position = 0
        self._reste = b""

    def nouvelles(self, maintenant: datetime) -> list[dict[str, Any]]:
        fichier = self._dossier / f"{maintenant.astimezone(self._zone).date().isoformat()}.jsonl"
        etat = _etat(fichier)
        if fichier != self._fichier:
            premier = self._fichier is None
            self._fichier = fichier
            self._reste = b""
            self._position = etat[1] if premier and etat else 0
            self._inode = etat[0] if etat else None
        if etat is None:
            return []
        inode, taille = etat
        if inode != self._inode or taille < self._position:
            self._inode, self._position, self._reste = inode, 0, b""
        if taille == self._position:
            return []
        try:
            with fichier.open("rb") as lu:
                lu.seek(self._position)
                morceau = lu.read(taille - self._position)
        except OSError:
            return []
        self._position = taille
        # Coupé en OCTETS: une ligne à moitié écrite peut s'arrêter au milieu d'un
        # caractère accentué, et la décoder trop tôt la corromprait.
        *completes, self._reste = (self._reste + morceau).split(b"\n")
        lignes: list[dict[str, Any]] = []
        for brute in completes:
            try:
                ligne = json.loads(brute.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                continue
            if isinstance(ligne, dict):
                lignes.append(ligne)
        return lignes


def _etat(fichier: Path) -> tuple[int, int] | None:
    """L'inode et la taille d'un fichier, ou rien s'il n'existe pas encore."""
    try:
        infos = fichier.stat()
    except OSError:
        return None
    return infos.st_ino, infos.st_size
