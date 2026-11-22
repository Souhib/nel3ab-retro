#!/usr/bin/env python3
"""Switch room adapter. Owns only its two containers and its private save slot.

The worker closes stdin to request a graceful stop. Capture stops first, then
Ryubing closes its window and flushes saves, then virtual controllers disappear.
"""

from __future__ import annotations

import contextlib
import errno
import fcntl
import json
import os
import re
import selectors
import shutil
import stat
import subprocess
import sys
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import IO, NamedTuple

TOOLS = Path(__file__).resolve().parents[1] / "spikes/switch-room"


def run(*args: str, **kwargs):
    return subprocess.run(args, check=True, **kwargs)  # noqa: S603 -- fixed programs, argument arrays, no shell


def initialise(template: Path, slot: Path) -> None:
    """One complete root per game/slot. Never overwrite an existing progression."""
    if (slot / "data").is_dir():
        return
    slot.mkdir(parents=True, exist_ok=True)
    pending = slot / "data.pending"
    if pending.exists():
        shutil.rmtree(pending)
    shutil.copytree(template, pending)
    # Ryubing indexes save containers in its system filesystem. Removing the
    # user/save directory alone leaves dangling indexes: Tennis aborted with
    # ResultFsTargetNotFound on 2026-09-09. Keep metadata, empty both data banks.
    for bank in (pending / "bis/user/save").glob("*/*"):
        if bank.is_dir() and bank.name in ("0", "1"):
            for entry in bank.iterdir():
                if entry.is_dir() and not entry.is_symlink():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
    pending.rename(slot / "data")


def backup(slot: Path) -> Path | None:
    """Copy a quiescent filesystem, including Ryubing's journal and metadata."""
    source = sans_lien(slot, "data", "bis", "user")
    if not source.exists():
        return None
    target = dossier_sans_lien(slot, "backups") / time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    if target.exists():
        target = target.with_name(target.name + f"-{time.time_ns()}")
    # A link in the save is copied as a link: never read, never followed.
    shutil.copytree(source, target, symlinks=True)
    return target


#: Les emplacements de sauvegarde qu'une salle peut demander.
#:
#: Les deux de la salle, ou celui d'une personne. Un SEUL segment, sans barre ni
#: point: ce texte vient du worker et sert à construire un chemin sous l'état
#: des jeux, donc un `..` ou une barre y ouvrirait n'importe quel dossier.
SLOT = r"^(neuve|debloquee|joueur-[a-z0-9][a-z0-9-]*)$"
#: Le message d'un lien refusé, suivi du chemin où il se trouve.
REFUS = "l'hôte ne suit aucun lien de l'emplacement"


# L'hôte ne suit aucun lien dans un emplacement: le conteneur le monte en
# écriture sous le compte de l'hôte, et un moteur compromis pourrait y laisser
# un lien vers un fichier de l'hôte (relecture du 22 novembre 2026). Les quatre
# fonctions suivantes sont celles de moteurs/socle/emplacement.py, à l'identique
# (moteurs/socle/test_differentiel.py compare leur arbre).


def descendre(racine: Path, parties: Sequence[str]) -> int:
    """Le descripteur de `racine/parties`, chaque niveau créé s'il manque.

    Chaque niveau s'ouvre depuis le précédent avec O_NOFOLLOW: un lien est
    refusé (ELOOP) au lieu d'être suivi, même s'il apparaissait entre deux
    niveaux. `racine` est l'emplacement, que l'hôte a créé et que le conteneur
    ne peut pas remplacer: c'est la racine de son montage.
    """
    dossier = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open(racine, dossier)
    courant = racine
    try:
        for partie in parties:
            if partie in ("", ".", "..") or "/" in partie:
                raise ValueError(f"{partie!r} n'est pas un nom de dossier")
            courant = courant / partie
            with contextlib.suppress(FileExistsError):
                os.mkdir(partie, dir_fd=fd)
            try:
                suivant = os.open(partie, dossier, dir_fd=fd)
            except OSError as erreur:
                if erreur.errno != errno.ELOOP:
                    raise
                raise OSError(erreur.errno, REFUS, str(courant)) from erreur
            os.close(fd)
            fd = suivant
    except BaseException:
        os.close(fd)
        raise
    return fd


