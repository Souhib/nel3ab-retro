# partition.py <gels.jsonl> <moteur.log> : pour chaque trou d'image, dire quelle étape a disparu.
# Les marqueurs portent t_ns = Stopwatch.GetTimestamp() (CLOCK_MONOTONIC, 1 GHz sous Linux),
# les images portent pts en ms sur la même horloge : comparables directement.
import json, re, sys, statistics

gels = [json.loads(l) for l in open(sys.argv[1]) if l.strip().startswith("{")]
f = [r for r in gels if "f" in r]
t0, t1 = f[0]["pts"], f[-1]["pts"]
marqueurs = {}
skips = []
deq = []
for ligne in open(sys.argv[2], errors="ignore"):
    m = re.search(r"NEL3AB_(\w+) t_ns=(\d+)(.*)", ligne)
    if not m:
        continue
    genre, t, reste = m.group(1), int(m.group(2)) / 1e6, m.group(3)
    marqueurs.setdefault(genre, []).append(t)
    if genre == "SKIP":
        s = re.search(r"status=(\w+) queued=(\d+)", reste)
        if s: skips.append((t, s.group(1), int(s.group(2))))
    if genre == "DEQWAIT":
        p = re.search(r"phase=(\w+)", reste)
        if p: deq.append((t, p.group(1)))

fenetre = lambda liste, a, b: sum(1 for t in liste if a <= t <= b)
present = marqueurs.get("PRESENT", [])
queue = marqueurs.get("QUEUE", [])
dans = [t for t in present if t0 <= t <= t1]
print(f"fenêtre commune : {(t1-t0)/1000:.1f} s")
print(f"images livrées par la chaîne : {len(f)}   |   NEL3AB_PRESENT du moteur : {len(dans)}")
if dans:
    proches = [min((p for p in present if p <= r["pts"]), key=lambda p: r["pts"] - p, default=None) for r in f[:2000]]
    ecarts = [r["pts"] - p for r, p in zip(f[:2000], proches) if p and 0 <= r["pts"] - p < 200]
    print(f"décalage image affichée moins PRESENT : médiane {statistics.median(ecarts):.1f} ms sur {len(ecarts)} images")
gaps = [(a["pts"], b["pts"]) for a, b in zip(f, f[1:]) if b["pts"] - a["pts"] > 50]
tard = [(a, b) for a, b in gaps if a - t0 > 6000]
print(f"\n{len(gaps)} trous, dont {len(tard)} après la 6e seconde\n")
compte = {"jeu n'a pas produit": 0, "perdu dans le moteur": 0, "perdu par notre capture": 0}
for a, b in gaps:
    k = round((b - a) / 16.67) - 1
    q, p = fenetre(queue, a + 8, b - 8), fenetre(present, a + 8, b - 8)
    sk = [s for s in skips if a <= s[0] <= b]
    dw = [d for d in deq if a <= d[0] <= b]
    if k <= 0: continue
    if p >= k: cause = "perdu par notre capture"
    elif q >= k: cause = "perdu dans le moteur"
    else: cause = "jeu n'a pas produit"
    compte[cause] += 1
    etat = {}
    for _, st, qd in sk: etat[f"{st}(q={qd})"] = etat.get(f"{st}(q={qd})", 0) + 1
    quand = "début " if a - t0 <= 6000 else "tardif"
    print(f"{quand} {(a-t0)/1000:6.1f} s {round(b-a):4d} ms  manque {k:2d} images | QUEUE {q:2d} PRESENT {p:2d} | {cause}"
          + (f" | SKIP {etat}" if etat else "") + (f" | DEQWAIT {len(dw)}" if dw else ""))
print("\nrésumé :", compte)
if skips:
    par_statut = {}
    for t, st, qd in skips:
        if t0 <= t <= t1: par_statut[st] = par_statut.get(st, 0) + 1
    print("SKIP par statut sur la fenêtre :", par_statut)
