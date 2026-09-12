# attente.py <pid> <secondes> <sortie.jsonl> : pour chaque fil, le temps où il CALCULE et le temps
# où il ATTEND son tour, toutes les 100 ms, sur l'horloge monotone (ms).
# /proc/<pid>/task/<tid>/schedstat donne : temps d'exécution (ns), temps d'attente en file (ns),
# nombre de tranches. Demande kernel.sched_schedstats=1.
import json, os, re, sys, time

pid, seconds, out = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
propre = lambda nom: re.sub(r"\d+$", "#", nom)


def etat():
    r = {}
    for tid in os.listdir(f"/proc/{pid}/task"):
        try:
            with open(f"/proc/{pid}/task/{tid}/comm") as f:
                nom = propre(f.read().strip())
            with open(f"/proc/{pid}/task/{tid}/schedstat") as f:
                execution, attente, _ = f.read().split()
            with open(f"/proc/{pid}/task/{tid}/stat") as f:
                stat = f.read()
            champs = stat[stat.rfind(")") + 2:].split()
            r[tid] = (nom, int(execution), int(attente), champs[0])
        except (OSError, ValueError, IndexError):
            pass
    return r


fin = time.monotonic() + seconds
avant = etat()
with open(out, "w") as w:
    while time.monotonic() < fin:
        time.sleep(0.1)
        maintenant = etat()
        calcul, attente, bloques = {}, {}, {}
        for tid, (nom, ex, at, etat_fil) in maintenant.items():
            base = avant.get(tid)
            if not base:
                continue
            dex, dat = ex - base[1], at - base[2]
            if dex:
                calcul[nom] = calcul.get(nom, 0) + dex
            if dat:
                attente[nom] = attente.get(nom, 0) + dat
            if etat_fil == "D":
                bloques[nom] = bloques.get(nom, 0) + 1
        w.write(json.dumps({"t": time.monotonic() * 1000, "calcul": calcul, "attente": attente, "D": bloques}) + "\n")
        avant = maintenant
