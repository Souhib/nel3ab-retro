"""Un contrôleur par salle, et chacun pointé sur la sienne."""

import httpx
import pytest

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.controllers.salles import SalleInconnue
from nel3ab_control.api.controllers.salons import Salons
from nel3ab_control.settings import Settings


@pytest.fixture
def salons() -> Salons:
    # Des adresses volontairement injoignables: ces essais regardent le CHOIX de
    # l'adresse, jamais ce qui se trouve au bout.
    reglages = Settings(worker_url="http://jamais.utilise", worker_control="0.0.0.0:1")
    return Salons(reglages, httpx.AsyncClient())


def test_chaque_salle_est_pointee_sur_son_propre_worker(salons: Salons) -> None:
    une = salons.pour(1)
    deux = salons.pour(2)

    assert une.settings.worker_url == "http://127.0.0.1:8110"
    assert une.settings.worker_control == "127.0.0.1:8111"
    assert deux.settings.worker_url == "http://127.0.0.1:8120"
    assert deux.settings.worker_control == "127.0.0.1:8121"


def test_la_meme_salle_rend_le_meme_controleur(salons: Salons) -> None:
    """Le jumeau qui compte: un contrôleur neuf oublierait qui tient quelle
    manette, donc chaque page ferait repartir les places de zéro."""
    assert salons.pour(1) is salons.pour(1)
    assert salons.pour(1) is not salons.pour(2)


def test_une_salle_qui_n_existe_pas_est_refusee(salons: Salons) -> None:
    with pytest.raises(SalleInconnue):
        salons.pour(7)


def test_seules_les_salles_deja_demandees_sont_eveillees(salons: Salons) -> None:
    """Fabriquer un contrôleur pour une salle que personne n'a ouverte ferait
    interroger un worker inexistant une fois par seconde, pour rien."""
    assert salons.eveilles() == []

    salons.pour(2)

    assert [numero for numero, _ in salons.eveilles()] == [2]


def test_un_controleur_pose_est_celui_qu_on_retrouve(salons: Salons) -> None:
    """Sans ce point d'entrée, un essai pose son contrôleur à côté du registre,
    le salon en fabrique un autre, et les deux regardent des salles
    différentes sans que rien ne le dise."""
    depuis_le_registre = salons.pour(3)
    autre = RoomController(Settings(), httpx.AsyncClient())

    salons.poser(3, autre)

    assert salons.pour(3) is autre
    assert salons.pour(3) is not depuis_le_registre


def test_on_ne_pose_rien_dans_une_salle_qui_n_existe_pas(salons: Salons) -> None:
    with pytest.raises(SalleInconnue):
        salons.poser(9, RoomController(Settings(), httpx.AsyncClient()))
