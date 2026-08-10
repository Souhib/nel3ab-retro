#!/usr/bin/env python3
"""Proves that a pipe write changes what the emulated GAME does.

Run it against an already-started headless Dolphin whose user directory is
`session` and which was launched with frame dumping enabled.

# Why this particular observable

Melee boots, finds no memory card, and stops on a modal asking "Create Game
Data?". It renders that dialog and then does *nothing at all* — measured here at
7037 byte-identical frames over ~two minutes. The game is blocked on input.

That gives the assertion its own control, in the same run: the screen provably
does not change on its own, so a change right after `PRESS A` cannot be
attributed to an animation, a timer, or attract mode. "No error was returned"
would have proven nothing; this proves the emulated console reacted.

# The trap this script already stepped in

Hashing the NEWEST framedump file reads it while Dolphin is still writing it.
A torn PNG hashes differently and looks exactly like the screen changing — it
produced a false "the screen changed by itself" on the first attempt. So a frame
is only read once it is several frames old AND ends with a complete IEND chunk.
"""

import errno
import hashlib
import os
import sys
import time

# A frame this far behind the newest one is closed and flushed.
READ_LAG_FRAMES = 8
PNG_IEND = b"\x49\x45\x4e\x44\xae\x42\x60\x82"


def newest_settled_frame(frames_dir):
    """Returns (index, md5) of a frame old enough to be completely written."""
    try:
        names = [n for n in os.listdir(frames_dir) if n.startswith("framedump_")]
    except FileNotFoundError:
        return None, None
    if not names:
        return None, None

    def index_of(name):
        return int(name[len("framedump_"):-len(".png")])

    target = max(map(index_of, names)) - READ_LAG_FRAMES
    if target < 1:
        return None, None
    path = os.path.join(frames_dir, f"framedump_{target}.png")
    try:
        data = open(path, "rb").read()
    except OSError:
        return None, None
    # A complete PNG ends with IEND. Anything else is a file still being written.
    if not data.endswith(PNG_IEND):
        return None, None
    return target, hashlib.md5(data).hexdigest()


def attach(fifo, timeout=90):
    """Opens the write end, waiting out the ENXIO that means 'no reader yet'."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
        except OSError as exc:
            if exc.errno != errno.ENXIO:
                raise
            time.sleep(0.05)
    raise SystemExit("FAIL: Dolphin never opened the read end of the FIFO")


def main():
    session = sys.argv[1]
    frames_dir = os.path.join(session, "Dump", "Frames")
    fd = attach(os.path.join(session, "Pipes", "p1"))
    print("attached to the pipe", flush=True)

    def send(line):
        os.write(fd, (line + "\n").encode())

    # Full state first: Dolphin's initial pad state is only accidentally neutral.
    for token in "A B X Y Z L R START D_UP D_DOWN D_LEFT D_RIGHT".split():
        send(f"RELEASE {token}")
    send("SET MAIN 0.5 0.5")
    send("SET C 0.5 0.5")
    send("SET L 0.0")
    send("SET R 0.0")

    # 1. Wait for the picture to stop changing.
    stable, since, index = None, None, None
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        index, digest = newest_settled_frame(frames_dir)
        if digest is None:
            time.sleep(0.2)
            continue
        if digest == stable:
            if time.monotonic() - since > 6:
                break
        else:
            stable, since = digest, time.monotonic()
        time.sleep(0.2)
    if stable is None:
        raise SystemExit("FAIL: no frames were ever dumped")
    print(f"BASELINE: frame {index}, static, hash {stable[:12]}", flush=True)

    # 2. The control. If this fails the experiment is void, not the emulator.
    samples, last = 0, index
    for _ in range(40):
        time.sleep(0.2)
        idx, digest = newest_settled_frame(frames_dir)
        if digest is None:
            continue
        samples += 1
        last = idx
        if digest != stable:
            raise SystemExit(f"VOID: the screen changed by itself at frame {idx}")
    print(
        f"CONTROL: {samples} samples over 8s, frames {index}->{last} all identical",
        flush=True,
    )

    # 3. The intervention.
    send("PRESS A")
    time.sleep(0.15)
    send("RELEASE A")
    print("sent PRESS A / RELEASE A", flush=True)

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        idx, digest = newest_settled_frame(frames_dir)
        if digest is not None and digest != stable:
            advanced = idx - last
            print(
                f"RESULT: PASS - the game reacted at frame {idx} "
                f"({advanced} frames after the last identical one), hash {digest[:12]}",
                flush=True,
            )
            os.close(fd)
            return 0
        time.sleep(0.1)

    print("RESULT: FAIL - the screen never changed after A", flush=True)
    os.close(fd)
    return 1


if __name__ == "__main__":
    sys.exit(main())
