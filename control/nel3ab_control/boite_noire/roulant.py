"""Un `perf` qui tourne sans rien écrire, et qu'un gel vide.

# Le trou que ça bouche

Le 16 septembre 2026, la règle de gel a capturé ses premiers freezes, et le profil
de ces captures ne montrait rien: elles démarrent APRÈS le trou. Dix secondes de
profil d'une machine repartie ne disent pas pourquoi elle s'était arrêtée.

# Comment

`perf record --overwrite --switch-output=signal` garde ses échantillons dans un
tampon en mémoire et n'écrit RIEN tant qu'on ne lui envoie pas `SIGUSR2`. À ce
moment-là il vide le tampon dans un fichier daté et continue. Le fichier contient
donc les dernières secondes AVANT le signal, c'est-à-dire le gel lui-même.

# Ce que ça coûte, et pourquoi c'est borné

Le tampon est fixé (`MEGAOCTETS`), donc la mémoire ne grandit pas avec la durée
d'une soirée: quand il est plein, les plus vieux échantillons sont écrasés. C'est
exactement ce qu'on veut, puisque seule la fin nous intéresse.

Le processus est arrêté dès qu'aucun émulateur ne tourne: une machine au repos
n'a rien à profiler, et un `perf` oublié est un `perf` qui écrit un jour.

# Il suit le PROCESSUS, pas ses fils

Une capture ordinaire profile les trois fils les plus occupés du dernier relevé:
elle dure dix secondes, et ce trio ne bouge pas pendant ce temps. Ici
l'enregistrement dure toute la partie, et la COMPOSITION de ce trio change sans
arrêt. Mesuré le 17 septembre 2026: le `perf` roulant repartait dix-sept fois
par minute, son tampon avait donc toujours deux secondes d'âge, et chaque arrêt
laissait derrière lui un vidage de 250 Ko. Suivre le processus règle les trois.
"""

import logging
import os
import signal
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

_log = logging.getLogger(__name__)

#: La taille du tampon circulaire, en PAGES de 4 Kio et par fil suivi.
#:
#: 128, soit 512 Kio. La borne n'est pas un choix de confort: un processus sans
#: `CAP_IPC_LOCK` ne peut verrouiller que `perf_event_mlock_kb`, qui vaut
#: **516 Kio** sur cette machine (lu le 17 septembre 2026). Un premier essai à
#: huit mégaoctets a fait refuser `perf` au démarrage, vingt-huit fois par
#: minute, avec « Permission error mapping pages », et le service se croyait armé
#: alors que le tampon n'existait pas. Un mégaoctet aurait échoué pareil.
#:
#: Ce que ça garde: à 199 échantillons par seconde sur trois fils avec les piles
#: d'appel, 512 Kio tiennent quelques secondes, ce qu'un gel d'une seconde
#: demande. Un tampon trop court se verrait dans le profil, qui porte ses heures.
PAGES = 128

#: Combien de temps on attend qu'un vidage apparaisse, en secondes.
#:
#: Deux. `perf` écrit son fichier sur le signal, mais rien ne garantit l'instant.
#: Au-delà, on rend `None` plutôt que de faire attendre une capture: un profil
#: manquant vaut mieux qu'une boîte noire bloquée.
ATTENTE_VIDAGE_S = 2.0


class _Processus(Protocol):
    """Le minimum qu'on demande à un processus lancé: son numéro, et sa fin."""

    pid: int

    def poll(self) -> int | None: ...

    def terminate(self) -> None: ...

    def wait(self, timeout: float | None = None) -> int: ...


