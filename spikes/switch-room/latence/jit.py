# jit.py <gels.jsonl> <moteur.log> : combien de chaque trou d'image est passé à traduire du code.
# NEL3AB_JIT ne sort que pour une traduction de plus d'une milliseconde, faite sur le fil du jeu.
import json, re, statistics, sys

gels = [json.loads(l) for l in open(sys.argv[1]) if l.strip().startswith("{")]
f = [r for r in gels if "f" in r]
t0, t1 = f[0]["pts"], f[-1]["pts"]
jit, queue = [], []
for ligne in open(sys.argv[2], errors="ignore"):
    m = re.search(r"NEL3AB_JIT t_ns=(\d+) us=(\d+)", ligne)
    if m:
        jit.append((int(m.group(1)) / 1e6, int(m.group(2)) / 1000))  # fin (ms), durée (ms)
        continue
    m = re.search(r"NEL3AB_QUEUE t_ns=(\d+)", ligne)
    if m:
        queue.append(int(m.group(1)) / 1e6)

fen = [(t, d) for t, d in jit if t0 <= t <= t1]
print(f"fenêtre {(t1 - t0) / 1000:.0f} s | traductions de plus de 1 ms : {len(fen)}"
      + (f", total {sum(d for _, d in fen):.0f} ms, la plus longue {max(d for _, d in fen):.0f} ms" if fen else ""))
gaps = [(a["pts"], b["pts"]) for a, b in zip(f, f[1:]) if b["pts"] - a["pts"] > 50]
tard = [(a, b) for a, b in gaps if a - t0 > 6000]

def dans(a, b, decalage=0):
    return [(t, d) for t, d in fen if a + decalage - d <= t <= b + decalage]

explique, total_trou, total_jit = 0, 0, 0
for a, b in tard:
    ici = dans(a, b)
    part = sum(d for _, d in ici)
    total_trou += b - a
    total_jit += min(part, b - a)
    if part > (b - a) * 0.5:
        explique += 1
    print(f"   {(a - t0) / 1000:6.1f} s {round(b - a):4d} ms | traduction {part:6.1f} ms en {len(ici)} fois"
          + (f" | la plus longue {max(d for _, d in ici):.0f} ms" if ici else ""))
if tard:
    print(f"\n{explique}/{len(tard)} trous tardifs sont à plus de moitié de la traduction ;"
          f" {total_jit:.0f} ms de traduction sur {total_trou:.0f} ms de trous")
    for dec in (1000, -1000, 3000):
        temoin = sum(sum(d for _, d in dans(a, b, dec)) for a, b in tard)
        print(f"   témoin décalé de {dec:+5d} ms : {temoin:6.0f} ms de traduction dans les mêmes fenêtres")
