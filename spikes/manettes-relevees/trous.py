"""Holes of a mask (buttons, sticks), in a target frame.
usage: trous.py MASK x0 y0 scale ox oy"""

import sys

import cv2

m = cv2.imread(sys.argv[1], 0)
x0, y0, s, ox, oy = map(float, sys.argv[2:7])
cs, h = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
T = lambda x, y: ((x - x0) * s + ox, (y - y0) * s + oy)
for i, c in enumerate(cs):
    if h[0][i][3] < 0:
        continue  # outer
    a = cv2.contourArea(c)
    if a < 80:
        continue
    M = cv2.moments(c)
    cx, cy = M["m10"] / M["m00"], M["m01"] / M["m00"]
    x, y, w, hh = cv2.boundingRect(c)
    ap = cv2.approxPolyDP(c, 0.012 * cv2.arcLength(c, True), True)[:, 0, :]
    X, Y = T(cx, cy)
    poly = " ".join(f"{T(px, py)[0]:.1f},{T(px, py)[1]:.1f}" for px, py in ap)
    print(
        f"centre {X:.1f},{Y:.1f}  taille {w * s:.1f}x{hh * s:.1f}  sommets {len(ap)}: {poly}"
    )
