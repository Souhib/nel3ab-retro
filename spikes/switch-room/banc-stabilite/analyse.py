#!/usr/bin/env python3
"""Analyse d'une phase du banc de stabilité.

analyse.py PHASE [--depuis S] [--jusqu S] [--detail N] [--json]

- Images : full-trace.txt, une heure de compositeur (µs, CLOCK_MONOTONIC) par image.
- Un accroc est un écart de plus de 1,5 période du jeu, la période étant la
  médiane des écarts de la seconde glissante de 10 s qui le contient
  (16,7 ms pour un jeu à 60 images/s, 33,3 à 30).
- Images perdues : pour chaque écart, round(écart / période) - 1.
- Attribution : pour chaque accroc, le temps processeur de chaque fil de
  Ryujinx pendant l'écart (schedstat, échantillons de 50 ms, interpolés), la
  croissance de shared.toc (8 octets par programme) et les entrées Mesa dont
  l'heure de fichier tombe dans l'écart (heure murale ramenée à monotonic par
  les lignes de garde).
"""

import argparse
import bisect
import json
import re
import statistics
from collections import defaultdict
from datetime import UTC
from pathlib import Path

#: Les cadences d'une console : 60, 30 et 20 images par seconde.
CADENCES_MS = (16.667, 33.333, 50.0)


def cadence(periode_ms):
    """La cadence de console la plus proche d'une période mesurée."""
    return min(CADENCES_MS, key=lambda c: abs(c - periode_ms))


