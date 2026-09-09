#!/usr/bin/env python3
"""Read the kernel events: holding a button must not manufacture releases."""

import json
import select
import socket
import time

from evdev import InputDevice, ecodes

device = InputDevice(json.load(open("/pads/devices.json"))[0])
socket = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)


def send(buttons, axis):
    socket.sendto(
        json.dumps({"player": 1, "buttons": buttons, "axes": {"rx": axis}}).encode(),
        "/pads/pads.sock",
    )


def until_axis(value):
    deadline = time.monotonic() + 2
    events = []
    seen = False
    while time.monotonic() < deadline:
        if not select.select([device.fd], [], [], 0.1)[0]:
            continue
        for event in device.read():
            events.append(event)
            if (
                event.type == ecodes.EV_ABS
                and event.code == ecodes.ABS_RX
                and event.value == value
            ):
                seen = True
            if seen and event.type == ecodes.EV_SYN:
                return events
    raise AssertionError("The input command was not processed by the kernel")


try:
    send([], 1)
    until_axis(1)
    send(["a"], 1234)
    first = until_axis(1234)
    assert any(
        e.type == ecodes.EV_KEY and e.code == ecodes.BTN_SOUTH and e.value == 1
        for e in first
    )
    send(["a"], 1235)
    held = until_axis(1235)
    assert not any(
        e.type == ecodes.EV_KEY and e.code == ecodes.BTN_SOUTH for e in held
    ), "Held A generated another key edge"
    send([], 1236)
    released = until_axis(1236)
    assert any(
        e.type == ecodes.EV_KEY and e.code == ecodes.BTN_SOUTH and e.value == 0
        for e in released
    )
    print("Held button stays held; an actual release is delivered.")
finally:
    send([], 0)
    device.close()
    socket.close()
