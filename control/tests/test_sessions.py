"""La bande des deux minutes, et ce qu'elle doit rendre visible.

Une bande qui n'afficherait que des points est une bande qui rassure sans rien
dire. Les tests ci-dessous la nourrissent de dégâts et vérifient qu'ils se
voient, à la bonne seconde.

Ici plutôt que dans un pilote, parce que produire une vraie saccade demande de
maltraiter une vraie machine, et que ce qu'on vérifie est un rendu, pas une
mesure. Le pilote, lui, prouve que la trace arrive; celui-ci prouve qu'on la lit.
"""

import json
import re
from pathlib import Path
from zoneinfo import ZoneInfo

from sessions import (
    BAND,
    EXTERNE,
    TRANCHE,
    _band,
    _externe_said,
    _externe_tranche,
    _externe_worried,
    _lost,
    _parse_worker,
    _state,
    _tamed,
    _worker_said,
    _worried,
)

#: Le code du worker, d'où la liste des mesures publiées est lue.
WORKER = Path(__file__).resolve().parents[2] / "core" / "crates" / "worker" / "src" / "main.rs"


def published(message: str = "streaming") -> set[str]:
    """Les champs d'une ligne de dix secondes, lus dans le code du worker.

    Lus plutôt que recopiés: une copie serait une deuxième définition à tenir
    d'accord avec la première, et c'est exactement la paire qui a divergé.
    L'indentation est celle du premier champ du bloc: la ligne « streaming »
    vit dans une boucle, celle de la salle externe dans sa propre fonction.
    """
    assert WORKER.is_file(), f"le code du worker est introuvable en {WORKER}"
    rust = WORKER.read_text(encoding="utf-8")
    at = rust.index(f'"{message}"')
    block = rust[rust.rindex("tracing::info!(", 0, at) : at]
    indent = re.match(r"tracing::info!\(\n(\s+)", block)
    assert indent is not None, f"le bloc de {message!r} n'a pas la forme attendue"
    found = set(re.findall(rf"^{indent.group(1)}(\w+)\s*[=,]", block, re.M))
    assert len(found) > 20, f"la lecture du code du worker n'a trouvé que {found}"
    return found


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


def test_a_terminal_escape_never_reaches_the_terminal() -> None:
    """Le journal garde ce qui est arrivé; l'affichage, lui, doit être sûr.

    Vérifié sur la machine le 19 août 2026: un relevé dont un champ valait
    `\x1b[2J\x1b[1;1H` faisait effacer l'écran de qui lisait le journal, et un
    pseudo de vingt caractères suffisait à changer le titre de la fenêtre.
    """
    dirty = {
        "pseudo": "\x1b]0;pwned\x07",
        "vu": {"gigue": "\x1b[2J\x1b[1;1H", "peintes": "\r EFFACE"},
        "notes": ["ligne\nfabriquée"],
    }

    clean = _tamed(dirty)

    assert clean["pseudo"] == ".]0;pwned."
    assert clean["vu"]["gigue"] == ".[2J.[1;1H"
    assert clean["vu"]["peintes"] == ". EFFACE"
    # Un saut de ligne dans une donnée fabriquerait une ligne d'affichage qui
    # n'existe pas.
    assert clean["notes"] == ["ligne.fabriquée"]


def test_what_is_not_a_control_character_is_left_exactly_alone() -> None:
    """Le jumeau. Un nettoyage qui remplacerait tout satisferait le test
    au-dessus en rendant le journal illisible."""
    kept = {
        "pseudo": "Souhib",
        "vu": {"gigue": 47, "demi": True},
        "jeu": "Mario Kart : Double Dash",
    }

    assert _tamed(kept) == kept


def test_every_measurement_the_worker_publishes_can_be_read() -> None:
    """La règle que la page a depuis le premier audit, et que le worker n'avait pas.

    `front/audit-readouts.mjs` refuse qu'une valeur soit calculée par la page
    sans être affichée quelque part. Le worker, qui produit bien plus de
    chiffres, n'avait aucun garde: mesuré le 19 août 2026, il publiait trente
    mesures toutes les dix secondes et le lecteur en montrait douze.

    Ce n'est pas une question de propreté. `waiting_p99_ms` était publié depuis
    des semaines, et il aurait montré tout seul que les siestes polluaient
    `waiting_max_ms`. La mesure était écrite, et personne ne la regardait.
    """
    missing = published() - set(TRANCHE)

    assert not missing, (
        f"le worker publie {sorted(missing)} et le lecteur ne sait pas les dire. "
        "Ajoute-les à TRANCHE, ou retire-les du worker."
    )


def test_the_reader_does_not_claim_measurements_the_worker_never_sends() -> None:
    """Le jumeau. Sans lui, un tableau qui listerait cent champs imaginaires
    satisferait le test au-dessus sans rien prouver."""
    invented = set(TRANCHE) - published()

    assert not invented, f"le lecteur annonce {sorted(invented)}, que le worker n'envoie pas"


def test_a_slice_where_the_room_slept_says_so() -> None:
    """Sinon la soirée a un trou que personne n'explique.

    Le worker retranche déjà la sieste de l'attente, donc elle n'est plus prise
    pour une panne de l'émulateur. Restait l'autre lecture fausse: dix minutes
    sans images et rien qui dise pourquoi.
    """
    said = _worker_said({**WELL, "slept_ms": 720_000})

    assert "la salle a dormi 12 min" in said


