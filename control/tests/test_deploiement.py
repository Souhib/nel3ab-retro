"""Le contrôle qui précède un redémarrage du salon: l'interpréteur réel l'importe-t-il ?

Le 21 novembre 2026, le salon a échoué dix-huit démarrages: l'environnement
Python que lance réellement son unité (un ajout d'un autre projet) n'avait pas
la dépendance ajoutée le matin. `deploy/salon-importable.sh` lit la commande
effective et importe le salon avec. Ces essais lui donnent leur propre
commande, et ne touchent à aucun service.
"""

import os
import shutil
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


# --- Les adaptateurs que les salles lancent vraiment -------------------------------
#
# `deploy/salles-adaptateurs.sh` lit l'Environment de chaque unité de salle: un
# ajout qui remplace l'adaptateur d'une console (le canari du socle) y est nommé,
# et rouge si le fichier visé n'existe plus. Il importe chaque enveloppe avec le
# python3 du PATH de l'unité. Ces essais lui donnent leurs propres réponses de
# systemd, et ne touchent à aucun service.

SALLES = Path(__file__).parents[2] / "deploy/salles-adaptateurs.sh"
DEPOT = Path(__file__).parents[2]
SYSTEME = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"


def salles(
    environnement: str, dossier: Path, gestionnaire: str = SYSTEME
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - bash et un script du dépôt, aucun texte du dehors
        ["/usr/bin/env", "bash", str(SALLES)],
        env={
            **os.environ,
            "NEL3AB_SALLES_ESSAI": "1",
            "NEL3AB_ENVIRONMENT_ESSAI": environnement,
            "NEL3AB_GESTIONNAIRE_ESSAI": gestionnaire,
            "NEL3AB_DOSSIER_ESSAI": str(dossier),
        },
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def unite(tmp_path: Path, *ajouts: str) -> str:
    """L'Environment d'une salle au format de `systemctl show`, valeur à espaces comprise."""
    return " ".join(
        [f"HOME={tmp_path}", "RUST_LOG=info", '"NEL3AB_ROM=/roms/gc/Super Smash.rvz"', *ajouts]
    )


def test_une_salle_sans_ajout_importe_les_trois_adaptateurs(tmp_path: Path) -> None:
    fini = salles(unite(tmp_path), tmp_path)

    assert fini.returncode == 0, fini.stdout + fini.stderr
    assert fini.stdout == ""


def test_un_adaptateur_remplace_est_nomme_sans_rougir(tmp_path: Path) -> None:
    canari = DEPOT / "docker/xbox360-room-socle.py"

    fini = salles(unite(tmp_path, f"NEL3AB_XBOX360_ADAPTER={canari}"), tmp_path)

    assert fini.returncode == 0, fini.stdout + fini.stderr
    assert fini.stdout == (
        f"  nel3ab-worker@1: NEL3AB_XBOX360_ADAPTER remplace l'adaptateur x360 par {canari}\n"
    )


def test_un_adaptateur_remplace_par_un_fichier_absent_est_rouge(tmp_path: Path) -> None:
    """Le jumeau: le canari retiré du dépôt alors qu'un ajout le vise encore."""
    absent = tmp_path / "xbox360-room-socle.py"

    fini = salles(unite(tmp_path, f"NEL3AB_XBOX360_ADAPTER={absent}"), tmp_path)

    assert fini.returncode == 1
    assert f"NEL3AB_XBOX360_ADAPTER vise un fichier absent ({absent})" in fini.stdout


def test_une_variable_qui_ne_remplace_aucune_console_est_rouge(tmp_path: Path) -> None:
    """Une faute de frappe: le propriétaire croirait le canari branché."""
    canari = DEPOT / "docker/xbox360-room-socle.py"

    fini = salles(unite(tmp_path, f"NEL3AB_XBOX_ADAPTER={canari}"), tmp_path)

    assert fini.returncode == 1
    assert "NEL3AB_XBOX_ADAPTER ne remplace l'adaptateur d'aucune console" in fini.stdout


def faux_python(dossier: Path) -> Path:
    """Un python3 qui ne sait rien importer, comme un environnement sans le socle."""
    dossier.mkdir()
    python = dossier / "python3"
    python.write_text("#!/bin/sh\necho 'ModuleNotFoundError: faux python3' >&2\nexit 1\n")
    python.chmod(0o755)
    return python


def test_le_python3_est_celui_du_path_de_l_unite(tmp_path: Path) -> None:
    python = faux_python(tmp_path / "bin")

    fini = salles(unite(tmp_path, f"PATH={python.parent}:/usr/bin"), tmp_path)

    assert fini.returncode == 1
    assert f"docker/xbox360-room.py ne s'importe pas avec {python}:" in fini.stdout
    assert "faux python3" in fini.stdout


def test_sans_path_dans_l_unite_c_est_celui_du_gestionnaire(tmp_path: Path) -> None:
    python = faux_python(tmp_path / "bin")

    fini = salles(unite(tmp_path), tmp_path, gestionnaire=f"LANG=C PATH={python.parent}")

    assert fini.returncode == 1
    assert f"ne s'importe pas avec {python}:" in fini.stdout


def test_aucun_python3_dans_le_path_de_l_unite_est_rouge(tmp_path: Path) -> None:
    (tmp_path / "vide").mkdir()

    fini = salles(unite(tmp_path, f"PATH={tmp_path / 'vide'}"), tmp_path)

    assert fini.returncode == 1
    assert "aucun python3 dans le PATH de l'unité" in fini.stdout


def test_une_enveloppe_qui_ne_s_importe_pas_est_rouge(tmp_path: Path) -> None:
    casse = tmp_path / "enveloppe.py"
    casse.write_text("from moteurs_absents.socle.salle import principal\n")

    fini = salles(unite(tmp_path, f"NEL3AB_SWITCH2_ADAPTER={casse}"), tmp_path)

    assert fini.returncode == 1
    assert f"{casse} ne s'importe pas" in fini.stdout
    assert "ModuleNotFoundError" in fini.stdout


def test_l_import_ne_lance_aucune_salle(tmp_path: Path) -> None:
    """Le haut du fichier s'exécute (il est bien importé), son `principal` jamais."""
    enveloppe = tmp_path / "enveloppe.py"
    enveloppe.write_text(
        "from pathlib import Path\n"
        f"Path({str(tmp_path / 'importe')!r}).touch()\n"
        "if __name__ == '__main__':\n"
        f"    Path({str(tmp_path / 'lance')!r}).touch()\n"
    )

    fini = salles(unite(tmp_path, f"NEL3AB_SWITCH_ADAPTER={enveloppe}"), tmp_path)

    assert fini.returncode == 0, fini.stdout + fini.stderr
    assert (tmp_path / "importe").exists()
    assert not (tmp_path / "lance").exists()


def copie_du_canari(cible: Path) -> Path:
    """Ce que le canari charge: le socle, les moteurs et son enveloppe, dans un faux dépôt."""
    shutil.copytree(
        DEPOT / "moteurs", cible / "moteurs", ignore=shutil.ignore_patterns("__pycache__")
    )
    (cible / "docker").mkdir()
    shutil.copy2(DEPOT / "docker/xbox360-room-socle.py", cible / "docker")
    return cible / "docker/xbox360-room-socle.py"


def test_un_canari_dont_le_module_du_moteur_ne_s_importe_pas_est_rouge(tmp_path: Path) -> None:
    """L'enveloppe s'importe seule: le module de Xenia et sa fiche ne sont chargés que
    par `principal`. Le 22 novembre 2026, un `import` manquant en tête du module
    passait deploy-check, alors que la salle branchée aurait échoué au démarrage."""
    canari = copie_du_canari(tmp_path / "depot")
    intact = salles(unite(tmp_path, f"NEL3AB_XBOX360_ADAPTER={canari}"), tmp_path)
    module = canari.parents[1] / "moteurs/xenia/adaptateur.py"
    texte = module.read_text(encoding="utf-8")
    futur = "from __future__ import annotations\n"
    assert texte.count(futur) == 1
    module.write_text(texte.replace(futur, futur + "import module_absent_xyz\n"), encoding="utf-8")

    fini = salles(unite(tmp_path, f"NEL3AB_XBOX360_ADAPTER={canari}"), tmp_path)

    # Le jumeau: la même copie, intacte, passe et nomme le remplacement.
    assert intact.returncode == 0, intact.stdout + intact.stderr
    assert fini.returncode == 1, fini.stdout
    assert f"{canari} ne s'importe pas" in fini.stdout
    assert "No module named 'module_absent_xyz'" in fini.stdout


def test_un_canari_dont_la_fiche_est_fausse_est_rouge(tmp_path: Path) -> None:
    canari = copie_du_canari(tmp_path / "depot")
    (canari.parents[1] / "moteurs/xenia/moteur.json").write_text("{}", encoding="utf-8")

    fini = salles(unite(tmp_path, f"NEL3AB_XBOX360_ADAPTER={canari}"), tmp_path)

    assert fini.returncode == 1, fini.stdout
    assert "FicheInvalideError" in fini.stdout


def test_deploy_check_appelle_le_controle_des_salles() -> None:
    """Un contrôle que rien n'appelle ne protège de rien (justfile, 13 septembre 2026)."""
    recettes = (DEPOT / "justfile").read_text(encoding="utf-8").split("\ndeploy-check:\n", 1)[1]
    recette = recettes.split("\n\n# ", 1)[0]

    assert "if ! bash deploy/salles-adaptateurs.sh; then faux=1; fi" in recette
    assert "if ! bash deploy/salon-importable.sh; then faux=1; fi" in recette
