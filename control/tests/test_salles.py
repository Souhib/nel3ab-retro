"""Ouvrir et fermer des salles, sans systemd."""

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from nel3ab_control.api.controllers.salles import (
    PlusDeSalle,
    SalleInconnue,
    SalleRebelle,
    SallesController,
)
from nel3ab_control.api.schemas.salle import SiegeVu
from nel3ab_control.settings import Settings
from tests.faux_systeme import FauxSysteme, Horloge


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
    assert etat[0].repond is False, "allumée mais muette, et la liste le dit"


async def test_une_salle_qui_repond_le_dit(reglages: Settings) -> None:
    """Le jumeau: la même salle sur son menu répond, sans jeu. `jeu` est rien
    dans les deux cas; seul `repond` les sépare."""

    def menu(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"current": None, "players": 4, "roms": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(menu)) as client:
        salles = SallesController(reglages, FauxSysteme(allumees=[1]), client=client)

        etat = await salles.etat()

    assert (etat[0].jeu, etat[0].repond) == (None, True)
    assert [s.repond for s in etat[1:]] == [None, None], "une salle fermée n'est pas demandée"


async def test_une_reponse_qui_n_est_pas_un_objet_est_une_salle_muette(
    reglages: Settings,
) -> None:
    """Une liste à la place d'un objet faisait lever `AttributeError` et tomber
    la liste entière. C'est une réponse inexploitable, pas une panne du salon."""

    def liste(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[1, 2])

    async with httpx.AsyncClient(transport=httpx.MockTransport(liste)) as client:
        etat = await SallesController(reglages, FauxSysteme(allumees=[1]), client=client).etat()

    assert (etat[0].ouverte, etat[0].repond) == (True, False)


async def test_sans_client_la_liste_ne_dit_pas_si_la_salle_repond(reglages: Settings) -> None:
    """On n'a pas demandé: ni vrai ni faux."""
    etat = await SallesController(reglages, FauxSysteme(allumees=[1])).etat()

    assert etat[0].repond is None


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

    etat = await salles.etat(Registre({1: ["Souhib", "Lu"]}))

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

    etat = await salles.etat(Registre({1: ["fantôme"], 2: ["fantôme"], 3: ["fantôme"]}))

    assert etat[0].gens == ["fantôme"], "la salle ouverte dit bien qui y est"
    assert [s.gens for s in etat[1:]] == [[], []], "une salle fermée n'a personne"
    assert [(s.chef, s.sieges, s.regardent) for s in etat[1:]] == [(None, [], [])] * 2


async def test_sans_registre_la_liste_ne_dit_personne(reglages: Settings) -> None:
    """Sans registre fourni, la liste se tait au lieu d'affirmer que les salles
    sont désertes. C'est le cas des essais, et de tout appelant qui ne sait pas."""
    salles = SallesController(reglages, FauxSysteme(allumees=[1]))

    assert [s.gens for s in await salles.etat()] == [[], [], []]


class Registre:
    """Un registre de présents de papier: des pseudos par salle, sans place."""

    def __init__(self, gens: dict[int, list[str]]) -> None:
        self._gens = gens

    def gens(self, numero: int) -> list[str]:
        return list(self._gens.get(numero, []))

    def chef(self, numero: int) -> str | None:
        return next(iter(self._gens.get(numero, [])), None)

    def sieges(self, numero: int) -> list[SiegeVu] | None:
        return [SiegeVu(port=1, nom=nom, tenu=True) for nom in self._gens.get(numero, [])[:1]]

    def regardent(self, numero: int) -> list[str]:
        return list(self._gens.get(numero, []))[1:]


#: Une horloge monotone figée, partagée par le faux systemd et le contrôleur.
#:
#: Le faux calculait son horodatage sur la VRAIE horloge monotone, qui compte
#: depuis le démarrage de la machine. Une salle « ouverte depuis 300 s » sur
#: un runner démarré depuis deux minutes donnait un horodatage négatif, lu
#: comme une unité jamais démarrée: `None == 300` en CI le 13 septembre 2026,
#: vert sur une machine allumée depuis des jours. Une heure de marche suffit à
#: rendre le calcul possible; la valeur exacte ne compte pas.
HORLOGE = lambda: 3600.0  # noqa: E731


