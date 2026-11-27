#!/usr/bin/env python3
"""Tableau d'une campagne : compare.py DOSSIER [args d'analyse.py]"""

import json
import subprocess
import sys
from pathlib import Path

d = Path(sys.argv[1])
extra = sys.argv[2:]
ici = Path(__file__).parent
print(
    f"{'phase':8} {'durée':>6} {'img/s':>6} {'perdues':>7} {'/min':>6} {'>25':>4} {'>50':>4} {'>100':>4} {'>250':>4} {'pire':>7} {'p99':>5} {'prog':>5} {'mesa':>5}  causes (n/perdues)"
)
for ph in sorted(p for p in d.iterdir() if (p / "full-trace.txt").exists()):
    r = json.loads(
        subprocess.run(
            [sys.executable, str(ici / "analyse.py"), str(ph), "--json", *extra],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )["resume"]
    s = r["par_seuil"]
    c = r["par_cause"]
    print(
        f"{ph.name:8} {r['duree_s']:>6} {r['img_s']:>6} {r['perdues']:>7} {r['perdues_min']:>6} {s['25']:>4} {s['50']:>4} {s['100']:>4} {s['250']:>4} {r['pire_ms']:>7} {r['p99_ms']:>5} {r['programmes_total']!s:>5} {r['mesa_total']:>5}  "
        + " ".join(f"{k[:4]} {v['n']}/{v['perdues']}" for k, v in c.items())
    )
