"""Une préparation appartient aux attributions présentes, pas à quatre noms."""

import pytest

from nel3ab_control.api.controllers.preparation import Participant, Preparation


def waiting() -> Preparation:
    return Preparation(
        game=2,
        save=0,
        starter="one",
        allowed=[1, 0],
        players=[
            Participant(port=1, claim="one", name="Souhib"),
            Participant(port=2, claim="two", name="Yassine"),
        ],
    )


def test_each_player_can_choose_a_different_device() -> None:
    p = waiting()
    p.choose("one", 0, True)
    with pytest.raises(ValueError, match="Chaque joueur"):
        p.launch("one")
    p.choose("two", 1, True)
    assert p.launch("one") == [0, 1, 1, 1]
    with pytest.raises(ValueError, match="qui prépare"):
        p.launch("two")


def test_a_spectator_cannot_confirm_somebody_else() -> None:
    p = waiting()
    with pytest.raises(ValueError, match="Prends une manette"):
        p.choose("spectator", 0, True)
    assert not any(player.ready for player in p.players)


def test_an_incompatible_device_is_refused() -> None:
    p = waiting()
    with pytest.raises(ValueError, match="pas proposée"):
        p.choose("one", 2, True)
    assert p.players[0].pad is None
    p.choose("one", 1, True)
    assert p.players[0].ready


def test_returning_to_the_same_port_requires_a_new_confirmation() -> None:
    p = waiting()
    p.choose("one", 0, True)
    p.choose("two", 1, True)
    assert p.synchronise([(1, "one", "Souhib"), (2, "three", "Vincent")])
    assert p.players[0].ready
    assert not p.players[1].ready
    with pytest.raises(ValueError, match="Chaque joueur"):
        p.launch("one")
    assert not p.synchronise([(2, "three", "Vincent")])


def test_a_departed_player_no_longer_blocks_everybody() -> None:
    p = waiting()
    p.choose("one", 0, True)
    assert p.synchronise([(1, "one", "Souhib")])
    assert p.launch("one") == [0, 1, 1, 1]
    p.choose("one", 1, False)
    with pytest.raises(ValueError, match="Chaque joueur"):
        p.launch("one")


def test_switch_players_confirm_pro_controls_and_new_arrivals_must_test_again() -> None:
    pending = waiting()
    pending.allowed = [4]
    with pytest.raises(ValueError, match="pas proposée"):
        pending.choose("one", 0, True)
    pending.choose("one", 4, True)
    with pytest.raises(ValueError, match="Chaque joueur"):
        pending.launch("one")
    pending.choose("two", 4, True)
    assert pending.launch("one") == [4, 4, 4, 4]
    assert pending.synchronise([(1, "one", "Alice"), (2, "new", "Benoît")])
    assert not pending.players[1].ready
    with pytest.raises(ValueError, match="Chaque joueur"):
        pending.launch("one")
