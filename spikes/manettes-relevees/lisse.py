"""Turn evenly spaced points into a closed cubic path in a target frame.
usage: lisse.py PTS_JSON x0 y0 scale [tension]
Maps image (px,py) -> ((px-x0)*scale, (py-y0)*scale)."""

import json
import sys
from pathlib import Path

d = json.loads(Path(sys.argv[1]).read_text())
x0, y0, s = map(float, sys.argv[2:5])
ox, oy = (float(sys.argv[6]), float(sys.argv[7])) if len(sys.argv) > 7 else (0.0, 0.0)
t = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
P = [((x - x0) * s + ox, (y - y0) * s + oy) for x, y in d["pts"]]
n = len(P)
f = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")
out = [f"M {f(P[0][0])} {f(P[0][1])}"]
for i in range(n):
    p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % n], P[(i + 2) % n]
    c1 = (p1[0] + (p2[0] - p0[0]) / 6 * t, p1[1] + (p2[1] - p0[1]) / 6 * t)
    c2 = (p2[0] - (p3[0] - p1[0]) / 6 * t, p2[1] - (p3[1] - p1[1]) / 6 * t)
    out.append(f"C {f(c1[0])} {f(c1[1])}, {f(c2[0])} {f(c2[1])}, {f(p2[0])} {f(p2[1])}")
print(" ".join(out) + " Z")
