# Lance un vrai jeu dans une sonde, jamais dans la salle :
#   NEL3AB_SWITCH_CONFIG_BASE=~/.config/nel3ab/switch.json \
#     python3 jeu.py <nom> <moteur> <rom> <titre> <emplacement> <dossier d'état>
# Même adaptateur que la salle, avec les variables de sonde (adaptateur-sonde.py),
# un pont privé et des conteneurs nommés d'après <nom>. Tant que
# keep-running-jeu-<nom> existe dans NEL3AB_SONDE, le jeu tourne ; l'effacer
# l'arrête proprement. Rangé dans le dépôt parce que la copie de /tmp a disparu
# au redémarrage du 11 septembre 2026.
import json, os, pathlib, shutil, subprocess, sys, time

root = pathlib.Path(os.environ.get("NEL3AB_SONDE", "/tmp/nel3ab-sonde")); root.mkdir(exist_ok=True)
repo = pathlib.Path(__file__).resolve().parents[3]
name, engine, rom, title, choice, state = sys.argv[1:7]
# Un dossier neuf à chaque lancement, comme la salle : l'adaptateur attend
# devices.json, et celui d'un essai précédent désignait des manettes
# disparues (Docker : /dev/input/event8 introuvable, 11 septembre 2026).
pads = root / f"room-jeu-{name}"; shutil.rmtree(pads, ignore_errors=True); pads.mkdir()
config = json.loads(pathlib.Path(os.environ["NEL3AB_SWITCH_CONFIG_BASE"]).expanduser().read_text())
config.update(engine=engine, state=state)
(root / f"config-jeu-{name}.json").write_text(json.dumps(config))
env = dict(os.environ, NEL3AB_SWITCH_CONFIG=str(root / f"config-jeu-{name}.json"))
bridge_log = open(root / f"bridge-jeu-{name}.log", "w"); adapter_log = open(root / f"adapter-jeu-{name}.log", "w")
bridge = subprocess.Popen([str(repo / "spikes/switch-room/bridge/target/debug/nel3ab-switch-prototype"), str(pads), "0"], stdout=bridge_log, stderr=subprocess.STDOUT)
adapter = None
try:
    for _ in range(200):
        if (pads / "rumble.sock").exists(): break
        if bridge.poll() is not None: raise RuntimeError("bridge failed")
        time.sleep(.05)
    adapter = subprocess.Popen(["python3", str(pathlib.Path(__file__).with_name("adaptateur-sonde.py")), rom, title, choice, str(pads)], env=env, stdin=subprocess.PIPE, stdout=adapter_log, stderr=subprocess.STDOUT)
    print(json.dumps({"url": json.loads((pads / "bridge.json").read_text())["url"], "engine": f"nel3ab-switch-room-jeu-{name}"}), flush=True)
    keep = root / f"keep-running-jeu-{name}"; keep.write_text("")
    while keep.exists() and adapter.poll() is None: time.sleep(1)
finally:
    if adapter is not None:
        adapter.stdin.close()
        try: print("adapter_exit", adapter.wait(timeout=65), flush=True)
        except subprocess.TimeoutExpired: adapter.terminate(); adapter.wait(timeout=10)
    bridge.terminate(); bridge.wait(timeout=10)
