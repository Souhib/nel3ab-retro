"""Where the page's X and Y land on the virtual pads, without /dev/uinput.

The helper imports python-evdev, which only exists in the room image; a stub
with the kernel's real key codes stands in for it here.
"""

import importlib.util
import sys
import types
import unittest
from pathlib import Path

CODES = {
    "BTN_A": 0x130,
    "BTN_B": 0x131,
    "BTN_X": 0x133,
    "BTN_Y": 0x134,
    "BTN_TL": 0x136,
    "BTN_TR": 0x137,
    "BTN_SELECT": 0x13A,
    "BTN_START": 0x13B,
    "BTN_MODE": 0x13C,
    "BTN_THUMBL": 0x13D,
    "BTN_THUMBR": 0x13E,
}


def load():
    ecodes = types.SimpleNamespace(**CODES)
    for name in ("ABS_X", "ABS_Y", "ABS_RX", "ABS_RY", "ABS_Z", "ABS_RZ", "ABS_HAT0X", "ABS_HAT0Y"):
        setattr(ecodes, name, len(vars(ecodes)))
    for name in (
        "EV_KEY",
        "EV_ABS",
        "EV_FF",
        "FF_RUMBLE",
        "EV_UINPUT",
        "UI_FF_UPLOAD",
        "UI_FF_ERASE",
    ):
        setattr(ecodes, name, 1000 + len(vars(ecodes)))
    # Only the stub's lifetime is this import: other tests may load the real
    # evdev, or rely on its absence.
    previous = sys.modules.get("evdev")
    sys.modules["evdev"] = types.SimpleNamespace(AbsInfo=object, UInput=object, ecodes=ecodes)
    sys.path.insert(0, str(Path(__file__).parent))
    spec = importlib.util.spec_from_file_location("pads", Path(__file__).with_name("pads.py"))
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    finally:
        if previous is None:
            del sys.modules["evdev"]
        else:
            sys.modules["evdev"] = previous
    return module


class Layout(unittest.TestCase):
    def test_an_xbox_room_keeps_x_left_and_y_top(self):
        pads = load()
        xbox = pads.layout({"NEL3AB_PAD_LAYOUT": "xbox"})
        self.assertEqual((xbox["x"], xbox["y"]), (CODES["BTN_X"], CODES["BTN_Y"]))

    def test_a_switch_room_still_swaps_them_for_ryubing(self):
        # The twin: the 2026-09-11 fix for Mario Party stays in force by default.
        pads = load()
        for environ in ({}, {"NEL3AB_PAD_LAYOUT": "switch"}):
            switch = pads.layout(environ)
            self.assertEqual((switch["x"], switch["y"]), (CODES["BTN_Y"], CODES["BTN_X"]))

    def test_both_layouts_declare_the_same_keys_so_sdl_sees_the_same_pad(self):
        pads = load()
        self.assertEqual(
            sorted(pads.LAYOUTS["xbox"].values()), sorted(pads.LAYOUTS["switch"].values())
        )

    def test_an_unknown_layout_is_refused(self):
        with self.assertRaises(ValueError):
            load().layout({"NEL3AB_PAD_LAYOUT": "nes"})


if __name__ == "__main__":
    unittest.main()
