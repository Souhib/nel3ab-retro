"""Bound silence, including a producer that has never sent its first packet."""

import threading
import time

# Match the existing Dolphin worker's conservative 3/30-second silence policy.
# Normal capture was below 100 ms on 2026-09-08; thirty seconds is a recovery
# bound, not a claim about legitimate game loading. Only transport production
# is watched, not whether successive game pictures look different.
WARN_AFTER = 3.0
FAIL_AFTER = 30.0


class Progress:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.last = clock()
        self.warned = False
        self.lock = threading.Lock()

    def saw(self):
        with self.lock:
            self.last = self.clock()
            self.warned = False

    def check(self):
        with self.lock:
            quiet = self.clock() - self.last
            if quiet >= FAIL_AFTER:
                raise RuntimeError(f"no complete packet for {quiet:.1f} seconds")
            if quiet >= WARN_AFTER and not self.warned:
                self.warned = True
                return True
        return False