#: Un reçu de place tel que le worker les écrit: 32 hexa, un tiret, un compteur.
TENUE = "a" * 32 + "-1"


class FauxWorker:
    """Un worker de papier qui dit quelles manettes sont tenues."""

    def __init__(self, places: list[str | None] | None) -> None:
        self.places = places
        self.demandes: list[str] = []

    async def __call__(self, adresse: str) -> list[str | None] | None:
        self.demandes.append(adresse)
        return self.places


async def test_la_liste_dit_depuis_quand_le_jeu_tourne(reglages: Settings) -> None:
    """Une carte qui ne dit pas depuis quand le jeu tourne oblige à entrer pour
    savoir si on arrive au milieu d'une partie commencée il y a deux heures.

    C'était `ouverte_depuis` jusqu'au 23 novembre 2026: la valeur de systemd,
    qui repart à chaque changement de jeu, est le temps du JEU. Une salle
    allumée hors du salon n'a pas de repère d'ouverture, donc pas d'ouverture.
    """
    systeme = FauxSysteme(allumees=[1], depuis={1: 300.0}, horloge=HORLOGE)
    salles = SallesController(reglages, systeme, horloge=HORLOGE)

    etat = await salles.etat()

    assert etat[0].jeu_depuis == pytest.approx(300, abs=2)
    assert etat[0].ouverte_depuis is None


async def test_une_salle_eteinte_n_a_pas_d_anciennete(reglages: Settings) -> None:
    """Le jumeau négatif: une salle qui ne tourne pas ne tourne DEPUIS rien.

    Elle coûte une question à systemd depuis le 23 novembre 2026, une seule,
    pour son heure de fermeture: la liste pose une question par salle.
    """
    systeme = FauxSysteme(allumees=[1], depuis={1: 300.0}, horloge=HORLOGE)
    salles = SallesController(reglages, systeme, horloge=HORLOGE)

    etat = await salles.etat()

    assert [(s.ouverte_depuis, s.jeu_depuis) for s in etat[1:]] == [(None, None), (None, None)]
    interrogees = [c[-1] for c in systeme.commandes if "show" in c]
    assert interrogees == ["nel3ab-worker@1", "nel3ab-worker@2", "nel3ab-worker@3"]


async def test_une_unite_sans_horodatage_ne_dit_pas_zero(reglages: Settings) -> None:
    """systemd rend `0` pour une unité qui n'a jamais démarré. Le rendre tel quel
    afficherait « depuis 0 seconde », une absence déguisée en mesure,
    c'est-à-dire exactement la faute que le schéma interdit."""
    systeme = FauxSysteme(allumees=[1])

    etat = await SallesController(reglages, systeme).etat()

    assert etat[0].ouverte is True
    assert etat[0].jeu_depuis is None


async def test_la_liste_dit_combien_de_manettes_sont_libres(reglages: Settings) -> None:
    """L'autre moitié de « puis-je entrer »: savoir qu'il reste une manette."""
    worker = FauxWorker([TENUE, None, None, None])
    salles = SallesController(reglages, FauxSysteme(allumees=[1]), lire_places=worker)

    etat = await salles.etat()

    assert etat[0].places == 3
    assert worker.demandes == ["127.0.0.1:8111"], "la salle 1 se contrôle sur 8111"


async def test_un_worker_muet_ne_dit_pas_quatre_places_libres(reglages: Settings) -> None:
    """Le jumeau: un worker qui se tait n'est pas une salle vide. Annoncer quatre
    places libres ferait venir quatre personnes sur une salle pleine."""
    salles = SallesController(reglages, FauxSysteme(allumees=[1]), lire_places=FauxWorker(None))

    etat = await salles.etat()

    assert etat[0].places is None


