"""Une semaine de captures, et rien d'autre n'est effacé."""

from datetime import date
from pathlib import Path

from nel3ab_control.boite_noire.conservation import JOURS, balayer_captures

AUJOURDHUI = date(2026, 9, 14)


def test_une_semaine_est_gardee_et_le_huitieme_jour_part(tmp_path: Path) -> None:
    for nom in ("2026-09-07T21-40-00-salle1", "2026-09-08T00-33-12-salle1", "2026-09-14T00-35-00"):
        (tmp_path / nom).mkdir()
        (tmp_path / nom / "perf.data").write_bytes(b"x")

    effaces = balayer_captures(tmp_path, JOURS, AUJOURDHUI)

    assert [chemin.name for chemin in effaces] == ["2026-09-07T21-40-00-salle1"]
    assert sorted(chemin.name for chemin in tmp_path.iterdir()) == [
        "2026-09-08T00-33-12-salle1",
        "2026-09-14T00-35-00",
    ]


def test_ce_qui_n_est_pas_une_capture_datee_reste(tmp_path: Path) -> None:
    """Le jumeau: une règle d'effacement qui devine finit par manger autre chose."""
    (tmp_path / "notes").mkdir()
    (tmp_path / "2020-01-01.txt").write_text("posé à la main")
    vieux = tmp_path / "2020-01-01T00-00-00"
    vieux.mkdir()
    (tmp_path / "2020-01-02-lien").symlink_to(vieux)

    effaces = balayer_captures(tmp_path, JOURS, AUJOURDHUI)

    assert [chemin.name for chemin in effaces] == ["2020-01-01T00-00-00"]
    assert sorted(chemin.name for chemin in tmp_path.iterdir()) == [
        "2020-01-01.txt",
        "2020-01-02-lien",
        "notes",
    ]


def test_un_dossier_absent_ne_casse_rien(tmp_path: Path) -> None:
    assert balayer_captures(tmp_path / "absent", JOURS, AUJOURDHUI) == []
