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


def capture(seconde: int, champs: str) -> str:
    """Une ligne du journal du worker, comme `journalctl -o short-iso-precise` l'écrit."""
    return f"2026-11-21T20:00:{seconde:02d}.500000+00:00 hote nel3ab-worker[42]: {champs}"


def cinq_secondes(seconde: int, images: int = 300, pire: float = 32.3) -> str:
    return capture(
        seconde,
        f'{{"half": false, "capture_age_ms": 3.8, "frames": {images}, '
        f'"gap_ms": [16.1, 16.2, {pire}]}}',
    )


class ImageEtJeu(unittest.TestCase):
    """Ce que la salle a reçu, rapproché du compteur du jeu (21 novembre 2026)."""

    def test_a_picture_that_stops_while_the_game_runs_is_named(self):
        # Le premier essai de Sonic: le jeu à 60, la capture silencieuse.
        jeu = journal([60] * 40)
        vues = releve.captures(
            [cinq_secondes(5), cinq_secondes(10), capture(14, '{"capture_quiet": "full"}')]
        )
        rapport = releve.image_et_jeu(jeu, vues)
        self.assertIn("IMAGE FIGÉE PENDANT QUE LE JEU TOURNAIT: 1 fois", rapport)
        self.assertIn("silences de la capture: 1", rapport)

    def test_a_silence_while_the_game_itself_stopped_is_not_a_frozen_picture(self):
        # Le jumeau: un chargement où le jeu ne présente plus rien. L'image
        # s'arrête avec lui; l'affichage n'y est pour rien.
        jeu = journal([60] * 10 + [0] * 10 + [60] * 10)
        vues = releve.captures([cinq_secondes(5), capture(15, '{"capture_quiet": "full"}')])
        rapport = releve.image_et_jeu(jeu, vues)
        self.assertIn("image figée pendant que le jeu tournait: jamais", rapport)
        self.assertIn("silences de la capture: 1", rapport)

    def test_a_gap_is_put_on_the_game_only_when_the_game_slowed(self):
        # Seconde 8 lente côté jeu: le trou de la tranche qui finit à 10 lui
        # revient. Le trou de la tranche qui finit à 20 tombe sur un jeu à 60.
        jeu = journal([60] * 7 + [6] + [60] * 20)
        vues = releve.captures(
            [cinq_secondes(10, 250, 1075.5), cinq_secondes(15), cinq_secondes(20, 270, 640.0)]
        )
        rapport = releve.image_et_jeu(jeu, vues)
        self.assertIn("trous de plus de 500 ms dans l'image reçue: 2, dont 1 pendant", rapport)

    def test_only_capture_lines_are_read(self):
        lignes = [
            capture(1, '{"timestamp": "x", "level": "INFO", "fields": {"message": "salle"}}'),
            capture(2, "{pas du json}"),
            "-- Boot 0123 --",
            cinq_secondes(3, 301),
            capture(4, '{"capture_child_forced": 1973}'),
        ]
        vues = releve.captures(lignes)
        self.assertEqual(
            [(v.images, v.silence, v.relance) for v in vues],
            [(301, False, False), (None, False, True)],
        )

    def test_no_capture_line_is_said_not_read_as_fine(self):
        self.assertIn("aucune ligne de capture", releve.image_et_jeu(journal([60] * 5), []))

    def test_the_bounds_cover_the_whole_game_in_unix_seconds(self):
        lignes = journal([60] * 3)
        debut, fin = releve.bornes(lignes)
        self.assertEqual(debut, 1795291200)
        self.assertEqual(fin, 1795291203)
        self.assertIsNone(releve.bornes(["pas d'heure ici"]))


if __name__ == "__main__":
    unittest.main()
