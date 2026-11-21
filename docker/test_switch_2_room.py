"""Private fixtures only: Switch 2 must never touch a Ryubing save tree."""

import configparser
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "switch2_room", Path(__file__).with_name("switch2-room.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Switch2Room(unittest.TestCase):
    def test_main_selects_the_title_engine_without_moving_state_or_other_games(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ("default", "zelda"):
                executable = root / name / "usr/bin/eden-cli"
                executable.parent.mkdir(parents=True)
                executable.touch()
            rom = root / "game.nup"
            rom.touch()
            chosen = {
                "engine": str(root / "zelda"),
                "image": "qualified-zelda-image",
                "revision": "zelda-tested",
            }
            config = {
                "engine": str(root / "default"),
                "image": "default-image",
                "revision": "default-tested",
                "state": str(root / "state"),
                "refresh_hz": 120,
                "engines_by_title": {"0400486024dec000": chosen},
            }
            original = json.loads(json.dumps(config))
            config_path = root / "switch2.json"
            config_path.write_text(json.dumps(config))
            for title, expected in (
                ("0400486024dec000", chosen),
                ("0400123456789000", config),
            ):
                with (
                    self.subTest(title=title),
                    patch.dict(os.environ, NEL3AB_SWITCH2_CONFIG=str(config_path)),
                    patch.object(
                        module.sys,
                        "argv",
                        ["adapter", str(rom), title, "neuve", str(root / "pads")],
                    ),
                    patch.object(module.room, "serve") as serve,
                ):
                    module.main()
                    serve.assert_called_once()
                    selected, _, slot, _, launch, _ = serve.call_args.args
                    for key in ("image", "engine", "revision"):
                        self.assertEqual(selected[key], expected[key])
                    self.assertEqual(selected["state"], config["state"])
                    self.assertEqual(selected["refresh_hz"], 120)
                    self.assertEqual(slot, root / "state" / title / "neuve")
                    self.assertIn(
                        f"{slot.parent}/cache/{expected['revision']}:/run-data/home/.cache",
                        launch.mounts,
                    )
            self.assertEqual(json.loads(config_path.read_text()), original)

    def test_title_engine_rejects_incomplete_or_state_overrides(self):
        title = "0400486024dec000"
        engine = {"image": "pinned-image", "engine": "/engine", "revision": "tested"}
        invalid = (
            None,
            [],
            {title: {**engine, "state": "/other-saves"}},
            {title: {**engine, "refresh_hz": 60}},
            {title: {"engine": "/engine"}},
            {title: {**engine, "image": ""}},
            {title: {**engine, "engine": None}},
            {title: {**engine, "revision": "../other-cache"}},
            {"../other-game": engine},
        )
        self.assertEqual(module.select_engine({"image": "old"}, title), {"image": "old"})
        for profiles in invalid:
            with self.subTest(profiles=profiles), self.assertRaises(ValueError):
                module.select_engine({"engines_by_title": profiles}, title)
        with self.assertRaises(ValueError):
            module.select_engine({}, "../other-game")

    def test_explicit_nand_and_only_the_first_controller_survive_ini_parsing(self):
        with tempfile.TemporaryDirectory() as temporary:
            slot = Path(temporary)
            ini = configparser.ConfigParser(interpolation=None)
            ini.optionxform = str
            ini.read(module.configuration(slot))
            self.assertEqual(
                ini["Data%20Storage"]["nand_directory"],
                "/run-data/home/.local/share/eden/nand",
            )
            self.assertEqual(ini["Data%20Storage"]["nand_directory\\default"], "false")
            self.assertTrue((slot / module.NAND).is_dir())
            self.assertEqual(
                ini["Miscellaneous"]["log_filter"], "*:Info HW.GPU:Warning Render.Vulkan:Warning"
            )
            self.assertEqual(ini["Renderer"]["frame_gen"], "false")
            self.assertEqual(ini["Controls"]["player_0_connected"], "true")
            for index in range(1, 8):
                self.assertEqual(ini["Controls"][f"player_{index}_connected"], "false")
            self.assertIn("axis_x:0,axis_y:1", ini["Controls"]["player_0_lstick"])
            self.assertIn("axis_x:3,axis_y:4", ini["Controls"]["player_0_rstick"])
            self.assertNotIn("DataStorage", ini.sections())

    def test_snapshot_preserves_progress_and_leaves_other_slots_and_caches_alone(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            slot, other = root / "0400486024dec000/neuve", root / "switch1"
            save = slot / module.NAND / "user/save/progress.dat"
            save.parent.mkdir(parents=True)
            save.write_bytes(b"saved in the forest")
            unrelated = other / "data/bis/user/save/old.dat"
            unrelated.parent.mkdir(parents=True)
            unrelated.write_bytes(b"old Switch progression")
            cache = slot / "home/.cache/pipelines.bin"
            cache.parent.mkdir(parents=True)
            cache.write_bytes(b"large replaceable shader cache")
            snapshot = module.backup(slot)
            self.assertIsNotNone(snapshot)
            save.write_bytes(b"next room")
            self.assertEqual(
                (snapshot / "nand/user/save/progress.dat").read_bytes(),
                b"saved in the forest",
            )
            self.assertFalse((snapshot / "home/.cache").exists())
            self.assertEqual(unrelated.read_bytes(), b"old Switch progression")
            self.assertIsNone(module.backup(root / "unstarted"))

    def test_launch_pins_one_device_and_namespaces_cache_by_revision(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "engine/usr/bin/eden-cli"
            executable.parent.mkdir(parents=True)
            executable.touch()
            rom = root / "game.nup"
            rom.touch()
            config = {"engine": str(root / "engine"), "revision": "tested-commit"}
            slot = root / "state/0400486024dec000/neuve"
            plan = module.launch(config, rom, slot)
            self.assertEqual(plan.controllers, 1)
            self.assertIn("EDEN_NX2_NO_MESH=1", plan.environment)
            self.assertFalse(any("MANGOHUD" in arg for arg in plan.environment))
            self.assertIn(f"{slot.parent}/cache/tested-commit:/run-data/home/.cache", plan.mounts)
            self.assertIn("LD_LIBRARY_PATH=/emulator/usr/lib", plan.command)
            self.assertNotIn("LD_LIBRARY_PATH=/emulator/usr/lib", plan.environment)
            for revision in ("", "../switch1", "/absolute", None):
                with self.subTest(revision=revision), self.assertRaises(ValueError):
                    module.launch({**config, "revision": revision}, rom, slot)
            with self.assertRaises(ValueError):
                module.launch(config, root / "missing.nup", slot)
            with self.assertRaises(ValueError):
                module.launch({**config, "engine": str(root / "missing")}, rom, slot)


if __name__ == "__main__":
    unittest.main()
