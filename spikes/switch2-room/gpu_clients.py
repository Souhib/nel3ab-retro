#!/usr/bin/env python3
"""Inspect DRM clients before/during isolated performance trials.

Only procfs descriptor metadata is read. No allocator/debugfs or device ioctl.
An unrelated open client blocks a trial even if it is momentarily idle. A
periodic scan cannot exclude a client created and closed between observations.
Format: https://docs.kernel.org/gpu/drm-usage-stats.html
"""

import argparse
import json
import os
import pwd
import re
import stat
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True, order=True)
class Process:
    pid: int
    start_ticks: int
    name: str

    @property
    def identity(self):
        # A process can change its comm without changing PID or start time.
        return self.pid, self.start_ticks


def process(directory):
    raw = (directory / "stat").read_text()
    end = raw.rfind(")")
    fields = raw[end + 2 :].split()
    return Process(int(directory.name), int(fields[19]), (directory / "comm").read_text().strip())


def descriptor(text, pdev):
    fields = {}
    for line in text.splitlines():
        key, separator, value = line.partition(":")
        if separator:
            if key in fields:
                raise ValueError(f"Duplicate fdinfo key: {key}")
            fields[key] = value.strip()
    if "drm-pdev" not in fields:
        raise ValueError("GPU descriptor lacks PCI device identity")
    if fields["drm-pdev"].lower() != pdev.lower():
        return None
    if not fields.get("drm-driver") or not fields.get("drm-client-id", "").isdigit():
        raise ValueError("Target GPU descriptor lacks a driver or client identity")
    engines = {}
    for key, value in fields.items():
        if key.startswith("drm-engine-capacity-"):
            if not value.isdigit() or int(value) == 0:
                raise ValueError("Invalid GPU engine capacity")
        elif key.startswith("drm-engine-"):
            match = re.fullmatch(r"([0-9]+) ns", value)
            if not match:
                raise ValueError("GPU engine time must be a nonnegative nanosecond count")
            engines[key] = int(match[1])
    return (fields["drm-driver"], int(fields["drm-client-id"])), engines


def scan(proc=Path("/proc"), pdev="0000:06:00.0"):
    """Detailed counters, for diagnostics outside a performance phase only."""
    if not re.fullmatch(r"[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]", pdev):
        raise ValueError("Expected a full PCI device address")
    begin = time.monotonic_ns()
    clients = {}
    for directory in sorted(proc.iterdir()):
        if not directory.name.isdigit():
            continue
        try:
            owner = process(directory)
            found = []
            for fd in (directory / "fd").iterdir():
                try:
                    if not os.readlink(fd).startswith("/dev/dri/"):
                        continue
                    result = descriptor((directory / "fdinfo" / fd.name).read_text(), pdev)
                    if result is not None:
                        found.append(result)
                except (FileNotFoundError, ProcessLookupError):
                    # A closed descriptor/process contributes no surviving client.
                    continue
            current = process(directory)
            if current.identity != owner.identity:
                raise ValueError(
                    f"Process identity changed: {owner.identity} -> {current.identity}"
                )
        except (FileNotFoundError, ProcessLookupError):
            continue
        for key, engines in found:
            item = clients.setdefault(key, {"owners": set(), "engines_ns": {}, "handles": 0})
            item["owners"].add(owner)
            item["handles"] += 1
            for engine, value in engines.items():
                # Duplicated/shared descriptors expose the same cumulative work.
                item["engines_ns"][engine] = max(item["engines_ns"].get(engine, 0), value)
    return {
        "begin_monotonic_ns": begin,
        "end_monotonic_ns": time.monotonic_ns(),
        "pdev": pdev,
        "clients": [
            {
                "driver": driver,
                "client_id": client_id,
                "owners": [asdict(p) for p in sorted(item["owners"])],
                "engines_ns": item["engines_ns"],
                "handles": item["handles"],
            }
            for (driver, client_id), item in sorted(clients.items())
        ],
    }


