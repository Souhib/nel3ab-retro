"""Exercise actual pipes: full audio, truncated EOF and a silent producer."""

import os
import select
import threading
import time
import unittest
from unittest.mock import patch

import capture_audio
from capture_audio import CHUNK_BYTES, WAKE, chunks


class AudioTests(unittest.TestCase):
    def test_complete_chunks_keep_channel_bytes_and_order(self):
        read, write = os.pipe()
        first, second = b"\x12\x34\x56\x78" * 480, b"\xfe\xdc\xba\x98" * 480
        try:
            os.write(write, first[:100])
            os.write(write, first[100:] + second)
            os.close(write)
            write = None
            self.assertEqual(list(chunks(read, threading.Event())), [first, second])
        finally:
            os.close(read)
            if write is not None:
                os.close(write)

    def test_truncated_eof_is_not_sent_as_valid_stereo(self):
        read, write = os.pipe()
        try:
            os.write(write, b"x" * (CHUNK_BYTES - 1))
            os.close(write)
            with self.assertRaisesRegex(ValueError, "inside a chunk"):
                list(chunks(read, threading.Event()))
        finally:
            os.close(read)

    def test_silent_pipe_can_be_stopped_before_the_writer_exits(self):
        # 2026-09-08: a blocking read kept a suspended parec's capture alive.
        # The writer stays open and silent; the reader is seen inside its wait.
        read, write = os.pipe()
        waiting = threading.Event()
        received = []
        real = select.poll

        class Watched:
            def __init__(self):
                self.inner = real()

            def register(self, *args):
                self.inner.register(*args)

            def poll(self, timeout=None):
                waiting.set()
                return self.inner.poll(timeout)

        stopped = threading.Event()
        with patch.object(capture_audio.select, "poll", Watched):
            thread = threading.Thread(target=lambda: received.extend(chunks(read, stopped)))
            thread.start()
            try:
                self.assertTrue(waiting.wait(1), "reader must wait on a live, silent pipe")
                time.sleep(0.02)
                asked = time.monotonic()
                stopped.set()
                thread.join(timeout=1)
                self.assertFalse(thread.is_alive(), "stop must not wait for producer output")
                self.assertLess(time.monotonic() - asked, WAKE + 0.1)
                self.assertEqual(received, [])
            finally:
                stopped.set()
                os.close(write)
                thread.join(timeout=2)
                os.close(read)

    def test_a_chunk_is_handed_over_within_half_a_millisecond_in_median(self):
        # SON-6: the reader slept 5 ms on an empty pipe. The audit measured,
        # A B A B on an idle machine, a median of 2.17 to 2.64 ms with it and
        # 0.01 to 0.07 ms with select. 1,920 bytes every 10 ms, as parec.
        read, write = os.pipe()
        stopped = threading.Event()
        written = []
        delays = []

        def writer():
            for _ in range(100):
                time.sleep(0.01)
                written.append(time.monotonic_ns())
                os.write(write, bytes(CHUNK_BYTES))

        thread = threading.Thread(target=writer)
        try:
            thread.start()
            for _ in chunks(read, stopped):
                delays.append((time.monotonic_ns() - written[len(delays)]) / 1e6)
                if len(delays) == 100:
                    break
        finally:
            stopped.set()
            thread.join(timeout=5)
            os.close(write)
            os.close(read)
        ordered = sorted(delays)
        self.assertLess(ordered[50], 0.5, f"median {ordered[50]:.2f} ms")


if __name__ == "__main__":
    unittest.main()
