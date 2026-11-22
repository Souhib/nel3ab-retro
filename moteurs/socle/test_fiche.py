"""La fiche d'un moteur: chaque refus, et le jumeau qui passe."""

import json
import tempfile
import unittest
from pathlib import Path, PurePosixPath

from moteurs.socle import fiche

MOTEURS = Path(__file__).resolve().parents[1]
BONNE = {
    "name": "xenia",
    "executable": "usr/bin/xenia_edge",
    "display": "x11",
    "pad_layout": "xbox",
    "why": {"display": "Une raison mesurée.", "pad_layout": "Une autre raison."},
}


class Lecture(unittest.TestCase):
    def test_les_trois_fiches_du_depot_se_lisent(self):
        lues = {chemin.parent.name: fiche.lire(chemin) for chemin in MOTEURS.glob("*/moteur.json")}
        self.assertEqual(sorted(lues), ["eden", "ryubing", "xenia"])
        self.assertEqual(lues["xenia"].process, "xenia_edge")
        self.assertEqual(lues["ryubing"].executable, PurePosixPath("publish/Ryujinx"))

    def test_le_processus_est_le_nom_tronque_a_quinze_caracteres(self):
        longue = fiche.depuis({**BONNE, "executable": "bin/dolphin-emu-nogui"}, "xenia")
        self.assertEqual(longue.process, "dolphin-emu-nog")

    def test_une_fiche_bien_formee_passe(self):
        self.assertEqual(fiche.depuis(BONNE, "xenia").display, "x11")
        # Wayland est le cas commun des salles: il ne demande pas de raison.
        commune = {**BONNE, "display": "wayland", "why": {}}
        self.assertEqual(fiche.depuis(commune, "xenia").why, {})

    def test_chaque_faute_est_refusee_et_nommee(self):
        sans_why = {cle: valeur for cle, valeur in BONNE.items() if cle != "why"}
        for nom, brut, motif in (
            ("chemin absolu", {**BONNE, "executable": "/usr/bin/xenia_edge"}, "relatif"),
            ("remontée", {**BONNE, "executable": "usr/../../bin/sh"}, r"'\.\.'"),
            ("segment vide", {**BONNE, "executable": "usr//bin/xenia_edge"}, "'//'"),
            ("exécutable vide", {**BONNE, "executable": ""}, "non vide"),
            ("clé inconnue", {**BONNE, "saves": []}, "inconnues \\['saves'\\]"),
            ("clé manquante", sans_why, "manquantes \\['why'\\]"),
            ("x11 sans raison", {**BONNE, "why": {"pad_layout": "x"}}, "why.display"),
            ("affichage inconnu", {**BONNE, "display": "cage"}, "display vaut"),
            ("disposition inconnue", {**BONNE, "pad_layout": "nes"}, "pad_layout vaut"),
            ("autre dossier", {**BONNE, "name": "eden"}, "nom de son dossier"),
            (
                "raison d'un champ absent",
                {**BONNE, "why": {**BONNE["why"], "caches": "x"}},
                "caches",
            ),
            ("raison vide", {**BONNE, "why": {"display": "  "}}, "why.display doit dire"),
            ("pas un objet", [BONNE], "objet JSON"),
        ):
            with self.subTest(faute=nom), self.assertRaisesRegex(fiche.FicheInvalideError, motif):
                fiche.depuis(brut, "xenia")

    def test_un_fichier_illisible_ou_trop_gros_est_refuse_avec_son_chemin(self):
        with tempfile.TemporaryDirectory() as temporaire:
            chemin = Path(temporaire) / "xenia/moteur.json"
            chemin.parent.mkdir()
            chemin.write_text("{ pas du json")
            with self.assertRaisesRegex(fiche.FicheInvalideError, "xenia/moteur.json"):
                fiche.lire(chemin)
            chemin.write_text(json.dumps({**BONNE, "why": {"display": "x" * fiche.TAILLE_MAX}}))
            with self.assertRaisesRegex(fiche.FicheInvalideError, "octets"):
                fiche.lire(chemin)
            chemin.write_text(json.dumps(BONNE))
            self.assertEqual(fiche.lire(chemin).name, "xenia")


if __name__ == "__main__":
    unittest.main()
