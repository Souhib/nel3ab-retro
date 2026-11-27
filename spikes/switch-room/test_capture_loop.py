"""The real picture loop of capture.py, around a fake recorder and a local socket.

No container, compositor or GPU. `capture.video` runs as the room runs it: it
creates the FIFO, starts the "recorder" with its real arguments and environment,
reads framed packets and sends them to a media socket. Only three names move:
the folder (`RUN_DATA`), the socket (`MEDIA_SOCKET`) and the executable
(`RECORDER`), here a small Python program that follows a script of steps.

The fake writes the packet's compositor time as `time.monotonic_ns()`, the clock
capture.py reads too (CLOCK_MONOTONIC is shared by every process), so the
receiving socket can time each packet from its write to its arrival.
"""

import contextlib
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import capture
from capture_health import Progress

FAKE = """
import json, os, signal, struct, sys, time

steps = json.loads(os.environ["FAKE_STEPS"])
journal = open(os.environ["FAKE_JOURNAL"], "a", buffering=1)
on_sigint = os.environ.get("FAKE_SIGINT", "exit")
if on_sigint == "ignore":
    # As libwayland after EINTR: the signal arrives and the wait resumes.
    signal.signal(signal.SIGINT, lambda *_: journal.write(json.dumps({"sigint": 1}) + "\\n"))
else:
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
sys.stdin.read()
pipe = None
NAL = {"idr": b"\\x00\\x00\\x00\\x01\\x09\\xf0\\x00\\x00\\x00\\x01\\x65",
       "p": b"\\x00\\x00\\x00\\x01\\x09\\xf0\\x00\\x00\\x00\\x01\\x41"}
for step in steps:
    if "sleep" in step:
        time.sleep(step["sleep"])
    elif "open" in step:
        pipe = open(os.environ["NEL3AB_PACKET_PIPE"], "wb", buffering=0)
    elif "close" in step:
        pipe.close()
        pipe = None
    elif "exit" in step:
        sys.exit(step["exit"])
    elif "packet" in step:
        payload = NAL[step["packet"]] + bytes(step.get("size", 64))
        at = time.monotonic_ns()
        pipe.write(struct.pack("<QI", at // 1000, len(payload)) + payload)
        journal.write(json.dumps({"wrote": at, "done": time.monotonic_ns(),
                                  "packet": step["packet"]}) + "\\n")
while True:
    time.sleep(3600)
"""


class Media:
    """The worker's media socket: records each framed message and when it arrived."""

    def __init__(self, path):
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(str(path))
        self.server.listen()
        self.received = []
        self.lock = threading.Lock()
        threading.Thread(target=self.accept, daemon=True).start()

    def accept(self):
        while True:
            try:
                connection, _ = self.server.accept()
            except OSError:
                return
            threading.Thread(target=self.read, args=(connection,), daemon=True).start()

    def read(self, connection):
        buffer = b""
        with connection:
            while True:
                try:
                    chunk = connection.recv(1 << 20)
                except OSError:
                    return
                if not chunk:
                    return
                buffer += chunk
                while len(buffer) >= 13:
                    kind, captured, size = struct.unpack_from("<cQI", buffer)
                    if len(buffer) < 13 + size:
                        break
                    with self.lock:
                        self.received.append(
                            (kind, captured, buffer[13 : 13 + size], time.monotonic_ns())
                        )
                    buffer = buffer[13 + size :]

    def pictures(self):
        with self.lock:
            return [entry for entry in self.received if entry[0] in (b"F", b"H")]

    def close(self):
        self.server.close()


class Room(contextlib.ExitStack):
    """A temporary /run-data, a fake recorder and a media socket for one test."""

    def __init__(self, steps, sigint="exit"):
        super().__init__()
        self.steps, self.sigint = steps, sigint

    def __enter__(self):
        super().__enter__()
        root = Path(self.enter_context(tempfile.TemporaryDirectory()))
        self.root = root
        (root / "display.json").write_text(json.dumps({"display": "wayland-test"}))
        recorder = root / "fake-recorder"
        recorder.write_text(f"#!{sys.executable}\n{FAKE}")
        recorder.chmod(0o700)
        self.journal = root / "fake.jsonl"
        self.media = Media(root / "media.sock")
        self.callback(self.media.close)
        self.enter_context(patch.object(capture, "RUN_DATA", root))
        self.enter_context(patch.object(capture, "MEDIA_SOCKET", str(root / "media.sock")))
        self.enter_context(patch.object(capture, "RECORDER", str(recorder)))
        self.enter_context(
            patch.dict(
                os.environ,
                {
                    "FAKE_STEPS": json.dumps(self.steps),
                    "FAKE_JOURNAL": str(self.journal),
                    "FAKE_SIGINT": self.sigint,
                },
            )
        )
        self.enter_context(patch.object(capture, "PROCESSES", []))
        self.stopped = threading.Event()
        self.callback(self.stopped.set)
        return self

    def written(self):
        if not self.journal.exists():
            return []
        lines = [json.loads(line) for line in self.journal.read_text().splitlines()]
        return [line for line in lines if "wrote" in line]

    def run(self, progress=None, **arguments):
        """`capture.video` in its own thread; its end and error are kept."""
        self.error = None
        self.ended = None

        def target():
            try:
                capture.video(False, self.stopped, progress or Progress(), **arguments)
            except Exception as error:
                self.error = error
            finally:
                self.ended = time.monotonic()

        self.thread = threading.Thread(target=target)
        self.thread.start()
        return self.thread

    def wait_for(self, condition, timeout, what):
        deadline = time.monotonic() + timeout
        while not condition():
            if time.monotonic() > deadline:
                raise AssertionError(f"{what} within {timeout} s")
            time.sleep(0.005)


class Loop(unittest.TestCase):
    def test_a_packet_reaches_the_worker_with_its_compositor_time(self):
        steps = [{"open": 1}, {"packet": "idr"}, {"packet": "p"}, {"packet": "p"}]
        with Room(steps) as room:
            room.run()
            room.wait_for(lambda: len(room.media.pictures()) >= 2, 5, "two pictures arrived")
            room.stopped.set()
            room.thread.join(timeout=10)
            self.assertFalse(room.thread.is_alive())
            self.assertIsNone(room.error)
            written = {line["wrote"] // 1000 for line in room.written()}
            for kind, captured, _payload, _at in room.media.pictures():
                self.assertEqual(kind, b"F")
                self.assertIn(captured, written)
            # The recorder is reaped before video() returns.
            self.assertEqual(capture.PROCESSES, [])


if __name__ == "__main__":
    unittest.main()
