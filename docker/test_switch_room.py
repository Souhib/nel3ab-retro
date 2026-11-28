"""No Docker or real saves: isolate the save-slot adapter's file operations."""

import contextlib
import fcntl
import importlib.util
import itertools
import json
import os
import re
import subprocess
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


class CpuPinning(unittest.TestCase):
    def test_no_pinning_unless_the_room_asks_for_it(self):
        # Le défaut est la machine entière: une salle bridée sur trop peu de
        # cœurs irait PLUS mal, et rien n'est mesuré à ce jour.
        self.assertEqual(module.cpu_pinning({}), [])
        self.assertEqual(module.cpu_pinning({"cpuset": None}), [])

    def test_the_asked_cores_reach_docker(self):
        self.assertEqual(module.cpu_pinning({"cpuset": "0-2,6-8"}), ["--cpuset-cpus", "0-2,6-8"])
        self.assertEqual(module.cpu_pinning({"cpuset": " 0-3 "}), ["--cpuset-cpus", "0-3"])

    def test_the_example_it_gives_keeps_one_level_three_cache(self):
        # /sys/devices/system/cpu/cpu*/cache/index3/shared_cpu_list, read on
        # 2026-11-27 on this Ryzen 5 3600: two blocks of three cores and their
        # twins, 16 MiB of L3 each. "0-3,6-9" took four cores across both.
        caches = ({0, 1, 2, 6, 7, 8}, {3, 4, 5, 9, 10, 11})

        def cores(text):
            chosen = set()
            for part in text.split(","):
                first, _, last = part.partition("-")
                chosen.update(range(int(first), int(last or first) + 1))
            return chosen

        with self.assertRaises(ValueError) as refused:
            module.cpu_pinning({"cpuset": ""})
        examples = re.findall(r'"([0-9][0-9,-]*)"', str(refused.exception))
        examples += re.findall(r'"([0-9][0-9,-]*)"', module.cpu_pinning.__doc__)
        self.assertEqual(len(examples), 2, examples)
        for example in examples:
            with self.subTest(example=example):
                self.assertTrue(any(cores(example) <= cache for cache in caches), example)
        # The twin: the guard sees an example that crosses both caches.
        self.assertFalse(any(cores("0-3,6-9") <= cache for cache in caches))

    def test_a_cpuset_that_is_not_one_names_the_mistake(self):
        # Sans ce refus, `true` ou une liste deviendraient un conteneur lancé
        # sans épinglage, et la mesure comparerait deux fois la même chose.
        for bad in (True, 3, [0, 1], "", "   "):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                module.cpu_pinning({"cpuset": bad})


class RyubingCollector(unittest.TestCase):
    """ADR D56: a workstation collection stopped Smash 837 ms on 2026-11-28."""

    def launch_environment(self, config: dict) -> list[str]:
        with tempfile.TemporaryDirectory() as temp:
            slot = Path(temp)
            return module.ryubing_launch(config, slot / "game.nsp", slot).environment

    def test_ryubing_runs_the_server_collector_with_four_unpinned_heaps_by_default(self):
        environment = self.launch_environment({})
        for value in ("DOTNET_gcServer=1", "DOTNET_GCHeapCount=4", "DOTNET_GCNoAffinitize=1"):
            with self.subTest(value=value):
                self.assertIn(value, environment)
                self.assertEqual(environment[environment.index(value) - 1], "-e")
        self.assertEqual(self.launch_environment({"garbage_collector": "server"}), environment)

    def test_the_twin_the_workstation_collector_sets_no_dotnet_variable(self):
        # The way back without a code change: "garbage_collector": "workstation".
        environment = self.launch_environment({"garbage_collector": "workstation"})
        self.assertFalse([value for value in environment if value.startswith("DOTNET_")])
        self.assertIn("NEL3AB_SEATS_FILE=/pads/seats", environment)

    def test_the_twin_eden_and_xenia_share_no_dotnet_variable(self):
        # switch2-room.py and xbox360-room.py build their engines from
        # engine_environment: neither emulator runs on .NET.
        environment = module.engine_environment({"garbage_collector": "server"})
        self.assertFalse([value for value in environment if value.startswith("DOTNET_")])

    def test_the_collector_accepts_only_its_two_names_before_any_file_is_written(self):
        for bad in ("Server", "WORKSTATION", "", True, 1, None, ["server"]):
            with (
                self.subTest(bad=bad),
                tempfile.TemporaryDirectory() as temp,
                self.assertRaises(ValueError),
            ):
                slot = Path(temp)
                try:
                    module.ryubing_launch({"garbage_collector": bad}, slot / "game.nsp", slot)
                finally:
                    self.assertFalse((slot / "data").exists())


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


