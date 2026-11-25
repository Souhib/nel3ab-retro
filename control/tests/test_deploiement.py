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
import time
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


def test_une_enveloppe_qui_lit_stdin_n_avale_pas_les_consoles_suivantes(tmp_path: Path) -> None:
    """L'import hérite de l'entrée de la boucle, la liste des consoles: un module qui lit
    stdin à l'import l'avalait, et les consoles suivantes n'étaient plus vérifiées."""
    gourmande = tmp_path / "gourmande.py"
    gourmande.write_text("import sys\nsys.stdin.read()\n")
    absent = tmp_path / "absent.py"

    fini = salles(
        unite(tmp_path, f"NEL3AB_SWITCH_ADAPTER={gourmande}", f"NEL3AB_XBOX360_ADAPTER={absent}"),
        tmp_path,
    )

    assert fini.returncode == 1, fini.stdout
    assert f"NEL3AB_XBOX360_ADAPTER vise un fichier absent ({absent})" in fini.stdout


def test_un_chemin_relatif_se_lit_depuis_le_dossier_du_worker(tmp_path: Path) -> None:
    """Le worker passe la valeur telle quelle à python3, qui la lit depuis le
    WorkingDirectory de l'unité (core/), pas depuis la racine du dépôt."""
    canari = copie_du_canari(tmp_path / "depot")
    core = tmp_path / "depot/core"
    core.mkdir()

    juste = salles(unite(tmp_path, "NEL3AB_XBOX360_ADAPTER=../docker/xbox360-room-socle.py"), core)
    faux = salles(unite(tmp_path, "NEL3AB_XBOX360_ADAPTER=docker/xbox360-room-socle.py"), core)

    assert canari.exists()
    assert juste.returncode == 0, juste.stdout + juste.stderr
    assert juste.stdout == (
        "  nel3ab-worker@1: NEL3AB_XBOX360_ADAPTER remplace l'adaptateur x360 par "
        f"{core}/../docker/xbox360-room-socle.py\n"
    )
    # Le jumeau: juste depuis la racine du dépôt, faux pour le worker.
    assert faux.returncode == 1
    assert f"vise un fichier absent ({core}/docker/xbox360-room-socle.py)" in faux.stdout
    assert "remplace l'adaptateur" not in faux.stdout


def test_deploy_check_appelle_le_controle_des_salles() -> None:
    """Un contrôle que rien n'appelle ne protège de rien (justfile, 13 septembre 2026)."""
    recettes = (DEPOT / "justfile").read_text(encoding="utf-8").split("\ndeploy-check:\n", 1)[1]
    recette = recettes.split("\n\n# ", 1)[0]

    assert "if ! bash deploy/salles-adaptateurs.sh; then faux=1; fi" in recette
    assert "if ! bash deploy/salon-importable.sh; then faux=1; fi" in recette
    assert "if ! bash deploy/services-a-jour.sh; then faux=1; fi" in recette


# --- Le code que les services exécutent ---------------------------------------------
#
# `deploy/services-a-jour.sh` compare l'heure de démarrage de chaque service à la
# dernière modification du code qu'il exécute : le dossier de son unité pour le
# salon et la boîte noire, le binaire de son ExecStart pour une salle. Jusqu'au
# 25 novembre 2026, ce contrôle lisait l'arbre d'où on le lançait : depuis un
# worktree, un code que les services n'exécutent pas. Ces essais mettent un faux
# `systemctl` en tête du PATH et ne touchent à aucun service.

SERVICES = DEPOT / "deploy/services-a-jour.sh"
JOUR = 86_400.0
# Avant tout fichier d'un dépôt cloné aujourd'hui, et dans cet ordre.
EN_2020 = 1_577_836_800.0
EN_2021 = 1_609_459_200.0

