"""Ouvrir et fermer des salles, sans systemd."""

from collections.abc import Sequence
from pathlib import Path

import pytest

from nel3ab_control.api.controllers.salles import (
    PlusDeSalle,
    SalleInconnue,
    SalleRebelle,
    SallesController,
)
from nel3ab_control.settings import Settings


class FauxSysteme:
    """Un systemd de papier: il note ce qu'on lui demande et répond ce qu'on veut."""

    def __init__(self, allumees: Sequence[int] = (), refuse: bool = False) -> None:
        self.allumees = set(allumees)
        self.refuse = refuse
        self.commandes: list[list[str]] = []

    async def __call__(self, commande: Sequence[str]) -> tuple[int, str]:
        self.commandes.append(list(commande))
        numero = int(commande[-1].split("@")[1])
        if "is-active" in commande:
            return (0, "active") if numero in self.allumees else (3, "inactive")
        if self.refuse:
            return 1, "Unit not found."
        if "start" in commande:
            self.allumees.add(numero)
        else:
            self.allumees.discard(numero)
        return 0, ""


@pytest.fixture
def reglages(tmp_path: Path) -> Settings:
    return Settings(salles_dir=tmp_path / "salles")


async def test_ouvrir_prend_le_premier_emplacement_libre(reglages: Settings) -> None:
    systeme = FauxSysteme()
    salles = SallesController(reglages, systeme)

    salle = await salles.ouvrir()

    assert (salle.numero, salle.chemin) == (1, "/r/1/")
    assert ["sudo", "-n", "systemctl", "start", "nel3ab-worker@1"] in systeme.commandes


async def test_la_seconde_demande_prend_l_autre_emplacement(reglages: Settings) -> None:
    systeme = FauxSysteme(allumees=[1])
    salles = SallesController(reglages, systeme)

    assert (await salles.ouvrir()).numero == 2


async def test_la_salle_de_trop_est_refusee_tout_de_suite(reglages: Settings) -> None:
    """Le jumeau négatif: personne n'attend, on dit non et on dit pourquoi."""
    systeme = FauxSysteme(allumees=[1, 2, 3])
    salles = SallesController(reglages, systeme)

    with pytest.raises(PlusDeSalle) as refus:
        await salles.ouvrir()

    assert refus.value.status_code == 503
    assert "revenez plus tard" in refus.value.detail
    assert not [c for c in systeme.commandes if "start" in c], "une salle a été lancée quand même"


async def test_une_salle_ouverte_arrive_sur_son_menu(reglages: Settings) -> None:
    """Sans ce marqueur, le worker relancerait le dernier jeu de ce dossier."""
    salles = SallesController(reglages, FauxSysteme())

    await salles.ouvrir()

    assert (reglages.salles_dir / "1" / "game-closed").exists()


async def test_lire_l_etat_ne_demande_aucun_droit(reglages: Settings) -> None:
    """Tout ce qui passe par sudo est une ligne que le réseau peut faire tourner
    en tant que root. Lire n'en a pas besoin, et rien ne doit l'y ramener."""
    systeme = FauxSysteme(allumees=[2])
    salles = SallesController(reglages, systeme)

    etat = await salles.etat()

    assert [(s.numero, s.ouverte) for s in etat] == [(1, False), (2, True), (3, False)]
    assert all("sudo" not in commande for commande in systeme.commandes)


async def test_fermer_une_salle_qui_n_existe_pas(reglages: Settings) -> None:
    salles = SallesController(reglages, FauxSysteme())

    with pytest.raises(SalleInconnue):
        await salles.fermer(7)


async def test_un_refus_de_systemd_est_rapporte(reglages: Settings) -> None:
    """Une salle qu'on croit ouverte et qui ne l'est pas envoie quelqu'un sur
    une page morte sans lui dire pourquoi."""
    salles = SallesController(reglages, FauxSysteme(refuse=True))

    with pytest.raises(SalleRebelle) as raté:
        await salles.ouvrir()

    assert "Unit not found." in raté.value.detail
