import math

from cr import closed, f, opened

s = 0.0438
T = lambda x, y: (14 + (x - 163) * s, 12 + (y - 154) * s)
nc = [
    (611, 154),
    (534, 160),
    (470, 186),
    (406, 224),
    (342, 275),
    (291, 333),
    (246, 410),
    (208, 512),
    (182, 640),
    (166, 768),
    (163, 896),
    (176, 1024),
    (208, 1101),
    (259, 1146),
    (310, 1158),
    (361, 1146),
    (419, 1107),
    (457, 1050),
    (489, 960),
    (508, 864),
    (521, 768),
    (540, 672),
    (572, 614),
    (624, 563),
    (681, 541),
    (745, 531),
    (742, 512),
    (700, 500),
    (700, 448),
    (707, 333),
    (694, 211),
    (662, 173),
]
print("NUNCHUK", closed([T(*p) for p in nc]))
seam = [
    (681, 192),
    (560, 215),
    (483, 262),
    (400, 340),
    (342, 448),
    (290, 540),
    (246, 640),
    (210, 760),
    (188, 896),
]
print("SEAM", opened([T(*p) for p in seam]))
# stick cap: rotated ellipse centred on (368,259), axis tilted -35 deg
cx, cy = T(368, 259)
a, b, th = 3.0, 1.15, math.radians(-32)


def E(t):
    x, y = a * math.cos(t), b * math.sin(t)
    return (
        cx + x * math.cos(th) - y * math.sin(th),
        cy + x * math.sin(th) + y * math.cos(th),
    )


print("CAP", closed([E(k * math.pi / 6) for k in range(12)]), "centre", f(cx), f(cy))
# stick post: from cap centre down-right into the body
px, py = T(410, 300)
print("POST", f(px), f(py))
for name, (x, y) in {"C": (722, 275), "Zc": (742, 424), "cable": (265, 1165)}.items():
    X, Y = T(x, y)
    print(name, f(X), f(Y))
print("Z box", [f(v) for v in (*T(668, 349), *T(816, 499))])