# Aussi strict que le vrai pour les deux appels du contrôle, et rien d'autre :
# un appel changé dans le script sort ici en 64 au lieu de recevoir une réponse
# inventée. Une propriété absente rend ce que rend systemd pour une unité
# inconnue (« inactive », sinon une ligne vide), lu le 25 novembre 2026.
FAUX_SYSTEMCTL = """#!/bin/sh
racine="$(dirname "$0")/../systemd"
if [ "$#" -eq 5 ] && [ "$1" = show ] && [ "$3" = -p ] && [ "$5" = --value ]; then
    if [ -f "$racine/$2/$4" ]; then cat "$racine/$2/$4"; echo
    elif [ "$4" = ActiveState ]; then echo inactive
    else echo
    fi
    exit 0
fi
if [ "$#" -eq 4 ] && [ "$1" = list-units ] && [ "$2" = --no-legend ] \\
    && [ "$3" = --state=active ] && [ "$4" = 'nel3ab-worker@*.service' ]; then
    for dossier in "$racine"/nel3ab-worker@*.service; do
        [ -f "$dossier/ActiveState" ] || continue
        [ "$(cat "$dossier/ActiveState")" = active ] || continue
        echo "  $(basename "$dossier")     loaded active running nel3ab salle"
    done
    exit 0
fi
echo "faux systemctl: appel inattendu: $*" >&2
exit 64
"""


def horodatage(quand: float) -> str:
    """Au format de `systemctl show -p ActiveEnterTimestamp --value`."""
    return time.strftime("%a %Y-%m-%d %H:%M:%S UTC", time.gmtime(quand))


def date_lue(quand: float) -> str:
    """Comme le script l'écrit, `date '+%F %T'` sous TZ=UTC."""
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(quand))


def actif(depuis: float, **proprietes: str) -> dict[str, str]:
    return {"ActiveState": "active", "ActiveEnterTimestamp": horodatage(depuis), **proprietes}


def salon_servi(racine: Path, quand: float) -> Path:
    """Le dossier d'un salon comme celui qu'une unité exécute, chaque fichier daté de `quand`.

    Le manifeste est à côté du dossier, là où `consoles.py` le lit
    (`Path(__file__).resolve().parents[2]`)."""
    dossier = racine / "control"
    for fichier in (
        dossier / "nel3ab_control/app.py",
        dossier / "nel3ab_control/api/routes/regie.css",
        dossier / "pyproject.toml",
        dossier / "uv.lock",
        racine / "consoles/consoles.json",
    ):
        fichier.parent.mkdir(parents=True, exist_ok=True)
        fichier.write_text("", encoding="utf-8")
        os.utime(fichier, (quand, quand))
    return dossier


def dater(fichier: Path, quand: float) -> None:
    os.utime(fichier, (quand, quand))


