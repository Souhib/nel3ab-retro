import unittest

from measure import measure, read_windows

# A real Superbuild v11 report from the exploration on 2026-11-07.
REPORT = (
    "[ 690.370831] Service <Info> PresentClientBuffer: nx2:vi2 last 600 presents: "
    "frame 49994 us (max 478994, 13 over 100 ms), blocked on the GPU fence 682 us"
)


class Measurements(unittest.TestCase):
    def test_reads_game_frames_and_long_frames_from_a_real_report(self):
        result = measure(REPORT, 660, 691)
        self.assertEqual(result["game_presentations"], 600)
        self.assertAlmostEqual(result["game_fps"], 20.002400288034566)
        self.assertEqual(result["maximum_frame_ms"], 478.994)
        self.assertEqual(result["frames_over_100_ms"], 13)

    def test_does_not_credit_a_window_that_straddles_another_scene(self):
        with self.assertRaisesRegex(ValueError, "no complete"):
            measure(REPORT, 680, 691)

    def test_a_live_compositor_at_120_hz_does_not_establish_gameplay(self):
        with self.assertRaisesRegex(ValueError, "no game presentation"):
            measure("Sway: 120 Hz; browser: 60 FPS", 0, 60)

    def test_rejects_zero_time_and_impossible_freeze_counts(self):
        for text in (REPORT.replace("49994", "0"), REPORT.replace("13 over", "601 over")):
            with self.subTest(text=text), self.assertRaises(ValueError):
                read_windows(text)

    def test_rejects_a_restarted_clock_and_invalid_bounds(self):
        with self.assertRaisesRegex(ValueError, "clock"):
            read_windows(REPORT + "\n" + REPORT)
        for bounds in ((1, 0), (0, float("inf")), (float("nan"), 1)):
            with self.subTest(bounds=bounds), self.assertRaises(ValueError):
                measure(REPORT, *bounds)

    def test_console_colors_and_null_bytes_do_not_hide_measurements(self):
        colored = "\x00\x1b[0;37m" + REPORT + "\x1b[0m\x00"
        self.assertEqual(measure(colored, 660, 691), measure(REPORT, 660, 691))


if __name__ == "__main__":
    unittest.main()
