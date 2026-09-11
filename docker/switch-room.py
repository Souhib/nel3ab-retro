#!/usr/bin/env python3
"""Switch room adapter. Owns only its two containers and its private save slot.

The worker closes stdin to request a graceful stop. Capture stops first, then
Ryubing closes its window and flushes saves, then virtual controllers disappear.
"""

from __future__ import annotations

import fcntl
import json
import os
import selectors
import shutil
import subprocess
import sys
import time
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / "spikes/switch-room"


def run(*args: str, **kwargs):
    return subprocess.run(args, check=True, **kwargs)  # noqa: S603 -- fixed programs, argument arrays, no shell


def initialise(template: Path, slot: Path) -> None:
    """One complete root per game/slot. Never overwrite an existing progression."""
    if (slot / "data").is_dir():
        return
    slot.mkdir(parents=True, exist_ok=True)
    pending = slot / "data.pending"
    if pending.exists():
        shutil.rmtree(pending)
    shutil.copytree(template, pending)
    # Ryubing indexes save containers in its system filesystem. Removing the
    # user/save directory alone leaves dangling indexes: Tennis aborted with
    # ResultFsTargetNotFound on 2026-09-09. Keep metadata, empty both data banks.
    for bank in (pending / "bis/user/save").glob("*/*"):
        if bank.is_dir() and bank.name in ("0", "1"):
            for entry in bank.iterdir():
                if entry.is_dir() and not entry.is_symlink():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
    pending.rename(slot / "data")


def backup(slot: Path) -> Path | None:
    """Copy a quiescent filesystem, including Ryubing's journal and metadata."""
    source = slot / "data/bis/user"
    if not source.exists():
        return None
    target = slot / "backups" / time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    target.parent.mkdir(exist_ok=True)
    if target.exists():
        target = target.with_name(target.name + f"-{time.time_ns()}")
    shutil.copytree(source, target)
    return target


