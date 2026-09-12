# systeme.py <pid> <secondes> <sortie.jsonl> : ce que fait la machine autour de l'émulateur,
# toutes les 100 ms, sur l'horloge monotone (ms) : lectures disque du processus, défauts de page,
# pression du noyau, occupation du GPU et sa fréquence.
import json, os, sys, time, glob

pid, seconds, out = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
card = next((p for p in glob.glob("/sys/class/drm/card*/device/gpu_busy_percent")), None)
freq = card and os.path.join(os.path.dirname(card), "pp_dpm_sclk")


def lire(chemin, defaut=""):
    try:
        with open(chemin) as f:
            return f.read()
    except OSError:
        return defaut


def etat():
    io = {}
    for ligne in lire(f"/proc/{pid}/io").splitlines():
        nom, _, valeur = ligne.partition(": ")
        if nom in ("rchar", "read_bytes", "syscr"):
            io[nom] = int(valeur)
    stat = lire(f"/proc/{pid}/stat")
    champs = stat[stat.rfind(")") + 2:].split() if stat else []
    if champs:
        io["minflt"], io["majflt"] = int(champs[7]), int(champs[9])
    pression = {}
    for genre in ("cpu", "io", "memory"):
        for ligne in lire(f"/proc/pressure/{genre}").splitlines():
            if ligne.startswith("some"):
                pression[genre] = float(ligne.split("total=")[1])
    gpu = int(lire(card, "-1").strip() or -1) if card else -1
    sclk = ""
    for ligne in lire(freq or "", "").splitlines():
        if ligne.endswith("*"):
            sclk = ligne.split()[1]
    return io, pression, gpu, sclk


fin = time.monotonic() + seconds
io0, p0, _, _ = etat()
with open(out, "w") as w:
    while time.monotonic() < fin:
        time.sleep(0.1)
        io, p, gpu, sclk = etat()
        w.write(json.dumps({
            "t": time.monotonic() * 1000,
            "io": {k: io[k] - io0.get(k, 0) for k in io},
            "psi": {k: round(p[k] - p0.get(k, 0), 1) for k in p},
            "gpu": gpu,
            "sclk": sclk,
        }) + "\n")
        io0, p0 = io, p
