"""Le journal des parties: ce que chaque personne a joué, où, et dans quelle sauvegarde.

# Pourquoi un deuxième journal

Le journal des séances (`journal.py`) s'efface après sept jours, nomme le jeu
par son titre affiché et n'écrit pas quand une place se termine. Il répond à
« que s'est-il passé hier soir », pas à « qu'ai-je joué cette année ». Un profil
a besoin du second: une ligne quand une place commence, une ligne quand elle
finit, et une ligne quand quelqu'un lance un jeu.

# La forme

Un fichier JSONL par personne, `<empreinte>.jsonl`, où l'empreinte est le
SHA-256 de son adresse (`personnes.empreinte`), celui qui termine déjà le nom
de ses dossiers de sauvegarde. Le nom ne contient aucune partie lisible. C'est
une pseudonymisation, pas un secret: quiconque connaît l'adresse recalcule
l'empreinte. Les fichiers naissent lisibles par leur seul propriétaire (0600).

Ajout seul, jamais balayé: rien dans ce module ne réécrit ni n'efface une ligne.
Une ligne porte `v` (la version du format), `quand` (l'heure des joueurs, avec
son décalage) et `quoi`:

- `place_debut`: une place tenue commence. `id` la désigne, `salle`, `place`,
  le `jeu` (clé, console, titre, ou rien sur le menu), qui l'a `lance` et dans
  quelle `sauvegarde`;
- `place_fin`: la place `id` se termine, au bout de `secondes` mesurées sur
  l'horloge monotone, pour une `raison`;
- `lancement`: cette personne a lancé un `jeu` dans une `salle`, avec tel
  `emplacement` et donc telle `sauvegarde`.

Un début sans fin n'est jamais prolongé: le salon qui redémarre perd ses places
ouvertes, et le lecteur les montre « durée inconnue ».

# Une trace ne doit jamais empêcher de jouer

Comme le journal des séances: un disque plein ou un dossier en lecture seule
n'interrompt rien. L'écriture avale ses erreurs et les compte (`dropped`), et la
première se plaint une fois sur la sortie d'erreur.
"""

import json
import logging
import os
import stat
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from nel3ab_control.journal import LOCAL_ZONE, _zone
from nel3ab_control.personnes import dossier_personnel, empreinte

_log = logging.getLogger(__name__)

#: La version du format des lignes. Le lecteur ignore une ligne d'une autre version.
VERSION = 1

#: Ce que le lecteur accepte de lire d'un seul fichier. Une ligne pèse environ
#: 300 octets, et une soirée en écrit une dizaine par personne: seize Mio
#: tiennent plus de cinquante mille lignes, des années de soirées. Au-delà, le
#: lecteur lit la FIN du fichier et le dit dans le journal du service.
TAILLE_LUE = 16 * 1024 * 1024


class Fin(StrEnum):
    """Pourquoi une place s'est terminée."""

    #: La personne a rendu sa manette, ou en a pris une autre.
    QUITTEE = "quittee"
    #: Le jeu a changé sous la place, ou a été fermé.
    JEU_CHANGE = "jeu_change"
    #: La salle a été fermée.
    SALLE_FERMEE = "salle_fermee"
    #: Quelqu'un d'autre a eu cette prise: une demande acceptée, ou le worker
    #: qui l'a donnée à une autre page.
    REMPLACEE = "remplacee"
    #: La page est partie.
    DECONNECTEE = "deconnectee"


class Sauvegarde(StrEnum):
    """Dans quelle sauvegarde une partie s'écrit, d'après qui l'a lancée."""

    #: La sauvegarde personnelle de la personne qui a lancé (« partie neuve » et
    #: « reprendre » d'un compte identifié, ADR du 10 novembre 2026).
    LANCEUR = "lanceur"
    #: « Tout débloqué », commune à tout le monde.
    COMMUNE = "commune"
    #: La partie neuve partagée, quand le lancement n'avait pas d'identité.
    NEUVE = "neuve"
    #: Le salon ne sait pas: le jeu tournait avant lui, ou il a été lancé par
    #: un chemin qui ne nomme personne.
    INCONNUE = "inconnue"


#: Les emplacements tels que la préparation les code, et leur nom dans la ligne.
#: Les mêmes trois que `handlers.SAVES`, dans le même ordre.
EMPLACEMENTS = ("partie neuve", "tout débloqué", "reprendre")


