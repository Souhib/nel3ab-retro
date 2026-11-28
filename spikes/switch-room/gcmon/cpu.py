"""Temps processeur total de l'émulateur entre 60 s et la fin, et celui des fils du GC."""
import json, sys
for d in sys.argv[1:]:
    noms = {}; ech = []
    for l in open(d + "/echantillons.jsonl"):
        j = json.loads(l)
        if "nom" in j: noms[j["nom"][0]] = j["nom"][1]
        elif "fils" in j: ech.append(j)
    t0 = ech[0]["t"]
    deb = next(e for e in ech if e["t"] - t0 >= 60); fin = ech[-1]
    def cpu(e, filtre=lambda n: True):
        return sum(v[0] for k, v in e["fils"].items() if filtre(noms.get(k, "")))
    duree = fin["t"] - deb["t"]
    tot = (cpu(fin) - cpu(deb)) / 1e9 / duree * 100
    gc = (cpu(fin, lambda n: "GC" in n) - cpu(deb, lambda n: "GC" in n)) / 1e9 / duree * 100
    print(f"{d.split('smash-gel/')[1]:12} {duree:5.0f} s  émulateur {tot:6.1f} % d'un cœur, dont fils du GC {gc:4.1f} %")
