"""Read the recorder's complete H.264 packets without waiting for a later frame."""

import struct

HEADER = struct.Struct("<QI")
# Same limit as the private Rust ingress. A malformed length must fail before
# allocating the claimed payload, not grow a capture process without a bound.
MAX_PACKET = 4 * 1024 * 1024


class Packets:
    def __init__(self):
        self.buffer = bytearray()
        self.header = None

    def feed(self, data):
        self.buffer.extend(data)
        result = []
        while True:
            if self.header is None:
                if len(self.buffer) < HEADER.size:
                    break
                captured, size = HEADER.unpack_from(self.buffer)
                if captured == 0 or not 0 < size <= MAX_PACKET:
                    raise ValueError("invalid capture packet header")
                self.header = (captured, size)
                del self.buffer[: HEADER.size]
            captured, size = self.header
            if len(self.buffer) < size:
                break
            result.append((captured, bytes(self.buffer[:size])))
            del self.buffer[:size]
            self.header = None
        return result

    def finish(self):
        if self.buffer or self.header is not None:
            raise ValueError("capture ended inside a packet")