def scan_presence(proc=Path("/proc"), sysfs=Path("/sys"), pdev="0000:06:00.0"):
    """Only stat descriptors and resolve their sysfs PCI identity during a trial.

    Reading fdinfo also asks the driver for memory statistics. Its cost on a
    running emulator is not qualified, so the periodic guard never reads it.
    This records open handles, not engine activity or unique DRM clients.
    """
    if not re.fullmatch(r"[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]", pdev):
        raise ValueError("Expected a full PCI device address")
    begin = time.monotonic_ns()
    cpu_begin = time.process_time_ns()
    clients = []
    pci_devices = {}
    for directory in sorted(proc.iterdir()):
        if not directory.name.isdigit():
            continue
        try:
            owner = process(directory)
            handles = 0
            for fd in (directory / "fd").iterdir():
                try:
                    metadata = fd.stat()
                    if not stat.S_ISCHR(metadata.st_mode):
                        continue
                    device = f"{os.major(metadata.st_rdev)}:{os.minor(metadata.st_rdev)}"
                    if device not in pci_devices:
                        pci_devices[device] = (
                            (sysfs / "dev/char" / device / "device").resolve().name
                        )
                    pci = pci_devices[device]
                    handles += pci.lower() == pdev.lower()
                except (FileNotFoundError, ProcessLookupError):
                    continue
            current = process(directory)
            if current.identity != owner.identity:
                raise ValueError(
                    f"Process identity changed: {owner.identity} -> {current.identity}"
                )
            if handles:
                clients.append({"owners": [asdict(owner)], "handles": handles})
        except (FileNotFoundError, ProcessLookupError):
            continue
    return {
        "begin_monotonic_ns": begin,
        "end_monotonic_ns": time.monotonic_ns(),
        "cpu_time_ns": time.process_time_ns() - cpu_begin,
        "pdev": pdev,
        "clients": clients,
        "driver_stats_read": False,
    }


def foreign_clients(snapshot, owned):
    """PID alone cannot grant an exception after that PID has been reused."""
    return [
        client
        for client in snapshot["clients"]
        if any((p["pid"], p["start_ticks"]) not in owned for p in client["owners"])
    ]


def room_processes(meta_path, proc=Path("/proc"), command=subprocess.check_output):
    """Allow only this live private driver's containers and direct browser tree."""
    meta = json.loads(meta_path.read_text())
    root = Path(meta["root"])
    home = Path(pwd.getpwuid(meta_path.stat().st_uid).pw_dir)
    if root.parent != home / ".local/state/nel3ab" or not root.name.startswith("test-switch2-"):
        raise ValueError("Not an owned private room")
    if meta["session"] != str(root / "session"):
        raise ValueError("Room label differs from private root")
    driver = process(proc / str(meta["driver_pid"]))
    if driver.start_ticks != int(meta["driver_start_ticks"]):
        raise ValueError("Private driver identity changed")
    ids = command(
        ["docker", "ps", "-q", "--filter", "label=nel3ab.room-root=" + meta["session"]],
        text=True,
        timeout=5,
    ).split()
    pids = {driver.pid}
    for cid in ids:
        lines = command(["docker", "top", cid, "-eo", "pid"], text=True, timeout=5).splitlines()[1:]
        pids.update(int(line.strip()) for line in lines)
    # The browser is launched as a direct child of the identified driver. Its
    # descendants may own shared DRM files outside the game containers.
    if meta.get("browser_pid"):
        browser = int(meta["browser_pid"])
        stat = (proc / str(browser) / "stat").read_text()
        if int(stat[stat.rfind(")") + 2 :].split()[1]) != driver.pid:
            raise ValueError("Browser is not this driver's direct child")
        pids.add(browser)
    all_parents = {}
    for entry in proc.iterdir():
        if entry.name.isdigit():
            try:
                raw = (entry / "stat").read_text()
                all_parents[int(entry.name)] = int(raw[raw.rfind(")") + 2 :].split()[1])
            except (FileNotFoundError, ProcessLookupError):
                continue
    while True:
        children = {pid for pid, parent in all_parents.items() if parent in pids}
        if children <= pids:
            break
        pids |= children
    owned = set()
    for pid in pids:
        try:
            item = process(proc / str(pid))
            owned.add((item.pid, item.start_ticks))
        except (FileNotFoundError, ProcessLookupError):
            continue
    if process(proc / str(driver.pid)).identity != driver.identity:
        raise ValueError("Private driver changed before GPU ownership decision")
    return owned


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdev", default="0000:06:00.0")
    parser.add_argument("--room", type=Path)
    parser.add_argument(
        "--details", action="store_true", help="Read driver counters outside trials only"
    )
    args = parser.parse_args()
    try:
        # Snapshot first; ownership can only exempt process identities present
        # in this observation, and errors cannot turn into an empty inventory.
        snapshot = scan(pdev=args.pdev) if args.details else scan_presence(pdev=args.pdev)
        owned = room_processes(args.room) if args.room else set()
        foreign = foreign_clients(snapshot, owned)
        snapshot.update(foreign_clients=foreign, isolated=not foreign)
        sys.stdout.write(json.dumps(snapshot) + "\n")
        return 3 if foreign else 0
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as error:
        sys.stdout.write(json.dumps({"isolated": False, "observation_error": str(error)}) + "\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
