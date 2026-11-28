"""Pour chaque nettoyage : arrêt des fils (suspend → début), travail (début → fin), reprise (fin → reprise)."""
import json, sys
from datetime import datetime
def t(s): return datetime.fromisoformat(s.replace("Z", "")[:26])
for f in sys.argv[1:]:
    L = [json.loads(l) for l in open(f) if l.strip()]
    rows = []; sus = deb = fin = None
    for l in L:
        e = l["evt"]
        if e == "suspend" and l["raison"] == "SuspendForGC": sus = l; deb = fin = None
        elif e == "debut": deb = l
        elif e == "fin": fin = l
        elif e == "reprise" and sus and deb and fin:
            rows.append((deb["raison"], deb["gen"], deb["type"],
                         (t(deb["t"]) - t(sus["t"])).total_seconds() * 1e3,
                         (t(fin["t"]) - t(deb["t"])).total_seconds() * 1e3,
                         (t(l["t"]) - t(fin["t"])).total_seconds() * 1e3, l["pause_ms"]))
            sus = None
    print("==", f.split("/")[-2])
    for r in rows:
        if r[0] == "Induced" or r[6] > 100:
            print(f"  {r[0]:10} g{r[1]} {r[2]:15} arrêt des fils {r[3]:7.1f}  travail {r[4]:7.1f}  reprise {r[5]:6.1f}  pause {r[6]:7.1f}")
