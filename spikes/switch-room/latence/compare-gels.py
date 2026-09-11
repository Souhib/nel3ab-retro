# compare-gels.py <enregistrements...> : les 60 premières secondes de combat de chaque passage.
import json, sys
for path in sys.argv[1:]:
    rows = []
    for l in open(path):
        try: rows.append(json.loads(l))
        except ValueError: pass
    f = [r for r in rows if "f" in r]; s = f[0]["pts"]
    first = [r for r in f if r["pts"] - s <= 60000]
    gaps = [b["pts"] - a["pts"] for a, b in zip(first, first[1:])]; big = [g for g in gaps if g > 50]
    growth = sum(1 for r in rows if "c" in r) - 1
    print(f"{path.split('/')[-1]:22s} {len(first)/60:5.1f} i/s  {len(big):3d} trous > 50 ms  {sum(big):5.0f} ms perdus  pire {max(gaps):4.0f} ms  cache modifié {growth} fois")
    print("   ", [(round((a["pts"] - s) / 1000, 1), round(b["pts"] - a["pts"])) for a, b in zip(first, first[1:]) if b["pts"] - a["pts"] > 50])