def test_a_slice_from_before_naps_were_measured_does_not_claim_the_room_stayed_awake() -> None:
    """Le jumeau, et c'est la faute que ce projet a déjà commise quatre fois:
    un champ absent affiché comme un zéro."""
    old = {key: value for key, value in WELL.items() if key != "slept_ms"}

    assert "dormi" not in _worker_said(old)
    assert "dormi" not in _worker_said({**WELL, "slept_ms": 0})


#: Une ligne « salle externe » saine, telle que le worker l'écrit.
CALME = {
    "message": "salle externe",
    "console": "Switch",
    "full_packets": 600,
    "full_gap_max_ms": 18.2,
    "full_age_p95_ms": 9.0,
    "watchers": 1,
    "half_watchers": 0,
    "dropped_now": 0,
    "half_dropped_now": 0,
    "sound_refused_now": 0,
    "wait_max_ms": 1.2,
    "write_max_ms": 0.4,
    "pad_gaps_over_50_ms": 0,
    "viewers": "[]",
    "seats": "[]",
}


def test_every_measurement_of_the_external_room_can_be_read() -> None:
    """La règle de la ligne « streaming », pour la ligne de la salle externe.

    Née le 27 novembre 2026 (audit WK-1): une salle Switch ne publiait aucune
    mesure du worker, et une ligne qui en publie cinquante sans lecteur ne vaut
    guère mieux.
    """
    missing = published("salle externe") - set(EXTERNE)

    assert not missing, f"le worker publie {sorted(missing)} et le lecteur ne sait pas les dire"


def test_the_reader_claims_no_external_measurement_the_worker_never_sends() -> None:
    """Le jumeau, pour la même raison que celui de la ligne « streaming »."""
    invented = set(EXTERNE) - published("salle externe")

    assert not invented, f"le lecteur annonce {sorted(invented)}, que le worker n'envoie pas"


def test_a_quiet_external_window_says_nothing_and_each_stage_is_named() -> None:
    """Chaque étage a son mot: l'entrée, la file, l'écriture, les manettes, le son.

    C'est ce qui dira où naissent les 117 ms que la page voyait dans chaque
    fenêtre le 26 novembre 2026, quand la capture n'en montrait que 18.
    """
    assert _externe_worried(CALME, None) is None

    entree = _externe_worried({**CALME, "full_gap_max_ms": 210.0}, None)
    ecrit = _externe_worried({**CALME, "write_max_ms": 140.0}, None)
    file = _externe_worried({**CALME, "wait_max_ms": 120.0}, None)
    manettes = _externe_worried({**CALME, "pad_gaps_over_50_ms": 12, "pad_gap_max_ms": 131.0}, None)
    son = _externe_worried({**CALME, "sound_refused_now": 3}, None)
    jetees = _externe_worried({**CALME, "half_dropped_now": 4}, None)

    assert entree is not None and "210 ms" in entree and "entrée" in entree
    assert ecrit is not None and "écriture" in ecrit and "140 ms" in ecrit
    assert file is not None and "file" in file
    assert manettes is not None and "12 trous" in manettes and "131 ms" in manettes
    assert son is not None and "3 morceaux de son" in son
    assert jetees is not None and "4 en réduit" in jetees


def test_an_external_window_that_measured_nothing_claims_nothing() -> None:
    """Le jumeau: un champ absent n'est pas un zéro, ni une alerte, ni un calme.

    Le worker n'écrit pas une valeur que rien n'a mesurée. Une fenêtre sans
    image ne doit donc pas se lire « entrée max 0 ms ».
    """
    vide = {"message": "salle externe", "console": "Switch", "full_packets": 0}

    assert _externe_worried(vide, None) is None
    said = _externe_said(vide)
    assert "entrée" not in said
    assert "écriture" not in said
    assert "0 images" in said


def test_the_external_line_unfolds_each_viewer_and_each_seat() -> None:
    """Le détail de chaque spectateur et de chaque place, lu dans ses tableaux."""
    window = {
        **CALME,
        "viewers": '[{"viewer": 3, "stream": "plein", "frames": 600, "wait_p50_ms": 0.1,'
        ' "wait_p95_ms": 0.3, "wait_max_ms": 1.2, "write_p50_ms": 0.1,'
        ' "write_p95_ms": 0.2, "write_max_ms": 130.0}]',
        "seats": '[{"seat": 2, "frames": 2500, "over_17_ms": 40, "over_50_ms": 3,'
        ' "gap_max_ms": null, "sent": 2400, "repeated": 2350, "rescued": 2,'
        ' "deferred": 5}]',
    }

    said = "\n".join(_externe_tranche(window))

    assert "spectateur 3 (plein)" in said and "130.0 ms" in said
    assert "place 2" in said and "3 trous > 50 ms" in said
    # Un écart que rien n'a mesuré se dit, il ne s'écrit pas zéro.
    assert "écart max non mesuré" in said


def test_the_dolphin_and_the_external_lines_are_both_read() -> None:
    """« streaming » (Dolphin) et « salle externe » (la Switch, depuis le
    27 novembre 2026). Une ligne étrangère est écartée."""
    zone = ZoneInfo("Europe/Paris")
    raw = [
        _line("streaming", input_to_frame_samples=3),
        _line("salle externe", full_packets=600),
        _line("ce spectateur ne suit pas", viewer=3),
        "pas du json",
    ]

    kept = _parse_worker(raw, zone)

    assert [fields["message"] for _, fields in kept] == ["streaming", "salle externe"]


def _line(message: str, **fields: object) -> str:
    return "nel3ab-worker[1]: " + json.dumps(
        {"timestamp": "2026-11-26T23:35:20.388Z", "fields": {"message": message, **fields}}
    )
