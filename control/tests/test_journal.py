"""Le journal des séances, et surtout ce qu'il refuse de faire.

Le défaut que ce module corrige n'était pas un bogue, c'était une absence: on a
demandé « retrouve la séance de 16 h 43 » et il n'y avait rien à lire. Les tests
qui suivent visent donc deux choses en même temps: que la trace existe, et
qu'elle ne puisse ni empêcher de jouer, ni effacer plus qu'elle ne doit.
"""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from nel3ab_control.journal import Journal

#: Une heure fixe, pour que les tests ne dépendent pas du jour où ils tournent.
#: Un test qui passe le lundi et échoue le dimanche est un test qu'on désactive.
WHEN = datetime(2026, 8, 17, 16, 43, 10)


def _lines(folder: Path) -> list[dict]:
    return [
        json.loads(line)
        for path in sorted(folder.glob("*.jsonl"))
        for line in path.read_text(encoding="utf-8").splitlines()
    ]


def test_an_event_carries_who_it_was(tmp_path: Path) -> None:
    """Le manque exact: une ligne doit dire QUI, pas seulement que ça a eu lieu.

    C'est la question à laquelle rien ne savait répondre le 16 août 2026.
    """
    journal = Journal(tmp_path)
    journal.write("arrivée", when=WHEN, visite="3f9a2c1b", login="kitaru@x", pseudo="Kitaru")
    journal.close()

    (line,) = _lines(tmp_path)
    assert line["quoi"] == "arrivée"
    assert line["visite"] == "3f9a2c1b"
    assert line["login"] == "kitaru@x"
    assert line["pseudo"] == "Kitaru"


def test_the_hour_is_written_the_way_it_is_remembered(tmp_path: Path) -> None:
    """« Vers 16 h 43 » doit se chercher tel quel, avec son décalage à côté.

    En UTC, cette séance-là s'écrirait 14:43 et ne se trouverait pas.
    """
    journal = Journal(tmp_path)
    journal.write("arrivée", when=WHEN, pseudo="Kitaru")
    journal.close()

    (line,) = _lines(tmp_path)
    assert line["quand"].startswith("2026-08-17T16:43:10")
    # Et le décalage de PARIS, pas celui de la machine. Cette assertion-là est
    # la seule qui aurait attrapé le vrai défaut: la première version écrivait
    # bien « 16:43 », suivi de « +00:00 », parce que le serveur tourne en UTC.
    assert line["quand"].endswith("+02:00")


def test_a_server_on_utc_still_writes_the_players_hour(tmp_path: Path) -> None:
    """Le défaut trouvé en faisant tourner le pilote, et pas en relisant le code.

    Cette machine est réglée sur UTC. Une séance de 16 h 43 pour ceux qui jouent
    s'y écrivait 14 h 43, donc la chercher à l'heure qu'on m'a donnée ne trouvait
    rien: le journal était complet et inutilisable en même temps.

    L'instant ci-dessous est celui-là, dit en UTC comme la machine le dirait.
    """
    utc = datetime(2026, 8, 17, 14, 43, 10, tzinfo=UTC)

    journal = Journal(tmp_path, zone="Europe/Paris")
    journal.write("arrivée", when=utc, pseudo="Kitaru")
    journal.close()

    (line,) = _lines(tmp_path)
    assert line["quand"].startswith("2026-08-17T16:43:10")


def test_somebody_who_never_renames_still_leaves_a_trace(tmp_path: Path) -> None:
    """Le jumeau négatif de l'ancien état des choses.

    `people.json` n'écrit que les changements de pseudo, donc quelqu'un qui garde
    le nom proposé n'y apparaît JAMAIS. C'est précisément ce qui s'est passé:
    une seule ligne dans ce fichier depuis le début du projet.
    """
    journal = Journal(tmp_path)
    journal.write("arrivée", when=WHEN, pseudo="Kitaru")
    journal.write("départ", when=WHEN, pseudo="Kitaru", secondes=612.0)
    journal.close()

    assert [line["quoi"] for line in _lines(tmp_path)] == ["arrivée", "départ"]


