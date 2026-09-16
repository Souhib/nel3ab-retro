"""La boucle de la boîte noire: relever, écouter les pages, capturer.

Une seule règle domine toutes les autres: la boîte noire ne doit JAMAIS s'arrêter
ni ralentir une partie. Une exception dans un tour est journalisée, comptée, et le
tour suivant a lieu. Les captures tournent sur un fil à part, pour que les relevés
continuent pendant les dix secondes d'un profil. Une chute demandée pendant qu'une
autre capture tourne attend au plus `ATTENTE_MAX`; une capture périodique, elle,
est sautée, puisque la suivante viendra.
"""

import logging
import signal
import subprocess  # lancer le perf roulant est le travail de ce module
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from nel3ab_control.boite_noire.capture import Capteur
from nel3ab_control.boite_noire.conservation import balayer_captures
from nel3ab_control.boite_noire.declencheur import Chute, Declencheur, Suiveur
from nel3ab_control.boite_noire.releve import Racines, Releveur
from nel3ab_control.boite_noire.roulant import Roulant
from nel3ab_control.journal import Journal, _zone
from nel3ab_control.settings import Settings

_log = logging.getLogger(__name__)

#: Combien de temps une chute peut attendre qu'une capture en cours se termine.
#: Au-delà, la mesure prise ne dirait plus rien de la chute qui l'a demandée.
ATTENTE_MAX = timedelta(seconds=60)


class _Releve(Protocol):
    def moteur_en_cours(self) -> bool: ...

    def prendre(self, avec_allocateur: bool = True) -> dict[str, Any]: ...


class _Soumission(Protocol):
    """Ce que la boucle demande à un exécuteur: soumettre, et savoir si c'est fini."""

    def submit(self, fn: Callable[..., Any], /, *args: Any) -> Future[Any]: ...


class _Capture(Protocol):
    def capturer(
        self,
        raison: str,
        moteur: dict[str, Any],
        quand: datetime,
        details: dict[str, Any],
        avant: Any = None,
    ) -> Any: ...


