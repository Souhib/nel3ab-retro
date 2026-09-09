"""Une connexion ouverte ne prouve pas qu'une personne peut répondre."""

from pathlib import Path

import pytest

from nel3ab_control.api.controllers.people import PeopleController


def test_a_spectator_can_pass_the_room_without_disconnect(tmp_path: Path) -> None:
    people = PeopleController(tmp_path / "people.json")
    people.arrived("old", "lu", "Lu")
    people.arrived("new", "souhib", "Souhib")
    assert people.owner() == ("lu", "Lu")
    assert people.transfer_owner("lu", "souhib")
    assert people.owner() == ("souhib", "Souhib")
    # Un autre onglet de l'ancien chef ne lui rend pas le rôle.
    people.arrived("old-again", "lu", "Lu")
    people.left("old")
    assert people.owner() == ("souhib", "Souhib")
    people.left("new")
    assert people.owner() == ("lu", "Lu")


@pytest.mark.parametrize("expected, wanted", [("other", "souhib"), ("lu", "absent")])
def test_a_stale_or_absent_successor_cannot_take_the_room(
    tmp_path: Path, expected: str, wanted: str
) -> None:
    people = PeopleController(tmp_path / "people.json")
    people.arrived("old", "lu", "Lu")
    people.arrived("new", "souhib", "Souhib")
    assert not people.transfer_owner(expected, wanted)
    assert people.owner() == ("lu", "Lu")