def option(command, name):
    """The value that follows `name` in an argument list, which must hold it once."""
    positions = [position for position, value in enumerate(command) if value == name]
    if len(positions) != 1:
        raise AssertionError(f"{name} appears {len(positions)} times in {command}")
    return command[positions[0] + 1]


class EngineSettings(unittest.TestCase):
    """Ryubing without a window reads only its command line (RYU-5, 2026-11-27).

    HeadlessRyujinx.cs:148-151 calls InheritMainConfig only with
    --use-main-config, so Config.json never set vsync, threading or memory.
    The defaults below are what the engine logged on 2026-11-26.
    """

    def launch(self, **config):
        with tempfile.TemporaryDirectory() as temp:
            slot = Path(temp) / "state/0100abcdef012000/neuve"
            slot.mkdir(parents=True)
            return module.ryubing_launch(config, Path("/roms/jeu.xci"), slot).command

    def test_the_engine_settings_in_effect_today_are_written_on_its_command_line(self):
        command = self.launch()
        self.assertEqual(option(command, "--vsync-mode"), "Switch")
        # Auto, which Vulkan turns into threaded (VulkanRenderer.cs:111).
        self.assertEqual(option(command, "--backend-threading"), "Auto")
        self.assertEqual(option(command, "--memory-manager-mode"), "HostMapped")
        # Thirteen saved Config.json files have drifted (versions 70 and 73).
        self.assertNotIn("--use-main-config", command)

    def test_each_setting_comes_from_the_room_configuration(self):
        command = self.launch(
            vsync_mode="Unbounded", backend_threading="On", memory_manager_mode="SoftwarePageTable"
        )
        self.assertEqual(option(command, "--vsync-mode"), "Unbounded")
        self.assertEqual(option(command, "--backend-threading"), "On")
        self.assertEqual(option(command, "--memory-manager-mode"), "SoftwarePageTable")

    def test_an_unknown_value_stops_the_room_before_any_container_starts(self):
        # The engine's parser is case sensitive (Parser.Default): "on" would be
        # refused by Ryubing after Docker started, or worse, read as another mode.
        for key, bad in (
            ("vsync_mode", "switch"),
            ("vsync_mode", 60),
            # A real engine value, refused until the room owns its refresh rate.
            ("vsync_mode", "Custom"),
            ("backend_threading", "on"),
            ("backend_threading", True),
            ("memory_manager_mode", "HostMappedSafe"),
            ("memory_manager_mode", None),
        ):
            with self.subTest(key=key, bad=bad), self.assertRaisesRegex(ValueError, key):
                self.launch(**{key: bad})

        def started(*args, **_kwargs):
            # Fails at the first command, by name: a mock that answered would
            # leave serve waiting ten seconds for virtual controllers instead.
            raise AssertionError(f"{' '.join(map(str, args[:5]))} ran before the refusal")

        with (
            tempfile.TemporaryDirectory() as temp,
            patch.object(module, "run", side_effect=started) as run,
            self.assertRaisesRegex(ValueError, "backend_threading"),
        ):
            root = Path(temp)
            slot = root / "0100abcdef012000/neuve"
            slot.mkdir(parents=True)
            module.serve(
                {"image": "unused", "backend_threading": "on"}, root / "game.xci", slot, root
            )
        run.assert_not_called()


