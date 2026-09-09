#!/usr/bin/env python3
"""Ask only an isolated test pad to vibrate, through real Linux force feedback."""

import json
import sys
import time
from pathlib import Path

from evdev import InputDevice, ecodes, ff

paths = json.loads(Path("/run-data/devices.json").read_text())
player = int(sys.argv[1])
if not 1 <= player <= 4:
    raise ValueError("test player must be 1..4")
pad = InputDevice(paths[player - 1])
try:
    if not pad.name.startswith("nel3ab Switch controls test "):
        raise RuntimeError("rumble test refuses a live or physical controller")
    effect = ff.Effect(
        ecodes.FF_RUMBLE,
        -1,
        0,
        ff.Trigger(0, 0),
        ff.Replay(250, 0),
        ff.EffectType(ff_rumble_effect=ff.Rumble(32768, 16384)),
    )
    effect_id = pad.upload_effect(effect)
    pad.write(ecodes.EV_FF, effect_id, 1)
    # This is the effect's duration, not a wait for an assertion. Closing the
    # device immediately cancels it before the worker can publish it (2026-09-09).
    time.sleep(0.25)
finally:
    pad.close()
