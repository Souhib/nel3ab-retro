"""Les règles de ce qu'une salle charge depuis `moteurs/`, vérifiées sur le code.

Trois règles, chacune avec son jumeau:

1. Aucun module chargé par une salle ne lit le manifeste des consoles ni rien
   sous `control/`: un manifeste faux arrêterait sinon toutes les salles
   externes (ADR D22, règle 6). La comparaison au manifeste se fait dans les
   essais.
2. Aucun import dans le corps d'une fonction (ruff PLC0415, aussi lancé par
   `just moteurs-test`): une salle lit tout son code au démarrage, et un import
   paresseux lirait au moment de l'arrêt une version plus récente de main.
3. La bibliothèque standard seulement: une salle tourne sous `/usr/bin/python3`,
   pas dans l'environnement du salon. L'essai importe chaque module sous
   `python3 -I -S`, sans site-packages.
"""

import ast
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

DEPOT = Path(__file__).resolve().parents[2]
MOTEURS = DEPOT / "moteurs"
#: Les modules d'essai, que rien ne charge au lancement d'une salle. Chacun a sa
#: raison; l'essai de la fermeture de `principal` prouve qu'il n'est pas chargé.
ESSAIS = {
    "differentiel.py": "script d'essai du test différentiel",
    "conformite.py": "la série de conformité, qui lit le manifeste",
    "essai.py": "les réglages d'essai d'un moteur",
}
INTERDITS = ("consoles.json", "nel3ab_control")
DOSSIERS_INTERDITS = ("consoles", "control")


def modules_charges_par_une_salle() -> list[Path]:
    return sorted(
        chemin
        for chemin in MOTEURS.rglob("*.py")
        if not chemin.name.startswith("test_") and chemin.name not in ESSAIS
    )


def docstrings(arbre: ast.AST) -> set[int]:
    """Les textes posés seuls en tête d'un module, d'une classe ou d'une fonction."""
    vus = set()
    for noeud in ast.walk(arbre):
        corps = getattr(noeud, "body", None)
        if isinstance(corps, list) and corps and isinstance(corps[0], ast.Expr):
            valeur = corps[0].value
            if isinstance(valeur, ast.Constant) and isinstance(valeur.value, str):
                vus.add(id(valeur))
    return vus


def lectures_interdites(source: str) -> list[str]:
    """Chaque texte ou import qui viserait le manifeste ou le salon (docstrings exclues:
    elles expliquent, elles n'ouvrent rien)."""
    trouves = []
    arbre = ast.parse(source)
    expliques = docstrings(arbre)
    for noeud in ast.walk(arbre):
        if id(noeud) in expliques:
            continue
        if isinstance(noeud, ast.Constant) and isinstance(noeud.value, str):
            texte = noeud.value
            premier = texte.strip("/").split("/")[0]
            if any(interdit in texte for interdit in INTERDITS) or premier in DOSSIERS_INTERDITS:
                trouves.append(texte)
        elif isinstance(noeud, ast.Import):
            trouves += [a.name for a in noeud.names if a.name.split(".")[0] in INTERDITS]
        elif isinstance(noeud, ast.ImportFrom) and (noeud.module or "").split(".")[0] in INTERDITS:
            trouves.append(noeud.module)
    return trouves


def imports_dans_une_fonction(source: str) -> list[str]:
    trouves = []
    for fonction in ast.walk(ast.parse(source)):
        if isinstance(fonction, ast.FunctionDef | ast.AsyncFunctionDef):
            for noeud in ast.walk(fonction):
                if isinstance(noeud, ast.Import | ast.ImportFrom):
                    trouves.append(f"{fonction.name}: ligne {noeud.lineno}")
    return trouves


def nom_de_module(chemin: Path) -> str:
    relatif = chemin.relative_to(DEPOT).with_suffix("")
    parties = relatif.parts[:-1] if relatif.name == "__init__" else relatif.parts
    return ".".join(parties)


