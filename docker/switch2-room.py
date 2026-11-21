#!/usr/bin/env python3
"""Experimental one-player Eden-family room, with a separate persistent NAND."""

from __future__ import annotations

import configparser
import fcntl
import importlib.util
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "switch_room", Path(__file__).with_name("switch-room.py")
)
room = importlib.util.module_from_spec(spec)
spec.loader.exec_module(room)

NAND = Path("home/.local/share/eden/nand")
TITLE = r"0400[0-9a-f]{9}000"
REVISION = r"[a-z0-9][a-z0-9._-]{0,79}"


def select_engine(config: dict, title: str) -> dict:
    """Select a qualified engine triple while preserving shared save storage.

    Zelda's private 30 fps profile was exercised on 2026-11-10. Mario Tennis
    was not: selecting it by title keeps the other game's existing runtime.
    State and display settings belong to the room and cannot be overridden.
    """
    if not re.fullmatch(TITLE, title):
        raise ValueError("Invalid Switch 2 title")
    profiles = config.get("engines_by_title", {})
    if not isinstance(profiles, dict):
        raise ValueError("engines_by_title must map titles to engine triples")
    for identifier, profile in profiles.items():
        if not isinstance(identifier, str) or not re.fullmatch(TITLE, identifier):
            raise ValueError("Invalid title in engines_by_title")
        if not isinstance(profile, dict) or set(profile) != {"image", "engine", "revision"}:
            raise ValueError("A title engine requires exactly image, engine and revision")
        if any(not isinstance(value, str) or not value.strip() for value in profile.values()):
            raise ValueError("Title engine values must be nonempty strings")
        if not re.fullmatch(REVISION, profile["revision"]):
            raise ValueError("Invalid title engine revision")
    return {**config, **profiles.get(title, {})}


def configuration(slot: Path) -> Path:
    """Bind the production kernel pad, without a second stick-axis conversion."""
    ini = configparser.ConfigParser(interpolation=None)
    ini.optionxform = str

    def put(section: str, key: str, value: object) -> None:
        if section not in ini:
            ini[section] = {}
        ini[section][key] = str(value)
        ini[section][key + "\\default"] = "false"

    for key, value in {
        "backend": 1,
        "resolution_setup": 3,
        "gpu_accuracy": 0,
        "nvdec_emulation": 2,
        "async_presentation": "true",
        "use_asynchronous_shaders": "true",
        "frame_gen": "false",
    }.items():
        put("Renderer", key, value)
    put("Miscellaneous", "log_filter", "*:Info HW.GPU:Warning Render.Vulkan:Warning")
    put("System", "use_docked_mode", 1)
    for directory in ("nand", "sdmc", "load", "dump", "tas"):
        # SetEdenPath ignores a directory that does not exist. Without this,
        # a fresh slot silently saves under the engine's default app name
        # instead of the NAND that our backup reads (2026-11-07).
        (slot / "home/.local/share/eden" / directory).mkdir(parents=True, exist_ok=True)
        put(
            "Data%20Storage",
            directory + "_directory",
            f"/run-data/home/.local/share/eden/{directory}",
        )
    guid = "030000005e0400008e02000014010000"
    prefix = f"engine:sdl,port:0,guid:{guid},"
    for button, index in {
        "a": 0,
        "b": 1,
        "x": 3,
        "y": 2,
        "l": 4,
        "r": 5,
        "minus": 6,
        "plus": 7,
        "home": 8,
        "lstick": 9,
        "rstick": 10,
    }.items():
        put("Controls", "player_0_button_" + button, f'"{prefix}button:{index}"')
    for button, direction in {
        "dup": "up",
        "ddown": "down",
        "dleft": "left",
        "dright": "right",
    }.items():
        put(
            "Controls",
            "player_0_button_" + button,
            f'"{prefix}hat:0,direction:{direction}"',
        )
    for button, axis in {"zl": 2, "zr": 5}.items():
        put(
            "Controls",
            "player_0_button_" + button,
            f'"{prefix}axis:{axis},threshold:0.5,direction:+"',
        )
    for stick, x, y in (("lstick", 0, 1), ("rstick", 3, 4)):
        put(
            "Controls",
            "player_0_" + stick,
            f'"{prefix}axis_x:{x},axis_y:{y},deadzone:0.1,range:1.0"',
        )
    for index in range(8):
        put("Controls", f"player_{index}_connected", "true" if index == 0 else "false")
    slot.mkdir(parents=True, exist_ok=True)
    target = slot / "emulator.ini"
    with target.open("w") as stream:
        ini.write(stream, space_around_delimiters=False)
    return target


def backup(slot: Path) -> Path | None:
    """The caller holds the slot lock and waits for the emulator to exit first."""
    source = slot / NAND
    if not source.exists():
        return None
    target = slot / "backups" / f"{time.strftime('%Y%m%dT%H%M%S', time.gmtime())}-{time.time_ns()}"
    target.mkdir(parents=True)
    shutil.copytree(source, target / "nand")
    if (slot / "emulator.ini").exists():
        shutil.copyfile(slot / "emulator.ini", target / "emulator.ini")
    return target


def launch(config: dict, rom: Path, slot: Path) -> room.EngineLaunch:
    revision = config.get("revision", "")
    if not isinstance(revision, str) or not re.fullmatch(REVISION, revision):
        raise ValueError("Switch 2 requires an explicit engine revision")
    if rom.suffix.lower() != ".nup" or not rom.is_file():
        raise ValueError("Switch 2 requires an existing registered NUP")
    executable = Path(config["engine"]) / "usr/bin/eden-cli"
    if not executable.is_file():
        raise ValueError("Switch 2 engine must be an extracted AppImage with eden-cli")
    environment = room.engine_environment(config)
    # Mesh draws reset this server's GPU on 2026-11-07. This workaround omits
    # objects; its visual cost must remain visible in the experimental label.
    environment += [
        "-e",
        "EDEN_NX2_SPLIT=0",
        "-e",
        "EDEN_NX2_FENCE_BATCH=1",
        "-e",
        "EDEN_NX2_FRAMES_AHEAD=1",
        "-e",
        "EDEN_NX2_NO_MESH=1",
    ]
    cache = slot.parent / "cache" / revision
    cache.mkdir(parents=True, exist_ok=True)
    configuration(slot)
    return room.EngineLaunch(
        environment,
        ["-v", f"{cache}:/run-data/home/.cache"],
        [
            "/usr/bin/env",
            "LD_LIBRARY_PATH=/emulator/usr/lib",
            "/emulator/usr/bin/eden-cli",
            "-c",
            "/run-data/emulator.ini",
            "-f",
            "-g",
            f"/game/input{rom.suffix}",
        ],
        1,
    )


def main() -> None:
    rom, title, choice, pads = sys.argv[1:]
    if not re.fullmatch(TITLE, title) or not re.fullmatch(room.SLOT, choice):
        raise ValueError("Invalid Switch 2 title or save slot")
    config = select_engine(json.loads(Path(os.environ["NEL3AB_SWITCH2_CONFIG"]).read_text()), title)
    slot = Path(config["state"]).resolve() / title / choice
    slot.mkdir(parents=True, exist_ok=True)
    with (slot / "running.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        plan = launch(config, Path(rom).resolve(), slot)
        backup(slot)
        room.serve(config, Path(rom).resolve(), slot, Path(pads).resolve(), plan, backup)


if __name__ == "__main__":
    main()