def clock(text):
    """Seconds since midnight for an "HH:MM:SS.ffffff" of the worker's journal."""
    hours, minutes, seconds = text.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


#: The 36 « no complete packet for 30.0 seconds » of the Xbox 360 room on
#: 2026-11-21 (journalctl -u nel3ab-worker@1, read on 2026-11-27), when Xenia
#: stopped presenting. No « frames » line between them; a person stopped the
#: room at 20:59:55. Each restart received one packet, the compositor's copy.
FROZEN_2026_11_21 = [
    clock(at)
    for at in (
        "20:38:40.602267",
        "20:39:15.902472",
        "20:39:51.503471",
        "20:40:27.110992",
        "20:41:02.725294",
        "20:41:38.334400",
        "20:42:13.940877",
        "20:42:49.540648",
        "20:43:25.159598",
        "20:44:00.800838",
        "20:44:36.408210",
        "20:45:07.804758",
        "20:45:44.498378",
        "20:46:20.151915",
        "20:46:55.765785",
        "20:47:31.379910",
        "20:48:06.989123",
        "20:48:42.618373",
        "20:49:18.242601",
        "20:49:53.842745",
        "20:50:29.460562",
        "20:51:05.055831",
        "20:51:40.691861",
        "20:52:16.304077",
        "20:52:51.907856",
        "20:53:27.533537",
        "20:54:03.154191",
        "20:54:38.771606",
        "20:55:14.394635",
        "20:55:50.006204",
        "20:56:25.625083",
        "20:57:01.238105",
        "20:57:36.861575",
        "20:58:12.518657",
        "20:58:48.363684",
        "20:59:23.833567",
    )
]


class CaptureRestarts(unittest.TestCase):
    """CAP-7: the rule « three failures in one minute » never saw a slow loop."""

    BLANK = module.CaptureRestarts.NOTHING_SHOWN
    SHOWN = module.CaptureRestarts.SHOWN_THEN_FAILED

    def replay(self, first, endings):
        """The first start, then each (time, exit status) the room saw; the refusal."""
        restarts = module.CaptureRestarts()
        self.assertIsNone(restarts.refused(first, None))
        for at, status in endings:
            refused = restarts.refused(at, status)
            if refused is not None:
                return at, refused
        return None

    def test_the_loop_of_2026_11_21_is_stopped_at_its_third_restart(self):
        self.assertEqual(len(FROZEN_2026_11_21), 36)
        gaps = [b - a for a, b in itertools.pairwise(FROZEN_2026_11_21)]
        self.assertTrue(all(31 < gap < 37 for gap in gaps), "two restarts a minute at most")
        # The first capture had sent the game for a minute: it exits
        # SHOWN_THEN_FAILED. Every later one sent nothing but the compositor's copy.
        endings = [(FROZEN_2026_11_21[0], self.SHOWN)]
        endings += [(at, self.BLANK) for at in FROZEN_2026_11_21[1:]]
        verdict = self.replay(clock("20:37:25"), endings)
        self.assertIsNotNone(verdict, "36 restarts and the rule never fired")
        self.assertEqual(verdict[0], FROZEN_2026_11_21[2])
        self.assertIn("without a game picture", verdict[1])

    def test_the_twin_a_first_launch_four_minutes_long_then_pictures_restarts_freely(self):
        # Mario Tennis rebuilt its translation cache for 4 minutes on its first
        # launch (carnet). Each capture then ends at its 90 s start limit.
        endings = [(90.5, self.BLANK), (181.0, self.BLANK), (271.5, self.BLANK)]
        # Then pictures, and much later one ordinary failure in the game.
        endings += [(4000.0, self.SHOWN)]
        self.assertIsNone(self.replay(0.0, endings))

    def test_the_twin_restarts_with_game_pictures_between_them_are_not_a_loop(self):
        endings = [(at, self.SHOWN) for at in (100.0, 200.0, 300.0, 400.0, 500.0)]
        self.assertIsNone(self.replay(0.0, endings))
        # Nor blank restarts each separated from the next by pictures.
        endings = [(100.0, self.SHOWN), (200.0, self.BLANK), (300.0, self.SHOWN)]
        endings += [(400.0, self.BLANK), (500.0, self.SHOWN), (600.0, self.BLANK)]
        self.assertIsNone(self.replay(0.0, endings))

    def test_a_capture_that_dies_at_once_still_stops_at_its_third_failure_in_a_minute(self):
        verdict = self.replay(0.0, [(1.0, 1), (2.0, 1), (3.0, 1)])
        self.assertEqual(verdict, (3.0, "Capture failed three times in one minute"))
        # The same three failures spread over more than a minute pass.
        self.assertIsNone(self.replay(0.0, [(30.0, 1), (60.0, 1), (90.0, 1)]))

    def test_an_unknown_ending_breaks_a_series_so_the_room_is_never_stopped_by_doubt(self):
        # docker exec's own failures (125 to 127), a signal, python3's own crash.
        restarts = module.CaptureRestarts()
        self.assertIsNone(restarts.refused(0.0, None))
        self.assertIsNone(restarts.refused(100.0, self.SHOWN))
        for at, status in (
            (200.0, self.BLANK),
            (300.0, 125),
            (400.0, self.BLANK),
            (500.0, -9),
            (600.0, self.BLANK),
            (700.0, 1),
            (800.0, self.BLANK),
        ):
            self.assertIsNone(restarts.refused(at, status), status)
        # The twin: two blank endings in a row are still the loop.
        self.assertIsNotNone(restarts.refused(900.0, self.BLANK))

    def test_a_doubt_before_the_first_picture_never_arms_the_loop(self):
        # A first launch of 4 minutes without a picture (Mario Tennis), whose
        # first capture ended on a doubt: docker exec's own failure (125), a
        # signal (137, -9), or python3's own crash before any picture (1).
        # None of them proves a game picture, so the 90 s restarts go on.
        for doubt in (1, 125, 137, -9):
            with self.subTest(doubt=doubt):
                endings = [(1.0, doubt), (91.5, self.BLANK), (182.0, self.BLANK)]
                endings += [(272.5, self.BLANK)]
                self.assertIsNone(self.replay(0.0, endings))


