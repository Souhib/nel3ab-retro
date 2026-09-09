import socket
import unittest
from unittest.mock import Mock

from pad_rumble import send_rumble


class RumbleTests(unittest.TestCase):
    def test_permission_failure_does_not_kill_input(self):
        sock = Mock()
        sock.sendto.side_effect = PermissionError("private socket is not writable")
        self.assertFalse(send_rumble(sock, bytes((2, 128)), "/unused/rumble.sock"))

    def test_full_queue_does_not_block_input(self):
        sock = Mock()
        sock.sendto.side_effect = BlockingIOError("receiver is full")
        self.assertFalse(send_rumble(sock, bytes((2, 128)), "/unused/rumble.sock"))
        sock.sendto.assert_called_once_with(
            bytes((2, 128)), socket.MSG_DONTWAIT, "/unused/rumble.sock"
        )

    def test_vibration_recovers_after_delivery_fails(self):
        sock = Mock()
        sock.sendto.side_effect = [ConnectionRefusedError(), 2]
        self.assertFalse(send_rumble(sock, bytes((2, 128)), "/unused/rumble.sock"))
        self.assertTrue(send_rumble(sock, bytes((2, 0)), "/unused/rumble.sock"))
        self.assertEqual(sock.sendto.call_count, 2)
