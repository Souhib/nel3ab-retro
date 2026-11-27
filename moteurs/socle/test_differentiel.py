"""Le `serve` du socle et celui de `docker/switch-room.py`: mêmes commandes, partout.

`serve` existe en deux copies jusqu'à la bascule de la Switch. Deux gardes les
tiennent égales:

- chaque scénario doré des trois consoles, rejoué par `differentiel.py` dans un
  interpréteur neuf avec le `serve` du socle, rend son doré;
- les fonctions déplacées telles quelles ont le même arbre syntaxique dans les
  deux fichiers, ce qui couvre aussi les branches qu'aucun scénario ne prend;
- `serve` aussi, instruction par instruction, hors la seule affectation de
  `launch` qui diffère exprès. Le 22 novembre 2026, les délais (10 s pour les
  manettes, 60 s pour les relances de capture) et le retrait du `display.json`
  d'hier pouvaient changer dans le socle seul sans qu'aucun essai ne rougisse:
  aucun scénario ne les rend visibles.

Et le jumeau: un socle modifié exprès est vu, donc le script d'essai sert bien
le `serve` du socle et pas celui d'origine.
"""

import ast
import os
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

DEPOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(DEPOT / "docker/dore"))

import banc  # noqa: E402 -- docker/dore n'est pas un paquet: son chemin vient d'être posé
import scenarios  # noqa: E402 -- même raison que banc, juste au-dessus

PILOTE = "moteurs/socle/differentiel.py"
SWITCH = "docker/switch-room.py"


def par_le_socle(scenario: banc.Scenario, script: str) -> banc.Scenario:
    return replace(
        scenario,
        environnement={**scenario.environnement, "MOTEURS_DIFFERENTIEL": script},
        par_le_worker=False,
    )


def cas() -> list[tuple[str, str]]:
    """Chaque scénario doré servi par un adaptateur d'aujourd'hui, la sonde exceptée."""
    return [
        (nom, scripts[0])
        for nom, scripts in scenarios.SCRIPTS.items()
        if scripts[0].startswith("docker/")
    ]


MASQUE: list[int] = []


def setUpModule() -> None:
    MASQUE.append(os.umask(0o022))


def tearDownModule() -> None:
    os.umask(MASQUE.pop())


class MemesCommandes(unittest.TestCase):
    maxDiff = None

    def test_chaque_scenario_dore_rend_son_dore_avec_le_serve_du_socle(self):
        paires = cas()
        self.assertGreaterEqual(len(paires), 45)
        with ThreadPoolExecutor(max_workers=min(16, os.cpu_count() or 2)) as executeur:
            futurs = {
                nom: executeur.submit(
                    banc.lancer, par_le_socle(scenarios.TOUS[nom], script), PILOTE
                )
                for nom, script in paires
            }
        for nom, futur in futurs.items():
            with self.subTest(scenario=nom):
                self.assertEqual(futur.result(), banc.lire_dore(nom))

    def test_un_socle_modifie_est_vu(self):
        """Le jumeau: les manettes arrêtées avant le moteur dans le socle SEUL."""
        with tempfile.TemporaryDirectory() as temporaire:
            copie = banc.copier_fermeture(Path(temporaire) / "depot")
            salle = copie / "moteurs/socle/salle.py"
            texte = salle.read_text(encoding="utf-8")
            avant = "        try:\n            if started_engine:\n"
            self.assertEqual(texte.count(avant), 1)
            salle.write_text(
                texte.replace(
                    avant,
                    "        try:\n"
                    "            if started_helper:\n"
                    '                run("docker", "stop", "--timeout", "5", helper)\n'
                    "            if started_engine:\n",
                ),
                encoding="utf-8",
            )
            scenario = par_le_socle(scenarios.TOUS["switch-neuve"], SWITCH)
            releve = banc.lancer(scenario, PILOTE, copie)
            # Sans la copie modifiée, ce même lancement rend le doré.
            intact = banc.lancer(scenario, PILOTE)
        self.assertIsNone(releve["erreur"])
        self.assertNotEqual(releve, banc.lire_dore("switch-neuve"))
        self.assertEqual(intact, banc.lire_dore("switch-neuve"))


def definitions(chemin: Path) -> dict[str, ast.AST]:
    return definitions_du_texte(chemin.read_text(encoding="utf-8"))


def definitions_du_texte(texte: str) -> dict[str, ast.AST]:
    return {
        noeud.name: noeud
        for noeud in ast.parse(texte).body
        if isinstance(noeud, ast.FunctionDef | ast.ClassDef)
    }


def affecte_launch(noeud: ast.AST) -> bool:
    """L'écart documenté de `serve`: le plan se calcule autrement, à la même place."""
    return isinstance(noeud, ast.Assign) and [ast.dump(cible) for cible in noeud.targets] == [
        ast.dump(ast.Name("launch", ast.Store()))
    ]


