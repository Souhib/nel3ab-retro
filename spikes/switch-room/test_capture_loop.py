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
import importlib.util
import io
import itertools
import json
import os
import random
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
from capture_health import FAIL_AFTER, Progress
from capture_keys import Keys

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
    elif "stop" in step:
        os.kill(os.getpid(), signal.SIGSTOP)
    elif "packet" in step:
        payload = NAL[step["packet"]] + bytes(step.get("size", 64))
        at = time.monotonic_ns()
        pipe.write(struct.pack("<QI", at // 1000, len(payload)) + payload)
        journal.write(json.dumps({"wrote": at, "done": time.monotonic_ns(),
                                  "packet": step["packet"]}) + "\\n")
while True:
    time.sleep(3600)
"""

FAKE_PAREC = """
import os, signal, sys, time

def finish(*_):
    # A sound reader that takes its time to close, as parec may.
    time.sleep(1.0)
    sys.exit(0)

signal.signal(signal.SIGINT, finish)
while True:
    os.write(1, bytes(1920))
    time.sleep(0.01)
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
        self.enter_context(patch.object(capture, "SHOWN", threading.Event()))
        self.keys = self.enter_context(Keys(root))
        self.stopped = threading.Event()
        self.thread = None
        # Last registered, first run: the loop and its recorder end before the
        # socket closes and the folder goes.
        self.callback(self.finish)
        return self

    def finish(self):
        self.stopped.set()
        if self.thread is not None:
            self.thread.join(timeout=15)

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
                capture.video(False, self.keys, self.stopped, progress or Progress(), **arguments)
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
        # The first packet is the compositor's copy, never sent (CAP-4): the
        # stream starts at the key frame that follows it.
        steps = [{"open": 1}, {"packet": "idr"}, {"packet": "idr"}, {"packet": "p"}]
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

    def test_a_recorder_stopped_before_its_first_picture_is_seen_within_a_fifth_of_a_second(self):
        # 2026-09-08: a SIGSTOP on the encoder took 30 s to be seen. Before the
        # guard is armed, its state is read at every check (capture_health.py).
        steps = [{"open": 1}, {"packet": "idr"}, {"sleep": 0.3}, {"stop": 1}]
        raised = []

        class Watched(Progress):
            def check(self):
                try:
                    return super().check()
                except RuntimeError as error:
                    raised.append((time.monotonic(), str(error)))
                    raise

        with Room(steps) as room:
            room.run(Watched())
            room.wait_for(lambda: room.written(), 5, "the first copy was written")
            stopped_at = time.monotonic() + 0.3
            room.wait_for(lambda: raised, 1.5, "the loop named a stopped recorder")
            self.assertIn("stopped", raised[0][1])
            self.assertLess(raised[0][0] - stopped_at, 0.35)
            room.thread.join(timeout=10)
            self.assertIsInstance(room.error, RuntimeError)

    def key_requests(self, room):
        try:
            return os.read(room.keys.fds[0], 64)
        except BlockingIOError:
            return b""

    def test_nothing_reaches_the_worker_before_the_first_key_frame_after_the_first_copy(self):
        # CAP-4: on 2026-11-26 the empty Sway output was the room's « image »,
        # 4.5 s after the click, and Smash's real start (about 38 s) was lost.
        steps = [
            {"open": 1},
            {"packet": "idr"},
            {"sleep": 0.2},
            {"packet": "p"},
            {"sleep": 0.05},
            {"packet": "idr"},
            {"sleep": 0.05},
            {"packet": "p"},
        ]
        with Room(steps) as room:
            room.run()
            room.wait_for(lambda: len(room.written()) == 4, 5, "four packets were written")
            room.wait_for(lambda: len(room.media.pictures()) >= 2, 5, "two pictures arrived")
            time.sleep(0.1)
            written = room.written()
            sent = [captured for _k, captured, _p, _at in room.media.pictures()]
            self.assertEqual(sent, [written[2]["wrote"] // 1000, written[3]["wrote"] // 1000])
            self.assertEqual(self.key_requests(room), b"K", "one key frame asked, once")

    def test_the_twin_a_still_first_game_screen_is_still_sent(self):
        # wf-recorder copies only on damage: a game whose first screen stays
        # still gives one packet after the copy. The asked key makes it an IDR.
        steps = [{"open": 1}, {"packet": "idr"}, {"sleep": 0.1}, {"packet": "idr"}]
        with Room(steps) as room:
            room.run()
            room.wait_for(lambda: len(room.written()) == 2, 5, "two packets were written")
            room.wait_for(lambda: room.media.pictures(), 5, "the game's screen arrived")
            time.sleep(0.1)
            written = room.written()
            sent = [captured for _k, captured, _p, _at in room.media.pictures()]
            self.assertEqual(sent, [written[1]["wrote"] // 1000])
            self.assertEqual(self.key_requests(room), b"K")


def median(values):
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


class Waking(unittest.TestCase):
    """CAP-5: the loop slept 5 ms on an empty FIFO, so a packet waited up to 5 ms.

    Measured on 2026-11-27 by the audit with the sound module, A B A B on an
    idle machine: median 2.17 to 2.64 ms with the sleep, 0.01 to 0.07 ms with
    select. The median is judged, not a high percentile, so that a loaded
    machine does not make the test lie.
    """

    def test_a_packet_reaches_the_worker_within_half_a_millisecond_in_median(self):
        rng = random.Random(20261127)  # noqa: S311 -- packet timing, not a secret
        steps = [{"open": 1}, {"packet": "idr"}, {"packet": "idr"}]
        for _ in range(80):
            steps += [{"sleep": rng.uniform(0.004, 0.016)}, {"packet": "p"}]
        with Room(steps) as room:
            room.run()
            room.wait_for(lambda: len(room.media.pictures()) == 81, 10, "81 pictures arrived")
            wrote = {line["wrote"] // 1000: line["wrote"] for line in room.written()}
            delays = [
                (arrived - wrote[captured]) / 1e6
                for _kind, captured, _payload, arrived in room.media.pictures()
            ]
        self.assertLess(median(delays), 0.5, f"median {median(delays):.2f} ms")

    def test_a_key_frame_larger_than_the_pipe_does_not_hold_the_recorder(self):
        # wf-recorder writes with a blocking ofstream: a packet above the 64 KiB
        # of the pipe waits for the reader (wf-recorder-packets.patch).
        steps = [{"open": 1}, {"packet": "idr"}, {"packet": "idr"}]
        for _ in range(10):
            steps += [{"sleep": 0.02}, {"packet": "idr", "size": 200 * 1024}]
        with Room(steps) as room:
            room.run()
            room.wait_for(lambda: len(room.media.pictures()) == 11, 10, "11 pictures arrived")
            held = [(line["done"] - line["wrote"]) / 1e6 for line in room.written()[2:]]
        self.assertLess(median(held), 5.0, f"held {[round(h, 2) for h in held]} ms")

    def counted(self):
        class Counted(Progress):
            calls = 0

            def check(self):
                Counted.calls += 1
                return super().check() or Counted.calls == 1

        return Counted

    def test_a_writer_gone_ends_the_loop_on_its_exit_without_turning_in_place(self):
        # After close, poll returns at once (POLLHUP) and every read gives b"".
        steps = [{"open": 1}, {"packet": "idr"}, {"close": 1}, {"sleep": 0.5}, {"exit": 1}]
        counted = self.counted()
        with Room(steps) as room, contextlib.redirect_stdout(io.StringIO()):
            room.run(counted())
            room.thread.join(timeout=5)
            self.assertIsInstance(room.error, RuntimeError)
            self.assertIn("encoder exited: 1", str(room.error))
        self.assertLess(counted.calls, 30, "checks while the writer was gone")

    def test_the_twin_a_fifo_never_opened_is_still_announced_quiet(self):
        counted = self.counted()
        with Room([{"sleep": 30}]) as room, contextlib.redirect_stdout(io.StringIO()) as out:
            room.run(counted())
            time.sleep(0.5)
            room.stopped.set()
            room.thread.join(timeout=5)
            self.assertIsNone(room.error)
        self.assertIn('{"capture_quiet": "full"}', out.getvalue())
        self.assertGreaterEqual(counted.calls, 3, "the loop kept checking without a writer")
        self.assertLess(counted.calls, 30)


class Ending(unittest.TestCase):
    """CAP-7: the room tells a capture that showed the game from one that did not."""

    def test_only_the_compositor_copy_is_not_a_game_picture(self):
        steps = [{"open": 1}, {"packet": "idr"}, {"sleep": 0.2}, {"packet": "p"}]
        with Room(steps) as room:
            room.run()
            room.wait_for(lambda: len(room.written()) == 2, 5, "two packets were written")
            time.sleep(0.1)
            self.assertEqual(room.media.pictures(), [])
            self.assertFalse(capture.SHOWN.is_set())

    def test_the_twin_a_key_frame_sent_is_a_game_picture(self):
        steps = [{"open": 1}, {"packet": "idr"}, {"sleep": 0.05}, {"packet": "idr"}]
        with Room(steps) as room:
            room.run()
            room.wait_for(lambda: room.media.pictures(), 5, "the game's picture arrived")
            self.assertTrue(capture.SHOWN.is_set())

    def test_a_failure_before_any_game_picture_has_its_own_exit_status(self):
        def fails(_keys):
            raise RuntimeError("full: no complete packet for 90.0 seconds since it started")

        for shown, expected in ((False, capture.NOTHING_SHOWN), (True, 1)):
            with (
                self.subTest(shown=shown),
                patch.object(capture, "SHOWN", threading.Event()),
                patch.object(capture, "main", fails),
                contextlib.redirect_stderr(io.StringIO()) as err,
            ):
                if shown:
                    capture.SHOWN.set()
                self.assertEqual(capture.exit_status(None), expected)
                # The traceback still reaches the worker's journal.
                self.assertIn("RuntimeError: full: no complete packet", err.getvalue())
        with patch.object(capture, "main", lambda _keys: None):
            self.assertEqual(capture.exit_status(None), 0)

    def test_the_room_reads_the_same_number(self):
        path = Path(__file__).resolve().parents[2] / "docker/switch-room.py"
        spec = importlib.util.spec_from_file_location("switch_room_for_capture", path)
        room = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(room)
        self.assertEqual(room.CaptureRestarts.NOTHING_SHOWN, capture.NOTHING_SHOWN)
        # Neither python3's own statuses nor docker exec's.
        self.assertNotIn(capture.NOTHING_SHOWN, (0, 1, 2, 120, 125, 126, 127))


class Worker:
    """The worker's side of « D » (ingress.rs): viewers of the half format, and
    a key frame request handed over, then cleared, on the next « D »."""

    def __init__(self, path):
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(str(path))
        self.server.listen()
        self.lock = threading.Lock()
        self.viewers = 0
        self.key = False
        self.asked = []
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        try:
            connection, _ = self.server.accept()
        except OSError:
            return
        with connection:
            while True:
                header = b""
                while len(header) < 13:
                    try:
                        chunk = connection.recv(13 - len(header))
                    except OSError:
                        return
                    if not chunk:
                        return
                    header += chunk
                with self.lock:
                    self.asked.append(time.monotonic())
                    reply = struct.pack("<QBB", self.viewers, self.key, False)
                    self.key = False
                connection.sendall(reply)

    def close(self):
        self.server.close()


class Demand(unittest.TestCase):
    """WK-5: a key frame request waits for the capture's next « D »."""

    def start(self, room, worker_calls, viewers=0):
        class Recorded:
            def __init__(self, _work):
                pass

            def update(self, wanted):
                worker_calls.append((time.monotonic(), wanted))

            def close(self):
                return None

        stop = threading.Event()
        room.enter_context(patch.object(capture, "STOP", stop))
        room.enter_context(patch.object(capture, "OnDemand", Recorded))
        worker = Worker(room.root / "media.sock")
        worker.viewers = viewers
        room.media.close()
        room.callback(worker.close)
        thread = threading.Thread(target=capture.half_capture, args=(room.keys,), daemon=True)
        room.callback(thread.join, 5)
        room.callback(stop.set)
        thread.start()
        return worker

    def test_a_key_frame_request_reaches_the_recorder_within_25_ms(self):
        delays = []
        with Room([]) as room:
            # The test's own socket stands where the worker's media socket is.
            (room.root / "media.sock").unlink()
            worker = self.start(room, [])
            for _ in range(8):
                room.wait_for(lambda w=worker: w.asked, 2, "the capture asked")
                with worker.lock:
                    last = worker.asked[-1]
                # A request raised 30 ms after a « D », as in the audit's case.
                time.sleep(max(0.0, last + 0.03 - time.monotonic()))
                with worker.lock:
                    worker.key = True
                raised = time.monotonic()
                key = b""
                while key != b"K":
                    if time.monotonic() - raised > 1:
                        raise AssertionError("no key frame request within 1 s")
                    try:
                        key = os.read(room.keys.fds[0], 64)
                    except BlockingIOError:
                        time.sleep(0.0005)
                delays.append((time.monotonic() - raised) * 1000)
        self.assertLess(median(delays), 25, f"{[round(d) for d in delays]} ms")

    def test_the_twins_a_quiet_worker_is_still_asked_and_a_short_gap_keeps_the_half(self):
        calls = []
        with Room([]) as room:
            (room.root / "media.sock").unlink()
            worker = self.start(room, calls, viewers=1)
            time.sleep(0.3)
            with worker.lock:
                worker.viewers = 0
            time.sleep(0.04)
            with worker.lock:
                worker.viewers = 1
            time.sleep(0.3)
            with worker.lock:
                worker.viewers = 0
            time.sleep(0.4)
            with worker.lock:
                asked = list(worker.asked)
        gaps = [b - a for a, b in itertools.pairwise(asked)]
        # Asked at least every 110 ms, far below the capture's 1 s timeout.
        self.assertLess(max(gaps), 0.11)
        self.assertTrue(calls[0][1], "the first viewer starts the half format")
        stops = [at for at, wanted in calls if not wanted]
        # The 40 ms gap stopped nothing; the last, held 400 ms, did.
        self.assertTrue(stops, "a half format without viewers was never stopped")
        self.assertGreater(min(stops) - calls[0][0], 0.6, "the 40 ms gap stopped the half format")


class Stopping(unittest.TestCase):
    """CAP-6: on a still picture wf-recorder waits for a copy Sway never sends.

    On 2026-11-08 (4 times) and 2026-11-21 (36 times) each stop took 5.03 s and
    ended in SIGKILL. The recorder writes to /dev/null and has nothing to
    finish, so it gets half a second; parec keeps its five.
    """

    def test_a_recorder_that_resumes_its_wait_after_sigint_is_killed_within_a_second(self):
        with (
            Room([{"open": 1}, {"packet": "idr"}], sigint="ignore") as room,
            contextlib.redirect_stdout(io.StringIO()) as out,
        ):
            room.run()
            room.wait_for(lambda: room.written(), 5, "the first copy was written")
            asked = time.monotonic()
            room.stopped.set()
            room.thread.join(timeout=10)
            self.assertLess(room.ended - asked, 1.0)
            self.assertIn("capture_child_forced", out.getvalue())
            lines = room.journal.read_text().splitlines()
            self.assertIn('{"sigint": 1}', lines, "SIGINT came first")

    def test_the_twin_a_recorder_that_exits_on_sigint_is_not_killed(self):
        with (
            Room([{"open": 1}, {"packet": "idr"}]) as room,
            contextlib.redirect_stdout(io.StringIO()) as out,
        ):
            room.run()
            room.wait_for(lambda: room.written(), 5, "the first copy was written")
            asked = time.monotonic()
            room.stopped.set()
            room.thread.join(timeout=10)
            self.assertLess(room.ended - asked, 1.0)
            self.assertNotIn("capture_child_forced", out.getvalue())

    def test_parec_keeps_its_longer_grace(self):
        with (
            Room([]) as room,
            contextlib.redirect_stdout(io.StringIO()) as out,
        ):
            parec = room.root / "fake-parec"
            parec.write_text(f"#!{sys.executable}\n{FAKE_PAREC}")
            parec.chmod(0o700)
            stop = threading.Event()
            room.enter_context(patch.object(capture, "PAREC", str(parec)))
            room.enter_context(patch.object(capture, "STOP", stop))
            failures = []

            def sound():
                try:
                    capture.audio(Progress(copies=0, start_limit=FAIL_AFTER))
                except Exception as error:
                    failures.append(error)

            thread = threading.Thread(target=sound)
            thread.start()
            room.wait_for(
                lambda: sum(1 for m in room.media.received if m[0] == b"A") >= 5,
                5,
                "sound arrived",
            )
            asked = time.monotonic()
            stop.set()
            thread.join(timeout=10)
            took = time.monotonic() - asked
            self.assertEqual(failures, [])
            self.assertNotIn("capture_child_forced", out.getvalue())
            self.assertGreaterEqual(took, 0.9, "parec finished on its own after 1 s")


if __name__ == "__main__":
    unittest.main()
