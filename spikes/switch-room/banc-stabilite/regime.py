#!/usr/bin/env python3
"""Tranches de 10 s d'une phase : images perdues, pire écart, programmes neufs,
entrées Mesa. Résume les tranches « sans shader neuf » (aucun programme ni entrée
Mesa dans la tranche et dans la précédente)."""

import bisect
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

for ph in map(Path, sys.argv[1:]):
    im = [int(l) for l in (ph / "full-trace.txt").read_text().split()][1:]
    ech = [json.loads(l) for l in (ph / "echantillons.jsonl").read_text().splitlines()]
    ech = [e for e in ech if "t" in e and e.get("toc") is not None]
    g = (ph / "garde.txt").read_text()
    m = re.search(r"debut \S+ \S+ (\S+)Z mono=([0-9.]+)", g)
    dec = datetime.fromisoformat(m.group(1)).replace(tzinfo=UTC).timestamp() - float(
        m.group(2)
    )
    mesa = sorted(
        int((float(l.split()[0]) - dec) * 1e6)
        for l in (ph / "mesa-mtimes.txt").read_text().splitlines()
        if l.strip()
    )
    t0, fin = im[0], im[-1]
    tr = []
    k = t0
    while k + 10_000_000 <= fin:
        a, b = bisect.bisect_left(im, k), bisect.bisect_left(im, k + 10_000_000)
        gaps = [(im[i + 1] - im[i]) / 1000 for i in range(a, b - 1)]
        perdues = sum(max(0, round(x / 16.667) - 1) for x in gaps)
        tocs = [e["toc"] for e in ech if k / 1e6 <= e["t"] < (k + 10_000_000) / 1e6]
        prog = (tocs[-1] - tocs[0]) // 8 if len(tocs) > 1 else None
        me = bisect.bisect_left(mesa, k + 10_000_000) - bisect.bisect_left(mesa, k)
        tr.append((perdues, max(gaps) if gaps else 0, prog, me))
        k += 10_000_000
    calmes = [
        t
        for i, t in enumerate(tr)
        if i > 0 and t[2] == 0 and t[3] == 0 and tr[i - 1][2] == 0 and tr[i - 1][3] == 0
    ]
    n = len(calmes)
    if not n:
        print(ph.name, "aucune tranche calme")
        continue
    zero = sum(1 for t in calmes if t[0] == 0)
    print(
        f"{ph.name}: {len(tr)} tranches, {n} sans shader neuf : {zero} sans aucune image perdue, "
        f"{sum(t[0] for t in calmes)} images perdues en tout ({sum(t[0] for t in calmes) / (n * 10) * 60:.1f}/min), "
        f"pire écart {max(t[1] for t in calmes):.1f} ms ; écarts > 25 ms dans {sum(1 for t in calmes if t[1] > 25)} tranches"
    )
