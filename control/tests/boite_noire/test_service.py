"""La boucle: faux relevé et faux capteur, mais vrais journal et déclencheur."""

import json
from collections.abc import Callable
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from nel3ab_control.boite_noire.declencheur import Declencheur, Suiveur
from nel3ab_control.boite_noire.service import BoiteNoire
from nel3ab_control.journal import Journal
from nel3ab_control.settings import Settings

PARIS = timezone(timedelta(hours=2))
DEBUT = datetime(2026, 9, 14, 0, 30, 0, tzinfo=PARIS)

RYUJINX = {
    "pid": 4242,
    "moteur": "switch",
    "salle": 1,
    "fils": [{"nom": "GUI.RenderLoop", "tid": 4250, "cpu_pct": 93.0}],
}


class FauxReleveur:
    def __init__(self, moteurs: list[dict[str, Any]]) -> None:
        self.moteurs = moteurs
        self.allocateur: list[bool] = []

    def moteur_en_cours(self) -> bool:
        return bool(self.moteurs)

    def prendre(self, avec_allocateur: bool = True) -> dict[str, Any]:
        self.allocateur.append(avec_allocateur)
        return {"moteurs": self.moteurs, "gpu": {"horloge": "700Mhz"}}


class FauxCapteur:
    def __init__(self) -> None:
        self.captures: list[tuple[str, int | None, dict[str, Any]]] = []
        #: Ce que la capture a reçu comme vidage du tampon roulant, capture par
        #: capture: `None` quand il n'y en a pas.
        self.avants: list[Any] = []

    def capturer(
        self,
        raison: str,
        moteur: dict[str, Any],
        quand: datetime,
        details: dict[str, Any],
        avant: Any = None,
    ) -> None:
        self.captures.append((raison, moteur.get("salle"), details))
        self.avants.append(avant)


class Executeur:
    """Exécute tout de suite, ou garde la capture « en cours » quand on le demande."""

    def __init__(self, bloque: bool = False) -> None:
        self.bloque = bloque
        self.futurs: list[Future[Any]] = []

    def submit(self, fonction: Callable[..., Any], *args: Any) -> Future[Any]:
        futur: Future[Any] = Future()
        if not self.bloque:
            futur.set_result(fonction(*args))
        self.futurs.append(futur)
        return futur

    def liberer(self) -> None:
        self.bloque = False
        for futur in self.futurs:
            if not futur.done():
                futur.set_result(None)


class Temps:
    def __init__(self) -> None:
        self.secondes = 0.0

    def monotone(self) -> float:
        return self.secondes

    def murale(self) -> datetime:
        return DEBUT + timedelta(seconds=self.secondes)


def _boite(
    tmp_path: Path,
    releveur: FauxReleveur,
    capteur: FauxCapteur,
    executeur: Executeur | None = None,
    roulant: Any = None,
) -> tuple[BoiteNoire, Temps, Settings]:
    reglages = Settings(
        journal_dir=tmp_path / "sessions",
        boite_noire_dir=tmp_path / "boite-noire",
        boite_noire_periode_profil_s=600,
        boite_noire_allocateur_s=60,
    )
    reglages.journal_dir.mkdir(parents=True)
    temps = Temps()
    boite = BoiteNoire(
        reglages,
        releveur,
        capteur,
        Journal(reglages.boite_noire_dir / "releves", 7, "Europe/Paris"),
        Suiveur(reglages.journal_dir, PARIS),
        Declencheur(),
        executeur or Executeur(),
        horloge=temps.monotone,
        murale=temps.murale,
        roulant=roulant,
    )
    return boite, temps, reglages


def _lignes(reglages: Settings) -> list[dict[str, Any]]:
    return [
        json.loads(ligne)
        for fichier in sorted((reglages.boite_noire_dir / "releves").glob("*.jsonl"))
        for ligne in fichier.read_text(encoding="utf-8").splitlines()
    ]


def _mesure(temps: Temps, cadence: float) -> str:
    ligne = {
        "quand": temps.murale().isoformat(),
        "quoi": "mesures",
        "visite": "a",
        "banc": False,
        "vu": {"jeuHz": cadence},
        "salle": {"jeu": "Mario Tennis Aces", "numéro": 1},
    }
    return json.dumps(ligne, ensure_ascii=False) + "\n"


def test_chaque_tour_ecrit_un_releve_a_l_heure_des_joueurs(tmp_path: Path) -> None:
    boite, _, reglages = _boite(tmp_path, FauxReleveur([]), FauxCapteur())

    boite.tour()

    (ligne,) = _lignes(reglages)
    assert ligne["quoi"] == "relevé"
    assert ligne["quand"].startswith("2026-09-14T00:30:00")
    assert ligne["gpu"] == {"horloge": "700Mhz"}


def test_le_pas_suit_la_partie(tmp_path: Path) -> None:
    au_repos, _, reglages = _boite(tmp_path / "a", FauxReleveur([]), FauxCapteur())
    en_partie, _, _ = _boite(tmp_path / "b", FauxReleveur([RYUJINX]), FauxCapteur())

    assert au_repos.tour() == reglages.boite_noire_pas_repos_s
    assert en_partie.tour() == reglages.boite_noire_pas_partie_s


