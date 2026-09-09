"""No real waiting or room: the policy uses a controllable monotonic clock."""

import unittest

from capture_health import FAIL_AFTER, WARN_AFTER, Progress


class HealthTests(unittest.TestCase):
    def test_never_started_warns_once_then_fails(self):
        now = 0.0
        progress = Progress(lambda: now)
        now = WARN_AFTER - 0.01
        self.assertFalse(progress.check())
        now = WARN_AFTER
        self.assertTrue(progress.check())
        self.assertFalse(progress.check())
        now = FAIL_AFTER
        with self.assertRaisesRegex(RuntimeError, "no complete packet"):
            progress.check()

    def test_packets_reset_warning_and_deadline_even_with_an_identical_picture(self):
        now = 0.0
        progress = Progress(lambda: now)
        for _ in range(3):
            now += WARN_AFTER
            self.assertTrue(progress.check())
            progress.saw()
            self.assertFalse(progress.check())
        now += FAIL_AFTER - 0.01
        self.assertTrue(progress.check())
        progress.saw()
        self.assertFalse(progress.check())


if __name__ == "__main__":
    unittest.main()
