"""Le cycle de vie d'une salle externe: manettes, moteur, capture, arrêt.

`principal` est ce qu'une enveloppe appelle (`principal("x360")`). Elle refait
les trois `main()` d'aujourd'hui, dans leur ordre: titre et emplacement
vérifiés, configuration lue, emplacement verrouillé, préparation du moteur,
première copie, puis `serve`. Elle ne lit que trois fichiers: la table des
consoles du socle (du code), la fiche du moteur et sa configuration. Jamais
`consoles/consoles.json`: un manifeste faux arrêterait sinon toutes les salles
externes (ADR D22, règle 6).

`serve` et `stop_engine` sont déplacés de `docker/switch-room.py`, qui garde sa
propre copie jusqu'à la bascule de la Switch. Deux différences seulement, et
`test_differentiel.py` prouve qu'elles ne changent aucune commande:

- `launch` est exigé, et peut être une fonction: le plan de Ryubing se calcule
  à l'endroit même où switch-room.py appelait `ryubing_launch`;
- `snapshot` est exigé: la copie d'un emplacement appartient au moteur.

Les messages restent ceux d'aujourd'hui, « Switch emulator exited » compris:
le banc doré les fige, et les relevés existants les cherchent.

Aucune fonction de ce module n'importe dans son corps (ruff PLC0415): une
salle lit tout son code au démarrage, et un import paresseux lirait au moment
de l'arrêt une version plus récente de l'arbre principal.
"""

from __future__ import annotations

import importlib
import json
import os
import selectors
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from moteurs.socle import consoles, emplacement, fiche
from moteurs.socle.emplacement import ouvrir_sans_lien
from moteurs.socle.lancement import DEPOT, TOOLS, EngineLaunch, cpu_pinning, pad_command, run

#: Ce qu'un module de moteur fournit au socle (moteurs/<moteur>/adaptateur.py).
INTERFACE = ("TITRE", "choisir", "preparer", "backup")


@dataclass(frozen=True)
class Contexte:
    """Ce que le socle sait d'une partie quand il demande au moteur de la préparer."""

    console: consoles.Console
    fiche: fiche.Fiche
    #: La configuration de la console, après `choisir` (un moteur par titre).
    config: dict
    rom: Path
    titre: str
    emplacement: Path
    #: Le dossier runtime que le worker a créé pour cette salle.
    pads: Path


def charger_adaptateur(moteur: str) -> ModuleType:
    """Le module du moteur, chargé AVANT toute partie avec tout ce qu'il importe."""
    module = importlib.import_module(f"moteurs.{moteur}.adaptateur")
    manquants = [nom for nom in INTERFACE if not hasattr(module, nom)]
    if manquants:
        raise TypeError(f"moteurs/{moteur}/adaptateur.py ne fournit pas {manquants}")
    return module


def verifier_origine(script: str) -> None:
    """L'enveloppe lancée et ce socle viennent du même dépôt.

    L'enveloppe ajoute son dépôt EN FIN de chemin d'import, pour que la
    bibliothèque standard passe toujours avant. Un autre paquet `moteurs`
    installé plus tôt sur le chemin serait donc pris à sa place, en silence.
    """
    depot = Path(script).resolve().parents[1]
    if depot != DEPOT:
        raise RuntimeError(f"le socle chargé vient de {DEPOT}, l'enveloppe de {depot}")


def charger(code: str) -> tuple[consoles.Console, fiche.Fiche, ModuleType]:
    """Tout ce que la salle de `code` lit avant sa partie: la console de la table, la
    fiche de son moteur et le module du moteur, avec ce qu'il importe.

    `principal` commence par là. `deploy/salles-adaptateurs.sh` l'appelle aussi,
    avec le python3 de l'unité: importer l'enveloppe seule ne charge ni le module
    ni la fiche, et un module qui ne s'importe pas passerait deploy-check.
    """
    console = consoles.externe(code)
    lue = fiche.lire(DEPOT / "moteurs" / console.engine / "moteur.json")
    return console, lue, charger_adaptateur(console.engine)


def principal(
    code: str, argv: Sequence[str] | None = None, environ: Mapping[str, str] | None = None
) -> None:
    """La salle de la console `code`, avec les arguments du worker (external.rs)."""
    if argv is None:
        verifier_origine(sys.argv[0])
        argv = sys.argv[1:]
    environ = os.environ if environ is None else environ
    console, lue, module = charger(code)
    rom, titre, choix, pads = argv
    if not module.TITRE.fullmatch(titre) or not emplacement.valide(choix):
        raise ValueError(f"Invalid {console.label} title or save slot")
    config = module.choisir(json.loads(Path(environ[console.config_env]).read_text()), titre)
    slot = emplacement.chemin(config["state"], titre, choix)
    with emplacement.tenu(slot):
        contexte = Contexte(
            console, lue, config, Path(rom).resolve(), titre, slot, Path(pads).resolve()
        )
        # Tout contrôle et toute écriture du moteur AVANT la première copie: le
        # banc doré l'a vu, une copie faite plus tôt ne contient pas la même chose.
        plan = module.preparer(contexte)
        module.backup(slot)
        serve(config, contexte.rom, slot, contexte.pads, plan, module.backup)


def serve(
    config: dict,
    rom: Path,
    slot: Path,
    pads: Path,
    launch: EngineLaunch | Callable[[], EngineLaunch],
    snapshot: Callable[[Path], Path | None],
) -> None:
    # Instance names follow the private runtime, so integration rooms cannot
    # stop the production room. Docker refuses duplicates instead of stealing.
    token = pads.name
    engine = f"nel3ab-switch-{token}"
    helper = f"{engine}-pads"
    image = config["image"]
    # Un plan différé se calcule ICI, après la lecture de l'image: c'est la place
    # de `ryubing_launch` dans switch-room.py, et une configuration sans image
    # doit échouer avant le profil de manette et les caches partagés.
    launch = launch() if callable(launch) else launch
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


def stop_engine(engine: str, slot: Path, capture, snapshot) -> None:
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