@contextmanager
def ouvrir_sans_lien(
    racine: Path, *chemin: str, mode: str = "w", neuf: bool = False
) -> Iterator[IO]:
    """`racine/chemin` ouvert en écriture, ses dossiers créés, sans suivre aucun lien.

    `neuf` refuse un fichier déjà là, lien compris (FileExistsError). Sinon le
    fichier est vidé, comme `open("w")`. O_NONBLOCK: un tube nommé posé à sa
    place est refusé tout de suite au lieu de faire attendre l'hôte, puis seul
    un fichier ordinaire est accepté.
    """
    *parties, nom = chemin
    lieu = racine.joinpath(*chemin)
    drapeaux = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
    drapeaux |= os.O_EXCL if neuf else os.O_TRUNC
    fd_dossier = descendre(racine, parties)

    def depuis_le_dossier(_chemin: str, _drapeaux: int) -> int:
        return os.open(nom, drapeaux, 0o666, dir_fd=fd_dossier)

    try:
        # `open` garde `lieu` comme nom du fichier, ce que les journaux montrent.
        fichier = open(lieu, mode, opener=depuis_le_dossier)  # noqa: SIM115 -- fermé par le `with` plus bas
    except OSError as erreur:
        if erreur.errno != errno.ELOOP:
            raise
        raise OSError(erreur.errno, REFUS, str(lieu)) from erreur
    finally:
        os.close(fd_dossier)
    with fichier:
        if not stat.S_ISREG(os.fstat(fichier.fileno()).st_mode):
            raise OSError(errno.EINVAL, "pas un fichier ordinaire", str(lieu))
        os.set_blocking(fichier.fileno(), True)
        yield fichier


def dossier_sans_lien(racine: Path, *parties: str) -> Path:
    """`racine/parties`, créé niveau par niveau, sans passer par aucun lien.

    `racine` est créée si elle manque, comme le faisait `mkdir(parents=True)`:
    son chemin appartient à l'hôte, le conteneur ne voit que son contenu.
    """
    racine.mkdir(parents=True, exist_ok=True)
    os.close(descendre(racine, parties))
    return racine.joinpath(*parties)


def sans_lien(racine: Path, *parties: str) -> Path:
    """`racine/parties`, refusé si un lien se trouve sur son chemin.

    Pour une copie, que `shutil` fait par chemins: elle ne se fait que quand le
    conteneur est arrêté (avant le lancement, ou dans `stop_engine` après
    `docker stop`), donc aucun lien ne peut apparaître entre ce contrôle et la
    copie. Un niveau absent arrête le contrôle: rien n'existe au-delà.
    """
    courant = racine
    for partie in parties:
        courant = courant / partie
        if courant.is_symlink():
            raise OSError(errno.ELOOP, REFUS, str(courant))
        if not courant.exists():
            break
    return racine.joinpath(*parties)


def main() -> None:
    rom, title, choice, pads = sys.argv[1:]
    if (
        len(title) != 16
        or any(c not in "0123456789abcdef" for c in title)
        or not re.fullmatch(SLOT, choice)
    ):
        raise ValueError("Invalid Switch title or save slot")
    config = json.loads(Path(os.environ["NEL3AB_SWITCH_CONFIG"]).read_text())
    root = Path(config["state"]).resolve()
    slot = root / title / choice
    slot.mkdir(parents=True, exist_ok=True)
    with ouvrir_sans_lien(slot, "running.lock") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        initialise(Path(config["template"]), slot)
        backup(slot)
        serve(config, Path(rom).resolve(), slot, Path(pads).resolve())


def update_mount(config: dict, slot: Path) -> list[str]:
    """Never silently run a game without its selected update or its add-ons.

    Ryubing skips a missing add-on with a warning: Smash would start without
    the fighters bought for it. Add-ons live in the same private folder.
    """
    games = slot / "data/games" / slot.parent.name
    wanted = []
    metadata = games / "updates.json"
    if metadata.exists() and (selected := json.loads(metadata.read_text()).get("selected")):
        wanted.append(selected)
    listing = games / "dlc.json"
    if listing.exists():
        wanted += [container["path"] for container in json.loads(listing.read_text())]
    if not wanted:
        return []
    prefix = Path("/run-data/updates")
    if "updates" not in config:
        raise ValueError("Selected Switch content requires its private updates directory")
    root = Path(config["updates"]).resolve()
    for selected in wanted:
        guest = Path(selected)
        if not guest.is_relative_to(prefix) or ".." in guest.parts:
            raise ValueError("Selected Switch content must stay in the updates directory")
        if not (root / guest.relative_to(prefix)).is_file():
            raise ValueError("Selected Switch content is missing; refusing to start without it")
    return ["-v", f"{root}:/run-data/updates:ro"]


