"""Une connexion ouverte ne prouve pas qu'une personne peut répondre."""

from pathlib import Path

import pytest

from nel3ab_control.api.controllers.people import PeopleController


def test_a_spectator_can_pass_the_room_without_disconnect(tmp_path: Path) -> None:
    people = PeopleController(tmp_path / "people.json")
    people.arrived("old", "lu", "Lu")
    people.arrived("new", "souhib", "Souhib")
    assert people.owner(1) == ("lu", "Lu")
    assert people.transfer_owner(1, "lu", "souhib")
    assert people.owner(1) == ("souhib", "Souhib")
    # Un autre onglet de l'ancien chef ne lui rend pas le rôle.
    people.arrived("old-again", "lu", "Lu")
    people.left("old")
    assert people.owner(1) == ("souhib", "Souhib")
    people.left("new")
    assert people.owner(1) == ("lu", "Lu")


@pytest.mark.parametrize("expected, wanted", [("other", "souhib"), ("lu", "absent")])
def test_a_stale_or_absent_successor_cannot_take_the_room(
    tmp_path: Path, expected: str, wanted: str
) -> None:
    people = PeopleController(tmp_path / "people.json")
    people.arrived("old", "lu", "Lu")
    people.arrived("new", "souhib", "Souhib")
    assert not people.transfer_owner(1, expected, wanted)
    assert people.owner(1) == ("lu", "Lu")


def test_a_chief_handed_over_in_one_room_survives_the_other_room(tmp_path: Path) -> None:
    """Le chef retenu était une seule valeur pour toutes les salles.

    Décrire la salle 2 la remplaçait par le premier présent de la salle 2. La
    salle 1, décrite ensuite, ne retrouvait plus son chef retenu et revenait au
    premier arrivé: la reprise confirmée par Souhib était perdue dès que la salle
    d'à côté diffusait. Relevé par l'audit du 20 novembre 2026.
    """
    people = PeopleController(tmp_path / "people.json")
    people.arrived("lu", "lu", "Lu", 1)
    people.arrived("souhib", "souhib", "Souhib", 1)
    people.arrived("vincent", "vincent", "Vincent", 2)
    assert people.transfer_owner(1, "lu", "souhib")

    assert people.owner(2) == ("vincent", "Vincent")
    assert people.owner(1) == ("souhib", "Souhib")
    # Le chef qui part de la salle 2 n'élit personne dans la salle 1.
    people.left("vincent")
    assert people.owner(2) is None
    assert people.owner(1) == ("souhib", "Souhib")


def test_the_role_cannot_go_to_somebody_in_another_room(tmp_path: Path) -> None:
    """Le jumeau: le successeur doit être présent dans CETTE salle.

    Le contrôle de présence regardait toutes les salles: le chef de la salle 1
    pouvait être remplacé par quelqu'un qui n'y était même pas.
    """
    people = PeopleController(tmp_path / "people.json")
    people.arrived("lu", "lu", "Lu", 1)
    people.arrived("vincent", "vincent", "Vincent", 2)

    assert not people.transfer_owner(1, "lu", "vincent")
    assert people.owner(1) == ("lu", "Lu")
    assert people.owner(2) == ("vincent", "Vincent")
