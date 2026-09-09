"""Packet boundaries, source timestamps and corrupt/truncated producers."""

import struct
import unittest

from capture_packets import MAX_PACKET, Packets


def packet(at, payload):
    return struct.pack("<QI", at, len(payload)) + payload


class PacketTests(unittest.TestCase):
    def test_a_frame_is_delivered_before_the_next_frame_exists(self):
        reader = Packets()
        frame = b"\0\0\0\1\x09\xf0\0\0\0\1\x65picture"
        self.assertEqual(reader.feed(packet(1_000_000, frame)), [(1_000_000, frame)])
        reader.finish()

    def test_a_fragment_is_not_delivered_as_a_complete_picture(self):
        raw = packet(123, b"picture")
        for split in range(1, len(raw)):
            with self.subTest(split=split):
                reader = Packets()
                self.assertEqual(reader.feed(raw[:split]), [])
                self.assertEqual(reader.feed(raw[split:]), [(123, b"picture")])
                reader.finish()

    def test_grouped_arrivals_keep_distinct_source_times(self):
        reader = Packets()
        self.assertEqual(
            reader.feed(packet(100, b"one") + packet(200, b"two")), [(100, b"one"), (200, b"two")]
        )
        reader.finish()

    def test_invalid_sizes_and_clock_are_refused(self):
        for at, size in [(1, 0), (1, MAX_PACKET + 1), (0, 1)]:
            with self.subTest(at=at, size=size), self.assertRaises(ValueError):
                Packets().feed(struct.pack("<QI", at, size))

    def test_a_truncated_header_or_body_is_not_successful_eof(self):
        raw = packet(123, b"picture")
        for split in range(1, len(raw)):
            reader = Packets()
            reader.feed(raw[:split])
            with self.subTest(split=split), self.assertRaises(ValueError):
                reader.finish()


if __name__ == "__main__":
    unittest.main()
