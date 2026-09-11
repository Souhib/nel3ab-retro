# fils.py <pid> <secondes> <sortie.jsonl> : temps processeur de chaque fil, toutes les 100 ms, horloge monotone (ms).
import json, os, sys, time
pid, seconds, out = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
def read():
    r = {}
    for tid in os.listdir(f"/proc/{pid}/task"):
        try:
            stat = open(f"/proc/{pid}/task/{tid}/stat").read()
            comm = stat[stat.index("(") + 1:stat.rindex(")")]; f = stat[stat.rindex(")") + 2:].split()
            r[tid] = (comm, int(f[11]) + int(f[12]))
        except (FileNotFoundError, ProcessLookupError): pass
    return r
end = time.monotonic() + seconds; prev = read()
with open(out, "w") as w:
    while time.monotonic() < end:
        time.sleep(0.1); cur = read(); d = {}
        for tid, (comm, ticks) in cur.items():
            delta = ticks - prev.get(tid, (comm, ticks))[1]
            if delta: d[comm] = d.get(comm, 0) + delta
        w.write(json.dumps({"t": time.monotonic() * 1000, "d": d}) + "\n"); prev = cur
