from pathlib import Path

from cr import closed, f

s = 0.1193
T = lambda px, py: (50 + (px - 468) * s, 7 + (py - 77) * s)
D = lambda dx, dy: T(60 + dx / 2, 40 + dy / 2)
left = [
    (816, 75),
    (600, 75),
    (480, 78),
    (380, 72),
    (300, 80),
    (240, 110),
    (195, 160),
    (160, 240),
    (135, 330),
    (115, 420),
    (90, 520),
    (65, 640),
    (48, 780),
    (48, 920),
    (65, 1040),
    (105, 1130),
    (170, 1170),
    (250, 1165),
    (320, 1130),
    (365, 1060),
    (395, 960),
    (420, 870),
    (455, 820),
    (520, 812),
    (816, 812),
]
L = [D(*p) for p in left]
R = [(100 - x, y) for x, y in reversed(L[1:-1])]
Path("sp-body.d").write_text(closed(L + R))
for name, (px, py) in {
    "LS": (245, 210),
    "RS": (580, 330),
    "dpad": (340, 325),
    "face": (687, 212),
    "minus": (367, 155),
    "plus": (572, 155),
    "capture": (415, 212),
    "home": (520, 212),
    "seam0": (116, 245),
    "seam1": (261, 450),
}.items():
    X, Y = T(px, py)
    print(name, f(X), f(Y))
print("bottom", f(T(0, 625)[1]), "centre bottom", f(T(0, 446)[1]))
