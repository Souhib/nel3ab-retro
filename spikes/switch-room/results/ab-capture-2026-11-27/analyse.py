"""Les quatre phases A B B A, lues dans le journal du worker de chacune.

Une ligne de capture tombe toutes les 5 s : {"half":..., "capture_age_ms":...,
"frames":..., "gap_ms":[p50,p95,max]}. Le régime commence à la première
fenêtre de 250 images ou plus ; on écarte les 6 fenêtres suivantes (30 s),
où Smash finit de charger son écran titre, puis on garde tout le reste.
"""
import json, re, statistics, sys
from pathlib import Path

phases = []
for ligne in Path(sys.argv[1]).read_text().splitlines():
    m = re.match(r"debut (\w) (\S+)", ligne)
    if m:
        phases.append((m.group(1), Path(m.group(2))))

def lire(root):
    texte = (root / "worker.log").read_text(errors="replace")
    fen = []
    for l in texte.splitlines():
        m = re.search(r'"capture_age_ms": ([0-9.]+)(?:, "frames": (\d+), "gap_ms": \[([0-9.]+), ([0-9.]+), ([0-9.]+)\])?', l)
        if m and m.group(2):
            fen.append((float(m.group(1)), int(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5))))
    return texte, fen

print(f"{'phase':6} {'coupée':>7} {'avant régime':>13} {'fen.':>5} {'âge méd':>8} {'âge p95':>8} {'img/s':>6} {'max>34':>7} {'>50':>4} {'>100':>5} {'pire':>7}")
res = {}
for i, (bras, root) in enumerate(phases, 1):
    texte, fen = lire(root)
    coupee = texte.count("no complete packet")
    debut = next((k for k, f in enumerate(fen) if f[1] >= 250), None)
    if debut is None:
        print(f"{bras}{i:<5} aucune fenêtre en régime ({len(fen)} fenêtres)"); continue
    regime = fen[debut + 6:]
    ages = [f[0] for f in regime]
    imgs = sum(f[1] for f in regime) / (5 * len(regime))
    maxs = [f[4] for f in regime]
    res.setdefault(bras, []).append((statistics.median(ages), imgs, maxs))
    p95 = sorted(ages)[int(0.95 * (len(ages) - 1))]
    print(f"{bras}{i:<5} {coupee:>7} {debut*5:>11} s {len(regime):>5} {statistics.median(ages):>8.2f} {p95:>8.2f} {imgs:>6.2f} "
          f"{sum(m>34 for m in maxs):>7} {sum(m>50 for m in maxs):>4} {sum(m>100 for m in maxs):>5} {max(maxs):>7.1f}")
for bras, v in sorted(res.items()):
    print(f"bras {bras}: âge médian par phase {[round(x[0],2) for x in v]}, images/s {[round(x[1],2) for x in v]}")
