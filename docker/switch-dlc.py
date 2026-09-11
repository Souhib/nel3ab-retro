#!/usr/bin/env python3
"""List a Switch game's add-on content for Ryubing, one checked NSP at a time.

Each NSP must hold exactly one public data part (NCA) whose title belongs to
the game. The title is read from the NCA header, decrypted with the console's
header key, rather than trusted from a file name. Nothing is extracted or run.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import struct
import sys
from pathlib import Path, PurePosixPath

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# Content type at 0x205 of the decrypted header: 5 is an add-on's data.
PUBLIC_DATA = 5
GUEST = PurePosixPath("/run-data/updates")


def entries(path: Path) -> list[tuple[str, int]]:
    """Name and offset of each file in an NSP (a PFS0 container)."""
    with path.open("rb") as stream:
        head = stream.read(16)
        if len(head) != 16 or head[:4] != b"PFS0":
            raise ValueError(f"{path.name} is not an NSP container")
        count, names = struct.unpack("<II", head[4:12])
        if count > 64 or names > 65536:
            raise ValueError(f"{path.name} lists too many files for an add-on")
        table = [struct.unpack("<QQII", stream.read(24)) for _ in range(count)]
        strings = stream.read(names)
    start = 16 + 24 * count + names
    found = []
    for offset, _, name, _ in table:
        end = strings.find(b"\0", name)
        if end < 0:
            raise ValueError(f"{path.name} has a broken file table")
        found.append((strings[name:end].decode(), start + offset))
    return found


def header(path: Path, at: int, key: bytes) -> tuple[int, int]:
    """Content type and title of the NCA at this offset.

    AES-XTS over 0x200-byte sectors with a big-endian sector number as tweak:
    Nintendo's variant, checked on 2026-09-11 against a real update and 99
    add-ons whose titles matched their file names.
    """
    with path.open("rb") as stream:
        stream.seek(at)
        raw = stream.read(0x400)
    if len(raw) != 0x400:
        raise ValueError(f"{path.name} holds a truncated NCA")
    plain = b""
    for sector in range(2):
        decryptor = Cipher(algorithms.AES(key), modes.XTS(sector.to_bytes(16, "big"))).decryptor()
        plain += decryptor.update(raw[sector * 0x200 : (sector + 1) * 0x200]) + decryptor.finalize()
    if plain[0x200:0x204] not in (b"NCA2", b"NCA3"):
        raise ValueError(f"{path.name}: unreadable NCA header, wrong key?")
    return plain[0x205], struct.unpack("<Q", plain[0x210:0x218])[0]


def listing(updates: Path, folder: str, game: int, key: bytes) -> list[dict]:
    """Ryubing's dlc.json for every NSP in updates/folder."""
    relative = PurePosixPath(folder)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError("The add-on folder must stay in the updates directory")
    # An add-on's title is the game's with 0x1000 added, then its own index.
    family = game + 0x1000
    result = []
    for path in sorted((updates / relative).glob("*.nsp")):
        data = []
        for name, at in entries(path):
            if name.endswith(".nca") and not name.endswith(".cnmt.nca"):
                kind, title = header(path, at, key)
                if kind == PUBLIC_DATA:
                    data.append((name, title))
        if len(data) != 1:
            raise ValueError(f"{path.name} must hold exactly one add-on data part")
        name, title = data[0]
        if title & ~0xFFF != family or title == family:
            raise ValueError(f"{path.name} is an add-on of another game ({title:016x})")
        result.append(
            {
                "path": str(GUEST / relative / path.name),
                "dlc_nca_list": [{"path": f"/{name}", "title_id": title, "is_enabled": True}],
            }
        )
    if not result:
        raise ValueError("No add-on found in that folder")
    return result


def install(state: Path, title: str, listed: list[dict]) -> None:
    """Both slots see the same add-ons; the update adapter checks they exist."""
    for choice in ("neuve", "debloquee"):
        slot = state / title / choice
        slot.mkdir(parents=True, exist_ok=True)
        with (slot / "running.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("Close this game before changing its add-ons") from None
            games = slot / "data/games" / title
            games.mkdir(parents=True, exist_ok=True)
            pending = games / "dlc.json.pending"
            pending.write_text(json.dumps(listed, indent=2))
            pending.replace(games / "dlc.json")


def header_key(template: Path) -> bytes:
    for line in (template / "system/prod.keys").read_text().splitlines():
        name, _, value = line.replace(" ", "").partition("=")
        if name == "header_key":
            return bytes.fromhex(value)
    raise ValueError("header_key missing from the private prod.keys")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("title")
    parser.add_argument("folder", help="add-on folder inside the private updates directory")
    args = parser.parse_args()
    if len(args.title) != 16 or any(c not in "0123456789abcdefABCDEF" for c in args.title):
        parser.error("Invalid title identifier")
    config = json.loads(args.config.read_text())
    title = args.title.lower()
    try:
        listed = listing(
            Path(config["updates"]),
            args.folder,
            int(title, 16),
            header_key(Path(config["template"])),
        )
        install(Path(config["state"]), title, listed)
    except ValueError as error:
        parser.error(str(error))
    sys.stdout.write(f"{len(listed)} add-ons listed for {title}\n")


if __name__ == "__main__":
    main()
