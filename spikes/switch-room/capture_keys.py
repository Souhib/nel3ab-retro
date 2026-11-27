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


def key_frame(payload):
    """Whether an Annex B access unit holds an IDR slice (NAL type 5).

    The same test as the worker's carries_key_frame. Emulation prevention
    keeps 00 00 01 out of NAL data, so every match is a start code.
    """
    at = payload.find(b"\0\0\1")
    while 0 <= at < len(payload) - 3:
        if payload[at + 3] & 0x1F == 5:
            return True
        at = payload.find(b"\0\0\1", at + 3)
    return False


class Opening:
    """Which packets of one recorder go to the worker.

    wlroots gives every new recorder one copy of what Sway already shows. At a
    room's start it is the empty output: on 2026-11-26 it became the room's
    « image » 4.5 s after the click, while Smash drew its first picture about
    38 s after it. That copy is never sent, and a key frame is asked at once:
    the recorder reads the request before encoding its next picture, which
    therefore starts a stream even if it is the game's only one (a still first
    screen). Until a key frame comes, P frames are dropped, since they refer to
    the copy nobody received. A restart in the middle of a game loses one
    picture this way.
    """

    def __init__(self, ask_key):
        self.ask_key = ask_key
        self.seen = 0
        self.open = False

    def admit(self, payload):
        self.seen += 1
        if self.seen == 1:
            self.ask_key()
            return False
        if not self.open:
            self.open = key_frame(payload)
        return self.open
