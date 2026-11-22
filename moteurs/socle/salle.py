"""Le cycle de vie d'une salle externe: manettes, moteur, capture, arrêt.

`serve` et `stop_engine` sont déplacés de `docker/switch-room.py`, qui garde sa
propre copie jusqu'à la bascule de la Switch. Deux différences seulement, et
`test_differentiel.py` prouve qu'elles ne changent aucune commande:

- `launch` est exigé, et peut être une fonction: le plan de Ryubing se calcule
  à l'endroit même où switch-room.py appelait `ryubing_launch`;
- `snapshot` est exigé: la copie d'un emplacement appartient au moteur.

Les messages restent ceux d'aujourd'hui, « Switch emulator exited » compris:
le banc doré les fige, et les relevés existants les cherchent.

Aucune fonction de ce module n'importe dans son corps (ruff PLC0415): une
salle lit tout son code au démarrage, et un import paresseux lirait au moment
de l'arrêt une version plus récente de l'arbre principal.
"""

from __future__ import annotations

import json
import os
import selectors
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

from moteurs.socle.lancement import TOOLS, EngineLaunch, cpu_pinning, pad_command, run


def serve(
    config: dict,
    rom: Path,
    slot: Path,
    pads: Path,
    launch: EngineLaunch | Callable[[], EngineLaunch],
    snapshot: Callable[[Path], Path | None],
) -> None:
    # Instance names follow the private runtime, so integration rooms cannot
    # stop the production room. Docker refuses duplicates instead of stealing.
    token = pads.name
    engine = f"nel3ab-switch-{token}"
    helper = f"{engine}-pads"
    image = config["image"]
    # Un plan différé se calcule ICI, après la lecture de l'image: c'est la place
    # de `ryubing_launch` dans switch-room.py, et une configuration sans image
    # doit échouer avant le profil de manette et les caches partagés.
    launch = launch() if callable(launch) else launch
    if launch.controllers not in (1, 4):
        raise ValueError("A room must launch one or four controllers")
    uid, gid = str(os.getuid()), str(os.getgid())
    # Helper has no DAC override: share this one directory with the host group.
    pads.chmod(0o770)
    capture = None
    started_engine = started_helper = False
    selector = selectors.DefaultSelector()
    selector.register(sys.stdin, selectors.EVENT_READ)
    try:
        run(
            *pad_command(image, pads, helper, f"nel3ab {token}", launch.pad_layout),
            stdout=subprocess.DEVNULL,
        )
        started_helper = True
        deadline = time.monotonic() + 10
        while not (pads / "devices.json").exists():
            if time.monotonic() >= deadline:
                raise RuntimeError("Virtual controllers did not start")
            time.sleep(0.05)
        devices = json.loads((pads / "devices.json").read_text())
        if len(devices) != 4:
            raise RuntimeError("Virtual controller helper did not create four devices")
        args = [
            "docker",
            "run",
            "-d",
            "--name",
            engine,
            "--label",
            f"nel3ab.room-root={pads.parent}",
            "--network",
            "none",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--pids-limit=512",
            "--user",
            f"{uid}:{gid}",
            "--group-add",
            str(os.stat("/dev/dri/renderD128").st_gid),
            "--device=/dev/dri/renderD128",
            "--shm-size=8g",
            *launch.environment,
            "-v",
            f"{Path(config['engine']).resolve()}:/emulator:ro",
            "-v",
            f"{slot}:/run-data",
            "-v",
            f"{TOOLS}:/probe:ro",
            "-v",
            f"{pads}:/pads",
            "-v",
            f"{rom}:/game/input{rom.suffix}:ro",
        ]
        args.extend(launch.mounts)
        args.extend(cpu_pinning(config))
        for device in devices[: launch.controllers]:
            args.extend(["--device", device])
        args.extend(
            [
                image,
                "bash",
                "/probe/runtime.sh",
                *launch.command,
            ]
        )
        # Avoid accepting yesterday's display as the new compositor's readiness.
        (slot / "display.json").unlink(missing_ok=True)
        run(*args, stdout=subprocess.DEVNULL)
        started_engine = True
        retries: list[float] = []
        while not selector.select(0.1):
            status = run(
                "docker",
                "inspect",
                "-f",
                "{{.State.Running}}",
                engine,
                capture_output=True,
                text=True,
            ).stdout.strip()
            if status != "true":
                raise RuntimeError("Switch emulator exited; see lifecycle.json")
            if (slot / "display.json").exists() and (capture is None or capture.poll() is not None):
                # Killing docker exec alone leaves capture inside the container.
                run(
                    "docker",
                    "exec",
                    engine,
                    "python3",
                    "/probe/capture_control.py",
                    "stop",
                )
                now = time.monotonic()
                retries = [at for at in retries if now - at < 60]
                if len(retries) >= 3:
                    raise RuntimeError("Capture failed three times in one minute")
                retries.append(now)
                capture = subprocess.Popen(  # noqa: S603 -- private generated container name, fixed command
                    ["/usr/bin/docker", "exec", engine, "python3", "/probe/capture.py"]
                )
            time.sleep(0.4)
    finally:
        selector.close()
        try:
            if started_engine:
                stop_engine(engine, slot, capture, snapshot)
        finally:
            # A failed capture wait or a save-copy error must not retain inputs.
            if started_helper:
                run(
                    "docker",
                    "stop",
                    "--timeout",
                    "5",
                    helper,
                    stdout=subprocess.DEVNULL,
                )
                try:
                    with (slot / "pads.log").open("w") as log:
                        run(
                            "docker",
                            "logs",
                            helper,
                            stdout=log,
                            stderr=subprocess.STDOUT,
                        )
                finally:
                    run("docker", "rm", helper, stdout=subprocess.DEVNULL)


def stop_engine(engine: str, slot: Path, capture, snapshot) -> None:
    try:
        subprocess.run(  # noqa: S603 -- generated private container name, fixed command
            [
                "/usr/bin/docker",
                "exec",
                engine,
                "python3",
                "/probe/capture_control.py",
                "stop",
            ],
            check=False,
        )
        if capture:
            capture.wait(timeout=15)
    finally:
        # Always stop the actual container, even if its docker-exec client hung.
        # Only after Docker confirms the stop may its filesystem be copied.
        run("docker", "stop", "--timeout", "40", engine, stdout=subprocess.DEVNULL)
        try:
            status = run(
                "docker",
                "inspect",
                "-f",
                "{{json .State}}",
                engine,
                capture_output=True,
                text=True,
            ).stdout
            (slot / "exit.json").write_text(status)
            snapshot(slot)
            with (slot / "emulator.log").open("w") as log:
                run("docker", "logs", engine, stdout=log, stderr=subprocess.STDOUT)
        finally:
            run("docker", "rm", engine, stdout=subprocess.DEVNULL)
