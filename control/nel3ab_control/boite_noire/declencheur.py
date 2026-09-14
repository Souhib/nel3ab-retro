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

Les pilotes d'essai (`banc`) et les pages sans jeu sont ignorés: le premier
remplirait la boîte de ses propres essais, le second mesure un menu.
"""

import json
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, tzinfo
from pathlib import Path
from statistics import median
from typing import Any


@dataclass(frozen=True)
class Chute:
    """Une salle dont la cadence est restée sous le seuil."""

    salle: int | None
    mediane: float
    mesures: int
    pages: int
    jeu: str


@dataclass(frozen=True)
class _Mesure:
    quand: datetime
    visite: str
    cadence: float
    jeu: str


class Declencheur:
    """Accumule les mesures des pages et dit quelles salles chutent."""

    def __init__(
        self,
        seuil: float = 50.0,
        fenetre: timedelta = timedelta(seconds=30),
        pause: timedelta = timedelta(minutes=5),
        minimum: int = 3,
    ) -> None:
        self._seuil = seuil
        self._fenetre = fenetre
        self._pause = pause
        self._minimum = minimum
        self._mesures: dict[int | None, deque[_Mesure]] = {}
        self._derniere: dict[int | None, datetime] = {}

    def lire(self, ligne: dict[str, Any]) -> None:
        """Retient une ligne du journal du salon si c'est une mesure utile."""
        if ligne.get("quoi") != "mesures" or ligne.get("banc"):
            return
        vu, salle = ligne.get("vu"), ligne.get("salle")
        if not isinstance(vu, dict) or not isinstance(salle, dict) or not salle.get("jeu"):
            return
        cadence = vu.get("jeuHz")
        if isinstance(cadence, bool) or not isinstance(cadence, int | float) or cadence <= 0:
            return
        try:
            quand = datetime.fromisoformat(str(ligne.get("quand")))
        except ValueError:
            return
        if quand.tzinfo is None:
            return
        numero = salle.get("numéro")
        if isinstance(numero, bool) or not isinstance(numero, int):
            numero = None
        self._mesures.setdefault(numero, deque()).append(
            _Mesure(quand, str(ligne.get("visite") or ""), float(cadence), str(salle["jeu"]))
        )

    def evaluer(self, maintenant: datetime) -> list[Chute]:
        """Les salles qui chutent à cet instant, et qui n'ont pas déjà été signalées."""
        chutes: list[Chute] = []
        limite = maintenant - self._fenetre
        for numero, mesures in self._mesures.items():
            while mesures and mesures[0].quand < limite:
                mesures.popleft()
            if len(mesures) < self._minimum:
                continue
            valeur = median(mesure.cadence for mesure in mesures)
            if valeur >= self._seuil:
                continue
            derniere = self._derniere.get(numero)
            if derniere is not None and maintenant - derniere < self._pause:
                continue
            self._derniere[numero] = maintenant
            chutes.append(
                Chute(
                    salle=numero,
                    mediane=round(valeur, 1),
                    mesures=len(mesures),
                    pages=len({mesure.visite for mesure in mesures}),
                    jeu=mesures[-1].jeu,
                )
            )
        return chutes


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
