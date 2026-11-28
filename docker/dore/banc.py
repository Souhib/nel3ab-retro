"""Le banc doré: un scénario de salle, lancé comme le worker, relevé sans Docker.

Un scénario prépare un dossier jetable (configuration, moteur factice, ROM,
emplacements déjà joués), puis `lancer` exécute le vrai script de la salle dans
un `/usr/bin/python3` neuf par `amorce.py`. Le relevé garde trois choses:

- chaque appel à `subprocess.run` et `subprocess.Popen`, argument par argument,
  avec ses arguments nommés;
- l'exception finale (type et message) et le code de sortie;
- l'arbre du dossier jetable après la sortie: type, mode, empreinte de chaque
  fichier, chemin.

Tout chemin du dossier jetable devient `@TMP@`, celui du dépôt `@DEPOT@`, et
l'utilisateur et son groupe `@UID@` et `@GID@`. Un `/home/` restant après cela
est une fuite (`fuites`): une commande qui viserait l'état réel de la machine.

L'environnement est construit de zéro: aucune variable `NEL3AB_*` ni `PYTHON*`
du shell n'arrive au script, `HOME` est dans le dossier jetable, le dossier
courant aussi, hors du dépôt. Le worker lance l'adaptateur depuis `core/` par
le chemin `CARGO_MANIFEST_DIR/../../..` (main.rs): le banc donne au script ce
même chemin, `<dépôt>/core/crates/worker/../../../<script>`.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

DEPOT = Path(__file__).resolve().parents[2]
AMORCE = Path(__file__).with_name("amorce.py")
DORE = Path(__file__).parent
#: L'interpréteur que le worker trouve par le PATH de son unité aujourd'hui.
PYTHON = "/usr/bin/python3"
#: Le chemin du script vu du worker: CARGO_MANIFEST_DIR, puis ../../.. (main.rs).
DEPUIS_LE_WORKER = "core/crates/worker/../../.."
#: Le dossier runtime que le worker crée par salle (main.rs, préfixe room-switch-).
RUNTIME = "salles/1/room-switch-k3y9q2xw"
#: Ce que le banc copie pour un mutant: tout ce qu'un script de salle lit pendant
#: un scénario. Le second passage tourne sur cette copie non modifiée et doit
#: rendre le doré: c'est ce qui prouve que la liste est complète.
FERMETURE = (
    "docker/switch-room.py",
    "docker/switch2-room.py",
    "docker/xbox360-room.py",
    "docker/xbox360-room-socle.py",
    "moteurs",
    "spikes/switch-room/ryubing-pro-controller.json",
    "spikes/switch-room/latence/adaptateur-sonde.py",
)
#: Les dossiers d'où les scripts chargent du code: le banc n'y écrit rien, pas
#: même un cache d'octets (`test_le_banc_n_ecrit_rien_dans_le_depot`).
LUS = ("docker", "moteurs", "spikes/switch-room/latence")


@dataclass(frozen=True)
class Scenario:
    """Une partie d'une console, ou un refus, décrite par ce que la salle trouve."""

    nom: str
    #: La variable de configuration que le worker hérite de son unité.
    variable: str
    #: Écrit les fichiers du scénario sous la racine jetable et rend la
    #: configuration, ou None pour n'en écrire aucune.
    preparer: Callable[[Path], dict | None]
    titre: str
    emplacement: str = "neuve"
    rom: str = "jeu.xci"
    #: Les appareils que l'assistant des manettes annonce; None: jamais.
    manettes: int | None = 4
    #: Nombre d'inspections « en marche » avant que le moteur s'arrête seul.
    arret_apres: int | None = None
    capture_meurt: bool = False
    #: Tours de boucle avant que le worker ferme stdin.
    tours: int = 3
    echec_moteur: bool = False
    #: Conteneurs que Docker connaît déjà au départ : (nom, salle de leur
    #: étiquette `nel3ab.room-root`, relative à la racine jetable).
    orphelins: tuple[tuple[str, str], ...] = ()
    environnement: Mapping[str, str] = field(default_factory=dict)
    #: False pour un script que le worker ne lance pas (la sonde de latence).
    par_le_worker: bool = True


class AmorceCasseeError(RuntimeError):
    """L'amorce n'a pas écrit son journal: le banc lui-même est en faute."""


def chemin_du_script(depot: Path, script: str, par_le_worker: bool) -> Path:
    return depot / DEPUIS_LE_WORKER / script if par_le_worker else depot / script


