"""Le test doré des salles externes: les commandes Docker de chaque console, figées.

Chaque scénario de `dore/scenarios.py` lance le VRAI script de la salle dans un
`/usr/bin/python3` neuf, comme le worker (`dore/banc.py`, `dore/amorce.py`), et
son relevé doit égaler `dore/<scénario>.json` octet pour octet. Une migration
d'adaptateur garde ces fichiers inchangés: c'est ce qui prouve qu'elle ne
change rien pour une salle. Un commit qui modifie un `dore/*.json` ne fait que
ça, et dit pourquoi (`just salles-dore-ecrire` montre les lignes qui changent).

Ce qui rend ce test capable d'échouer pour la bonne raison:

- un second passage tourne sur une COPIE de la fermeture des scripts
  (`banc.FERMETURE`) et doit rendre le même doré: il prouve que la sortie ne
  dépend ni du hasard ni d'un fichier oublié dans la copie des mutants;
- chaque mutant, appliqué à une copie, doit produire SA différence sur SON
  scénario. Un texte introuvable est une erreur, et une erreur d'import ne
  compte pas comme une détection;
- une enveloppe qui cherche le socle au mauvais endroit doit échouer ici comme
  sous le worker, alors que `runpy` lancé depuis la racine la laisse passer;
- l'environnement du shell (variables `NEL3AB_*`, `PYTHONPATH`) n'arrive pas au
  script, et un relevé qui nommerait encore un `/home/` est refusé.

    python3 docker/test_salles_dore.py            les essais
    python3 docker/test_salles_dore.py --ecrire   réécrit le doré (just salles-dore-ecrire)
"""

from __future__ import annotations

import difflib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).with_name("dore")))

import banc  # noqa: E402 -- dore/ n'est pas un paquet: son chemin vient d'être posé
import scenarios  # noqa: E402

DEPOT = banc.DEPOT
ERREURS_D_IMPORT = ("ImportError", "ModuleNotFoundError", "SyntaxError")


def executer(paires: list[tuple[str, str]], depot: Path = DEPOT) -> dict[tuple[str, str], dict]:
    """Chaque (scénario, script), en parallèle: un interpréteur neuf par lancement."""
    with ThreadPoolExecutor(max_workers=min(16, os.cpu_count() or 2)) as executeur:
        futurs = {
            (nom, script): executeur.submit(banc.lancer, scenarios.TOUS[nom], script, depot)
            for nom, script in paires
        }
        return {cle: futur.result() for cle, futur in futurs.items()}


def toutes_les_paires() -> list[tuple[str, str]]:
    return [(nom, script) for nom, scripts in scenarios.SCRIPTS.items() for script in scripts]


# --- Ce que l'on lit dans un relevé ---------------------------------------------------


def docker_run(releve: dict, assistant: bool) -> list[str]:
    """La commande `docker run` du moteur, ou celle de l'assistant des manettes."""
    for commande in releve["commandes"]:
        argv = commande["argv"]
        if argv[:2] == ["docker", "run"] and ("/probe/pads.py" in argv) == assistant:
            return argv
    raise AssertionError("aucun docker run de ce genre dans le relevé")


def arrets(releve: dict) -> list[str]:
    return [c["argv"][-1] for c in releve["commandes"] if c["argv"][:2] == ["docker", "stop"]]


def copies(releve: dict) -> list[str]:
    """Les copies datées: les dossiers posés directement sous un backups/."""
    trouvees = []
    for ligne in releve["arbre"]:
        genre, _mode, chemin = ligne.split(" ", 2)
        parties = chemin.rstrip("/").split("/")
        if genre == "d" and len(parties) >= 2 and parties[-2] == "backups":
            trouvees.append(chemin)
    return trouvees


# --- Les mutants ----------------------------------------------------------------------


class MutantIntrouvableError(AssertionError):
    """Le texte à remplacer n'est pas présent exactement une fois."""


class MutantNonValableError(AssertionError):
    """Le mutant a cassé l'import ou n'a pas produit sa différence."""


@dataclass(frozen=True)
class Mutant:
    nom: str
    fichier: str
    avant: str
    apres: str
    scenario: str
    script: str
    #: La différence attendue, lue dans le relevé du mutant.
    vu: Callable[[dict], bool]


