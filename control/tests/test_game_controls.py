"""Les fiches distinguent le jeu vérifié d'une autre console ou d'un mod."""

from nel3ab_control.api.schemas.room import GameGuide
from nel3ab_control.game_controls import GC_GUIDES, GUIDES, guide_for


def test_cards_match_console_and_exact_title():
    kart = guide_for("Mario Kart Wii", "wii")
    assert kart is not None
    assert kart["players"] == 4
    assert kart["allowed"] == [1, 0]
    assert guide_for("Mario Kart Wii", "gc") is None
    assert guide_for("Mario Kart Wii MOD", "wii") is None
    assert guide_for("Unknown", "wii") is None
    seven = guide_for("Mario Party 7", "gc")
    assert seven is not None
    assert seven["players"] == 8
    assert "quatre joueurs" in seven["multiplayer"]
    assert guide_for("Mario Party 7", "wii") is None


def test_verified_cards_have_sources_and_unknown_controls_stay_unknown():
    for raw in [*GUIDES.values(), *GC_GUIDES.values()]:
        card = GameGuide.model_validate(raw)
        if card.checked is not None:
            assert card.source.startswith("https://")
            assert card.players is not None
        else:
            assert card.players is None
    party = guide_for("Mario Party 8", "wii")
    assert party is not None
    assert party["actions"] == {}
    assert "mini-jeu" in party["note"]


def test_switch_card_never_applies_to_dolphin():
    card = guide_for("Mario Tennis Aces", "switch")
    assert card is not None
    assert GameGuide.model_validate(card).allowed == [4]
    assert guide_for("Mario Tennis Aces", "wii") is None
    assert guide_for("Mario Tennis Aces", "gc") is None
    assert guide_for("Mario Kart Wii", "switch") is None
