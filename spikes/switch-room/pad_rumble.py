"""Forward vibration separately from the controller state."""

import socket


def send_rumble(sock, packet, address):
    # On 2026-09-09 EACCES on the worker socket destroyed all four pads during
    # Mario Tennis. Feedback is optional: a refused or full receiver must never
    # stop reading buttons. MSG_DONTWAIT also bounds a live but stalled receiver.
    try:
        sock.sendto(packet, socket.MSG_DONTWAIT, address)
    except OSError:
        return False
    return True
