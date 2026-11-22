"""Le manifeste des consoles, et chaque liste du plan de contrôle qui en dépend.

Le salon et la boîte noire LISENT le manifeste: ajouter une console au fichier
l'ajoute à leurs listes, et ces essais le vérifient en lisant un faux manifeste.
Ce qui reste écrit à la main ici, les guides par console, le réglage du perf
roulant et l'unité systemd, est comparé au fichier, pour qu'une divergence se
voie dans la porte et non pendant une soirée.
"""

import json
import re
from pathlib import Path, PurePosixPath

import pytest

from nel3ab_control.api.schemas.room import GameGuide
from nel3ab_control.api.ws.handlers import allowed_devices
from nel3ab_control.boite_noire import capture, releve
from nel3ab_control.consoles import CONSOLES, MANIFESTE, ManifesteInvalideError, lire
from nel3ab_control.game_controls import GUIDES_BY_CONSOLE
from nel3ab_control.settings import Settings

DEPOT = MANIFESTE.parents[1]


def faux(tmp_path: Path, change) -> Path:
    """Le vrai manifeste, modifié par `change`, écrit dans un dossier jetable."""
    brut = json.loads(MANIFESTE.read_text(encoding="utf-8"))
    change(brut)
    chemin = tmp_path / "consoles.json"
    chemin.write_text(json.dumps(brut), encoding="utf-8")
    return chemin


def une_console(brut: dict, **champs: object) -> None:
    """Ajoute une fausse console, copiée sur la Switch, avec ces champs changés."""
    copie = json.loads(json.dumps(brut["consoles"][2]))
    copie.update({"code": "fake", "folder": "fake", "lock": None})
    copie.update(champs)
    brut["consoles"].append(copie)


def test_the_manifest_describes_the_four_consoles_and_the_xbox_360() -> None:
    assert [one.code for one in CONSOLES.consoles] == ["gc", "wii", "switch", "switch2", "x360"]
    x360 = CONSOLES.console("x360")
    assert x360 is not None
    assert (x360.engine, x360.form, x360.input, x360.players) == ("xenia", "external", "pro", 4)
    assert (x360.media, x360.folder, x360.extensions) == ("disc", "xbox360", ("iso",))
    assert x360.experimental and x360.playable
    assert CONSOLES.console("?") is None, "« ? » est un disque muet, pas une console"


def test_the_black_box_knows_the_same_processes_as_before() -> None:
    """Le comportement d'avant, épinglé: retirer `eden-cli` du manifeste refait
    exactement l'oubli du 7 novembre 2026, et doit faire échouer ceci."""
    assert releve.MOTEURS == {
        "Ryujinx": "switch",
        "dolphin-emu-nog": "dolphin",
        "eden-cli": "switch2",
        "xenia_edge": "x360",
    }
    assert CONSOLES.processes() == releve.MOTEURS


def test_every_playable_console_is_seen_by_the_black_box() -> None:
    """Le garde entre couches: une console qu'on lance doit avoir un processus
    que la boîte noire reconnaît, sinon ses parties sont relevées au repos."""
    roles = set(releve.MOTEURS.values())
    for console in CONSOLES.consoles:
        if console.playable:
            assert CONSOLES.engine(console.engine).role in roles, console.code


def test_only_adapter_consoles_have_a_screen_to_grab() -> None:
    assert {"switch", "switch2"} <= CONSOLES.roles_with_a_screen()
    assert "dolphin" not in CONSOLES.roles_with_a_screen()
    # La capture lit bien cette liste, et pas une copie.
    assert "CONSOLES.roles_with_a_screen()" in Path(capture.__file__).read_text(encoding="utf-8")


def test_a_preparation_accepts_exactly_the_playable_consoles() -> None:
    assert CONSOLES.preparable() == {"gc", "wii", "switch", "switch2", "x360"}
    assert "?" not in CONSOLES.preparable()


@pytest.mark.parametrize(
    "console, guide, expected",
    [
        ("gc", None, [0]),
        ("wii", None, [1, 0, 2, 3]),
        ("switch", None, [4]),
        ("switch2", None, [4]),
        # Un guide restreint la Wii, et ne change rien à une console à un seul appareil.
        ("wii", [3], [3]),
        ("gc", [1], [0]),
        ("switch", [0], [4]),
        # Un code inconnu ne reçoit plus les appareils de la Wii.
        ("nes", None, []),
    ],
)
def test_the_devices_offered_come_from_the_manifest(
    console: str, guide: list[int] | None, expected: list[int]
) -> None:
    described = (
        GameGuide(allowed=guide, source="", note="", actions={}) if guide is not None else None
    )
    assert allowed_devices(console, described) == expected


def test_only_a_one_player_console_prepares_alone() -> None:
    assert [one.code for one in CONSOLES.consoles if CONSOLES.solo(one.code)] == ["switch2"]
    assert not CONSOLES.solo("?")


def test_only_the_switch_family_takes_the_switch_place() -> None:
    assert {one.code for one in CONSOLES.consoles if CONSOLES.lock(one.code) == "switch"} == {
        "switch",
        "switch2",
    }


def test_every_guide_table_names_a_console_of_the_manifest() -> None:
    assert set(GUIDES_BY_CONSOLE) <= {one.code for one in CONSOLES.consoles}


