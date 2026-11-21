"""Exercise real child exits, including a child that ignores window closure."""

# All subprocess arguments below are fixed test programs and a fresh tempdir.
# ruff: noqa: S603

import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from supervise import refresh_hz, sway_config, wait_game, x11_wanted, x_display


class Shutdown(unittest.TestCase):
    def test_close_lets_the_child_finish_its_save(self):
        with tempfile.TemporaryDirectory() as directory:
            close = Path(directory) / "close"
            save = Path(directory) / "save"
            code = (
                "import pathlib,time,sys; root=pathlib.Path(sys.argv[1]); "
                "\nwhile not (root/'close').exists(): time.sleep(.01)"
                "\n(root/'save').write_text('finished')"
            )
            stop = threading.Event()
            stop.set()
            with subprocess.Popen([sys.executable, "-c", code, directory]) as child:

                def request(pid):
                    self.assertEqual(pid, child.pid)
                    close.touch()
                    return True

                report = wait_game(child, request, stop, timeout=5)
            self.assertEqual(save.read_text(), "finished")
            self.assertEqual(report["exit_code"], 0)
            self.assertTrue(report["window_closed"])
            self.assertFalse(report["forced"])

    def test_a_child_that_ignores_close_is_a_failure(self):
        stop = threading.Event()
        stop.set()
        with subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"]) as child:
            report = wait_game(child, lambda _: False, stop, timeout=0.2)
        self.assertEqual(report["exit_code"], 137)
        self.assertTrue(report["forced"])
        self.assertFalse(report["window_closed"])

    def test_a_lost_display_does_not_leave_the_game_running(self):
        with subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"]) as child:
            report = wait_game(child, lambda _: False, threading.Event(), healthy=lambda: False)
        self.assertEqual(report["exit_code"], 137)
        self.assertTrue(report["forced"])
        self.assertFalse(report["window_closed"])

    def test_a_crash_is_not_reported_as_a_clean_stop(self):
        with subprocess.Popen([sys.executable, "-c", "raise SystemExit(139)"]) as child:
            report = wait_game(child, lambda _: True, threading.Event())
        self.assertEqual(report["exit_code"], 139)
        self.assertFalse(report["stop_requested"])
        self.assertFalse(report["forced"])


if __name__ == "__main__":
    unittest.main()


class SwayConfig(unittest.TestCase):
    def test_the_headless_output_carries_its_refresh_rate(self):
        # Without it wlroots composes at whatever rate load allows: 31.5 fps on
        # the real room against 58.9 on a probe with the rate written, same
        # screen, same machine, same moment (2026-09-09).
        config = sway_config()
        self.assertIn("output HEADLESS-1 mode 1280x720@60Hz\n", config)

    def test_a_rate_of_zero_is_never_written(self):
        # The negative twin: the defect was a mode line with no rate at all,
        # which wlroots reads as zero. A regression that dropped the suffix, or
        # wrote "@0Hz", must fail here rather than in a living room.
        config = sway_config()
        line = next(l for l in config.splitlines() if l.startswith("output HEADLESS-1"))
        self.assertRegex(line, r"@[1-9]\d*Hz$")
        self.assertNotIn("@0Hz", config)

    def test_the_room_chooses_the_rate_and_sixty_is_the_default(self):
        self.assertEqual(refresh_hz({}), 60)
        self.assertEqual(refresh_hz({"SWITCH_REFRESH_HZ": "120"}), 120)
        self.assertIn("mode 1280x720@120Hz\n", sway_config(refresh_hz=refresh_hz({"SWITCH_REFRESH_HZ": "120"})))

    def test_a_rate_outside_the_range_or_not_a_whole_number_is_refused(self):
        # Refused rather than clamped: a typo in the room's configuration must
        # stop the game with its name, not quietly run at another rate.
        for bad in ("0", "29", "241", "abc", "59.94", ""):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                refresh_hz({"SWITCH_REFRESH_HZ": bad})

    def test_the_switch_room_keeps_its_exact_configuration(self):
        # The Xbox 360 option must not reach the Switch room, which shares this
        # file: same lines, same order, no Xwayland, every window full screen.
        self.assertFalse(x11_wanted({}))
        self.assertEqual(
            sway_config(),
            "output HEADLESS-1 mode 1280x720@60Hz\n"
            "default_border none\n"
            "focus_follows_mouse no\n"
            'for_window [app_id=".*"] fullscreen enable\n'
            "seat seat0 hide_cursor 1\n"
            "xwayland disable\n",
        )

    def test_an_x11_engine_gets_xwayland_and_makes_itself_full_screen(self):
        # Forced full screen made wxWidgets ignore Xenia's own request, which is
        # the one that hides its menu bar (2026-11-21).
        config = sway_config(x11=x11_wanted({"NEL3AB_SWAY_X11": "1"}))
        self.assertIn("xwayland force\n", config)
        self.assertNotIn("xwayland disable", config)
        self.assertNotIn("fullscreen", config)
        self.assertIn("output HEADLESS-1 mode 1280x720@60Hz\n", config)

    def test_an_unclear_x11_choice_is_refused(self):
        self.assertFalse(x11_wanted({"NEL3AB_SWAY_X11": "0"}))
        for bad in ("", "yes", "true", "2", " 1"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                x11_wanted({"NEL3AB_SWAY_X11": bad})


class XDisplay(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.open = []

    def tearDown(self):
        for listener in self.open:
            listener.close()
        self.temporary.cleanup()

    def listen(self, name):
        listener = socket.socket(socket.AF_UNIX)
        listener.bind(str(self.directory / name))
        self.open.append(listener)

    def test_no_socket_yet_means_no_display(self):
        self.assertIsNone(x_display(self.directory))

    def test_the_one_x_socket_names_the_display(self):
        self.listen("X1")
        self.assertEqual(x_display(self.directory), ":1")

    def test_a_lock_file_or_a_stray_name_is_not_a_display(self):
        (self.directory / "X0").write_text("not a socket")
        self.listen("Xlock")
        self.assertIsNone(x_display(self.directory))

    def test_two_displays_stop_the_room(self):
        self.listen("X0")
        self.listen("X1")
        with self.assertRaises(RuntimeError):
            x_display(self.directory)
