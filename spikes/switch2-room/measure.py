#!/usr/bin/env python3
"""Read game presentations, independently of the compositor and the browser.

The pinned emulators report one non-overlapping window of 600 game presents.
Frame generation must be off. A screenshot or an operator observation must
identify the scene; a log cannot distinguish gameplay from a title screen.
The maximum and freeze count are real frame measurements. The FPS samples are
window averages, so their percentiles are not individual-frame percentiles.
"""

import argparse
import json
import math
import re
import statistics
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;]*m")
PRESENTS = re.compile(
    r"\[\s*(?P<end>\d+(?:\.\d+)?)\].*last 600 presents: "
    r"frame (?P<mean>\d+) us \(max (?P<maximum>\d+), "
    r"(?P<freezes>\d+) over 100 ms\)"
)


@dataclass(frozen=True)
class Window:
    start: float
    end: float
    mean_us: int
    maximum_us: int
    freezes: int

    @property
    def fps(self):
        return 1_000_000 / self.mean_us


def read_windows(text):
    windows = []
    for match in PRESENTS.finditer(ANSI.sub("", text.replace("\x00", ""))):
        end = float(match["end"])
        mean, maximum, freezes = (int(match[name]) for name in ("mean", "maximum", "freezes"))
        if mean <= 0 or maximum < mean or not 0 <= freezes <= 600:
            raise ValueError("invalid game presentation statistics")
        start = end - mean * 600 / 1_000_000
        if start < 0 or (windows and end <= windows[-1].end):
            raise ValueError("game presentation clock did not advance")
        windows.append(Window(start, end, mean, maximum, freezes))
    if not windows:
        raise ValueError("no game presentation windows in this log")
    return windows


def measure(text, start, end):
    if not all(math.isfinite(value) for value in (start, end)) or not 0 <= start < end:
        raise ValueError("expected finite bounds: 0 <= start < end")
    selected = [w for w in read_windows(text) if start <= w.start and w.end <= end]
    if not selected:
        raise ValueError("no complete game presentation window inside the observed scene")
    duration = sum(w.mean_us * 600 / 1_000_000 for w in selected)
    return {
        "requested_seconds": [start, end],
        "covered_seconds": duration,
        "game_presentations": len(selected) * 600,
        "game_fps": len(selected) * 600 / duration,
        "window_fps_median": statistics.median(w.fps for w in selected),
        "maximum_frame_ms": max(w.maximum_us for w in selected) / 1000,
        "frames_over_100_ms": sum(w.freezes for w in selected),
        "windows": [asdict(w) for w in selected],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    args = parser.parse_args()
    try:
        result = measure(args.log.read_text(errors="replace"), args.start, args.end)
    except (OSError, ValueError) as error:
        parser.exit(2, f"No measurement: {error}\n")
    sys.stdout.write(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
