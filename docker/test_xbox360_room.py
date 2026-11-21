"""La salle Xbox 360, sans émulateur ni carte: profils, plan de lancement, manettes.

Ce que ces essais ne prouvent pas: que Xenia déchiffre ces profils. Le
chiffrement suit `EncryptAccountFile` de Xenia Edge 01ca7a5 ligne à ligne, et
la preuve est la ligne « Loaded Joueur 1 ... to slot 0 » du journal de Xenia
au premier lancement réel, sans fenêtre « No Profiles Found ».
"""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "xbox360_room", Path(__file__).with_name("xbox360-room.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

#: Une clé d'essai. La vraie est hors du dépôt (`profile_key` de la configuration).
KEY = bytes(range(16))


class Accounts(unittest.TestCase):
    def test_an_account_round_trips_and_has_xenias_size(self):
        data = module.account("Joueur 1", KEY)
        self.assertEqual(len(data), 0x194)
        self.assertEqual(module.read_account(data, KEY), "Joueur 1")

    def test_a_wrong_key_or_a_changed_byte_is_refused_like_xenia_does(self):
        # Le jumeau: Xenia compare l'empreinte et refuse le fichier, la fenêtre
        # « No Profiles Found » revient.
        data = module.account("Joueur 1", KEY)
        self.assertIsNone(module.read_account(data, bytes(16)))
        changed = bytearray(data)
        changed[0x40] ^= 1
        self.assertIsNone(module.read_account(bytes(changed), KEY))
        self.assertIsNone(module.read_account(data[:-1], KEY))

    def test_the_name_follows_xenias_gamertag_rule(self):
        for bad in ("", "1Joueur", "Joueur  1", "Joueur_1", "Joueur numéro 1", "J" * 16):
            with self.assertRaises(ValueError, msg=bad):
                module.account(bad, KEY)

    def test_the_encryption_is_rc4_under_the_hmac_of_the_hash(self):
        # Le vecteur de référence de RC4 (clé « Key », texte « Plaintext »).
        self.assertEqual(module.rc4(b"Key", b"Plaintext").hex(), "bbf316e8d940af0ad3")


class Profiles(unittest.TestCase):
    def test_four_profiles_land_where_xenia_looks_and_are_kept_afterwards(self):
        with tempfile.TemporaryDirectory() as temporary:
            slot = Path(temporary)
            xuids = module.profiles(slot, KEY)
            self.assertEqual(xuids, [f"{0xE030000000000001 + n:016X}" for n in range(4)])
            for seat, xuid in enumerate(xuids):
                account = slot / f"xenia/content/{xuid}/FFFE07D1/00010000/{xuid}/Account"
                self.assertEqual(
                    module.read_account(account.read_bytes(), KEY), f"Joueur {seat + 1}"
                )
            # Un profil existant porte des sauvegardes: il n'est pas réécrit.
            first = slot / f"xenia/content/{xuids[0]}/FFFE07D1/00010000/{xuids[0]}/Account"
            first.write_bytes(b"deja la")
            module.profiles(slot, KEY)
            self.assertEqual(first.read_bytes(), b"deja la")

    def test_the_key_file_must_be_private_and_sixteen_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cle"
            path.write_text(KEY.hex())
            path.chmod(0o600)
            self.assertEqual(module.profile_key({"profile_key": str(path)}), KEY)
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                module.profile_key({"profile_key": str(path)})
            path.chmod(0o600)
            path.write_text("00")
            with self.assertRaises(ValueError):
                module.profile_key({"profile_key": str(path)})


class Launch(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        executable = root / "edge/usr/bin/xenia_edge"
        executable.parent.mkdir(parents=True)
        executable.touch()
        key = root / "cle"
        key.write_text(KEY.hex())
        key.chmod(0o600)
        self.rom = root / "Sonic the Hedgehog.iso"
        self.rom.touch()
        self.slot = root / "state/534507d6/neuve"
        self.slot.mkdir(parents=True)
        self.config = {
            "engine": str(root / "edge"),
            "image": "nel3ab/switch-prototype:2026-09-08-recovery",
            "state": str(root / "state"),
            "profile_key": str(key),
            "refresh_hz": 60,
            "captures_s": 30,
        }

    def tearDown(self):
        self.temporary.cleanup()

    def test_the_plan_is_full_screen_signed_in_measured_and_keeps_x_and_y(self):
        plan = module.launch(self.config, self.rom, self.slot)
        self.assertEqual(plan.controllers, 4)
        self.assertEqual(plan.pad_layout, "xbox")
        self.assertEqual(plan.command[:3], ["bash", "/xbox360/xenia.sh", "/game/input.iso"])
        for flag in (
            "--fullscreen=true",
            "--guide_button=false",
            "--apu=sdl",
            "--hid=sdl",
            "--mappings_file=/xbox360/manettes.txt",
            "--guest_scheduler_stats=true",
            "--storage_root=/run-data/xenia",
        ):
            self.assertIn(flag, plan.command)
        for seat in range(4):
            self.assertIn(
                f"--logged_profile_slot_{seat}_xuid={0xE030000000000001 + seat:016X}", plan.command
            )
        self.assertIn(f"{module.TOOLS}:/xbox360:ro", plan.mounts)
        self.assertIn("NEL3AB_CAPTURES_S=30", plan.environment)

    def test_xenia_draws_through_xwayland_without_on_screen_notifications(self):
        # En Wayland, l'image s'est figée à 40 s pendant que le jeu tournait
        # (21 novembre 2026). Les deux réglages vont ensemble: une notification
        # remettrait chaque image sur le chemin de l'interface.
        plan = module.launch(self.config, self.rom, self.slot)
        position = plan.environment.index("NEL3AB_SWAY_X11=1")
        self.assertEqual(plan.environment[position - 1], "-e")
        self.assertIn("--show_achievement_notification=false", plan.command)
        self.assertNotIn("--show_achievement_notification=true", plan.command)

    def test_a_bad_game_engine_or_capture_interval_stops_before_any_container(self):
        with self.assertRaises(ValueError):
            module.launch(self.config, self.rom.with_suffix(".xex"), self.slot)
        with self.assertRaises(ValueError):
            module.launch({**self.config, "engine": "/nowhere"}, self.rom, self.slot)
        for bad in (5, 601, "30", True):
            with self.assertRaises(ValueError, msg=bad):
                module.launch({**self.config, "captures_s": bad}, self.rom, self.slot)
        self.assertEqual(
            module.launch({**self.config, "captures_s": 0}, self.rom, self.slot).controllers, 4
        )

    def test_main_takes_an_eight_digit_title_and_refuses_a_switch_one(self):
        config = Path(self.temporary.name) / "xbox360.json"
        config.write_text(json.dumps(self.config))
        served = []
        with (
            patch.dict(os.environ, {"NEL3AB_XBOX360_CONFIG": str(config)}),
            patch.object(module.room, "serve", lambda *args: served.append(args)),
            patch.object(
                module.sys, "argv", ["x", str(self.rom), "534507D6", "neuve", self.temporary.name]
            ),
        ):
            module.main()
        self.assertEqual(served[0][2], (Path(self.config["state"]) / "534507d6/neuve").resolve())
        with (
            patch.dict(os.environ, {"NEL3AB_XBOX360_CONFIG": str(config)}),
            patch.object(module.room, "serve", lambda *args: served.append(args)),
            patch.object(
                module.sys,
                "argv",
                ["x", str(self.rom), "0100ABCDEF012000", "neuve", self.temporary.name],
            ),
            self.assertRaises(ValueError),
        ):
            module.main()
        self.assertEqual(len(served), 1)


class PadHelperLayout(unittest.TestCase):
    def test_the_helper_command_carries_the_layout_and_refuses_an_unknown_one(self):
        command = module.room.pad_command("image", Path("room-runtime"), "helper", "label", "xbox")
        self.assertIn("NEL3AB_PAD_LAYOUT=xbox", command)
        # Le jumeau: la Switch garde son échange par défaut.
        default = module.room.pad_command("image", Path("room-runtime"), "helper", "label")
        self.assertIn("NEL3AB_PAD_LAYOUT=switch", default)
        with self.assertRaises(ValueError):
            module.room.pad_command("image", Path("room-runtime"), "helper", "label", "nes")


if __name__ == "__main__":
    unittest.main()
