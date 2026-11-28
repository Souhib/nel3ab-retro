"""Ce qu'un moteur donne au cycle de vie: son plan, son environnement, ses manettes.

Déplacé de `docker/switch-room.py` octet pour octet (`run`, `pad_command`,
`cpu_pinning`, `engine_environment`, `EngineLaunch`, `CaptureRestarts`, `EngineWatch`,
`stop_orphans`, `room_held`), qui garde sa propre copie
jusqu'à la bascule de la Switch. `test_differentiel.py` tient les deux égales:
même arbre syntaxique pour chaque fonction, mêmes commandes pour chaque scénario
doré.
"""

from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import NamedTuple

from moteurs.socle.emplacement import ouvrir_sans_lien

#: Le dépôt, d'où le conteneur monte ses outils.
DEPOT = Path(__file__).resolve().parents[2]
#: Les outils qui tournent DANS le conteneur, montés en /probe (runtime.sh,
#: supervise.py, pads.py, capture.py). Le même dossier que `switch-room.py`.
TOOLS = DEPOT / "spikes/switch-room"


def run(*args: str, **kwargs):
    return subprocess.run(args, check=True, **kwargs)  # noqa: S603 -- fixed programs, argument arrays, no shell


#: The room's own lock, beside the worker's session files. Its adapter holds it
#: for its whole life; the kernel frees it even when the adapter is killed.
ROOM_LOCK = "salle-externe.lock"
#: The label each room container carries (`pad_command` and `serve`).
ROOM_LABEL = "nel3ab.room-root"


