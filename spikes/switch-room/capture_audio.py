"""Read whole 10 ms stereo chunks, without blocking shutdown on a silent pipe."""

import os

# 48,000 samples/s * two channels * two bytes * 10 ms, matching send_sound.
CHUNK_BYTES = 1920


def chunks(fd, stopped):
    os.set_blocking(fd, False)
    pending = bytearray()
    while not stopped.is_set():
        try:
            data = os.read(fd, CHUNK_BYTES - len(pending))
        except BlockingIOError:
            # Five milliseconds matches the video FIFO's polling interval.
            # Unlike read(1920), this lets a stop reach a suspended producer.
            stopped.wait(0.005)
            continue
        if not data:
            if pending:
                raise ValueError("audio capture ended inside a chunk")
            return
        pending.extend(data)
        if len(pending) == CHUNK_BYTES:
            yield bytes(pending)
            pending.clear()