def muter(mutant: Mutant) -> dict:
    """Le relevé du scénario sur une copie de la fermeture où le mutant est appliqué."""
    with tempfile.TemporaryDirectory(prefix="mutant-") as temporaire:
        copie = banc.copier_fermeture(Path(temporaire) / "depot")
        cible = copie / mutant.fichier
        texte = cible.read_text(encoding="utf-8")
        if texte.count(mutant.avant) != 1:
            raise MutantIntrouvableError(
                f"{mutant.nom}: {texte.count(mutant.avant)} fois dans {mutant.fichier}, pas une"
            )
        cible.write_text(texte.replace(mutant.avant, mutant.apres), encoding="utf-8")
        return banc.lancer(scenarios.TOUS[mutant.scenario], mutant.script, copie)


def verifier(mutant: Mutant) -> None:
    releve = muter(mutant)
    erreur = releve["erreur"] or ""
    if erreur.startswith(ERREURS_D_IMPORT) and mutant.nom not in IMPORT_ATTENDU:
        raise MutantNonValableError(f"{mutant.nom}: erreur d'import, pas une détection: {erreur}")
    if releve == banc.lire_dore(mutant.scenario):
        raise MutantNonValableError(f"{mutant.nom}: {mutant.scenario} rend encore son doré")
    if not mutant.vu(releve):
        raise MutantNonValableError(f"{mutant.nom}: la différence attendue n'y est pas")


def sway_avant_captures(releve: dict) -> bool:
    argv = docker_run(releve, assistant=False)
    return argv.index("NEL3AB_SWAY_X11=1") < argv.index("NEL3AB_CAPTURES_S=30")


MUTANTS = (
    Mutant(
        "x360: deux variables du moteur dans l'autre ordre",
        "docker/xbox360-room.py",
        '        "-e",\n'
        '        f"NEL3AB_CAPTURES_S={captures}",\n'
        "        # Xwayland, et pas de plein écran imposé par Sway: voir supervise.py.\n"
        '        "-e",\n'
        '        "NEL3AB_SWAY_X11=1",\n',
        '        "-e",\n'
        '        "NEL3AB_SWAY_X11=1",\n'
        '        "-e",\n'
        '        f"NEL3AB_CAPTURES_S={captures}",\n',
        "x360-captures",
        "docker/xbox360-room.py",
        sway_avant_captures,
    ),
    Mutant(
        "switch2: la copie avant la préparation",
        "docker/switch2-room.py",
        "        plan = launch(config, Path(rom).resolve(), slot)\n        backup(slot)\n",
        "        backup(slot)\n        plan = launch(config, Path(rom).resolve(), slot)\n",
        "switch2-defaut",
        "docker/switch2-room.py",
        # La NAND n'existe pas encore: la première copie n'a pas lieu.
        lambda releve: len(copies(releve)) == 1,
    ),
    Mutant(
        "switch: trois places au lieu de quatre",
        "docker/switch-room.py",
        "    for seat in range(1, 5):\n",
        "    for seat in range(1, 4):\n",
        "switch-neuve",
        "docker/switch-room.py",
        lambda releve: "--input-id-4" not in docker_run(releve, assistant=False),
    ),
    Mutant(
        "x360: la disposition de la Switch",
        "docker/xbox360-room.py",
        '        4,\n        "xbox",\n    )\n',
        '        4,\n        "switch",\n    )\n',
        "x360-captures",
        "docker/xbox360-room.py",
        lambda releve: "NEL3AB_PAD_LAYOUT=switch" in docker_run(releve, assistant=True),
    ),
    Mutant(
        "switch: les manettes arrêtées avant le moteur",
        "docker/switch-room.py",
        "        try:\n            if started_engine:\n",
        "        try:\n"
        "            if started_helper:\n"
        '                run("docker", "stop", "--timeout", "5", helper)\n'
        "            if started_engine:\n",
        "switch-neuve",
        "docker/switch-room.py",
        lambda releve: arrets(releve)[0].endswith("-pads"),
    ),
    # Les mêmes fautes sur le chemin du canari: elles prouvent qu'il sert bien le
    # socle et le module Xenia, et pas l'ancien script.
    Mutant(
        "canari x360: deux variables du moteur dans l'autre ordre",
        "moteurs/xenia/adaptateur.py",
        '        "-e",\n'
        '        f"NEL3AB_CAPTURES_S={captures}",\n'
        "        # Xwayland, et pas de plein écran imposé par Sway: voir supervise.py.\n"
        '        *(["-e", "NEL3AB_SWAY_X11=1"] if lue.display == "x11" else []),\n',
        '        *(["-e", "NEL3AB_SWAY_X11=1"] if lue.display == "x11" else []),\n'
        '        "-e",\n'
        '        f"NEL3AB_CAPTURES_S={captures}",\n',
        "x360-captures",
        "docker/xbox360-room-socle.py",
        sway_avant_captures,
    ),
    Mutant(
        "canari x360: la disposition de la Switch dans la fiche",
        "moteurs/xenia/moteur.json",
        '"pad_layout": "xbox",',
        '"pad_layout": "switch",',
        "x360-captures",
        "docker/xbox360-room-socle.py",
        lambda releve: "NEL3AB_PAD_LAYOUT=switch" in docker_run(releve, assistant=True),
    ),
    Mutant(
        "canari x360: le socle arrête les manettes avant le moteur",
        "moteurs/socle/salle.py",
        "        try:\n            if started_engine:\n",
        "        try:\n"
        "            if started_helper:\n"
        '                run("docker", "stop", "--timeout", "5", helper)\n'
        "            if started_engine:\n",
        "x360-captures",
        "docker/xbox360-room-socle.py",
        lambda releve: arrets(releve)[0].endswith("-pads"),
    ),
    Mutant(
        "canari x360: l'enveloppe cherche le socle au mauvais endroit",
        "docker/xbox360-room-socle.py",
        "DEPOT = Path(__file__).resolve().parents[1]\n",
        "DEPOT = Path(__file__).resolve().parents[2]\n",
        "x360-captures",
        "docker/xbox360-room-socle.py",
        # Le seul mutant où l'erreur d'import EST la différence attendue: c'est
        # ce que le worker verrait.
        lambda releve: releve["erreur"] == "ModuleNotFoundError: No module named 'moteurs'",
    ),
)
#: Les mutants dont la différence attendue est justement une erreur d'import.
IMPORT_ATTENDU = {"canari x360: l'enveloppe cherche le socle au mauvais endroit"}


