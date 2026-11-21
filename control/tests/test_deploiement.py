"""Le contrôle qui précède un redémarrage du salon: l'interpréteur réel l'importe-t-il ?

Le 21 novembre 2026, le salon a échoué dix-huit démarrages: l'environnement
Python que lance réellement son unité (un ajout d'un autre projet) n'avait pas
la dépendance ajoutée le matin. `deploy/salon-importable.sh` lit la commande
effective et importe le salon avec. Ces essais lui donnent leur propre
commande, et ne touchent à aucun service.
"""

import os
import subprocess
import sys
import venv
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / "deploy/salon-importable.sh"


def verifier(python: str) -> subprocess.CompletedProcess[str]:
    commande = f"{{ path={python} ; argv[]={python} -m uvicorn x:y ; ignore_errors=no }}"
    return subprocess.run(  # noqa: S603 - bash et un script du dépôt, aucun texte du dehors
        ["/usr/bin/env", "bash", str(SCRIPT)],
        env={**os.environ, "NEL3AB_EXECSTART_ESSAI": commande},
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def test_l_interpreteur_des_essais_importe_le_salon_et_la_boite_noire() -> None:
    fini = verifier(sys.executable)

    assert fini.returncode == 0, fini.stdout + fini.stderr
    assert fini.stdout == ""


def test_un_environnement_sans_les_dependances_est_refuse(tmp_path: Path) -> None:
    """Le jumeau: c'est la panne du 21 novembre, un Python qui n'a pas tout."""
    vide = tmp_path / "vide"
    venv.create(vide, with_pip=False)

    fini = verifier(str(vide / "bin/python"))

    assert fini.returncode == 1
    assert "nel3ab-control ne s'importe pas" in fini.stdout
    assert "ModuleNotFoundError" in fini.stdout
    # La boîte noire ne lit que la bibliothèque standard: elle s'importe même là.
    assert "nel3ab-boite-noire" not in fini.stdout


def test_un_interpreteur_absent_est_refuse(tmp_path: Path) -> None:
    fini = verifier(str(tmp_path / "absent/bin/python"))

    assert fini.returncode == 1
    assert "interpréteur introuvable" in fini.stdout
