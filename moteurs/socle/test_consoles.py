"""La table des consoles du socle, comparée au manifeste dans les deux sens.

Le socle ne lit jamais `consoles/consoles.json` au lancement d'une salle (voir
`consoles.py`). Ce garde est donc ce qui empêche la table de dériver: une
console ajoutée d'un seul côté, ou un champ changé d'un seul côté, est nommée.
"""

import copy
import json
import unittest
from dataclasses import replace
from pathlib import Path

from moteurs.socle import consoles

MANIFESTE = Path(__file__).resolve().parents[2] / "consoles" / "consoles.json"


def ecarts(table: dict[str, consoles.Console], manifeste: dict) -> list[str]:
    """Ce qui diffère entre la table et les consoles externes du manifeste."""
    attendu = {}
    for brut in manifeste["consoles"]:
        forme = brut["form"]
        if forme["kind"] != "external":
            continue
        attendu[brut["code"]] = consoles.Console(
            brut["code"],
            brut["label"],
            brut["engine"],
            forme["script"],
            forme["script_env"],
            forme["config_env"],
            brut["players"],
            tuple(brut["extensions"]),
        )
    messages = [f"{code}: dans le manifeste, pas dans la table" for code in attendu.keys() - table]
    messages += [f"{code}: dans la table, pas dans le manifeste" for code in table.keys() - attendu]
    for code in sorted(attendu.keys() & table.keys()):
        if table[code] != attendu[code]:
            messages.append(f"{code}: la table dit {table[code]}, le manifeste {attendu[code]}")
    return sorted(messages)


def manifeste() -> dict:
    return json.loads(MANIFESTE.read_text(encoding="utf-8"))


class TableEtManifeste(unittest.TestCase):
    def test_la_table_est_celle_du_manifeste(self):
        self.assertEqual(ecarts(consoles.CONSOLES, manifeste()), [])
        self.assertEqual(sorted(consoles.CONSOLES), ["switch", "switch2", "x360"])

    def test_une_console_ajoutee_au_manifeste_seul_est_nommee(self):
        brut = manifeste()
        nouvelle = copy.deepcopy(brut["consoles"][-1])
        nouvelle["code"] = "ps3"
        brut["consoles"].append(nouvelle)
        self.assertEqual(
            ecarts(consoles.CONSOLES, brut), ["ps3: dans le manifeste, pas dans la table"]
        )

    def test_une_console_ajoutee_a_la_table_seule_est_nommee(self):
        table = {**consoles.CONSOLES, "ps3": replace(consoles.CONSOLES["x360"], code="ps3")}
        self.assertEqual(ecarts(table, manifeste()), ["ps3: dans la table, pas dans le manifeste"])

    def test_un_champ_change_d_un_seul_cote_est_nomme(self):
        for champ, valeur in (
            ("label", "Xbox 360 expérimentale"),
            ("config_env", "NEL3AB_X360_CONFIG"),
            ("players", 2),
            ("extensions", ("iso", "xex")),
            ("script", "docker/xbox360-room-socle.py"),
        ):
            with self.subTest(champ=champ):
                table = {
                    **consoles.CONSOLES,
                    "x360": replace(consoles.CONSOLES["x360"], **{champ: valeur}),
                }
                (message,) = ecarts(table, manifeste())
                self.assertTrue(message.startswith("x360: la table dit"), message)

    def test_seule_une_console_externe_est_servie(self):
        self.assertEqual(consoles.externe("x360").label, "Xbox 360")
        for code in ("gc", "wii", "?", "X360"):
            with (
                self.subTest(code=code),
                self.assertRaisesRegex(ValueError, "aucune console externe"),
            ):
                consoles.externe(code)


if __name__ == "__main__":
    unittest.main()
