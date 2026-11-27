"""Le compte des images perdues du banc de stabilité (analyse.pertes).

Toutes les conclusions du 27 novembre 2026 sur la fluidité de la Switch 1
reposent sur ce compte : il est éprouvé ici sur des suites d'images fabriquées,
à 60 et à 30 images par seconde, avec et sans trou.
"""

import importlib.util
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location("analyse", Path(__file__).with_name("analyse.py"))
analyse = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(analyse)


def images(periode_ms, n, trous=()):
    """n heures d'images (µs) à une période donnée ; `trous` : (indice, ms en plus)."""
    plus = dict(trous)
    t, sortie = 0.0, []
    for i in range(n):
        sortie.append(int(t * 1000))
        t += periode_ms + plus.get(i, 0.0)
    return sortie


class Pertes(unittest.TestCase):
    def test_100_ms_de_plus_a_60_images_par_seconde_perdent_six_images(self):
        accrocs, perdues = analyse.pertes(images(16.667, 1200, [(600, 100.0)]))
        self.assertEqual(perdues, 6)
        self.assertEqual(len(accrocs), 1)
        self.assertAlmostEqual(accrocs[0]["ms"], 116.667, places=1)

    def test_le_jumeau_un_flux_regulier_a_60_ne_perd_rien(self):
        accrocs, perdues = analyse.pertes(images(16.667, 1200))
        self.assertEqual((accrocs, perdues), ([], 0))

    def test_un_jeu_a_30_images_par_seconde_n_est_pas_un_accroc_continu(self):
        # Ramené à la cadence de 60, chaque écart de 33 ms perdrait une image.
        accrocs, perdues = analyse.pertes(images(33.333, 600))
        self.assertEqual((accrocs, perdues), ([], 0))

    def test_le_jumeau_un_trou_a_30_images_par_seconde_compte_en_periodes_de_30(self):
        accrocs, perdues = analyse.pertes(images(33.333, 600, [(300, 100.0)]))
        self.assertEqual(perdues, 3)
        self.assertEqual(len(accrocs), 1)

    def test_un_retard_d_une_demi_periode_n_est_ni_accroc_ni_perte(self):
        # 25 ms à 60 images par seconde : la compositrice a 120 Hz, une image
        # présentée un tour plus tard n'est pas une image perdue.
        accrocs, perdues = analyse.pertes(images(16.667, 1200, [(600, 8.0)]))
        self.assertEqual((accrocs, perdues), ([], 0))

    def test_le_jumeau_deux_periodes_font_un_accroc_et_une_perte(self):
        accrocs, perdues = analyse.pertes(images(16.667, 1200, [(600, 16.667)]))
        self.assertEqual(perdues, 1)
        self.assertEqual(len(accrocs), 1)


if __name__ == "__main__":
    unittest.main()