async def test_une_salle_eteinte_n_est_pas_interrogee_pour_ses_places(
    reglages: Settings,
) -> None:
    """Le second jumeau: attendre deux secondes la réponse d'un worker qui
    n'existe pas retarderait la liste entière pour la salle la plus morte."""
    worker = FauxWorker([None, None, None, None])
    salles = SallesController(reglages, FauxSysteme(), lire_places=worker)

    etat = await salles.etat()

    assert worker.demandes == []
    assert [s.places for s in etat] == [None, None, None]


async def test_sans_lecteur_la_liste_ne_dit_pas_les_places(reglages: Settings) -> None:
    """Le défaut est de ne PAS savoir. Brancher le vrai lecteur par défaut ferait
    taper le worker de cette machine depuis les essais, qui écoute pour de vrai."""
    etat = await SallesController(reglages, FauxSysteme(allumees=[1])).etat()

    assert etat[0].places is None


async def test_une_salle_que_systemd_relance_est_dite_en_redemarrage(reglages: Settings) -> None:
    """Le worker SORT à chaque changement de jeu, et systemd le relance deux
    secondes plus tard. Pendant ces deux secondes, `is-active` dit « activating »
    avec un code non nul: la liste disait « fermée », et la page d'un joueur
    affichait « La salle 1 est fermée. » à chaque changement de jeu (relecture
    du 22 novembre 2026)."""
    salles = SallesController(reglages, FauxSysteme(relancees=[1]))

    etat = await salles.etat()

    assert (etat[0].ouverte, etat[0].redemarre) == (False, True)


async def test_jumeau_une_salle_arretee_n_est_pas_en_redemarrage(reglages: Settings) -> None:
    salles = SallesController(reglages, FauxSysteme(allumees=[2]))

    etat = await salles.etat()

    assert [(s.numero, s.ouverte, s.redemarre) for s in etat] == [
        (1, False, False),
        (2, True, False),
        (3, False, False),
    ]


async def test_ouvrir_ne_prend_pas_une_salle_qui_redemarre(reglages: Settings) -> None:
    """Sinon « ouvrir une salle » pendant les deux secondes d'un changement de
    jeu posait le marqueur « sans jeu » dans la salle 1, puis la démarrait: elle
    revenait sur son menu et la partie de tout le monde était perdue."""
    systeme = FauxSysteme(relancees=[1])
    salles = SallesController(reglages, systeme)

    salle = await salles.ouvrir()

    assert salle.numero == 2
    assert not (reglages.salles_dir / "1" / "game-closed").exists()
    assert ["sudo", "-n", "systemctl", "start", "nel3ab-worker@1"] not in systeme.commandes


async def test_l_ouverture_survit_a_un_changement_de_jeu(reglages: Settings) -> None:
    """« Ouverte depuis » dit depuis quand la SALLE est ouverte, pas le jeu.

    Le worker sort à chaque changement de jeu et systemd le relance: son
    horodatage d'activation repart. Le 23 novembre 2026, la salle 1 ouverte à
    07:05:47 disait son ancienneté depuis 07:09:08, sa deuxième relance.
    """
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    horloge.avancer(600)

    systeme.relancer(1)
    etat = await salles.etat()

    assert etat[0].ouverte_depuis == pytest.approx(602, abs=1)


async def test_le_temps_du_jeu_repart_a_chaque_changement_de_jeu(reglages: Settings) -> None:
    """Le jumeau du précédent: ce qui survit est l'ouverture, pas le jeu."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    horloge.avancer(600)
    assert (await salles.etat())[0].jeu_depuis == pytest.approx(600, abs=1)

    systeme.relancer(1)

    assert (await salles.etat())[0].jeu_depuis == pytest.approx(0, abs=1)


async def test_un_repere_d_un_autre_demarrage_ne_vaut_rien(reglages: Settings) -> None:
    """L'horloge monotone repart à zéro au démarrage de la machine: un repère
    écrit avant un redémarrage dirait n'importe quoi."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    await SallesController(reglages, systeme, horloge=horloge, demarrage=lambda: "avant").ouvrir()

    salles = SallesController(reglages, systeme, horloge=horloge, demarrage=lambda: "apres")
    etat = await salles.etat()

    assert etat[0].ouverte is True
    assert etat[0].ouverte_depuis is None


