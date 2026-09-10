#!/usr/bin/env python3
"""Recolle les étapes d'un appui, de l'envoi à l'arrivée de l'image changée.

Quatre sources, une seule horloge (monotone) :
  - le vidage du pilote (`REACTION_DUMP`) : envoi, composition et arrivée ;
  - le lecteur du noyau (`horloge-manette.py`) : l'événement uinput ;
  - le journal du moteur construit avec `amont/ryubing-latency-probe.patch` :
    NEL3AB_HID (l'état du joueur 1 change dans la mémoire que le jeu lit) et
    NEL3AB_PRESENT (une image remise au compositeur).

Étapes, pour chaque appui :
  entrée      envoi -> événement noyau : prise, worker, traduction, uinput
  lecture     noyau -> mémoire HID : la boucle d'entrée de l'émulateur
  jeu         mémoire HID -> dernière image remise avant la composition
              changée : le jeu, l'émulation et le rendu
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
for line in open(sys.argv[3], errors="replace"):
    if m := re.search(r"NEL3AB_HID t_ns=(\d+) f=(\d+) buttons=([0-9a-f]+)", line):
        frequency.add(int(m[2]))
        if int(m[3], 16) != 0:
            hid.append(int(m[1]) / 1e6)
    elif m := re.search(r"NEL3AB_PRESENT t_ns=(\d+)", line):
        present.append(int(m[1]) / 1e6)
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
    rows.append({"entrée": k - sent, "lecture": h - k, "jeu": p - h, "compositeur": composed - p,
                 "transit": arrived - composed, "total": arrived - sent})
good = [r for r in rows if "total" in r]
print(json.dumps({"appuis": len(dump["presses"]), "recollés": len(good), "incohérents": len(rows) - len(good)}))
for name in ("entrée", "lecture", "jeu", "compositeur", "transit", "total"):
    values = sorted(r[name] for r in good)
    if values:
        print(f"{name:12} médiane {statistics.median(values):7.1f} ms   de {values[0]:6.1f} à {values[-1]:6.1f}")
for r in rows:
    if "total" not in r:
        print("incohérent :", r)
print("transit, toutes images :", dump["transit"])
