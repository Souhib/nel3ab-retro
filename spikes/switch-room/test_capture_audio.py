"""Exercise actual pipes: full audio, truncated EOF and a silent producer."""

import os
import threading
import unittest

from capture_audio import CHUNK_BYTES, chunks


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
        read, write = os.pipe()
        waiting = threading.Event()
        received = []

        class Stop(threading.Event):
            def wait(self, timeout=None):
                waiting.set()
                return super().wait(timeout)

        stopped = Stop()
        thread = threading.Thread(target=lambda: received.extend(chunks(read, stopped)))
        thread.start()
        try:
            self.assertTrue(waiting.wait(1), "reader must reach a nonblocking empty pipe")
            stopped.set()
            thread.join(timeout=1)
            self.assertFalse(thread.is_alive(), "stop must not wait for producer output")
            self.assertEqual(received, [])
        finally:
            stopped.set()
            os.close(write)
            thread.join(timeout=2)
            os.close(read)


if __name__ == "__main__":
    unittest.main()
