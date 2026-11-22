"""Les sauvegardes personnelles d'une personne, retrouvées sur le disque sans les ouvrir.

# Où elles sont

Une racine pour Dolphin, une par console servie par un adaptateur, et
seulement elles. Un parcours du dossier d'état entier tomberait sur les
centaines de dossiers d'essai Switch 2 qu'il contient (408 le 20 novembre
2026), et sur d'anciens emplacements migrés qui ne sont plus à personne.

- GameCube et Wii: `NEL3AB_PERSONAL_SAVE_ROOT/<clé du fichier>/joueur-…`
  (`core/crates/worker/src/main.rs`, chemin Dolphin);
- Switch, Switch 2 et Xbox 360: `<state>/<titre>/joueur-…`, où `state` est lu
  dans la configuration de l'adaptateur, comme le fait le worker
  (`unlocked::state_root`). Les consoles viennent du manifeste (`racines`), et
  le titre a la forme de sa console (`consoles.FORMES_TITRE`), en minuscules
  comme l'adaptateur l'écrit.

Le nom `joueur-…` est recalculé par `personnes.dossier_personnel`, tenu par les
vecteurs communs avec le Rust. Un ancien nom sans empreinte ne correspond jamais.

# Ce qui est lu

Des métadonnées par `lstat`, jamais un contenu: des tubes nommés vivent dans les
emplacements Switch (`full.h264`), et un lecteur qui en OUVRE un attend pour
toujours. Aucun lien n'est suivi. Le parcours compte au plus `ENTREES_MAX`
entrées par emplacement.

# Ce qui est mesuré

La partie elle-même, pas l'emplacement entier. Un emplacement Switch porte une
copie complète du système émulé (452 Mo mesurés le 20 novembre 2026, pour
0,26 Mo de partie). On mesure donc le sous-arbre que l'adaptateur sauvegarde
lui-même: `data/bis/user` pour Ryubing (`switch-room.py`, `backup`), la NAND
`home/.local/share/eden/nand` pour Eden (`switch2-room.py`), `xenia/content`
pour Xenia (`xbox360-room.py`), sans son journal, ses captures d'écran ni son
cache de shaders. Pour Dolphin, l'emplacement entier, qui ne contient que la
partie.
"""

import json
import os
import re
import stat
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from nel3ab_control.consoles import CONSOLES, Manifeste, titre_valide
from nel3ab_control.personnes import dossier_personnel
from nel3ab_control.settings import Settings

#: Le plus d'entrées qu'un emplacement peut faire parcourir. Mesuré le 20 et le
#: 21 novembre 2026: 355 fichiers dans l'emplacement Switch personnel le plus
#: gros, 48 pour la Switch 2, un seul pour Dolphin. Vingt mille laissent une
#: grosse marge et bornent le temps d'une requête si un dossier grossit par
#: erreur. Au-delà, la mesure s'arrête et dit qu'elle est partielle.
ENTREES_MAX = 20_000

#: Ce qu'on accepte de lire d'une configuration d'adaptateur, comme le worker.
CONFIG_MAX = 65_536

#: Le sous-arbre qui porte la partie: celui de Dolphin, puis celui de chaque
#: console servie par un adaptateur, par son code. Voir le docstring du module.
#: Un essai exige une entrée pour chaque console externe du manifeste.
PARTIE = {
    "dolphin": Path(),
    "switch": Path("data/bis/user"),
    "switch2": Path("home/.local/share/eden/nand"),
    "x360": Path("xenia/content"),
}


@dataclass(frozen=True)
class Trouvee:
    """Une sauvegarde personnelle sur le disque."""

    #: « dolphin » (GameCube ou Wii, que le dossier seul ne distingue pas), ou
    #: le code de la console de l'adaptateur: « switch », « switch2 », « x360 ».
    famille: str
    #: Le nom du dossier du jeu: la clé du fichier pour Dolphin, le titre pour
    #: une console d'adaptateur.
    jeu: str
    dossier: Path


@dataclass(frozen=True)
class Mesure:
    octets: int
    derniere_ecriture: datetime | None
    fichiers: int
    versions: int
    copies: int
    partielle: bool


def racine_adaptateur(config: Path) -> Path | None:
    """Le dossier `state` d'une configuration d'adaptateur, ou rien.

    La même règle que `unlocked::state_root`: un fichier ordinaire, borné, et
    un chemin absolu. Rien plutôt qu'une erreur: une Switch non configurée est
    une machine sans sauvegarde Switch.
    """
    try:
        if not stat.S_ISREG(os.lstat(config).st_mode):
            return None
        with config.open("rb") as fichier:
            brut = fichier.read(CONFIG_MAX + 1)
    except OSError:
        return None
    if len(brut) > CONFIG_MAX:
        return None
    try:
        lu = json.loads(brut)
    except ValueError:
        return None
    etat = lu.get("state") if isinstance(lu, dict) else None
    if not isinstance(etat, str):
        return None
    racine = Path(etat)
    return racine if racine.is_absolute() else None


