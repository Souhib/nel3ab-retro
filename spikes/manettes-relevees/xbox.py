from pathlib import Path

s = 0.1237
T = lambda dx, py: (50 + dx * s, (py - 118) * s + 5)
left = [
    (0, 130),
    (-110, 131),
    (-190, 136),
    (-245, 146),
    (-282, 163),
    (-310, 195),
    (-333, 250),
    (-352, 315),
    (-367, 390),
    (-376, 460),
    (-379, 530),
    (-375, 585),
    (-360, 625),
    (-335, 652),
    (-305, 660),
    (-280, 652),
    (-258, 628),
    (-238, 590),
    (-218, 550),
    (-196, 525),
    (-165, 515),
    (-90, 513),
    (0, 513),
]
L = [T(*p) for p in left]
R = [(100 - x, y) for x, y in reversed(L[1:-1])]
P = L + R
f = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")
n = len(P)
out = [f"M {f(P[0][0])} {f(P[0][1])}"]
for i in range(n):
    p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % n], P[(i + 2) % n]
    c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
    c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
    out.append(f"C {f(c1[0])} {f(c1[1])}, {f(c2[0])} {f(c2[1])}, {f(p2[0])} {f(p2[1])}")
Path("xb-body.d").write_text(" ".join(out) + " Z")


# bumper LB and trigger LT, in (dx, py)
def conv(seq):
    o = []
    for cmd, *xy in seq:
        q = []
        for k in range(0, len(xy), 2):
            X, Y = T(xy[k], xy[k + 1])
            q += [f(X), f(Y)]
        o.append(
            cmd
            + " "
            + " ".join(q[:2])
            + (", " + " ".join(q[2:4]) + ", " + " ".join(q[4:6]) if cmd == "C" else "")
        )
    return " ".join(o) + " Z"


lb = conv(
    [
        ("M", -312, 185),
        ("C", -300, 148, -262, 124, -205, 118, -150, 116),
        ("C", -128, 116, -118, 124, -120, 138),
        ("L", -180, 150),
        ("L", -300, 200),
    ]
)
lt = conv(
    [
        ("M", -265, 150),
        ("C", -262, 118, -235, 96, -195, 93, -160, 92),
        ("C", -138, 92, -128, 104, -130, 125),
        ("L", -200, 140),
    ]
)
print("LB", lb)
print("LT", lt)
for name, (dx, py) in {
    "ls": (-217, 262),
    "rs": (119, 385),
    "dpad": (-109, 400),
    "xbox": (0, 183),
    "view": (-60, 262),
    "share": (0, 307),
    "face": (207, 264),
}.items():
    X, Y = T(dx, py)
    print(name, f(X), f(Y))
print(
    "r cap",
    f(52 * s),
    "dpad base",
    f(66 * s),
    "arm half",
    f(20 * s),
    "arm len",
    f(52 * s),
    "face r",
    f(26 * s),
    "xbox r",
    f(31 * s),
    "view r",
    f(17 * s),
    "face off",
    f(51 * s),
)
