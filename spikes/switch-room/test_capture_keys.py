"""Real FIFOs verify isolation and consumption, including an absent encoder."""

import os
import tempfile
import unittest

from capture_keys import Keys


class KeyTests(unittest.TestCase):
    def test_each_request_reaches_only_its_recorder_and_is_consumed_once(self):
        with tempfile.TemporaryDirectory() as root:
            with Keys(root) as keys:
                full = os.open(keys.paths[0], os.O_RDONLY | os.O_NONBLOCK)
                half = os.open(keys.paths[1], os.O_RDONLY | os.O_NONBLOCK)
                try:
                    keys.request(False, False)
                    with self.assertRaises(BlockingIOError):
                        os.read(full, 64)
                    keys.request(True, True)
                    self.assertEqual(os.read(half, 64), b"K")
                    with self.assertRaises(BlockingIOError):
                        os.read(full, 64)
                    with self.assertRaises(BlockingIOError):
                        os.read(half, 64)
                    keys.request(False, True)
                    self.assertEqual(os.read(full, 64), b"K")
                finally:
                    os.close(full)
                    os.close(half)
            self.assertTrue(all(not path.exists() for path in keys.paths))

    def test_absent_encoder_does_not_block_a_request(self):
        with tempfile.TemporaryDirectory() as root, Keys(root) as keys:
            for _ in range(100_000):
                keys.request(True, True)
            self.assertGreater(len(os.read(keys.fds[1], 64)), 0)


if __name__ == "__main__":
    unittest.main()
