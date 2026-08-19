"""Ce que le salon accepte de lire dans un message, avant d'en faire quoi que ce soit.

Ici plutôt qu'à travers une socket, parce que ce sont des fonctions pures: les
faire tourner par un vrai serveur ajouterait une seconde par cas et n'ajouterait
aucune information.
"""

from nel3ab_control.api.ws.handlers import ROOM_EVERY, VITALS_EVERY, _port, too_soon


def test_a_port_is_one_of_the_four_seats() -> None:
    assert [_port({"port": n}) for n in (1, 2, 3, 4)] == [1, 2, 3, 4]
    # Une chaîne qui contient un nombre reste un nombre: ce qui arrive d'une
    # page traverse du JSON, et une page peut envoyer "2".
    assert _port({"port": "2"}) == 2


def test_anything_that_is_not_one_of_the_four_seats_is_nothing() -> None:
    """Le jumeau négatif, et il n'était tenu par rien jusqu'au 19 août 2026.

    J'ai supprimé la plage `1 <= port <= 4` et toute la suite est restée verte,
    alors que cette plage est la seule chose qui empêche une page de retenir une
    manette inventée.
    """
    for wrong in ({}, {"port": 0}, {"port": -1}, {"port": 5}, {"port": 2**40}):
        assert _port(wrong) is None, wrong
    # Et ce qui n'est pas un nombre du tout, ce qui levait une `TypeError`
    # quand `seat` appelait `int()` en direct.
    for wrong in ({"port": "trois"}, {"port": None}, {"port": {"a": 1}}, {"port": [1]}):
        assert _port(wrong) is None, wrong


def test_the_first_message_of_a_page_is_never_too_soon() -> None:
    """Une page qui vient d'arriver doit pouvoir parler tout de suite: c'est la
    fenêtre où les problèmes de liaison se voient le mieux."""
    assert too_soon(None, 1000.0, ROOM_EVERY) is False


def test_a_second_message_inside_the_gap_is_refused_and_after_it_is_not() -> None:
    assert too_soon(1000.0, 1000.0 + ROOM_EVERY / 2, ROOM_EVERY) is True
    assert too_soon(1000.0, 1000.0 + ROOM_EVERY, ROOM_EVERY) is False


def test_the_room_gap_is_shorter_than_the_measurement_gap() -> None:
    """Les deux ne protègent pas la même chose et ne doivent pas se confondre.

    Un geste de salle est humain et rare, mais on ne veut pas qu'attendre gêne
    quelqu'un qui prend une manette. Un relevé arrive tout seul six fois par
    minute, donc il peut attendre bien plus longtemps.
    """
    assert 0 < ROOM_EVERY < VITALS_EVERY