def test_a_line_says_who_else_was_there(tmp_path: Path) -> None:
    """L'état de la salle voyage AVEC l'événement.

    Sans ça, répondre à « qui d'autre jouait » demanderait de rejouer le fichier
    depuis le début en tenant les arrivées et les départs à la main.
    """
    journal = Journal(tmp_path)
    journal.write(
        "place",
        when=WHEN,
        pseudo="Kitaru",
        place=2,
        salle={"jeu": "Mario Party 4", "présents": 3, "places": {"1": "Souhib", "2": "Kitaru"}},
    )
    journal.close()

    (line,) = _lines(tmp_path)
    assert line["salle"]["jeu"] == "Mario Party 4"
    assert line["salle"]["places"]["1"] == "Souhib"


def test_a_new_day_opens_a_new_file(tmp_path: Path) -> None:
    journal = Journal(tmp_path)
    journal.write("arrivée", when=WHEN, pseudo="Kitaru")
    journal.write("arrivée", when=WHEN + timedelta(days=1), pseudo="Souhib")
    journal.close()

    assert sorted(path.name for path in tmp_path.glob("*.jsonl")) == [
        "2026-08-17.jsonl",
        "2026-08-18.jsonl",
    ]


def test_sweeping_keeps_the_window_and_drops_what_is_older(tmp_path: Path) -> None:
    """Deux jours veut dire aujourd'hui ET hier.

    Les deux moitiés comptent. Un balayage qui garde tout ne sert à rien; un
    balayage qui garde le seul jour courant efface la soirée qu'on vient
    justement de me demander de relire le lendemain.
    """
    for day in ("2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17"):
        (tmp_path / f"{day}.jsonl").write_text("{}\n", encoding="utf-8")

    gone = Journal(tmp_path, keeps=2).sweep(WHEN.date())

    assert [path.name for path in gone] == ["2026-08-14.jsonl", "2026-08-15.jsonl"]
    assert sorted(path.name for path in tmp_path.glob("*.jsonl")) == [
        "2026-08-16.jsonl",
        "2026-08-17.jsonl",
    ]


def test_sweeping_never_touches_what_it_cannot_read(tmp_path: Path) -> None:
    """Un fichier dont le nom n'est pas une date n'est pas à nous.

    Une règle d'effacement qui devine finit par manger autre chose, et ce dossier
    est sous le répertoire d'état de quelqu'un.
    """
    (tmp_path / "notes.jsonl").write_text("{}\n", encoding="utf-8")
    (tmp_path / "2026-08-01.jsonl").write_text("{}\n", encoding="utf-8")

    Journal(tmp_path, keeps=2).sweep(WHEN.date())

    assert (tmp_path / "notes.jsonl").exists()
    assert not (tmp_path / "2026-08-01.jsonl").exists()


def test_a_folder_it_cannot_write_does_not_stop_the_room(tmp_path: Path) -> None:
    """Un disque plein ne doit pas interrompre une partie.

    Et la perte doit se COMPTER: un journal muet qui se croit complet est pire
    que pas de journal, parce qu'on conclurait de son silence qu'il ne s'est rien
    passé.
    """
    blocked = tmp_path / "fichier"
    blocked.write_text("je ne suis pas un dossier", encoding="utf-8")

    journal = Journal(blocked / "sessions")
    journal.write("arrivée", when=WHEN, pseudo="Kitaru")

    assert journal.dropped == 1


def test_a_folder_it_can_write_drops_nothing(tmp_path: Path) -> None:
    """Le jumeau du précédent.

    Sans lui, un compteur bloqué à un satisferait l'autre test tout en déclarant
    une perte à chaque ligne réussie.
    """
    journal = Journal(tmp_path)
    journal.write("arrivée", when=WHEN, pseudo="Kitaru")
    journal.close()

    assert journal.dropped == 0
    assert len(_lines(tmp_path)) == 1