class Host(contextlib.ExitStack):
    """A fake Docker and a fake clock around the real `serve`.

    Every docker command is recorded with its keyword arguments. Time moves
    only when the room waits (its selector or time.sleep). A capture lives
    `capture_life` seconds, then ends with the next of `statuses`; a capture
    beyond them is a failure of the test, never an endless room. `stdin_after`
    is when the worker closes stdin, None for never.
    """

    RENDER = "/dev/dri/renderD128"

    def __init__(
        self,
        statuses=(),
        capture_life=40.0,
        stdin_after=None,
        logs_fail=False,
        engine_stops_at=None,
        wait_fails_at=None,
    ):
        super().__init__()
        self.statuses = list(statuses)
        self.capture_life = capture_life
        self.stdin_after = stdin_after
        self.logs_fail = logs_fail
        # When the engine container stops, and when the first `docker wait`
        # client fails on its own while the engine still runs (None: never).
        self.engine_stops_at = engine_stops_at
        self.wait_fails_at = wait_fails_at
        self.wait_clients = []
        #: Containers Docker already knows, and the value of their room label.
        self.known = {}
        self.now = 1000.0
        self.commands = []

    def __enter__(self):
        super().__enter__()
        root = Path(self.enter_context(tempfile.TemporaryDirectory()))
        self.slot = root / "state/0100abcdef012000/neuve"
        self.slot.mkdir(parents=True)
        self.pads = root / "salles/1/room-switch-test"
        self.pads.mkdir(parents=True)
        self.root = root
        real_stat = os.stat
        host = self

        def stat(path, *args, **kwargs):
            if os.fspath(path) == self.RENDER:
                return os.stat_result((0o20660, 0, 0, 1, 0, 44, 0, 0, 0, 0))
            return real_stat(path, *args, **kwargs)

        class Capture:
            def __init__(self, status):
                self.status, self.until = status, host.now + host.capture_life

            def poll(self):
                return None if host.now < self.until else self.status

            def wait(self, timeout=None):
                return self.status

        class WaitClient:
            """`docker wait`: returns when the engine stops, or fails on its own."""

            def __init__(self):
                self.killed = self.reaped = False

            def poll(self):
                if self.killed:
                    return -9
                if host.engine_stopped():
                    return 0
                first = host.wait_clients and host.wait_clients[0] is self
                if first and host.wait_fails_at is not None and host.now >= host.wait_fails_at:
                    return 1
                return None

            def kill(self):
                self.killed = True

            def wait(self, timeout=None):
                self.reaped = True
                return self.poll()

        def popen(argv, **_kwargs):
            self.commands.append(("Popen", list(argv), {}))
            if list(argv[:2]) == ["/usr/bin/docker", "wait"]:
                client = WaitClient()
                self.wait_clients.append(client)
                return client
            if not self.statuses:
                raise AssertionError(f"capture number {self.started()} was started")
            return Capture(self.statuses.pop(0))

        class Selector:
            def register(self, *_args, **_kwargs):
                return None

            def select(self, timeout=None):
                if host.stdin_after is not None and host.now >= host.stdin_after:
                    return [("stdin", 1)]
                host.now += timeout or 0
                return []

            def close(self):
                return None

        self.enter_context(patch.object(module, "run", self.run))
        self.enter_context(patch.object(module.subprocess, "run", self.run_list))
        self.enter_context(patch.object(module.subprocess, "Popen", popen))
        self.enter_context(patch.object(module.selectors, "DefaultSelector", Selector))
        self.enter_context(patch.object(module.time, "monotonic", lambda: self.now))
        self.enter_context(patch.object(module.time, "sleep", self.sleep))
        self.enter_context(patch.object(module.os, "stat", stat))
        return self

    def sleep(self, seconds):
        self.now += seconds

    def started(self):
        """The captures started, `docker wait` clients left out."""
        return sum(
            1
            for kind, argv, _options in self.commands
            if kind == "Popen" and argv[:2] != ["/usr/bin/docker", "wait"]
        )

    def engine_stopped(self):
        return self.engine_stops_at is not None and self.now >= self.engine_stops_at

    def running_checks(self):
        """Every `docker inspect` that asked whether the engine runs."""
        return [
            argv
            for kind, argv, _options in self.commands
            if kind == "run" and argv[:4] == ["docker", "inspect", "-f", "{{.State.Running}}"]
        ]

    def run_list(self, argv, **kwargs):
        return self.run(*argv, **kwargs)

    def run(self, *args, **kwargs):
        self.commands.append(("run", list(args), kwargs))
        stdout = ""
        if args[:2] == ("docker", "run") and "/probe/pads.py" in args:
            devices = [f"/dev/input/event{n}" for n in range(4)]
            (self.pads / "devices.json").write_text(json.dumps(devices))
        elif args[:2] == ("docker", "run"):
            (self.slot / "display.json").write_text('{"display": "wayland-1"}')
        elif args[:4] == ("docker", "inspect", "-f", "{{.State.Running}}"):
            stdout = "false\n" if self.engine_stopped() else "true\n"
        elif args[:2] == ("docker", "ps"):
            wanted = args[args.index("--filter") + 1]
            stdout = "".join(
                f"{name}\n"
                for name, root in self.known.items()
                if wanted in (f"label=nel3ab.room-root={root}", "label=nel3ab.room-root")
            )
        elif args[:2] == ("docker", "logs"):
            stream = kwargs.get("stdout")
            if self.logs_fail and not args[-1].endswith("-pads"):
                # docker logs writes its reason on stderr: it reaches the file
                # only if the room sends stderr there.
                if kwargs.get("stderr") is subprocess.STDOUT:
                    stream.write(f"Error response from daemon: No such container: {args[-1]}\n")
                raise subprocess.CalledProcessError(1, list(args))
            stream.write(f"journal de {args[-1]}\n")
        return subprocess.CompletedProcess(list(args), 0, stdout, "")

    def serve(self, config=None):
        launch = module.EngineLaunch(environment=[], mounts=[], command=["true"], controllers=4)
        config = {"image": "sha256:essai", "engine": str(self.root), **(config or {})}
        rom = self.root / "jeu.xci"
        module.serve(config, rom, self.slot, self.pads, launch, lambda _slot: None)


