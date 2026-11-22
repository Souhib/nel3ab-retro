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
  script, et un relevé qui nommerait encore un `/home/` ou le compte de la
  machine est refusé;
- chaque scénario est relancé sous un autre compte (`AUTRE_COMPTE`) et doit
  rendre le même doré: la CI ne tourne pas sous 1000:1000;
- le faux sélecteur de l'amorce ne signale la fermeture de stdin qu'à une salle
  qui l'a inscrit, comme un vrai, et une salle sourde est nommée.

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
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).with_name("dore")))

import banc  # noqa: E402 -- dore/ n'est pas un paquet: son chemin vient d'être posé
import scenarios  # noqa: E402 -- même raison que banc, juste au-dessus

DEPOT = banc.DEPOT
ERREURS_D_IMPORT = ("ImportError", "ModuleNotFoundError", "SyntaxError")


#: Un autre compte que celui de cette machine (1000:1000), pour le passage qui
#: prouve que le doré n'en dépend pas. 1001 est l'uid habituel du runner hébergé
#: de GitHub; ce n'est pas vérifié ici, rien n'a été poussé.
AUTRE_COMPTE = (1001, 118)


FILS = min(16, os.cpu_count() or 2)


def soumettre(
    executeur: ThreadPoolExecutor,
    paires: list[tuple[str, str]],
    depot: Path = DEPOT,
    identite: tuple[int, int] | None = None,
) -> dict[tuple[str, str], Future]:
    """Chaque (scénario, script) confié aux fils: un interpréteur neuf par lancement."""
    return {
        (nom, script): executeur.submit(banc.lancer, scenarios.TOUS[nom], script, depot, identite)
        for nom, script in paires
    }


def executer(
    paires: list[tuple[str, str]],
    depot: Path = DEPOT,
    identite: tuple[int, int] | None = None,
) -> dict[tuple[str, str], dict]:
    with ThreadPoolExecutor(max_workers=FILS) as executeur:
        futurs = soumettre(executeur, paires, depot, identite)
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


#: Ce que l'amorce lève quand la salle ne lit pas la fermeture de stdin (amorce.py).
SOURDE = "SalleSourdeError: le worker a fermé stdin, la salle ne l'a pas lu"
#: La ligne qui fait entendre au cycle de la salle l'arrêt demandé par le worker.
ECOUTE = "    selector.register(sys.stdin, selectors.EVENT_READ)\n"
#: La ligne qui retire l'écran d'une partie précédente avant le nouveau moteur.
OUBLI = '        (slot / "display.json").unlink(missing_ok=True)\n'


