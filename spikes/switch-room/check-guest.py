#!/usr/bin/env python3
"""Check the guest's actual pixels, extended Switch buttons, and neutral expiry."""

import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(os.environ.get("SWITCH_LAB", "/tmp/nel3ab-switch-lab"))
CONTAINER = "nel3ab-switch-ryubing-lab"


def picture():
    subprocess.run(
        [
            "docker",
            "exec",
            CONTAINER,
            "env",
            "XDG_RUNTIME_DIR=/tmp/nel3ab-runtime",
            "WAYLAND_DISPLAY=wayland-0",
            "grim",
            "-t",
            "ppm",
            "/run-data/check.ppm",
        ],
        check=True,
    )
    with (ROOT / "ryubing-lab/check.ppm").open("rb") as image:
        assert image.readline().strip() == b"P6"
        dimensions = image.readline()
        while dimensions.startswith(b"#"):
            dimensions = image.readline()
        assert dimensions.strip() == b"1280 720"
        assert image.readline().strip() == b"255"
        pixels = image.read()
    assert len(pixels) == 1280 * 720 * 3

    def white(x, y):
        at = (y * 1280 + x) * 3
        return all(channel > 230 for channel in pixels[at : at + 3])

    return white


def until(predicate, seconds=3):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = picture()
        if predicate(value):
            return value
    raise AssertionError("guest pixels did not reach the expected state")


def main():
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    target = str(ROOT / "pads/pads.sock")
    report = {
        "players": [],
        "extended_buttons": [],
        "neutral_ms": [],
        "save_counter": None,
    }
    white = picture()
    assert all(white((i % 2) * 640 + 20, (i // 2) * 320 + 60) for i in range(4)), (
        "all four guest pads must be connected"
    )
    for i in range(4):
        buttons = ["a", "b", "x", "y", "l", "r", "minus", "ls", "rs"]
        bits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11]
        if i == 1:
            buttons.append("plus")
            bits.append(10)  # P1 Plus exits the fixture, so exercise Plus on P2.
        direction = 1 if i % 2 else -1
        bits += [14, 15] if direction == 1 else [12, 13]
        packet = json.dumps(
            {
                "player": i + 1,
                "buttons": buttons,
                "axes": {
                    "lx": 32767,
                    "ry": -32768,
                    "zl": 255,
                    "zr": 255,
                    "dx": direction,
                    "dy": direction,
                },
            }
        ).encode()
        stop = threading.Event()

        def hold(stop=stop, packet=packet):
            while not stop.wait(0.05):
                sock.sendto(packet, target)

        thread = threading.Thread(target=hold)
        thread.start()
        try:
            white = until(
                lambda w, i=i, bits=bits: all(
                    w((i % 2) * 640 + 50 + 32 * bit, (i // 2) * 320 + 74)
                    for bit in bits
                )
            )
            assert all(
                not white((j % 2) * 640 + 50, (j // 2) * 320 + 74)
                for j in range(4)
                if j != i
            )
            assert white((i % 2) * 640 + 225, (i // 2) * 320 + 205), (
                "left stick must move only this player's marker"
            )
            report["players"].append(i + 1)
            report["extended_buttons"].append(buttons)
        finally:
            stop.set()
            thread.join()
        started = time.monotonic()
        until(lambda w, i=i: not w((i % 2) * 640 + 50, (i // 2) * 320 + 74), seconds=2)
        report["neutral_ms"].append(round((time.monotonic() - started) * 1000))
    white = picture()
    report["save_counter"] = sum(
        1 << bit for bit in range(16) if white(bit * 32 + 16, 700)
    )
    assert report["save_counter"] >= 2, (
        "restart must preserve and increment the private SD counter"
    )
    stored = (ROOT / "ryubing-lab/data/sdcard/nel3ab-probe.bin").read_bytes()
    assert len(stored) == 4
    assert int.from_bytes(stored, "little") == report["save_counter"]
    (ROOT / "guest-result.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