def linked(root: Path, path: Path) -> bool:
    """Whether a link lies between `root` and `path`, `path` included."""
    current = root
    for part in path.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            return True
    return False


def cache_mounts(slot: Path) -> list[str]:
    """One shader and driver cache per game, shared by all its save slots.

    A cache holds no progression: it only saves the work of preparing a shader
    or translating a function, which is the same in both slots. Kept apart,
    each slot paid that work again (Smash, 2026-09-11).
    """
    title = slot.parent.name
    for name, pattern in (
        ("cache", f"*/data/games/{title}/cache"),
        ("mesa", "*/home/.cache/mesa_shader_cache"),
    ):
        shared = slot.parent / name
        if shared.exists():
            continue
        # The fullest slot seeds the shared cache, once, rather than the emptiest.
        # A slot is written by its container: a candidate reached through a
        # link could be any folder of the host, so it is never a candidate.
        found = sorted(
            (
                path
                for path in slot.parent.glob(pattern)
                if path.is_dir() and not linked(slot.parent, path)
            ),
            key=lambda path: sum(f.stat().st_size for f in path.rglob("*") if f.is_file()),
        )
        pending = slot.parent / f"{name}.pending"
        if pending.exists():
            shutil.rmtree(pending)
        if found:
            shutil.copytree(found[-1], pending, symlinks=True)
        else:
            pending.mkdir(parents=True)
        pending.rename(shared)
    # Docker would create a missing mount point as root inside the slot.
    for inside in (
        ("data", "games", title, "cache"),
        ("home", ".cache", "mesa_shader_cache"),
    ):
        dossier_sans_lien(slot, *inside)
    return [
        "-v",
        f"{slot.parent / 'cache'}:/run-data/data/games/{title}/cache",
        "-v",
        f"{slot.parent / 'mesa'}:/run-data/home/.cache/mesa_shader_cache",
    ]


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


def ryubing_launch(config: dict, rom: Path, slot: Path) -> EngineLaunch:
    profile = ("data", "profiles", "controller", "nel3ab.json")
    with ouvrir_sans_lien(slot, *profile, mode="wb") as stream:
        stream.write((TOOLS / "ryubing-pro-controller.json").read_bytes())
    command = [
        "/emulator/publish/Ryujinx",
        "--no-gui",
        "--root-data-dir",
        "/run-data/data",
        "--fullscreen",
        "--memory-manager-mode",
        "HostMapped",
        "--graphics-backend",
        "Vulkan",
        "--ignore-controller-applet",
    ]
    for seat in range(1, 5):
        command.extend(
            [
                f"--input-id-{seat}",
                f"{seat - 1}-00000003-045e-0000-8e02-000014010000",
                f"--input-profile-{seat}",
                "nel3ab",
            ]
        )
    command.append(f"/game/input{rom.suffix}")
    return EngineLaunch(
        engine_environment(config),
        [*update_mount(config, slot), *cache_mounts(slot)],
        command,
        4,
    )