class ServeRestarts(unittest.TestCase):
    """The wiring: `serve` hands each capture's exit status to CaptureRestarts."""

    BLANK = module.CaptureRestarts.NOTHING_SHOWN
    SHOWN = module.CaptureRestarts.SHOWN_THEN_FAILED

    def test_a_frozen_game_is_given_up_at_the_third_failure_without_a_picture(self):
        with (
            Host(statuses=[self.SHOWN, self.BLANK, self.BLANK]) as host,
            self.assertRaisesRegex(RuntimeError, "without a game picture"),
        ):
            host.serve()
        self.assertEqual(host.started(), 3)

    def test_the_twin_a_long_first_start_keeps_restarting(self):
        # Three blank captures before any picture, then the game: a fourth start.
        with (
            Host(statuses=[self.BLANK, self.BLANK, self.BLANK]) as host,
            self.assertRaisesRegex(AssertionError, "capture number 4 was started"),
        ):
            host.serve()


class EngineWatchCost(unittest.TestCase):
    """MACH-2: the room learns that its engine stopped from one `docker wait`.

    Until 2026-11-27 it asked `docker inspect` at each turn of its loop, about
    twice a second for a whole game: two docker clients a second, about 7 % of
    one core measured during a game.
    """

    def test_a_minute_of_play_asks_docker_inspect_nothing(self):
        with Host(statuses=[None], capture_life=1e9, stdin_after=1060.0) as host:
            host.serve()
        self.assertGreaterEqual(host.now, 1060.0)
        self.assertEqual(host.running_checks(), [])
        self.assertEqual(len(host.wait_clients), 1)

    def test_the_twin_a_stopped_engine_still_ends_the_room_within_a_turn(self):
        with (
            Host(statuses=[None], capture_life=1e9, engine_stops_at=1010.0) as host,
            self.assertRaisesRegex(RuntimeError, "Switch emulator exited"),
        ):
            host.serve()
        # One turn of the loop is 0.5 s: the stop is seen at the next turn.
        self.assertLessEqual(host.now - 1010.0, 0.5)
        self.assertEqual(len(host.running_checks()), 1)

    def test_a_wait_client_that_fails_alone_is_replaced_and_the_game_goes_on(self):
        with Host(
            statuses=[None], capture_life=1e9, stdin_after=1030.0, wait_fails_at=1005.0
        ) as host:
            host.serve()
        self.assertGreaterEqual(host.now, 1030.0)
        self.assertEqual(len(host.wait_clients), 2)
        self.assertEqual(len(host.running_checks()), 1)

    def test_the_wait_client_ends_with_the_room(self):
        with Host(statuses=[None], capture_life=1e9, stdin_after=1005.0) as host:
            host.serve()
        (client,) = host.wait_clients
        self.assertTrue(client.killed)
        self.assertTrue(client.reaped)