# --- Les essais -----------------------------------------------------------------------

RELEVES: dict[tuple[str, str], dict] = {}
COPIE: dict[tuple[str, str], dict] = {}


MASQUE: list[int] = []


def setUpModule() -> None:
    # Les fichiers des scénarios naissent avec le masque du worker sous systemd:
    # celui du shell (0002 ici) changerait les modes relevés d'une machine à l'autre.
    MASQUE.append(os.umask(0o022))
    RELEVES.update(executer(toutes_les_paires()))
    with tempfile.TemporaryDirectory(prefix="fermeture-") as temporaire:
        copie = banc.copier_fermeture(Path(temporaire) / "depot")
        COPIE.update(executer(toutes_les_paires(), copie))


def tearDownModule() -> None:
    os.umask(MASQUE.pop())


class Dore(unittest.TestCase):
    maxDiff = None

    def test_chaque_scenario_rend_son_dore_par_chaque_script(self):
        for (nom, script), releve in RELEVES.items():
            with self.subTest(scenario=nom, script=script):
                self.assertEqual(releve, banc.lire_dore(nom))

    def test_une_copie_de_la_fermeture_rend_le_meme_releve(self):
        """Second passage: ni hasard (caches de tailles distinctes), ni fichier oublié."""
        for cle, releve in COPIE.items():
            with self.subTest(scenario=cle[0], script=cle[1]):
                self.assertEqual(releve, RELEVES[cle])

    def test_chaque_dore_a_son_scenario_et_inversement(self):
        fichiers = {chemin.stem for chemin in banc.DORE.glob("*.json")}
        self.assertEqual(fichiers, set(scenarios.SCRIPTS))
        self.assertEqual(set(scenarios.SCRIPTS), set(scenarios.TOUS))

    def test_chaque_console_lance_son_moteur_et_ses_manettes(self):
        """Le doré n'est pas vide: le cas normal de chaque console va jusqu'à l'arrêt."""
        for nom, moteur, manettes in (
            ("switch-neuve", "/emulator/publish/Ryujinx", 4),
            ("switch2-defaut", "/emulator/usr/bin/eden-cli", 1),
            ("x360-captures", "/xbox360/xenia.sh", 4),
        ):
            with self.subTest(scenario=nom):
                releve = RELEVES[nom, scenarios.SCRIPTS[nom][0]]
                self.assertIsNone(releve["erreur"])
                self.assertEqual(releve["sortie"], 0)
                argv = docker_run(releve, assistant=False)
                self.assertIn(moteur, argv)
                appareils = [
                    argv[position + 1]
                    for position, valeur in enumerate(argv)
                    if valeur == "--device" and argv[position + 1].startswith("/dev/input/")
                ]
                self.assertEqual(appareils, [f"/dev/input/event{n}" for n in range(manettes)])
                self.assertEqual(len(arrets(releve)), 2)

    def test_un_refus_avant_conteneur_ne_lance_aucune_commande(self):
        refus = [nom for nom in scenarios.TOUS if "-refus-" in nom]
        self.assertGreaterEqual(len(refus), 15)
        for nom in refus:
            with self.subTest(scenario=nom):
                releve = RELEVES[nom, scenarios.SCRIPTS[nom][0]]
                self.assertEqual(releve["commandes"], [])
                self.assertEqual(releve["sortie"], 1)
                self.assertTrue(releve["erreur"].startswith(("ValueError", "KeyError")))

    def test_les_tolerances_d_aujourd_hui_sont_enregistrees_telles_quelles(self):
        for nom in ("switch-tolerance-iso", "switch-tolerance-moteur-absent"):
            with self.subTest(scenario=nom):
                releve = RELEVES[nom, scenarios.SCRIPTS[nom][0]]
                self.assertIsNone(releve["erreur"])
                self.assertEqual(len(arrets(releve)), 2)
        avant = RELEVES["switch-refus-refresh-0", "docker/switch-room.py"]
        self.assertEqual(len(copies(avant)), 1, "la copie précède le refus de refresh_hz")

    def test_la_sonde_garde_ses_variables_et_son_programme_en_ecriture(self):
        argv = docker_run(RELEVES["sonde", scenarios.SCRIPTS["sonde"][0]], assistant=False)
        for variable in ("NEL3AB_LATENCY_PROBE=1", "NEL3AB_AUDIO_PROBE=1"):
            self.assertIn(variable, argv)
        montage = [a for a in argv if a.startswith("@TMP@/roms/")]
        self.assertEqual(montage, ["@TMP@/roms/jeu.nro:/game/input.nro"])

    def test_chaque_moteur_recoit_le_rafraichissement_et_l_affichage(self):
        """Le conteneur garde ses propres défauts (supervise.py, runtime.sh): la salle
        doit donc toujours les lui donner, sinon ils décideraient en silence."""
        for (nom, _script), releve in RELEVES.items():
            if releve["sortie"] != 0:
                continue
            with self.subTest(scenario=nom):
                argv = docker_run(releve, assistant=False)
                self.assertEqual(sum(a.startswith("SWITCH_REFRESH_HZ=") for a in argv), 1)
                self.assertIn("DISPLAY_BACKEND=wayland", argv)

    def test_aucun_releve_ne_nomme_un_dossier_personnel(self):
        for (nom, script), releve in RELEVES.items():
            with self.subTest(scenario=nom, script=script):
                self.assertEqual(banc.fuites(releve), [])

    def test_un_chemin_personnel_qui_fuit_est_nomme(self):
        """Le jumeau: un moteur configuré sous /home/ apparaît dans la commande."""
        fuite = replace(
            scenarios.TOUS["switch-neuve"],
            preparer=lambda racine: scenarios.switch(racine, engine="/home/personne/ryubing"),
        )
        releve = banc.lancer(fuite, "docker/switch-room.py")
        self.assertIn("/home/personne/ryubing:/emulator:ro", banc.fuites(releve))

    def test_l_environnement_du_shell_n_arrive_pas_au_script(self):
        """Une configuration réelle, un adaptateur remplacé et un PYTHONPATH piégé
        dans l'environnement du test ne changent rien au relevé."""
        with tempfile.TemporaryDirectory() as temporaire:
            piege = Path(temporaire)
            (piege / "sitecustomize.py").write_text("raise SystemExit('PYTHONPATH hérité')\n")
            with patch.dict(
                os.environ,
                {
                    "PYTHONPATH": str(piege),
                    "NEL3AB_SWITCH_CONFIG": str(piege / "absente.json"),
                    "NEL3AB_SWITCH_ADAPTER": str(piege / "autre.py"),
                },
            ):
                releve = banc.lancer(scenarios.TOUS["switch-neuve"], "docker/switch-room.py")
        self.assertEqual(releve, banc.lire_dore("switch-neuve"))

    def test_le_banc_n_ecrit_rien_dans_le_depot(self):
        """Ni fichier suivi, ni cache d'octets ignoré par git, dans les dossiers lus."""

        def etat() -> tuple[str, dict[str, int]]:
            porcelaine = subprocess.run(  # noqa: S603 -- git, arguments fixes
                ["git", "-C", str(DEPOT), "status", "--porcelain"],  # noqa: S607
                capture_output=True,
                text=True,
                check=True,
            ).stdout
            fichiers = {
                str(chemin): chemin.stat().st_mtime_ns
                for dossier in banc.LUS
                for chemin in (DEPOT / dossier).rglob("*")
                if chemin.is_file()
            }
            return porcelaine, fichiers

        avant = etat()
        self.assertTrue(avant[1], "aucun fichier relevé: le contrôle ne regarderait rien")
        for nom in ("switch-neuve", "switch2-defaut", "x360-captures", "sonde"):
            banc.lancer(scenarios.TOUS[nom], scenarios.SCRIPTS[nom][0])
        self.assertEqual(etat(), avant)


