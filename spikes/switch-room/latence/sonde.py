# Lance le programme de test dans une sonde, jamais dans la salle :
#   NEL3AB_SWITCH_CONFIG_BASE=~/.config/nel3ab/switch.json python3 sonde.py <nom> <moteur>
# Le moteur est un dossier qui contient publish/Ryujinx, construit avec
# ../amont/ryubing-latency-probe.patch pour avoir les marqueurs. Conteneurs,
# manettes et sauvegarde sont privés à <nom>. Tant que keep-running-guest-<nom>
# existe dans NEL3AB_SONDE, le programme tourne ; l'effacer l'arrête proprement.
import json, os, pathlib, shutil, subprocess, sys, time

root = pathlib.Path(os.environ.get("NEL3AB_SONDE", "/tmp/nel3ab-sonde")); root.mkdir(exist_ok=True)
repo = pathlib.Path(__file__).resolve().parents[3]
name, engine = sys.argv[1], sys.argv[2]
title = "0100000000000e1b"
pads = root / f"room-guest-{name}"; pads.mkdir(exist_ok=True)
game = root / f"guest-{name}"; game.mkdir(exist_ok=True)
shutil.copyfile(repo / "spikes/switch-room/guest/nel3ab-probe.nro", game / "nel3ab-probe.nro")
config = json.loads(pathlib.Path(os.environ["NEL3AB_SWITCH_CONFIG_BASE"]).expanduser().read_text())
config.update(engine=engine, state=str(root / f"state-guest-{name}"))
(root / f"config-guest-{name}.json").write_text(json.dumps(config))
env = dict(os.environ, NEL3AB_SWITCH_CONFIG=str(root / f"config-guest-{name}.json"))
bridge_log = open(root / f"bridge-guest-{name}.log", "w"); adapter_log = open(root / f"adapter-guest-{name}.log", "w")
bridge = subprocess.Popen([str(repo / "spikes/switch-room/bridge/target/debug/nel3ab-switch-prototype"), str(pads), "0"], stdout=bridge_log, stderr=subprocess.STDOUT)
adapter = None
try:
    for _ in range(200):
        if (pads / "rumble.sock").exists(): break
        if bridge.poll() is not None: raise RuntimeError("bridge failed")
        time.sleep(.05)
    adapter = subprocess.Popen(["python3", str(pathlib.Path(__file__).with_name("adaptateur-sonde.py")), str(game / "nel3ab-probe.nro"), title, "neuve", str(pads)], env=env, stdin=subprocess.PIPE, stdout=adapter_log, stderr=subprocess.STDOUT)
    print(json.dumps({"url": json.loads((pads / "bridge.json").read_text())["url"], "pads": str(pads), "engine": f"nel3ab-switch-room-guest-{name}"}), flush=True)
    keep = root / f"keep-running-guest-{name}"; keep.write_text("")
    while keep.exists() and adapter.poll() is None: time.sleep(1)
finally:
    if adapter is not None:
        adapter.stdin.close()
        try: print("adapter_exit", adapter.wait(timeout=65), flush=True)
        except subprocess.TimeoutExpired: adapter.terminate(); adapter.wait(timeout=10)
    bridge.terminate(); bridge.wait(timeout=10)
