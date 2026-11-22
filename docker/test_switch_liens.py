"""The host never writes or copies through a link that a container left in its slot.

Each engine container mounts its slot read-write (`-v {slot}:/run-data`) under
the host's account. A compromised engine (a trapped game plus an emulator flaw)
can leave there a link to a host file it cannot see. Before 22 November 2026,
the host then emptied that file through `running.lock`, wrote the engine's
choice of logs into it, or copied host files back into the mount. The socle has
the same guards and its own essay (`moteurs/socle/test_liens.py`); these cover
what only the scripts do: their `main`, Ryubing's profile and shared caches,
Eden's configuration and NAND copy, and the save tool.

Each test leaves a link to a file or folder OUTSIDE the slot and checks its
target is intact. Its twin: the same ordinary file is still written.
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


switch = load("switch_room", "switch-room.py")
switch2 = load("switch2_room", "switch2-room.py")
xbox = load("xbox360_room", "xbox360-room.py")
saves = load("switch_saves", "switch-saves.py")

KEEP = "host content, keep it\n"
SWITCH_TITLE = "0100bde00862a000"


class Host:
    """A host folder outside every slot, and its witnesses."""

    def __init__(self, root: Path) -> None:
        self.folder = root / "host"
        self.folder.mkdir()

    def file(self, name: str) -> Path:
        witness = self.folder / name
        witness.write_text(KEEP)
        return witness

    def tree(self) -> list[tuple[str, str]]:
        return sorted(
            (str(path.relative_to(self.folder)), path.read_text() if path.is_file() else "/")
            for path in self.folder.rglob("*")
        )


def config_file(root: Path, **values) -> Path:
    path = root / "config.json"
    path.write_text(json.dumps({"state": str(root / "state"), **values}))
    return path


class Mains(unittest.TestCase):
    """Each `main` locks its slot without emptying a linked host file."""

    CASES = (
        (switch, "NEL3AB_SWITCH_CONFIG", SWITCH_TITLE, ("initialise", "backup", "serve")),
        (switch2, "NEL3AB_SWITCH2_CONFIG", "0400486024dec000", ("launch", "backup")),
        (xbox, "NEL3AB_XBOX360_CONFIG", "534507d6", ("launch", "backup")),
    )

    def run_main(self, module, variable, title, stubs, root: Path, served: list):
        patches = [patch.object(module, name, lambda *a: None) for name in stubs]
        server = module if module is switch else module.room
        patches.append(patch.object(server, "serve", lambda *a: served.append(a)))
        argv = ["room", str(root / "game"), title, "neuve", str(root / "runtime")]
        with (
            patch.dict(os.environ, {variable: str(config_file(root, template="", engine=""))}),
            patch.object(module.sys, "argv", argv),
        ):
            for one in patches:
                one.start()
            try:
                module.main()
            finally:
                for one in patches:
                    one.stop()

    def test_a_linked_lock_is_refused_and_its_target_kept(self):
        for module, variable, title, stubs in self.CASES:
            with self.subTest(room=module.__name__), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                host = Host(root)
                witness = host.file("important")
                slot = root / "state" / title / "neuve"
                slot.mkdir(parents=True)
                (slot / "running.lock").symlink_to(witness)
                served: list = []
                with self.assertRaises(OSError):
                    self.run_main(module, variable, title, stubs, root, served)
                self.assertEqual(witness.read_text(), KEEP)
                self.assertEqual(served, [])

    def test_the_twin_an_ordinary_lock_from_yesterday_is_taken(self):
        for module, variable, title, stubs in self.CASES:
            with self.subTest(room=module.__name__), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                slot = root / "state" / title / "neuve"
                slot.mkdir(parents=True)
                (slot / "running.lock").write_text("yesterday\n")
                served: list = []
                self.run_main(module, variable, title, stubs, root, served)
                self.assertEqual(len(served), 1)
                self.assertEqual((slot / "running.lock").read_text(), "")


class SwitchSlot(unittest.TestCase):
    def slot(self, root: Path, name: str = "neuve") -> Path:
        slot = root / "state" / SWITCH_TITLE / name
        slot.mkdir(parents=True)
        return slot

    def test_a_save_link_is_copied_as_a_link_and_the_real_save_as_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            host, slot = Host(root), self.slot(root)
            host.file("secret")
            user = slot / "data/bis/user"
            (user / "save/1/0").mkdir(parents=True)
            (user / "save/1/0/save7.dat").write_bytes(b"my progress")
            (user / "link").symlink_to(host.folder)
            copy = switch.backup(slot)
            self.assertTrue((copy / "link").is_symlink())
            self.assertEqual((copy / "save/1/0/save7.dat").read_bytes(), b"my progress")

    def test_a_link_on_the_copy_path_is_refused_before_any_copy(self):
        for linked in ("data", "backups"):
            with self.subTest(link=linked), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                host, slot = Host(root), self.slot(root)
                host.file("secret")
                if linked == "data":
                    (host.folder / "bis/user").mkdir(parents=True)
                    (host.folder / "bis/user/key").write_text(KEEP)
                    (slot / "data").symlink_to(host.folder)
                else:
                    (slot / "data/bis/user").mkdir(parents=True)
                    (slot / "backups").symlink_to(host.folder)
                before = host.tree()
                with self.assertRaises(OSError):
                    switch.backup(slot)
                self.assertEqual(host.tree(), before)
                self.assertFalse((slot / "backups").is_dir() and linked == "data")

    def test_the_controller_profile_is_never_written_through_a_link(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            host, slot = Host(root), self.slot(root)
            witness = host.file("rc")
            profile = slot / "data/profiles/controller/nel3ab.json"
            profile.parent.mkdir(parents=True)
            profile.symlink_to(witness)
            with self.assertRaises(OSError):
                switch.ryubing_launch({}, root / "game.xci", slot)
            self.assertEqual(witness.read_text(), KEEP)
            # The twin: an ordinary profile from yesterday is replaced.
            profile.unlink()
            profile.write_text("yesterday")
            switch.ryubing_launch({}, root / "game.xci", slot)
            self.assertEqual(
                profile.read_bytes(), (switch.TOOLS / "ryubing-pro-controller.json").read_bytes()
            )

    def test_a_cache_reached_through_a_link_never_seeds_the_shared_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            host, slot = Host(root), self.slot(root)
            # Another slot of the same game whose `data` leads to the host.
            hosted = host.folder / "games" / SWITCH_TITLE / "cache/shader"
            hosted.mkdir(parents=True)
            (hosted / "host-file").write_bytes(b"h" * 900)
            other = slot.parent / "autre"
            other.mkdir()
            (other / "data").symlink_to(host.folder)
            # The twin: a real played slot, with a link of its own inside.
            real = slot.parent / "debloquee/data/games" / SWITCH_TITLE / "cache/shader"
            real.mkdir(parents=True)
            (real / "guest.data").write_bytes(b"x" * 10)
            (real / "inner-link").symlink_to(host.folder / "games")
            switch.cache_mounts(slot)
            shared = slot.parent / "cache"
            self.assertEqual((shared / "shader/guest.data").read_bytes(), b"x" * 10)
            self.assertFalse((shared / "shader/host-file").exists())
            self.assertTrue((shared / "shader/inner-link").is_symlink())


class Switch2Slot(unittest.TestCase):
    def slot(self, root: Path) -> Path:
        slot = root / "state/0400486024dec000/neuve"
        slot.mkdir(parents=True)
        return slot

    def test_the_configuration_is_never_written_through_a_link(self):
        for linked in ("emulator.ini", "home"):
            with self.subTest(link=linked), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                host, slot = Host(root), self.slot(root)
                witness = host.file("rc")
                (slot / linked).symlink_to(witness if linked == "emulator.ini" else host.folder)
                before = host.tree()
                with self.assertRaises(OSError):
                    switch2.configuration(slot)
                self.assertEqual(host.tree(), before)

    def test_the_twin_an_ordinary_configuration_is_written(self):
        with tempfile.TemporaryDirectory() as temp:
            slot = self.slot(Path(temp))
            (slot / "emulator.ini").write_text("yesterday")
            switch2.configuration(slot)
            self.assertIn("[Renderer]", (slot / "emulator.ini").read_text())
            self.assertTrue((slot / "home/.local/share/eden/nand").is_dir())

    def test_the_nand_copy_keeps_links_as_links(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            host, slot = Host(root), self.slot(root)
            witness = host.file("secret")
            nand = slot / switch2.NAND
            (nand / "user/save").mkdir(parents=True)
            (nand / "user/save/progress").write_bytes(b"progress")
            (nand / "link").symlink_to(host.folder)
            (slot / "emulator.ini").symlink_to(witness)
            copy = switch2.backup(slot)
            self.assertTrue((copy / "nand/link").is_symlink())
            self.assertTrue((copy / "emulator.ini").is_symlink())
            self.assertEqual((copy / "nand/user/save/progress").read_bytes(), b"progress")

    def test_a_link_on_the_nand_path_is_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            host, slot = Host(root), self.slot(root)
            (host.folder / ".local/share/eden/nand").mkdir(parents=True)
            (host.folder / ".local/share/eden/nand/key").write_text(KEEP)
            (slot / "home").symlink_to(host.folder)
            with self.assertRaises(OSError):
                switch2.backup(slot)
            self.assertFalse((slot / "backups").exists())


class SaveTool(unittest.TestCase):
    def slot(self, root: Path) -> Path:
        slot = root / "state" / SWITCH_TITLE / "neuve"
        container = slot / "data/bis/user/save/1"
        for bank in ("0", "1"):
            (container / bank).mkdir(parents=True)
            (container / bank / "save7.dat").write_bytes(b"my match")
        extra = bytearray(512)
        extra[0:8] = int(SWITCH_TITLE, 16).to_bytes(8, "little")
        extra[0x20] = 1
        (container / "ExtraData0").write_bytes(bytes(extra))
        return slot

    def test_a_restored_copy_keeps_its_links_as_links(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            host, slot = Host(root), self.slot(root)
            host.file("secret")
            # A copy the container itself left in `backups`, with a link inside.
            planted = slot / "backups/planted"
            planted.mkdir(parents=True)
            (planted / "link").symlink_to(host.folder)
            saves.restore(slot, "planted")
            self.assertTrue((slot / "data/bis/user/link").is_symlink())

    def test_the_import_receipt_is_never_written_through_a_link(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            host, slot = Host(root), self.slot(root)
            witness = host.file("rc")
            (slot / "import.json").symlink_to(witness)
            archive = root / "community.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("save.dat", b"unlocked")
                z.writestr("save7.dat", b"completed adventure")
            with self.assertRaises(OSError):
                saves.import_save(slot, SWITCH_TITLE, archive)
            self.assertEqual(witness.read_text(), KEEP)
            # The twin: an ordinary receipt is written.
            (slot / "import.json").unlink()
            saves.import_save(slot, SWITCH_TITLE, archive)
            self.assertEqual(json.loads((slot / "import.json").read_text())["title"], SWITCH_TITLE)

    def test_the_tool_lock_never_creates_a_linked_host_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            host, slot = Host(root), self.slot(root)
            (slot / "running.lock").symlink_to(host.folder / "created")
            argv = ["saves", str(config_file(root)), SWITCH_TITLE, "neuve", "backup"]
            with patch.object(sys, "argv", argv), self.assertRaises(OSError):
                saves.main()
            self.assertFalse((host.folder / "created").exists())


if __name__ == "__main__":
    unittest.main()