def main() -> None:
    rom, title, choice, pads = sys.argv[1:]
    if (
        len(title) != 16
        or any(c not in "0123456789abcdef" for c in title)
        or choice not in ("neuve", "debloquee")
    ):
        raise ValueError("Invalid Switch title or save slot")
    config = json.loads(Path(os.environ["NEL3AB_SWITCH_CONFIG"]).read_text())
    root = Path(config["state"]).resolve()
    slot = root / title / choice
    slot.mkdir(parents=True, exist_ok=True)
    with (slot / "running.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        initialise(Path(config["template"]), slot)
        backup(slot)
        serve(config, Path(rom).resolve(), slot, Path(pads).resolve())


def update_mount(config: dict, slot: Path) -> list[str]:
    """Never silently run the base game when its selected update is unavailable."""
    metadata = slot / "data/games" / slot.parent.name / "updates.json"
    if not metadata.exists():
        return []
    selected = json.loads(metadata.read_text()).get("selected")
    if not selected:
        return []
    guest = Path(selected)
    prefix = Path("/run-data/updates")
    if "updates" not in config or not guest.is_relative_to(prefix) or ".." in guest.parts:
        raise ValueError("Selected Switch update requires its private updates directory")
    root = Path(config["updates"]).resolve()
    if not (root / guest.relative_to(prefix)).is_file():
        raise ValueError("Selected Switch update is missing; refusing to start the base game")
    return ["-v", f"{root}:/run-data/updates:ro"]


def pad_command(image: str, pads: Path, helper: str, label: str) -> list[str]:
    """Use the same confinement for the live helper and its real rumble test."""
    uid, gid = str(os.getuid()), str(os.getgid())
    return [
        "docker",
        "run",
        "-d",
        "--name",
        helper,
        "--label",
        f"nel3ab.room-root={pads.parent}",
        "--network",
        "none",
        "--cap-drop=ALL",
        "--cap-add=CHOWN",
        "--cap-add=FOWNER",
        "--group-add",
        gid,
        "--security-opt=no-new-privileges",
        "--pids-limit=32",
        "--device=/dev/uinput",
        "-v",
        "/dev/input:/dev/input",
        "-v",
        f"{pads}:/run-data",
        "-v",
        f"{TOOLS}:/probe:ro",
        "-e",
        f"HOST_UID={uid}",
        "-e",
        f"NEL3AB_PAD_LABEL={label}",
        image,
        "python3",
        "/probe/pads.py",
    ]


def engine_environment(config: dict) -> list[str]:
    """Engine container environment, checked before any container starts.

    refresh_hz is Sway's composing rate on the server, not the players' screens:
    see refresh_hz in spikes/switch-room/supervise.py, which checks it again.
    """
    refresh = config.get("refresh_hz", 60)
    if type(refresh) is not int or not 30 <= refresh <= 240:
        raise ValueError(f"refresh_hz must be a whole number from 30 to 240, not {refresh!r}")
    # Keep the image on screen until the next one is presented, as a console
    # does (amont/ryubing-hold-front-buffer.patch). Off unless the room says so.
    hold = config.get("hold_front_buffer", False)
    if type(hold) is not bool:
        raise ValueError(f"hold_front_buffer must be true or false, not {hold!r}")
    return [
        "-e",
        "DISPLAY_BACKEND=wayland",
        "-e",
        "SWITCH_COMPOSITOR=sway",
        "-e",
        f"SWITCH_REFRESH_HZ={refresh}",
        # Only the seats taken in the room get a controller (ryubing-seats.patch).
        "-e",
        "NEL3AB_SEATS_FILE=/pads/seats",
        *(["-e", "NEL3AB_HOLD_FRONT_BUFFER=1"] if hold else []),
    ]


def serve(config: dict, rom: Path, slot: Path, pads: Path) -> None:
    # Instance names follow the private runtime, so integration rooms cannot
    # stop the production room. Docker refuses duplicates instead of stealing.
    token = pads.name
    engine = f"nel3ab-switch-{token}"
    helper = f"{engine}-pads"
    image = config["image"]
    environment = engine_environment(config)
    updates = update_mount(config, slot)
    uid, gid = str(os.getuid()), str(os.getgid())
    # Helper has no DAC override: share this one directory with the host group.
    pads.chmod(0o770)
    capture = None
    started_engine = started_helper = False
    selector = selectors.DefaultSelector()
    selector.register(sys.stdin, selectors.EVENT_READ)
    try:
        run(
            *pad_command(image, pads, helper, f"nel3ab {token}"),
            stdout=subprocess.DEVNULL,
        )
        started_helper = True
        deadline = time.monotonic() + 10
        while not (pads / "devices.json").exists():
            if time.monotonic() >= deadline:
                raise RuntimeError("Virtual controllers did not start")
            time.sleep(0.05)
        devices = json.loads((pads / "devices.json").read_text())
        profile = slot / "data/profiles/controller/nel3ab.json"
        profile.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(TOOLS / "ryubing-pro-controller.json", profile)
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
            *environment,
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
        args.extend(updates)
        for device in devices:
            args.extend(["--device", device])
        args.extend(
            [
                image,
                "bash",
                "/probe/runtime.sh",
                "/emulator/publish/Ryujinx",
                "--no-gui",
                "--root-data-dir",
                "/run-data/data",
                "--fullscreen",
                "--memory-manager-mode",
                "HostMapped",
                "--graphics-backend",
                "Vulkan",
                "--ignore-controller-applet",
            ]
        )
        for seat in range(1, 5):
            args.extend(
                [
                    f"--input-id-{seat}",
                    f"{seat - 1}-00000003-045e-0000-8e02-000014010000",
                    f"--input-profile-{seat}",
                    "nel3ab",
                ]
            )
        args.append(f"/game/input{rom.suffix}")
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
                stop_engine(engine, slot, capture)
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


def stop_engine(engine: str, slot: Path, capture) -> None:
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
            backup(slot)
            with (slot / "emulator.log").open("w") as log:
                run("docker", "logs", engine, stdout=log, stderr=subprocess.STDOUT)
        finally:
            run("docker", "rm", engine, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
