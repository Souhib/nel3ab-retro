"""The real input loop of pads.py, with fake uinput pads and a real socket.

python-evdev exists only in the room image: the stub of test_pads_layout.py
stands in for it, and each fake pad gives the loop a real descriptor to wait
on. The worker's commands arrive as JSON datagrams on a real Unix socket.
"""

import collections
import contextlib
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pad_journal import Journal
from test_pads_layout import load

pads_module = load()
e = pads_module.e


class FakePad:
    """A uinput pad as the loop uses it: a descriptor, events, writes."""

    def __init__(self):
        self.fd, self.wake = os.pipe()
        os.set_blocking(self.fd, False)
        self.events = collections.deque()
        self.writes = []
        self.lock = threading.Lock()

    def push(self, events):
        with self.lock:
            self.events.extend(events)
        os.write(self.wake, b"x")

    def read(self):
        with contextlib.suppress(BlockingIOError):
            os.read(self.fd, 4096)
        with self.lock:
            events = list(self.events)
            self.events.clear()
        return events

    def write(self, kind, code, value):
        self.writes.append((time.monotonic(), kind, code, value))

    def syn(self):
        return None

    def close(self):
        os.close(self.fd)
        os.close(self.wake)


def rumble_events(effect=0, count=1):
    # Smash alternated a weak level and zero (2026-11-26).
    return [SimpleNamespace(type=e.EV_FF, code=effect, value=n % 2) for n in range(count)]


class Loop:
    """`pads.serve` in a thread, its stdout a pipe that nobody reads or that is read."""

    def __init__(self, read_stdout):
        self.root = Path(tempfile.mkdtemp())
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.sock.bind(str(self.root / "pads.sock"))
        self.client = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.pads = [FakePad() for _ in range(4)]
        self.stopping = threading.Event()
        out_read, out_write = os.pipe()
        self.out_read = out_read
        self.lines = []
        if read_stdout:
            threading.Thread(target=self.drain, daemon=True).start()
        else:
            # Docker stopped reading a while ago: the pipe is already full, and
            # the next write waits. Checked, not assumed.
            os.set_blocking(out_write, False)
            with contextlib.suppress(BlockingIOError):
                while True:
                    os.write(out_write, bytes(4096))
            try:
                os.write(out_write, b"x")
            except BlockingIOError:
                pass
            else:
                raise AssertionError("the stdout pipe was not full")
            os.set_blocking(out_write, True)
        self.stdout = os.fdopen(out_write, "w")
        self.journal = Journal(self.stdout)
        self.patch = patch.object(sys, "stdout", self.stdout)

    def drain(self):
        with os.fdopen(self.out_read, "r") as source:
            for line in source:
                self.lines.append(json.loads(line))

    def __enter__(self):
        self.patch.start()
        self.thread = threading.Thread(
            target=pads_module.serve,
            args=(
                self.sock,
                self.pads,
                pads_module.layout({}),
                self.journal,
                self.stopping,
                str(self.root / "rumble.sock"),
            ),
            daemon=True,
        )
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stopping.set()
        self.thread.join(timeout=2)
        self.patch.stop()

    def press(self, player, button):
        self.client.sendto(
            json.dumps({"player": player, "buttons": [button]}).encode(),
            str(self.root / "pads.sock"),
        )

    def applied(self, pad, code, after):
        return [
            at
            for at, kind, written, value in pad.writes
            if at >= after and kind == e.EV_KEY and written == code and value == 1
        ]


class Vibration(unittest.TestCase):
    """ENT-3, DON-14: about 107 vibrations a second on the loop that reads the buttons."""

    def presses_under_vibration(self, read_stdout):
        delays = []
        with Loop(read_stdout) as loop:
            # Five seconds of Smash's rate, in bursts as the emulator sends them.
            stop = threading.Event()

            def vibrate():
                while not stop.is_set():
                    loop.pads[0].push(rumble_events(count=11))
                    time.sleep(0.1)

            vibrator = threading.Thread(target=vibrate, daemon=True)
            vibrator.start()
            try:
                time.sleep(1.0)
                for _ in range(20):
                    asked = time.monotonic()
                    loop.press(2, "a")
                    deadline = asked + 2
                    while not loop.applied(loop.pads[1], e.BTN_A, asked):
                        if time.monotonic() > deadline:
                            break
                        time.sleep(0.0005)
                    seen = loop.applied(loop.pads[1], e.BTN_A, asked)
                    delays.append((seen[0] - asked) * 1000 if seen else float("inf"))
                    loop.press(2, "b")
                    time.sleep(0.15)
            finally:
                stop.set()
                vibrator.join(timeout=2)
        return delays, loop

    def assert_prompt(self, delays):
        shown = [round(d, 2) for d in delays]
        self.assertNotIn(float("inf"), delays, f"a button never reached its pad: {shown} ms")
        # The median, so that a loaded machine does not make the test lie.
        self.assertLess(sorted(delays)[len(delays) // 2], 5, f"{shown} ms")

    def test_a_button_is_applied_within_5_ms_while_docker_reads_nothing(self):
        delays, _loop = self.presses_under_vibration(read_stdout=False)
        self.assert_prompt(delays)

    def test_the_twin_with_the_output_read_vibrations_are_summed_per_second(self):
        delays, loop = self.presses_under_vibration(read_stdout=True)
        self.assert_prompt(delays)
        time.sleep(0.2)
        rumbles = [line for line in loop.lines if "rumble" in line]
        # About 110 events a second, written as one line per second.
        self.assertTrue(rumbles, "no vibration line at all")
        self.assertLess(len(rumbles), 10, f"{len(rumbles)} vibration lines in about 4 s")
        self.assertGreater(sum(line["events"] for line in rumbles), 300)


if __name__ == "__main__":
    unittest.main()
