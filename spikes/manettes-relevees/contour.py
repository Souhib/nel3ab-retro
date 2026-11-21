"""Extract the outer silhouette of a controller photo as a smooth SVG path.

usage: contour.py IMAGE MODE OUT_PREFIX [x0 y0 x1 y1 crop]
MODE: dark-bg (object brighter than background) | light-bg (object darker) | hue:LO-HI
Prints the bounding box and a Catmull-Rom smoothed path in IMAGE pixel space.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

img = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
mode = sys.argv[2]
out = sys.argv[3]
if img.shape[2] == 4:
    alpha = img[:, :, 3]
    bgr = img[:, :, :3]
else:
    alpha = None
    bgr = img
gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
import os

for r in filter(None, os.environ.get("BLANK", "").split(";")):
    a, b, c2, d2 = map(int, r.split(","))
    bgr = bgr.copy()
    bgr[b:d2, a:c2] = 0
    if alpha is not None:
        alpha = alpha.copy()
        alpha[b:d2, a:c2] = 0
gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
if mode == "dark-bg":
    mask = (gray > 18).astype(np.uint8) * 255
    if alpha is not None:
        mask &= (alpha > 40).astype(np.uint8) * 255
elif mode == "light-bg":
    mask = (gray < 200).astype(np.uint8) * 255
elif mode.startswith("dark-obj"):
    t = int(mode.split(":")[1])
    mask = (gray < t).astype(np.uint8) * 255
elif mode.startswith("hue:"):
    lo, hi = map(int, mode[4:].split("-"))
    mask = (
        (hsv[:, :, 0] >= lo)
        & (hsv[:, :, 0] <= hi)
        & (hsv[:, :, 1] > 60)
        & (hsv[:, :, 2] > 40)
    ).astype(np.uint8) * 255
k = int(sys.argv[4]) if len(sys.argv) > 4 else 15
mask = cv2.morphologyEx(
    mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
)
mask = cv2.morphologyEx(
    mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
)
n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
mask = ((labels == big) * 255).astype(np.uint8)
# fill holes
cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cs, key=cv2.contourArea)[:, 0, :].astype(float)
cv2.imwrite(out + "-mask.png", mask)
x, y, w, h = cv2.boundingRect(c.astype(np.int32))
print(json.dumps({"bbox": [x, y, w, h]}))
# resample evenly
N = int(sys.argv[5]) if len(sys.argv) > 5 else 48
d = np.r_[0, np.cumsum(np.hypot(*np.diff(np.r_[c, c[:1]], axis=0).T))]
L = d[-1]
ts = np.linspace(0, L, N, endpoint=False)
pts = np.c_[
    np.interp(ts, d, np.r_[c[:, 0], c[0, 0]]), np.interp(ts, d, np.r_[c[:, 1], c[0, 1]])
]
np.save(out + "-pts.npy", pts)
Path(out + "-pts.json").write_text(
    json.dumps({"bbox": [x, y, w, h], "pts": pts.round(1).tolist()})
)