class RoomOrphans(unittest.TestCase):
    """A killed adapter's containers stop before a new game touches any slot.

    On 2026-11-27 a bench room whose adapter died with its session kept its
    emulator running six hours: the containers live under dockerd, and the
    slot lock died with the adapter. A new game on that slot would have
    started beside an emulator still writing its saves.
    """

    OLD = "nel3ab-switch-room-switch-ancien"
    NEIGHBOUR = "nel3ab-switch-room-switch-voisin"

    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.root = self.tmp / "salles/1"
        self.pads = self.root / "room-switch-neuf"
        self.pads.mkdir(parents=True)
        self.other = self.tmp / "salles/2"
        self.commands = []
        #: The containers Docker knows, and the value of their room label.
        self.known = {}

    def docker(self, argv, **_kwargs):
        argv = [str(a) for a in argv]
        self.commands.append(argv)
        out = ""
        if argv[:2] == ["docker", "ps"]:
            # As strict as the real one: only the label value asked for.
            # `label=key` lists every container carrying the key, as Docker does.
            wanted = argv[argv.index("--filter") + 1]
            out = "".join(
                f"{name}\n"
                for name, root in self.known.items()
                if wanted in (f"label=nel3ab.room-root={root}", "label=nel3ab.room-root")
            )
        return subprocess.CompletedProcess(argv, 0, out, "")

    def held(self):
        with (
            patch.object(module, "run", lambda *a, **k: self.docker(a, **k)),
            patch.object(module.subprocess, "run", lambda argv, **k: self.docker(argv, **k)),
            module.room_held(self.pads),
        ):
            pass

    def named(self, name):
        return [argv for argv in self.commands if name in argv or f"{name}-pads" in argv]

    def test_a_killed_adapter_s_engine_stops_first_then_its_pads(self):
        self.known = {
            self.OLD: self.root,
            f"{self.OLD}-pads": self.root,
            self.NEIGHBOUR: self.other,
            f"{self.NEIGHBOUR}-pads": self.other,
        }
        self.held()
        self.assertEqual(
            [argv for argv in self.commands if argv[:2] != ["docker", "ps"]],
            [
                [
                    "/usr/bin/docker",
                    "exec",
                    self.OLD,
                    "python3",
                    "/probe/capture_control.py",
                    "stop",
                ],
                ["docker", "stop", "--timeout", "40", self.OLD],
                ["docker", "stop", "--timeout", "5", f"{self.OLD}-pads"],
                ["docker", "rm", self.OLD],
                ["docker", "rm", f"{self.OLD}-pads"],
            ],
        )

    def test_the_twin_another_room_s_containers_are_never_touched(self):
        self.known = {self.NEIGHBOUR: self.other, f"{self.NEIGHBOUR}-pads": self.other}
        self.held()
        self.assertEqual(self.named(self.NEIGHBOUR), [])
        self.assertEqual([argv[:2] for argv in self.commands], [["docker", "ps"]])

    def test_a_live_adapter_keeps_its_room_and_the_new_one_refuses(self):
        self.known = {self.OLD: self.root, f"{self.OLD}-pads": self.root}
        with open(self.root / module.ROOM_LOCK, "w") as other:
            fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, "Another adapter still runs room"):
                self.held()
        self.assertEqual(self.commands, [])

    def test_the_room_lock_frees_when_its_adapter_ends(self):
        self.held()
        self.held()
        self.assertEqual(len(self.commands), 2)

    def test_serve_stops_the_orphans_before_its_first_container(self):
        old = "nel3ab-switch-room-switch-ancien"
        with Host(statuses=[None], capture_life=1e9, stdin_after=1001.0) as host:
            host.known = {old: host.pads.parent, f"{old}-pads": host.pads.parent}
            host.serve()
        argv = [a for kind, a, _o in host.commands if kind == "run"]
        self.assertIn(["docker", "rm", f"{old}-pads"], argv)
        removed = argv.index(["docker", "rm", f"{old}-pads"])
        first_run = next(i for i, a in enumerate(argv) if a[:2] == ["docker", "run"])
        self.assertLess(removed, first_run)

    def test_the_twin_a_refused_plan_runs_no_docker_command(self):
        launch = module.EngineLaunch(environment=[], mounts=[], command=["true"], controllers=2)
        with Host() as host:
            host.known = {"nel3ab-switch-room-switch-ancien": host.pads.parent}
            config = {"image": "sha256:essai", "engine": str(host.root)}
            with self.assertRaisesRegex(ValueError, "one or four controllers"):
                module.serve(
                    config, host.root / "jeu.xci", host.slot, host.pads, launch, lambda _s: None
                )
        self.assertEqual(host.commands, [])


