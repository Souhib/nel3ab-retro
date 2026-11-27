#!/usr/bin/env python3
"""Échantillonneur du banc de stabilité : lit, toutes les 50 ms, le temps passé
sur processeur et en file d'attente par chaque fil de Ryujinx
(/proc/<pid>/task/<tid>/schedstat, en nanosecondes), la taille du cache de
programmes de Ryubing (shared.toc) et l'occupation du GPU.

Usage : echantillons.py <conteneur> <toc> <sortie.jsonl> <fin_monotonic>
Il attend que le processus Ryujinx du conteneur existe, puis échantillonne
jusqu'à l'heure de fin (horloge monotonic, la même que celle de la capture).
"""

import json
import os
import subprocess
import sys
import time

conteneur, toc, sortie, fin = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
PERIODE = 0.05


def trouver_pid():
    try:
        cid = subprocess.run(
            ["docker", "inspect", "-f", "{{.Id}}", conteneur],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except subprocess.CalledProcessError:
        return None
    for p in os.listdir("/proc"):
        if not p.isdigit():
            continue
        try:
            with open(f"/proc/{p}/comm") as f:
                if f.read().strip() != "Ryujinx":
                    continue
            with open(f"/proc/{p}/cgroup") as f:
                if cid in f.read():
                    return int(p)
        except OSError:
            continue
    return None


def gpu_fichier():
    for c in sorted(os.listdir("/sys/class/drm")):
        chemin = f"/sys/class/drm/{c}/device/gpu_busy_percent"
        if c.startswith("card") and "-" not in c and os.path.exists(chemin):
            return chemin
    return None


pid = None
while pid is None and time.monotonic() < fin:
    pid = trouver_pid()
    if pid is None:
        time.sleep(0.5)
if pid is None:
    sys.exit("aucun processus Ryujinx trouvé")
gpu = gpu_fichier()
noms = {}
with open(sortie, "w") as out:
    out.write(json.dumps({"pid": pid, "periode": PERIODE, "gpu": gpu}) + "\n")
    prochaine = time.monotonic()
    while time.monotonic() < fin:
        t = time.monotonic()
        fils = {}
        try:
            taches = os.listdir(f"/proc/{pid}/task")
        except OSError:
            break
        for tid in taches:
            try:
                with open(f"/proc/{pid}/task/{tid}/schedstat") as f:
                    run, attente, _ = f.read().split()
                fils[tid] = [int(run), int(attente)]
                if tid not in noms:
                    with open(f"/proc/{pid}/task/{tid}/comm") as f:
                        noms[tid] = f.read().strip()
                    out.write(json.dumps({"nom": [tid, noms[tid]]}) + "\n")
            except (OSError, ValueError):
                continue
        try:
            taille = os.stat(toc).st_size
        except OSError:
            taille = None
        occupe = None
        if gpu:
            try:
                with open(gpu) as f:
                    occupe = int(f.read())
            except (OSError, ValueError):
                pass
        out.write(json.dumps({"t": t, "toc": taille, "gpu": occupe, "fils": fils}) + "\n")
        prochaine += PERIODE
        reste = prochaine - time.monotonic()
        if reste > 0:
            time.sleep(reste)
        else:
            prochaine = time.monotonic()
