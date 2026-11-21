"""Où chaque console range ses jeux, et lesquelles la salle sait faire tourner.

# Une vue sur le manifeste des consoles

Le dossier, les extensions, « jouable », « expérimentale » et la façon dont un
jeu s'inscrit viennent de `consoles/consoles.json`, lu par
`nel3ab_control.consoles` (ADR D22). Ce module n'en recopie rien: il traduit ce
que le manifeste dit en ce que l'import demande.

Il ajoute une seule chose, que le manifeste ne porte pas exprès: les consoles
que l'identifiant RECONNAÎT sans que la salle les connaisse (NES, Game Boy,
PlayStation…). Elles n'ont qu'un nom, ni dossier ni moteur, et restent donc en
quarantaine. Le jour où l'une entre au manifeste, son entrée d'ici devient
inutile et le manifeste l'emporte.

# Le dossier se choisit par son nom

Le salon lit la même liste que le worker, `NEL3AB_ROM_DIR`. Un jeu GameCube va
dans le dossier de cette liste qui porte le nom du champ `folder` de sa console
(`gc`), un jeu Wii dans `wii`. Un nom et pas une position: l'ordre de la liste
est celui du balayage du worker, et le changer ne doit pas envoyer les jeux Wii
dans le dossier GameCube.
"""

from dataclasses import dataclass
from pathlib import Path

from nel3ab_control import consoles as manifeste


@dataclass(frozen=True)
class Console:
    """Une console, telle que l'import en a besoin."""

    code: str
    libelle: str
    #: Le nom du dossier qui la reçoit dans `NEL3AB_ROM_DIR`, ou rien.
    dossier: str | None
    #: Vrai quand la salle sait déjà la faire tourner.
    jouable: bool
    #: Les formats lus par l'identifiant que le balayage liste pour elle.
    formats: frozenset[str] = frozenset()
    experimentale: bool = False
    #: `dolphin-header`: le disque suffit. `sidecar`: il faut une inscription
    #: écrite à côté du jeu (`<fichier>.nel3ab.json`). `none`: rien ne l'inscrit.
    inscription: str = "none"


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

#: Reconnues par l'identifiant, absentes du manifeste: un nom, rien d'autre.
RECONNUES = {
    "xbox": "Xbox",
    "nes": "NES",
    "n64": "Nintendo 64",
    "gb": "Game Boy",
    "gbc": "Game Boy Color",
    "gba": "Game Boy Advance",
    "ds": "Nintendo DS",
    "md": "Mega Drive",
    "ps1": "PlayStation",
    "ps2": "PlayStation 2",
}


def _depuis(entree: manifeste.Console) -> Console:
    return Console(
        code=entree.code,
        libelle=entree.label,
        dossier=entree.folder,
        jouable=entree.playable,
        formats=frozenset(e for e in entree.extensions if e in EXTENSIONS),
        experimentale=entree.experimental,
        inscription=entree.registration,
    )


def console(code: str | None, source: manifeste.Manifeste = manifeste.CONSOLES) -> Console | None:
    """La console de ce code: celle du manifeste d'abord, sinon un simple nom."""
    entree = source.console(code or "")
    if entree is not None:
        return _depuis(entree)
    if code in RECONNUES:
        return Console(code, RECONNUES[code], None, False)
    return None


def libelle(code: str | None) -> str:
    """Le nom qu'une personne lit, ou « console inconnue »."""
    trouvee = console(code)
    return trouvee.libelle if trouvee else "console inconnue"


def dossiers(rom_dir: str) -> list[Path]:
    """Les dossiers de jeux, dans l'ordre de la liste, sans les vides."""
    return [Path(morceau) for morceau in rom_dir.split(":") if morceau.strip()]


def destination(code: str, rom_dir: str) -> Path | None:
    """Le dossier de la liste qui porte le nom de cette console, ou rien."""
    trouvee = console(code)
    if trouvee is None or trouvee.dossier is None:
        return None
    return next((d for d in dossiers(rom_dir) if d.name == trouvee.dossier), None)
