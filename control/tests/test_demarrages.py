"""Combien de temps un jeu met d'habitude à démarrer (D05), sans worker ni horloge réelle."""

import json
from pathlib import Path

import httpx
import pytest

from nel3ab_control import demarrages as demarrages_module
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.demarrages import ABANDON_S, Demarrages
from nel3ab_control.parties import JeuJoue
from nel3ab_control.settings import Settings


class Murale:
    """Une horloge murale qu'un essai fait avancer, en secondes depuis 1970."""

    def __init__(self) -> None:
        self.maintenant = 1_763_900_000.0

    def __call__(self) -> float:
        return self.maintenant

    def ms(self) -> int:
        return int(self.maintenant * 1000)


def demarrer(demarrages: Demarrages, murale: Murale, salle: int, cle: str, duree: float) -> None:
    """Un lancement accepté, le nouveau worker qui démarre, puis son image."""
    demarrages.lance(salle, cle, "gc")
    lance_ms = murale.ms()
    demarrages.vu(salle, cle, lance_ms - 60_000, lance_ms - 50_000)  # l'ancien worker
    murale.maintenant += 2.0
    demarrages.vu(salle, cle, murale.ms(), None)  # le nouveau, sans image
    murale.maintenant += duree - 2.0
    demarrages.vu(salle, cle, lance_ms + 2_000, murale.ms())


def lignes(fichier: Path) -> list[dict]:
    return [json.loads(ligne) for ligne in fichier.read_text(encoding="utf-8").splitlines()]


def test_cinq_demarrages_donnent_une_habitude(tmp_path: Path) -> None:
    murale = Murale()
    demarrages = Demarrages(tmp_path / "d.jsonl", murale)
    for duree in (20.0, 24.0, 25.0, 26.0, 40.0):
        demarrer(demarrages, murale, 1, "Melee.rvz", duree)

    habitude = demarrages.habituel("Melee.rvz")

    assert habitude is not None
    assert (habitude.mediane_s, habitude.p90_s, habitude.n) == (25.0, 40.0, 5)


def test_quatre_demarrages_ne_font_pas_une_habitude(tmp_path: Path) -> None:
    """Le jumeau: absent, pas une valeur par défaut."""
    murale = Murale()
    demarrages = Demarrages(tmp_path / "d.jsonl", murale)
    for duree in (20.0, 24.0, 25.0, 26.0):
        demarrer(demarrages, murale, 1, "Melee.rvz", duree)

    assert demarrages.habituel("Melee.rvz") is None


def test_un_lancement_sans_image_n_entre_pas_dans_l_habitude(tmp_path: Path) -> None:
    """Le nouveau worker revient sur son menu: une ligne « abandon », jamais comptée."""
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrages = Demarrages(fichier, murale)
    for duree in (20.0, 24.0, 25.0, 26.0):
        demarrer(demarrages, murale, 1, "Melee.rvz", duree)
    demarrages.lance(1, "Melee.rvz", "gc")
    murale.maintenant += 3.0
    demarrages.vu(1, None, murale.ms(), None)

    assert demarrages.habituel("Melee.rvz") is None
    assert [ligne["issue"] for ligne in lignes(fichier)][-1] == "abandon"


def test_l_ancien_worker_ne_mesure_pas_le_nouveau_demarrage(tmp_path: Path) -> None:
    """Relancer le jeu qui tourne: l'ancien worker montre encore la même clé et
    sa vieille image. Sans la garde de `depuis_ms`, la durée serait négative ou
    nulle, et le lancement serait clos sur l'image d'avant."""
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrages = Demarrages(fichier, murale)
    demarrages.lance(1, "Melee.rvz", "gc")
    avant = murale.ms() - 600_000
    murale.maintenant += 0.5

    demarrages.vu(1, "Melee.rvz", avant, murale.ms())

    assert not fichier.exists(), "rien n'est mesuré sur l'ancien worker"


def test_un_lancement_trop_long_est_abandonne(tmp_path: Path) -> None:
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrages = Demarrages(fichier, murale)
    demarrages.lance(2, "Zelda.rvz", "wii")
    murale.maintenant += ABANDON_S + 1

    demarrages.vu(2, "Zelda.rvz", murale.ms() - 1000, None)

    (ligne,) = lignes(fichier)
    assert (ligne["issue"], ligne["secondes"]) == ("abandon", None)


def test_un_second_lancement_abandonne_le_premier(tmp_path: Path) -> None:
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrages = Demarrages(fichier, murale)
    demarrages.lance(1, "Melee.rvz", "gc")
    demarrages.lance(1, "Zelda.rvz", "wii")

    assert [(ligne["cle"], ligne["issue"]) for ligne in lignes(fichier)] == [
        ("Melee.rvz", "abandon")
    ]


