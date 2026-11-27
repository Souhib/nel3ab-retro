import re
import sys
from collections import defaultdict

for ph in sys.argv[1:]:
    n = defaultdict(int)
    ms = defaultdict(float)
    mx = defaultdict(float)
    for l in open(ph + "/emulator.log", errors="replace"):
        if "NEL3AB_SHADERS" not in l:
            continue
        for k, c, t, m in re.findall(r"(\w+)=(\d+)/([0-9.]+)/([0-9.]+)", l):
            n[k] += int(c)
            ms[k] += float(t)
            mx[k] = max(mx[k], float(m))
    print(
        ph.rstrip("/").split("/")[-1],
        "  ".join(
            f"{k} {n[k]}×{ms[k] / n[k]:.2f}={ms[k]:.0f}ms(max {mx[k]:.0f})"
            for k in ["TranslateGraphics", "PipelineBackground", "WaitProgram", "PipelineDraw"]
            if n[k]
        ),
    )
