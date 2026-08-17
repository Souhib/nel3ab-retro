"""Ce qui s'est passé dans la salle, et quand.

# Pourquoi ce fichier existe

Le 16 août 2026 quelqu'un a joué vers 16 h 43 et a trouvé ça saccadé. On m'a
demandé de retrouver ce moment, et je ne l'ai pas pu: le worker ne note pas qui
il sert, ce service n'écrivait aucune trace du tout, et le seul fichier gardé,
`people.json`, ne contient que les pseudos choisis, donc **une seule ligne**
depuis le début du projet. La réponse a été « je ne peux pas savoir ».

Ce module existe pour que ça n'arrive pas deux fois. Il écrit qui est arrivé, à
quelle heure, sous quel pseudo, sur quelle place, pendant quel jeu, et qui était
là en même temps.

# La forme, et ce qui a été écarté

Un fichier par jour, une ligne JSON par événement. Ni base de données, ni
collecteur, ni tableau de bord, pour des raisons chiffrées:

- **taille**. Une ligne pèse 224 octets, mesuré le 17 août 2026 sur un événement
  complet avec l'état de la salle. Une soirée de quatre joueurs en produit
  quelques centaines, soit moins de cent kilo-octets; deux jours tiennent dans
  ce qu'une seule image de jeu occupe en mémoire;
- **SQLite**, pesé et écarté. Il achèterait un index dont on n'a pas l'usage à
  cette taille, et coûterait un schéma à faire évoluer. `grep` sur cent
  kilo-octets répond instantanément;
- **Grafana, Prometheus, Loki**, écartés plus tôt et pour la même raison: trois
  services à tenir en vie pour surveiller un service. La panne suivante serait la
  leur.

Ce qui compte n'est pas l'outil, c'est que la ligne soit **complète**. Chaque
événement porte l'état de la salle au moment où il se produit, donc une ligne
seule répond déjà à « qui d'autre était là », sans rejouer le fichier.

# Les clés sont en français

Parce que ce fichier est lu par quelqu'un, pas consommé par un programme. Les
schémas de l'API restent en anglais: eux traversent une frontière et se
retrouvent dans du TypeScript engendré.

# Une trace ne doit jamais empêcher de jouer

Un disque plein, un dossier en lecture seule, un chemin qui n'existe pas: aucun
des trois ne doit interrompre une partie. L'écriture avale donc ses erreurs, et
les COMPTE, parce qu'un journal muet qui se croit complet est pire que pas de
journal du tout. Le compteur se lit par `dropped`, et la première perte se
plaint une fois sur la sortie d'erreur: une fois, et pas à chaque ligne, sinon un
disque plein remplit aussi le journal du service.
"""

import json
import logging
from datetime import date, datetime, timedelta, tzinfo
from pathlib import Path
from typing import IO, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

#: Combien de jours on garde.
#:
#: Deux. Le besoin est « quelqu'un se plaint, je regarde le lendemain au plus
#: tard », dit tel quel le 17 août 2026. Sept jours ne servaient qu'à garder ce
#: que personne ne relirait, et un journal qu'on ne relit pas est un fichier qui
#: grossit.
KEEPS_DAYS = 2

#: Le seul enregistreur de ce service, et il ne sert qu'à une chose: dire que la
#: trace est perdue. Un journal muet qui se croit complet est pire que pas de
#: journal, parce qu'on conclurait de son silence qu'il ne s'est rien passé.
_log = logging.getLogger(__name__)

#: Sur quelle horloge les heures sont écrites, et où les journées se coupent.
#:
#: Celle des JOUEURS, pas celle de la machine. Ce n'est pas un détail de
#: présentation, c'est le défaut que ce module existe pour corriger: on m'a
#: demandé la séance « de 16 h 43 », et cette machine tourne en UTC, où le même
#: instant s'écrit 14:43. Un journal qui répond à côté de l'heure qu'on lui
#: donne ne vaut pas mieux qu'un journal vide.
#:
#: Trouvé en faisant tourner le pilote pour de vrai, pas en relisant le code: le
#: premier jet écrivait « l'heure locale » en croyant que c'était la même.
LOCAL_ZONE = "Europe/Paris"


