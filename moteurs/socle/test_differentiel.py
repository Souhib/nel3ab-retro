"""Le `serve` du socle et celui de `docker/switch-room.py`: mêmes commandes, partout.

`serve` existe en deux copies jusqu'à la bascule de la Switch. Deux gardes les
tiennent égales:

- chaque scénario doré des trois consoles, rejoué par `differentiel.py` dans un
  interpréteur neuf avec le `serve` du socle, rend son doré;
- les fonctions déplacées telles quelles ont le même arbre syntaxique dans les
  deux fichiers, ce qui couvre aussi les branches qu'aucun scénario ne prend.

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
import scenarios  # noqa: E402

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
    arbre = ast.parse(chemin.read_text(encoding="utf-8"))
    return {
        noeud.name: noeud
        for noeud in arbre.body
        if isinstance(noeud, ast.FunctionDef | ast.ClassDef)
    }


class MemeTexte(unittest.TestCase):
    def test_les_fonctions_deplacees_telles_quelles_sont_identiques(self):
        origine = definitions(DEPOT / SWITCH)
        socle = {
            **definitions(DEPOT / "moteurs/socle/lancement.py"),
            **definitions(DEPOT / "moteurs/socle/salle.py"),
        }
        for nom in ("run", "pad_command", "cpu_pinning", "engine_environment", "EngineLaunch"):
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

    def test_une_fonction_qui_derive_est_nommee(self):
        """Le jumeau: le même garde sur un `pad_command` changé d'un seul côté."""
        origine = definitions(DEPOT / SWITCH)["pad_command"]
        texte = (DEPOT / "moteurs/socle/lancement.py").read_text(encoding="utf-8")
        derive = texte.replace('"--pids-limit=32"', '"--pids-limit=64"')
        self.assertNotEqual(derive, texte)
        change = {n.name: n for n in ast.parse(derive).body if isinstance(n, ast.FunctionDef)}[
            "pad_command"
        ]
        self.assertNotEqual(ast.dump(change), ast.dump(origine))


if __name__ == "__main__":
    unittest.main()
