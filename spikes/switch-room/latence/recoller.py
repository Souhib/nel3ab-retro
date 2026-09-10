#!/usr/bin/env python3
"""Recolle les étapes d'un appui, de l'envoi à l'arrivée de l'image changée.

Quatre sources, une seule horloge (monotone) :
  - le vidage du pilote (`REACTION_DUMP`) : envoi, composition et arrivée ;
  - le lecteur du noyau (`horloge-manette.py`) : l'événement uinput ;
  - le journal du moteur construit avec `amont/ryubing-latency-probe.patch` :
    NEL3AB_HID (l'état du joueur 1 change dans la mémoire que le jeu lit),
    NEL3AB_QUEUE (le jeu remet son image N), NEL3AB_ACQUIRE (le compositeur
    émulé prend l'image N), NEL3AB_RENDER et NEL3AB_READY (le fil GPU commence
    à présenter l'image N, puis la barrière du jeu est levée) et NEL3AB_PRESENT
    (une image remise au compositeur de la machine).

Étapes, pour chaque appui :
  entrée      envoi -> événement noyau : prise, worker, traduction, uinput
  lecture     noyau -> mémoire HID : la boucle d'entrée de l'émulateur
  jeu         mémoire HID -> dernière image remise avant la composition
              changée : le jeu, l'émulation et le rendu, découpé en
    programme   mémoire HID -> image N remise par le jeu : attendre son
                prochain tour de boucle, lire la manette, dessiner
    vsync       image N remise -> prise par le compositeur émulé
    passage     prise -> le fil GPU commence à la présenter
    barrière    le fil GPU attend que le jeu ait fini de la dessiner
    rendu       barrière levée -> image remise au compositeur de la machine
  L'image N est celle que le fil GPU présentait juste avant la présentation
  retenue. Si le fil GPU met plus d'une période entre les deux, l'appariement
  devient ambigu : le script le signale au lieu de recoller.
  compositeur image remise -> composition (Sway)
  transit     composition -> arrivée : capture, encodage, relais, worker, prise

    python3 recoller.py vidage.json boutons.jsonl moteur.log
"""
import json
import re
import statistics
import sys

dump = json.load(open(sys.argv[1]))
kernel = [json.loads(line) for line in open(sys.argv[2]) if line.strip()]
downs = sorted(e["t_us"] / 1000 for e in kernel if e["value"] == 1)
hid, present, frequency = [], [], set()
frames = {"QUEUE": {}, "ACQUIRE": {}, "READY": {}}
renders = []
for line in open(sys.argv[3], errors="replace"):
    if m := re.search(r"NEL3AB_HID t_ns=(\d+) f=(\d+) buttons=([0-9a-f]+)", line):
        frequency.add(int(m[2]))
        if int(m[3], 16) != 0:
            hid.append(int(m[1]) / 1e6)
    elif m := re.search(r"NEL3AB_PRESENT t_ns=(\d+)", line):
        present.append(int(m[1]) / 1e6)
    elif m := re.search(r"NEL3AB_(QUEUE|ACQUIRE|READY) t_ns=(\d+) frame=(\d+)", line):
        frames[m[1]].setdefault(int(m[3]), int(m[2]) / 1e6)
    elif m := re.search(r"NEL3AB_RENDER t_ns=(\d+) frame=(\d+)", line):
        renders.append((int(m[1]) / 1e6, int(m[2])))
if frequency != {1_000_000_000}:
    sys.exit(f"Stopwatch n'est pas en nanosecondes ici ({frequency}) : les heures ne se comparent pas")
present.sort()
rows = []
for press in dump["presses"]:
    sent, composed, arrived = press["sent"], press["composed"], press["arrived"]
    if composed is None:
        continue
    k = next((t for t in downs if t >= sent), None)
    h = next((t for t in hid if k is not None and t >= k), None)
    p = max((t for t in present if t <= composed), default=None)
    if None in (k, h, p) or not (sent <= k <= h <= p <= composed <= arrived):
        rows.append({"sent": sent, "incohérent": [k, h, p, composed, arrived]})
        continue
    row = {"entrée": k - sent, "lecture": h - k, "jeu": p - h, "compositeur": composed - p,
           "transit": arrived - composed, "total": arrived - sent}
    if renders:
        r = max((x for x in renders if x[0] <= p), default=None)
        n = r[1] if r else None
        q, a, ready = (frames[kind].get(n) for kind in ("QUEUE", "ACQUIRE", "READY"))
        if r is None or None in (q, a, ready) or p - r[0] > 16.7 or not (q <= a <= r[0] <= ready <= p):
            row["découpe"] = f"ambiguë (image {n})"
        else:
            row.update({"programme": q - h, "vsync": a - q, "passage": r[0] - a, "barrière": ready - r[0], "rendu": p - ready})
    rows.append(row)
good = [r for r in rows if "total" in r]
print(json.dumps({"appuis": len(dump["presses"]), "recollés": len(good), "incohérents": len(rows) - len(good)}))
for name in ("entrée", "lecture", "jeu", "programme", "vsync", "passage", "barrière", "rendu", "compositeur", "transit", "total"):
    values = sorted(r[name] for r in good if name in r)
    if values:
        print(f"{name:12} médiane {statistics.median(values):7.1f} ms   de {values[0]:6.1f} à {values[-1]:6.1f}")
for r in rows:
    if "total" not in r:
        print("incohérent :", r)
    elif "découpe" in r:
        print("découpe", r["découpe"])
print("transit, toutes images :", dump["transit"])
# Toutes les images, pas seulement les appuis : combien de temps une image
# remise attend sa prise, et combien d'autres attendent déjà quand elle arrive.
# Le 10 septembre, 24,1 ms et presque toujours une autre : une image d'avance.
waits = sorted(frames["ACQUIRE"][n] - frames["QUEUE"][n] for n in frames["QUEUE"] if n in frames["ACQUIRE"])
if waits:
    events = sorted([(t, 1) for t in frames["QUEUE"].values()] + [(t, -1) for t in frames["ACQUIRE"].values()])
    depth, seen = 0, []
    for _, step in events:
        depth += step
        if step == 1:
            seen.append(depth)
    pick = lambda xs, f: xs[min(len(xs) - 1, round((len(xs) - 1) * f))]
    print(f"toutes images : attente avant la prise médiane {statistics.median(waits):.1f} ms, p95 {pick(waits, .95):.1f} ; "
          f"file à chaque remise {dict(sorted((k, seen.count(k)) for k in set(seen)))}")
