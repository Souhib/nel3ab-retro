#!/usr/bin/env python3
"""Backup, restore or import a stopped Switch save slot, never a live game.

Only Mario Tennis Aces' two verified data filenames are accepted for imports.
No archive path is used as a destination and no downloaded code is executed.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import importlib.util
import json
import shutil
import sys
import time
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("adapter", Path(__file__).with_name("switch-room.py"))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def import_tennis(slot: Path, archive: Path) -> None:
    if archive.stat().st_size > 2_000_000:
        raise ValueError("Archive exceeds the save import limit")
    with zipfile.ZipFile(archive) as source:
        files = source.infolist()
        if {f.filename for f in files} != {"save.dat", "save7.dat"} or len(files) != 2:
            raise ValueError("Expected only save.dat and save7.dat")
        if any(f.file_size > 1_000_000 for f in files):
            raise ValueError("Invalid save file size")
        data = {f.filename: source.read(f) for f in files}
    saves = slot / "data/bis/user/save"
    entries = [entry for entry in saves.iterdir() if entry.is_dir()]
    if len(entries) != 1 or not all((entries[0] / name).is_dir() for name in ("0", "1")):
        raise ValueError("Start and close this game's slot once before importing")
    adapter.backup(slot)
    for bank in ("0", "1"):
        for name, payload in data.items():
            target = entries[0] / bank / name
            temporary = target.with_suffix(".pending")
            temporary.write_bytes(payload)
            temporary.replace(target)
    (slot / "import.json").write_text(
        json.dumps(
            {
                "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "imported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": "https://github.com/Viren070/NX_Saves/blob/main/index.md",
                "description": "Complete + Online Skins Unlocked; verify in the game",
            },
            indent=2,
        )
    )


def restore(slot: Path, name: str) -> None:
    if Path(name).name != name or name in (".", ".."):
        raise ValueError("Choose a listed backup name")
    source = slot / "backups" / name
    if not source.is_dir() or source.is_symlink():
        raise ValueError("Unknown backup")
    target = slot / "data/bis/user"
    adapter.backup(slot)
    pending = slot / "data/bis/user.restore"
    if pending.exists():
        raise ValueError("A previous restore needs inspection")
    shutil.copytree(source, pending)
    previous = target.with_name(f"user.before-restore-{time.time_ns()}")
    target.rename(previous)
    try:
        pending.rename(target)
    except OSError:
        previous.rename(target)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("title")
    parser.add_argument("slot", choices=["neuve", "debloquee"])
    parser.add_argument("action", choices=["list", "prepare", "backup", "restore", "import-tennis"])
    parser.add_argument("value", nargs="?")
    args = parser.parse_args()
    if len(args.title) != 16 or any(c not in "0123456789abcdefABCDEF" for c in args.title):
        parser.error("Invalid title identifier")
    config = json.loads(args.config.read_text())
    slot = Path(config["state"]) / args.title.lower() / args.slot
    if args.action == "list":
        for item in sorted((slot / "backups").glob("*")):
            sys.stdout.write(item.name + "\n")
        return
    if args.action == "prepare":
        slot.mkdir(parents=True, exist_ok=True)
    with (slot / "running.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("Close this game before changing its saves")
        if args.action == "prepare":
            adapter.initialise(Path(config["template"]), slot)
        elif args.action == "backup":
            sys.stdout.write(str(adapter.backup(slot)) + "\n")
        elif args.action == "restore" and args.value:
            restore(slot, args.value)
        elif (
            args.action == "import-tennis"
            and args.value
            and args.title.lower() == "0100bde00862a000"
        ):
            import_tennis(slot, Path(args.value))
        else:
            parser.error("Missing backup/archive, or unsupported game")


if __name__ == "__main__":
    main()
