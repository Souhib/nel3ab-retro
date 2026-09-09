"""A second capture must be refused, and the session becomes reusable on exit."""

import tempfile
import unittest
from pathlib import Path

from capture_control import exclusive


class ExclusiveTests(unittest.TestCase):
    def test_second_writer_is_refused_then_first_exit_releases_the_session(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with exclusive(root):
                pid = (root / "capture.pid").read_text()
                self.assertTrue(pid.isdigit())
                with self.assertRaisesRegex(RuntimeError, "already owns"), exclusive(root):
                    self.fail("a second capture acquired the session")
                self.assertEqual((root / "capture.pid").read_text(), pid)
            self.assertFalse((root / "capture.pid").exists())
            with exclusive(root):
                self.assertTrue((root / "capture.pid").exists())

    def test_exception_releases_the_lock_and_pid_too(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "failed"), exclusive(directory):
                raise ValueError("failed capture")
            self.assertFalse((Path(directory) / "capture.pid").exists())
            with exclusive(directory):
                pass


if __name__ == "__main__":
    unittest.main()