class LancementCommeLeWorker(unittest.TestCase):
    """L'amorce donne au script ce qu'un lancement direct lui donnerait."""

    SONDE = (
        "import json, sys\n"
        "from pathlib import Path\n"
        "Path(sys.argv[1]).with_name('vu.json').write_text(json.dumps(\n"
        "    {'path': sys.path, 'argv0': sys.argv[0], 'file': __file__, 'name': __name__}))\n"
    )

    def test_sys_path_argv_et_file_sont_ceux_d_un_lancement_direct(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            (racine / "docker").mkdir()
            (racine / "core/crates/worker").mkdir(parents=True)
            (racine / "docker/sonde.py").write_text(self.SONDE)
            script = racine / banc.DEPUIS_LE_WORKER / "docker/sonde.py"
            env = {"PATH": "/usr/bin:/bin", "HOME": str(racine), "PYTHONDONTWRITEBYTECODE": "1"}
            vus = []
            for amorce in (False, True):
                marque = racine / ("amorce" if amorce else "direct") / "marque"
                marque.parent.mkdir()
                consigne = marque.with_name("consigne.json")
                consigne.write_text(
                    json.dumps(
                        {
                            "journal": str(marque.with_name("journal.json")),
                            "manettes": 4,
                            "arret_apres": None,
                            "capture_meurt": False,
                            "tours": 3,
                            "echec_moteur": False,
                        }
                    )
                )
                avant = [str(banc.AMORCE), str(consigne)] if amorce else []
                subprocess.run(  # noqa: S603
                    [banc.PYTHON, *avant, str(script), str(marque), "t", "neuve", "r"],
                    cwd=racine,
                    env=env,
                    check=True,
                )
                vus.append(json.loads(marque.with_name("vu.json").read_text()))
            self.assertEqual(vus[1], vus[0])
            self.assertEqual(vus[0]["path"][0], str((racine / "docker").resolve()))
            self.assertEqual(vus[0]["name"], "__main__")

    def faux_depot(self, racine: Path, parents: int) -> Path:
        """Un dépôt jetable: une enveloppe et un faux socle qui dit qu'il a été atteint."""
        (racine / "core/crates/worker").mkdir(parents=True)
        (racine / "moteurs/socle").mkdir(parents=True)
        (racine / "moteurs/__init__.py").write_text("")
        (racine / "moteurs/socle/__init__.py").write_text("")
        (racine / "moteurs/socle/salle.py").write_text(
            "def principal(code):\n    raise RuntimeError(f'socle atteint {code}')\n"
        )
        (racine / "docker").mkdir()
        (racine / "docker/enveloppe.py").write_text(
            "import sys\n"
            "from pathlib import Path\n"
            f"DEPOT = Path(__file__).resolve().parents[{parents}]\n"
            "sys.path.append(str(DEPOT))\n"
            "from moteurs.socle.salle import principal\n"
            "principal('x360')\n"
        )
        return racine

    def test_une_enveloppe_au_mauvais_chemin_echoue_comme_sous_le_worker(self):
        with tempfile.TemporaryDirectory() as temporaire:
            bonne = self.faux_depot(Path(temporaire) / "bonne", parents=1)
            fausse = self.faux_depot(Path(temporaire) / "fausse", parents=2)
            scenario = scenarios.TOUS["x360-captures"]
            self.assertEqual(
                banc.lancer(scenario, "docker/enveloppe.py", bonne)["erreur"],
                "RuntimeError: socle atteint x360",
            )
            self.assertEqual(
                banc.lancer(scenario, "docker/enveloppe.py", fausse)["erreur"],
                "ModuleNotFoundError: No module named 'moteurs'",
            )
            # Pourquoi l'amorce: `runpy` depuis la racine trouve `moteurs` par le
            # dossier courant et laisse passer l'enveloppe cassée.
            runpy = subprocess.run(  # noqa: S603
                [
                    banc.PYTHON,
                    "-c",
                    "import runpy; runpy.run_path('docker/enveloppe.py', run_name='__main__')",
                ],
                cwd=fausse,
                env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertIn("RuntimeError: socle atteint x360", runpy.stderr)


class Mutants(unittest.TestCase):
    def test_chaque_mutant_est_vu_par_son_scenario(self):
        for mutant in MUTANTS:
            with self.subTest(mutant=mutant.nom):
                verifier(mutant)

    def test_un_texte_introuvable_est_une_erreur(self):
        absent = replace(MUTANTS[2], nom="absent", avant="    for seat in range(1, 6):\n")
        with self.assertRaises(MutantIntrouvableError):
            muter(absent)

    def test_une_erreur_d_import_ne_compte_pas_comme_detection(self):
        casse = replace(
            MUTANTS[2], nom="import cassé", avant="import selectors\n", apres="import selecteurs\n"
        )
        with self.assertRaisesRegex(MutantNonValableError, "erreur d'import"):
            verifier(casse)

    def test_un_mutant_sans_effet_n_est_pas_une_detection(self):
        neutre = replace(MUTANTS[2], nom="neutre", apres="    for seat in range(1, 5):  # \n")
        with self.assertRaisesRegex(MutantNonValableError, "rend encore son doré"):
            verifier(neutre)


def ecrire() -> int:
    """Réécrit chaque doré depuis le premier script de son scénario, et montre l'écart."""
    ancien_masque = os.umask(0o022)
    try:
        premiers = [(nom, scripts[0]) for nom, scripts in scenarios.SCRIPTS.items()]
        releves = executer(premiers)
    finally:
        os.umask(ancien_masque)
    change = 0
    for (nom, _script), releve in sorted(releves.items()):
        chemin = banc.DORE / f"{nom}.json"
        nouveau = banc.texte_dore(releve)
        ancien = chemin.read_text(encoding="utf-8") if chemin.exists() else ""
        if nouveau != ancien:
            change += 1
            sys.stdout.writelines(
                difflib.unified_diff(
                    ancien.splitlines(keepends=True),
                    nouveau.splitlines(keepends=True),
                    f"a/docker/dore/{nom}.json",
                    f"b/docker/dore/{nom}.json",
                )
            )
            chemin.write_text(nouveau, encoding="utf-8")
    for orphelin in sorted(
        set(banc.DORE.glob("*.json")) - {banc.DORE / f"{n}.json" for n in scenarios.SCRIPTS}
    ):
        sys.stdout.write(f"retiré: {orphelin.relative_to(DEPOT)}\n")
        orphelin.unlink()
        change += 1
    sys.stdout.write(f"{change} fichier(s) doré(s) changé(s)\n")
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--ecrire"]:
        sys.exit(ecrire())
    unittest.main()
