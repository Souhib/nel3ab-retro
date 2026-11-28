"""Lit les phases d'une campagne du ramasse-miettes : pauses, tas, mémoire.

analyse-gc.py DOSSIER_CAMPAGNE
"""

import json
import statistics
import sys
from pathlib import Path


def quantile(valeurs, q):
    if not valeurs:
        return None
    v = sorted(valeurs)
    return v[min(len(v) - 1, int(q * len(v)))]


def phase(dossier: Path) -> dict:
    lignes = [json.loads(l) for l in (dossier / "gc.jsonl").read_text().splitlines() if l.strip()]
    connexion = next((l for l in lignes if l["evt"] == "connexion"), None)
    env = {k: v for k, v in (connexion or {}).get("env", {}).items() if "GC" in k or "gc" in k}
    tas = sorted({l["tas"] for l in lignes if l["evt"] == "histoire"})
    # Chaque pause est rattachée au dernier début de nettoyage lu avant sa reprise.
    courant = None
    pauses = []
    dernier_tas = None
    for l in lignes:
        if l["evt"] == "debut":
            courant = l
        elif l["evt"] == "tas":
            dernier_tas = l
            if pauses and pauses[-1]["n"] == (courant or {}).get("n"):
                pauses[-1].setdefault("tas_apres", l)
        elif l["evt"] == "reprise" and l.get("pause_ms") is not None:
            pauses.append(
                {
                    "ms": l["pause_ms"],
                    "t": l["t"],
                    "n": (courant or {}).get("n"),
                    "gen": (courant or {}).get("gen"),
                    "type": (courant or {}).get("type"),
                    "raison": (courant or {}).get("raison"),
                }
            )
    induites = [p for p in pauses if p["raison"] == "Induced"]
    naturelles = [p for p in pauses if p["raison"] != "Induced"]
    bloquantes2 = [p for p in naturelles if p["gen"] == 2 and p["type"] == "NonConcurrentGC"]
    debuts = [l for l in lignes if l["evt"] == "debut"]
    memoire = []
    f = dossier / "memoire.txt"
    if f.exists():
        for l in f.read_text().splitlines():
            p = l.split()
            if len(p) == 2 and p[1].isdigit():
                memoire.append(int(p[1]) / 1e9)
    return {
        "env": env,
        "tas": tas,
        "nettoyages": len(debuts),
        "background": sum(1 for d in debuts if d["type"] == "BackgroundGC"),
        "pauses": len(pauses),
        "naturelles_p50": quantile([p["ms"] for p in naturelles], 0.5),
        "naturelles_p99": quantile([p["ms"] for p in naturelles], 0.99),
        "naturelles_max": max((p["ms"] for p in naturelles), default=None),
        "naturelles_total_ms": round(sum(p["ms"] for p in naturelles), 1),
        "bloquantes_gen2": [round(p["ms"], 1) for p in bloquantes2],
        "induites": [round(p["ms"], 1) for p in induites],
        "induites_mediane": statistics.median([p["ms"] for p in induites]) if induites else None,
        "gen2_mo_fin": round(dernier_tas["gen2_mo"], 1) if dernier_tas else None,
        "loh_mo_fin": round(dernier_tas["loh_mo"], 1) if dernier_tas else None,
        "memoire_go_max": round(max(memoire), 2) if memoire else None,
        "memoire_go_fin": round(memoire[-1], 2) if memoire else None,
    }


racine = Path(sys.argv[1])
for d in sorted(p for p in racine.iterdir() if (p / "gc.jsonl").exists()):
    r = phase(d)
    print(f"== {d.name}  env {r['env']}  tas {r['tas']}")
    print(
        f"   nettoyages {r['nettoyages']} (dont {r['background']} en arrière-plan), pauses {r['pauses']}"
        f"   naturelles p50 {r['naturelles_p50']} p99 {r['naturelles_p99']} max {r['naturelles_max']}"
        f" total {r['naturelles_total_ms']} ms"
    )
    print(f"   bloquantes gen2 naturelles {r['bloquantes_gen2']}")
    print(f"   provoquées {r['induites']}  médiane {r['induites_mediane']}")
    print(
        f"   tas à la fin : gen2 {r['gen2_mo_fin']} Mo, gros objets {r['loh_mo_fin']} Mo;"
        f" conteneur max {r['memoire_go_max']} Go, fin {r['memoire_go_fin']} Go"
    )
