"""Colour blobs (buttons) of a photo, in a target frame.
usage: taches.py IMAGE x0 y0 scale ox oy NAME:hlo-hhi:smin:vmin[:smax] ..."""

import sys

import cv2
import numpy as np

img = cv2.imread(sys.argv[1])[:, :, :3]
x0, y0, s, ox, oy = map(float, sys.argv[2:7])
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
T = lambda x, y: ((x - x0) * s + ox, (y - y0) * s + oy)
for spec in sys.argv[7:]:
    name, hr, smin, vmin, *rest = spec.split(":")
    lo, hi = map(int, hr.split("-"))
    smax = int(rest[0]) if rest else 255
    m = (
        (hsv[..., 0] >= lo)
        & (hsv[..., 0] <= hi)
        & (hsv[..., 1] >= int(smin))
        & (hsv[..., 1] <= smax)
        & (hsv[..., 2] >= int(vmin))
    ).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    order = np.argsort(-st[1:, cv2.CC_STAT_AREA])[:4] + 1
    for k in order:
        if st[k, cv2.CC_STAT_AREA] < 150:
            continue
        X, Y = T(*cen[k])
        print(
            f"{name}: centre {X:.1f},{Y:.1f} taille {st[k, 2] * s:.1f}x{st[k, 3] * s:.1f} aire {st[k, 4]}"
        )