def ecran_d_hier_garde(releve: dict) -> bool:
    return any(ligne.endswith("/neuve/display.json") for ligne in releve["arbre"])


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
        # Le worker arrête une salle en fermant son stdin, puis attend sans délai
        # (external.rs). Une salle qui ne l'écoute plus ne s'arrête jamais, et la
        # copie de fin de partie n'a pas lieu.
        "switch: la salle n'écoute plus stdin",
        "docker/switch-room.py",
        ECOUTE,
        "",
        "switch-neuve",
        "docker/switch-room.py",
        lambda releve: releve["erreur"] == SOURDE,
    ),
    Mutant(
        "switch: l'écran d'hier n'est plus retiré",
        "docker/switch-room.py",
        OUBLI,
        "",
        "x360-ecran-d-hier",
        "docker/xbox360-room.py",
        ecran_d_hier_garde,
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
        "canari x360: le socle n'écoute plus stdin",
        "moteurs/socle/salle.py",
        ECOUTE,
        "",
        "x360-captures",
        "docker/xbox360-room-socle.py",
        lambda releve: releve["erreur"] == SOURDE,
    ),
    Mutant(
        "canari x360: le socle ne retire plus l'écran d'hier",
        "moteurs/socle/salle.py",
        OUBLI,
        "",
        "x360-ecran-d-hier",
        "docker/xbox360-room-socle.py",
        ecran_d_hier_garde,
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
#: Le modèle des jumeaux du mécanisme, cherché par son nom et non par sa place.
TROIS_PLACES = next(m for m in MUTANTS if m.nom == "switch: trois places au lieu de quatre")


# --- Les essais -----------------------------------------------------------------------

#: Un scénario normal par console, par chacun de ses scripts, et la sonde.
LANCES = [
    (nom, script)
    for nom in ("switch-neuve", "switch2-defaut", "x360-captures", "sonde")
    for script in scenarios.SCRIPTS[nom]
]


def heures(depot: Path) -> dict[str, int]:
    """L'heure de chaque fichier des dossiers d'où les salles chargent du code, hors
    caches d'octets (`test_un_cache_d_octets_reecrit_n_est_pas_une_ecriture_du_banc`)."""
    return {
        str(chemin): chemin.stat().st_mtime_ns
        for dossier in banc.LUS
        for chemin in (depot / dossier).rglob("*")
        if chemin.is_file() and "__pycache__" not in chemin.relative_to(depot).parts
    }


def caches(depot: Path) -> list[str]:
    return sorted(
        chemin.relative_to(depot).as_posix()
        for dossier in banc.LUS
        for chemin in (depot / dossier).rglob("__pycache__")
    )


RELEVES: dict[tuple[str, str], dict] = {}
COPIE: dict[tuple[str, str], dict] = {}
#: Chaque scénario relancé sous `AUTRE_COMPTE`.
AUTRE: dict[tuple[str, str], dict] = {}


MASQUE: list[int] = []


def setUpModule() -> None:
    # Les fichiers des scénarios naissent avec le masque du worker sous systemd:
    # celui du shell (0002 ici) changerait les modes relevés d'une machine à l'autre.
    MASQUE.append(os.umask(0o022))
    paires = toutes_les_paires()
    with tempfile.TemporaryDirectory(prefix="fermeture-") as temporaire:
        copie = banc.copier_fermeture(Path(temporaire) / "depot")
        # Les trois passages dans les mêmes fils: aucun n'attend la fin d'un autre.
        with ThreadPoolExecutor(max_workers=FILS) as executeur:
            passages = [
                (RELEVES, soumettre(executeur, paires)),
                (AUTRE, soumettre(executeur, paires, identite=AUTRE_COMPTE)),
                (COPIE, soumettre(executeur, paires, copie)),
            ]
            for cible, futurs in passages:
                cible.update({cle: futur.result() for cle, futur in futurs.items()})


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

    def test_sous_un_autre_compte_chaque_scenario_rend_le_meme_dore(self):
        """La CI ne tourne pas sous le compte de cette machine. Le 22 novembre 2026,
        trois messages d'erreur gardaient `'--user', '1000:1000'`: tout autre compte
        aurait rendu `check` rouge."""
        self.assertNotEqual(AUTRE_COMPTE, (os.getuid(), os.getgid()))
        self.assertEqual(set(AUTRE), set(RELEVES))
        for (nom, script), releve in AUTRE.items():
            with self.subTest(scenario=nom, script=script):
                self.assertEqual(banc.fuites(releve, AUTRE_COMPTE), [])
                self.assertEqual(releve, banc.lire_dore(nom))

    def test_aucun_releve_ne_nomme_un_dossier_personnel(self):
        for (nom, script), releve in RELEVES.items():
            with self.subTest(scenario=nom, script=script):
                self.assertEqual(banc.fuites(releve), [])

    def test_le_compte_de_la_machine_qui_fuit_est_nomme(self):
        """Le jumeau du contrôle de fuites: un compte resté tel quel dans une erreur."""
        uid, gid = AUTRE_COMPTE
        erreur = f"CalledProcessError: Command '['docker', '--user', '{uid}:{gid}']'"
        self.assertEqual(banc.fuites({"erreur": erreur}, AUTRE_COMPTE), [erreur])
        # Et pas un faux positif: `0:0` ne se lit pas dans une heure.
        self.assertEqual(banc.fuites({"heure": "2026-11-22T00:00:00"}, (0, 0)), [])
        self.assertEqual(banc.fuites({"compte": "--user=0:0"}, (0, 0)), ["--user=0:0"])

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
        """Aucun fichier suivi ni lu par une salle ne change, dans les dossiers lus."""

        def etat() -> tuple[str, dict[str, int]]:
            porcelaine = subprocess.run(  # noqa: S603 -- git, arguments fixes
                ["git", "-C", str(DEPOT), "status", "--porcelain"],  # noqa: S607 -- git trouvé par le PATH
                capture_output=True,
                text=True,
                check=True,
            ).stdout
            return porcelaine, heures(DEPOT)

        avant = etat()
        self.assertTrue(avant[1], "aucun fichier relevé: le contrôle ne regarderait rien")
        executer(LANCES)
        self.assertEqual(etat(), avant)

    def test_un_cache_d_octets_reecrit_n_est_pas_une_ecriture_du_banc(self):
        """Dans l'arbre principal, une salle qui démarre pendant check réécrit un .pyc
        (le worker lance python3 sans -B, external.rs): ce n'est pas le banc. Le
        jumeau: un fichier source réécrit, lui, est vu."""
        with tempfile.TemporaryDirectory() as temporaire:
            depot = Path(temporaire)
            source = depot / "docker/salle.py"
            cache = depot / "docker/__pycache__/salle.cpython-312.pyc"
            cache.parent.mkdir(parents=True)
            source.write_text("x = 1\n")
            cache.write_bytes(b"ancien")
            avant = heures(depot)
            os.utime(cache, ns=(1, 1))
            self.assertEqual(heures(depot), avant)
            os.utime(source, ns=(1, 1))
            self.assertNotEqual(heures(depot), avant)

    def test_le_banc_n_ecrit_aucun_cache_d_octets(self):
        """Ce que l'exclusion ci-dessus ne voit plus, vérifié sur une copie de la
        fermeture, que rien d'autre ne lance: aucun __pycache__ n'y naît. Le jumeau:
        sans PYTHONDONTWRITEBYTECODE, le même lancement en écrit."""
        with tempfile.TemporaryDirectory(prefix="caches-") as temporaire:
            copie = banc.copier_fermeture(Path(temporaire) / "depot")
            self.assertEqual(caches(copie), [])
            executer(LANCES, copie)
            self.assertEqual(caches(copie), [])
            sans = replace(
                scenarios.TOUS["x360-captures"], environnement={"PYTHONDONTWRITEBYTECODE": ""}
            )
            banc.lancer(sans, "docker/xbox360-room-socle.py", copie)
            self.assertIn("moteurs/socle/__pycache__", caches(copie))


def consigne_neutre(dossier: Path) -> Path:
    """La consigne d'un scénario ordinaire, pour lancer par l'amorce un script d'essai."""
    consigne = dossier / "consigne.json"
    consigne.write_text(
        json.dumps(
            {
                "journal": str(dossier / "journal.json"),
                "manettes": 4,
                "arret_apres": None,
                "capture_meurt": False,
                "tours": 3,
                "echec_moteur": False,
                "identite": None,
            }
        )
    )
    return consigne


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
                consigne = consigne_neutre(marque.parent)
                avant = [str(banc.AMORCE), str(consigne)] if amorce else []
                subprocess.run(  # noqa: S603 -- l'interpréteur système, une sonde écrite ici
                    [banc.PYTHON, *avant, str(script), str(marque), "t", "neuve", "r"],
                    cwd=racine,
                    env=env,
                    check=True,
                )
                vus.append(json.loads(marque.with_name("vu.json").read_text()))
            self.assertEqual(vus[1], vus[0])
            self.assertEqual(vus[0]["path"][0], str((racine / "docker").resolve()))
            self.assertEqual(vus[0]["name"], "__main__")

    @staticmethod
    def ecoute(inscrit: bool) -> str:
        """Une salle réduite à sa boucle: voit-elle la fermeture de stdin en vingt tours ?"""
        inscription = "s.register(sys.stdin, selectors.EVENT_READ)\n" if inscrit else ""
        return (
            "import json, selectors, sys\n"
            "from pathlib import Path\n"
            "s = selectors.DefaultSelector()\n"
            f"{inscription}"
            "vu = any(s.select(0.01) for _ in range(20))\n"
            "Path(sys.argv[1]).with_name('vu.json').write_text(json.dumps(vu))\n"
        )

    def test_le_faux_selecteur_voit_la_fermeture_de_stdin_comme_un_vrai(self):
        """stdin est un tube que le worker ferme (external.rs), et un vrai sélecteur
        ne signale sa fermeture qu'à qui l'a inscrit. Le faux de l'amorce doit dire
        la même chose, sinon le doré ne verrait pas une salle sourde à l'arrêt."""
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            vus = {}
            for inscrit in (True, False):
                for amorce in (False, True):
                    dossier = racine / f"{inscrit}-{amorce}"
                    dossier.mkdir()
                    (dossier / "salle.py").write_text(self.ecoute(inscrit))
                    avant = [str(banc.AMORCE), str(consigne_neutre(dossier))] if amorce else []
                    subprocess.run(  # noqa: S603 -- l'interpréteur système, une boucle écrite ici
                        [banc.PYTHON, *avant, str(dossier / "salle.py"), str(dossier / "m")],
                        cwd=racine,
                        env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
                        # Un tube fermé sans rien écrire, comme le worker. epoll refuse
                        # /dev/null (EPERM): DEVNULL ne serait pas le cas réel.
                        input=b"",
                        check=True,
                    )
                    vus[inscrit, amorce] = json.loads((dossier / "vu.json").read_text())
        # (inscrit, par l'amorce): seule l'inscription décide, pas le chemin de lancement.
        attendu = {
            (inscrit, amorce): inscrit for inscrit in (True, False) for amorce in (False, True)
        }
        self.assertEqual(vus, attendu)
        self.assertEqual(sorted(attendu.values()), [False, False, True, True])

    def test_un_module_du_dossier_du_script_masque_ce_que_l_amorce_n_a_pas_charge(self):
        """Un `docker/<module>.py` casse la vraie salle. Pour un module que l'amorce n'a
        pas chargé (`hashlib`), le banc le voit comme le worker. Pour un module qu'elle a
        déjà chargé (`json`), il ne le verrait pas: l'amorce refuse alors en le nommant."""
        vus = {}
        with tempfile.TemporaryDirectory() as temporaire:
            for module in ("json", "hashlib"):
                racine = Path(temporaire) / module
                (racine / "core/crates/worker").mkdir(parents=True)
                (racine / "docker").mkdir()
                (racine / f"docker/{module}.py").write_text(
                    f"raise ImportError('{module} du dossier docker')\n"
                )
                (racine / "docker/salle.py").write_text(f"import {module}\n")
                direct = subprocess.run(  # noqa: S603 -- l'interpréteur système, un faux dépôt
                    [banc.PYTHON, str(racine / banc.DEPUIS_LE_WORKER / "docker/salle.py")],
                    cwd=racine / "core",
                    env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
                    capture_output=True,
                    text=True,
                    check=False,
                )
                releve = banc.lancer(scenarios.TOUS["x360-captures"], "docker/salle.py", racine)
                vus[module] = (direct.stderr.splitlines()[-1], releve["erreur"])
        self.assertEqual(
            vus["hashlib"],
            ("ImportError: hashlib du dossier docker", "ImportError: hashlib du dossier docker"),
        )
        self.assertEqual(vus["json"][0], "ImportError: json du dossier docker")
        self.assertEqual(
            vus["json"][1],
            "AmorceMasqueError: @DEPOT@/docker/json.py masquerait json, que l'amorce a déjà "
            "chargé: le banc ne verrait pas ce que le worker verrait",
        )

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
            runpy = subprocess.run(  # noqa: S603 -- l'interpréteur système, un faux dépôt
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
        with ThreadPoolExecutor(max_workers=FILS) as executeur:
            futurs = {mutant.nom: executeur.submit(verifier, mutant) for mutant in MUTANTS}
        for nom, futur in futurs.items():
            with self.subTest(mutant=nom):
                futur.result()

    def test_un_texte_introuvable_est_une_erreur(self):
        absent = replace(TROIS_PLACES, nom="absent", avant="    for seat in range(1, 6):\n")
        with self.assertRaises(MutantIntrouvableError):
            muter(absent)

    def test_une_erreur_d_import_ne_compte_pas_comme_detection(self):
        casse = replace(
            TROIS_PLACES,
            nom="import cassé",
            avant="import selectors\n",
            apres="import selecteurs\n",
        )
        with self.assertRaisesRegex(MutantNonValableError, "erreur d'import"):
            verifier(casse)

    def test_un_mutant_sans_effet_n_est_pas_une_detection(self):
        neutre = replace(TROIS_PLACES, nom="neutre", apres="    for seat in range(1, 5):  # \n")
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
