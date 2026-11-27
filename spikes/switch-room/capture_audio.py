"""Read whole 10 ms stereo chunks, without blocking shutdown on a silent pipe."""

import os
import select

# 48,000 samples/s * two channels * two bytes * 10 ms, matching send_sound.
CHUNK_BYTES = 1920
# How long a reader waits on a silent pipe before it looks again at a stop.
WAKE = 0.1


def chunks(fd, stopped):
    os.set_blocking(fd, False)
    # Woken as soon as parec writes. The 5 ms sleep this replaces made each
    # chunk wait 2.6 ms in median (SON-6, test_capture_audio.py). Unlike a
    # blocking read(1920), the bounded wait lets a stop reach a suspended
    # producer (2026-09-08).
    ready = select.poll()
    ready.register(fd, select.POLLIN)
    pending = bytearray()
    while not stopped.is_set():
        if not ready.poll(WAKE * 1000):
            continue
        try:
            data = os.read(fd, CHUNK_BYTES - len(pending))
        except BlockingIOError:
            continue
        if not data:
            if pending:
                raise ValueError("audio capture ended inside a chunk")
            return
        pending.extend(data)
        if len(pending) == CHUNK_BYTES:
            yield bytes(pending)
            pending.clear()