class EngineLog(unittest.TestCase):
    """RYU-4: Ryubing dates its lines from a stopwatch reset at launch.

    Only the file name gave the absolute hour, to the second; the black box's
    copy, taken with --timestamps, placed each line (2026-11-26). The room's
    copy at the end of a game now asks Docker for its hour too.
    """

    def engine_logs(self, host):
        return [
            (argv, options)
            for kind, argv, options in host.commands
            if kind == "run" and argv[:2] == ["docker", "logs"] and not argv[-1].endswith("-pads")
        ]

    def test_the_engine_log_is_copied_with_docker_s_hour_on_each_line(self):
        with Host(statuses=[None], capture_life=1e9, stdin_after=1005.0) as host:
            host.serve()
            ((argv, options),) = self.engine_logs(host)
            self.assertIn("--timestamps", argv)
            self.assertEqual(argv[-1], "nel3ab-switch-room-switch-test")
            self.assertIs(options["stderr"], subprocess.STDOUT)
            self.assertEqual(
                (host.slot / "emulator.log").read_text(),
                "journal de nel3ab-switch-room-switch-test\n",
            )

    def test_the_twin_a_failed_copy_leaves_its_reason_in_the_file(self):
        with Host(statuses=[None], capture_life=1e9, stdin_after=1005.0, logs_fail=True) as host:
            with self.assertRaises(subprocess.CalledProcessError):
                host.serve()
            text = (host.slot / "emulator.log").read_text()
            self.assertIn("No such container: nel3ab-switch-room-switch-test", text)
            # The container is removed even so.
            self.assertIn(
                ["docker", "rm", "nel3ab-switch-room-switch-test"],
                [argv for _kind, argv, _options in host.commands],
            )


