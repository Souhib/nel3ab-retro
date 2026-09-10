# L'adaptateur de la salle, tel quel, avec deux ajouts réservés aux sondes :
# les variables de sonde du moteur (marqueurs de latence et file son), et le
# programme de test monté en écriture. C'est une copie privée, et le chargeur
# de homebrew de Ryubing l'ouvre en écriture.
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("adapter", Path(__file__).resolve().parents[3] / "docker/switch-room.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
original = mod.run


def run(*args, **kwargs):
    if args[:2] == ("docker", "run") and "/probe/runtime.sh" in args:
        args = tuple(a[:-3] if isinstance(a, str) and a.endswith("/game/input.nro:ro") else a for a in args)
        args = (*args[:2], "-e", "NEL3AB_LATENCY_PROBE=1", "-e", "NEL3AB_AUDIO_PROBE=1", *args[2:])
    return original(*args, **kwargs)


mod.run = run
mod.main()
