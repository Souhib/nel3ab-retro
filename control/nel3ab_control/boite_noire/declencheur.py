"""Quand la cadence chute, le dire, une fois.

Les pages envoient déjà leur cadence au salon toutes les dix secondes, et le salon
l'écrit dans son journal. La boîte noire relit ces lignes au lieu de demander au
salon de la prévenir: le salon ne change pas, et une boîte noire en panne ne peut
pas gêner la salle.

# La règle

Une salle chute quand la médiane de la cadence de ses pages, sur les trente
dernières secondes, reste sous le seuil, et qu'au moins trois mesures le disent.
Une mesure seule ne suffit pas: une page qui recharge ou un onglet mis en arrière
plan en envoient une mauvaise. Après une chute, la même salle se tait cinq
minutes, sinon une soirée lente remplirait le disque de profils identiques.

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
continue d'en recevoir. La pause de cinq minutes borne le reste.

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
"""

import json
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, tzinfo
from pathlib import Path
from statistics import median
from typing import Any


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


def _nombre(valeur: object) -> float | None:
    if isinstance(valeur, bool) or not isinstance(valeur, int | float):
        return None
    return float(valeur)


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
    ) -> None:
        self._seuil = seuil
        self._seuil_gel = seuil_gel_ms
        self._plafonds = dict(plafonds or {})
        self._part_plafond = part_plafond
        self._fenetre = fenetre
        self._pause = pause
        self._minimum = minimum
        self._mesures: dict[int | None, deque[_Mesure]] = {}
        self._derniere: dict[tuple[int | None, str], datetime] = {}

    def lire(self, ligne: dict[str, Any]) -> None:
        """Retient une ligne du journal du salon si c'est une mesure utile."""
        if ligne.get("quoi") != "mesures" or ligne.get("banc"):
            return
        vu, salle = ligne.get("vu"), ligne.get("salle")
        if not isinstance(vu, dict) or not isinstance(salle, dict) or not salle.get("jeu"):
            return
        cadence = _cadence(vu)
        try:
            quand = datetime.fromisoformat(str(ligne.get("quand")))
        except ValueError:
            return
        if quand.tzinfo is None:
            return
        numero = salle.get("numéro")
        if isinstance(numero, bool) or not isinstance(numero, int):
            numero = None
        arrivees = vu.get("arrivées")
        pire = _nombre(arrivees[2]) if isinstance(arrivees, list) and len(arrivees) == 3 else None
        # L'attente de l'image suivante dit le gel PENDANT qu'il dure; les
        # arrivées ne le disent qu'une fois l'image revenue.
        gel = max(pire or 0.0, _nombre(vu.get("attente")) or 0.0)
        if cadence is None and gel <= 0:
            return
        self._mesures.setdefault(numero, deque()).append(
            _Mesure(quand, str(ligne.get("visite") or ""), cadence, str(salle["jeu"]), gel)
        )

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
            du_jeu = [m for m in mesures if m.jeu == jeu and m.cadence is not None]
            cadence = median(m.cadence for m in du_jeu if m.cadence is not None) if du_jeu else None
            pire = max(mesure.gel_ms for mesure in mesures)
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
                gelees = {m.visite for m in mesures if m.gel_ms >= self._seuil_gel}
                if len(gelees) == 1 and len({m.visite for m in mesures}) > 1:
                    portee, page = "page", next(iter(gelees))
                else:
                    portee = "salle"
            else:
                continue
            if self._se_tait(numero, portee, maintenant):
                continue
            self._derniere[(numero, portee)] = maintenant
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
        return chutes

    def _seuil_de(self, jeu: str) -> float:
        """Sous quelle médiane ce jeu chute: une part de son plafond s'il en a un."""
        plafond = self._plafonds.get(jeu)
        if plafond is None:
            return self._seuil
        # Arrondi: 0,9 fois 30 doit valoir 27 et pas 27,000000000000004, sinon une
        # médiane de 27 tout rond chuterait.
        return round(plafond * self._part_plafond, 6)

    def _se_tait(self, numero: int | None, portee: str, maintenant: datetime) -> bool:
        """Vrai si une chute de cette portée, ou une de salle, a parlé il y a peu."""
        portees = ("salle",) if portee == "salle" else ("salle", "page")
        return any(
            maintenant - quand < self._pause
            for quand in (self._derniere.get((numero, p)) for p in portees)
            if quand is not None
        )


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
