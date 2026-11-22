"""Amorce du banc doré: lance un vrai script de salle, sans Docker ni carte graphique.

    /usr/bin/python3 amorce.py <consigne.json> <script> <rom> <titre> <emplacement> <runtime>

Le banc (`banc.py`) la lance dans un interpréteur neuf, comme le worker lance
un adaptateur (`external.rs`: `python3 <script> <rom> <titre> <emplacement>
<runtime>`). Elle remplace seulement des points d'entrée de la bibliothèque
standard: `subprocess.run`, `subprocess.Popen`, `selectors.DefaultSelector`,
`time.sleep`, `time.monotonic`, `time.gmtime`, `time.time_ns`, `os.stat` pour
le seul nœud de rendu, et `os.getuid` et `os.getgid` quand la consigne donne
un autre compte. Puis elle exécute le VRAI chemin du script. Elle ne
connaît donc aucun nom interne d'un adaptateur, et passe telle quelle avant et
après une migration.

Pourquoi un interpréteur neuf et pas `runpy` dans le processus du test: le
22 novembre 2026, sur un faux dépôt, une enveloppe qui cherchait le paquet
`moteurs` au mauvais endroit passait par `runpy` depuis la racine et échouait
comme le worker la lance (`ModuleNotFoundError`). `runpy.run_path` garde
`sys.path[0]` sur le dossier courant, un lancement direct y met le dossier du
script. Ici, `sys.path[0]` est remplacé par ce que Python aurait mis pour un
lancement direct, et `test_salles_dore.py` le compare à un vrai lancement.

Le journal est écrit à la sortie dans le fichier que nomme la consigne, hors de
l'arbre que le banc relève.
"""

import calendar
import json
import os
import runpy
import selectors
import subprocess
import sys
import time
from pathlib import Path

#: 22 novembre 2026, 00:00 UTC: l'heure des copies datées de chaque scénario.
HEURE = calendar.timegm((2026, 11, 22, 0, 0, 0))
NOEUD_DE_RENDU = "/dev/dri/renderD128"
#: Le groupe du nœud de rendu, fixé: la CI n'a pas de carte, et la valeur de
#: cette machine ne dit rien de l'adaptateur.
GROUPE_DU_RENDU = 44


class Horloge:
    """Une horloge monotone que seules les attentes font avancer."""

    def __init__(self) -> None:
        self.maintenant = 1000.0
        self.nanos = HEURE * 1_000_000_000

    def dormir(self, secondes: float) -> None:
        self.maintenant += secondes

    def monotone(self) -> float:
        return self.maintenant

    def ns(self) -> int:
        self.nanos += 1
        return self.nanos


def options(arguments: dict) -> dict[str, str]:
    """Les arguments nommés d'un appel, lisibles et sans adresse mémoire."""
    lisibles = {}
    for nom, valeur in sorted(arguments.items()):
        if valeur is subprocess.DEVNULL:
            lisibles[nom] = "DEVNULL"
        elif valeur is subprocess.STDOUT:
            lisibles[nom] = "STDOUT"
        elif valeur is subprocess.PIPE:
            lisibles[nom] = "PIPE"
        elif hasattr(valeur, "name") and hasattr(valeur, "write"):
            lisibles[nom] = f"fichier:{valeur.name}"
        else:
            lisibles[nom] = repr(valeur)
    return lisibles


def monte(argv: list[str], interieur: str) -> Path:
    """Le dossier de l'hôte monté à `interieur` par une commande `docker run`."""
    for position, valeur in enumerate(argv[:-1]):
        if valeur == "-v" and argv[position + 1].endswith(f":{interieur}"):
            return Path(argv[position + 1][: -len(interieur) - 1])
    raise AssertionError(f"aucun montage {interieur} dans {argv}")


