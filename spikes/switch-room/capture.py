#!/usr/bin/env python3
"""Prototype ingress: compositor timestamps for pictures, capture reads for sound.

This is still after the emulator renders, not a controller-to-pixel clock.
"""

# All commands and paths belong to the private prototype container. The
# executable arguments are fixed below; no client supplies a shell command.
# ruff: noqa: S108, S603, T201

import contextlib
import json
import os
import select
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

from capture_audio import WAKE, chunks
from capture_control import exclusive
from capture_demand import OnDemand
from capture_health import FAIL_AFTER, Progress
from capture_keys import Keys, Opening
from capture_packets import Packets
from capture_process import RECORDER_GRACE, stop_child

# The container's paths. Tests point them at a temporary folder, a fake
# recorder and a local media socket (test_capture_loop.py): nothing else changes.
RUN_DATA = Path("/run-data")
MEDIA_SOCKET = "/pads/media.sock"
RECORDER = "/usr/local/bin/nel3ab-wf-recorder"
PAREC = "/usr/bin/parec"
STOP = threading.Event()
PROCESSES = []
# Set once a recorder has sent a game picture, the compositor's copy excepted.
SHOWN = threading.Event()
# The exit statuses of a capture that failed before SHOWN, and after it: the
# room counts the first in a row once the second was seen (CaptureRestarts in
# docker/switch-room.py, which holds the same numbers). Not 1: python3 exits 1
# on an uncaught exception too, before any picture; then 2 or 120. docker exec
# exits 125 to 127, or 128 and a signal number.
NOTHING_SHOWN = 3
SHOWN_THEN_FAILED = 4


def environment():
    """The recorders' environment, read when one starts rather than at import."""
    return dict(
        os.environ,
        XDG_RUNTIME_DIR="/tmp/nel3ab-runtime",
        WAYLAND_DISPLAY=json.loads((RUN_DATA / "display.json").read_text())["display"],
        PULSE_SERVER="unix:/tmp/nel3ab-runtime/pulse/native",
    )


def connect():
    stream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    # A dead bridge must not leave a producer blocked on a full socket.
    stream.settimeout(2)
    stream.connect(MEDIA_SOCKET)
    return stream


def send(stream, kind, payload, captured=None):
    if captured is None:
        captured = time.monotonic_ns() // 1000
    stream.sendall(struct.pack("<cQI", kind, captured, len(payload)) + payload)


def stop_process(process, grace=5):
    if stop_child(process, grace):
        print(json.dumps({"capture_child_forced": process.pid}), flush=True)
    PROCESSES.remove(process)


