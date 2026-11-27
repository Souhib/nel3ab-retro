"""No real waiting or room: the policy uses a controllable monotonic clock."""

import unittest

import capture_health as health
from capture_health import FAIL_AFTER, WARN_AFTER, Progress


class HealthTests(unittest.TestCase):
    def test_never_started_warns_once_then_fails_at_the_start_limit(self):
        # Until 2026-11-27 this producer failed at FAIL_AFTER, the bound that
        # killed a healthy Smash capture during its 15.9 s of shader loading.
        now = 0.0
        progress = Progress(lambda: now)
        now = WARN_AFTER - 0.01
        self.assertFalse(progress.check())
        now = WARN_AFTER
        self.assertTrue(progress.check())
        self.assertFalse(progress.check())
        now = FAIL_AFTER
        self.assertFalse(progress.check())
        now = health.START_LIMIT - 0.01
        self.assertFalse(progress.check())
        now = health.START_LIMIT
        with self.assertRaisesRegex(RuntimeError, "no complete packet"):
            progress.check()

    def test_the_compositor_first_copy_does_not_arm_the_thirty_seconds(self):
        # 2026-11-26: the empty Sway output at 23:32:32.342, then nothing until
        # the game's first picture about 33 s later. wlroots always delivers
        # that first copy, then nothing until the screen changes.
        now = 0.0
        progress = Progress(lambda: now)
        now = 1.0
        progress.saw()
        now = 1.0 + 40.0
        self.assertTrue(progress.check(), "the silence is still announced")
        self.assertFalse(progress.check())
        self.assertFalse(progress.armed)

    def test_after_a_second_packet_thirty_seconds_of_silence_fail(self):
        now = 0.0
        progress = Progress(lambda: now)
        progress.saw()
        now = 33.0
        progress.saw()
        self.assertTrue(progress.armed)
        now = 33.0 + FAIL_AFTER - 0.01
        self.assertTrue(progress.check())
        now = 33.0 + FAIL_AFTER
        with self.assertRaisesRegex(RuntimeError, "no complete packet for 30.0 seconds"):
            progress.check()

    def test_a_producer_alive_but_blocked_is_seen_only_at_the_start_limit(self):
        # State D in VAAPI, or S facing a dead Sway: alive and not stopped, so
        # only the long bound sees it. The price of not killing a loading game.
        now = 0.0
        progress = Progress(lambda: now, state=lambda pid: "S")
        progress.follow(1234)
        progress.saw()
        now = health.START_LIMIT - 0.01
        progress.check()
        now = health.START_LIMIT
        with self.assertRaisesRegex(RuntimeError, "no complete packet"):
            progress.check()

    def test_a_stopped_producer_is_reported_at_once_before_and_after_arming(self):
        for packets in (0, 1, 2, 30):
            with self.subTest(packets=packets):
                # A real SIGSTOP is in test_capture_loop.py; here the state alone.
                world = {"now": 0.0, "state": "S"}
                progress = Progress(
                    lambda w=world: w["now"], state=lambda _pid, w=world: w["state"]
                )
                progress.follow(1234)
                for _ in range(packets):
                    progress.saw()
                world["now"] = 0.1
                self.assertFalse(progress.check())
                world["state"] = "T"
                with self.assertRaisesRegex(RuntimeError, "stopped"):
                    progress.check()

    def test_a_new_producer_starts_its_own_count(self):
        now = 0.0
        progress = Progress(lambda: now, state=lambda pid: "S")
        progress.follow(1)
        progress.saw()
        progress.saw()
        self.assertTrue(progress.armed)
        now = 10.0
        progress.follow(2)
        self.assertFalse(progress.armed)
        now = 10.0 + FAIL_AFTER + 1
        progress.check()

    def test_packets_reset_warning_and_deadline_even_with_an_identical_picture(self):
        now = 0.0
        progress = Progress(lambda: now)
        progress.saw()
        for _ in range(3):
            now += WARN_AFTER
            self.assertTrue(progress.check())
            progress.saw()
            self.assertFalse(progress.check())
        now += FAIL_AFTER - 0.01
        self.assertTrue(progress.check())
        progress.saw()
        self.assertFalse(progress.check())

    def test_sound_has_no_first_copy_and_keeps_thirty_seconds(self):
        # The twin for parec: its first chunk is already sound, so a producer
        # that never sends one still fails at FAIL_AFTER.
        now = 0.0
        progress = Progress(lambda: now, copies=0, start_limit=FAIL_AFTER)
        now = FAIL_AFTER - 0.01
        progress.check()
        now = FAIL_AFTER
        with self.assertRaisesRegex(RuntimeError, "no complete packet"):
            progress.check()
        now = 0.0
        progress = Progress(lambda: now, copies=0, start_limit=FAIL_AFTER)
        progress.saw()
        self.assertTrue(progress.armed)


if __name__ == "__main__":
    unittest.main()