class Roulant:
    """Le `perf` qui tourne pendant la partie, et qu'un gel vient vider."""

    def __init__(
        self,
        dossier: Path,
        lanceur: Callable[[list[str]], _Processus],
        signaleur: Callable[[int, int], None] = os.kill,
        frequence: int = 199,
        attente_s: float = ATTENTE_VIDAGE_S,
        horloge: Callable[[], float] = time.monotonic,
    ) -> None:
        self._dossier = dossier
        self._lanceur = lanceur
        self._signaleur = signaleur
        self._frequence = frequence
        self._attente = attente_s
        self._horloge = horloge
        self._processus: _Processus | None = None
        #: Le processus suivi. Il change quand le jeu change, et un `perf` qui
        #: suivrait l'ancien ne rapporterait plus rien.
        self._suivi: int | None = None

    @property
    def base(self) -> Path:
        """Où `perf` écrit; ses vidages prennent ce nom suivi d'une date."""
        return self._dossier / "roulant.perf.data"

    def suivi(self) -> int | None:
        """Publié parce qu'un essai ne peut pas vérifier autrement qu'un
        changement de jeu a bien relancé l'enregistrement."""
        return self._suivi

    def suivre(self, moteur: dict[str, Any]) -> None:
        """S'assure qu'un `perf` tourne sur le processus de ce moteur."""
        voulu = moteur.get("pid")
        if not isinstance(voulu, int) or isinstance(voulu, bool):
            self.arreter()
            return
        vivant = self._processus is not None and self._processus.poll() is None
        if vivant and voulu == self._suivi:
            return
        if self._processus is not None and not vivant:
            _log.warning(
                "le perf roulant s'est arrêté seul; voir %s", self._dossier / "roulant.log"
            )
        self.arreter()
        self._dossier.mkdir(parents=True, exist_ok=True)
        argv = [
            "perf",
            "record",
            "--overwrite",
            "--switch-output=signal",
            "-F",
            str(self._frequence),
            "-g",
            "-m",
            str(PAGES),
            "--proc-map-timeout",
            "5000",
            "-p",
            str(voulu),
            "-o",
            str(self.base),
        ]
        # Les vidages laissés par un enregistrement précédent ne servent plus, et
        # un dossier qui les garde finit par peser plus que les captures.
        for reste in self._vidages():
            reste.unlink(missing_ok=True)
        self._processus = self._lanceur(argv)
        self._suivi = voulu

    def arreter(self) -> None:
        """Arrête l'enregistrement. Sans effet s'il n'y en a pas."""
        processus, self._processus, self._suivi = self._processus, None, None
        if processus is None:
            return
        if processus.poll() is not None:
            # Déjà mort de lui-même: il reste à le RÉCOLTER. Sans ce `wait`, le
            # 17 septembre 2026, un `perf` qui refusait de démarrer laissait un
            # zombie par tour de boucle, et le service se croyait armé.
            processus.wait()
            return
        try:
            processus.terminate()
            processus.wait(timeout=2)
        except (OSError, ValueError) as souci:
            # Un profileur qui meurt mal ne doit rien casser, mais son silence
            # cacherait un `perf` qui survit et qui écrira un jour.
            _log.warning("le perf roulant ne s'est pas arrêté proprement: %s", souci)

    def vider(self, vers: Path) -> Path | None:
        """Demande le tampon et le range dans `vers`. Rend le fichier, ou `None`.

        `None` veut dire « pas de profil d'avant », jamais « la capture a
        échoué »: l'appelant continue sa capture dans tous les cas.
        """
        if self._processus is None or self._processus.poll() is not None:
            return None
        deja = set(self._vidages())
        try:
            self._signaleur(self._processus.pid, signal.SIGUSR2)
        except OSError:
            return None
        limite = self._horloge() + self._attente
        while self._horloge() < limite:
            nouveaux = [chemin for chemin in self._vidages() if chemin not in deja]
            if nouveaux:
                dernier = max(nouveaux, key=lambda chemin: chemin.name)
                vers.mkdir(parents=True, exist_ok=True)
                cible = vers / "avant.perf.data"
                try:
                    dernier.replace(cible)
                except OSError:
                    return None
                return cible
            time.sleep(0.05)
        return None

    def _vidages(self) -> list[Path]:
        try:
            return [
                chemin
                for chemin in self._dossier.iterdir()
                if chemin.name.startswith("roulant.perf.data.")
            ]
        except OSError:
            return []
