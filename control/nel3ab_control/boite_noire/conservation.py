"""Oublier ce qui a plus d'une semaine.

Une semaine, et pas deux: c'est Souhib qui l'a fixée le 14 septembre 2026, parce
qu'il revient vers moi le soir même ou le lendemain quand une partie s'est mal
passée. Les relevés quotidiens sont balayés par `Journal`, comme ceux du salon;
ce module balaie les dossiers de capture, qui sont des dossiers et non des lignes.
"""

import shutil
from datetime import date, timedelta
from pathlib import Path

#: Combien de jours on garde, relevés comme captures.
JOURS = 7


def balayer_captures(dossier: Path, jours: int, aujourdhui: date) -> list[Path]:
    """Efface les captures trop vieilles, et rend ce qui a été effacé.

    Ne touche QUE les dossiers dont le nom commence par une date: une règle
    d'effacement qui devine finit par manger autre chose, et ce dossier peut
    recevoir des fichiers posés à la main pendant une enquête.
    """
    plus_vieux_garde = aujourdhui - timedelta(days=max(1, jours) - 1)
    effaces: list[Path] = []
    try:
        trouves = sorted(dossier.iterdir())
    except OSError:
        return effaces
    for chemin in trouves:
        if not chemin.is_dir() or chemin.is_symlink():
            continue
        try:
            jour = date.fromisoformat(chemin.name[:10])
        except ValueError:
            continue
        if jour >= plus_vieux_garde:
            continue
        shutil.rmtree(chemin, ignore_errors=True)
        if not chemin.exists():
            effaces.append(chemin)
    return effaces