def importer_sans_site(
    modules: list[str], chemin: Path = DEPOT
) -> subprocess.CompletedProcess[str]:
    """Importe ces modules sous `/usr/bin/python3 -I -S`, le dépôt en fin de chemin."""
    code = "import importlib, sys\nsys.path.append(sys.argv[1])\n" + "".join(
        f"importlib.import_module({nom!r})\n" for nom in modules
    )
    return subprocess.run(  # noqa: S603 -- l'interpréteur système, un texte écrit ici
        ["/usr/bin/python3", "-I", "-S", "-B", "-c", code, str(chemin)],
        capture_output=True,
        text=True,
        check=False,
    )


class Regles(unittest.TestCase):
    def test_il_y_a_des_modules_a_verifier(self):
        noms = {nom_de_module(c) for c in modules_charges_par_une_salle()}
        self.assertTrue(
            {
                "moteurs.socle.salle",
                "moteurs.socle.lancement",
                "moteurs.socle.consoles",
                "moteurs.socle.fiche",
                "moteurs.xenia.adaptateur",
            }
            <= noms,
            noms,
        )

    def test_aucun_module_d_une_salle_ne_lit_le_manifeste_ni_le_salon(self):
        for chemin in modules_charges_par_une_salle():
            with self.subTest(module=nom_de_module(chemin)):
                self.assertEqual(lectures_interdites(chemin.read_text(encoding="utf-8")), [])

    def test_une_lecture_du_manifeste_ou_du_salon_est_nommee(self):
        for source in (
            'MANIFESTE = DEPOT / "consoles" / "consoles.json"\n',
            'open("consoles/consoles.json")\n',
            'chemin = DEPOT / "control" / "nel3ab_control/consoles.py"\n',
            "from nel3ab_control.consoles import CONSOLES\n",
            "import nel3ab_control\n",
        ):
            with self.subTest(source=source):
                self.assertNotEqual(lectures_interdites(source), [])
        self.assertEqual(lectures_interdites('TOOLS = DEPOT / "spikes/switch-room"\n'), [])
        self.assertEqual(lectures_interdites('"""Ne lit jamais consoles/consoles.json."""\n'), [])

    def test_aucun_import_dans_le_corps_d_une_fonction(self):
        for chemin in sorted(MOTEURS.rglob("*.py")):
            with self.subTest(module=nom_de_module(chemin)):
                self.assertEqual(imports_dans_une_fonction(chemin.read_text(encoding="utf-8")), [])

    def test_un_import_paresseux_est_nomme(self):
        source = "import os\n\ndef arreter():\n    import shutil\n    return shutil\n"
        self.assertEqual(imports_dans_une_fonction(source), ["arreter: ligne 4"])
        self.assertEqual(imports_dans_une_fonction("import os\n\ndef f():\n    return os\n"), [])

    def test_chaque_module_s_importe_avec_la_seule_bibliotheque_standard(self):
        modules = [nom_de_module(c) for c in modules_charges_par_une_salle()]
        fini = importer_sans_site(modules)
        self.assertEqual(fini.returncode, 0, fini.stderr)

    def test_une_dependance_hors_bibliotheque_standard_est_refusee(self):
        """Le jumeau: `cryptography` est dans le venv du salon, pas dans /usr/bin/python3 -S."""
        with tempfile.TemporaryDirectory() as temporaire:
            paquet = Path(temporaire) / "moteurs"
            paquet.mkdir()
            (paquet / "__init__.py").write_text("")
            (paquet / "dependance.py").write_text("import cryptography\n")
            fini = importer_sans_site(["moteurs.dependance"], Path(temporaire))
        self.assertEqual(fini.returncode, 1)
        self.assertIn("ModuleNotFoundError: No module named 'cryptography'", fini.stderr)


if __name__ == "__main__":
    sys.exit(unittest.main())