async def test_le_meme_demarrage_garde_le_repere(reglages: Settings) -> None:
    """Le jumeau: le même identifiant de démarrage, un autre contrôleur (le salon
    a redémarré), et le repère vaut encore."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    await SallesController(reglages, systeme, horloge=horloge, demarrage=lambda: "lui").ouvrir()
    horloge.avancer(90)

    salles = SallesController(reglages, systeme, horloge=horloge, demarrage=lambda: "lui")

    assert (await salles.etat())[0].ouverte_depuis == pytest.approx(90, abs=1)


async def test_une_salle_fermee_seule_puis_rallumee_a_la_main_n_a_pas_d_ouverture(
    reglages: Settings,
) -> None:
    """Fermée faute d'activité (code 42), le repère reste: seul `fermer` le
    retire. Rallumée à la main, hors du salon, elle ne doit pas dire « ouverte
    depuis » l'ouverture d'avant. La longue pause inactive le trahit."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    horloge.avancer(1800)
    systeme.fermer_seule(1)
    horloge.avancer(3600)

    systeme.demarrer(1)
    etat = await salles.etat()

    assert etat[0].ouverte is True
    assert etat[0].ouverte_depuis is None


async def test_rouvrir_par_le_salon_repose_le_repere(reglages: Settings) -> None:
    """Le jumeau: la même salle fermée seule, rouverte par le salon, a une
    ouverture neuve. Le repère est posé APRÈS le démarrage: posé avant, la
    longue pause le périmerait aussitôt."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    horloge.avancer(1800)
    systeme.fermer_seule(1)
    horloge.avancer(3600)

    await salles.ouvrir()
    horloge.avancer(30)

    assert (await salles.etat())[0].ouverte_depuis == pytest.approx(30, abs=1)


async def test_fermer_retire_le_repere(reglages: Settings) -> None:
    salles = SallesController(reglages, FauxSysteme())
    await salles.ouvrir()
    repere = reglages.salles_dir / "1" / "ouverte-le"
    assert repere.is_file()

    await salles.fermer(1)

    assert not repere.exists()


async def test_un_repere_en_lien_n_est_pas_suivi(reglages: Settings, tmp_path: Path) -> None:
    """ADR D36: un moteur peut laisser un lien dans le dossier de sa salle. Lu,
    il ne donne rien; écrit, il est remplacé, et sa cible reste intacte."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    dossier = reglages.salles_dir / "1"
    cible = tmp_path / "ailleurs"
    avant = (dossier / "ouverte-le").read_bytes()
    cible.write_bytes(avant)
    (dossier / "ouverte-le").unlink()
    (dossier / "ouverte-le").symlink_to(cible)

    assert (await salles.etat())[0].ouverte_depuis is None

    horloge.avancer(60)
    systeme.arreter(1)
    await salles.ouvrir()
    assert (dossier / "ouverte-le").is_file()
    assert not (dossier / "ouverte-le").is_symlink()
    assert cible.read_bytes() == avant, "la cible du lien a été réécrite"


async def test_le_marqueur_sans_jeu_ne_suit_pas_un_lien(reglages: Settings, tmp_path: Path) -> None:
    """Le marqueur était posé par `Path.touch`, qui suit un lien: un moteur
    pouvait faire créer ou dater un fichier de l'hôte. Il est maintenant retiré
    et recréé dans le dossier, et la cible du lien n'est pas touchée."""
    dossier = reglages.salles_dir / "1"
    dossier.mkdir(parents=True)
    cible = tmp_path / "fichier-de-l-hote"
    (dossier / "game-closed").symlink_to(cible)

    await SallesController(reglages, FauxSysteme()).ouvrir()

    assert not cible.exists(), "le lien a été suivi"
    assert (dossier / "game-closed").is_file()
    assert not (dossier / "game-closed").is_symlink()