def services(faux: Path, unites: dict[str, dict[str, str]]) -> subprocess.CompletedProcess[str]:
    systemctl = faux / "bin/systemctl"
    systemctl.parent.mkdir(parents=True)
    systemctl.write_text(FAUX_SYSTEMCTL, encoding="utf-8")
    systemctl.chmod(0o755)
    for unite, proprietes in unites.items():
        for nom, valeur in proprietes.items():
            chemin = faux / "systemd" / unite / nom
            chemin.parent.mkdir(parents=True, exist_ok=True)
            chemin.write_text(valeur, encoding="utf-8")
    return subprocess.run(  # noqa: S603 - bash et un script du dépôt, aucun texte du dehors
        ["/usr/bin/env", "bash", str(SERVICES)],
        env={**os.environ, "PATH": f"{systemctl.parent}:{os.environ['PATH']}", "TZ": "UTC"},
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def les_deux(depuis: float, dossier: Path) -> dict[str, dict[str, str]]:
    """Le salon et la boîte noire, qui exécutent le même dossier depuis la même heure."""
    return {
        "nel3ab-control.service": actif(depuis, WorkingDirectory=str(dossier)),
        "nel3ab-boite-noire.service": actif(depuis, WorkingDirectory=str(dossier)),
    }


def plus_recent_du_depot() -> float:
    sources = (DEPOT / "control/nel3ab_control").rglob("*.py")
    return max(fichier.stat().st_mtime for fichier in sources)


def test_le_code_d_un_salon_est_celui_du_dossier_de_son_unite(tmp_path: Path) -> None:
    """Le dossier de l'unité a changé après le démarrage : rouge, quel que soit l'arbre
    d'où l'on lance le contrôle."""
    maintenant = time.time()
    dossier = salon_servi(tmp_path / "servi", maintenant + 20 * JOUR)
    assert plus_recent_du_depot() < maintenant + 10 * JOUR

    fini = services(tmp_path / "faux", les_deux(maintenant + 10 * JOUR, dossier))

    assert fini.returncode == 1, fini.stdout + fini.stderr
    for unite in ("nel3ab-control.service", "nel3ab-boite-noire.service"):
        assert f"plus ancien que celui qu'elle exécute: {unite} (démarrée" in fini.stdout


def test_l_arbre_d_ou_l_on_lance_le_controle_ne_compte_pas(tmp_path: Path) -> None:
    """Le jumeau : ce dépôt est plus récent que le démarrage, le dossier servi non. Le
    25 novembre 2026, depuis le worktree d'intégration, la garde rougissait ainsi sur
    un code que le salon n'exécute pas."""
    dossier = salon_servi(tmp_path / "servi", EN_2020)
    assert plus_recent_du_depot() > EN_2021

    fini = services(tmp_path / "faux", les_deux(EN_2021, dossier))

    assert fini.returncode == 0, fini.stdout + fini.stderr
    assert "plus ancien" not in fini.stdout


def test_le_manifeste_des_consoles_lu_par_le_salon_compte(tmp_path: Path) -> None:
    """Le 22 novembre 2026 : le salon démarré à 14 h 35, `consoles.json` changé à 16 h 05
    dans l'arbre qu'il exécute. Il ne lit ce manifeste qu'à l'import."""
    maintenant = time.time()
    dossier = salon_servi(tmp_path / "servi", EN_2020)
    manifeste = tmp_path / "servi/consoles/consoles.json"
    dater(manifeste, maintenant + 20 * JOUR)

    fini = services(tmp_path / "faux", les_deux(maintenant + 10 * JOUR, dossier))

    assert fini.returncode == 1, fini.stdout + fini.stderr
    assert (
        "  tourne avec un code plus ancien que celui qu'elle exécute: nel3ab-control.service "
        f"(démarrée {date_lue(maintenant + 10 * JOUR)}, "
        f"{manifeste.resolve()} du {date_lue(maintenant + 20 * JOUR)})\n"
    ) in fini.stdout


def test_un_pyc_ecrit_par_le_service_ne_le_rend_pas_perime(tmp_path: Path) -> None:
    """Le service écrit ses `.pyc` en tournant ; une source changée, elle, compte."""
    dossier = salon_servi(tmp_path / "servi", EN_2020)
    cache = dossier / "nel3ab_control/__pycache__/app.cpython-312.pyc"
    cache.parent.mkdir()
    cache.write_bytes(b"")
    unites = {"nel3ab-control.service": actif(EN_2021, WorkingDirectory=str(dossier))}

    vert = services(tmp_path / "a", unites)
    dater(dossier / "nel3ab_control/app.py", time.time())
    rouge = services(tmp_path / "b", unites)

    assert vert.returncode == 0, vert.stdout + vert.stderr
    assert rouge.returncode == 1, rouge.stdout + rouge.stderr
    assert f"{(dossier / 'nel3ab_control/app.py').resolve()} du " in rouge.stdout


def test_un_service_arrete_n_est_pas_lu(tmp_path: Path) -> None:
    maintenant = time.time()
    dossier = salon_servi(tmp_path / "servi", maintenant + 20 * JOUR)
    arrete = {
        "ActiveState": "inactive",
        "ActiveEnterTimestamp": horodatage(maintenant + 10 * JOUR),
        "WorkingDirectory": str(dossier),
    }

    fini = services(tmp_path / "faux", {"nel3ab-control.service": arrete})

    assert fini.returncode == 0, fini.stdout + fini.stderr
    assert fini.stdout == ""


def test_un_salon_dont_le_dossier_n_a_pas_le_code_est_rouge(tmp_path: Path) -> None:
    """Aucune heure lisible n'est pas « rien de plus récent »."""
    vide = tmp_path / "vide"
    vide.mkdir()

    fini = services(tmp_path / "faux", les_deux(time.time() + 10 * JOUR, vide))

    assert fini.returncode == 1, fini.stdout + fini.stderr
    assert f"nel3ab-control.service: {vide / 'nel3ab_control'} absent" in fini.stdout


def test_un_manifeste_absent_du_dossier_servi_est_rouge(tmp_path: Path) -> None:
    dossier = salon_servi(tmp_path / "servi", EN_2020)
    (tmp_path / "servi/consoles/consoles.json").unlink()

    fini = services(tmp_path / "faux", les_deux(time.time() + 10 * JOUR, dossier))

    assert fini.returncode == 1, fini.stdout + fini.stderr
    assert "consoles/consoles.json absent" in fini.stdout


def test_une_heure_de_demarrage_illisible_est_rouge(tmp_path: Path) -> None:
    """`date -d ""` rend minuit du jour : une heure vide se lirait sans un mot."""
    dossier = salon_servi(tmp_path / "servi", EN_2020)
    unites = {
        "nel3ab-control.service": {
            "ActiveState": "active",
            "ActiveEnterTimestamp": "",
            "WorkingDirectory": str(dossier),
        }
    }

    fini = services(tmp_path / "faux", unites)

    assert fini.returncode == 1, fini.stdout + fini.stderr
    assert "nel3ab-control.service: heure de démarrage illisible" in fini.stdout


def execstart(binaire: Path) -> str:
    """Au format de `systemctl show -p ExecStart --value`."""
    return (
        f"{{ path={binaire} ; argv[]={binaire} ; ignore_errors=no ; start_time=[n/a] ; "
        "stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }"
    )


def test_une_salle_compte_par_le_binaire_de_son_execstart(tmp_path: Path) -> None:
    maintenant = time.time()
    binaire = tmp_path / "servi/core/target/release/nel3ab-worker"
    binaire.parent.mkdir(parents=True)
    binaire.write_bytes(b"")
    binaire.chmod(0o755)
    unites = {
        "nel3ab-worker@1.service": actif(maintenant + 10 * JOUR, ExecStart=execstart(binaire))
    }

    dater(binaire, maintenant + 20 * JOUR)
    rouge = services(tmp_path / "a", unites)
    dater(binaire, maintenant)
    vert = services(tmp_path / "b", unites)

    assert rouge.returncode == 1, rouge.stdout + rouge.stderr
    assert (
        "plus ancien que celui qu'elle exécute: nel3ab-worker@1.service "
        f"(démarrée {date_lue(maintenant + 10 * JOUR)}, {binaire} du"
    ) in rouge.stdout
    assert vert.returncode == 0, vert.stdout + vert.stderr
    assert vert.stdout == ""


def test_une_salle_dont_le_binaire_a_disparu_est_rouge(tmp_path: Path) -> None:
    absent = tmp_path / "servi/core/target/release/nel3ab-worker"
    unites = {"nel3ab-worker@2.service": actif(time.time(), ExecStart=execstart(absent))}

    fini = services(tmp_path / "faux", unites)

    assert fini.returncode == 1, fini.stdout + fini.stderr
    assert f"nel3ab-worker@2.service: binaire introuvable (« {absent} »)" in fini.stdout


def test_depuis_un_autre_arbre_le_controle_le_dit_sans_rougir(tmp_path: Path) -> None:
    """Vert depuis un worktree ne dit pas que sa branche tourne : la ligne le rappelle."""
    dossier = salon_servi(tmp_path / "servi", EN_2020)

    fini = services(tmp_path / "faux", les_deux(EN_2021, dossier))

    assert fini.returncode == 0, fini.stdout + fini.stderr
    assert fini.stdout == (
        f"  ce dépôt ({DEPOT.resolve()}) n'est pas celui que les services exécutent "
        f"({(tmp_path / 'servi').resolve()}): son code ne compte qu'après la fusion "
        "et la mise en service\n"
    )


def test_depuis_l_arbre_servi_rien_n_est_dit(tmp_path: Path) -> None:
    """Le jumeau : lancé depuis le dossier que les services exécutent, pas de rappel."""
    assert plus_recent_du_depot() < time.time() + 10 * JOUR

    fini = services(tmp_path / "faux", les_deux(time.time() + 10 * JOUR, DEPOT / "control"))

    assert fini.returncode == 0, fini.stdout + fini.stderr
    assert fini.stdout == ""
