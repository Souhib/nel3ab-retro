"""Coalesced key requests over private, nonblocking recorder pipes."""

import contextlib
import os
from pathlib import Path


class Keys:
    def __init__(self, root):
        self.paths = [Path(root) / f"{name}.key" for name in ("full", "half")]
        self.fds = []

    def __enter__(self):
        try:
            for path in self.paths:
                path.unlink(missing_ok=True)
                os.mkfifo(path, 0o600)
                # Keep both ends open while an on-demand recorder comes and goes.
                # Never wait on a stopped encoder from the control thread.
                self.fds.append(os.open(path, os.O_RDWR | os.O_NONBLOCK))
        except BaseException:
            self.__exit__(None, None, None)
            raise
        return self

    def request(self, half, wanted):
        if wanted:
            # A full pipe already contains a pending request. The silence
            # watchdog handles a recorder that no longer consumes them.
            with contextlib.suppress(BlockingIOError):
                os.write(self.fds[int(half)], b"K")

    def __exit__(self, *_):
        for fd in self.fds:
            os.close(fd)
        for path in self.paths:
            path.unlink(missing_ok=True)
