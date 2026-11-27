"""The lines of pads.py, written by a thread of their own.

pads.py reads the buttons and answers the emulator's vibrations in one loop.
Until 2026-11-27 that loop printed each vibration with flush=True: Smash sent
about 107 a second to a player who had nothing to vibrate (49,028 lines in
about 460 s of pads.log, 2026-11-26), and a print waits whenever Docker stops
reading the pipe. Here the loop only puts a line in a bounded queue, which
never waits: a full queue drops the line and counts it. Vibrations are summed
per pad and per second.
"""

import json
import queue
import sys
import threading

# A second of vibration lines for four pads, with room to spare.
QUEUE = 1024
# One summary line per pad and per window.
EVERY = 1.0
_END = object()


class Journal:
    def __init__(self, stream=None, size=QUEUE, every=EVERY):
        self.stream = sys.stdout if stream is None else stream
        self.queue = queue.Queue(size)
        self.every = every
        # Lines dropped since the last one queued, and since the start.
        self.dropped = 0
        self.lost = 0
        # When the current window opened, and when it is due to close.
        self.opened = None
        self.window = None
        self.rumbles = {}
        # The last level forwarded per pad, kept across windows.
        self.levels = {}
        # A daemon: a writer stuck on a pipe nobody reads must not keep the
        # helper alive after its loop has ended.
        self.thread = threading.Thread(target=self._write, name="pad-journal", daemon=True)
        self.thread.start()

    def line(self, record):
        """Queue one line. Never waits."""
        if self.dropped:
            record = {**record, "journal_dropped": self.dropped}
        try:
            self.queue.put_nowait(record)
        except queue.Full:
            self.dropped += 1
            self.lost += 1
            return
        self.dropped = 0

    def rumble(self, player, play, magnitude, level, now):
        """One vibration event from the emulator, summed into its pad's window."""
        self.tick(now)
        if self.window is None:
            self.opened, self.window = now, now + self.every
        total = self.rumbles.setdefault(
            player, {"rumble": player, "events": 0, "played": 0, "changes": 0}
        )
        total["events"] += 1
        total["played"] += 1 if play else 0
        if self.levels.get(player) != level:
            total["changes"] += 1
            self.levels[player] = level
        total["level"] = level
        total["magnitude"] = magnitude

    def tick(self, now):
        """Write each pad's window once it is over."""
        if self.window is not None and now >= self.window:
            self.flush(now)
            self.opened, self.window = now, now + self.every

    def flush(self, now=None):
        """Each pad's sums. `seconds` is the window's measured length: a loop
        that stalled stretches it past `every`. Absent when the end is unknown."""
        if now is None or self.opened is None:
            length = {}
        else:
            length = {"seconds": round(now - self.opened, 3)}
        for player in sorted(self.rumbles):
            self.line({**self.rumbles[player], **length})
        self.rumbles = {}

    def close(self, now=None, timeout=1.0):
        """Write what is left, and give the writer `timeout` to finish."""
        self.flush(now)
        try:
            self.queue.put(_END, timeout=timeout)
        except queue.Full:
            return
        self.thread.join(timeout)

    def _write(self):
        while True:
            record = self.queue.get()
            if record is _END:
                return
            try:
                self.stream.write(json.dumps(record) + "\n")
                self.stream.flush()
            except (OSError, ValueError):
                # A closed or broken pipe: nobody reads these lines any more.
                return
