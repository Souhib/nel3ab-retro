"""Le module Xenia et le canari, sans émulateur ni carte: la série de conformité.

C3 à C8 pour Xenia (moteurs/socle/conformite.py). C10 et C11 sont dans
moteurs/socle/test_regles.py, pour chaque module. C9, le lecteur de cadence,
attend sa fiche `cadence` et un journal enregistré (plan, étape E12b).

Ce que ces essais ne prouvent pas: qu'une vraie salle démarre avec le canari.
C'est l'essai du propriétaire décrit dans docs/xbox360.md.
"""

import ast
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from moteurs.socle import consoles, emplacement, fiche, salle
from moteurs.socle.lancement import DEPOT
from moteurs.xenia import adaptateur, essai

sys.dont_write_bytecode = True
sys.path.insert(0, str(DEPOT / "docker/dore"))

import banc  # noqa: E402 -- docker/dore n'est pas un paquet: son chemin vient d'être posé
import scenarios  # noqa: E402 -- même raison que banc, juste au-dessus

ANCIEN = DEPOT / "docker/xbox360-room.py"
CANARI = "docker/xbox360-room-socle.py"
FICHE = fiche.lire(DEPOT / "moteurs/xenia/moteur.json")
X360 = consoles.externe("x360")
SONIC = "534507d6"
#: Les points de montage que `serve` pose dans chaque conteneur de moteur.
MONTAGES_DU_SOCLE = ("/emulator", "/run-data", "/probe", "/pads", "/game")