def _dossier(chemin: Path) -> bool:
    """Un vrai dossier, pas un lien vers un dossier."""
    try:
        return stat.S_ISDIR(os.lstat(chemin).st_mode)
    except OSError:
        return False


def _enfants(racine: Path) -> list[str]:
    try:
        return sorted(os.listdir(racine))
    except OSError:
        return []


def racines(settings: Settings, manifeste: Manifeste = CONSOLES) -> dict[str, Path | None]:
    """Le dossier `state` de chaque console servie par un adaptateur, par son code.

    Les consoles viennent du manifeste, et la configuration de chacune du
    réglage qui porte le nom de sa variable (`Settings.configuration_adaptateur`).
    Rien pour une console dont la configuration manque ou ne nomme aucun dossier.
    """
    return {
        console.code: racine_adaptateur(settings.configuration_adaptateur(console.config_env))
        for console in manifeste.consoles
        if console.config_env is not None
    }


def trouver(login: str, dolphin: Path, adaptateurs: Mapping[str, Path | None]) -> list[Trouvee]:
    """Les sauvegardes personnelles de cette adresse, sous Dolphin et chaque racine d'adaptateur.

    `adaptateurs` est ce que rend `racines`. Sous chacune, seul compte un dossier
    qui a la forme du titre de SA console: un titre Switch posé sous la racine
    Xbox 360 n'est pas une partie Xbox 360.
    """
    nom = dossier_personnel(login)
    if nom is None:
        return []
    trouvees: list[Trouvee] = []
    for jeu in _enfants(dolphin):
        if jeu.startswith("."):
            continue
        dossier = dolphin / jeu / nom
        if _dossier(dolphin / jeu) and _dossier(dossier):
            trouvees.append(Trouvee("dolphin", jeu, dossier))
    for famille, racine in adaptateurs.items():
        if racine is None:
            continue
        for titre in _enfants(racine):
            dossier = racine / titre / nom
            if (
                titre_valide(famille, titre, minuscules=True)
                and _dossier(racine / titre)
                and _dossier(dossier)
            ):
                trouvees.append(Trouvee(famille, titre, dossier))
    return trouvees


def mesurer(trouvee: Trouvee) -> Mesure:
    """Taille, dernière écriture, versions et copies, par `lstat` seulement."""
    octets = fichiers = vues = 0
    derniere: float | None = None
    partielle = False
    # Chaque étage du sous-arbre doit être un vrai dossier: un lien posé à la
    # place de `data` ferait mesurer autre chose que la partie.
    debut = trouvee.dossier
    pile: list[Path] = [debut]
    for etage in PARTIE[trouvee.famille].parts:
        debut = debut / etage
        if not _dossier(debut):
            pile = []
            break
    else:
        pile = [debut]
    while pile:
        courant = pile.pop()
        try:
            with os.scandir(courant) as entrees:
                for entree in entrees:
                    vues += 1
                    if vues > ENTREES_MAX:
                        partielle = True
                        pile.clear()
                        break
                    info = entree.stat(follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        pile.append(Path(entree.path))
                    elif stat.S_ISREG(info.st_mode):
                        fichiers += 1
                        octets += info.st_size
                        derniere = (
                            info.st_mtime if derniere is None else max(derniere, info.st_mtime)
                        )
        except OSError:
            continue
    return Mesure(
        octets=octets,
        derniere_ecriture=datetime.fromtimestamp(derniere, tz=UTC)
        if derniere is not None
        else None,
        fichiers=fichiers,
        versions=_versions(trouvee.dossier),
        copies=_copies(trouvee),
        partielle=partielle,
    )


def _versions(dossier: Path) -> int:
    """Les anciennes parties qu'une « partie neuve » a rangées dans `history`.

    Le worker les nomme `<dossier>-<nanosecondes>` (`personal::begin`).
    """
    motif = re.compile(rf"^{re.escape(dossier.name)}-[0-9]+$")
    historique = dossier.parent / "history"
    return sum(1 for nom in _enfants(historique) if motif.match(nom) and _dossier(historique / nom))


def _copies(trouvee: Trouvee) -> int:
    """Les copies qu'un adaptateur fait au début et à la fin d'une partie, dans `backups`."""
    if trouvee.famille == "dolphin":
        return 0
    copies = trouvee.dossier / "backups"
    return sum(1 for nom in _enfants(copies) if _dossier(copies / nom))