def video(half, keys, stopped=STOP, progress=None):
    progress = progress or Progress()
    name = "half" if half else "full"
    fifo = str(RUN_DATA / f"{name}.h264")
    if os.path.exists(fifo):
        os.unlink(fifo)
    os.mkfifo(fifo, 0o600)
    # One encode in flight, and complete packets straight from the recorder.
    # The packet clock comes from the compositor; FIFO reads can arrive grouped
    # without pretending those images were captured a few microseconds apart.
    command = [
        RECORDER,
        "-m",
        "h264",
        "-f",
        "/dev/null",
        "-c",
        "h264_vaapi",
        "-d",
        "/dev/dri/renderD128",
        # Declare the nominal rate without inserting FFmpeg's fps filter,
        # which needs the following frame before releasing the current one.
        "-B",
        "60",
        "-p",
        "qp=26",
        "-p",
        "async_depth=1",
        "-p",
        "bf=0",
        "-p",
        "g=60",
        "-p",
        "aud=1",
    ]
    if half:
        command += ["-F", "scale_vaapi=w=640:h=360:format=nv12:out_range=full"]
    with open(RUN_DATA / f"{name}-capture.log", "w") as log:
        process = subprocess.Popen(
            command,
            env=dict(
                environment(),
                NEL3AB_PACKET_PIPE=fifo,
                NEL3AB_KEY_PIPE=str(RUN_DATA / f"{name}.key"),
            ),
            stdin=subprocess.PIPE,
            stdout=log,
            stderr=log,
        )
    PROCESSES.append(process)
    progress.follow(process.pid)
    # Confirm /dev/null output; framed packets use the FIFO instead.
    process.stdin.write(b"y\n")
    process.stdin.close()
    packets = Packets()
    opening = Opening(lambda: keys.request(half, True))
    report_at = 0.0
    # Les écarts entre deux images REÇUES du compositeur, sur la fenêtre de
    # rapport. Le 16 septembre 2026, un gel d'une seconde a été vu par les pages
    # sans qu'on puisse dire si le compositeur avait cessé de produire ou si la
    # capture avait cessé de lire. Ces trois chiffres tranchent.
    gaps = []
    last_frame = None
    fd = os.open(fifo, os.O_RDONLY | os.O_NONBLOCK)
    ready = select.poll()
    ready.register(fd, select.POLLIN)
    try:
        with os.fdopen(fd, "rb", buffering=0) as source, connect() as target:
            while not STOP.is_set() and not stopped.is_set():
                # Woken as soon as the recorder writes: the 5 ms sleep this
                # replaces made each picture wait 2.6 ms in median (CAP-5,
                # test_capture_loop.py). Before the recorder opens the FIFO,
                # poll waits WAKE, so a stop and the checks below still come.
                data = source.read(65536) if ready.poll(WAKE * 1000) else None
                if not data:
                    if progress.check():
                        print(json.dumps({"capture_quiet": "half" if half else "full"}), flush=True)
                    if process.poll() is not None:
                        packets.finish()
                        raise RuntimeError(f"encoder exited: {process.returncode}")
                    if data == b"":
                        # The writer has closed the FIFO: poll now returns at once
                        # (POLLHUP) and every read gives b"". Wait for its exit
                        # here rather than turn without end.
                        stopped.wait(WAKE)
                    continue
                for captured, payload in packets.feed(data):
                    now = time.monotonic()
                    age_ms = now * 1000 - captured / 1000
                    # Reject a recorder using another clock; fake ages would corrupt
                    # the shared audio/video timeline and clips. The nominal rate
                    # does not replace the compositor's timestamps.
                    if age_ms < -100 or age_ms > 30_000:
                        raise RuntimeError(
                            f"capture timestamp is not monotonic: age {age_ms:.1f} ms"
                        )
                    if last_frame is not None:
                        gaps.append((captured - last_frame) / 1000)
                    last_frame = captured
                    if opening.admit(payload):
                        send(target, b"H" if half else b"F", payload, captured)
                        if not SHOWN.is_set():
                            SHOWN.set()
                    progress.saw()
                    if now >= report_at:
                        report_at = now + 5
                        ordered = sorted(gaps)
                        report = {"half": half, "capture_age_ms": round(age_ms, 2)}
                        if ordered:
                            report["frames"] = len(ordered) + 1
                            report["gap_ms"] = [
                                round(ordered[len(ordered) // 2], 1),
                                round(ordered[int(len(ordered) * 0.95)], 1),
                                round(ordered[-1], 1),
                            ]
                        gaps = []
                        print(json.dumps(report), flush=True)
    finally:
        stop_process(process, RECORDER_GRACE)


# How often the capture asks the worker for half-format viewers and key frame
# requests. The worker hands a request over only in its answer to « D »
# (ingress.rs): at 100 ms a request waited 70 ms when raised 30 ms after a
# « D » (test_capture_loop.py, 2026-11-27), up to 100 ms (WK-5). Each « D » is
# 13 bytes, answered at once with 10.
DEMAND_EVERY = 0.02
# The half recorder stops after no viewer for this long, the former poll
# period: asking more often never stops it on a shorter gap than before.
HALF_HOLD = 0.1


def half_capture(keys):
    worker = OnDemand(lambda stopped: video(True, keys, stopped))
    try:
        with connect() as control:
            # Poll outside either picture loop. At most DEMAND_EVERY is added
            # when a viewer first requests this format; no work is spent
            # encoding it between viewers. One second bounds a broken control
            # connection.
            control.settimeout(1)
            empty_since = None
            while not STOP.is_set():
                send(control, b"D", b"", captured=0)
                reply = bytearray()
                while len(reply) < 10:
                    chunk = control.recv(10 - len(reply))
                    if not chunk:
                        raise RuntimeError("capture demand connection closed")
                    reply.extend(chunk)
                count, full_key, half_key = struct.unpack("<QBB", reply)
                keys.request(False, full_key)
                keys.request(True, half_key)
                now = time.monotonic()
                if count > 0:
                    empty_since = None
                    worker.update(True)
                else:
                    empty_since = now if empty_since is None else empty_since
                    if now - empty_since >= HALF_HOLD:
                        worker.update(False)
                STOP.wait(DEMAND_EVERY)
    finally:
        worker.close()


def audio(progress):
    process = subprocess.Popen(
        [
            PAREC,
            "--device=nel3ab.monitor",
            "--format=s16le",
            "--rate=48000",
            "--channels=2",
            "--latency-msec=10",
        ],
        env=environment(),
        stdout=subprocess.PIPE,
    )
    PROCESSES.append(process)
    progress.follow(process.pid)
    try:
        with connect() as target:
            for data in chunks(process.stdout.fileno(), STOP):
                send(target, b"A", data)
                progress.saw()
    finally:
        stop_process(process)


def watch_progress(sources):
    while not STOP.wait(0.1):
        for name, progress in sources.items():
            try:
                if progress.check():
                    print(json.dumps({"capture_quiet": name}), flush=True)
            except RuntimeError as error:
                raise RuntimeError(f"{name}: {error}") from error


def main(keys):
    failures = []

    def stopping(*_):
        STOP.set()
        for process in list(PROCESSES):
            with contextlib.suppress(ProcessLookupError):
                process.send_signal(signal.SIGINT)

    def run(function, *args):
        try:
            function(*args)
            if not STOP.is_set():
                failures.append("capture ended unexpectedly")
        except Exception as error:
            if not STOP.is_set():
                failures.append(str(error))
        finally:
            stopping()

    signal.signal(signal.SIGTERM, stopping)
    signal.signal(signal.SIGINT, stopping)
    # Sound has no first copy: parec's first chunk is already sound.
    sources = {"full": Progress(), "audio": Progress(copies=0, start_limit=FAIL_AFTER)}
    threads = [
        threading.Thread(target=run, args=(video, False, keys, STOP, sources["full"])),
        threading.Thread(target=run, args=(half_capture, keys)),
        threading.Thread(target=run, args=(audio, sources["audio"])),
        threading.Thread(target=run, args=(watch_progress, sources)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    stopping()
    for process in list(PROCESSES):
        stop_process(process)
    if failures:
        raise RuntimeError("; ".join(failures))


def exit_status(keys):
    """0 after a requested stop. After a failure, its traceback, then
    SHOWN_THEN_FAILED if a game picture was sent, NOTHING_SHOWN if none was."""
    try:
        main(keys)
    except Exception:
        traceback.print_exc()
        return SHOWN_THEN_FAILED if SHOWN.is_set() else NOTHING_SHOWN
    return 0


if __name__ == "__main__":
    with exclusive(RUN_DATA), Keys(RUN_DATA) as keys:
        status = exit_status(keys)
    sys.exit(status)