def sauvegarde_de(emplacement: int | None, login: str | None) -> Sauvegarde:
    """La sauvegarde qu'un lancement choisit, comme le worker la compose.

    Le code 1 est l'import commun. Les codes 0 et 2 d'un compte identifié vont
    dans son dossier personnel; sans compte, ou avec une adresse sans rien de
    lisible, le worker retombe sur la partie neuve partagée (`saves::folder_for`).
    """
    if emplacement is None:
        return Sauvegarde.INCONNUE
    if emplacement == 1:
        return Sauvegarde.COMMUNE
    if login and dossier_personnel(login) is not None:
        return Sauvegarde.LANCEUR
    return Sauvegarde.NEUVE


@dataclass(frozen=True)
class JeuJoue:
    """Un jeu, tel qu'une ligne le nomme.

    `cle` est le nom de fichier publié par le worker (ADR D23), ou rien pour un
    worker qui ne le publie pas encore. Le titre seul désigne alors le jeu.
    """

    cle: str | None
    console: str
    titre: str
    #: L'identifiant du titre, pour un jeu inscrit (Switch). Lu dans le
    #: catalogue pour relier une sauvegarde; jamais écrit dans le journal.
    titre_id: str | None = None

    def identite(self) -> str:
        """Ce qui regroupe les parties d'un même jeu: sa clé, sinon son titre.

        Le seul endroit qui en décide. Préfixé pour qu'un titre ne puisse pas
        se faire passer pour la clé d'un autre jeu.
        """
        return f"cle:{self.cle}" if self.cle else f"titre:{self.titre}"

    def ligne(self) -> dict[str, str | None]:
        return {"cle": self.cle, "console": self.console, "titre": self.titre}

    @staticmethod
    def lu(brut: object) -> "JeuJoue | None":
        """Le jeu d'une ligne, ou rien quand la ligne n'en décrit pas un."""
        if not isinstance(brut, dict):
            return None
        cle, console, titre = brut.get("cle"), brut.get("console"), brut.get("titre")
        if not isinstance(titre, str) or not isinstance(console, str):
            return None
        return JeuJoue(
            cle=cle if isinstance(cle, str) and cle else None, console=console, titre=titre
        )


class Parties:
    """Les fichiers du journal des parties, un par personne."""

    def __init__(self, dossier: Path, zone: str = LOCAL_ZONE) -> None:
        self._dossier = dossier
        self._zone = _zone(zone)
        self._dropped = 0
        self._complained = False
        #: Empreinte -> les salles où cette personne s'est déjà assise. Lu une
        #: fois par personne et par vie du salon, puis tenu à jour à l'écriture.
        self._salles: dict[str, set[int]] = {}

    @property
    def dossier(self) -> Path:
        return self._dossier

    @property
    def dropped(self) -> int:
        """Combien de lignes n'ont pas pu être écrites. Zéro attendu."""
        return self._dropped

    def chemin(self, login: str) -> Path:
        """Le fichier de cette personne. Le nom ne dit rien de l'adresse."""
        return self._dossier / f"{empreinte(login)}.jsonl"

    def ecrire(self, login: str, quoi: str, quand: datetime | None = None, **rest: Any) -> bool:
        """Ajoute une ligne au fichier de cette personne. Rend vrai si elle est écrite.

        Un appel système `write` par ligne, sur un fichier ouvert en ajout: une
        ligne ne peut pas se glisser au milieu d'une autre. Ouvert et refermé à
        chaque fois, parce qu'il y a un fichier par personne et que les lignes
        sont rares (une place, un lancement).

        Sur la boucle, comme le journal des séances. Mesuré le 21 novembre 2026
        sur lgf, disque ext4 du dossier personnel, 5 000 lignes de début de
        place: 38 à 40 µs par ligne, 360 octets par ligne. Un changement de jeu
        à quatre en écrit huit, soit un tiers de milliseconde.
        """
        moment = (quand or datetime.now(tz=self._zone)).astimezone(self._zone)
        ligne = {"v": VERSION, "quand": moment.isoformat(timespec="milliseconds"), "quoi": quoi}
        ligne.update(rest)
        octets = (json.dumps(ligne, ensure_ascii=False, default=str) + "\n").encode("utf-8")
        try:
            self._dossier.mkdir(mode=0o700, parents=True, exist_ok=True)
            descripteur = _ouvrir_regulier(
                str(self.chemin(login)), os.O_RDWR | os.O_APPEND | os.O_CREAT, 0o600
            )
            try:
                # Une ligne coupée par un arrêt brutal ne doit pas emporter la
                # suivante: sans ce saut, la ligne écrite après le redémarrage
                # se collerait à la moitié restée là, et les deux seraient
                # illisibles.
                taille = os.fstat(descripteur).st_size
                if taille and os.pread(descripteur, 1, taille - 1) != b"\n":
                    octets = b"\n" + octets
                os.write(descripteur, octets)
            finally:
                os.close(descripteur)
        except OSError as error:
            self._dropped += 1
            if not self._complained:
                self._complained = True
                _log.error(
                    "journal des parties: écriture impossible (%s); la salle continue", error
                )
            return False
        return True

    def lire(self, login: str) -> list[dict[str, Any]]:
        """Les lignes de cette personne, dans l'ordre du fichier.

        Une ligne illisible est sautée: c'est la dernière d'un salon coupé au
        milieu d'une écriture, ou une ligne d'un format futur. Un fichier absent
        est une personne qui n'a encore rien joué.
        """
        return lire_fichier(self.chemin(login))

    def deja_assis(self, login: str, salle: int) -> bool | None:
        """Cette personne a-t-elle déjà tenu une place dans cette salle ?

        `None` quand le fichier ne se lit pas: la page retombe alors sur sa
        propre mémoire plutôt que d'annoncer une première fois inventée.

        Le fichier est lu une fois par personne et par vie du salon, sur la
        boucle, à sa première place. Mesuré le 21 novembre 2026 sur lgf: 33 à
        36 ms pour 5 000 lignes (1,7 Mio), soit des centaines de soirées. Le
        journal ne contient aujourd'hui que quelques lignes par personne.
        """
        cle = empreinte(login)
        if cle not in self._salles:
            chemin = self.chemin(login)
            try:
                os.lstat(chemin)
            except FileNotFoundError:
                self._salles[cle] = set()
            except OSError:
                return None
            else:
                try:
                    lignes = _lire_lignes(chemin)
                except OSError:
                    return None
                self._salles[cle] = {
                    salle_lue
                    for ligne in lignes
                    if ligne.get("quoi") == "place_debut"
                    and type(salle_lue := ligne.get("salle")) is int
                }
        return salle in self._salles[cle]

    def assis(self, login: str, salle: int) -> None:
        """Retient qu'une place a commencé dans cette salle, pour `deja_assis`."""
        self._salles.setdefault(empreinte(login), set()).add(salle)


