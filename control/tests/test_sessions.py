"""La bande des deux minutes, et ce qu'elle doit rendre visible.

Une bande qui n'afficherait que des points est une bande qui rassure sans rien
dire. Les tests ci-dessous la nourrissent de dégâts et vérifient qu'ils se
voient, à la bonne seconde.

Ici plutôt que dans un pilote, parce que produire une vraie saccade demande de
maltraiter une vraie machine, et que ce qu'on vérifie est un rendu, pas une
mesure. Le pilote, lui, prouve que la trace arrive; celui-ci prouve qu'on la lit.
"""

from sessions import BAND, _band, _lost, _state, _worker_said, _worried

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


#: Une tranche de dix secondes parfaitement saine, telle que le worker l'écrit.
WELL = {
    "frames": 600,
    "watchers": 1,
    "half_watchers": 0,
    "dropped": 0,
    "half_dropped": 0,
    "dropped_now": 0,
    "half_dropped_now": 0,
    "waiting_max_ms": 16.0,
    "encoding_p95_ms": 1.8,
    "megabits_per_second": 8.4,
}


def test_a_healthy_slice_of_the_worker_says_nothing() -> None:
    """Sinon la section fait huit mille six cents lignes par jour."""
    assert _worried(WELL, None) is None


def test_frames_dropped_toward_the_reduced_stream_are_named_as_such() -> None:
    """Les deux flux séparément, parce que c'est toute la question.

    Quelqu'un passe en format réduit précisément quand sa liaison va mal. Si ses
    pertes tombent dans le même seau que celles des autres, la ligne ne peut plus
    dire vers QUI le worker a dû jeter des images.
    """
    said = _worried({**WELL, "half_dropped_now": 12}, None)

    assert said is not None
    assert "0 jetées en grand format, 12 en réduit" in said


def test_a_total_is_turned_into_what_this_slice_lost() -> None:
    """Les lignes d'avant le 17 août 2026 ne donnaient que des totaux.

    Et un total se lit mal: après une mauvaise minute, « 439 jetées » se
    répétait sur toutes les lignes suivantes et une soirée entière avait l'air
    cassée.
    """
    old = {key: value for key, value in WELL.items() if not key.endswith("_now")}

    assert _lost({**old, "dropped": 439}, {**old, "dropped": 271}) == (168, 0)


def test_a_worker_that_restarted_never_reports_a_negative_loss() -> None:
    """Le jumeau, et ce n'est pas de la prudence: le worker redémarre à chaque
    changement de jeu, donc ses compteurs repartent de zéro."""
    old = {key: value for key, value in WELL.items() if not key.endswith("_now")}

    assert _lost({**old, "dropped": 3}, {**old, "dropped": 439}) == (0, 0)


def test_a_slice_that_cannot_say_what_it_lost_says_nothing_rather_than_zero() -> None:
    """Ni champ, ni ligne précédente: on ne sait pas.

    Annoncer zéro serait annoncer une mesure là où il n'y en a pas, ce qui est
    exactement la faute que cette section a déjà commise deux fois.
    """
    old = {key: value for key, value in WELL.items() if not key.endswith("_now")}

    assert _lost(old, None) is None
    assert _worried({**old, "waiting_max_ms": 16.0}, None) is None


def test_a_slice_from_before_the_audience_was_counted_says_so() -> None:
    """« Personne ne regardait » sur une tranche qui a jeté quatre cents images
    est une contradiction qu'on croit avant de la comprendre.

    Le worker ne comptait pas son public avant le 17 août 2026, et un champ
    absent affiché comme un zéro est la même faute que l'ancre publiée comme un
    retard.
    """
    old = {key: value for key, value in WELL.items() if key != "watchers"}

    assert "non mesuré" in _worker_said(old)
    assert "1 en grand, 0 en réduit" in _worker_said(WELL)
    assert "personne ne regardait" in _worker_said({**WELL, "watchers": 0})


def test_a_stalled_emulator_and_a_slow_encoder_do_not_read_the_same() -> None:
    """Les deux ne s'attaquent pas au même endroit.

    Une attente longue veut dire que l'émulateur lui-même a hoqueté, et personne
    n'y peut rien côté réseau. Un encodage lent veut dire que le retard part de
    la carte. Les confondre enverrait chercher au mauvais endroit.
    """
    stalled = _worried({**WELL, "waiting_max_ms": 124.0}, None)
    slow = _worried({**WELL, "encoding_p95_ms": 12.0}, None)

    assert stalled is not None and "l'émulateur" in stalled
    assert slow is not None and "encodage lent" in slow


def test_the_command_latency_shows_only_when_somebody_pressed_something() -> None:
    """Zéro échantillon veut dire « personne n'a appuyé », pas « zéro milliseconde ».

    Sur trente heures de journal, 5 936 tranches sur 10 694 annonçaient
    « 0.0 ms » comme s'il s'agissait d'un résultat. C'est le quatrième défaut de
    cette forme trouvé cette semaine, et le lecteur ne doit pas le refaire.
    """
    quiet = _worker_said({**WELL, "input_to_frame_samples": 0, "input_to_frame_p50_ms": 0.0})
    played = _worker_said({**WELL, "input_to_frame_samples": 431, "input_to_frame_p50_ms": 0.53})

    assert "commandes" not in quiet
    assert "commandes 0.5 ms" in played