def stop_orphans(root: Path) -> list[str]:
    """Stop and remove the containers a dead adapter of this room left running.

    Docker filters on the room's own label, so another room's containers are
    never listed. Engines stop first, capture first, as `stop_engine` does,
    then the virtual controllers. Each name stopped is returned.
    """
    listed = run(
        "docker",
        "ps",
        "--all",
        "--filter",
        f"label={ROOM_LABEL}={root}",
        "--format",
        "{{.Names}}",
        capture_output=True,
        text=True,
    ).stdout.split()
    engines = [name for name in listed if not name.endswith("-pads")]
    helpers = [name for name in listed if name.endswith("-pads")]
    for engine in engines:
        # The capture may be gone already: its stop is asked, never required.
        subprocess.run(  # noqa: S603 -- names listed by Docker under this room's label, fixed command
            ["/usr/bin/docker", "exec", engine, "python3", "/probe/capture_control.py", "stop"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        run("docker", "stop", "--timeout", "40", engine, stdout=subprocess.DEVNULL)
    for helper in helpers:
        run("docker", "stop", "--timeout", "5", helper, stdout=subprocess.DEVNULL)
    for name in [*engines, *helpers]:
        run("docker", "rm", name, stdout=subprocess.DEVNULL)
    if listed:
        sys.stderr.write(json.dumps({"orphelins_arretes": [*engines, *helpers]}) + "\n")
        sys.stderr.flush()
    return [*engines, *helpers]


@contextmanager
def room_held(pads: Path) -> Iterator[None]:
    """The whole room for this adapter's life, its orphans stopped first.

    The worker runs one adapter per room at a time (external.rs waits for the
    previous one). The slot lock dies with its adapter, but the containers live
    under dockerd: on 2026-11-27 a bench room whose adapter was killed kept its
    emulator running six hours, and a new game on the same slot would have
    started beside an emulator still writing its saves. Under this lock, any
    container with the room's label is such an orphan, stopped before the
    room's first container. `serve` takes it after every check of the plan, so
    a refused start still runs no Docker command. The first copy of the slot
    comes before, in `main`: if the orphan played this very slot, that copy may
    miss its last seconds, which its own stop then writes into the slot. A live
    adapter holding the lock refuses the start instead: stopping its game
    would be the worse error.
    """
    root = pads.parent
    with ouvrir_sans_lien(root, ROOM_LOCK) as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(f"Another adapter still runs room {root}") from None
        stop_orphans(root)
        yield


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
        f"{ROOM_LABEL}={pads.parent}",
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

    `cpuset` est la liste que Docker attend, par exemple "0-2,6-8" sur le Ryzen 5
    3600 de lgf: ses trois premiers cœurs et leurs jumeaux, qui partagent un même
    cache L3 (lu dans /sys le 27 novembre 2026: 0-2,6-8 et 3-5,9-11). L'ancien
    exemple, 0-3,6-9, prenait quatre cœurs à cheval sur les deux caches. Absent,
    l'émulateur voit toute la machine.
    """
    cpuset = config.get("cpuset")
    if cpuset is None:
        return []
    if not isinstance(cpuset, str) or not cpuset.strip():
        raise ValueError(f'cpuset doit être une liste de cœurs comme "0-2,6-8", pas {cpuset!r}')
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


class EngineWatch:
    """Whether the engine container still runs, asked of one `docker wait`.

    Until 2026-11-27 the room asked `docker inspect` at each turn of its loop,
    about twice a second for a whole game: two docker clients a second, about
    7 % of one core (MACH-2). `docker wait` blocks until the container stops,
    so the room only looks at its own child between turns. When it returns,
    one `docker inspect` tells a stopped engine from a client that failed while
    the engine runs; the room then starts a new client and goes on.
    """

    def __init__(self, engine: str) -> None:
        self.engine = engine
        self.client = self.start()

    def start(self):
        return subprocess.Popen(  # noqa: S603 -- private generated container name, fixed command
            ["/usr/bin/docker", "wait", self.engine],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def running(self) -> bool:
        if self.client.poll() is None:
            return True
        status = run(
            "docker",
            "inspect",
            "-f",
            "{{.State.Running}}",
            self.engine,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if status != "true":
            return False
        self.client = self.start()
        return True

    def close(self) -> None:
        # The client only waits: stopping it never touches the container.
        if self.client.poll() is None:
            self.client.kill()
        self.client.wait()


class CaptureRestarts:
    """Whether a room may start its capture once more.

    Two rules. Three failures within a minute stop a capture that dies at once
    (the laboratory service's StartLimitBurst=3, 2026-09-08). And once a
    capture has sent a game picture, three failures in a row with no game
    picture between them stop a slow loop: on 2026-11-21 the Xbox 360 room
    restarted its capture 36 times, about 35.5 s apart, for 21 minutes after
    Xenia stopped presenting, and no restart brought the picture back.
    Before the first game picture only the first rule counts: a first launch
    that rebuilds its translation cache shows nothing for 4 minutes (Mario
    Tennis, carnet), and each capture then ends at its 90 s start limit.
    Only SHOWN_THEN_FAILED proves a game picture. Any other status is a doubt
    (docker exec's own failure, a signal, python3's own crash): it breaks a
    series without arming the second rule, so a doubt never stops a room.
    """

    #: The exit statuses of a capture that failed before sending any game
    #: picture, and after sending one (spikes/switch-room/capture.py, which
    #: holds the same numbers). python3 itself exits 1 on an uncaught exception,
    #: before any picture too, then 2 or 120; docker exec exits 125 to 127, or
    #: 128 and a signal number: 3 and 4 are none of them.
    NOTHING_SHOWN = 3
    SHOWN_THEN_FAILED = 4

    def __init__(self) -> None:
        self.starts: list[float] = []
        self.shown = False
        self.blank = 0

    def refused(self, now: float, ended: int | None) -> str | None:
        """Why the next capture must not start, or None if it may.

        `ended` is how the previous capture ended, None before the first.
        """
        if ended == self.SHOWN_THEN_FAILED:
            self.shown, self.blank = True, 0
        elif ended == self.NOTHING_SHOWN:
            if self.shown:
                self.blank += 1
        elif ended is not None:
            self.blank = 0
        self.starts = [at for at in self.starts if now - at < 60]
        if len(self.starts) >= 3:
            return "Capture failed three times in one minute"
        if self.blank >= 2:
            return "Capture failed three times in a row without a game picture between them"
        self.starts.append(now)
        return None
