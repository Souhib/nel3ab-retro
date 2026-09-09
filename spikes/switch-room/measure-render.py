#!/usr/bin/env python3
"""Summarize an explicitly observed interval of a MangoHud 0.6.9 CSV.

The interval is in seconds from the logger's start (its elapsed column).
These are sampled Vulkan presentations, not input latency or the browser FPS.
Select the interval while inspecting the game; a CSV cannot identify a match.
"""

import argparse
import csv
import json
import math
import statistics
import sys
from itertools import pairwise
from pathlib import Path


def measure(path: Path, start: float, end: float) -> dict:
    if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
        raise ValueError("expected finite bounds: 0 <= start < end")
    lines = path.read_text().splitlines()
    header = next((i for i, line in enumerate(lines) if line.startswith("fps,frametime,")), None)
    if header is None:
        raise ValueError("MangoHud FPS header missing")
    samples = []
    for row in csv.DictReader(lines[header:]):
        elapsed = float(row["elapsed"]) / 1_000_000_000
        if not math.isfinite(elapsed) or elapsed < 0:
            raise ValueError("invalid render timestamp")
        if start <= elapsed <= end:
            fps, frametime = float(row["fps"]), float(row["frametime"])
            if not all(math.isfinite(x) and x > 0 for x in (fps, frametime)):
                raise ValueError("invalid rendering sample in the selected interval")
            samples.append((elapsed, fps, frametime))
    if len(samples) < 2:
        raise ValueError("fewer than two samples in the selected interval")
    if any(b[0] <= a[0] for a, b in pairwise(samples)):
        raise ValueError("render timestamps must increase")
    ordered = sorted(sample[1] for sample in samples)
    return {
        "requested_seconds": [start, end],
        "observed_seconds": [samples[0][0], samples[-1][0]],
        "duration_seconds": samples[-1][0] - samples[0][0],
        "samples": len(samples),
        "fps_sample_median": statistics.median(ordered),
        "fps_sample_p05": ordered[int((len(ordered) - 1) * 0.05)],
        "fps_sample_min": ordered[0],
        "frametime_sample_max_ms": max(sample[2] for sample in samples),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    args = parser.parse_args()
    try:
        sys.stdout.write(json.dumps(measure(args.csv, args.start, args.end), indent=2) + "\n")
    except (OSError, ValueError, KeyError) as error:
        parser.exit(2, f"No measurement: {error}\n")
