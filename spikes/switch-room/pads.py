#!/usr/bin/env python3
"""Four private uinput pads. This helper runs in the prototype container as root.

Only /dev/uinput is passed in. The freshly created event devices belong to the
host user, and only those devices are passed to the emulator. No physical input
device is opened. Commands are JSON datagrams on a private Unix socket.
"""

import json
import os
import selectors
import signal
import socket
import time
from pathlib import Path

from evdev import AbsInfo, UInput
from evdev import ecodes as e
from pad_rumble import send_rumble

ROOT = Path("/run-data")
BUTTONS = {
    "a": e.BTN_SOUTH,
    "b": e.BTN_EAST,
    "x": e.BTN_NORTH,
    "y": e.BTN_WEST,
    "l": e.BTN_TL,
    "r": e.BTN_TR,
    "minus": e.BTN_SELECT,
    "plus": e.BTN_START,
    "ls": e.BTN_THUMBL,
    "rs": e.BTN_THUMBR,
    "home": e.BTN_MODE,
}
AXES = {
    "lx": e.ABS_X,
    "ly": e.ABS_Y,
    "rx": e.ABS_RX,
    "ry": e.ABS_RY,
    "zl": e.ABS_Z,
    "zr": e.ABS_RZ,
    "dx": e.ABS_HAT0X,
    "dy": e.ABS_HAT0Y,
}


def main():
    caps = {e.EV_KEY: list(BUTTONS.values()), e.EV_FF: [e.FF_RUMBLE]}
    caps[e.EV_ABS] = [
        (
            code,
            AbsInfo(
                0,
                0 if name in ("zl", "zr") else -1 if name in ("dx", "dy") else -32768,
                255 if name in ("zl", "zr") else 1 if name in ("dx", "dy") else 32767,
                0,
                0,
                0,
            ),
        )
        for name, code in AXES.items()
    ]
    # Isolated browser tests create another set without borrowing live pads.
    # The name also distinguishes their sysfs nodes during startup discovery.
    label = os.environ.get("NEL3AB_PAD_LABEL", "nel3ab Switch prototype")
    pads = [
        UInput(
            caps,
            name=f"{label} P{i + 1}",
            vendor=0x045E,
            product=0x028E,
            bustype=e.BUS_USB,
            version=0x0114,
            phys=f"nel3ab-switch-{i + 1}",
            max_effects=16,
        )
        for i in range(4)
    ]
    uid = int(os.environ.get("HOST_UID", "1000"))
    devices = []
    for i in range(4):
        matches = [
            p
            for p in Path("/sys/class/input").glob("event*")
            if (p / "device/name").read_text().strip()
            == f"{label} P{i + 1}"
        ]
        if len(matches) != 1:
            raise RuntimeError(f"expected one private P{i + 1}, found {len(matches)}")
        path = Path("/dev/input") / matches[0].name
        os.chmod(path, 0o600)
        os.chown(path, uid, uid)
        devices.append(str(path))
    (ROOT / "devices.json").write_text(json.dumps(devices))
    address = ROOT / "pads.sock"
    address.unlink(missing_ok=True)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    sock.bind(str(address))
    os.chmod(address, 0o600)
    os.chown(address, uid, uid)
    selector = selectors.DefaultSelector()
    selector.register(sock, selectors.EVENT_READ, None)
    for i, pad in enumerate(pads):
        selector.register(pad.fd, selectors.EVENT_READ, i)
    effects = [{} for _ in pads]
    last = [0.0] * 4
    active = [False] * 4
    current = [{} for _ in pads]
    rumble_available = True
    running = True

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def empty():
        return {
            (kind, code): 0
            for kind, codes in ((e.EV_KEY, BUTTONS), (e.EV_ABS, AXES))
            for code in codes.values()
        }

    def apply(i, desired):
        # A full snapshot must not release then press a held button. The real
        # evdev test caught those false edges on 2026-09-07. Emit only changes.
        for (kind, code), value in desired.items():
            if current[i].get((kind, code)) != value:
                pads[i].write(kind, code, value)
        pads[i].syn()
        current[i] = desired

    def neutral(i):
        apply(i, empty())
        active[i] = False

    try:
        for i in range(4):
            neutral(i)
        while running:
            for key, _ in selector.select(0.05):
                if key.data is None:
                    raw = sock.recv(4096)
                    try:
                        command = json.loads(raw)
                        i = command["player"] - 1
                        if not 0 <= i < 4:
                            raise ValueError("player must be 1..4")
                        desired = empty()
                        for name in command.get("buttons", []):
                            desired[e.EV_KEY, BUTTONS[name]] = 1
                        for name, value in command.get("axes", {}).items():
                            if not isinstance(value, int):
                                raise ValueError("axis must be an integer")
                            maximum = (
                                255
                                if name in ("zl", "zr")
                                else 1
                                if name in ("dx", "dy")
                                else 32767
                            )
                            minimum = (
                                0
                                if name in ("zl", "zr")
                                else -1
                                if name in ("dx", "dy")
                                else -32768
                            )
                            desired[e.EV_ABS, AXES[name]] = max(
                                minimum, min(maximum, value)
                            )
                        apply(i, desired)
                        active[i] = True
                        last[i] = time.monotonic()
                    except (ValueError, KeyError, TypeError) as error:
                        print(json.dumps({"invalid": str(error)}), flush=True)
                else:
                    i = key.data
                    for event in pads[i].read():
                        if event.type == e.EV_UINPUT and event.code == e.UI_FF_UPLOAD:
                            upload = pads[i].begin_upload(event.value)
                            effects[i][upload.effect.id] = (
                                upload.effect.u.ff_rumble_effect.strong_magnitude,
                                upload.effect.u.ff_rumble_effect.weak_magnitude,
                            )
                            upload.retval = 0
                            pads[i].end_upload(upload)
                        elif event.type == e.EV_UINPUT and event.code == e.UI_FF_ERASE:
                            erase = pads[i].begin_erase(event.value)
                            effects[i].pop(erase.effect_id, None)
                            erase.retval = 0
                            pads[i].end_erase(erase)
                        elif event.type == e.EV_FF:
                            print(
                                json.dumps(
                                    {
                                        "rumble": i + 1,
                                        "id": event.code,
                                        "play": event.value,
                                        "magnitude": effects[i].get(event.code),
                                    }
                                ),
                                flush=True,
                            )
                            magnitude = (
                                max(effects[i].get(event.code, (0, 0)))
                                if event.value
                                else 0
                            )
                            delivered = send_rumble(
                                sock,
                                bytes((i + 1, magnitude // 256)),
                                str(ROOT / "rumble.sock"),
                            )
                            if delivered != rumble_available:
                                print(json.dumps({"rumble_available": delivered}), flush=True)
                                rumble_available = delivered
            # Prototype heartbeat guard, deliberately short enough for scripted
            # tests: measured expiry is checked before this can serve a room.
            for i in range(4):
                if active[i] and time.monotonic() - last[i] > 1:
                    neutral(i)
                    print(json.dumps({"neutral": i + 1}), flush=True)
    finally:
        for i, pad in enumerate(pads):
            neutral(i)
            pad.close()
        address.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
