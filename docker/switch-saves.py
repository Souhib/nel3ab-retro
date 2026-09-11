#!/usr/bin/env python3
"""Backup, restore or import a stopped Switch save slot, never a live game.

An import brings only what was checked in that game: see RULES. No archive
path is used unchecked as a destination and no downloaded code is executed.
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
from pathlib import Path, PurePosixPath
from typing import NamedTuple

spec = importlib.util.spec_from_file_location("adapter", Path(__file__).with_name("switch-room.py"))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class Files(NamedTuple):
    """These names only, each found once anywhere in the archive."""

    names: tuple[str, ...]


class Tree(NamedTuple):
    """Every file under this archive folder, keeping its subfolders."""

    folder: str


# One entry per game, added after its save was opened in that game.
RULES: dict[str, Files | Tree] = {
    # Mario Tennis Aces, checked on 2026-09-09.
    "0100bde00862a000": Files(("save.dat", "save7.dat")),
    # Mario Kart 8 Deluxe, checked on 2026-09-11 on 1.0.0 and 4.0.0. On 1.0.0
    # the ghosts and replays of a later version crashed it 54 s after boot; the
    # progression file alone carries the unlocks, Booster Course Pass included.
    "0100152000022000": Files(("userdata.dat",)),
    # Mario Party Superstars 1.1.1, checked on 2026-09-11.
    "01006fe013472000": Files(("hs_save_data",)),
    # Super Mario Party Jamboree 2.3.0, checked on 2026-09-11 with a Checkpoint
    # export from 1.0: Pauline and Ninji unlocked, the plaza's balloon offered.
    "0100965017338000": Files(("bqSaveData", "bqSaveData2")),
    # Super Smash Bros. Ultimate 13.0.5, checked on 2026-09-11. The __bcat__
    # folder beside it holds online events, not progression.
    "01006a800016e000": Tree("__user__/"),
}

# Measured on 2026-09-11 over twelve community saves for these games: at most
# 17.4 MB per archive, 5.98 MB per file, 11.5 MB and 13 files per import. The
# limits leave twice that room and bound what a malformed archive can write.
ARCHIVE_LIMIT = 40_000_000
FILE_LIMIT = 12_000_000
TOTAL_LIMIT = 24_000_000
COUNT_LIMIT = 64

# Ryubing keeps each container's owner in ExtraData0, laid out as the system's
# SaveDataAttribute: program at 0x00, save type at 0x20 (1 is a user's save).
ACCOUNT = 1


def account_container(slot: Path, title: str) -> Path:
    """The game's own user save. The template also brings Mario Tennis' container."""
    found = []
    for container in (slot / "data/bis/user/save").iterdir():
        extra = container / "ExtraData0"
        if container.is_dir() and extra.is_file():
            head = extra.read_bytes()[:0x21]
            if (
                len(head) == 0x21
                and int.from_bytes(head[:8], "little") == int(title, 16)
                and head[0x20] == ACCOUNT
            ):
                found.append(container)
    if len(found) != 1:
        raise ValueError("Start and close this game's slot once before importing")
    return found[0]


def chosen(rule: Files | Tree, archive: zipfile.ZipFile) -> dict[PurePosixPath, zipfile.ZipInfo]:
    """Where each accepted archive entry goes inside a save bank."""
    entries = [entry for entry in archive.infolist() if not entry.is_dir()]
    for entry in entries:
        # An archive that tries to leave its own folders is not trusted at all.
        parts = entry.filename.split("/")
        if "\\" in entry.filename or any(part in ("", ".", "..") for part in parts):
            raise ValueError("Refusing an archive path outside the save")
    if isinstance(rule, Files):
        picked = {}
        for name in rule.names:
            matches = [entry for entry in entries if PurePosixPath(entry.filename).name == name]
            if len(matches) != 1:
                raise ValueError(f"Expected {name} exactly once in the archive")
            picked[PurePosixPath(name)] = matches[0]
        return picked
    picked = {}
    for entry in entries:
        if not entry.filename.startswith(rule.folder):
            continue
        picked[PurePosixPath(entry.filename[len(rule.folder) :])] = entry
    if not picked:
        raise ValueError(f"Expected files under {rule.folder}")
    return picked


def import_save(slot: Path, title: str, archive: Path, source: str = "", note: str = "") -> None:
    rule = RULES.get(title.lower())
    if rule is None:
        raise ValueError("No save for this game was checked yet; see RULES")
    if archive.stat().st_size > ARCHIVE_LIMIT:
        raise ValueError("Archive exceeds the save import limit")
    with zipfile.ZipFile(archive) as source_archive:
        picked = chosen(rule, source_archive)
        if len(picked) > COUNT_LIMIT:
            raise ValueError("Too many save files")
        data = {}
        for inner, entry in picked.items():
            with source_archive.open(entry) as stream:
                payload = stream.read(FILE_LIMIT + 1)
            if len(payload) > FILE_LIMIT:
                raise ValueError("Invalid save file size")
            data[inner] = payload
    if sum(map(len, data.values())) > TOTAL_LIMIT:
        raise ValueError("Save exceeds the import limit")
    container = account_container(slot, title.lower())
    adapter.backup(slot)
    pending = slot / "import.pending"
    if pending.exists():
        shutil.rmtree(pending)
    for bank in ("0", "1"):
        for inner, payload in data.items():
            target = pending / bank / inner
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
    # The whole bank is replaced: a complete save is one coherent set of files.
    for bank in ("0", "1"):
        replaced = pending / f"{bank}.replaced"
        (container / bank).rename(replaced)
        (pending / bank).rename(container / bank)
    shutil.rmtree(pending)
    (slot / "import.json").write_text(
        json.dumps(
            {
                "title": title.lower(),
                "archive": archive.name,
                "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "imported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "files": sorted(str(inner) for inner in data),
                "source": source,
                "description": note,
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
    parser.add_argument("action", choices=["list", "prepare", "backup", "restore", "import"])
    parser.add_argument("value", nargs="?")
    parser.add_argument("--source", default="", help="where the imported archive came from")
    parser.add_argument("--note", default="", help="what its author says it contains")
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
        elif args.action == "import" and args.value:
            import_save(slot, args.title, Path(args.value), args.source, args.note)
        else:
            parser.error("Missing backup or archive")


if __name__ == "__main__":
    main()