def test_l_allocateur_n_est_lu_qu_une_fois_par_minute(tmp_path: Path) -> None:
    releveur = FauxReleveur([])
    boite, temps, _ = _boite(tmp_path, releveur, FauxCapteur())

    for seconde in (0, 2, 58, 60, 62):
        temps.secondes = seconde
        boite.tour()

    assert releveur.allocateur == [True, False, False, True, False]


def test_une_chute_des_pages_declenche_une_capture_de_sa_salle(tmp_path: Path) -> None:
    capteur = FauxCapteur()
    autre_salle = {**RYUJINX, "pid": 1, "salle": 2}
    boite, temps, reglages = _boite(tmp_path, FauxReleveur([autre_salle, RYUJINX]), capteur)
    boite.tour()  # le suiveur part de la fin du journal, et la capture périodique part
    capteur.captures.clear()

    journal = reglages.journal_dir / "2026-09-14.jsonl"
    for seconde in (10, 20, 30):
        temps.secondes = seconde
        with journal.open("a", encoding="utf-8") as ouvert:
            ouvert.write(_mesure(temps, 40))
    temps.secondes = 32
    boite.tour()

    assert capteur.captures == [
        (
            "chute",
            1,
            {
                "salle": 1,
                "mediane": 40.0,
                "mesures": 3,
                "pages": 1,
                "jeu": "Mario Tennis Aces",
                "cause": "cadence",
                "gel_ms": None,
            },
        )
    ]
    assert "capture" in [ligne["quoi"] for ligne in _lignes(reglages)]


def test_une_capture_periodique_toutes_les_dix_minutes_de_partie(tmp_path: Path) -> None:
    capteur = FauxCapteur()
    boite, temps, _ = _boite(tmp_path, FauxReleveur([RYUJINX]), capteur)

    for seconde in (0, 300, 599, 600, 900, 1199, 1200):
        temps.secondes = seconde
        boite.tour()

    assert [raison for raison, _, _ in capteur.captures] == ["periodique", "periodique"]


def test_pas_de_capture_periodique_sans_partie(tmp_path: Path) -> None:
    capteur = FauxCapteur()
    boite, temps, _ = _boite(tmp_path, FauxReleveur([]), capteur)

    for seconde in (0, 700, 1400):
        temps.secondes = seconde
        boite.tour()

    assert capteur.captures == []


def test_un_moteur_sans_fils_mesures_ne_consomme_pas_la_capture_periodique(tmp_path: Path) -> None:
    """Le premier relevé d'une partie n'a pas encore d'écarts: la capture attend le suivant."""
    capteur = FauxCapteur()
    releveur = FauxReleveur([{**RYUJINX, "fils": []}])
    boite, temps, _ = _boite(tmp_path, releveur, capteur)

    temps.secondes = 600
    boite.tour()
    releveur.moteurs = [RYUJINX]
    temps.secondes = 602
    boite.tour()

    assert [raison for raison, _, _ in capteur.captures] == ["periodique"]


def test_une_capture_demandee_pendant_une_autre_est_sautee_et_notee(tmp_path: Path) -> None:
    capteur = FauxCapteur()
    boite, temps, reglages = _boite(
        tmp_path, FauxReleveur([RYUJINX]), capteur, Executeur(bloque=True)
    )

    temps.secondes = 600
    boite.tour()  # périodique, qui reste « en cours »
    temps.secondes = 1300
    boite.tour()  # la suivante arrive pendant la première

    quoi = [ligne["quoi"] for ligne in _lignes(reglages)]
    assert quoi.count("capture") == 1
    assert "capture sautée" in quoi


def test_une_chute_sans_moteur_de_la_salle_est_notee_sans_capture(tmp_path: Path) -> None:
    capteur = FauxCapteur()
    boite, temps, reglages = _boite(tmp_path, FauxReleveur([]), capteur)
    boite.tour()

    journal = reglages.journal_dir / "2026-09-14.jsonl"
    for seconde in (10, 20, 30):
        temps.secondes = seconde
        with journal.open("a", encoding="utf-8") as ouvert:
            ouvert.write(_mesure(temps, 40))
    boite.tour()

    assert capteur.captures == []
    assert "capture impossible" in [ligne["quoi"] for ligne in _lignes(reglages)]


def test_pas_de_capture_periodique_au_demarrage_du_service(tmp_path: Path) -> None:
    """Le défaut du premier banc: chaque redémarrage prenait une capture tout de suite."""
    capteur = FauxCapteur()
    boite, temps, _ = _boite(tmp_path, FauxReleveur([RYUJINX]), capteur)

    for seconde in (0, 2, 599):
        temps.secondes = seconde
        boite.tour()

    assert capteur.captures == []


