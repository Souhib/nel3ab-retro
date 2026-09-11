"""No console keys or real add-ons: NSP files built here with a test key."""

import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

spec = importlib.util.spec_from_file_location(
    "switch_dlc", Path(__file__).with_name("switch-dlc.py")
)
dlc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dlc)

KEY = bytes(range(32))
SMASH = 0x01006A800016E000


def nca(kind, title, magic=b"NCA3"):
    """The first two header sectors, encrypted as the console does."""
    header = bytearray(0x400)
    header[0x200:0x204] = magic
    header[0x205] = kind
    header[0x210:0x218] = title.to_bytes(8, "little")
    out = b""
    for sector in range(2):
        mode = modes.XTS(sector.to_bytes(16, "big"))
        encryptor = Cipher(algorithms.AES(KEY), mode).encryptor()
        out += encryptor.update(bytes(header[sector * 0x200 : (sector + 1) * 0x200]))
        out += encryptor.finalize()
    return out


def nsp(path, entries):
    """A PFS0 container holding these named files."""
    names = b""
    offsets = []
    for name, _ in entries:
        offsets.append(len(names))
        names += name.encode() + b"\0"
    head = b"PFS0" + struct.pack("<II", len(entries), len(names)) + b"\0" * 4
    table = b""
    position = 0
    for (_, payload), offset in zip(entries, offsets, strict=True):
        table += struct.pack("<QQII", position, len(payload), offset, 0)
        position += len(payload)
    path.write_bytes(head + table + names + b"".join(payload for _, payload in entries))


class AddOnContent(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = self.root / "updates/smash-dlc"
        self.folder.mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def test_each_add_on_is_listed_by_the_title_its_header_carries(self):
        nsp(
            self.folder / "joker.nsp",
            [
                ("aa.nca", nca(dlc.PUBLIC_DATA, SMASH + 0x1001)),
                ("bb.cnmt.nca", nca(1, SMASH + 0x1001)),
                # Another kind of part beside the data is not an add-on.
                ("cc.nca", nca(2, SMASH + 0x1001)),
            ],
        )
        listed = dlc.listing(self.root / "updates", "smash-dlc", SMASH, KEY)
        self.assertEqual(
            listed,
            [
                {
                    "path": "/run-data/updates/smash-dlc/joker.nsp",
                    "dlc_nca_list": [
                        {"path": "/aa.nca", "title_id": SMASH + 0x1001, "is_enabled": True}
                    ],
                }
            ],
        )

    def test_an_add_on_of_another_game_or_an_odd_container_is_refused(self):
        refused = {
            "another game": [("aa.nca", nca(dlc.PUBLIC_DATA, 0x0100152000023001))],
            "the game itself": [("aa.nca", nca(dlc.PUBLIC_DATA, SMASH))],
            "no add-on index": [("aa.nca", nca(dlc.PUBLIC_DATA, SMASH + 0x1000))],
            "two data parts": [
                ("aa.nca", nca(dlc.PUBLIC_DATA, SMASH + 0x1001)),
                ("bb.nca", nca(dlc.PUBLIC_DATA, SMASH + 0x1002)),
            ],
            "no data part": [("bb.cnmt.nca", nca(1, SMASH + 0x1001))],
            # What a wrong key yields: no magic, whatever the other bytes say.
            "wrong key": [("aa.nca", nca(dlc.PUBLIC_DATA, SMASH + 0x1001, magic=b"\0" * 4))],
        }
        for label, entries in refused.items():
            with self.subTest(label):
                for old in self.folder.iterdir():
                    old.unlink()
                nsp(self.folder / "bad.nsp", entries)
                with self.assertRaises(ValueError):
                    dlc.listing(self.root / "updates", "smash-dlc", SMASH, KEY)
        (self.folder / "bad.nsp").write_bytes(b"not a container at all")
        with self.assertRaises(ValueError):
            dlc.listing(self.root / "updates", "smash-dlc", SMASH, KEY)

    def test_the_listing_reaches_both_slots_and_stays_in_the_updates_folder(self):
        nsp(self.folder / "joker.nsp", [("aa.nca", nca(dlc.PUBLIC_DATA, SMASH + 0x1001))])
        outside = self.root / "outside"
        outside.mkdir()
        nsp(outside / "joker.nsp", [("aa.nca", nca(dlc.PUBLIC_DATA, SMASH + 0x1001))])
        for folder in ("../outside", str(outside)):
            with self.assertRaises(ValueError):
                dlc.listing(self.root / "updates", folder, SMASH, KEY)
        state = self.root / "state"
        dlc.install(
            state, "01006a800016e000", dlc.listing(self.root / "updates", "smash-dlc", SMASH, KEY)
        )
        for slot in ("neuve", "debloquee"):
            written = state / "01006a800016e000" / slot / "data/games/01006a800016e000/dlc.json"
            self.assertEqual(
                json.loads(written.read_text())[0]["path"], "/run-data/updates/smash-dlc/joker.nsp"
            )


if __name__ == "__main__":
    unittest.main()
