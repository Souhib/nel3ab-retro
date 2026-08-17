"""La bande des deux minutes, et ce qu'elle doit rendre visible.

Une bande qui n'afficherait que des points est une bande qui rassure sans rien
dire. Les tests ci-dessous la nourrissent de dégâts et vérifient qu'ils se
voient, à la bonne seconde.

Ici plutôt que dans un pilote, parce que produire une vraie saccade demande de
maltraiter une vraie machine, et que ce qu'on vérifie est un rendu, pas une
mesure. Le pilote, lui, prouve que la trace arrive; celui-ci prouve qu'on la lit.
"""

from sessions import BAND, _band, _state

COLUMNS = ["s", "peintes", "vues", "jetées", "affamées", "encours", "horaire", "gigue"]


def trail(*rows: list[int]) -> dict:
    return {"colonnes": COLUMNS, "lignes": list(rows)}


def healthy(when: int) -> list[int]:
    return [when, 60, 60, 0, 0, 2, 9, 6]


def strip(said: list[str]) -> str:
    """La bande seule, sans son étiquette."""
    return said[0].split(": ", 1)[1]


def test_two_healthy_minutes_are_two_minutes_of_dots() -> None:
    said = _band(trail(*[healthy(when) for when in range(-BAND, 1)]))

    assert strip(said) == "." * (BAND + 1)
    assert "0 jetées" in said[2]


def test_a_second_that_dropped_frames_shows_where_it_dropped_them() -> None:
    """Le point de tout l'exercice: la FORME du problème, à la seconde près."""
    rows = [healthy(when) for when in range(-BAND, 1)]
    rows[BAND - 14] = [-14, 41, 60, 19, 0, 8, 96, 71]

    said = _band(trail(*rows))

    assert strip(said)[BAND - 14] == ":"
    assert strip(said).count(":") == 1
    assert "19 jetées" in said[2]
    assert "pire seconde: -14 s" in said[3]


def test_an_empty_queue_shouts_louder_than_a_dropped_frame() -> None:
    """Les deux ne disent pas la même chose et ne doivent pas se confondre.

    Une image jetée veut dire que la file a débordé, donc qu'il en arrivait trop
    à la fois. Une file VIDE veut dire qu'il n'en arrivait plus du tout: c'est la
    liaison qui a lâché, et pas l'horaire d'affichage qui a mal choisi.
    """
    rows = [healthy(when) for when in range(-BAND, 1)]
    rows[BAND - 30] = [-30, 0, 0, 0, 3, 0, 180, 210]
    rows[BAND - 29] = [-29, 12, 60, 4, 0, 8, 180, 190]

    said = _band(trail(*rows))

    assert strip(said)[BAND - 30] == "!"
    assert strip(said)[BAND - 29] == ":"
    # La file vide l'emporte sur les images jetées quand on nomme la pire.
    assert "pire seconde: -30 s" in said[3]


def test_seconds_nobody_measured_stay_blank() -> None:
    """Le cas de l'onglet passé en arrière-plan.

    Le navigateur y ralentit les minuteurs à une fois par minute. Les secondes
    manquantes doivent laisser un TROU: une bande pleine tracée avec trois lignes
    prétendrait avoir regardé deux minutes qu'elle n'a pas vues.
    """
    said = _band(trail(healthy(-120), healthy(-60), healthy(0)))

    drawn = strip(said)
    assert drawn[0] == "." and drawn[60] == "." and drawn[BAND] == "."
    assert drawn.count(" ") == BAND - 2
    assert "sur ces 3 secondes" in said[2]


def test_a_complaint_with_no_trail_says_nothing_rather_than_lying() -> None:
    """Une vieille page, ou un signalement arrivé avant la première seconde.

    Le jumeau des tests d'au-dessus: sans lui, une bande qui rendrait toujours
    des espaces les satisferait tous en n'ayant jamais rien lu.
    """
    assert _band({}) == []
    assert _band({"colonnes": COLUMNS, "lignes": []}) == []


def test_the_headline_of_a_complaint_carries_gauges_and_not_counters() -> None:
    """Un signalement tombe où la personne clique, donc au milieu d'une fenêtre.

    Un clic arrivé juste après une remise à zéro affichait « 0/0 peintes » sur
    une séance parfaitement normale, ce qui se lit comme une panne totale. Les
    jauges, elles, sont vraies quelle que soit la fenêtre.
    """
    said = _state({"vues": 0, "peintes": 0, "gigue": 47, "horaire": 180, "demi": True})

    assert "gigue 47 ms" in said
    assert "horaire 180 ms" in said
    assert "[réduit]" in said
    assert "peintes" not in said
