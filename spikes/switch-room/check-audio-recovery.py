#!/usr/bin/env python3
"""Pause only the prototype's audio server and prove the emulator catches up.

Requires SWITCH_AUDIO_PROBE=1. This intentionally makes a one-second audio gap.
The named test container is the only target; SIGCONT runs even on failure.
"""
# Executables and the container name are fixed; the PID is read from that
# container's process table and validated as numeric, never supplied by a client.
# stdout is the benchmark report. No game samples or private settings are printed.
# ruff: noqa: S603, T201

import datetime
import json
import re
import subprocess
import time

CONTAINER = "nel3ab-switch-ryubing-lab"


def docker(*args):
    return subprocess.check_output(["/usr/bin/docker", *args], stderr=subprocess.STDOUT).decode()


def main():
    info = json.loads(docker("inspect", CONTAINER))[0]
    if "NEL3AB_AUDIO_PROBE=1" not in info["Config"]["Env"]:
        raise RuntimeError("Launch the prototype with SWITCH_AUDIO_PROBE=1 for this test")
    pids = [
        line.split()[0]
        for line in docker("exec", CONTAINER, "ps", "-eo", "pid,comm", "--no-headers").splitlines()
        if line.split()[1] == "pulseaudio"
    ]
    if len(pids) != 1 or not pids[0].isdigit():
        raise RuntimeError("Expected exactly one private PulseAudio process")
    pattern = r"NEL3AB_AUDIO queued_ms=([\d.]+) discarded_ms=([\d.]+)"
    previous = re.findall(pattern, docker("logs", CONTAINER))
    if not previous:
        raise RuntimeError("Wait for an audio probe reading before inducing the stall")
    discarded_before = float(previous[-1][1])
    since = datetime.datetime.now(datetime.UTC).isoformat()
    try:
        docker("exec", CONTAINER, "kill", "-STOP", pids[0])
        time.sleep(1)
    finally:
        docker("exec", CONTAINER, "kill", "-CONT", pids[0])
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        rows = re.findall(
            pattern,
            docker("logs", "--since", since, CONTAINER),
        )
        if rows:
            queued, discarded = map(float, rows[-1])
            newly_discarded = discarded - discarded_before
            if queued <= 50 and newly_discarded >= 500:
                print(
                    json.dumps(
                        {
                            "pausedSeconds": 1,
                            "queuedMs": queued,
                            "newlyDiscardedMs": newly_discarded,
                        }
                    )
                )
                return
        time.sleep(0.2)
    raise RuntimeError(f"Audio failed to catch up after the induced stall: {rows}")


if __name__ == "__main__":
    main()
