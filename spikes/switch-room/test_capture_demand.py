"""Exercise real threads: last departure stops them, remaining demand keeps them."""

import threading
import unittest

from capture_demand import OnDemand


class DemandTests(unittest.TestCase):
    def test_idle_multiple_viewers_departures_and_rejoin(self):
        entered = threading.Event()
        departed = threading.Event()
        starts = []

        def capture(stop):
            starts.append(threading.get_ident())
            entered.set()
            stop.wait()
            departed.set()

        runner = OnDemand(capture)
        try:
            runner.update(0)
            self.assertIsNone(runner.thread)
            self.assertEqual(starts, [])
            runner.update(1)
            self.assertTrue(entered.wait(1))
            first = runner.thread
            runner.update(2)
            runner.update(1)
            self.assertIs(runner.thread, first)
            self.assertFalse(departed.is_set())
            runner.update(0)
            self.assertTrue(departed.is_set())
            self.assertFalse(first.is_alive())
            entered.clear()
            runner.update(1)
            self.assertTrue(entered.wait(1))
            self.assertEqual(len(starts), 2)
            self.assertIsNot(runner.thread, first)
        finally:
            runner.close()

    def test_failure_is_reported_instead_of_starting_another_worker(self):
        failed = threading.Event()

        def capture(_stop):
            try:
                raise ValueError("encoder broke")
            finally:
                failed.set()

        runner = OnDemand(capture)
        runner.update(1)
        self.assertTrue(failed.wait(1))
        runner.thread.join(timeout=1)
        self.assertFalse(runner.thread.is_alive())
        with self.assertRaisesRegex(RuntimeError, "half capture failed"):
            runner.update(1)
        with self.assertRaisesRegex(RuntimeError, "half capture failed"):
            runner.close()
        self.assertIsNone(runner.thread)


if __name__ == "__main__":
    unittest.main()
