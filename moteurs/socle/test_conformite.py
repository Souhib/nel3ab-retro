"""La série de conformité sur le dépôt, puis sur un faux moteur cassé exprès par contrôle."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from moteurs.socle import conformite

DEPOT = conformite.DEPOT
ENVELOPPE = 'from moteurs.socle.salle import principal\n\nprincipal("{code}")\n'


class FauxDepot:
    """Le manifeste, les fiches et les scripts du dépôt, recopiés pour être cassés."""

    def __enter__(self) -> Path:
        self.temporaire = tempfile.TemporaryDirectory()
        racine = Path(self.temporaire.name)
        (racine / "consoles").mkdir()
        shutil.copy(DEPOT / "consoles/consoles.json", racine / "consoles")
        for chemin in DEPOT.glob("moteurs/*/moteur.json"):
            cible = racine / chemin.relative_to(DEPOT)
            cible.parent.mkdir(parents=True)
            shutil.copy(chemin, cible)
        (racine / "docker").mkdir()
        for script in conformite.EN_MIGRATION.values():
            shutil.copy(DEPOT / script, racine / script)
        return racine

    def __exit__(self, *_exception) -> None:
        self.temporaire.cleanup()


def changer_fiche(racine: Path, moteur: str, **champs) -> None:
    chemin = racine / "moteurs" / moteur / "moteur.json"
    brut = json.loads(chemin.read_text(encoding="utf-8"))
    brut.update(champs)
    chemin.write_text(json.dumps(brut), encoding="utf-8")


class Depot(unittest.TestCase):
    def test_le_depot_est_conforme(self):
        self.assertEqual(conformite.ecarts(), [])

    def test_un_faux_depot_intact_est_conforme(self):
        """Le jumeau des cas cassés: la copie seule ne fait rien échouer."""
        with FauxDepot() as racine:
            self.assertEqual(conformite.ecarts(racine), [])


class C1(unittest.TestCase):
    def test_un_executable_renomme_est_nomme(self):
        with FauxDepot() as racine:
            changer_fiche(racine, "eden", executable="usr/bin/eden")
            self.assertEqual(
                conformite.c1_fiches(racine),
                ["C1 eden: le processus eden n'est pas dans le manifeste ['eden-cli']"],
            )

    def test_une_fiche_d_un_moteur_inconnu_est_nommee(self):
        with FauxDepot() as racine:
            inconnu = racine / "moteurs/citron/moteur.json"
            inconnu.parent.mkdir()
            shutil.copy(racine / "moteurs/eden/moteur.json", inconnu)
            changer_fiche(racine, "citron", name="citron")
            self.assertEqual(
                conformite.c1_fiches(racine),
                ["C1 citron: aucun moteur de ce nom dans le manifeste"],
            )

    def test_une_fiche_mal_formee_est_nommee(self):
        with FauxDepot() as racine:
            changer_fiche(racine, "xenia", executable="/usr/bin/xenia_edge")
            (ecart,) = conformite.c1_fiches(racine)
            self.assertTrue(ecart.startswith("C1 xenia:") and "relatif" in ecart, ecart)


class C2(unittest.TestCase):
    def test_une_console_sans_fiche_est_nommee(self):
        with FauxDepot() as racine:
            (racine / "moteurs/eden/moteur.json").unlink()
            self.assertEqual(
                conformite.c2_consoles(racine),
                ["C2 switch2: aucune fiche moteurs/eden/moteur.json"],
            )

    def test_un_moteur_sorti_de_migration_sans_module_ni_enveloppe_est_nomme(self):
        with FauxDepot() as racine:
            hors = {k: v for k, v in conformite.EN_MIGRATION.items() if k != "xenia"}
            self.assertEqual(
                conformite.c2_consoles(racine, hors),
                [
                    "C2 x360: aucun module moteurs/xenia/adaptateur.py",
                    'C2 x360: docker/xbox360-room.py doit appeler principal("x360"), il appelle []',
                ],
            )

    def test_une_enveloppe_qui_lance_une_autre_console_est_nommee(self):
        with FauxDepot() as racine:
            hors = {k: v for k, v in conformite.EN_MIGRATION.items() if k != "xenia"}
            (racine / "moteurs/xenia/adaptateur.py").write_text("")
            (racine / "docker/xbox360-room.py").write_text(ENVELOPPE.format(code="switch"))
            self.assertEqual(
                conformite.c2_consoles(racine, hors),
                [
                    'C2 x360: docker/xbox360-room.py doit appeler principal("x360"), '
                    "il appelle ['switch']"
                ],
            )
            # Le jumeau: la bonne enveloppe passe.
            (racine / "docker/xbox360-room.py").write_text(ENVELOPPE.format(code="x360"))
            self.assertEqual(conformite.c2_consoles(racine, hors), [])


class C12(unittest.TestCase):
    def test_une_entree_perimee_est_nommee(self):
        with FauxDepot() as racine:
            (racine / "docker/xbox360-room.py").write_text(ENVELOPPE.format(code="x360"))
            self.assertEqual(
                conformite.c12_migration(racine),
                [
                    "C12 xenia: docker/xbox360-room.py est déjà une enveloppe du socle, "
                    "entrée périmée"
                ],
            )

    def test_une_entree_qui_ne_nomme_pas_le_script_du_manifeste_est_nommee(self):
        with FauxDepot() as racine:
            faux = {**conformite.EN_MIGRATION, "xenia": "docker/xbox360-room-socle.py"}
            self.assertEqual(
                conformite.c12_migration(racine, faux),
                [
                    "C12 xenia: en migration depuis docker/xbox360-room-socle.py, "
                    "le manifeste lance docker/xbox360-room.py"
                ],
            )

    def test_un_ancien_script_disparu_est_nomme(self):
        with FauxDepot() as racine:
            (racine / "docker/switch2-room.py").unlink()
            self.assertEqual(
                conformite.c12_migration(racine),
                ["C12 eden: docker/switch2-room.py n'existe plus"],
            )


if __name__ == "__main__":
    unittest.main()
