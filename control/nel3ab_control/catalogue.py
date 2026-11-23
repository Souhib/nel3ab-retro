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

import hashlib
import json
import logging
import os
import stat
import struct
from pathlib import Path

from pydantic import BaseModel, Field

from nel3ab_control import session_salle
from nel3ab_control.consoles import titre_valide
from nel3ab_control.imports.destinations import dossiers
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

#: Le dossier où le worker écrit l'image de chaque jeu, à côté de ce fichier
#: (`nel3ab_emulator::ART_FOLDER`, ADR D45).
ART_FOLDER = "art"

#: La plus grosse image servie, la borne même du worker (`ART_MAX_BYTES`): une
#: image déposée est lue jusqu'à un Mio, et une bannière GameCube pèse
#: quelques kilo-octets. Au-delà, le fichier n'est pas celui que le worker écrit.
ART_MAX = 1024 * 1024

#: Les huit premiers octets de tout fichier PNG.
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


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
        description="L'identifiant du titre d'un jeu inscrit par fiche, à la forme de sa "
        "console (16 chiffres pour la Switch, 8 pour la Xbox 360), en minuscules: le nom "
        "de ses dossiers de sauvegarde.",
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


def art_file_name(key: str) -> str:
    """Le nom que le worker donne à l'image d'un jeu: l'empreinte SHA-256 de sa clé.

    Le même calcul que `nel3ab_emulator::art_file_name`; les deux essais
    épinglent les mêmes valeurs. La clé n'est jamais jointe à un chemin.
    """
    return hashlib.sha256(key.encode()).hexdigest() + ".png"


def art_of(salles_dir: Path, key: str) -> bytes | None:
    """L'image d'un jeu, lue dans la salle qui a écrit le catalogue le plus frais.

    Rien pour un jeu absent du catalogue ou annoncé sans
    image, et un fichier absent, trop gros, qui n'est pas un PNG ou qui est un
    lien. La salle du catalogue et pas une autre: c'est elle qui a balayé les
    jeux en dernier, et son dossier `art` suit le même balayage. Le dossier de
    session est monté en écriture dans un conteneur, donc ni le dossier `art`
    ni l'image ne sont suivis s'ils sont des liens (ADR D36).
    """
    # La clé n'est comparée qu'aux clés du catalogue, que `read_one` a déjà
    # passées à `valid_key`: une clé en forme de chemin n'y est jamais égale.
    catalogue = freshest(salles_dir)
    if catalogue is None or not any(game.key == key and game.art for game in catalogue.games):
        return None
    image = session_salle.lire_dans(
        salles_dir, catalogue.room, ART_FOLDER, art_file_name(key), ART_MAX
    )
    if image is None or not image.startswith(PNG_SIGNATURE):
        return None
    return image


#: Ce qu'on ajoute au nom d'un jeu pour l'image que le propriétaire dépose à
#: côté de lui, lue par le worker (`banner::dropped_picture`, `switch::art`).
DEPOSEE = ".nel3ab.png"

#: Le plus grand côté d'une image déposée, la borne du worker: au-delà, il
#: l'ignore, et un dépôt accepté ici ne s'afficherait jamais.
COTE_MAX = 1024

#: Le plus long nom de fichier que Linux accepte, en octets (`NAME_MAX`).
NOM_MAX = 255

#: Ce que l'écriture ajoute au nom pendant qu'elle écrit (`session_salle.ecrire`:
#: un point, un point et douze chiffres hexadécimaux).
PROVISOIRE = 14


class ImageRefuseeError(ValueError):
    """Une image que le worker ne montrerait pas: le refus dit pourquoi."""


def controler_png(contenu: bytes) -> None:
    """Le contrôle léger d'une image déposée: taille, signature et en-tête.

    Le décodage complet reste au worker, qui refuse en silence une image qu'il
    ne sait pas lire. Ici, on refuse ce qu'on peut nommer avant d'écrire: un
    fichier trop gros, qui n'est pas un PNG, ou plus grand que 1024 pixels de
    côté. Lève `ImageRefuseeError`.
    """
    if len(contenu) > ART_MAX:
        raise ImageRefuseeError("l'image dépasse un Mio")
    if not contenu.startswith(PNG_SIGNATURE):
        raise ImageRefuseeError("ce n'est pas une image PNG")
    # Le premier morceau d'un PNG est toujours l'en-tête: 13 octets, « IHDR ».
    if len(contenu) < 24 or contenu[8:16] != b"\x00\x00\x00\x0dIHDR":
        raise ImageRefuseeError("l'en-tête de l'image est incomplet")
    largeur, hauteur = struct.unpack(">II", contenu[16:24])
    if not (1 <= largeur <= COTE_MAX and 1 <= hauteur <= COTE_MAX):
        raise ImageRefuseeError(f"l'image dépasse {COTE_MAX} pixels de côté")


def _dossier_du_jeu(rom_dir: str, key: str) -> Path | None:
    """Le premier dossier de jeux qui contient ce fichier, dans l'ordre du balayage.

    `key` vient du catalogue, donc d'un nom de fichier sans séparateur: elle
    désigne une entrée de ce dossier et rien d'autre. Seul un fichier
    ordinaire compte, comme dans `library::scan` du worker: un lien au même nom
    dans un dossier plus tôt n'est pas le jeu qu'il a gardé, et une image posée
    à côté de ce lien ne s'afficherait jamais.
    """
    for dossier in dossiers(rom_dir):
        try:
            mode = os.stat(dossier / key, follow_symlinks=False).st_mode
        except OSError:
            continue
        if stat.S_ISREG(mode):
            return dossier
    return None


def _jeu_connu(salles_dir: Path, rom_dir: str, key: str) -> Path | None:
    """Le dossier d'un jeu que le catalogue le plus frais liste, ou rien."""
    catalogue = freshest(salles_dir)
    if catalogue is None or not any(game.key == key for game in catalogue.games):
        return None
    return _dossier_du_jeu(rom_dir, key)


def deposer_image(salles_dir: Path, rom_dir: str, key: str, contenu: bytes) -> bool:
    """Écrit l'image du propriétaire à côté du jeu: `<jeu>.nel3ab.png`.

    Faux quand le jeu n'est pas au catalogue ou que son fichier est introuvable.
    L'écriture passe par le descripteur du dossier, sous un nom neuf renommé
    par-dessus: un lien laissé à ce nom est remplacé, pas suivi. Le worker la
    lit à son prochain démarrage. Lève `ImageRefuseeError` et `OSError`.
    """
    controler_png(contenu)
    nom = key + DEPOSEE
    if len(nom.encode()) + PROVISOIRE > NOM_MAX:
        raise ImageRefuseeError("le nom de ce jeu est trop long pour une image à côté de lui")
    dossier = _jeu_connu(salles_dir, rom_dir, key)
    if dossier is None:
        return False
    fd = os.open(dossier, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        session_salle.ecrire(fd, nom, contenu)
    finally:
        os.close(fd)
    return True


def retirer_image(salles_dir: Path, rom_dir: str, key: str) -> bool:
    """Retire l'image déposée à côté du jeu; faux quand le jeu est inconnu.

    Retirer une image absente n'est pas une erreur. Un lien à ce nom est retiré
    sans être suivi. Lève `OSError`.
    """
    dossier = _jeu_connu(salles_dir, rom_dir, key)
    if dossier is None:
        return False
    fd = os.open(dossier, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        session_salle.retirer(fd, key + DEPOSEE)
    finally:
        os.close(fd)
    return True
