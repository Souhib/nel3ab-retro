"""Combien de temps un jeu met d'habitude à démarrer (D05, ADR D43).

« D'habitude, il démarre en 25 s », et « c'est plus long que d'habitude »
au-delà du 90e centile. La page comptait avec des constantes
(`front/src/lib/booting.ts`): vingt secondes avant de dire que c'est long,
quel que soit le jeu, alors qu'un jeu Switch qui recompile son cache de
nuanceurs en met parfois soixante.

# Ce qui est mesuré

De l'instant où le worker ACCEPTE un lancement (`RoomController.lance`, après
son « ok ») à l'instant où il OFFRE sa première image (`image_ms` de `/roms`).
C'est l'attente qu'un joueur vit: la sortie du worker, les deux secondes de
`RestartSec`, le démarrage de l'émulateur et sa première image. Les deux heures
sont MURALES et prises sur la même machine: le salon ne peut pas comparer son
horloge monotone à celle d'un autre processus.

Le salon le voit en relisant `/roms` (une fois par seconde tant que quelqu'un
est dans la salle, `follow_seats`), mais la durée ne dépend pas de cette
cadence: elle vient de deux heures écrites, pas du moment où on les lit.

# Ce qui n'est PAS une mesure

- Un lancement dont le nouveau worker revient sur un autre jeu ou sur son menu:
  une ligne « abandon », jamais comptée dans l'habitude.
- Un lancement sans image au bout de `ABANDON_S`: « abandon » aussi.
- Une durée négative ou plus longue que `ABANDON_S`: l'horloge murale a sauté,
  rien n'est écrit.

Tant qu'un jeu a moins de `MINIMUM` démarrages réussis, rien n'est publié, et
la page garde ses constantes sans dire « d'habitude » (règle « A fallback must
not travel as a measurement »).

# Le fichier

Une ligne JSON par démarrage, sans personne dedans: ni adresse, ni pseudo, ni
repère. Un fichier pour la machine, toutes salles confondues: un jeu démarre à
la même vitesse dans la salle 1 et dans la salle 3.
"""

import json
import logging
import math
import os
import statistics
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, Field

LOG = logging.getLogger(__name__)

#: La forme d'une ligne. Une autre version est ignorée à la lecture.
VERSION = 1

#: Combien de démarrages réussis par jeu entrent dans l'habitude: les plus
#: récents. Un jeu dont le cache vient d'être reconstruit retrouve vite sa
#: vitesse au lieu de traîner ses premiers démarrages pour toujours.
GARDES = 20

#: Pas d'habitude avant cinq démarrages réussis. Avec moins, le 90e centile est
#: le plus long des quatre, ce qui n'est pas une habitude.
MINIMUM = 5

#: Au-delà de dix minutes sans image, le lancement est abandonné. Le plus long
#: démarrage vu, une Switch qui recompile ses nuanceurs, se compte en dizaines de
#: secondes; dix minutes ne coupent aucun démarrage réel.
ABANDON_S = 600.0

#: Ce que le salon accepte de lire du fichier: une ligne pèse une centaine
#: d'octets, quatre Mio en tiennent des dizaines de milliers.
TAILLE_MAX = 4 * 1024 * 1024


class Demarrage(BaseModel):
    """L'habitude d'un jeu, sur ses derniers démarrages réussis."""

    mediane_s: float = Field(ge=0, description="La durée médiane, en secondes.")
    p90_s: float = Field(
        ge=0,
        description=(
            "Le 90e centile (rang le plus proche), en secondes: au-delà, « c'est "
            "plus long que d'habitude »."
        ),
    )
    n: int = Field(ge=MINIMUM, le=GARDES, description="Sur combien de démarrages.")


@dataclass(frozen=True)
class Attente:
    """Un lancement accepté dont la première image n'est pas encore vue."""

    cle: str
    console: str
    #: L'heure murale de l'acceptation, en millisecondes.
    quand_ms: int