def ecarts_de_serve(socle: str, origine: str) -> list[str]:
    """Ce qui distingue le `serve` du socle de celui de switch-room.py, hors l'écart
    documenté: les noms des paramètres, puis chaque instruction de son corps.

    Les annotations et les valeurs par défaut diffèrent exprès (`launch` et
    `snapshot` exigés): elles ne sont pas comparées. L'affectation de `launch` est
    masquée seulement si elle est unique et à la même place des deux côtés.
    """
    nouveau, ancien = definitions_du_texte(socle)["serve"], definitions_du_texte(origine)["serve"]
    ecarts = []
    if [a.arg for a in nouveau.args.args] != [a.arg for a in ancien.args.args]:
        ecarts.append("paramètres")
    masques = [
        [position for position, noeud in enumerate(corps) if affecte_launch(noeud)]
        for corps in (nouveau.body, ancien.body)
    ]
    if masques[0] != masques[1] or len(masques[0]) != 1:
        ecarts.append(f"affectations de launch aux places {masques[0]} et {masques[1]}")
    if len(nouveau.body) != len(ancien.body):
        ecarts.append(f"{len(nouveau.body)} instructions contre {len(ancien.body)}")
    for position, (a, b) in enumerate(zip(nouveau.body, ancien.body, strict=False)):
        if position in masques[0] and position in masques[1]:
            continue
        if ast.dump(a) != ast.dump(b):
            ecarts.append(f"instruction {position + 1}, ligne {a.lineno} du socle")
    return ecarts


class MemeTexte(unittest.TestCase):
    def test_les_fonctions_deplacees_telles_quelles_sont_identiques(self):
        origine = definitions(DEPOT / SWITCH)
        socle = {
            **definitions(DEPOT / "moteurs/socle/emplacement.py"),
            **definitions(DEPOT / "moteurs/socle/lancement.py"),
            **definitions(DEPOT / "moteurs/socle/salle.py"),
        }
        for nom in (
            "run",
            "pad_command",
            "cpu_pinning",
            "engine_environment",
            "EngineLaunch",
            # Le 27 novembre 2026: la règle des relances de capture (CAP-7).
            "CaptureRestarts",
            # Le 22 novembre 2026: l'hôte ne suit aucun lien de l'emplacement.
            "descendre",
            "ouvrir_sans_lien",
            "dossier_sans_lien",
            "sans_lien",
        ):
            with self.subTest(fonction=nom):
                self.assertEqual(ast.dump(socle[nom]), ast.dump(origine[nom]))
        # `stop_engine` perd seulement sa valeur par défaut (la copie de Ryubing).
        self.assertEqual(
            [ast.dump(n) for n in socle["stop_engine"].body],
            [ast.dump(n) for n in origine["stop_engine"].body],
        )
        self.assertEqual(
            [a.arg for a in socle["stop_engine"].args.args],
            [a.arg for a in origine["stop_engine"].args.args],
        )

    def test_serve_est_le_meme_hors_l_ecart_documente(self):
        self.assertEqual(
            ecarts_de_serve(
                (DEPOT / "moteurs/socle/salle.py").read_text(encoding="utf-8"),
                (DEPOT / SWITCH).read_text(encoding="utf-8"),
            ),
            [],
        )

    def test_un_serve_qui_derive_dans_le_socle_seul_est_nomme(self):
        """Les jumeaux: trois écarts qu'aucun scénario doré ne rend visibles, et une
        seconde affectation de `launch` que le masque ne doit pas couvrir."""
        socle = (DEPOT / "moteurs/socle/salle.py").read_text(encoding="utf-8")
        origine = (DEPOT / SWITCH).read_text(encoding="utf-8")
        for nom, avant, apres in (
            ("délai des manettes", "time.monotonic() + 10\n", "time.monotonic() + 5\n"),
            (
                "relance refusée sans arrêt",
                "                    raise RuntimeError(refused)\n",
                "                    pass\n",
            ),
            ("écran d'hier gardé", '(slot / "display.json").unlink(missing_ok=True)\n', "\n"),
            # Le masque ne couvre qu'UNE affectation de launch, à sa place.
            (
                "plan affecté deux fois",
                "    uid, gid = str(",
                "    launch = launch\n    uid, gid = str(",
            ),
        ):
            with self.subTest(ecart=nom):
                self.assertEqual(socle.count(avant), 1)
                self.assertNotEqual(ecarts_de_serve(socle.replace(avant, apres), origine), [])

    def test_une_fonction_qui_derive_est_nommee(self):
        """Le jumeau: le même garde sur un `pad_command` changé d'un seul côté, et
        sur la fenêtre des relances, sortie de `serve` le 27 novembre 2026."""
        texte = (DEPOT / "moteurs/socle/lancement.py").read_text(encoding="utf-8")
        for nom, avant, apres in (
            ("pad_command", '"--pids-limit=32"', '"--pids-limit=64"'),
            ("CaptureRestarts", "now - at < 60]", "now - at < 20]"),
            ("CaptureRestarts", "self.blank >= 2", "self.blank >= 3"),
        ):
            with self.subTest(fonction=nom, avant=avant):
                self.assertEqual(texte.count(avant), 1)
                derive = texte.replace(avant, apres)
                origine = definitions(DEPOT / SWITCH)[nom]
                self.assertNotEqual(ast.dump(definitions_du_texte(derive)[nom]), ast.dump(origine))


if __name__ == "__main__":
    unittest.main()
