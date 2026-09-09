"""One capture per private session; stopping docker exec alone does not stop it."""

import contextlib
import fcntl
import os
import signal
import sys
import time
from pathlib import Path

ROOT = Path("/run-data")


@contextlib.contextmanager
def exclusive(root):
    root = Path(root)
    with (root / "capture.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("a capture already owns this session") from error
        pid_file = root / "capture.pid"
        pid_file.write_text(str(os.getpid()))
        try:
            yield
        finally:
            pid_file.unlink(missing_ok=True)


def stop(root=ROOT):
    pid_file = root / "capture.pid"
    if not pid_file.exists():
        return
    pid = int(pid_file.read_text())
    try:
        command = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
    except FileNotFoundError:
        return
    if command[:2] != [b"python3", b"/probe/capture.py"]:
        raise RuntimeError("capture PID now belongs to another process; refusing to signal it")
    os.kill(pid, signal.SIGTERM)
    # The capture stops and joins its recorders before releasing this lock.
    # Ten seconds bounds failure; it does not silently kill or replace a writer.
    deadline = time.monotonic() + 10
    with (root / "capture.lock").open("a") as lock:
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError(
                        "capture did not release its session within ten seconds"
                    ) from None
                time.sleep(0.1)


if __name__ == "__main__":
    if sys.argv[1:] != ["stop"]:
        raise SystemExit("usage: capture_control.py stop")
    stop()
