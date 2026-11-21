#!/usr/bin/env python3
"""Record a deliberately imported unlocked save; never infer completion from play."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath


def mark(directory: Path, files: list[str], source: str) -> None:
    """The caller attests the unlocks. The receipt pins which payloads must remain."""
    if directory.name != "debloquee" or directory.is_symlink() or not source.strip():
        raise ValueError("Choose a real debloquee slot and describe the verified import source")
    # Switch imports cap logical files at 64 and duplicate them in two banks.
    # The inventory on 2026-11-10 has at most thirteen logical files per import.
    if not files or len(files) > 128 or len(set(files)) != len(files):
        raise ValueError("Choose 1..128 distinct imported payloads")
    checksums = {}
    for name in files:
        path = PurePosixPath(name)
        if (
            name == "unlocked.json"
            or not name
            or path.is_absolute()
            or any(p in ("", ".", "..") for p in name.split("/"))
        ):
            raise ValueError("Imported payload must stay inside the slot")
        current = directory
        for part in path.parts:
            current /= part
            if current.is_symlink():
                raise ValueError("Imported payload cannot be a symbolic link")
        if not current.is_file() or current.stat().st_size == 0:
            raise ValueError("Imported payload is missing or empty")
        checksums[name] = hashlib.sha256(current.read_bytes()).hexdigest()
    payload = (
        json.dumps(
            {
                "version": 1,
                "source": source,
                "files": sorted(files),
                "sha256_at_import": checksums,
            },
            indent=2,
        )
        + "\n"
    )
    # Match the Rust reader's bounded receipt read.
    if len(payload.encode()) > 65_536:
        raise ValueError("Import receipt exceeds 64 KiB")
    pending = directory / "unlocked.json.pending"
    with pending.open("x") as stream:
        stream.write(payload)
    pending.replace(directory / "unlocked.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("files", nargs="+")
    parser.add_argument("--source", required=True)
    args = parser.parse_args()
    mark(args.directory, args.files, args.source)