def test_the_rolling_profiler_exceptions_name_known_roles() -> None:
    sauf = Settings.model_fields["boite_noire_roulant_sauf"].default
    assert set(sauf) <= CONSOLES.roles()


def unit_environment() -> dict[str, str]:
    """Les variables de l'unité des salles, telles que le dépôt la porte."""
    unite = (DEPOT / "deploy" / "nel3ab-worker@.service").read_text(encoding="utf-8")
    found = {}
    for ligne in unite.splitlines():
        prise = re.fullmatch(r'Environment="?([A-Z0-9_]+)=(.*?)"?', ligne.strip())
        if prise:
            found[prise.group(1)] = prise.group(2)
    return found


def test_the_room_unit_scans_the_folder_of_every_playable_console() -> None:
    """L'unité énumère ses dossiers à la main. Ce garde la tient au manifeste:
    une console rendue jouable sans son dossier dans l'unité n'aurait aucun jeu."""
    dossiers = [Path(it).name for it in unit_environment()["NEL3AB_ROM_DIR"].split(":")]
    assert dossiers == [one.folder for one in CONSOLES.consoles if one.playable]


def test_the_room_unit_configures_every_playable_adapter() -> None:
    environment = unit_environment()
    for console in CONSOLES.consoles:
        if console.playable and console.form == "external":
            assert console.config_env in environment, console.code
    # Rendue jouable le 21 novembre 2026: son adaptateur a sa configuration.
    assert "NEL3AB_XBOX360_CONFIG" in environment


def processus_des_fiches(moteurs: Path) -> dict[str, str]:
    """Le processus que chaque fiche moteur lance: le nom de son exécutable, quinze
    caractères au plus, comme /proc/<pid>/comm (moteurs/socle/fiche.py)."""
    return {
        chemin.parent.name: PurePosixPath(
            json.loads(chemin.read_text(encoding="utf-8"))["executable"]
        ).name[:15]
        for chemin in moteurs.glob("*/moteur.json")
    }


def ecarts_fiches(moteurs: Path) -> list[str]:
    lances = processus_des_fiches(moteurs)
    ecarts = []
    for console in CONSOLES.consoles:
        if console.form != "external" or not console.playable:
            continue
        connus = CONSOLES.engine(console.engine).processes
        if lances.get(console.engine) not in connus:
            ecarts.append(f"{console.engine}: lance {lances.get(console.engine)}, connus {connus}")
    return ecarts


def test_every_engine_card_launches_a_process_the_black_box_knows() -> None:
    """La troisième copie du nom de l'exécutable, après le manifeste et le lanceur:
    la fiche du moteur. Le garde du 7 novembre 2026 (eden-cli oublié) la couvre aussi."""
    assert ecarts_fiches(DEPOT / "moteurs") == []
    assert set(processus_des_fiches(DEPOT / "moteurs")) == {"ryubing", "eden", "xenia"}


def test_a_card_whose_executable_was_renamed_is_named(tmp_path: Path) -> None:
    for chemin in (DEPOT / "moteurs").glob("*/moteur.json"):
        cible = tmp_path / chemin.parent.name / "moteur.json"
        cible.parent.mkdir()
        brut = json.loads(chemin.read_text(encoding="utf-8"))
        if chemin.parent.name == "eden":
            brut["executable"] = "usr/bin/eden"
        cible.write_text(json.dumps(brut), encoding="utf-8")
    assert ecarts_fiches(tmp_path) == ["eden: lance eden, connus ('eden-cli',)"]


def test_a_console_added_to_the_manifest_reaches_every_derived_list(tmp_path: Path) -> None:
    """Le salon LIT le manifeste: une console ajoutée au fichier seul y apparaît."""
    chemin = faux(
        tmp_path,
        lambda brut: (
            brut["engines"].append({"name": "fakeemu", "role": "fake", "processes": ["fakeemu"]}),
            une_console(brut, engine="fakeemu", players=1),
        ),
    )
    lu = lire(chemin)
    assert "fake" in lu.preparable()
    assert lu.processes()["fakeemu"] == "fake"
    assert "fake" in lu.roles_with_a_screen()
    assert lu.solo("fake")
    assert lu.devices("fake") == (4,)


@pytest.mark.parametrize(
    "change, reason",
    [
        (lambda brut: brut.update(version=2), "seule la version 1"),
        (lambda brut: brut["consoles"].append(brut["consoles"][0]), "console en double"),
        (lambda brut: une_console(brut, engine="absent"), "moteur inconnu"),
        (lambda brut: une_console(brut, code="?"), "disque muet"),
        (lambda brut: une_console(brut, players=5), "players"),
        (lambda brut: une_console(brut, devices=[0]), "appareil 4"),
        (lambda brut: une_console(brut, input="snes"), "input"),
        (lambda brut: une_console(brut, extensions=["NES"]), "minuscules"),
        (lambda brut: brut["engines"][2].update(processes=["eden-cli-trop-long"]), "15"),
        # La leçon du 7 novembre: une console jouable sans processus connu.
        (lambda brut: brut["engines"][2].update(processes=[]), "aucun processus"),
        (lambda brut: brut["engines"][3].update(processes=[]), "aucun processus"),
    ],
)
def test_a_manifest_that_no_layer_could_serve_is_refused(
    tmp_path: Path, change, reason: str
) -> None:
    with pytest.raises(ManifesteInvalideError, match=reason):
        lire(faux(tmp_path, change))
