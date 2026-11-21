"""La cadence relue sur un faux journal, dont on connaît la réponse."""

import importlib.util
import sys
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("releve", Path(__file__).with_name("releve.py"))
releve = importlib.util.module_from_spec(spec)
sys.modules["releve"] = releve  # une dataclass retrouve son module par ce nom
spec.loader.exec_module(releve)


def journal(cadences: list[int]) -> list[str]:
    """Une ligne par seconde, avec `cadences[n]` images présentées pendant la seconde n."""
    lignes = ["2026-11-21T20:00:00.000000Z 99.000 i> f:0000000 Loading module GAME:\\default.xex"]
    image = 0
    for seconde, cadence in enumerate(cadences):
        image += cadence
        mono = 100.0 + seconde + 1
        lignes.append(
            f"2026-11-21T20:00:{seconde + 1:02d}.000000Z {mono:.3f} i> f:{image:07d} 00000040 "
            "GuestScheduler: repolls 3/s"
        )
    return lignes


class Releve(unittest.TestCase):
    def test_a_steady_thirty_reads_thirty_everywhere(self):
        sortie = releve.fenetres(journal([30] * 20), 5.0)
        self.assertTrue(sortie)
        self.assertTrue(all(f.ips == 30.0 for f in sortie), sortie)

    def test_a_slow_patch_is_found_where_it_happened(self):
        # Le jumeau: dix secondes à 30, dix à 12, puis 30. Une fenêtre entière tombe
        # dans la partie lente et doit sortir à 12; la moyenne ne doit pas la cacher.
        sortie = releve.fenetres(journal([30] * 10 + [12] * 10 + [30] * 10), 5.0)
        self.assertEqual(min(f.ips for f in sortie), 12.0)
        self.assertIn("minimum 12.0", releve.resume(sortie))

    def test_loading_before_the_first_frame_is_not_a_cadence(self):
        lignes = journal([0, 0, 0] + [30] * 10)
        sortie = releve.fenetres(lignes, 5.0)
        self.assertTrue(all(f.ips == 30.0 for f in sortie), sortie)

    def test_an_empty_or_frameless_log_says_so(self):
        self.assertEqual(
            releve.resume(releve.fenetres([], 5.0)), "Aucune image présentée dans ce journal."
        )


if __name__ == "__main__":
    unittest.main()