def lire_fichier(chemin: Path) -> list[dict[str, Any]]:
    """Les lignes valides d'un fichier du journal, ou rien s'il ne se lit pas."""
    try:
        return _lire_lignes(chemin)
    except OSError:
        return []


def _lire_lignes(chemin: Path) -> list[dict[str, Any]]:
    """Lit un fichier régulier seulement: un tube bloquerait la lecture pour toujours."""
    with open(chemin, "rb", opener=_ouvrir_regulier) as fichier:
        taille = os.fstat(fichier.fileno()).st_size
        coupe = taille > TAILLE_LUE
        if coupe:
            fichier.seek(taille - TAILLE_LUE)
            _log.warning(
                "journal des parties: %s dépasse %d octets, fin seule lue", chemin, TAILLE_LUE
            )
        brut = fichier.read(TAILLE_LUE)
    lignes = brut.split(b"\n")
    if coupe:
        # La première ligne lue commence au milieu d'une autre.
        lignes = lignes[1:]
    gardees: list[dict[str, Any]] = []
    for ligne in lignes:
        if not ligne.strip():
            continue
        try:
            lue = json.loads(ligne)
        except ValueError:
            continue
        if (
            isinstance(lue, dict)
            and lue.get("v") == VERSION
            and isinstance(lue.get("quoi"), str)
            and isinstance(lue.get("quand"), str)
        ):
            gardees.append(lue)
    return gardees


def _ouvrir_regulier(chemin: str, drapeaux: int, mode: int = 0o600) -> int:
    """Ouvre sans suivre de lien et sans attendre, puis refuse ce qui n'est pas un fichier.

    Sans attendre: ouvrir un tube nommé bloque jusqu'à ce qu'un autre côté
    l'ouvre, c'est-à-dire pour toujours. Des tubes existent dans les dossiers
    de sauvegarde Switch (relevé du 20 novembre 2026).
    """
    descripteur = os.open(chemin, drapeaux | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, mode)
    try:
        if not stat.S_ISREG(os.fstat(descripteur).st_mode):
            raise OSError(f"{chemin} n'est pas un fichier ordinaire")
    except BaseException:
        os.close(descripteur)
        raise
    return descripteur