def ancien_module():
    spec = importlib.util.spec_from_file_location("xbox360_room", ANCIEN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def preparation(racine: Path, lue: fiche.Fiche = FICHE, **changes):
    """Le contexte d'une partie neuve de Sonic, réglages d'essai sous `racine`."""
    config = {**essai.reglages_essai(racine, lue), **changes}
    rom = racine / "Sonic.iso"
    rom.write_bytes(b"jeu")
    slot = emplacement.chemin(config["state"], SONIC, "neuve")
    slot.mkdir(parents=True)
    return salle.Contexte(X360, lue, config, rom, SONIC, slot, racine / "runtime")


def fichiers(racine: Path) -> set[Path]:
    return {chemin for chemin in racine.rglob("*") if chemin.is_file()}


def chemins_hors_montages(plan) -> list[str]:
    """Chaque chemin absolu de la commande qui ne tombe sous aucun montage du conteneur."""
    points = list(MONTAGES_DU_SOCLE)
    for position, valeur in enumerate(plan.mounts):
        if valeur == "-v":
            points.append(plan.mounts[position + 1].split(":")[1])
    trouves = []
    for argument in plan.command:
        valeur = argument.split("=", 1)[1] if argument.startswith("--") else argument
        if valeur.startswith("/") and not any(
            valeur == point or valeur.startswith(point + "/") for point in points
        ):
            trouves.append(argument)
    return trouves


def definitions(chemin: Path) -> dict[str, ast.AST]:
    arbre = ast.parse(chemin.read_text(encoding="utf-8"))
    return {n.name: n for n in arbre.body if isinstance(n, ast.FunctionDef)}


class MemeCodeQueLAncienScript(unittest.TestCase):
    def test_les_fonctions_recopiees_telles_quelles_sont_identiques(self):
        ancien = definitions(ANCIEN)
        nouveau = definitions(DEPOT / "moteurs/xenia/adaptateur.py")
        for nom in ("rc4", "account", "read_account", "profile_key", "profiles", "backup"):
            with self.subTest(fonction=nom):
                self.assertEqual(ast.dump(nouveau[nom]), ast.dump(ancien[nom]))

    def test_les_constantes_sont_les_memes(self):
        ancien = ancien_module()
        for nom in ("STORAGE", "PLAYERS", "DASHBOARD", "PROFILE_TYPE", "ACCOUNT_SIZE", "TOOLS"):
            with self.subTest(constante=nom):
                self.assertEqual(getattr(adaptateur, nom), getattr(ancien, nom))
        self.assertEqual(adaptateur.TITRE.pattern, ancien.TITLE)

    def test_un_profil_ecrit_par_le_module_se_lit_comme_par_l_ancien(self):
        ancien = ancien_module()
        compte = adaptateur.account("Joueur 3", essai.CLE)
        self.assertEqual(compte, ancien.account("Joueur 3", essai.CLE))
        self.assertEqual(ancien.read_account(compte, essai.CLE), "Joueur 3")
        self.assertIsNone(ancien.read_account(compte, bytes(16)))


class C3Preparation(unittest.TestCase):
    def test_le_plan_suit_la_table_et_la_fiche_et_n_ecrit_que_dans_l_emplacement(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            contexte = preparation(racine)
            avant = fichiers(racine)
            plan = adaptateur.preparer(contexte)
            nouveaux = fichiers(racine) - avant
        self.assertEqual(plan.controllers, X360.players)
        self.assertEqual(plan.pad_layout, FICHE.pad_layout)
        self.assertEqual(chemins_hors_montages(plan), [])
        self.assertEqual(len(nouveaux), 4, "les quatre profils")
        jeu = contexte.emplacement.parent
        self.assertTrue(all(chemin.is_relative_to(jeu) for chemin in nouveaux), nouveaux)

    def test_la_disposition_et_le_nombre_de_manettes_viennent_de_la_fiche_et_de_la_table(self):
        """Le jumeau: une autre fiche et une console à un joueur changent le plan."""
        with tempfile.TemporaryDirectory() as temporaire:
            contexte = preparation(Path(temporaire), replace(FICHE, pad_layout="switch"))
            seul = replace(contexte, console=replace(X360, players=1))
            plan = adaptateur.preparer(seul)
        self.assertEqual((plan.pad_layout, plan.controllers), ("switch", 1))

    def test_un_chemin_de_l_hote_dans_la_commande_est_nomme(self):
        with tempfile.TemporaryDirectory() as temporaire:
            plan = adaptateur.preparer(preparation(Path(temporaire)))
        fuite = plan._replace(command=[*plan.command, "--log_file=/var/log/xenia.log"])
        self.assertEqual(chemins_hors_montages(fuite), ["--log_file=/var/log/xenia.log"])


class C4RefusAvantConteneur(unittest.TestCase):
    """Chaque refus arrive avant toute commande et avant toute copie."""

    def lancer(self, racine: Path, titre=SONIC, rom="Sonic.iso", **changes):
        config = {**essai.reglages_essai(racine, FICHE), **changes}
        chemin = racine / "xbox360.json"
        chemin.write_text(json.dumps(config))
        (racine / rom).write_bytes(b"jeu")
        appels, servis = [], []
        with (
            patch.object(subprocess, "run", lambda *a, **k: appels.append(a)),
            patch.object(subprocess, "Popen", lambda *a, **k: appels.append(a)),
            patch.object(salle, "serve", lambda *a: servis.append(a)),
        ):
            try:
                salle.principal(
                    "x360",
                    [str(racine / rom), titre, "neuve", str(racine / "runtime")],
                    {"NEL3AB_XBOX360_CONFIG": str(chemin)},
                )
                erreur = None
            except ValueError as refus:
                erreur = str(refus)
        copies = list((racine / "state").rglob("backups"))
        return erreur, appels, servis, copies

    def test_chaque_refus_precede_toute_commande_et_toute_copie(self):
        for nom, titre, rom, changes, message in (
            ("ROM de la Switch", SONIC, "jeu.xci", {}, "registered ISO"),
            ("ROM de la Switch 2", SONIC, "jeu.nup", {}, "registered ISO"),
            ("titre de la Switch", "0100abcdef012000", "Sonic.iso", {}, "Invalid Xbox 360"),
            ("titre de la Switch 2", "0400486024dec000", "Sonic.iso", {}, "Invalid Xbox 360"),
            ("moteur absent", SONIC, "Sonic.iso", {"engine": "/nulle/part"}, "Xenia Edge"),
            ("captures hors bornes", SONIC, "Sonic.iso", {"captures_s": 5}, "captures_s"),
            ("rafraîchissement nul", SONIC, "Sonic.iso", {"refresh_hz": 0}, "refresh_hz"),
        ):
            with self.subTest(refus=nom), tempfile.TemporaryDirectory() as temporaire:
                erreur, appels, servis, copies = self.lancer(
                    Path(temporaire), titre, rom, **changes
                )
                self.assertIn(message, erreur or "")
                self.assertEqual((appels, servis, copies), ([], [], []))

    def test_le_jumeau_valide_va_jusqu_a_serve_sans_aucune_commande_avant(self):
        with tempfile.TemporaryDirectory() as temporaire:
            erreur, appels, servis, _copies = self.lancer(Path(temporaire))
        self.assertIsNone(erreur)
        self.assertEqual(appels, [])
        (arguments,) = servis
        self.assertEqual(arguments[4].controllers, 4)
        self.assertIs(arguments[5], adaptateur.backup)


class C5Cycle(unittest.TestCase):
    """Le cycle complet par le canari, avec le Docker factice du banc doré."""

    #: Capture, moteur, état, journaux, retrait, PUIS manettes: la copie de
    #: l'emplacement se fait entre l'état et les journaux (stop_engine).
    ARRET = (
        "exec capture_control.py stop",
        "stop moteur",
        "inspect état",
        "logs moteur",
        "rm moteur",
        "stop manettes",
        "logs manettes",
        "rm manettes",
    )

    @staticmethod
    def etape(argv: list[str]) -> str:
        cible = "manettes" if argv[-1].endswith("-pads") else "moteur"
        if argv[-2:] == ["/probe/capture_control.py", "stop"]:
            return "exec capture_control.py stop"
        if argv[1] == "inspect":
            return "inspect état" if "{{json .State}}" in argv else "inspect marche"
        return f"{argv[1]} {cible}"

    def ordre_d_arret(self, commandes: list[dict]) -> list[str]:
        etapes = [self.etape(c["argv"]) for c in commandes if c["appel"] == "run"]
        dernier = max(i for i, e in enumerate(etapes) if e == "inspect marche")
        return etapes[dernier + 1 :]

    def test_confinement_et_ordre_d_arret(self):
        ancien = os.umask(0o022)
        try:
            releve = banc.lancer(scenarios.TOUS["x360-captures"], CANARI)
        finally:
            os.umask(ancien)
        self.assertIsNone(releve["erreur"])
        lances = [c["argv"] for c in releve["commandes"] if c["argv"][:2] == ["docker", "run"]]
        self.assertEqual(len(lances), 2)
        for argv in lances:
            with self.subTest(conteneur=argv[4]):
                for attendu in ("--cap-drop=ALL", "--security-opt=no-new-privileges"):
                    self.assertIn(attendu, argv)
                self.assertEqual(argv[argv.index("--network") + 1], "none")
                self.assertEqual(argv[argv.index("--label") + 1], "nel3ab.room-root=@TMP@/salles/1")
        moteur = lances[1]
        self.assertEqual(moteur[moteur.index("--user") + 1], "@UID@:@GID@")
        self.assertEqual(self.ordre_d_arret(releve["commandes"]), list(self.ARRET))

    def test_des_manettes_arretees_avant_le_moteur_sont_vues(self):
        commandes = [
            {"appel": "run", "argv": ["docker", "inspect", "-f", "{{.State.Running}}", "m"]},
            {"appel": "run", "argv": ["docker", "stop", "--timeout", "5", "m-pads"]},
            {"appel": "run", "argv": ["docker", "stop", "--timeout", "40", "m"]},
        ]
        self.assertEqual(self.ordre_d_arret(commandes), ["stop manettes", "stop moteur"])


class C6Copie(unittest.TestCase):
    def test_la_copie_prend_les_parties_et_pas_le_cache(self):
        with tempfile.TemporaryDirectory() as temporaire:
            slot = Path(temporaire) / "neuve"
            self.assertIsNone(adaptateur.backup(slot), "un emplacement jamais lancé")
            partie = slot / "xenia/content/E030000000000001/534507D6/00000001/SAVE"
            partie.parent.mkdir(parents=True)
            partie.write_bytes(b"partie")
            (slot / "xenia/cache_host").mkdir()
            (slot / "xenia/cache_host/shader.bin").write_bytes(b"cache")
            copie = adaptateur.backup(slot)
            self.assertEqual(
                sorted(p.relative_to(copie).as_posix() for p in copie.rglob("*") if p.is_file()),
                ["content/E030000000000001/534507D6/00000001/SAVE"],
            )


class C7Affichage(unittest.TestCase):
    def test_x11_demande_xwayland_une_seule_fois_et_wayland_jamais(self):
        with tempfile.TemporaryDirectory() as temporaire:
            x11 = adaptateur.preparer(preparation(Path(temporaire)))
        self.assertEqual(x11.environment.count("NEL3AB_SWAY_X11=1"), 1)
        self.assertEqual(x11.environment[x11.environment.index("NEL3AB_SWAY_X11=1") - 1], "-e")
        with tempfile.TemporaryDirectory() as temporaire:
            commune = replace(FICHE, display="wayland")
            wayland = adaptateur.preparer(preparation(Path(temporaire), commune))
        self.assertNotIn("NEL3AB_SWAY_X11=1", wayland.environment)


class Principal(unittest.TestCase):
    def test_principal_charge_tout_son_code_avant_serve_et_aucun_module_d_essai(self):
        """Dans un interpréteur neuf, sans site-packages: ce que la salle a chargé
        quand `serve` commence."""
        code = (
            "import json, sys\n"
            "sys.path.append(sys.argv[1])\n"
            "from moteurs.socle import salle\n"
            "vus = []\n"
            "salle.serve = lambda *a: vus.append(sorted(m for m in sys.modules"
            " if m.split('.')[0] == 'moteurs'))\n"
            "salle.principal('x360', [sys.argv[2], '534507d6', 'neuve', sys.argv[3]],"
            " {'NEL3AB_XBOX360_CONFIG': sys.argv[4]})\n"
            "print(json.dumps(vus))\n"
        )
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            config = racine / "xbox360.json"
            config.write_text(json.dumps(essai.reglages_essai(racine, FICHE)))
            (racine / "Sonic.iso").write_bytes(b"jeu")
            fini = subprocess.run(  # noqa: S603 -- l'interpréteur système, un texte écrit ici
                [
                    "/usr/bin/python3",
                    "-I",
                    "-S",
                    "-B",
                    "-c",
                    code,
                    str(DEPOT),
                    str(racine / "Sonic.iso"),
                    str(racine / "runtime"),
                    str(config),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(fini.returncode, 0, fini.stderr)
        (charges,) = json.loads(fini.stdout)
        self.assertEqual(
            charges,
            [
                "moteurs",
                "moteurs.socle",
                "moteurs.socle.consoles",
                "moteurs.socle.emplacement",
                "moteurs.socle.fiche",
                "moteurs.socle.lancement",
                "moteurs.socle.salle",
                "moteurs.xenia",
                "moteurs.xenia.adaptateur",
            ],
        )

    def test_le_canari_lance_comme_par_le_worker_refuse_avec_le_message_du_socle(self):
        """Un vrai sous-processus, dossier courant core/, chemin du worker, titre faux."""
        with tempfile.TemporaryDirectory() as temporaire:
            fini = subprocess.run(  # noqa: S603 -- l'interpréteur système, un script du dépôt
                [
                    "/usr/bin/python3",
                    str(DEPOT / banc.DEPUIS_LE_WORKER / CANARI),
                    str(Path(temporaire) / "Sonic.iso"),
                    "0100abcdef012000",
                    "neuve",
                    temporaire,
                ],
                cwd=DEPOT / "core",
                env={"PATH": "/usr/bin:/bin", "HOME": temporaire, "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(fini.returncode, 1)
        self.assertIn("ValueError: Invalid Xbox 360 title or save slot", fini.stderr)
        self.assertIn('moteurs/socle/salle.py", line', fini.stderr)
        self.assertIn("in principal", fini.stderr)

    def test_un_socle_venu_d_un_autre_depot_est_refuse(self):
        salle.verifier_origine(str(DEPOT / CANARI))
        with self.assertRaisesRegex(RuntimeError, "le socle chargé vient de"):
            salle.verifier_origine("/opt/autre/docker/xbox360-room-socle.py")

    def test_principal_refuse_un_socle_venu_d_un_autre_depot(self):
        """Un vrai lancement, pas un appel de la fonction: une copie du canari hors du
        dépôt, dont le socle est trouvé plus tôt sur le chemin (PYTHONPATH vers le
        vrai dépôt). principal doit refuser avant le titre, la fiche et la partie."""
        with tempfile.TemporaryDirectory() as temporaire:
            copie = Path(temporaire) / "autre/docker" / Path(CANARI).name
            copie.parent.mkdir(parents=True)
            shutil.copy2(DEPOT / CANARI, copie)
            fins = {}
            for nom, script in (("copie", copie), ("canari", DEPOT / CANARI)):
                fins[nom] = subprocess.run(  # noqa: S603 -- l'interpréteur système, le canari
                    [
                        "/usr/bin/python3",
                        str(script),
                        str(Path(temporaire) / "Sonic.iso"),
                        "0100abcdef012000",
                        "neuve",
                        temporaire,
                    ],
                    cwd=temporaire,
                    env={
                        "PATH": "/usr/bin:/bin",
                        "HOME": temporaire,
                        "PYTHONPATH": str(DEPOT),
                        "PYTHONDONTWRITEBYTECODE": "1",
                    },
                    capture_output=True,
                    text=True,
                    check=False,
                )
        self.assertEqual(fins["copie"].returncode, 1)
        self.assertIn(
            f"RuntimeError: le socle chargé vient de {DEPOT}, "
            f"l'enveloppe de {copie.resolve().parents[1]}",
            fins["copie"].stderr,
        )
        # Le jumeau: le vrai canari, même PYTHONPATH, passe l'origine et va jusqu'au titre.
        self.assertIn("ValueError: Invalid Xbox 360 title or save slot", fins["canari"].stderr)

    def test_un_module_de_moteur_incomplet_est_refuse_avant_toute_partie(self):
        incomplet = SimpleNamespace(TITRE=adaptateur.TITRE, choisir=adaptateur.choisir)
        with (
            patch.object(salle.importlib, "import_module", lambda nom: incomplet),
            self.assertRaisesRegex(TypeError, r"\['preparer', 'backup'\]"),
        ):
            salle.charger_adaptateur("xenia")
        self.assertIs(salle.charger_adaptateur("xenia"), adaptateur)


if __name__ == "__main__":
    unittest.main()
