"""La partie de Smash du 27 novembre 2026, rejouée dans la boîte noire du service.

Les lignes sont les vraies (`echantillons/sessions_2026-11-27_smash.jsonl`, de
00:32 à 00:40 à l'heure des joueurs), sans identité: l'adresse, le pseudo,
l'appareil et les sockets sont remplacés. Elles passent par le vrai `Suiveur`,
le déclencheur que `declencheur_depuis` construit avec les réglages par défaut,
et la boucle `BoiteNoire.tour`, toutes les deux secondes comme en partie.

Ce soir-là, la boîte noire a pris une capture « gel » de 33 386 ms à 00:33:15.
C'était le démarrage du jeu: la page attendait sa première image depuis 33 s.
La règle s'est ensuite tue cinq minutes, et le vrai gel de 543 ms de 00:36:14
n'a ni profil, ni image, ni journal. Même sans ce faux gel, le trou de 1 488 ms
de 00:33:23 aurait fait taire la règle jusqu'à 00:38:23: la pause elle-même
était le défaut.
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from nel3ab_control.boite_noire.declencheur import Suiveur
from nel3ab_control.boite_noire.service import BoiteNoire, declencheur_depuis
from nel3ab_control.journal import Journal, _zone
from nel3ab_control.settings import Settings
from tests.boite_noire.test_service import RYUJINX, Executeur, FauxReleveur

ECHANTILLON = Path(__file__).parent / "echantillons" / "sessions_2026-11-27_smash.jsonl"
PARIS = _zone("Europe/Paris")
DEBUT = datetime(2026, 11, 27, 0, 32, 0, tzinfo=PARIS)
FIN = datetime(2026, 11, 27, 0, 41, 0, tzinfo=PARIS)


class CapteurDate:
    """Le faux capteur, qui garde aussi l'heure de chaque capture."""

    def __init__(self) -> None:
        self.captures: list[tuple[datetime, str, dict[str, Any]]] = []

    def capturer(
        self,
        raison: str,
        moteur: dict[str, Any],
        quand: datetime,
        details: dict[str, Any],
        avant: Any = None,
    ) -> None:
        self.captures.append((quand, raison, details))


def _rejouer(tmp_path: Path, **autres: Any) -> tuple[CapteurDate, list[dict[str, Any]]]:
    reglages = Settings(
        journal_dir=tmp_path / "sessions", boite_noire_dir=tmp_path / "bn", **autres
    )
    reglages.journal_dir.mkdir(parents=True)
    lignes = [json.loads(brute) for brute in ECHANTILLON.read_text(encoding="utf-8").splitlines()]
    # La précondition: l'échantillon couvre bien la soirée, ses trois gros trous compris.
    pires = {
        ligne["quand"][11:19]: max(ligne["vu"]["arrivées"][2], ligne["vu"]["attente"])
        for ligne in lignes
        if ligne["quoi"] == "mesures"
    }
    assert (pires["00:33:13"], pires["00:33:23"], pires["00:36:14"]) == (33386, 1488, 543)

    horloge = {"t": DEBUT}
    capteur = CapteurDate()
    boite = BoiteNoire(
        reglages,
        FauxReleveur([RYUJINX]),
        capteur,
        Journal(reglages.boite_noire_dir / "releves", 7, "Europe/Paris"),
        Suiveur(reglages.journal_dir, PARIS),
        declencheur_depuis(reglages),
        Executeur(),
        horloge=lambda: (horloge["t"] - DEBUT).total_seconds(),
        murale=lambda: horloge["t"],
    )
    journal = reglages.journal_dir / "2026-11-27.jsonl"
    journal.write_text("", encoding="utf-8")
    restantes = list(lignes)
    while horloge["t"] <= FIN:
        # Le salon écrit chaque ligne à son heure; le tour suivant la lit.
        with journal.open("a", encoding="utf-8") as ouvert:
            while restantes and datetime.fromisoformat(restantes[0]["quand"]) <= horloge["t"]:
                ouvert.write(json.dumps(restantes.pop(0), ensure_ascii=False) + "\n")
        boite.tour()
        horloge["t"] += timedelta(seconds=reglages.boite_noire_pas_partie_s)
    assert not restantes, "le rejeu s'est arrêté avant la fin de l'échantillon"
    releves = [
        json.loads(brute)
        for fichier in sorted((reglages.boite_noire_dir / "releves").glob("*.jsonl"))
        for brute in fichier.read_text(encoding="utf-8").splitlines()
    ]
    return capteur, releves


def _heure(quand: datetime) -> str:
    return quand.astimezone(PARIS).strftime("%H:%M:%S")


def _prises(capteur: CapteurDate) -> list[tuple[str, Any, Any]]:
    return [
        (_heure(quand), details.get("cause"), details.get("gel_ms"))
        for quand, raison, details in capteur.captures
        if raison == "chute"
    ]


def test_le_demarrage_de_smash_est_ecrit_sans_capture_ni_pause(tmp_path: Path) -> None:
    capteur, releves = _rejouer(tmp_path)

    # Rouge le 27 novembre 2026: la première capture était ("00:33:14", "gel", 33386.0).
    assert _prises(capteur)[:1] == [("00:33:24", "gel", 1488.0)]
    # Le démarrage est écrit, sans capture et sans pause: la capture de 1 488 ms
    # le suit de dix secondes.
    demarrages = [ligne for ligne in releves if ligne["quoi"] == "démarrage"]
    assert [(ligne["quand"][11:19], ligne["chute"]["gel_ms"]) for ligne in demarrages] == [
        ("00:33:14", 33386.0)
    ]


def test_le_vrai_gel_de_00_36_14_est_pris(tmp_path: Path) -> None:
    """La pause d'un gel ne fait pas taire un gel distinct trois minutes plus tard."""
    capteur, _ = _rejouer(tmp_path)

    # Rouge le 27 novembre 2026: [("00:33:14", "gel", 33386.0)], et rien d'autre.
    # Rouge encore avec le seul démarrage corrigé: [("00:33:24", "gel", 1488.0)].
    assert _prises(capteur) == [("00:33:24", "gel", 1488.0), ("00:36:16", "gel", 543.0)]


def test_la_pause_d_un_gel_vient_des_reglages(tmp_path: Path) -> None:
    """Le câblage, pas la règle: une pause de cinq minutes réglée pour le gel refait
    perdre celui de 00:36:14. C'est bien la valeur des réglages que le service
    donne au déclencheur, et la minute est son défaut."""
    assert Settings().boite_noire_pause_gel_s == 60.0
    capteur, _ = _rejouer(tmp_path, boite_noire_pause_gel_s=300.0)

    assert _prises(capteur) == [("00:33:24", "gel", 1488.0)]


def test_le_trou_de_fin_de_match_reste_sous_le_seuil(tmp_path: Path) -> None:
    """Le jumeau: la pause courte ne transforme pas tout trou en capture. Les 389 et
    280 ms de 00:39 sont sous les 500 ms du seuil, et ne sont pas pris."""
    capteur, _ = _rejouer(tmp_path)

    apres = [quand for quand, _, _ in capteur.captures if _heure(quand) >= "00:37:00"]
    assert apres == []
