#!/usr/bin/env python3
"""Exercise the actual restart limit, only on the unrouted prototype listener."""

# Fixed executable paths and disposable capture children, not user commands.
# Assertions are the experiment's failure signal; output is its report.
# ruff: noqa: S101, S108, S603, T201
import json
import subprocess
import time
from pathlib import Path

ROOT = Path("/tmp/nel3ab-switch-lab/pads")
CONTAINER = "nel3ab-switch-ryubing-lab"


def command(*args):
    return subprocess.check_output(args, text=True, timeout=20)


def processes():
    return command("docker", "exec", CONTAINER, "ps", "-eo", "pid,args").splitlines()


def full_pid():
    for row in processes():
        if "/usr/local/bin/nel3ab-wf-recorder" in row and "w=640:h=360" not in row:
            return int(row.split()[0])
    return None


def until(predicate, seconds=8):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    assert predicate(), "capture did not reach the expected state"


def start():
    command("bash", str(Path(__file__).with_name("capture-service.sh")))
    until(full_pid)


def main():
    assert json.loads((ROOT / "bridge.json").read_text())["url"] == "http://127.0.0.1:8311"
    command("systemctl", "--user", "stop", "nel3ab-switch-capture")
    start()
    killed = []
    try:
        for attempt in range(3):
            victim = full_pid()
            assert victim and victim > 1
            killed.append(victim)
            command("docker", "exec", CONTAINER, "kill", "-KILL", str(victim))
            if attempt < 2:
                until(lambda previous=victim: full_pid() is not None and full_pid() != previous)
        until(lambda: full_pid() is None)
        # Longer than two retry periods. No fourth process is allowed.
        time.sleep(3)
        rows = processes()
        assert not any(
            term in row
            for row in rows
            for term in (
                "python3 /probe/capture.py",
                "/usr/local/bin/nel3ab-wf-recorder",
                "/usr/bin/parec",
            )
        ), rows
        assert (
            command(
                "systemctl",
                "--user",
                "show",
                "nel3ab-switch-capture",
                "-p",
                "ActiveState",
                "--value",
            ).strip()
            != "active"
        )
        print(json.dumps({"killed": killed, "fourth_start_refused": True, "orphan_children": 0}))
    finally:
        # --collect unloads a failed transient unit, including its start counter.
        # Restore a fresh explicitly requested service even if an assertion failed.
        subprocess.run(
            ["/usr/bin/systemctl", "--user", "stop", "nel3ab-switch-capture"],
            check=False,
            capture_output=True,
            timeout=20,
        )
        start()


if __name__ == "__main__":
    main()
