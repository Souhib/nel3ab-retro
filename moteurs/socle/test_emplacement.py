"""L'emplacement: les noms que le worker envoie passent, les chemins détournés non."""

import json
import tempfile
import unittest
from pathlib import Path

from moteurs.socle import emplacement

VECTEURS = Path(__file__).resolve().parents[2] / "core/crates/emulator/person-key-vectors.json"


class Nom(unittest.TestCase):
    def test_chaque_dossier_personnel_du_worker_passe(self):
        """Les vecteurs que saves.rs et le salon partagent (saves::folder_for)."""
        dossiers = [
            vecteur["dossier"]
            for vecteur in json.loads(VECTEURS.read_text(encoding="utf-8"))["vecteurs"]
            if vecteur["dossier"] is not None
        ]
        self.assertGreaterEqual(len(dossiers), 5)
        for dossier in [*dossiers, "neuve", "debloquee"]:
            with self.subTest(dossier=dossier):
                self.assertTrue(emplacement.valide(dossier))

    def test_un_chemin_detourne_ou_inconnu_est_refuse(self):
        for mauvais in (
            "joueur-../x",
            # Un premier caractère valide ne doit rien ouvrir derrière lui.
            "joueur-a/../../x",
            "joueur-a/b",
            "joueur-a.b",
            "neuve/x",
            "..",
            "",
            "joueur-",
            "joueur-Ami",
            "neuve\n",
            "/neuve",
            "partagee",
        ):
            with self.subTest(mauvais=mauvais):
                self.assertFalse(emplacement.valide(mauvais))

    def test_le_chemin_met_le_titre_en_minuscules_sous_l_etat_resolu(self):
        with tempfile.TemporaryDirectory() as temporaire:
            lien = Path(temporaire) / "lien"
            (Path(temporaire) / "vrai").mkdir()
            lien.symlink_to(Path(temporaire) / "vrai")
            self.assertEqual(
                emplacement.chemin(str(lien), "534507D6", "neuve"),
                (Path(temporaire) / "vrai").resolve() / "534507d6/neuve",
            )


class Verrou(unittest.TestCase):
    def test_un_emplacement_tenu_refuse_une_seconde_partie(self):
        with tempfile.TemporaryDirectory() as temporaire:
            slot = Path(temporaire) / "state/534507d6/neuve"
            with emplacement.tenu(slot):
                self.assertTrue((slot / "running.lock").is_file())
                with self.assertRaises(BlockingIOError), emplacement.tenu(slot):
                    pass
                # Le jumeau: un autre emplacement du même jeu reste libre.
                with emplacement.tenu(slot.with_name("joueur-ami")):
                    pass
            # Relâché à la sortie: la partie suivante le prend.
            with emplacement.tenu(slot):
                pass


if __name__ == "__main__":
    unittest.main()
