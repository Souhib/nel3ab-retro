#!/usr/bin/env python3
"""Recover two vanished build dependencies from the matching upstream release.

The .NET bundle format is defined by dotnet/runtime, native/corehost/bundle.
Only these two managed DLLs are written, inside the private lab build directory.
They are never executed here. No game or console material is read.
"""

import hashlib
import io
import json
import struct
import sys
import zlib
from pathlib import Path

WANTED = {"Ryujinx.Systems.Update.Client.dll", "Ryujinx.Systems.Update.Common.dll"}
SIGNATURE = bytes.fromhex("8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae")


def extract(source, destination):
    data = source.read_bytes()
    marker = data.find(SIGNATURE)
    if marker < 8:
        raise ValueError("Not a .NET single-file bundle")
    offset = struct.unpack_from("<q", data, marker - 8)[0]
    stream = io.BytesIO(data)
    stream.seek(offset)

    def read(fmt):
        return struct.unpack(fmt, stream.read(struct.calcsize(fmt)))

    def string():
        size = 0
        for shift in range(0, 35, 7):
            byte = read("B")[0]
            size |= (byte & 127) << shift
            if byte < 128:
                return stream.read(size).decode("utf-8")
        raise ValueError("Invalid bundle string")

    major, minor, count = read("<IIi")
    if (major, minor) != (6, 0) or not 1 <= count <= 10000:
        raise ValueError("Expected bundle format 6.0")
    string()  # Bundle ID.
    read("<qqqqQ")  # deps.json, runtimeconfig.json locations and flags.
    found = {}
    for _ in range(count):
        start, size, compressed, kind = read("<qqqB")
        name = string()
        if name not in WANTED:
            continue
        length = compressed or size
        if kind != 1 or not 0 < size < 10_000_000 or not 0 <= start <= len(data) - length:
            raise ValueError("Invalid assembly entry")
        content = data[start : start + length]
        if compressed:
            content = zlib.decompress(content, -15)
        if len(content) != size or content[:2] != b"MZ":
            raise ValueError("Invalid assembly data")
        found[name] = content
    if set(found) != WANTED:
        raise ValueError("The matching release does not contain both update libraries")
    destination.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name, content in found.items():
        (destination / name).write_bytes(content)
        hashes[name] = hashlib.sha256(content).hexdigest()
    (destination / "provenance.json").write_text(
        json.dumps(
            {
                "release_sha256": hashlib.sha256(data).hexdigest(),
                "libraries": hashes,
            },
            indent=2,
        )
        + "\n"
    )
    return hashes


if __name__ == "__main__":
    sys.stdout.write(json.dumps(extract(Path(sys.argv[1]), Path(sys.argv[2])), indent=2) + "\n")
