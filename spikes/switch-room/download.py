#!/usr/bin/env python3
"""Fetch the exact public emulator builds tested on 2026-09-07, without games."""

import hashlib
import os
import subprocess
import tarfile
import urllib.request
from pathlib import Path

BUILDS = [
    (
        "ryubing.tar.gz",
        "https://git.ryujinx.app/projects/Ryubing/releases/download/1.3.3/ryujinx-1.3.3-linux_x64.tar.gz",
        "19b67b222726f28d11846e9b7cbaed113ea03c2be016408662ffb27c558bd28c",
    ),
    (
        "eden.AppImage",
        "https://stable.eden-emu.dev/v0.2.1/Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage",
        "7a28bf988b0648831989722bdbaa90ab31371b403808199813e0ea7c8b25ba6d",
    ),
]


def main():
    root = Path(os.environ.get("SWITCH_LAB", "/tmp/nel3ab-switch-lab"))
    root.mkdir(parents=True, exist_ok=True)
    for name, url, expected in BUILDS:
        path = root / name
        if not path.exists():
            partial = path.with_suffix(".partial")
            urllib.request.urlretrieve(url, partial)
            partial.rename(path)
        with path.open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if actual != expected:
            raise ValueError(f"Unexpected checksum for {name}: {actual}")
        print(f"Verified {name}: {actual}")
    destination = root / "ryubing"
    if not (destination / "publish/Ryujinx").exists():
        destination.mkdir(exist_ok=True)
        with tarfile.open(root / "ryubing.tar.gz") as archive:
            archive.extractall(destination, filter="data")
    destination = root / "eden"
    if not (destination / "AppDir/AppRun").exists():
        destination.mkdir(exist_ok=True)
        appimage = root / "eden.AppImage"
        appimage.chmod(0o755)
        with (root / "eden-extract.log").open("w") as log:
            subprocess.run(
                [str(appimage), "--appimage-extract"],
                cwd=destination,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=True,
            )


if __name__ == "__main__":
    main()