def environnement(racine: Path, scenario: Scenario) -> dict[str, str]:
    """L'environnement du script, construit de zéro."""
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": str(racine / "home"),
        "LANG": "C.UTF-8",
        # Aucun cache d'octets écrit dans le dépôt: `git status` reste inchangé.
        "PYTHONDONTWRITEBYTECODE": "1",
        scenario.variable: str(racine / "config.json"),
        **scenario.environnement,
    }


def compte(identite: tuple[int, int] | None) -> tuple[int, int]:
    """Le compte que le script voit: celui de la machine, ou celui de la consigne."""
    return (os.getuid(), os.getgid()) if identite is None else identite


def lancer(
    scenario: Scenario,
    script: str,
    depot: Path = DEPOT,
    identite: tuple[int, int] | None = None,
) -> dict:
    """Exécute `script` du dépôt `depot` sur ce scénario et rend le relevé normalisé.

    `identite` fait voir au script un autre compte (uid, gid) que celui de la
    machine: le doré ne doit pas en dépendre, la CI tourne sous un autre.
    """
    with tempfile.TemporaryDirectory(prefix="dore-") as temporaire:
        base = Path(temporaire)
        racine, banc = base / "r", base / "banc"
        for dossier in (racine / "home", racine / "cwd", racine / "roms", banc):
            dossier.mkdir(parents=True)
        config = scenario.preparer(racine)
        if config is not None:
            (racine / "config.json").write_text(json.dumps(config, indent=1))
        rom = racine / "roms" / scenario.rom
        if not rom.exists():
            rom.write_bytes(b"image du jeu")
        runtime = racine / RUNTIME
        runtime.mkdir(parents=True)
        journal = banc / "journal.json"
        consigne = banc / "consigne.json"
        consigne.write_text(
            json.dumps(
                {
                    "journal": str(journal),
                    "manettes": scenario.manettes,
                    "arret_apres": scenario.arret_apres,
                    "capture_meurt": scenario.capture_meurt,
                    "tours": scenario.tours,
                    "echec_moteur": scenario.echec_moteur,
                    "orphelins": [
                        [nom, str((racine / salle).resolve())] for nom, salle in scenario.orphelins
                    ],
                    "identite": identite,
                }
            )
        )
        fini = subprocess.run(  # noqa: S603 -- l'interpréteur système, l'amorce du dépôt
            [
                PYTHON,
                str(AMORCE),
                str(consigne),
                str(chemin_du_script(depot, script, scenario.par_le_worker)),
                str(rom),
                scenario.titre,
                scenario.emplacement,
                str(runtime),
            ],
            cwd=racine / "cwd",
            env=environnement(racine, scenario),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if not journal.exists():
            raise AmorceCasseeError(f"{scenario.nom}: aucun journal\n{fini.stderr}")
        brut = json.loads(journal.read_text())
        releve = {
            "commandes": brut["commandes"],
            "erreur": brut["erreur"],
            "sortie": fini.returncode,
            "flux": {"stdout": fini.stdout, "stderr": fini.stderr},
            "arbre": arbre(racine, remplacements(racine, depot)),
        }
        return normaliser(
            releve, remplacements(racine, depot), compte(identite), brut["commande_refusee"]
        )


def remplacements(racine: Path, depot: Path) -> list[tuple[str, str]]:
    """Les chemins à remplacer, le plus long d'abord, sous leur forme donnée et résolue."""
    paires = {
        str(racine): "@TMP@",
        str(racine.resolve()): "@TMP@",
        str(depot): "@DEPOT@",
        str(depot.resolve()): "@DEPOT@",
    }
    return sorted(paires.items(), key=lambda paire: -len(paire[0]))


def remplacer(texte: str, paires: Iterable[tuple[str, str]]) -> str:
    for avant, apres in paires:
        texte = texte.replace(avant, apres)
    return texte


def arbre(racine: Path, paires: list[tuple[str, str]]) -> list[str]:
    """Chaque entrée sous la racine: type, mode, empreinte d'un fichier, chemin.

    Un fichier texte est haché après remplacement des chemins: la configuration
    écrite par le scénario porte le dossier jetable, qui change à chaque fois.
    """
    lignes = []
    for chemin in sorted(racine.rglob("*"), key=lambda c: c.relative_to(racine).as_posix()):
        relatif = chemin.relative_to(racine).as_posix()
        etat = chemin.lstat()
        mode = f"{stat.S_IMODE(etat.st_mode):o}"
        if stat.S_ISLNK(etat.st_mode):
            lignes.append(f"l {mode} {relatif} -> {remplacer(os.readlink(chemin), paires)}")
        elif stat.S_ISDIR(etat.st_mode):
            lignes.append(f"d {mode} {relatif}/")
        elif stat.S_ISREG(etat.st_mode):
            contenu = chemin.read_bytes()
            with contextlib.suppress(UnicodeDecodeError):
                contenu = remplacer(contenu.decode("utf-8"), paires).encode("utf-8")
            lignes.append(f"f {mode} {hashlib.sha256(contenu).hexdigest()[:16]} {relatif}")
        else:
            lignes.append(f"? {mode} {relatif}")
    return lignes


def normaliser(
    releve: dict,
    paires: list[tuple[str, str]],
    identite: tuple[int, int] | None = None,
    refusee: list[str] | None = None,
) -> dict:
    """Chemins, utilisateur et groupe remplacés par leur nom, partout dans le relevé.

    `refusee` est la commande d'une `CalledProcessError` finale, notée à part par
    l'amorce: son message la cite en entier, et elle passe par la même
    normalisation que les autres commandes.
    """
    uid, gid = (str(valeur) for valeur in compte(identite))

    def argument(precedent: str | None, valeur: str) -> str:
        valeur = remplacer(valeur, paires)
        if precedent == "--user" and valeur == f"{uid}:{gid}":
            return "@UID@:@GID@"
        if precedent == "--group-add" and valeur == gid:
            return "@GID@"
        if valeur == f"HOST_UID={uid}":
            return "HOST_UID=@UID@"
        return valeur

    def commande(argv: list[str]) -> list[str]:
        return [
            argument(argv[position - 1] if position else None, valeur)
            for position, valeur in enumerate(argv)
        ]

    commandes = [
        {
            "appel": appel["appel"],
            "options": {nom: remplacer(valeur, paires) for nom, valeur in appel["options"].items()},
            "argv": commande(appel["argv"]),
        }
        for appel in releve["commandes"]
    ]
    erreur = releve["erreur"]
    if refusee is not None:
        citee = str(refusee)
        if erreur is None or erreur.count(citee) != 1:
            raise AmorceCasseeError(f"la commande refusée n'est pas citée une fois: {erreur}")
        erreur = erreur.replace(citee, str(commande(refusee)))
    return {
        **releve,
        "commandes": commandes,
        "erreur": None if erreur is None else remplacer(erreur, paires),
        "flux": {nom: remplacer(texte, paires) for nom, texte in releve["flux"].items()},
    }


#: Un chemin ABSOLU sous /home/: en début de texte ou après un séparateur. Le
#: `home/.cache` d'un emplacement, ou `/run-data/home/` dans le conteneur, n'en
#: sont pas: ce sont des dossiers relatifs à l'emplacement.
PERSONNEL = re.compile(r"(?:^|[\s:=,'\"(\[])/home/")


def fuites(releve: dict, identite: tuple[int, int] | None = None) -> list[str]:
    """Chaque texte du relevé qui nomme encore un dossier personnel de la machine,
    ou le compte (`uid:gid`) que le script a vu: le doré dépendrait alors de la
    machine. Le 22 novembre 2026, trois messages d'erreur gardaient `1000:1000`."""
    uid, gid = compte(identite)
    # Bornée par des non-chiffres: `0:0` ne doit pas se lire dans `00:00`.
    du_compte = re.compile(rf"(?<![0-9]){uid}:{gid}(?![0-9])")
    trouves = []

    def parcourir(valeur: object) -> None:
        if isinstance(valeur, str):
            if PERSONNEL.search(valeur) or du_compte.search(valeur):
                trouves.append(valeur)
        elif isinstance(valeur, dict):
            for element in valeur.values():
                parcourir(element)
        elif isinstance(valeur, list):
            for element in valeur:
                parcourir(element)

    parcourir(releve)
    return trouves


def copier_fermeture(cible: Path, depot: Path = DEPOT) -> Path:
    """Une copie de ce que les scripts lisent, avec le chemin que le worker emprunte."""
    for relatif in FERMETURE:
        source = depot / relatif
        destination = cible / relatif
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, destination, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            shutil.copy2(source, destination)
    # Le noyau parcourt chaque dossier du chemin `core/crates/worker/../../..`.
    (cible / "core/crates/worker").mkdir(parents=True, exist_ok=True)
    return cible


def lire_dore(nom: str) -> dict:
    return json.loads((DORE / f"{nom}.json").read_text(encoding="utf-8"))


def texte_dore(releve: dict) -> str:
    return json.dumps(releve, indent=1, ensure_ascii=False) + "\n"
