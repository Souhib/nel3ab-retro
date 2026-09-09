#!/usr/bin/env python3
"""Read only the four test devices passed to this observer container.

This checks the kernel state after the browser, transport and uinput helper;
it does not claim that an emulator has consumed that state.
"""
import json
import time
from pathlib import Path
from evdev import InputDevice
from evdev import ecodes as e

root = Path('/run-data')
paths = json.loads((root / 'devices.json').read_text())
if len(paths) != 4:
    raise RuntimeError('expected four isolated test pads')
devices = [InputDevice(path) for path in paths]
if any(not pad.name.startswith('nel3ab Switch controls test ') for pad in devices):
    raise RuntimeError('observer refuses a live or physical controller')
axes = {'lx': e.ABS_X, 'ly': e.ABS_Y, 'rx': e.ABS_RX, 'ry': e.ABS_RY,
        'zl': e.ABS_Z, 'zr': e.ABS_RZ, 'dx': e.ABS_HAT0X, 'dy': e.ABS_HAT0Y}
while True:
    state = [{'keys': pad.active_keys(), 'axes': {name: pad.absinfo(code).value
              for name, code in axes.items()}} for pad in devices]
    (root / 'observed.tmp').write_text(json.dumps(state))
    (root / 'observed.tmp').replace(root / 'observed.json')
    time.sleep(0.02)