def serve(
    config: dict,
    rom: Path,
    slot: Path,
    pads: Path,
    launch: EngineLaunch | None = None,
    snapshot=backup,
) -> None:
    # Instance names follow the private runtime, so integration rooms cannot
    # stop the production room. Docker refuses duplicates instead of stealing.
    token = pads.name
    engine = f"nel3ab-switch-{token}"
    helper = f"{engine}-pads"
    image = config["image"]
    launch = launch if launch is not None else ryubing_launch(config, rom, slot)
    if launch.controllers not in (1, 4):
        raise ValueError("A room must launch one or four controllers")
    uid, gid = str(os.getuid()), str(os.getgid())
    # Helper has no DAC override: share this one directory with the host group.
    pads.chmod(0o770)
    capture = None
    started_engine = started_helper = False
    selector = selectors.DefaultSelector()
    selector.register(sys.stdin, selectors.EVENT_READ)
    try:
        run(
            *pad_command(image, pads, helper, f"nel3ab {token}", launch.pad_layout),
            stdout=subprocess.DEVNULL,
        )
        started_helper = True
        deadline = time.monotonic() + 10
        while not (pads / "devices.json").exists():
            if time.monotonic() >= deadline:
                raise RuntimeError("Virtual controllers did not start")
            time.sleep(0.05)
        devices = json.loads((pads / "devices.json").read_text())
        if len(devices) != 4:
            raise RuntimeError("Virtual controller helper did not create four devices")
        args = [
            "docker",
            "run",
            "-d",
            "--name",
            engine,
            "--label",
            f"nel3ab.room-root={pads.parent}",
            "--network",
            "none",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--pids-limit=512",
            "--user",
            f"{uid}:{gid}",
            "--group-add",
            str(os.stat("/dev/dri/renderD128").st_gid),
            "--device=/dev/dri/renderD128",
            "--shm-size=8g",
            *launch.environment,
            "-v",
            f"{Path(config['engine']).resolve()}:/emulator:ro",
            "-v",
            f"{slot}:/run-data",
            "-v",
            f"{TOOLS}:/probe:ro",
            "-v",
            f"{pads}:/pads",
            "-v",
            f"{rom}:/game/input{rom.suffix}:ro",
        ]
        args.extend(launch.mounts)
        args.extend(cpu_pinning(config))
        for device in devices[: launch.controllers]:
            args.extend(["--device", device])
        args.extend(
            [
                image,
                "bash",
                "/probe/runtime.sh",
                *launch.command,
            ]
        )
        # Avoid accepting yesterday's display as the new compositor's readiness.
        (slot / "display.json").unlink(missing_ok=True)
        run(*args, stdout=subprocess.DEVNULL)
        started_engine = True
        retries: list[float] = []
        while not selector.select(0.1):
            status = run(
                "docker",
                "inspect",
                "-f",
                "{{.State.Running}}",
                engine,
                capture_output=True,
                text=True,
            ).stdout.strip()
            if status != "true":
                raise RuntimeError("Switch emulator exited; see lifecycle.json")
            if (slot / "display.json").exists() and (capture is None or capture.poll() is not None):
                # Killing docker exec alone leaves capture inside the container.
                run(
                    "docker",
                    "exec",
                    engine,
                    "python3",
                    "/probe/capture_control.py",
                    "stop",
                )
                now = time.monotonic()
                retries = [at for at in retries if now - at < 60]
                if len(retries) >= 3:
                    raise RuntimeError("Capture failed three times in one minute")
                retries.append(now)
                capture = subprocess.Popen(  # noqa: S603 -- private generated container name, fixed command
                    ["/usr/bin/docker", "exec", engine, "python3", "/probe/capture.py"]
                )
            time.sleep(0.4)
    finally:
        selector.close()
        try:
            if started_engine:
                stop_engine(engine, slot, capture, snapshot)
        finally:
            # A failed capture wait or a save-copy error must not retain inputs.
            if started_helper:
                run(
                    "docker",
                    "stop",
                    "--timeout",
                    "5",
                    helper,
                    stdout=subprocess.DEVNULL,
                )
                try:
                    with ouvrir_sans_lien(slot, "pads.log") as log:
                        run(
                            "docker",
                            "logs",
                            helper,
                            stdout=log,
                            stderr=subprocess.STDOUT,
                        )
                finally:
                    run("docker", "rm", helper, stdout=subprocess.DEVNULL)


def stop_engine(engine: str, slot: Path, capture, snapshot=backup) -> None:
    try:
        subprocess.run(  # noqa: S603 -- generated private container name, fixed command
            [
                "/usr/bin/docker",
                "exec",
                engine,
                "python3",
                "/probe/capture_control.py",
                "stop",
            ],
            check=False,
        )
        if capture:
            capture.wait(timeout=15)
    finally:
        # Always stop the actual container, even if its docker-exec client hung.
        # Only after Docker confirms the stop may its filesystem be copied.
        run("docker", "stop", "--timeout", "40", engine, stdout=subprocess.DEVNULL)
        try:
            status = run(
                "docker",
                "inspect",
                "-f",
                "{{json .State}}",
                engine,
                capture_output=True,
                text=True,
            ).stdout
            with ouvrir_sans_lien(slot, "exit.json") as sortie:
                sortie.write(status)
            snapshot(slot)
            with ouvrir_sans_lien(slot, "emulator.log") as log:
                run("docker", "logs", engine, stdout=log, stderr=subprocess.STDOUT)
        finally:
            run("docker", "rm", engine, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