async def test_un_dossier_de_salle_en_lien_est_refuse(reglages: Settings, tmp_path: Path) -> None:
    """Le dossier numéroté lui-même ne se suit pas non plus: ouvrir refuse."""
    reglages.salles_dir.mkdir(parents=True)
    ailleurs = tmp_path / "ailleurs"
    ailleurs.mkdir()
    (reglages.salles_dir / "1").symlink_to(ailleurs)

    with pytest.raises(SalleRebelle) as refus:
        await SallesController(reglages, FauxSysteme()).ouvrir()

    assert "dossier" in refus.value.detail

    assert list(ailleurs.iterdir()) == []


async def test_une_salle_fermee_faute_d_activite_dit_quand_et_pourquoi(reglages: Settings) -> None:
    """« La salle 1 a fermé à 23 h 12 »: systemd le sait sans droit particulier."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    horloge.avancer(1800)
    systeme.fermer_seule(1)
    horloge.avancer(120)

    etat = await salles.etat()

    assert etat[0].ouverte is False
    assert etat[0].fermee_depuis == pytest.approx(120, abs=1)
    assert etat[0].fermee_pour == "inactivite"


async def test_une_salle_fermee_par_quelqu_un_est_un_arret(reglages: Settings) -> None:
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    await salles.fermer(1)
    horloge.avancer(60)

    etat = await salles.etat()

    assert etat[0].fermee_depuis == pytest.approx(60, abs=1)
    assert etat[0].fermee_pour == "arret"


async def test_une_autre_sortie_est_une_panne(reglages: Settings) -> None:
    """Le jumeau du code 42: une sortie que systemd renonce à relancer."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    systeme.fermer_seule(1, statut=1)

    assert (await salles.etat())[0].fermee_pour == "panne"


async def test_une_salle_jamais_demarree_n_a_pas_d_heure_de_fermeture(reglages: Settings) -> None:
    """systemd rend `0`: ni heure ni raison, plutôt que « fermée depuis 0 s »."""
    etat = await SallesController(reglages, FauxSysteme(horloge=HORLOGE), horloge=HORLOGE).etat()

    assert [(s.fermee_depuis, s.fermee_pour) for s in etat] == [(None, None)] * 3


async def test_une_salle_ouverte_n_a_pas_d_heure_de_fermeture(reglages: Settings) -> None:
    """Après un changement de jeu, l'unité est passée par l'inactif: son heure
    d'entrée dans l'inactif existe, mais la salle n'est pas fermée."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    systeme.relancer(1)

    etat = await salles.etat()

    assert (etat[0].ouverte, etat[0].fermee_depuis, etat[0].fermee_pour) == (True, None, None)


async def test_une_salle_qu_on_ferme_n_a_pas_encore_d_heure_de_fermeture(
    reglages: Settings,
) -> None:
    """« deactivating » compte comme fermée pour la liste, mais son dernier
    passage par l'inactif est celui de son dernier changement de jeu: le lire
    dirait « fermée depuis » l'heure de ce changement."""
    horloge = Horloge()
    systeme = FauxSysteme(horloge=horloge)
    salles = SallesController(reglages, systeme, horloge=horloge)
    await salles.ouvrir()
    systeme.relancer(1)
    horloge.avancer(600)
    systeme.unite(1).etat = "deactivating"

    etat = await salles.etat()

    assert etat[0].ouverte is False
    assert (etat[0].fermee_depuis, etat[0].fermee_pour) == (None, None)


