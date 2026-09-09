"""Use disposable children, including one unable to handle a normal signal."""

# Fixed test executables, not client commands. In-memory fixtures only.
import os
import signal
import subprocess
import sys
import unittest

from capture_process import stop_child


class ProcessTests(unittest.TestCase):
    def test_normal_exit_does_not_force_kill(self):
        child = subprocess.Popen([sys.executable, "-c", "pass"])
        child.wait(timeout=2)
        self.assertFalse(stop_child(child, grace=0.1))
        self.assertEqual(child.returncode, 0)

    def test_stopped_child_is_killed_and_reaped_before_return(self):
        child = subprocess.Popen(
            [sys.executable, "-c", "import os,signal;os.kill(os.getpid(),signal.SIGSTOP)"]
        )
        try:
            pid, status = os.waitpid(child.pid, os.WUNTRACED)
            self.assertEqual(pid, child.pid)
            self.assertTrue(os.WIFSTOPPED(status))
            self.assertTrue(stop_child(child, grace=0.1))
            self.assertEqual(child.returncode, -signal.SIGKILL)
        finally:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=2)


if __name__ == "__main__":
    unittest.main()