def test_l_allocateur_n_est_jamais_lu_pendant_une_partie(tmp_path: Path) -> None:
    """Chaque lecture coupait l'image cent millisecondes sur Mario Tennis."""
    releveur = FauxReleveur([RYUJINX])
    boite, temps, _ = _boite(tmp_path, releveur, FauxCapteur())

    for seconde in (0, 60, 120):
        temps.secondes = seconde
        boite.tour()
    releveur.moteurs = []
    temps.secondes = 180
    boite.tour()

    assert releveur.allocateur == [False, False, False, True]


def test_le_reglage_permet_de_lire_l_allocateur_pendant_une_partie(tmp_path: Path) -> None:
    """Le jumeau: le défaut se lève sur demande, pour une enquête qui accepte les trous."""
    releveur = FauxReleveur([RYUJINX])
    boite, temps, reglages = _boite(tmp_path, releveur, FauxCapteur())
    reglages.boite_noire_debugfs_en_partie = True

    for seconde in (0, 60):
        temps.secondes = seconde
        boite.tour()

    assert releveur.allocateur == [True, True]


def _ecrire_chute(reglages: Settings, temps: Temps, debut: int) -> None:
    journal = reglages.journal_dir / "2026-09-14.jsonl"
    for decalage in (0, 10, 20):
        temps.secondes = debut + decalage
        with journal.open("a", encoding="utf-8") as ouvert:
            ouvert.write(_mesure(temps, 40))


def test_une_chute_pendant_une_capture_attend_et_part_ensuite(tmp_path: Path) -> None:
    """Le second défaut du premier banc: la chute simulée avait été sautée."""
    capteur = FauxCapteur()
    executeur = Executeur(bloque=True)
    boite, temps, reglages = _boite(tmp_path, FauxReleveur([RYUJINX]), capteur, executeur)
    temps.secondes = 600
    boite.tour()  # capture périodique, qui reste en cours

    _ecrire_chute(reglages, temps, 610)
    temps.secondes = 632
    boite.tour()
    assert capteur.captures == []
    assert "capture différée" in [ligne["quoi"] for ligne in _lignes(reglages)]

    executeur.liberer()
    temps.secondes = 640
    boite.tour()
    assert [(raison, salle) for raison, salle, _ in capteur.captures] == [("chute", 1)]


def test_une_chute_qui_attend_trop_longtemps_est_abandonnee(tmp_path: Path) -> None:
    capteur = FauxCapteur()
    executeur = Executeur(bloque=True)
    boite, temps, reglages = _boite(tmp_path, FauxReleveur([RYUJINX]), capteur, executeur)
    temps.secondes = 600
    boite.tour()
    _ecrire_chute(reglages, temps, 610)
    temps.secondes = 632
    boite.tour()

    executeur.liberer()
    temps.secondes = 700
    boite.tour()

    assert capteur.captures == []
    assert "capture abandonnée" in [ligne["quoi"] for ligne in _lignes(reglages)]


class FauxRoulant:
    """Le `perf` roulant, réduit à ce que le service lui demande."""

    def __init__(self) -> None:
        self.suivis: list[int | None] = []
        self.arrets = 0
        self.vidages: list[Path] = []

    def suivre(self, moteur: dict[str, Any]) -> None:
        self.suivis.append(moteur.get("pid"))

    def arreter(self) -> None:
        self.arrets += 1

    def vider(self, vers: Path) -> Path | None:
        self.vidages.append(vers)
        return vers / "avant.perf.data"


def test_le_roulant_suit_la_partie_et_s_arrete_au_repos(tmp_path: Path) -> None:
    """Une machine au repos n'a rien à profiler, et un `perf` oublié écrit un jour."""
    roulant = FauxRoulant()
    boite, _, _ = _boite(tmp_path, FauxReleveur([RYUJINX]), FauxCapteur(), roulant=roulant)
    boite.tour()
    assert roulant.suivis == [RYUJINX["pid"]]

    vide, _, _ = _boite(tmp_path / "vide", FauxReleveur([]), FauxCapteur(), roulant=roulant)
    vide.tour()

    assert roulant.arrets >= 1


def test_une_chute_emporte_le_tampon_et_pas_une_capture_periodique(tmp_path: Path) -> None:
    """Le profil d'AVANT n'a de sens que pour un gel: les secondes qui précèdent une
    capture périodique décrivent une machine qui va bien."""
    roulant = FauxRoulant()
    capteur = FauxCapteur()
    boite, temps, reglages = _boite(tmp_path, FauxReleveur([RYUJINX]), capteur, roulant=roulant)
    boite.tour()  # aucune capture: la périodique ne part pas au démarrage
    journal = reglages.journal_dir / "2026-09-14.jsonl"
    for seconde in (10, 20, 30):
        temps.secondes = seconde
        with journal.open("a", encoding="utf-8") as ouvert:
            ouvert.write(_mesure(temps, 40))
    temps.secondes = 32
    boite.tour()
    # Puis une périodique, une fois la période écoulée et la chute passée.
    temps.secondes = 700
    boite.tour()

    assert [capture[0] for capture in capteur.captures] == ["chute", "periodique"]
    assert capteur.avants[0] == roulant.vider
    assert capteur.avants[1] is None
