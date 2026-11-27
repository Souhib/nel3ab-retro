"""pads.py's journal: never waits on its stream, and sums vibrations per second."""

import contextlib
import io
import json
import os
import threading
import time
import unittest

from pad_journal import Journal


def full_pipe():
    """A stream whose next write waits: a pipe already full, that nobody reads."""
    read, write = os.pipe()
    os.set_blocking(write, False)
    with contextlib.suppress(BlockingIOError):
        while True:
            os.write(write, bytes(4096))
    os.set_blocking(write, True)
    return read, os.fdopen(write, "w")


class Lines(unittest.TestCase):
    def test_a_line_never_waits_when_nobody_reads_and_the_loss_is_counted(self):
        read, stream = full_pipe()
        journal = Journal(stream, size=16)
        try:
            started = time.monotonic()
            # In a thread of its own, so that a waiting line fails this test
            # instead of hanging it.
            lines = threading.Thread(
                target=lambda: [journal.line({"n": n}) for n in range(5000)], daemon=True
            )
            lines.start()
            lines.join(timeout=2)
            self.assertFalse(lines.is_alive(), "a line waited for a stream nobody reads")
            took = time.monotonic() - started
            self.assertLess(took, 0.5, f"{took:.3f} s for 5,000 lines")
            # The writer holds a line or two, the queue sixteen; the rest is counted.
            self.assertGreaterEqual(journal.lost, 5000 - 18)
            self.assertEqual(journal.queue.qsize(), 16)
            started = time.monotonic()
            journal.close(timeout=0.2)
            self.assertLess(time.monotonic() - started, 1.0)
        finally:
            os.close(read)

    def test_the_twin_a_read_stream_gets_every_line_in_order_and_the_count(self):
        stream = io.StringIO()
        journal = Journal(stream, size=4)
        journal.queue.put_nowait({"bouchon": 1})
        # Wait for the writer to take it, then fill the queue past its size.
        while not journal.queue.empty():
            time.sleep(0.001)
        time.sleep(0.01)
        for n in range(10):
            journal.line({"n": n})
        lost = journal.dropped
        time.sleep(0.05)
        journal.line({"n": "après"})
        journal.close()
        lines = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(lines[-1], {"n": "après", "journal_dropped": lost})
        numbers = [line["n"] for line in lines[1:-1]]
        self.assertEqual(numbers, sorted(numbers))


class Rumbles(unittest.TestCase):
    def test_107_vibrations_in_a_second_are_one_line_per_pad(self):
        stream = io.StringIO()
        journal = Journal(stream)
        now = 100.0
        for n in range(107):
            # Smash alternated a weak level and zero (2026-11-26).
            journal.rumble(1, n % 2, [512, 0] if n % 2 else None, 2 if n % 2 else 0, now)
            journal.tick(now)
            now += 1 / 107
        journal.rumble(3, 1, [65535, 0], 255, now - 0.5)
        journal.tick(now)
        journal.close()
        lines = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(
            lines[0],
            {
                "rumble": 1,
                "events": 107,
                "played": 53,
                "changes": 107,
                "level": 0,
                "magnitude": None,
                "seconds": 1.0,
            },
        )
        self.assertEqual(lines[1]["rumble"], 3)
        self.assertEqual(len(lines), 2)

    def test_a_window_stretched_by_a_stalled_loop_says_its_real_length(self):
        # The loop that ticks is the one this journal must not stall; when it
        # stalls anyway, a window written as « one second » would make 10 s of
        # events read as a rate ten times too high.
        for end, seconds in ((10.0, 10.0), (1.0, 1.0)):
            with self.subTest(end=end):
                stream = io.StringIO()
                journal = Journal(stream)
                journal.rumble(1, 1, None, 5, 0.0)
                journal.tick(end)
                journal.close()
                (line,) = [json.loads(text) for text in stream.getvalue().splitlines()]
                self.assertEqual(line["seconds"], seconds)

    def test_the_twin_a_window_cut_by_close_has_no_length_unless_told_the_hour(self):
        stream = io.StringIO()
        journal = Journal(stream)
        journal.rumble(1, 1, None, 5, 0.0)
        journal.close()
        stream_told = io.StringIO()
        told = Journal(stream_told)
        told.rumble(1, 1, None, 5, 0.0)
        told.close(0.4)
        self.assertNotIn("seconds", json.loads(stream.getvalue()))
        self.assertEqual(json.loads(stream_told.getvalue())["seconds"], 0.4)
        # A pad helper that never vibrated closes as pads.py does, told the hour.
        quiet = io.StringIO()
        Journal(quiet).close(12.0)
        self.assertEqual(quiet.getvalue(), "")

    def test_the_twin_a_repeated_level_is_not_a_change_and_the_return_to_zero_is(self):
        stream = io.StringIO()
        journal = Journal(stream)
        for at, level in ((0.0, 5), (0.1, 5), (0.2, 5), (1.5, 5), (1.6, 0)):
            journal.rumble(2, level != 0, None, level, at)
            journal.tick(at)
        journal.close()
        lines = [json.loads(line) for line in stream.getvalue().splitlines()]
        windows = [(line["events"], line["changes"], line["level"]) for line in lines]
        self.assertEqual(windows, [(3, 1, 5), (2, 1, 0)])


if __name__ == "__main__":
    unittest.main()