def pertes(im):
    """Accrocs et images perdues d'une suite d'heures d'images (µs, croissantes).

    La période du jeu est la médiane des écarts des 10 s autour de chaque
    écart, ramenée à la cadence de console la plus proche, et recalculée toutes
    les 2 s. Un écart de plus de 1,5 période est un accroc ; il perd
    round(écart / période) - 1 images.
    """
    if len(im) < 2:
        return [], 0
    t0 = im[0]

    def periode_autour(i):
        t = im[i]
        j0 = bisect.bisect_left(im, t - 5_000_000)
        j1 = bisect.bisect_right(im, t + 5_000_000)
        ecarts = [im[k + 1] - im[k] for k in range(max(j0, 0), min(j1, len(im)) - 1)]
        return statistics.median(ecarts) / 1000 if ecarts else CADENCES_MS[0]

    par_tranche = {}
    accrocs = []
    perdues = 0
    for i in range(len(im) - 1):
        t, g = im[i], (im[i + 1] - im[i]) / 1000
        cle = (t - t0) // 2_000_000
        if cle not in par_tranche:
            par_tranche[cle] = cadence(periode_autour(i))
        p = par_tranche[cle]
        n = max(0, round(g / p) - 1)
        perdues += n
        if g > 1.5 * p:
            accrocs.append({"t": t, "fin": t + int(g * 1000), "ms": g, "periode": p, "perdues": n})
    return accrocs, perdues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("phase")
    ap.add_argument("--depuis", type=float, default=None, help="secondes après la première image")
    ap.add_argument("--jusqu", type=float, default=None)
    ap.add_argument("--detail", type=int, default=12)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    P = Path(a.phase)

    images = [int(l) for l in (P / "full-trace.txt").read_text().split()]
    # La première image est la copie de la sortie vide de Sway que wlroots donne à
    # tout nouvel enregistreur (CLAUDE.md, 2026-11-26) : le jeu commence après.
    images = images[1:]
    t0 = images[0]
    lo = t0 + int((a.depuis or 0) * 1e6)
    hi = t0 + int(a.jusqu * 1e6) if a.jusqu is not None else images[-1]
    im = [x for x in images if lo <= x <= hi]

    accrocs, perdues = pertes(im)
    ecarts = [(im[i], (im[i + 1] - im[i]) / 1000) for i in range(len(im) - 1)]
    duree = (im[-1] - im[0]) / 1e6
    # Échantillons.
    noms, ech = {}, []
    ef = P / "echantillons.jsonl"
    if ef.exists():
        for l in ef.read_text().splitlines():
            d = json.loads(l)
            if "nom" in d:
                noms[d["nom"][0]] = d["nom"][1]
            elif "t" in d:
                ech.append(d)
    temps_ech = [int(e["t"] * 1e6) for e in ech]

    def groupe(nom):
        nom = re.sub(r"\d+$", "", nom)
        return nom

    def cpu_entre(debut, fin):
        """ms de processeur et d'attente par groupe de fils entre deux heures (µs)."""
        if not ech:
            return {}, {}
        i0 = max(0, bisect.bisect_right(temps_ech, debut) - 1)
        i1 = min(len(ech) - 1, bisect.bisect_left(temps_ech, fin))
        if i1 <= i0:
            return {}, {}
        a_, b_ = ech[i0]["fils"], ech[i1]["fils"]
        # Le même intervalle d'échantillons couvre plus que l'écart : on rapporte
        # à la durée de l'intervalle réellement couvert.
        run, att = defaultdict(float), defaultdict(float)
        for tid, (r1, w1) in b_.items():
            r0, w0 = a_.get(tid, [r1, w1])
            g = groupe(noms.get(tid, tid))
            run[g] += (r1 - r0) / 1e6
            att[g] += (w1 - w0) / 1e6
        return dict(run), dict(att)

    def toc_entre(debut, fin):
        if not ech:
            return None
        i0 = max(0, bisect.bisect_right(temps_ech, debut) - 1)
        i1 = min(len(ech) - 1, bisect.bisect_left(temps_ech, fin))
        x0, x1 = ech[i0].get("toc"), ech[i1].get("toc")
        if x0 is None or x1 is None:
            return None
        return (x1 - x0) // 8

    # Mesa : heure murale -> monotonic.
    decalage = None
    g = (P / "garde.txt").read_text()
    m = re.search(r"debut \S+ \S+ (\S+)Z mono=([0-9.]+)", g)
    if m:
        from datetime import datetime

        mur = datetime.fromisoformat(m.group(1)).replace(tzinfo=UTC).timestamp()
        decalage = mur - float(m.group(2))
    mesa = []
    mf = P / "mesa-mtimes.txt"
    if mf.exists() and decalage is not None:
        for l in mf.read_text().split("\n"):
            if l.strip():
                s, _ = l.split()
                mesa.append(int((float(s) - decalage) * 1e6))
    mesa.sort()

    def mesa_entre(debut, fin, marge=50_000):
        return bisect.bisect_right(mesa, fin + marge) - bisect.bisect_left(mesa, debut - marge)

    for x in accrocs:
        x["cpu"], x["attente"] = cpu_entre(x["t"], x["fin"])
        x["programmes"] = toc_entre(x["t"], x["fin"])
        x["mesa"] = mesa_entre(x["t"], x["fin"])
        if x["programmes"]:
            x["cause"] = "programme"
        elif x["mesa"]:
            x["cause"] = "pipeline"
        else:
            x["cause"] = "autre"

    def resume():
        seuils = (25, 50, 100, 250)
        r = {
            "duree_s": round(duree, 1),
            "images": len(im),
            "img_s": round((len(im) - 1) / duree, 2) if duree else None,
            "perdues": perdues,
            "perdues_min": round(perdues / duree * 60, 1) if duree else None,
            "accrocs": len(accrocs),
            "par_seuil": {s: sum(1 for x in accrocs if x["ms"] > s) for s in seuils},
            "pire_ms": round(max((x["ms"] for x in accrocs), default=0), 1),
            "p99_ms": round(sorted(g for _, g in ecarts)[int(0.99 * (len(ecarts) - 1))], 1),
            "par_cause": {},
            "programmes_total": None,
            "mesa_total": len([m for m in mesa if lo <= m <= hi]),
        }
        for c in ("programme", "pipeline", "autre"):
            xs = [x for x in accrocs if x["cause"] == c]
            r["par_cause"][c] = {
                "n": len(xs),
                "perdues": sum(x["perdues"] for x in xs),
                "pire": round(max((x["ms"] for x in xs), default=0), 1),
            }
        if ech:
            tocs = [
                e["toc"] for e in ech if e.get("toc") is not None and lo <= int(e["t"] * 1e6) <= hi
            ]
            if tocs:
                r["programmes_total"] = (tocs[-1] - tocs[0]) // 8
        return r

    r = resume()
    if a.json:
        print(json.dumps({"resume": r, "accrocs": accrocs}, default=str))
    else:
        print(json.dumps(r, ensure_ascii=False))
        print(
            f"{'t (s)':>7} {'ms':>7} {'cause':>9} {'prog':>4} {'mesa':>4}  fils les plus occupés (ms cpu / ms attente)"
        )
        for x in sorted(accrocs, key=lambda x: -x["ms"])[: a.detail]:
            top = sorted(x["cpu"].items(), key=lambda kv: -kv[1])[:5]
            fils = ", ".join(f"{k} {v:.0f}/{x['attente'].get(k, 0):.0f}" for k, v in top)
            print(
                f"{(x['t'] - t0) / 1e6:7.1f} {x['ms']:7.1f} {x['cause']:>9} {x['programmes'] if x['programmes'] is not None else '-':>4} {x['mesa']:>4}  {fils}"
            )


if __name__ == "__main__":
    main()
