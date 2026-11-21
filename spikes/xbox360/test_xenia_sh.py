"""Le lanceur du conteneur, avec un faux Xenia: ordre des manettes, journal horodaté."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ICI = Path(__file__).resolve().parent


class Lanceur(unittest.TestCase):
    def test_xenia_gets_the_seats_in_order_and_its_output_is_timestamped(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            (racine / "pads").mkdir()
            (racine / "pads/devices.json").write_text(
                json.dumps(["/dev/input/event12", "/dev/input/event13", "/dev/input/event9"])
            )
            faux = racine / "xenia_edge"
            faux.write_text(
                "#!/bin/sh\n"
                'echo "i> f:0000120 GuestScheduler: repolls 3/s"\n'
                'echo "pads=$SDL_JOYSTICK_DEVICE audio=$SDL_AUDIO_DRIVER '
                'gdk=$GDK_BACKEND args=$*"\n'
            )
            faux.chmod(0o755)
            environ = dict(
                os.environ,
                NEL3AB_PADS_DIR=str(racine / "pads"),
                NEL3AB_RUN_DATA=str(racine / "run-data"),
                NEL3AB_XENIA=str(faux),
                NEL3AB_CAPTURES_S="0",
                XDG_RUNTIME_DIR=str(racine),
            )
            bash = shutil.which("bash")
            self.assertIsNotNone(bash)
            # Le script et ses arguments sont ceux du dépôt, pas une entrée extérieure.
            sortie = subprocess.run(  # noqa: S603
                [bash, str(ICI / "xenia.sh"), "/game/input.iso", "--fullscreen=true"],
                env=environ,
                capture_output=True,
                text=True,
                timeout=30,
                check=True,
            ).stdout
            # La sortie brute continue vers le journal du conteneur.
            self.assertIn("GuestScheduler: repolls 3/s", sortie)
            self.assertIn(
                "pads=/dev/input/event12:/dev/input/event13:/dev/input/event9 "
                "audio=pulseaudio gdk=wayland args=/game/input.iso --fullscreen=true",
                sortie,
            )
            # Le jumeau horodaté: chaque ligne porte l'heure UTC et l'horloge monotone.
            for _ in range(50):
                lignes = (racine / "run-data/xenia-horodate.log").read_text().splitlines()
                if len(lignes) == 2:
                    break
                time.sleep(0.1)
            self.assertEqual(len(lignes), 2)
            forme = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z \d+\.\d{3} ")
            self.assertTrue(all(forme.match(ligne) for ligne in lignes), lignes)
            self.assertTrue(lignes[0].endswith("i> f:0000120 GuestScheduler: repolls 3/s"))


if __name__ == "__main__":
    unittest.main()
