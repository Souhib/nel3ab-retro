"""Ce qu'un moteur donne au cycle de vie: son plan, son environnement, ses manettes.

Déplacé de `docker/switch-room.py` octet pour octet (`run`, `pad_command`,
`cpu_pinning`, `engine_environment`, `EngineLaunch`), qui garde sa propre copie
jusqu'à la bascule de la Switch. `test_differentiel.py` tient les deux égales:
même arbre syntaxique pour chaque fonction, mêmes commandes pour chaque scénario
doré.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import NamedTuple

#: Le dépôt, d'où le conteneur monte ses outils.
DEPOT = Path(__file__).resolve().parents[2]
#: Les outils qui tournent DANS le conteneur, montés en /probe (runtime.sh,
#: supervise.py, pads.py, capture.py). Le même dossier que `switch-room.py`.
TOOLS = DEPOT / "spikes/switch-room"


def run(*args: str, **kwargs):
    return subprocess.run(args, check=True, **kwargs)  # noqa: S603 -- fixed programs, argument arrays, no shell


def pad_command(
    image: str, pads: Path, helper: str, label: str, layout: str = "switch"
) -> list[str]:
    """Use the same confinement for the live helper and its real rumble test.

    `layout` chooses where the page's X and Y land: a Switch adapter swaps
    them for Ryubing's profile, an Xbox 360 adapter keeps them in place.
    """
    if layout not in ("switch", "xbox"):
        raise ValueError(f"unknown pad layout {layout!r}")
    uid, gid = str(os.getuid()), str(os.getgid())
    return [
        "docker",
        "run",
        "-d",
        "--name",
        helper,
        "--label",
        f"nel3ab.room-root={pads.parent}",
        "--network",
        "none",
        "--cap-drop=ALL",
        "--cap-add=CHOWN",
        "--cap-add=FOWNER",
        "--group-add",
        gid,
        "--security-opt=no-new-privileges",
        "--pids-limit=32",
        "--device=/dev/uinput",
        "-v",
        "/dev/input:/dev/input",
        "-v",
        f"{pads}:/run-data",
        "-v",
        f"{TOOLS}:/probe:ro",
        "-e",
        f"HOST_UID={uid}",
        "-e",
        f"NEL3AB_PAD_LABEL={label}",
        "-e",
        f"NEL3AB_PAD_LAYOUT={layout}",
        image,
        "python3",
        "/probe/pads.py",
    ]


def cpu_pinning(config: dict) -> list[str]:
    """Les cœurs réservés à l'émulateur, ou rien du tout.

    POURQUOI ce n'est pas allumé par défaut. Le 16 septembre 2026, le fil de rendu
    de Ryujinx tenait 90 % d'un cœur pendant que l'encodeur et la capture se
    partageaient la même machine, et les gels d'une seconde n'ont toujours pas
    d'explication. Épingler sépare les deux, mais rien ne prouve encore que ça
    aide, et une salle bridée sur trop peu de cœurs irait plus mal. Le réglage
    existe donc pour être MESURÉ, en phases alternées, avant d'être un défaut.

    `cpuset` est la liste que Docker attend, par exemple "0-3,6-9" sur un six
    cœurs avec jumeaux logiques. Absent, l'émulateur voit toute la machine.
    """
    cpuset = config.get("cpuset")
    if cpuset is None:
        return []
    if not isinstance(cpuset, str) or not cpuset.strip():
        raise ValueError(f'cpuset doit être une liste de cœurs comme "0-3,6-9", pas {cpuset!r}')
    return ["--cpuset-cpus", cpuset.strip()]


def engine_environment(config: dict) -> list[str]:
    """Engine container environment, checked before any container starts.

    refresh_hz is Sway's composing rate on the server, not the players' screens:
    see refresh_hz in spikes/switch-room/supervise.py, which checks it again.
    """
    refresh = config.get("refresh_hz", 60)
    if type(refresh) is not int or not 30 <= refresh <= 240:
        raise ValueError(f"refresh_hz must be a whole number from 30 to 240, not {refresh!r}")
    # Keep the image on screen until the next one is presented, as a console
    # does (amont/ryubing-hold-front-buffer.patch). Off unless the room says so.
    hold = config.get("hold_front_buffer", False)
    if type(hold) is not bool:
        raise ValueError(f"hold_front_buffer must be true or false, not {hold!r}")
    return [
        "-e",
        "DISPLAY_BACKEND=wayland",
        "-e",
        "SWITCH_COMPOSITOR=sway",
        "-e",
        f"SWITCH_REFRESH_HZ={refresh}",
        # Only the seats taken in the room get a controller (ryubing-seats.patch).
        "-e",
        "NEL3AB_SEATS_FILE=/pads/seats",
        *(["-e", "NEL3AB_HOLD_FRONT_BUFFER=1"] if hold else []),
    ]


class EngineLaunch(NamedTuple):
    """Only the engine-specific arguments; the room owns the shared lifecycle."""

    environment: list[str]
    mounts: list[str]
    command: list[str]
    controllers: int
    #: Where the page's X and Y land on the virtual pads (see `pad_command`).
    pad_layout: str = "switch"
