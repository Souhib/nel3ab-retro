# analyse-gels.py <enregistrement.jsonl> [seuil ms] : chaque trou d'images, et ce qui s'est passé autour.
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
limit = float(sys.argv[2]) if len(sys.argv) > 2 else 50
f = [r for r in rows if "f" in r]; c = [r for r in rows if "c" in r]; l = [r for r in rows if "l" in r]
start = rows[0]["start"]
gaps = [(a["pts"], b["pts"] - a["pts"], b["f"] - a["f"]) for a, b in zip(f, f[1:])]
big = [g for g in gaps if g[1] > limit]
dur = (f[-1]["pts"] - f[0]["pts"]) / 1000
print(f"{len(f)} images sur {dur:.1f} s ({len(f)/dur:.1f} i/s); trous > {limit:.0f} ms : {len(big)}, total {sum(g[1] for g in big):.0f} ms")
prev_sizes = None; growth = []
for r in c:
    total = sum(int(x.split(":")[1]) for x in r["s"].split())
    if prev_sizes is not None and total > prev_sizes: growth.append((r["c"], total - prev_sizes))
    prev_sizes = total
print(f"croissances du cache de shaders : {len(growth)}, {sum(g[1] for g in growth)/1e6:.1f} Mo")
near_total = 0
for at, gap, arr in big:
    end = at + gap
    near = [g for g in growth if at - 100 <= g[0] <= end + 400]
    near_total += bool(near)
    logs = [r["x"][13:120] for r in l if at - 300 <= r["l"] <= end + 300 and "Ptc Save" not in r["x"]]
    ptc = any("Ptc Save" in r["x"] and at - 300 <= r["l"] <= end + 300 for r in l)
    print(f"  t={(at-start)/1000:7.2f} s  trou {gap:6.1f} ms (arrivée {arr:6.1f})  cache+{sum(g[1] for g in near)/1e3:.0f} Ko{'  PTC-save' if ptc else ''}  {logs[:2]}")
print(f"trous avec compilation de shader à côté : {near_total}/{len(big)}")
