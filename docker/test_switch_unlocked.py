"""A receipt declares an imported save; normal play must not manufacture one."""

import json
import runpy
import tempfile
import unittest
from pathlib import Path

mark = runpy.run_path(str(Path(__file__).resolve().parents[1] / "tools/save-unlocked.py"))["mark"]


class UnlockedSave(unittest.TestCase):
    def test_receipt_records_payload_and_refuses_empty_missing_or_escaping_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            slot = Path(temporary) / "debloquee"
            slot.mkdir()
            (slot / "save.dat").write_bytes(b"imported fixture")
            (slot / "empty").touch()
            outside = Path(temporary) / "outside"
            outside.write_bytes(b"real outside fixture")
            for files in (
                [],
                ["missing"],
                ["empty"],
                ["../outside"],
                [str(outside)],
                ["save.dat", "save.dat"],
                ["unlocked.json"],
            ):
                with self.assertRaises(ValueError):
                    mark(slot, files, "verified fixture")
                self.assertFalse((slot / "unlocked.json").exists())
            (slot / "link").symlink_to(slot / "save.dat")
            with self.assertRaises(ValueError):
                mark(slot, ["link"], "fixture")
            mark(slot, ["save.dat"], "verified fixture")
            receipt = json.loads((slot / "unlocked.json").read_text())
            self.assertEqual(receipt["files"], ["save.dat"])
            self.assertEqual(receipt["version"], 1)
            self.assertEqual(len(receipt["sha256_at_import"]["save.dat"]), 64)
            self.assertFalse((slot / "unlocked.json.pending").exists())
            with self.assertRaises(ValueError):
                mark(slot, ["save.dat"], " ")
