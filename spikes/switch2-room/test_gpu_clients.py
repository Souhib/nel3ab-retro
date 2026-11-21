import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import gpu_clients


class GpuClientsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.proc = Path(self.temp.name)

    def add_process(self, pid, name="ffmpeg", ticks=100, parent=1):
        p = self.proc / str(pid)
        p.mkdir()
        (p / "fd").mkdir()
        (p / "fdinfo").mkdir()
        fields = ["S", str(parent)] + ["0"] * 17 + [str(ticks)] + ["0"] * 6
        (p / "stat").write_text(f"{pid} ({name}) " + " ".join(fields))
        (p / "comm").write_text(name + "\n")
        return p

    def add_fd(self, p, fd=3, client=7, count=100, pdev="0000:06:00.0"):
        (p / "fd" / str(fd)).symlink_to("/dev/dri/renderD128")
        (p / "fdinfo" / str(fd)).write_text(
            f"drm-driver:\tamdgpu\ndrm-pdev:\t{pdev}\ndrm-client-id:\t{client}\n"
            f"drm-engine-compute:\t{count} ns\ndrm-engine-capacity-compute:\t2\n"
        )

    def test_real_scanner_finds_unrelated_gpu_and_ignores_other_device(self):
        self.add_fd(self.add_process(10))
        self.add_fd(self.add_process(20), pdev="0000:07:00.0")
        snapshot = gpu_clients.scan(self.proc)
        self.assertEqual(len(snapshot["clients"]), 1)
        self.assertEqual(snapshot["clients"][0]["owners"][0]["pid"], 10)
        self.assertEqual(len(gpu_clients.foreign_clients(snapshot, set())), 1)
        self.assertEqual(gpu_clients.foreign_clients(snapshot, {(10, 100)}), [])
        self.assertEqual(len(gpu_clients.foreign_clients(snapshot, {(10, 99)})), 1)

    def test_shared_and_duplicate_descriptors_are_counted_once(self):
        p = self.add_process(10)
        self.add_fd(p, count=100)
        self.add_fd(p, fd=4, count=120)
        self.add_fd(self.add_process(20), count=110)
        snapshot = gpu_clients.scan(self.proc)
        client = snapshot["clients"][0]
        self.assertEqual(len(snapshot["clients"]), 1)
        self.assertEqual(client["engines_ns"], {"drm-engine-compute": 120})
        self.assertEqual(client["handles"], 3)
        self.assertEqual(len(client["owners"]), 2)
        self.assertEqual(len(gpu_clients.foreign_clients(snapshot, {(10, 100)})), 1)
        self.assertEqual(gpu_clients.foreign_clients(snapshot, {(10, 100), (20, 100)}), [])

    def test_idle_or_unknown_usage_still_blocks_foreign_client(self):
        p = self.add_process(10)
        self.add_fd(p, count=0)
        self.assertEqual(len(gpu_clients.foreign_clients(gpu_clients.scan(self.proc), set())), 1)
        (p / "fdinfo/3").write_text(
            "drm-driver: amdgpu\ndrm-pdev: 0000:06:00.0\ndrm-client-id: 7\n"
        )
        self.assertEqual(len(gpu_clients.foreign_clients(gpu_clients.scan(self.proc), set())), 1)

    def test_new_foreign_client_is_seen_after_empty_snapshot(self):
        self.assertEqual(gpu_clients.scan(self.proc)["clients"], [])
        self.add_fd(self.add_process(10))
        self.assertEqual(len(gpu_clients.foreign_clients(gpu_clients.scan(self.proc), set())), 1)

    def test_malformed_target_metadata_cannot_pass_as_empty(self):
        for bad in ["-1 ns", "100 ms", "100", "invalid"]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                gpu_clients.descriptor(
                    "drm-driver: amdgpu\ndrm-pdev: 0000:06:00.0\ndrm-client-id: 7\n"
                    f"drm-engine-compute: {bad}\n",
                    "0000:06:00.0",
                )
        with self.assertRaises(ValueError):
            gpu_clients.descriptor("drm-pdev: 0000:06:00.0\n", "0000:06:00.0")
        with self.assertRaises(ValueError):
            gpu_clients.descriptor("drm-driver: amdgpu\ndrm-client-id: 7\n", "0000:06:00.0")

    def test_permission_error_is_not_an_empty_inventory(self):
        self.add_fd(self.add_process(10))
        original = Path.read_text

        def read(path, *args, **kwargs):
            if path.name == "3" and path.parent.name == "fdinfo":
                raise PermissionError("fixture permission refusal")
            return original(path, *args, **kwargs)

        with patch.object(Path, "read_text", read), self.assertRaises(PermissionError):
            gpu_clients.scan(self.proc)

    def test_presence_uses_real_character_metadata_without_driver_stats(self):
        p = self.add_process(10)
        (p / "fd/3").symlink_to("/dev/null")
        other = self.add_process(20)
        (other / "fd/3").symlink_to("/dev/zero")
        sysfs = self.proc / "sys-fixture"
        for major_minor, pci in [("1:3", "0000:06:00.0"), ("1:5", "0000:07:00.0")]:
            target = sysfs / "devices" / pci
            target.mkdir(parents=True)
            link = sysfs / "dev/char" / major_minor
            link.mkdir(parents=True)
            (link / "device").symlink_to(target)
        original = Path.read_text

        def refuse_driver_stats(path, *args, **kwargs):
            if path.parent.name == "fdinfo":
                raise AssertionError("The periodic guard must not read driver statistics")
            return original(path, *args, **kwargs)

        with patch.object(Path, "read_text", refuse_driver_stats):
            snapshot = gpu_clients.scan_presence(self.proc, sysfs)
        self.assertFalse(snapshot["driver_stats_read"])
        self.assertEqual(len(snapshot["clients"]), 1)
        self.assertEqual(snapshot["clients"][0]["owners"][0]["pid"], 10)
        self.assertEqual(len(gpu_clients.foreign_clients(snapshot, set())), 1)
        self.assertEqual(gpu_clients.foreign_clients(snapshot, {(10, 100)}), [])
        self.assertEqual(len(gpu_clients.foreign_clients(snapshot, {(10, 99)})), 1)
        (other / "fd/4").symlink_to("/dev/null")
        with patch.object(Path, "read_text", refuse_driver_stats):
            later = gpu_clients.scan_presence(self.proc, sysfs)
        self.assertEqual(len(later["clients"]), 2)
        self.assertEqual(len(gpu_clients.foreign_clients(later, {(10, 100)})), 1)

    def test_process_name_change_is_not_pid_reuse(self):
        p = self.add_process(10)
        self.add_fd(p)
        (p / "fd/4").symlink_to("/dev/null")
        sysfs = self.proc / "sys-fixture"
        target = sysfs / "devices/0000:06:00.0"
        target.mkdir(parents=True)
        link = sysfs / "dev/char/1:3"
        link.mkdir(parents=True)
        (link / "device").symlink_to(target)
        original = gpu_clients.process
        calls = 0

        def rename(directory):
            nonlocal calls
            calls += 1
            if calls == 2:
                (directory / "comm").write_text("new-name\n")
            return original(directory)

        for scan in [
            lambda: gpu_clients.scan(self.proc),
            lambda: gpu_clients.scan_presence(self.proc, sysfs),
        ]:
            (p / "comm").write_text("ffmpeg\n")
            calls = 0
            with patch.object(gpu_clients, "process", rename):
                snapshot = scan()
            self.assertEqual(calls, 2)
            self.assertEqual(len(snapshot["clients"]), 1)
            self.assertEqual(gpu_clients.foreign_clients(snapshot, {(10, 100)}), [])

    def test_process_start_change_during_scan_is_rejected(self):
        p = self.add_process(10)
        self.add_fd(p)
        (p / "fd/4").symlink_to("/dev/null")
        sysfs = self.proc / "sys-fixture"
        target = sysfs / "devices/0000:06:00.0"
        target.mkdir(parents=True)
        link = sysfs / "dev/char/1:3"
        link.mkdir(parents=True)
        (link / "device").symlink_to(target)
        initial = (p / "stat").read_text()
        original = gpu_clients.process
        calls = 0

        def replace(directory):
            nonlocal calls
            calls += 1
            if calls == 2:
                path = directory / "stat"
                path.write_text(path.read_text().replace("100", "101"))
            return original(directory)

        for scan in [
            lambda: gpu_clients.scan(self.proc),
            lambda: gpu_clients.scan_presence(self.proc, sysfs),
        ]:
            (p / "stat").write_text(initial)
            calls = 0
            with patch.object(gpu_clients, "process", replace), self.assertRaises(ValueError):
                scan()
            self.assertEqual(calls, 2)

    def test_real_room_ownership_excludes_unrelated_and_stale_driver(self):
        driver = self.add_process(10, "node", 100)
        self.add_process(20, "chrome", 101, 10)
        self.add_process(21, "chrome", 102, 20)
        self.add_process(30, "eden-cli", 103)
        self.add_process(40, "ffmpeg", 104)
        root = Path.home() / ".local/state/nel3ab/test-switch2-fixture"
        meta = self.proc / "meta.json"
        data = {
            "root": str(root),
            "session": str(root / "session"),
            "driver_pid": 10,
            "driver_start_ticks": "100",
            "browser_pid": 20,
        }
        meta.write_text(json.dumps(data))

        def command(args, **kwargs):
            if args[:3] == ["docker", "ps", "-q"]:
                return "owned-container\n"
            self.assertEqual(args[:3], ["docker", "top", "owned-container"])
            return "PID\n30\n"

        # sudo changes the scanner's home, not the owner of the private room.
        with patch.object(Path, "home", return_value=Path("/root")):
            owned = gpu_clients.room_processes(meta, self.proc, command)
        self.assertEqual(owned, {(10, 100), (20, 101), (21, 102), (30, 103)})
        data.pop("browser_pid")
        meta.write_text(json.dumps(data))
        self.assertEqual(gpu_clients.room_processes(meta, self.proc, command), owned)
        self.add_fd(self.proc / "40")
        self.assertEqual(len(gpu_clients.foreign_clients(gpu_clients.scan(self.proc), owned)), 1)
        (driver / "stat").write_text((driver / "stat").read_text().replace("100", "200"))
        with self.assertRaises(ValueError):
            gpu_clients.room_processes(meta, self.proc, command)


if __name__ == "__main__":
    unittest.main()