class Demarrages:
    """Les démarrages de toutes les salles: ceux qu'on attend, et l'habitude de chaque jeu."""

    def __init__(self, fichier: Path, horloge_murale: Callable[[], float] = time.time) -> None:
        self._fichier = fichier
        self._horloge = horloge_murale
        #: Salle -> le lancement qu'elle attend. Un seul par salle: un second
        #: lancement abandonne le premier.
        self._attentes: dict[int, Attente] = {}
        #: Clé -> ses dernières durées réussies. Lu au premier besoin.
        self._durees: dict[str, deque[float]] | None = None

    def lance(self, salle: int, cle: str | None, console: str) -> None:
        """Le worker de cette salle vient d'accepter ce lancement.

        Sans clé (un worker d'avant le 21 novembre 2026), rien n'est attendu:
        on ne saurait pas reconnaître le jeu dans `/roms`.
        """
        precedente = self._attentes.pop(salle, None)
        if precedente is not None:
            self._ecrire(precedente, None, "abandon")
        if cle:
            self._attentes[salle] = Attente(cle=cle, console=console, quand_ms=self._ms())

    def vu(
        self, salle: int, cle_courante: str | None, depuis_ms: int | None, image_ms: int | None
    ) -> None:
        """Ce que `/roms` dit maintenant de cette salle.

        Tant que l'ANCIEN worker répond (il a démarré avant le lancement), rien:
        relancer le jeu qui tourne déjà le montrerait avec l'image d'avant.
        """
        attente = self._attentes.get(salle)
        if attente is None:
            return
        if self._ms() - attente.quand_ms > ABANDON_S * 1000:
            self._ecrire(self._attentes.pop(salle), None, "abandon")
            return
        if depuis_ms is None or depuis_ms < attente.quand_ms:
            return
        if cle_courante != attente.cle:
            # Le nouveau worker tourne sur un autre jeu, ou sur son menu: ce
            # lancement n'a pas abouti.
            self._ecrire(self._attentes.pop(salle), None, "abandon")
            return
        if image_ms is None:
            return
        del self._attentes[salle]
        secondes = (image_ms - attente.quand_ms) / 1000
        if not 0 < secondes <= ABANDON_S:
            LOG.warning("démarrage de %s mesuré à %.1f s: écarté", attente.cle, secondes)
            return
        self._ecrire(attente, secondes, "image")

    def habituel(self, cle: str | None) -> Demarrage | None:
        """L'habitude de ce jeu, ou rien avant `MINIMUM` démarrages réussis."""
        if not cle:
            return None
        durees = self._lues().get(cle)
        if durees is None or len(durees) < MINIMUM:
            return None
        triees = sorted(durees)
        rang = math.ceil(0.9 * len(triees)) - 1
        return Demarrage(
            mediane_s=round(statistics.median(triees), 1),
            p90_s=round(triees[rang], 1),
            n=len(triees),
        )

    def _ms(self) -> int:
        return int(self._horloge() * 1000)

    def _lues(self) -> dict[str, deque[float]]:
        if self._durees is None:
            self._durees = _lire(self._fichier)
        return self._durees

    def _ecrire(self, attente: Attente, secondes: float | None, issue: str) -> None:
        ligne = {
            "v": VERSION,
            "quand": datetime.fromtimestamp(attente.quand_ms / 1000, tz=UTC).isoformat(
                timespec="milliseconds"
            ),
            "cle": attente.cle,
            "console": attente.console,
            "secondes": round(secondes, 1) if secondes is not None else None,
            "issue": issue,
        }
        if secondes is not None:
            self._lues().setdefault(attente.cle, deque(maxlen=GARDES)).append(round(secondes, 1))
        octets = (json.dumps(ligne, ensure_ascii=False) + "\n").encode()
        try:
            self._fichier.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            descripteur = os.open(
                self._fichier,
                os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
            )
            try:
                # Une ligne coupée (disque plein, salon arrêté en pleine
                # écriture) n'a pas de fin de ligne: celle-ci s'y collerait, et
                # les deux seraient illisibles. Même garde que le journal des
                # parties (`parties.py`).
                taille = os.fstat(descripteur).st_size
                if taille and os.pread(descripteur, 1, taille - 1) != b"\n":
                    octets = b"\n" + octets
                # `write(2)` peut écrire moins qu'on lui donne: on reprend
                # jusqu'au bout, et un disque plein lève à l'appel suivant.
                reste = memoryview(octets)
                while reste:
                    reste = reste[os.write(descripteur, reste) :]
            finally:
                os.close(descripteur)
        except OSError:
            # Un disque plein ne doit pas casser un lancement: la mesure est
            # perdue, la partie non.
            LOG.warning("le démarrage de %s n'a pas pu être écrit", attente.cle)


def _lire(fichier: Path) -> dict[str, deque[float]]:
    """Les durées réussies du fichier, les `GARDES` dernières par jeu."""
    durees: dict[str, deque[float]] = {}
    try:
        with fichier.open("rb") as flux:
            # Les lignes les plus RÉCENTES sont à la fin: au-delà de la borne,
            # on lit la fin, et pas le début. La ligne que la coupe entame n'est
            # pas un objet JSON entier: la lecture ligne à ligne l'écarte.
            flux.seek(max(0, os.fstat(flux.fileno()).st_size - TAILLE_MAX))
            brut = flux.read(TAILLE_MAX)
    except OSError:
        return durees
    for texte in brut.decode("utf-8", errors="replace").splitlines():
        try:
            ligne = json.loads(texte)
        except ValueError:
            continue
        if (
            isinstance(ligne, dict)
            and ligne.get("v") == VERSION
            and ligne.get("issue") == "image"
            and isinstance(ligne.get("cle"), str)
            and isinstance(ligne.get("secondes"), int | float)
            and 0 < ligne["secondes"] <= ABANDON_S
        ):
            durees.setdefault(ligne["cle"], deque(maxlen=GARDES)).append(float(ligne["secondes"]))
    return durees
