"""Le lecteur `just boite-noire`, lancé comme la recette le lance.

Par `python boite_noire.py` dans un processus neuf, avec ses dossiers dans un
dossier temporaire: un essai en mémoire ne prouverait pas que la ligne de
commande arrive jusqu'au garde des noyaux.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

CONTROLE = Path(__file__).resolve().parents[2]


def _releves(dossier: Path, noyaux: list[str]) -> None:
    """Un relevé toutes les deux secondes à partir de 00:33:00, un noyau par minute."""
    lignes = []
    for minute, noyau in enumerate(noyaux):
        for seconde in range(0, 60, 2):
            lignes.append(
                {
                    "quand": f"2026-11-27T00:{33 + minute:02d}:{seconde:02d}+01:00",
                    "quoi": "relevé",
                    "noyau": noyau,
                    "moteurs": [{"pid": 1, "fils": [{"nom": "<MainThread>", "cpu_pct": 78.0}]}],
                }
            )
    dossier.mkdir(parents=True)
    (dossier / "2026-11-27.jsonl").write_text(
        "".join(json.dumps(ligne) + "\n" for ligne in lignes), encoding="utf-8"
    )


def _lancer(tmp_path: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "NEL3AB_BOITE_NOIRE_DIR": str(tmp_path / "bn"),
        "NEL3AB_JOURNAL_DIR": str(tmp_path / "sessions"),
        "NEL3AB_JOURNAL_ZONE": "Europe/Paris",
    }
    return subprocess.run(  # noqa: S603 - le lecteur du dépôt, arguments fixes
        [sys.executable, "boite_noire.py", *arguments],
        cwd=CONTROLE,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def test_deux_phases_du_meme_noyau_se_comparent(tmp_path: Path) -> None:
    _releves(tmp_path / "bn" / "releves", ["7.0.0-43-generic", "7.0.0-43-generic"])

    fini = _lancer(tmp_path, "2026-11-27", "--phases", "00:33-00:33:59,00:34-00:34:59")

    assert fini.returncode == 0, fini.stderr
    assert fini.stdout.count("7.0.0-43-generic") == 2, fini.stdout


def test_deux_phases_de_part_et_d_autre_d_un_redemarrage_sont_refusees(tmp_path: Path) -> None:
    """Le jumeau: la seconde minute a tourné sur le noyau installé le 26 novembre."""
    _releves(tmp_path / "bn" / "releves", ["7.0.0-43-generic", "7.0.0-44-generic"])

    fini = _lancer(tmp_path, "2026-11-27", "--phases", "00:33-00:33:59,00:34-00:34:59")

    assert fini.returncode == 2, fini.stdout
    assert "comparaison refusée" in fini.stderr
    assert "7.0.0-44-generic" in fini.stderr


def test_la_relecture_montre_le_temps_vole_et_les_voisins(tmp_path: Path) -> None:
    dossier = tmp_path / "bn" / "releves"
    dossier.mkdir(parents=True)
    neuf = {
        "quand": "2026-11-27T00:36:05+01:00",
        "quoi": "relevé",
        "moteurs": [
            {"pid": 1, "fils": [{"nom": "<MainThread>", "cpu_pct": 78, "file_ms_s": 25.0}]}
        ],
        "vmstat": {"compact_stall": 3, "allocstall_movable": 0},
        "voisins_gpu": {"kfd": [{"pid": 1234, "nom": "ollama"}], "jellyfin_ffmpeg": []},
    }
    ancien = {
        "quand": "2026-11-27T00:36:15+01:00",
        "quoi": "relevé",
        "moteurs": [{"pid": 1, "fils": [{"nom": "<MainThread>", "cpu_pct": 78}]}],
    }
    (dossier / "2026-11-27.jsonl").write_text(json.dumps(neuf) + "\n" + json.dumps(ancien) + "\n")

    fini = _lancer(tmp_path, "2026-11-27")

    assert fini.returncode == 0, fini.stderr
    neuve, vieille = [ligne for ligne in fini.stdout.splitlines() if ligne.startswith("00:36")]
    assert "file 25.0 ms/s" in neuve and "compact   3" in neuve and "voisins 1" in neuve
    # Le jumeau: un relevé d'avant ces champs n'affiche ni zéro ni tiret inventé.
    assert "file" not in vieille and "compact" not in vieille and "voisins" not in vieille