def bibliotheque(reglages: Settings, *jeux: tuple[str, str, str]) -> None:
    """Le catalogue qu'un worker écrit dans le dossier de sa salle (ADR D24)."""
    dossier = reglages.salles_dir / "1"
    dossier.mkdir(parents=True, exist_ok=True)
    (dossier / "catalogue.json").write_text(
        json.dumps(
            {
                "version": 1,
                "scanned_ms": 1_763_700_000_000,
                "roms": [
                    {"key": cle, "name": nom, "console": console, "art": False}
                    for cle, nom, console in jeux
                ],
            }
        ),
        encoding="utf-8",
    )


def retenir(reglages: Settings, numero: int, cle: str, quand: float = 1_763_666_000.0) -> Path:
    """Ce que `remember_choice` écrit avant de relancer le worker."""
    dossier = reglages.salles_dir / str(numero)
    dossier.mkdir(parents=True, exist_ok=True)
    chemin = dossier / "chosen-rom"
    chemin.write_text(cle, encoding="utf-8")
    os.utime(chemin, (quand, quand))
    return chemin


MARIO = ("Mario Tennis Aces.xci", "Mario Tennis Aces", "switch")
MELEE = ("Melee.rvz", "Super Smash Bros Melee", "gc")


async def test_la_liste_dit_le_dernier_jeu_d_une_salle_fermee(reglages: Settings) -> None:
    """« Le dernier jeu de cette salle : Melee, jeudi soir. » Lu dans le dossier
    que le worker garde, qui survit à la fermeture."""
    bibliotheque(reglages, MELEE, MARIO)
    retenir(reglages, 2, "Melee.rvz")

    etat = await SallesController(reglages, FauxSysteme()).etat()

    dernier = etat[1].dernier_jeu
    assert dernier is not None
    assert (dernier.cle, dernier.titre) == ("Melee.rvz", "Super Smash Bros Melee")
    assert dernier.quand == datetime.fromtimestamp(1_763_666_000.0, tz=UTC)
    assert [etat[0].dernier_jeu, etat[2].dernier_jeu] == [None, None]


async def test_un_jeu_retenu_qui_n_est_plus_dans_la_bibliotheque_ne_se_dit_pas(
    reglages: Settings,
) -> None:
    """Un titre inventé depuis le nom de fichier dirait un jeu que la salle ne
    peut plus lancer."""
    bibliotheque(reglages, MELEE)
    retenir(reglages, 2, "Parti.rvz")

    etat = await SallesController(reglages, FauxSysteme()).etat()

    assert etat[1].dernier_jeu is None


async def test_un_jeu_retenu_en_lien_n_est_pas_lu(reglages: Settings, tmp_path: Path) -> None:
    """ADR D36: le dossier de la salle est écrit par ses moteurs."""
    bibliotheque(reglages, MELEE)
    cible = tmp_path / "ailleurs"
    cible.write_text("Melee.rvz", encoding="utf-8")
    (reglages.salles_dir / "2").mkdir(parents=True)
    (reglages.salles_dir / "2" / "chosen-rom").symlink_to(cible)

    etat = await SallesController(reglages, FauxSysteme()).etat()

    assert etat[1].dernier_jeu is None


async def test_un_jeu_retenu_trop_gros_n_est_pas_lu(reglages: Settings) -> None:
    bibliotheque(reglages, MELEE)
    retenir(reglages, 2, "Melee.rvz" + " " * 10_000)

    etat = await SallesController(reglages, FauxSysteme()).etat()

    assert etat[1].dernier_jeu is None


async def test_une_salle_revenue_sur_son_menu_garde_son_dernier_jeu(reglages: Settings) -> None:
    """Le marqueur « sans jeu » ne change pas le dernier jeu, et la salle allumée
    sur son menu ne joue rien."""
    bibliotheque(reglages, MELEE)
    retenir(reglages, 1, "Melee.rvz")
    (reglages.salles_dir / "1" / "game-closed").touch()

    def menu(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"current": None, "players": 4, "roms": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(menu)) as client:
        etat = await SallesController(reglages, FauxSysteme(allumees=[1]), client=client).etat()

    assert etat[0].jeu is None
    assert etat[0].dernier_jeu is not None
    assert etat[0].dernier_jeu.titre == "Super Smash Bros Melee"


