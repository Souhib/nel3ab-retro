"""Reap a recorder even when it is stopped and cannot process SIGINT."""

import contextlib
import signal
import subprocess


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
        process.wait(timeout=grace)
    return forced
