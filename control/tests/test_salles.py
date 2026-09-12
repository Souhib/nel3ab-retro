"""Ouvrir et fermer des salles, sans systemd."""

from collections.abc import Sequence
from pathlib import Path

import httpx
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


def worker_qui_joue(jeu: str, console: str) -> httpx.AsyncClient:
    """Un worker de papier qui dit ce qu'il fait tourner."""

    def repond(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/roms":
            return httpx.Response(404)
        return httpx.Response(
            200,
            json={
                "current": 1,
                "players": 4,
                "roms": [
                    {"name": "Un autre jeu", "console": "gc"},
                    {"name": jeu, "console": console},
                ],
            },
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(repond))


async def test_la_liste_dit_ce_que_chaque_salle_joue(reglages: Settings) -> None:
    async with worker_qui_joue("Mario Tennis Aces", "switch") as client:
        salles = SallesController(reglages, FauxSysteme(allumees=[1]), client=client)

        etat = await salles.etat()

    assert (etat[0].jeu, etat[0].switch) == ("Mario Tennis Aces", True)
    assert (etat[1].jeu, etat[1].switch) == (None, False), "une salle éteinte ne joue rien"


async def test_un_jeu_qui_n_est_pas_switch_ne_prend_pas_la_place_switch(
    reglages: Settings,
) -> None:
    """Le jumeau: une seule salle peut jouer à la Switch, et la liste doit dire
    laquelle. Marquer tous les jeux ferait refuser la Switch à tout le monde."""
    async with worker_qui_joue("Super Smash Bros Melee", "gc") as client:
        salles = SallesController(reglages, FauxSysteme(allumees=[1]), client=client)

        etat = await salles.etat()

    assert etat[0].jeu == "Super Smash Bros Melee"
    assert etat[0].switch is False


async def test_une_salle_qui_ne_repond_pas_reste_dans_la_liste(reglages: Settings) -> None:
    """Une salle qui boude est décrite sans son jeu, pas retirée de la liste.

    La retirer, ou faire échouer la liste entière, empêcherait de rejoindre les
    autres salles pour une raison qui ne les concerne pas.
    """

    def muet(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("personne au bout")

    async with httpx.AsyncClient(transport=httpx.MockTransport(muet)) as client:
        salles = SallesController(reglages, FauxSysteme(allumees=[1]), client=client)

        etat = await salles.etat()

    assert etat[0].ouverte is True
    assert etat[0].jeu is None


async def test_une_salle_eteinte_n_est_pas_interrogee(reglages: Settings) -> None:
    """Le second jumeau: demander à un worker qui n'existe pas ferait attendre
    la liste pour rien, et ce serait l'attente de la salle la plus morte."""
    demandes: list[str] = []

    def note(request: httpx.Request) -> httpx.Response:
        demandes.append(str(request.url))
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(note)) as client:
        salles = SallesController(reglages, FauxSysteme(), client=client)

        await salles.etat()

    assert demandes == []


async def test_la_liste_dit_qui_est_dans_chaque_salle(reglages: Settings) -> None:
    """Une carte qui ne dit pas qui est là oblige à entrer pour le savoir, et
    entrer prend une manette. Le salon tient lui-même cette liste: il n'a rien à
    demander à la salle pour la remplir, donc elle reste vraie même quand une
    salle ne répond plus."""
    salles = SallesController(reglages, FauxSysteme(allumees=[1]))

    etat = await salles.etat(lambda numero: ["Souhib", "Lu"] if numero == 1 else [])

    assert etat[0].gens == ["Souhib", "Lu"]
    assert etat[1].gens == [], "une salle que le registre ne nomme pas n'a personne"


async def test_une_salle_fermee_n_a_personne_meme_si_le_registre_le_croit(
    reglages: Settings,
) -> None:
    """Le jumeau, et c'est lui qui compte: le registre des présents peut traîner
    derrière la fermeture d'une salle. Un nom sur une carte veut dire « rejoins
    les », donc un fantôme dans une salle éteinte enverrait quelqu'un frapper à
    une porte qui n'existe plus."""
    salles = SallesController(reglages, FauxSysteme(allumees=[1]))

    etat = await salles.etat(lambda _numero: ["fantôme"])

    assert etat[0].gens == ["fantôme"], "la salle ouverte dit bien qui y est"
    assert [s.gens for s in etat[1:]] == [[], []], "une salle fermée n'a personne"


async def test_sans_registre_la_liste_ne_dit_personne(reglages: Settings) -> None:
    """Sans registre fourni, la liste se tait au lieu d'affirmer que les salles
    sont désertes. C'est le cas des essais, et de tout appelant qui ne sait pas."""
    salles = SallesController(reglages, FauxSysteme(allumees=[1]))

    assert [s.gens for s in await salles.etat()] == [[], [], []]
