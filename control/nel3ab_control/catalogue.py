"""La bibliothèque des jeux, lisible sans salle ouverte (ADR D24).

Chaque worker écrit `catalogue.json` dans son répertoire de session à chaque
balayage, c'est-à-dire à chaque démarrage : la liste des jeux avec la clé, le
titre nettoyé, la console et la présence d'une jaquette. Le salon lit ces
fichiers au lieu de refaire le balayage lui-même. Il n'a donc ni à recopier le
nettoyage des titres, écrit en Rust, ni à lancer le conteneur `dolphin-tool` qui
dit la console d'un disque.

Le plus FRAIS gagne. Toutes les salles balaient les mêmes dossiers, mais une
salle démarrée avant l'arrivée d'un fichier décrit encore la liste d'avant.

Un fichier illisible, d'une version inconnue ou mal formé est écarté en entier,
et le suivant prend sa place. Garder la moitié lisible d'un fichier ferait
afficher une bibliothèque à qui il manque des jeux sans le dire.
"""

import json
import logging
from pathlib import Path

from pydantic import BaseModel, Field

from nel3ab_control.consoles import titre_valide
from nel3ab_control.worker import valid_key

LOG = logging.getLogger(__name__)

#: Le nom que le worker donne au fichier dans son répertoire de session.
NAME = "catalogue.json"

#: La version écrite par `nel3ab_emulator::library_file`. Une autre est écartée.
VERSION = 1

#: Ce que le salon accepte de lire par fichier. Un jeu y pèse environ 300 octets,
#: titre, éditeur et phrase compris : huit Mio laissent la place à vingt mille
#: jeux, et bornent la mémoire si un fichier grossit par erreur.
SIZE_MAX = 8 * 1024 * 1024


class CatalogueGame(BaseModel):
    """Un jeu de la bibliothèque, tel que le worker l'a décrit."""

    key: str = Field(description="Son nom de fichier, ce qui le désigne (ADR D23).")
    name: str = Field(description="Son titre, nettoyé par le worker.")
    console: str = Field(description="Le code de sa console, ou « ? ».")
    art: bool = Field(description="Vrai quand une salle peut servir son image.")
    maker: str | None = None
    about: str | None = None
    title_id: str | None = Field(
        default=None,
        description="L'identifiant du titre d'un jeu inscrit (Switch), seize chiffres "
        "hexadécimaux en minuscules: le nom de ses dossiers de sauvegarde.",
    )


class Catalogue(BaseModel):
    """La bibliothèque la plus fraîche que les salles ont écrite."""

    scanned_ms: int = Field(
        ge=0, description="Quand le balayage a eu lieu, en millisecondes depuis 1970."
    )
    room: int = Field(ge=1, description="Le numéro de la salle qui l'a écrite.")
    games: list[CatalogueGame]


def _entree(brute: object) -> CatalogueGame | None:
    if not isinstance(brute, dict):
        return None
    key, name, console, art = (brute.get(f) for f in ("key", "name", "console", "art"))
    maker, about = brute.get("maker"), brute.get("about")
    # Un identifiant mal formé ne fait pas écarter le jeu: il ne sert qu'à
    # relier des sauvegardes, et un jeu sans lui reste un jeu. Sa forme est celle
    # de SA console (`consoles.FORMES_TITRE`), en minuscules comme les dossiers
    # d'un emplacement: jusqu'au 22 novembre 2026, 16 chiffres pour toute console,
    # et le titre d'un jeu Xbox 360 était jeté.
    titre = brute.get("title_id")
    title_id = (
        titre
        if isinstance(titre, str)
        and isinstance(console, str)
        and titre_valide(console, titre, minuscules=True)
        else None
    )
    if (
        not isinstance(key, str)
        or not valid_key(key)
        or not isinstance(name, str)
        or not isinstance(console, str)
        or not isinstance(art, bool)
        or not (maker is None or isinstance(maker, str))
        or not (about is None or isinstance(about, str))
    ):
        return None
    return CatalogueGame(
        key=key, name=name, console=console, art=art, maker=maker, about=about, title_id=title_id
    )


def read_one(path: Path, room: int) -> Catalogue | None:
    """Un fichier de salle, entier et valide, ou rien."""
    try:
        with path.open("rb") as file:
            raw = file.read(SIZE_MAX + 1)
    except OSError:
        return None
    if len(raw) > SIZE_MAX:
        LOG.warning("catalogue trop gros, écarté: %s", path)
        return None
    try:
        said = json.loads(raw)
    except ValueError:
        LOG.warning("catalogue illisible, écarté: %s", path)
        return None
    if not isinstance(said, dict) or said.get("version") != VERSION:
        LOG.warning("catalogue d'une version inconnue, écarté: %s", path)
        return None
    scanned, roms = said.get("scanned_ms"), said.get("roms")
    if type(scanned) is not int or scanned < 0 or not isinstance(roms, list):
        LOG.warning("catalogue mal formé, écarté: %s", path)
        return None
    games = [_entree(rom) for rom in roms]
    if any(game is None for game in games):
        LOG.warning("catalogue avec une entrée mal formée, écarté: %s", path)
        return None
    keys = [game.key for game in games if game]
    if len(set(keys)) != len(keys):
        LOG.warning("catalogue avec deux fois la même clé, écarté: %s", path)
        return None
    return Catalogue(scanned_ms=scanned, room=room, games=[game for game in games if game])


def freshest(salles_dir: Path) -> Catalogue | None:
    """Le catalogue le plus récent parmi ceux des salles numérotées, ou rien.

    Seuls les dossiers dont le nom est un numéro de salle sont lus : c'est la
    forme que l'unité `nel3ab-worker@N` donne au répertoire de session.
    """
    try:
        rooms = [child for child in salles_dir.iterdir() if child.name.isdecimal()]
    except OSError:
        return None
    found: list[Catalogue] = []
    for child in rooms:
        numero = int(child.name)
        if numero >= 1 and (catalogue := read_one(child / NAME, numero)) is not None:
            found.append(catalogue)
    # À égalité d'heure, la plus petite salle: un choix fixe plutôt que l'ordre
    # du système de fichiers, qui changerait d'un appel à l'autre.
    if not found:
        return None
    return max(found, key=lambda one: (one.scanned_ms, -one.room))