class BoiteNoire:
    """Un tour de boucle à la fois; `tour` rend combien de secondes attendre."""

    def __init__(
        self,
        reglages: Settings,
        releveur: _Releve,
        capteur: _Capture,
        journal: Journal,
        suiveur: Suiveur,
        declencheur: Declencheur,
        executeur: _Soumission,
        horloge: Callable[[], float] = time.monotonic,
        murale: Callable[[], datetime] | None = None,
        roulant: Roulant | None = None,
    ) -> None:
        self._reglages = reglages
        self._releveur = releveur
        self._capteur = capteur
        self._journal = journal
        self._suiveur = suiveur
        self._declencheur = declencheur
        self._executeur = executeur
        self._roulant = roulant
        self._horloge = horloge
        zone = _zone(reglages.journal_zone)
        self._murale = murale or (lambda: datetime.now(tz=zone))
        self._dernier_allocateur = float("-inf")
        # Pas de capture périodique au démarrage du service: dix minutes de partie
        # d'abord. Le premier banc, le 14 septembre 2026, en déclenchait une à chaque
        # redémarrage, et elle a fait sauter la capture d'une vraie chute.
        self._dernier_profil = horloge()
        self._attente: tuple[Chute, dict[str, Any], datetime] | None = None
        self._jour_balaye: str | None = None
        self._en_cours: Future[Any] | None = None

    def tour(self) -> float:
        maintenant = self._murale()
        t = self._horloge()
        # Jamais pendant une partie, sauf si on le demande. Mesuré le 14 septembre 2026 sur
        # Mario Tennis à quatre: chaque lecture de `amdgpu_vram_mm` et `amdgpu_gem_info`
        # coupait l'image une centaine de millisecondes. Une lecture toutes les deux
        # secondes a fait 48 trous de plus de 33 ms en une minute, zéro sans la boîte noire.
        permis = (
            not self._releveur.moteur_en_cours() or self._reglages.boite_noire_debugfs_en_partie
        )
        avec_allocateur = (
            permis and t - self._dernier_allocateur >= self._reglages.boite_noire_allocateur_s
        )
        if avec_allocateur:
            self._dernier_allocateur = t
        ligne = self._releveur.prendre(avec_allocateur=avec_allocateur)
        self._journal.write("relevé", when=maintenant, **ligne)

        for lue in self._suiveur.nouvelles(maintenant):
            self._declencheur.lire(lue)
        moteurs = [moteur for moteur in ligne.get("moteurs") or [] if isinstance(moteur, dict)]
        # Le `perf` roulant suit la partie en cours et s'arrête avec elle: une
        # machine au repos n'a rien à profiler, et un `perf` oublié écrit un jour.
        if self._roulant is not None:
            premier = self._moteur_de(None, moteurs)
            if premier is None:
                self._roulant.arreter()
            else:
                self._roulant.suivre(premier)
        self._reprendre(maintenant)
        for chute in self._declencheur.evaluer(maintenant):
            self._demander("chute", self._moteur_de(chute.salle, moteurs), maintenant, chute)
        periode = self._reglages.boite_noire_periode_profil_s
        if moteurs and self._attente is None and t - self._dernier_profil >= periode:
            moteur = self._moteur_de(None, moteurs)
            if moteur is not None and self._demander("periodique", moteur, maintenant, None):
                self._dernier_profil = t

        jour = maintenant.date().isoformat()
        if jour != self._jour_balaye:
            self._jour_balaye = jour
            balayer_captures(
                self._reglages.boite_noire_dir / "captures",
                self._reglages.boite_noire_jours,
                maintenant.date(),
            )
        pas = self._reglages
        return pas.boite_noire_pas_partie_s if moteurs else pas.boite_noire_pas_repos_s

    def _occupe(self) -> bool:
        return self._en_cours is not None and not self._en_cours.done()

    def _reprendre(self, maintenant: datetime) -> None:
        """Lance la chute mise en attente, si la capture précédente est finie."""
        if self._attente is None or self._occupe():
            return
        chute, moteur, quand = self._attente
        self._attente = None
        if maintenant - quand > ATTENTE_MAX:
            self._journal.write(
                "capture abandonnée", when=maintenant, raison="chute", chute=asdict(chute)
            )
            return
        self._demander("chute", moteur, maintenant, chute)

    def _moteur_de(self, salle: int | None, moteurs: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Le moteur de cette salle, ou le premier qui a des fils mesurés."""
        avec_fils = [moteur for moteur in moteurs if moteur.get("fils")]
        if salle is not None:
            return next((moteur for moteur in avec_fils if moteur.get("salle") == salle), None)
        return avec_fils[0] if avec_fils else None

    def _demander(
        self, raison: str, moteur: dict[str, Any] | None, quand: datetime, chute: Chute | None
    ) -> bool:
        details = asdict(chute) if chute else {}
        if moteur is None:
            self._journal.write("capture impossible", when=quand, raison=raison, chute=details)
            return False
        if self._occupe():
            if chute is not None:
                # Une chute se garde pour plus tard, une capture périodique se saute:
                # la prochaine viendra dans dix minutes, la chute ne reviendra peut-être pas.
                self._attente = (chute, moteur, quand)
                self._journal.write("capture différée", when=quand, raison=raison, chute=details)
            else:
                self._journal.write("capture sautée", when=quand, raison=raison, chute=details)
            return False
        # Le tampon ne part QU'avec une chute: une capture périodique décrit une
        # machine qui va bien, et les secondes qui la précèdent aussi.
        avant = self._roulant.vider if (chute is not None and self._roulant is not None) else None
        self._en_cours = self._executeur.submit(
            self._capteur.capturer, raison, moteur, quand, details, avant
        )
        self._journal.write(
            "capture", when=quand, raison=raison, salle=moteur.get("salle"), chute=details
        )
        return True


def _lancer_roulant(argv: list[str]) -> "subprocess.Popen[bytes]":
    """Le `perf` roulant, détaché de la sortie du service.

    Sa sortie va dans un FICHIER et pas au néant. Le 17 septembre 2026, ce `perf`
    est mort à chaque démarrage et son silence a coûté une heure: un enregistreur
    qu'on croit armé est pire que pas d'enregistreur.
    """
    trace = Path(argv[argv.index("-o") + 1]).with_name("roulant.log")
    trace.parent.mkdir(parents=True, exist_ok=True)
    # En AJOUT: en écrasement, le message du `perf` qui vient de mourir est effacé
    # par celui qui le remplace, et le fichier est vide quand on vient le lire.
    sortie = trace.open("a", encoding="utf-8")
    return subprocess.Popen(  # noqa: S603 - programme fixe, arguments en tableau, pas de shell
        argv, stdout=sortie, stderr=subprocess.STDOUT
    )


def main() -> None:  # pragma: no cover - la boucle réelle, prouvée par son unité en service
    """Le service: jusqu'à `SIGTERM`, sans jamais laisser une exception l'arrêter."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    reglages = Settings()
    zone = _zone(reglages.journal_zone)
    racines = Racines()
    releves = reglages.boite_noire_dir / "releves"
    boite = BoiteNoire(
        reglages,
        Releveur(racines),
        Capteur(
            reglages.boite_noire_dir / "captures",
            racines,
            journal_salon=reglages.journal_dir,
            secondes=reglages.boite_noire_capture_s,
            debugfs=reglages.boite_noire_debugfs_en_partie,
        ),
        Journal(releves, reglages.boite_noire_jours, reglages.journal_zone),
        Suiveur(reglages.journal_dir, zone),
        Declencheur(
            seuil=reglages.boite_noire_seuil_images,
            seuil_gel_ms=reglages.boite_noire_seuil_gel_ms,
        ),
        ThreadPoolExecutor(max_workers=1, thread_name_prefix="capture"),
        roulant=Roulant(reglages.boite_noire_dir / "roulant", lanceur=_lancer_roulant)
        if reglages.boite_noire_roulant
        else None,
    )
    arret = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: arret.set())
    signal.signal(signal.SIGINT, lambda *_: arret.set())
    erreurs: dict[str, int] = {}
    pas = 0.0
    while not arret.wait(pas):
        try:
            pas = boite.tour()
        # Toute exception, et c'est voulu: une boîte noire qui s'arrête ne voit plus rien.
        except Exception as erreur:
            genre = type(erreur).__name__
            erreurs[genre] = erreurs.get(genre, 0) + 1
            if erreurs[genre] == 1:
                _log.exception("un tour a échoué; la boîte noire continue")
            pas = reglages.boite_noire_pas_repos_s
