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
import signal
import socket
import struct
import subprocess
import threading
import time
from pathlib import Path

from capture_audio import chunks
from capture_control import exclusive
from capture_demand import OnDemand
from capture_health import Progress
from capture_keys import Keys
from capture_packets import Packets
from capture_process import stop_child

ENV = dict(
    os.environ,
    XDG_RUNTIME_DIR="/tmp/nel3ab-runtime",
    WAYLAND_DISPLAY=json.loads(Path("/run-data/display.json").read_text())["display"],
    PULSE_SERVER="unix:/tmp/nel3ab-runtime/pulse/native",
)
STOP = threading.Event()
PROCESSES = []


def connect():
    stream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    # A dead bridge must not leave a producer blocked on a full socket.
    stream.settimeout(2)
    stream.connect("/pads/media.sock")
    return stream


def send(stream, kind, payload, captured=None):
    if captured is None:
        captured = time.monotonic_ns() // 1000
    stream.sendall(struct.pack("<cQI", kind, captured, len(payload)) + payload)


def stop_process(process):
    if stop_child(process):
        print(json.dumps({"capture_child_forced": process.pid}), flush=True)
    PROCESSES.remove(process)


def video(half, stopped=STOP, progress=None):
    progress = progress or Progress()
    fifo = "/run-data/half.h264" if half else "/run-data/full.h264"
    if os.path.exists(fifo):
        os.unlink(fifo)
    os.mkfifo(fifo, 0o600)
    # One encode in flight, and complete packets straight from the recorder.
    # The packet clock comes from the compositor; FIFO reads can arrive grouped
    # without pretending those images were captured a few microseconds apart.
    command = [
        "/usr/local/bin/nel3ab-wf-recorder",
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
    with open("/run-data/half-capture.log" if half else "/run-data/full-capture.log", "w") as log:
        process = subprocess.Popen(
            command,
            env=dict(
                ENV,
                NEL3AB_PACKET_PIPE=fifo,
                NEL3AB_KEY_PIPE="/run-data/half.key" if half else "/run-data/full.key",
            ),
            stdin=subprocess.PIPE,
            stdout=log,
            stderr=log,
        )
    PROCESSES.append(process)
    # Confirm /dev/null output; framed packets use the FIFO instead.
    process.stdin.write(b"y\n")
    process.stdin.close()
    packets = Packets()
    report_at = 0.0
    fd = os.open(fifo, os.O_RDONLY | os.O_NONBLOCK)
    try:
        with os.fdopen(fd, "rb", buffering=0) as source, connect() as target:
            while not STOP.is_set() and not stopped.is_set():
                data = source.read(65536)
                if not data:
                    if progress.check():
                        print(json.dumps({"capture_quiet": "half" if half else "full"}), flush=True)
                    if process.poll() is not None:
                        packets.finish()
                        raise RuntimeError(f"encoder exited: {process.returncode}")
                    stopped.wait(0.005)
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
                    send(target, b"H" if half else b"F", payload, captured)
                    progress.saw()
                    if now >= report_at:
                        report_at = now + 5
                        print(
                            json.dumps({"half": half, "capture_age_ms": round(age_ms, 2)}),
                            flush=True,
                        )
    finally:
        stop_process(process)


def half_capture(keys):
    worker = OnDemand(lambda stopped: video(True, stopped))
    try:
        with connect() as control:
            # Poll outside either picture loop. At most 100 ms is added when a
            # viewer first requests this format; no work is spent encoding it
            # between viewers. One second bounds a broken control connection.
            control.settimeout(1)
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
                worker.update(count > 0)
                STOP.wait(0.1)
    finally:
        worker.close()


def audio(progress):
    process = subprocess.Popen(
        [
            "/usr/bin/parec",
            "--device=nel3ab.monitor",
            "--format=s16le",
            "--rate=48000",
            "--channels=2",
            "--latency-msec=10",
        ],
        env=ENV,
        stdout=subprocess.PIPE,
    )
    PROCESSES.append(process)
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
    sources = {"full": Progress(), "audio": Progress()}
    threads = [
        threading.Thread(target=run, args=(video, False, STOP, sources["full"])),
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


if __name__ == "__main__":
    with exclusive("/run-data"), Keys("/run-data") as keys:
        main(keys)
