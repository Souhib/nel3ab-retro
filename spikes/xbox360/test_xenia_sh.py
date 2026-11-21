"""Le lanceur du conteneur, avec un faux Xenia: ordre des manettes, journal horodaté."""

import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ICI = Path(__file__).resolve().parent


class Lanceur(unittest.TestCase):
    def setUp(self):
        self.temporaire = tempfile.TemporaryDirectory()
        self.racine = Path(self.temporaire.name)
        (self.racine / "pads").mkdir()
        (self.racine / "pads/devices.json").write_text(
            json.dumps(["/dev/input/event12", "/dev/input/event13", "/dev/input/event9"])
        )
        self.faux = self.racine / "xenia_edge"
        self.faux.write_text(
            "#!/bin/sh\n"
            'echo "i> f:0000120 GuestScheduler: repolls 3/s"\n'
            'echo "pads=$SDL_JOYSTICK_DEVICE audio=$SDL_AUDIO_DRIVER '
            'gdk=$GDK_BACKEND display=$DISPLAY args=$*"\n'
            'sleep "${FAUX_DUREE:-0}"\n'
        )
        self.faux.chmod(0o755)
        self.environ = dict(
            os.environ,
            NEL3AB_PADS_DIR=str(self.racine / "pads"),
            NEL3AB_RUN_DATA=str(self.racine / "run-data"),
            NEL3AB_XENIA=str(self.faux),
            NEL3AB_CAPTURES_S="0",
            XDG_RUNTIME_DIR=str(self.racine),
            DISPLAY=":0",
        )
        self.bash = shutil.which("bash")
        self.assertIsNotNone(self.bash)

    def tearDown(self):
        self.temporaire.cleanup()

    def lancer(self, environ):
        # Le script et ses arguments sont ceux du dépôt, pas une entrée extérieure.
        return subprocess.run(  # noqa: S603
            [self.bash, str(ICI / "xenia.sh"), "/game/input.iso", "--fullscreen=true"],
            env=environ,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

    def test_xenia_gets_the_seats_in_order_x11_and_its_output_is_timestamped(self):
        sortie = self.lancer(self.environ)
        self.assertEqual(sortie.returncode, 0, sortie.stderr)
        # La sortie brute continue vers le journal du conteneur.
        self.assertIn("GuestScheduler: repolls 3/s", sortie.stdout)
        self.assertIn(
            "pads=/dev/input/event12:/dev/input/event13:/dev/input/event9 "
            "audio=pulseaudio gdk=x11 display=:0 args=/game/input.iso --fullscreen=true",
            sortie.stdout,
        )
        # Le jumeau horodaté: chaque ligne porte l'heure UTC et l'horloge monotone.
        for _ in range(50):
            lignes = (self.racine / "run-data/xenia-horodate.log").read_text().splitlines()
            if len(lignes) == 2:
                break
            time.sleep(0.1)
        self.assertEqual(len(lignes), 2)
        forme = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z \d+\.\d{3} ")
        self.assertTrue(all(forme.match(ligne) for ligne in lignes), lignes)
        self.assertTrue(lignes[0].endswith("i> f:0000120 GuestScheduler: repolls 3/s"))

    def test_without_an_x_display_xenia_never_starts(self):
        # Le jumeau négatif: sans DISPLAY, GTK retomberait sur Wayland, le
        # chemin qui a figé l'image. Le lanceur s'arrête avant Xenia.
        environ = {k: v for k, v in self.environ.items() if k != "DISPLAY"}
        sortie = self.lancer(environ)
        self.assertNotEqual(sortie.returncode, 0)
        self.assertIn("DISPLAY", sortie.stderr)
        self.assertNotIn("GuestScheduler", sortie.stdout)
        self.assertFalse((self.racine / "run-data/xenia-horodate.log").exists())

    def captures(self, grim):
        """Lance avec une capture par seconde et un faux grim; rend le dossier."""
        outils = self.racine / "outils"
        outils.mkdir()
        (outils / "grim").write_text(grim)
        (outils / "grim").chmod(0o755)
        environ = dict(
            self.environ,
            PATH=f"{outils}:{os.environ['PATH']}",
            NEL3AB_CAPTURES_S="1",
            FAUX_DUREE="2.5",
        )
        dossier = self.racine / "run-data/captures"
        with (self.racine / "sortie.log").open("w") as sortie:
            # La boucle de capture survit au faux Xenia, comme dans un conteneur
            # qui s'arrête ensuite: son groupe de processus est tué à la fin.
            lanceur = subprocess.Popen(  # noqa: S603
                [self.bash, str(ICI / "xenia.sh"), "/game/input.iso"],
                env=environ,
                stdout=sortie,
                stderr=sortie,
                start_new_session=True,
            )
            try:
                self.assertEqual(lanceur.wait(timeout=30), 0)
            finally:
                os.killpg(lanceur.pid, signal.SIGKILL)
        return dossier

    def test_captures_are_png_files_named_by_time(self):
        dossier = self.captures('#!/bin/sh\nfor a; do last=$a; done\necho "$*" > "$last"\n')
        images = sorted(dossier.glob("*.png"))
        self.assertGreaterEqual(len(images), 1)
        self.assertRegex(images[0].name, r"^\d{8}T\d{6}Z\.png$")
        self.assertTrue(images[0].read_text().startswith("-t png -l 3 "))
        self.assertEqual(list(dossier.glob("*.jpg")), [])

    def test_a_failing_capture_leaves_its_reason(self):
        # Le 21 novembre 2026, grim refusait le JPEG et sa réponse partait dans
        # /dev/null: trois minutes de partie, zéro capture, aucune trace.
        dossier = self.captures("#!/bin/sh\necho 'jpeg support disabled' >&2\nexit 1\n")
        self.assertEqual(list(dossier.glob("*.png")), [])
        self.assertIn("jpeg support disabled", (dossier / "grim.log").read_text())


if __name__ == "__main__":
    unittest.main()
