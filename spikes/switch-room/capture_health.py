"""Bound silence, including a producer that has never sent its first packet."""

import threading
import time
from pathlib import Path

# Match the existing Dolphin worker's conservative 3/30-second silence policy.
# Normal capture was below 100 ms on 2026-09-08; thirty seconds is a recovery
# bound, not a claim about legitimate game loading. Only transport production
# is watched, not whether successive game pictures look different.
WARN_AFTER = 3.0
FAIL_AFTER = 30.0
# Before a recorder's second packet, the bound is START_LIMIT from its start.
# wlroots gives every new recorder one copy of what Sway already shows, then
# nothing until the screen changes (copy_with_damage). On 2026-11-26 that copy
# was the empty output at 23:32:32.342, Smash drew its first picture about 33 s
# later (15.9 s of shaders, then its layer at 23:33:00.3), and the 30 s guard
# killed a healthy capture at 23:33:02.3. Ninety seconds is about 2.7 times that
# start, which grows by about 1.5 ms per cached shader. It does not cover a
# first launch that rebuilds the translation cache (4 minutes for Mario Tennis):
# the capture then restarts every 90 s until the game draws, which costs no
# picture, and the room's restart rule ignores what happens before the first
# picture (switch-room.py). A recorder alive but blocked (state D, or S facing
# a dead Sway) before its second packet is seen only at this bound.
START_LIMIT = 90.0


def process_state(pid):
    """The one-letter state of /proc/<pid>/stat, or None once the process is gone."""
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
    except (FileNotFoundError, ProcessLookupError):
        return None
    # The command name sits in parentheses and may itself hold any character.
    return stat[stat.rindex(")") + 2]


class Progress:
    """`copies` packets of each producer are what it found, not what it made.

    The default is a picture recorder: one copy, then START_LIMIT until it
    sends a second packet. Sound passes `copies=0, start_limit=FAIL_AFTER`.
    """

    def __init__(self, clock=time.monotonic, state=process_state, copies=1, start_limit=None):
        if copies not in (0, 1):
            raise ValueError("a producer finds at most one picture already on screen")
        self.clock = clock
        self.state = state
        self.copies = copies
        self.start_limit = START_LIMIT if start_limit is None else start_limit
        self.pid = None
        self.started = self.last = clock()
        self.packets = 0
        self.warned = False
        self.lock = threading.Lock()

    def follow(self, pid):
        """A new producer: its own start, its own first copy, its state read."""
        with self.lock:
            self.pid = pid
            self.started = self.last = self.clock()
            self.packets = 0
            self.warned = False

    @property
    def armed(self):
        with self.lock:
            return self.packets > self.copies

    def saw(self):
        with self.lock:
            self.packets += 1
            self.last = self.clock()
            self.warned = False

    def check(self):
        with self.lock:
            now = self.clock()
            # SIGSTOP on 2026-09-08 took the whole silence bound to be seen.
            # A stopped recorder never resumes by itself: name it at once.
            if self.pid is not None and self.state(self.pid) == "T":
                raise RuntimeError(f"producer {self.pid} is stopped (state T)")
            quiet = now - self.last
            if self.packets > self.copies:
                if quiet >= FAIL_AFTER:
                    raise RuntimeError(f"no complete packet for {quiet:.1f} seconds")
            elif now - self.started >= self.start_limit:
                skipped = ", the compositor's first copy not counted" if self.copies else ""
                raise RuntimeError(
                    f"no complete packet for {now - self.started:.1f} seconds"
                    f" since it started{skipped}"
                )
            if quiet >= WARN_AFTER and not self.warned:
                self.warned = True
                return True
        return False