UNIT = Path(__file__).resolve().parents[1] / "deploy/nel3ab-cpu-performance.service"


def governors_written(unit_text):
    """Each governor that an Exec line of the unit echoes into scaling_governor."""
    written = []
    for line in unit_text.splitlines():
        if line.startswith(("ExecStart=", "ExecStop=")) and "scaling_governor" in line:
            written += re.findall(r"echo ([a-z]+) > ", line)
    return written


def governors_refused(unit_text, available):
    return [governor for governor in governors_written(unit_text) if governor not in available]


class CpuGovernorUnit(unittest.TestCase):
    """MACH-13: amd-pstate-epp offers performance and powersave only.

    Since the 7.0 kernel (2026-09-14) the driver refused the schedutil written
    by ExecStop, and the stop failed (« echo: I/O error », 2026-10-14 12:40).
    """

    def available(self):
        cpus = Path("/sys/devices/system/cpu")
        nodes = sorted(cpus.glob("cpu*/cpufreq/scaling_available_governors"))
        # A precondition, not a branch: without cpufreq nothing here is checked.
        self.assertTrue(nodes, "no cpufreq on this machine: the unit cannot be checked")
        sets = [set(node.read_text().split()) for node in nodes]
        return set.intersection(*sets)

    def test_every_governor_the_unit_writes_is_one_this_machine_accepts(self):
        text = UNIT.read_text()
        self.assertIn("performance", governors_written(text))
        self.assertEqual(governors_refused(text, self.available()), [])

    def test_the_twins_schedutil_is_seen_and_performance_alone_passes(self):
        stop = (
            "ExecStop=/bin/sh -c 'for g in /sys/devices/system/cpu/cpu*/cpufreq/"
            'scaling_governor; do echo schedutil > "$g"; done\''
        )
        start = stop.replace("ExecStop", "ExecStart").replace("schedutil", "performance")
        accepted = {"performance", "powersave"}
        self.assertEqual(governors_refused(f"{start}\n{stop}\n", accepted), ["schedutil"])
        self.assertEqual(governors_refused(f"{start}\n", accepted), [])
        self.assertEqual(governors_written(f"{start}\n{stop}\n"), ["performance", "schedutil"])


if __name__ == "__main__":
    unittest.main()