async def test_une_salle_qui_redemarre_dit_le_jeu_qui_revient(reglages: Settings) -> None:
    """Pendant les deux secondes d'une relance, l'accueil disait la salle sans
    jeu. Le worker a écrit le jeu et retiré le marqueur avant de sortir."""
    bibliotheque(reglages, MELEE, MARIO)
    retenir(reglages, 1, "Mario Tennis Aces.xci")

    etat = await SallesController(reglages, FauxSysteme(relancees=[1])).etat()

    assert etat[0].redemarre is True
    assert (etat[0].jeu, etat[0].cle, etat[0].console) == (
        "Mario Tennis Aces",
        "Mario Tennis Aces.xci",
        "switch",
    )
    assert etat[0].switch is True, "la place Switch est déjà prise par ce jeu"
    assert etat[0].repond is None, "on n'a rien demandé à une salle qui redémarre"


async def test_une_salle_qui_redemarre_sur_son_menu_ne_dit_pas_de_jeu(reglages: Settings) -> None:
    """Le jumeau: marqueur posé, elle revient sur son menu."""
    bibliotheque(reglages, MELEE)
    retenir(reglages, 1, "Melee.rvz")
    (reglages.salles_dir / "1" / "game-closed").touch()

    etat = await SallesController(reglages, FauxSysteme(relancees=[1])).etat()

    assert (etat[0].jeu, etat[0].switch) == (None, False)
    assert etat[0].dernier_jeu is not None


async def test_le_marqueur_en_lien_ne_dit_pas_de_jeu_qui_revient(
    reglages: Settings, tmp_path: Path
) -> None:
    """Un lien à la place du marqueur: le worker le suit, le salon non. On ne
    sait pas si la salle revient sur un jeu, donc on ne le dit pas."""
    bibliotheque(reglages, MELEE)
    retenir(reglages, 1, "Melee.rvz")
    (reglages.salles_dir / "1" / "game-closed").symlink_to(tmp_path / "rien")

    etat = await SallesController(reglages, FauxSysteme(relancees=[1])).etat()

    assert etat[0].jeu is None


async def test_la_liste_dit_la_console_et_la_cle_du_jeu_qui_tourne(reglages: Settings) -> None:
    """K19: l'accueil dessine une cartouche ou une boîte selon la console."""

    def joue(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "current": 0,
                "players": 4,
                "roms": [{"name": "Melee", "console": "gc", "key": "Melee.rvz"}],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(joue)) as client:
        etat = await SallesController(reglages, FauxSysteme(allumees=[1]), client=client).etat()

    assert (etat[0].cle, etat[0].console) == ("Melee.rvz", "gc")


async def test_une_console_inconnue_ou_une_cle_en_chemin_ne_se_publient_pas(
    reglages: Settings,
) -> None:
    """Le jumeau: « ? » n'est pas une console, et `../x` n'est pas une clé."""

    def joue(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"current": 0, "roms": [{"name": "Muet", "console": "?", "key": "../x"}]},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(joue)) as client:
        etat = await SallesController(reglages, FauxSysteme(allumees=[1]), client=client).etat()

    assert (etat[0].jeu, etat[0].cle, etat[0].console) == ("Muet", None, None)


async def test_qui_a_lance_n_est_jamais_lu(reglages: Settings) -> None:
    """`chosen-person` est une adresse: rien de la liste n'en porte."""
    bibliotheque(reglages, MELEE)
    retenir(reglages, 1, "Melee.rvz")
    (reglages.salles_dir / "1" / "chosen-person").write_text("alice@example.com")

    etat = await SallesController(reglages, FauxSysteme(relancees=[1])).etat()

    assert "alice" not in json.dumps([salle.model_dump(mode="json") for salle in etat])
