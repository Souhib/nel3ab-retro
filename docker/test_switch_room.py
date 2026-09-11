"""No Docker or real saves: isolate the save-slot adapter's file operations."""

import fcntl
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "switch_room", Path(__file__).with_name("switch-room.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

saves_spec = importlib.util.spec_from_file_location(
    "switch_saves", Path(__file__).with_name("switch-saves.py")
)
saves = importlib.util.module_from_spec(saves_spec)
saves_spec.loader.exec_module(saves)


def account(slot, name, program, kind=1):
    """A save container as Ryubing writes it: its owner and type in ExtraData0."""
    container = slot / "data/bis/user/save" / name
    for bank in ("0", "1"):
        (container / bank).mkdir(parents=True)
    extra = bytearray(512)
    extra[0:8] = program.to_bytes(8, "little")
    extra[0x20] = kind
    (container / "ExtraData0").write_bytes(bytes(extra))
    return container


class SaveSlots(unittest.TestCase):
    def test_slots_start_separately_and_existing_progress_survives_initialisation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            template = root / "template"
            original = template / "bis/user/save/1/0/save7.dat"
            original.parent.mkdir(parents=True)
            original.write_bytes(b"template progression must not leak")
            (template / "Config.json").write_text("{}")
            (original.parent.parent / "ExtraData0").write_bytes(b"journal metadata")
            (original.parent.parent / "1").mkdir()
            first, second = root / "fresh", root / "unlocked"
            module.initialise(template, first)
            module.initialise(template, second)
            self.assertEqual(
                (first / "data/bis/user/save/1/ExtraData0").read_bytes(), b"journal metadata"
            )
            self.assertTrue((first / "data/bis/user/save/1/0").is_dir())
            self.assertEqual(list((first / "data/bis/user/save/1/0").iterdir()), [])
            save = first / "data/bis/user/save/1/0/save7.dat"
            save.parent.mkdir(parents=True, exist_ok=True)
            save.write_bytes(b"my progress")
            module.initialise(template, first)
            self.assertEqual(save.read_bytes(), b"my progress")
            self.assertFalse((second / "data/bis/user/save/1/0/save7.dat").exists())
            snapshot = module.backup(first)
            self.assertIsNotNone(snapshot)
            save.write_bytes(b"next match")
            self.assertEqual((snapshot / "save/1/0/save7.dat").read_bytes(), b"my progress")
            self.assertEqual(original.read_bytes(), b"template progression must not leak")

    def test_import_preserves_previous_progress_and_restore_rejects_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            slot = Path(temp)
            container = account(slot, "1", 0x0100BDE00862A000)
            for bank in ("0", "1"):
                (container / bank / "save7.dat").write_bytes(b"my match")
            archive = slot / "community.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("save.dat", b"unlocked")
                z.writestr("save7.dat", b"completed adventure")
            saves.import_save(slot, "0100bde00862a000", archive)
            for bank in ("0", "1"):
                self.assertEqual(
                    (container / bank / "save7.dat").read_bytes(), b"completed adventure"
                )
            copy = next((slot / "backups").iterdir())
            self.assertEqual((copy / "save/1/0/save7.dat").read_bytes(), b"my match")
            with self.assertRaises(ValueError):
                saves.restore(slot, "../outside")
            with self.assertRaises(ValueError):
                saves.restore(slot, "missing")
            saves.restore(slot, copy.name)
            self.assertEqual((container / "0/save7.dat").read_bytes(), b"my match")
            self.assertFalse((container / "0/save.dat").exists())
            count = len(list((slot / "backups").iterdir()))
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("../save7.dat", b"escape")
                z.writestr("save.dat", b"bad")
            with self.assertRaises(ValueError):
                saves.import_save(slot, "0100bde00862a000", archive)
            self.assertEqual(len(list((slot / "backups").iterdir())), count)
            self.assertEqual((container / "0/save7.dat").read_bytes(), b"my match")

    def test_configured_update_must_exist_in_the_container_mount(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            slot = root / "0100bde00862a000/neuve"
            metadata = slot / "data/games/0100bde00862a000/updates.json"
            metadata.parent.mkdir(parents=True)
            self.assertEqual(module.update_mount({}, slot), [])
            metadata.write_text(json.dumps({"selected": "/run-data/updates/tennis.nsp"}))
            with self.assertRaises(ValueError):
                module.update_mount({}, slot)
            updates = root / "updates"
            updates.mkdir()
            config = {"updates": str(updates)}
            with self.assertRaises(ValueError):
                module.update_mount(config, slot)
            (updates / "tennis.nsp").write_bytes(b"user supplied update")
            self.assertEqual(
                module.update_mount(config, slot), ["-v", f"{updates}:/run-data/updates:ro"]
            )
            metadata.write_text(json.dumps({"selected": "/run-data/updates/../private.nsp"}))
            with self.assertRaises(ValueError):
                module.update_mount(config, slot)

    def test_each_game_imports_only_what_was_checked_in_it(self):
        with tempfile.TemporaryDirectory() as temp:
            slot = Path(temp)
            # The template brings Mario Tennis' container into every slot.
            tennis = account(slot, "0000000000000001", 0x0100BDE00862A000)
            device = account(slot, "0000000000000003", 0x0100152000022000, kind=3)
            kart = account(slot, "0000000000000002", 0x0100152000022000)
            for bank in ("0", "1"):
                (kart / bank / "userdata.dat").write_bytes(b"fresh")
            archive = slot / "kart.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("100% save file/dump/userdata.dat", b"gold mario")
                z.writestr("100% save file/dump/rp001.dat", b"replay of a later version")
                z.writestr("100% save file/amiibo.jpg", b"picture")
            saves.import_save(slot, "0100152000022000", archive)
            for bank in ("0", "1"):
                self.assertEqual(sorted(p.name for p in (kart / bank).iterdir()), ["userdata.dat"])
                self.assertEqual((kart / bank / "userdata.dat").read_bytes(), b"gold mario")
                self.assertEqual(list((tennis / bank).iterdir()), [])
                self.assertEqual(list((device / bank).iterdir()), [])
            record = json.loads((slot / "import.json").read_text())
            self.assertEqual(record["title"], "0100152000022000")
            self.assertEqual(record["files"], ["userdata.dat"])

    def test_a_tree_import_keeps_its_folders_and_leaves_the_rest(self):
        with tempfile.TemporaryDirectory() as temp:
            slot = Path(temp)
            smash = account(slot, "0000000000000002", 0x01006A800016E000)
            (smash / "0/save_data").mkdir()
            (smash / "0/save_data/system_data.bin").write_bytes(b"fresh")
            archive = slot / "smash.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("__user__/save_data/system_data.bin", b"all spirits")
                z.writestr("__user__/save_data/mii/mii_1018.bin", b"a mii")
                z.writestr("__bcat__/directories.meta", b"online events")
            saves.import_save(slot, "01006a800016e000", archive)
            for bank in ("0", "1"):
                self.assertEqual(
                    sorted(str(p.relative_to(smash / bank)) for p in (smash / bank).rglob("*.bin")),
                    ["save_data/mii/mii_1018.bin", "save_data/system_data.bin"],
                )
            self.assertEqual((smash / "1/save_data/system_data.bin").read_bytes(), b"all spirits")
            self.assertFalse((slot / "import.pending").exists())

    def test_an_import_refuses_before_touching_the_slot(self):
        with tempfile.TemporaryDirectory() as temp:
            slot = Path(temp)
            archive = slot / "save.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("hs_save_data", b"shop")
            # Never started: no container for this game yet.
            account(slot, "0000000000000001", 0x0100BDE00862A000)
            with self.assertRaises(ValueError):
                saves.import_save(slot, "01006fe013472000", archive)
            party = account(slot, "0000000000000002", 0x01006FE013472000)
            (party / "0/hs_save_data").write_bytes(b"mine")
            # A game nobody checked a save for, even once started.
            account(slot, "0000000000000004", 0x0100D3601D4B4000)
            with self.assertRaises(ValueError):
                saves.import_save(slot, "0100d3601d4b4000", archive)
            refused = {
                "missing": {"other": b"x"},
                "twice": {"a/hs_save_data": b"x", "b/hs_save_data": b"y"},
            }
            for files in refused.values():
                with zipfile.ZipFile(archive, "w") as z:
                    for name, payload in files.items():
                        z.writestr(name, payload)
                with self.assertRaises(ValueError):
                    saves.import_save(slot, "01006fe013472000", archive)
            smash = account(slot, "0000000000000003", 0x01006A800016E000)
            for name in ("__user__/../escape.bin", "__user__//save.bin", "__user__/a\\b.bin"):
                with zipfile.ZipFile(archive, "w") as z:
                    z.writestr(name, b"x")
                with self.assertRaises(ValueError):
                    saves.import_save(slot, "01006a800016e000", archive)
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("__bcat__/only.bin", b"x")
            with self.assertRaises(ValueError):
                saves.import_save(slot, "01006a800016e000", archive)
            self.assertFalse((slot / "backups").exists())
            self.assertEqual((party / "0/hs_save_data").read_bytes(), b"mine")
            self.assertEqual(list((smash / "0").iterdir()), [])

    def test_add_on_content_must_exist_in_the_container_mount(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            slot = root / "01006a800016e000/neuve"
            listing = slot / "data/games/01006a800016e000/dlc.json"
            listing.parent.mkdir(parents=True)
            updates = root / "updates"
            (updates / "smash-dlc").mkdir(parents=True)
            config = {"updates": str(updates)}

            def lists(*paths):
                listing.write_text(
                    json.dumps(
                        [
                            {"path": path, "dlc_nca_list": [{"path": "/a.nca", "is_enabled": True}]}
                            for path in paths
                        ]
                    )
                )

            lists("/run-data/updates/smash-dlc/joker.nsp")
            with self.assertRaises(ValueError):
                module.update_mount(config, slot)
            (updates / "smash-dlc/joker.nsp").write_bytes(b"licence")
            # No update selected: the add-ons alone still need the folder.
            self.assertEqual(
                module.update_mount(config, slot), ["-v", f"{updates}:/run-data/updates:ro"]
            )
            with self.assertRaises(ValueError):
                module.update_mount({}, slot)
            for outside in ("/run-data/updates/../joker.nsp", "/home/joker.nsp"):
                lists("/run-data/updates/smash-dlc/joker.nsp", outside)
                with self.assertRaises(ValueError):
                    module.update_mount(config, slot)

    def test_both_slots_share_one_cache_per_game_and_keep_the_fullest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            title = "01006a800016e000"
            fresh, unlocked = root / title / "neuve", root / title / "debloquee"
            # Two slots already played: each has its own shader and driver caches.
            for slot, size in ((fresh, 10), (unlocked, 300)):
                shader = slot / "data/games" / title / "cache/shader"
                shader.mkdir(parents=True)
                (shader / "guest.data").write_bytes(b"x" * size)
                mesa = slot / "home/.cache/mesa_shader_cache"
                mesa.mkdir(parents=True)
                (mesa / "index").write_bytes(b"y" * size)
            mounts = module.cache_mounts(fresh)
            shared, driver = root / title / "cache", root / title / "mesa"
            self.assertEqual(
                mounts,
                [
                    "-v",
                    f"{shared}:/run-data/data/games/{title}/cache",
                    "-v",
                    f"{driver}:/run-data/home/.cache/mesa_shader_cache",
                ],
            )
            # The fullest cache of the two seeds the shared one, once.
            self.assertEqual((shared / "shader/guest.data").read_bytes(), b"x" * 300)
            self.assertEqual((driver / "index").read_bytes(), b"y" * 300)
            (shared / "shader/guest.data").write_bytes(b"z" * 400)
            module.cache_mounts(unlocked)
            self.assertEqual((shared / "shader/guest.data").read_bytes(), b"z" * 400)
            # A slot that never ran still gets the mounts, and the shared cache.
            other = root / title / "autre"
            module.cache_mounts(other)
            self.assertTrue((shared / "shader").is_dir())
            # Docker must not create these mount points itself, as root.
            self.assertTrue((other / "data/games" / title / "cache").is_dir())
            self.assertTrue((other / "home/.cache/mesa_shader_cache").is_dir())

    def test_live_slot_refuses_even_a_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config = root / "config.json"
            config.write_text(json.dumps({"state": str(root)}))
            slot = root / "0100bde00862a000/neuve"
            slot.mkdir(parents=True)
            with (slot / "running.lock").open("w") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with (
                    patch.object(
                        sys, "argv", ["saves", str(config), "0100bde00862a000", "neuve", "backup"]
                    ),
                    self.assertRaises(SystemExit) as error,
                ):
                    saves.main()
                self.assertEqual(error.exception.code, 2)
            self.assertFalse((slot / "backups").exists())

    def test_emulator_still_stops_after_capture_wait_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            capture = Mock()
            capture.wait.side_effect = TimeoutError("stuck exec")
            with (
                patch.object(module, "run", return_value=Mock(stdout='{"ExitCode":0}')) as run,
                patch.object(module.subprocess, "run"),
                self.assertRaises(TimeoutError),
            ):
                module.stop_engine("owned-container", Path(temp), capture)
            commands = [call.args for call in run.call_args_list]
            self.assertIn(("docker", "stop", "--timeout", "40", "owned-container"), commands)
            self.assertIn(("docker", "rm", "owned-container"), commands)
            self.assertNotIn(("docker", "rm", "other-container"), commands)


class EngineEnvironment(unittest.TestCase):
    def test_the_room_rate_reaches_the_engine_and_sixty_is_the_default(self):
        self.assertIn("SWITCH_REFRESH_HZ=60", module.engine_environment({}))
        self.assertIn("SWITCH_REFRESH_HZ=120", module.engine_environment({"refresh_hz": 120}))

    def test_the_engine_reads_which_seats_are_taken(self):
        # The worker writes the taken seats to <pads>/seats, mounted at /pads.
        self.assertIn("NEL3AB_SEATS_FILE=/pads/seats", module.engine_environment({}))

    def test_the_held_front_buffer_is_off_unless_the_room_turns_it_on(self):
        self.assertNotIn("NEL3AB_HOLD_FRONT_BUFFER=1", module.engine_environment({}))
        self.assertNotIn(
            "NEL3AB_HOLD_FRONT_BUFFER=1", module.engine_environment({"hold_front_buffer": False})
        )
        self.assertIn(
            "NEL3AB_HOLD_FRONT_BUFFER=1", module.engine_environment({"hold_front_buffer": True})
        )

    def test_the_held_front_buffer_accepts_only_true_or_false(self):
        # "true" in quotes or 1 must name the mistake rather than guess.
        for bad in ("true", 1, 0, None, "on"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                module.engine_environment({"hold_front_buffer": bad})

    def test_a_bad_rate_stops_the_room_before_any_container_starts(self):
        # Refused rather than clamped or cast: "120" in quotes, 59.94 or true
        # in switch.json must name the mistake, not run at another rate.
        for bad in (0, 29, 241, "120", 59.94, True, None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                module.engine_environment({"refresh_hz": bad})
        with (
            tempfile.TemporaryDirectory() as temp,
            patch.object(module, "run") as run,
            self.assertRaises(ValueError),
        ):
            root = Path(temp)
            module.serve({"image": "unused", "refresh_hz": 0}, root / "game.xci", root, root)
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
