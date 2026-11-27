"""Real FIFOs verify isolation and consumption, including an absent encoder."""

import os
import tempfile
import unittest

from capture_keys import Keys, Opening, key_frame


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


# Access units as wf-recorder writes them (aud=1): delimiter, then slices.
AUD = b"\x00\x00\x00\x01\x09\xf0"
IDR = AUD + b"\x00\x00\x00\x01\x67\x64" + b"\x00\x00\x01\x68\xee" + b"\x00\x00\x01\x65\x88"
P = AUD + b"\x00\x00\x00\x01\x41\x9a"


class KeyFrameTests(unittest.TestCase):
    def test_an_idr_slice_is_a_key_frame_after_sps_and_pps(self):
        self.assertTrue(key_frame(IDR))
        self.assertTrue(key_frame(b"\x00\x00\x01\x65"))

    def test_the_twins_a_p_slice_and_a_start_code_without_header_are_not(self):
        self.assertFalse(key_frame(P))
        self.assertFalse(key_frame(AUD + b"\x00\x00\x01"))
        self.assertFalse(key_frame(b""))


class OpeningTests(unittest.TestCase):
    def test_the_first_copy_is_held_back_and_asks_one_key_frame(self):
        asked = []
        opening = Opening(lambda: asked.append(1))
        self.assertFalse(opening.admit(IDR), "the compositor's copy")
        self.assertEqual(asked, [1])
        self.assertFalse(opening.admit(P), "a P frame refers to the copy nobody got")
        self.assertTrue(opening.admit(IDR))
        self.assertTrue(opening.admit(P))
        self.assertEqual(asked, [1], "one request, never repeated")


if __name__ == "__main__":
    unittest.main()