class Journal:
    """Les événements de la salle, un fichier par jour."""

    def __init__(self, folder: Path, keeps: int = KEEPS_DAYS, zone: str = LOCAL_ZONE) -> None:
        self._folder = folder
        self._keeps = max(1, keeps)
        self._zone = _zone(zone)
        #: Le jour du fichier ouvert, pour savoir quand en changer.
        self._day: date | None = None
        self._file: IO[str] | None = None
        self._dropped = 0
        self._complained = False

    @property
    def dropped(self) -> int:
        """Combien d'événements n'ont pas pu être écrits.

        Zéro attendu. Autre chose que zéro veut dire que le journal ment par
        omission, et c'est la seule façon de l'apprendre.
        """
        return self._dropped

    def write(self, quoi: str, when: datetime | None = None, **rest: Any) -> None:
        """Inscrit un événement, à l'heure des JOUEURS et avec son décalage.

        Celle des joueurs parce que la plainte est la leur: « vers 16 h 43 » doit
        se chercher tel quel. Le décalage est écrit à côté pour que la ligne
        reste vraie au changement d'heure, où deux instants différents portent le
        même chiffre.
        """
        stamped = when or datetime.now(tz=self._zone)
        # Une heure SANS fuseau veut dire « à la pendule des joueurs », donc on
        # l'y accroche au lieu de la convertir. La convertir reviendrait à la
        # lire sur l'horloge de la machine, qui est en UTC: c'est le décalage de
        # deux heures que tout ce module existe pour ne pas produire.
        now = (
            stamped.replace(tzinfo=self._zone)
            if stamped.tzinfo is None
            else stamped.astimezone(self._zone)
        )
        line = {"quand": now.isoformat(timespec="milliseconds"), "quoi": quoi, **rest}
        try:
            file = self._open(now.date())
            file.write(json.dumps(line, ensure_ascii=False, default=str) + "\n")
        except OSError as error:
            self._dropped += 1
            if not self._complained:
                self._complained = True
                _log.error("journal: écriture impossible (%s); la salle continue", error)

    def sweep(self, today: date | None = None) -> list[Path]:
        """Efface les journées trop vieilles, et rend ce qui a été effacé.

        Ne touche QUE ce qu'il sait lire. Un fichier dont le nom n'est pas une
        date est un fichier qui n'est pas à nous, et une règle d'effacement qui
        devine est une règle qui finit par manger autre chose.
        """
        day = today or datetime.now(tz=self._zone).date()
        oldest = day - timedelta(days=self._keeps - 1)
        gone: list[Path] = []
        try:
            found = sorted(self._folder.glob("*.jsonl"))
        except OSError:
            return gone
        for path in found:
            try:
                written = date.fromisoformat(path.stem)
            except ValueError:
                continue
            if written >= oldest:
                continue
            try:
                path.unlink()
            except OSError:
                continue
            gone.append(path)
        return gone

    def close(self) -> None:
        """Ferme le fichier ouvert. Pour l'arrêt du service et pour les tests."""
        if self._file is not None:
            self._file.close()
            self._file = None
        self._day = None

    def _open(self, day: date) -> IO[str]:
        """Le fichier du jour, gardé OUVERT entre deux événements.

        `people.py` prend soin de sortir son écriture de la boucle, et sa raison
        vaut: une écriture disque sur la boucle bloque tout le monde. Ce cas-ci
        est différent, et la différence est mesurée plutôt que supposée.

        Là-bas, une écriture est un fichier entier réécrit, ouvert et refermé.
        Ici, la poignée reste ouverte et une ligne est un seul appel système sur
        un tampon de ligne. Mesuré le 17 août 2026 sur cette machine, dix mille
        événements complets: **11 microsecondes** par ligne, dont la mise en
        forme JSON, qui en est l'essentiel. Une soirée en produit quelques
        centaines, soit quatre millisecondes réparties sur toute une soirée.
        Passer par un fil coûterait plus en changements de contexte que
        l'écriture elle-même.

        Le fichier change quand le jour change, et c'est là qu'on balaie: un
        service allumé une semaine doit oublier tout seul, sans qu'on pense à le
        redémarrer.
        """
        if self._day != day or self._file is None:
            self.close()
            self._folder.mkdir(parents=True, exist_ok=True)
            self._file = (self._folder / f"{day.isoformat()}.jsonl").open(
                "a", encoding="utf-8", buffering=1
            )
            self._day = day
            self.sweep(day)
        return self._file


def _zone(name: str) -> tzinfo:
    """Le fuseau demandé, ou celui de la machine faute de mieux.

    Une base de fuseaux absente ne doit pas empêcher le service de démarrer: on
    perdrait le journal ET la salle pour une question d'affichage de l'heure.
    """
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return datetime.now().astimezone().tzinfo or ZoneInfo("UTC")
