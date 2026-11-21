"""Symmetric closed path from the LEFT half of a silhouette (target frame).
usage: sym.py PTS_JSON x0 y0 scale ox oy axis i0:i1 [i2:i3 ...] -- top_y bottom_y
Takes the listed point index ranges (in order, wrapping allowed) as the left
half from top centre to bottom centre, mirrors it about x=axis."""

import json
import sys
from pathlib import Path

d = json.loads(Path(sys.argv[1]).read_text())
x0, y0, s, ox, oy, axis = map(float, sys.argv[2:8])
rest = sys.argv[8:]
k = rest.index("--")
ranges, (ty, by) = rest[:k], map(float, rest[k + 1 : k + 3])
pts = d["pts"]
L = []
for r in ranges:
    a, b = map(int, r.split(":"))
    idx = range(a, b + 1)
    L += [((pts[i][0] - x0) * s + ox, (pts[i][1] - y0) * s + oy) for i in idx]
left = [(axis, ty)] + L + [(axis, by)]
right = [(2 * axis - x, y) for x, y in reversed(L)]
P = left + right
n = len(P)
f = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")
out = [f"M {f(P[0][0])} {f(P[0][1])}"]
for i in range(n):
    p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % n], P[(i + 2) % n]
    c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
    c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
    out.append(f"C {f(c1[0])} {f(c1[1])}, {f(c2[0])} {f(c2[1])}, {f(p2[0])} {f(p2[1])}")
print(" ".join(out) + " Z")