def test_une_ligne_ne_dit_personne(tmp_path: Path) -> None:
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrer(Demarrages(fichier, murale), murale, 1, "Melee.rvz", 21.5)

    (ligne,) = lignes(fichier)
    assert set(ligne) == {"v", "quand", "cle", "console", "secondes", "issue"}
    assert (ligne["secondes"], ligne["issue"]) == (21.5, "image")


def test_l_habitude_survit_a_un_redemarrage_du_salon(tmp_path: Path) -> None:
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrages = Demarrages(fichier, murale)
    for duree in (30.0, 31.0, 32.0, 33.0, 34.0, 35.0):
        demarrer(demarrages, murale, 3, "Mario.xci", duree)

    relue = Demarrages(fichier, murale).habituel("Mario.xci")

    assert relue is not None
    assert (relue.mediane_s, relue.p90_s, relue.n) == (32.5, 35.0, 6)


def test_un_lancement_sans_cle_n_attend_rien(tmp_path: Path) -> None:
    """Un worker d'avant les clés: on ne saurait pas reconnaître le jeu."""
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrages = Demarrages(fichier, murale)
    demarrages.lance(1, None, "gc")
    murale.maintenant += 20

    demarrages.vu(1, None, murale.ms() - 10_000, murale.ms())

    assert not fichier.exists()


async def test_la_salle_publie_l_habitude_de_chaque_jeu(settings: Settings, tmp_path: Path) -> None:
    """D05 de bout en bout: le lancement passe par `RoomController.lance`, la
    première image par `/roms`, et `Room.library` porte l'habitude."""
    murale = Murale()
    demarrages = Demarrages(tmp_path / "d.jsonl", murale)
    etat: dict = {"depuis_ms": murale.ms() - 60_000, "image_ms": murale.ms() - 59_000}

    def worker(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "players": 4,
                "current": 0,
                "roms": [{"name": "Melee", "console": "gc", "key": "Melee.rvz"}],
                **etat,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(worker)) as http:
        rooms = RoomController(settings, http, 1, demarrages=demarrages)
        for duree in (20.0, 22.0, 24.0, 26.0, 28.0):
            rooms.lance(None, "Bo", JeuJoue(cle="Melee.rvz", console="gc", titre="Melee"), 0)
            lance_ms = murale.ms()
            murale.maintenant += duree
            etat.update(depuis_ms=lance_ms + 2_000, image_ms=murale.ms())
            await rooms.library()

        library, running = await rooms.library()

    assert running is not None and running.demarrage is not None
    assert library[0].demarrage == running.demarrage
    assert (running.demarrage.mediane_s, running.demarrage.n) == (24.0, 5)


def test_settings_par_defaut_hors_du_vrai_dossier() -> None:
    """La fixture autouse remplace le fichier de production (règle du 21 novembre)."""
    assert not Settings().demarrages_file.is_relative_to(Path.home() / ".local/state/nel3ab")


@pytest.mark.parametrize("duree", [-3.0, ABANDON_S + 60])
def test_une_duree_impossible_n_est_pas_ecrite(tmp_path: Path, duree: float) -> None:
    """L'horloge murale a sauté: ni mesure ni habitude."""
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrages = Demarrages(fichier, murale)
    demarrages.lance(1, "Melee.rvz", "gc")
    lance_ms = murale.ms()

    demarrages.vu(1, "Melee.rvz", lance_ms + 2_000, lance_ms + int(duree * 1000))

    assert not fichier.exists()


@pytest.mark.parametrize(
    ("octets", "anciennes", "comptes"),
    [
        # Un morceau de la ligne d'avant: écarté, les cinq récentes restent.
        (40, 0, 5),
        # La coupe tombe juste au début d'une ligne récente: elle est gardée.
        (0, 0, 5),
        # Une ancienne ligne entière tient dans la borne: elle compte aussi.
        (0, 1, 6),
    ],
)
def test_un_gros_fichier_est_lu_par_sa_fin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, octets: int, anciennes: int, comptes: int
) -> None:
    """Au-delà de la borne, ce sont les démarrages RÉCENTS qui comptent: ils
    sont à la fin du fichier. Un jeu devenu lent ne doit pas garder pour
    toujours l'habitude de ses premiers mois."""
    murale = Murale()
    fichier = tmp_path / "d.jsonl"
    demarrages = Demarrages(fichier, murale)
    for _ in range(25):
        demarrer(demarrages, murale, 1, "Mario.xci", 10.0)
    anciens = fichier.stat().st_size
    une_ligne = len(fichier.read_bytes().splitlines(keepends=True)[-1])
    for _ in range(5):
        demarrer(demarrages, murale, 1, "Mario.xci", 50.0)
    recents = fichier.stat().st_size - anciens
    monkeypatch.setattr(demarrages_module, "TAILLE_MAX", recents + anciennes * une_ligne + octets)

    relue = Demarrages(fichier, murale).habituel("Mario.xci")

    assert relue is not None
    assert (relue.mediane_s, relue.p90_s, relue.n) == (50.0, 50.0, comptes)
