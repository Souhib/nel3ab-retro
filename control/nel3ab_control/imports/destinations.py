"""Où chaque console range ses jeux, et lesquelles la salle sait faire tourner.

# Une seule table, en attendant le registre des consoles

Le registre `consoles/consoles.json` est en cours d'écriture: une entrée par
console, avec son code, son libellé, son dossier, ses extensions et ses
drapeaux « jouable » et « expérimentale ». Quand il existera, ce module le
LIRA au lieu de tenir sa propre table. D'ici là, cette table est le seul
endroit de l'import qui sait qu'une console existe, pour qu'il n'y ait qu'un
endroit à remplacer.

# Le dossier se choisit par son nom

Le salon lit la même liste que le worker, `NEL3AB_ROM_DIR`. Un jeu GameCube va
dans le dossier de cette liste qui s'appelle `gc`, un jeu Wii dans `wii`. Un
nom et pas une position: l'ordre de la liste est celui du balayage du worker,
et le changer ne doit pas envoyer les jeux Wii dans le dossier GameCube.
"""

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Console:
    """Une console, telle que l'import en a besoin."""

    code: str
    libelle: str
    #: Le nom du dossier qui la reçoit dans `NEL3AB_ROM_DIR`, ou rien.
    dossier: str | None
    #: Vrai quand la salle sait déjà la faire tourner.
    jouable: bool
    #: Les formats que le balayage du worker liste pour elle.
    formats: frozenset[str] = frozenset()
    experimentale: bool = False


DISQUES_NINTENDO = frozenset({"iso", "rvz", "gcz", "ciso"})

CONSOLES = {
    console.code: console
    for console in (
        Console("gc", "GameCube", "gc", True, DISQUES_NINTENDO),
        Console("wii", "Wii", "wii", True, DISQUES_NINTENDO),
        Console("switch", "Switch", "switch", True, frozenset({"nsp", "xci"})),
        Console("switch2", "Switch 2", "switch2", True, frozenset({"nup"}), experimentale=True),
        # Pas encore d'adaptateur: reconnue, jamais rangée.
        Console("x360", "Xbox 360", "xbox360", False),
        Console("xbox", "Xbox", None, False),
        Console("nes", "NES", None, False),
        Console("n64", "Nintendo 64", None, False),
        Console("gb", "Game Boy", None, False),
        Console("gbc", "Game Boy Color", None, False),
        Console("gba", "Game Boy Advance", None, False),
        Console("ds", "Nintendo DS", None, False),
        Console("md", "Mega Drive", None, False),
        Console("ps1", "PlayStation", None, False),
        Console("ps2", "PlayStation 2", None, False),
    )
}

#: L'extension qu'un fichier rangé reçoit, d'après son format lu et jamais
#: d'après le nom qu'il avait. `.iso` et non `.gcm`: les deux sont listés par
#: la salle, et un seul nom par format évite deux clés de sauvegarde.
EXTENSIONS = {
    "iso": ".iso",
    "rvz": ".rvz",
    "gcz": ".gcz",
    "ciso": ".ciso",
    "nsp": ".nsp",
    "xci": ".xci",
    "nup": ".nup",
}


def libelle(code: str | None) -> str:
    """Le nom qu'une personne lit, ou « console inconnue »."""
    console = CONSOLES.get(code or "")
    return console.libelle if console else "console inconnue"


def dossiers(rom_dir: str) -> list[Path]:
    """Les dossiers de jeux, dans l'ordre de la liste, sans les vides."""
    return [Path(morceau) for morceau in rom_dir.split(":") if morceau.strip()]


def destination(code: str, rom_dir: str) -> Path | None:
    """Le dossier de la liste qui porte le nom de cette console, ou rien."""
    console = CONSOLES.get(code)
    if console is None or console.dossier is None:
        return None
    return next((d for d in dossiers(rom_dir) if d.name == console.dossier), None)