class Docker:
    """Ce que Docker répondrait, réglé par la consigne du scénario."""

    def __init__(self, consigne: dict, journal: list) -> None:
        self.consigne = consigne
        self.journal = journal
        self.inspections = 0

    def run(self, args, **arguments):
        argv = [str(valeur) for valeur in args]
        self.journal.append({"appel": "run", "options": options(arguments), "argv": argv})
        sortie = ""
        if argv[:2] == ["docker", "run"] and "/probe/pads.py" in argv:
            manettes = self.consigne["manettes"]
            if manettes is not None:
                appareils = [f"/dev/input/event{n}" for n in range(manettes)]
                (monte(argv, "/run-data") / "devices.json").write_text(json.dumps(appareils))
        elif argv[:2] == ["docker", "run"]:
            if self.consigne["echec_moteur"]:
                raise subprocess.CalledProcessError(125, argv)
            # Le compositeur du conteneur dit qu'il est prêt (supervise.py).
            (monte(argv, "/run-data") / "display.json").write_text(
                '{"WAYLAND_DISPLAY": "wayland-1"}'
            )
        elif argv[:4] == ["docker", "inspect", "-f", "{{.State.Running}}"]:
            self.inspections += 1
            arret = self.consigne["arret_apres"]
            sortie = "false\n" if arret is not None and self.inspections > arret else "true\n"
        elif argv[:4] == ["docker", "inspect", "-f", "{{json .State}}"]:
            sortie = '{"Status":"exited","ExitCode":0}\n'
        elif argv[:2] == ["docker", "logs"]:
            flux = arguments.get("stdout")
            if hasattr(flux, "write"):
                flux.write(f"journal de {argv[-1]}\n")
        texte = arguments.get("text") or arguments.get("universal_newlines")
        return subprocess.CompletedProcess(argv, 0, sortie if texte else sortie.encode(), "")

    def popen(self, args, **arguments):
        argv = [str(valeur) for valeur in args]
        self.journal.append({"appel": "Popen", "options": options(arguments), "argv": argv})
        return Capture(self.consigne["capture_meurt"])


class Capture:
    """La capture lancée par `docker exec`: vivante, ou morte dès son départ."""

    def __init__(self, meurt: bool) -> None:
        self.meurt = meurt

    def poll(self):
        return 1 if self.meurt else None

    def wait(self, timeout=None):
        return 0


def selecteur(consigne: dict, horloge: Horloge):
    """`selectors.DefaultSelector`: stdin reste muet `tours` fois, puis le worker le ferme."""

    class Selecteur:
        def __init__(self) -> None:
            self.vus = 0

        def register(self, *_arguments) -> None:
            return None

        def select(self, timeout=None):
            self.vus += 1
            if self.vus > consigne["tours"]:
                return [("stdin", selectors.EVENT_READ)]
            horloge.dormir(timeout or 0)
            return []

        def close(self) -> None:
            return None

    return Selecteur


def principal() -> int:
    chemin_consigne, script, *arguments = sys.argv[1:]
    consigne = json.loads(Path(chemin_consigne).read_text())
    journal: list = []
    horloge = Horloge()
    docker = Docker(consigne, journal)
    vrai_stat = os.stat
    vrai_gmtime = time.gmtime

    def faux_stat(chemin, *args, **kwargs):
        if os.fspath(chemin) == NOEUD_DE_RENDU:
            return os.stat_result((0o20660, 0, 0, 1, 0, GROUPE_DU_RENDU, 0, 0, 0, 0))
        return vrai_stat(chemin, *args, **kwargs)

    os.umask(0o022)
    if consigne["identite"] is not None:
        # Un autre compte que celui de la machine, comme le runner de la CI: le
        # banc vérifie que le doré n'en dépend pas.
        uid, gid = consigne["identite"]
        os.getuid = lambda: uid
        os.getgid = lambda: gid
    subprocess.run = docker.run
    subprocess.Popen = docker.popen
    selectors.DefaultSelector = selecteur(consigne, horloge)
    time.sleep = horloge.dormir
    time.monotonic = horloge.monotone
    time.time_ns = horloge.ns
    time.gmtime = lambda secondes=None: vrai_gmtime(HEURE if secondes is None else secondes)
    os.stat = faux_stat
    # Ce que Python aurait posé pour `python3 <script>`: le dossier réel du script
    # en tête, et le script en argv[0].
    sys.path[0] = os.path.dirname(os.path.realpath(script))
    sys.argv = [script, *arguments]
    erreur = None
    refusee = None
    code = 0
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit as sortie:
        code = sortie.code if isinstance(sortie.code, int) else 1
    except BaseException as exception:
        # Toute fin, import manqué compris: le worker la verrait aussi.
        erreur = f"{type(exception).__name__}: {exception}"
        code = 1
        if isinstance(exception, subprocess.CalledProcessError) and isinstance(
            exception.cmd, list | tuple
        ):
            # Son message cite la commande entière: le banc la normalise argument
            # par argument, comme les autres (compte et chemins). Une commande
            # en texte reste telle quelle, et le contrôle de fuites la verrait.
            refusee = [str(valeur) for valeur in exception.cmd]
    Path(consigne["journal"]).write_text(
        json.dumps({"commandes": journal, "erreur": erreur, "commande_refusee": refusee})
    )
    return code


if __name__ == "__main__":
    sys.exit(principal())
