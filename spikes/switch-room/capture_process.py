"""Reap a recorder even when it is stopped and cannot process SIGINT."""

import contextlib
import signal
import subprocess

# wf-recorder writes to /dev/null and its packets to a FIFO: once asked to stop,
# it has nothing left to finish. On a still picture it does not leave on SIGINT
# until Sway sends a copy (deduced from the journals: libwayland seems to
# resume its wait, which was not read in its code), so every stop on
# 2026-11-08 (4) and 2026-11-21 (36) took 5.03 s and ended in SIGKILL anyway.
# Half a second is about thirty frames for an encoder with one frame in flight
# (async_depth=1); how long a normal stop takes is not measured. parec keeps
# the default. After SIGKILL the wait stays 5 s: a recorder inside a VAAPI
# call (state D) dies only when it leaves the driver.
RECORDER_GRACE = 0.5


def stop_child(process, grace=5):
    with contextlib.suppress(ProcessLookupError):
        process.send_signal(signal.SIGINT)
    forced = False
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        # These are disposable capture children, never the emulator. A paused
        # recorder cannot process SIGINT, and must not survive the capture lock.
        forced = True
        process.kill()
        process.wait(timeout=5)
    return forced
