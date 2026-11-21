#!/usr/bin/env python3
"""Expérimental: une salle Xbox 360, Xenia Edge sous le Sway de la salle Switch.

Le cycle de vie est celui de `switch-room.py` (manettes virtuelles, conteneur,
Sway, capture, arrêt). Ce module ne fournit que le plan de lancement de Xenia:
ses profils de joueur, sa ligne de commande et ses mesures.

Pourquoi quatre profils écrits d'avance: sans profil connecté, Xenia ouvre une
fenêtre « No Profiles Found » qui couvre l'image et retarde le plein écran
(essai du 21 novembre 2026). Aucune option ne la supprime; un profil sur le
disque, si. Le fichier `Account` d'un profil est chiffré par Xenia avec une clé
de la console; elle reste hors du dépôt, dans un fichier local que la
configuration nomme (`profile_key`), comme les clés de la Switch.
"""

from __future__ import annotations

import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "switch_room", Path(__file__).with_name("switch-room.py")
)
room = importlib.util.module_from_spec(spec)
spec.loader.exec_module(room)

TITLE = r"[0-9A-Fa-f]{8}"
#: Les outils qui tournent DANS le conteneur: lanceur, horodatage, manettes.
TOOLS = Path(__file__).resolve().parents[1] / "spikes" / "xbox360"
#: Le dossier de Xenia dans l'emplacement de sauvegarde, vu du conteneur.
STORAGE = "/run-data/xenia"
#: Les quatre joueurs: un profil hors ligne par place, connecté au démarrage.
#: Les identifiants suivent la forme que Xenia donne aux siens (0xE03 en tête).
PLAYERS = tuple((0xE030000000000001 + seat, f"Joueur {seat + 1}") for seat in range(4))
#: Tableau de bord et type « profil »: le chemin où Xenia cherche un profil.
DASHBOARD = "FFFE07D1"
PROFILE_TYPE = "00010000"
ACCOUNT_SIZE = 0x17C


def rc4(key: bytes, data: bytes) -> bytes:
    """Le RC4 de `xenia/kernel/util/crypto_utils.cc`, clé de 16 octets."""
    box = list(range(256))
    j = 0
    for i in range(256):
        j = (j + box[i] + key[i % len(key)]) % 256
        box[i], box[j] = box[j], box[i]
    out = bytearray()
    i = j = 0
    for byte in data:
        i = (i + 1) % 256
        j = (j + box[i]) % 256
        box[i], box[j] = box[j], box[i]
        out.append(byte ^ box[(box[i] + box[j]) % 256])
    return bytes(out)


def account(gamertag: str, key: bytes) -> bytes:
    """Un fichier `Account` hors ligne, chiffré comme `EncryptAccountFile`.

    Le compte est la structure X_XAMACCOUNTINFO (0x17C octets, gros-boutiste):
    deux mots de drapeaux à zéro, puis le nom en UTF-16, le reste à zéro. Le
    fichier fait 0x194 octets: 16 octets d'empreinte HMAC-SHA1, puis le tout
    chiffré en RC4 avec 8 octets de bourrage (0xFD, comme Xenia).
    """
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]*( [A-Za-z0-9]+)*", gamertag) or len(gamertag) > 15:
        raise ValueError(
            f"un nom de profil Xbox 360 a 1 à 15 lettres ou chiffres, pas {gamertag!r}"
        )
    if len(key) != 16:
        raise ValueError("la clé des profils fait 16 octets")
    info = bytearray(ACCOUNT_SIZE)
    nom = gamertag.encode("utf-16-be")
    info[8 : 8 + len(nom)] = nom
    clair = b"\xfd" * 8 + bytes(info)
    empreinte = hmac.new(key, clair, hashlib.sha1).digest()[:16]
    cle_rc4 = hmac.new(key, empreinte, hashlib.sha1).digest()[:16]
    return empreinte + rc4(cle_rc4, clair)


def read_account(data: bytes, key: bytes) -> str | None:
    """Le nom d'un `Account` déchiffré et vérifié comme `DecryptAccountFile`, ou None."""
    if len(data) != 0x18 + ACCOUNT_SIZE:
        return None
    cle_rc4 = hmac.new(key, data[:16], hashlib.sha1).digest()[:16]
    clair = rc4(cle_rc4, data[16:])
    if not hmac.compare_digest(hmac.new(key, clair, hashlib.sha1).digest()[:16], data[:16]):
        return None
    return clair[8 + 8 : 8 + 8 + 32].decode("utf-16-be").rstrip("\x00")


def profile_key(config: dict) -> bytes:
    """La clé des profils, lue dans son fichier local et jamais écrite ailleurs."""
    chemin = Path(config["profile_key"])
    if chemin.stat().st_mode & 0o077:
        raise ValueError(f"{chemin} doit n'être lisible que par son propriétaire (0600)")
    cle = bytes.fromhex(chemin.read_text().strip())
    if len(cle) != 16:
        raise ValueError(f"{chemin} doit contenir 16 octets en hexadécimal")
    return cle


def profiles(slot: Path, key: bytes) -> list[str]:
    """Écrit les profils absents de cet emplacement, garde ceux qui existent.

    Un profil existant porte déjà les sauvegardes de son joueur: le réécrire
    ne changerait que son nom, mais le laisser évite toute surprise.
    """
    content = slot / "xenia" / "content"
    xuids = []
    for xuid, gamertag in PLAYERS:
        identifiant = f"{xuid:016X}"
        dossier = content / identifiant / DASHBOARD / PROFILE_TYPE / identifiant
        fichier = dossier / "Account"
        if not fichier.exists():
            dossier.mkdir(parents=True, exist_ok=True)
            fichier.write_bytes(account(gamertag, key))
        xuids.append(identifiant)
    return xuids


def launch(config: dict, rom: Path, slot: Path) -> room.EngineLaunch:
    if rom.suffix.lower() != ".iso" or not rom.is_file():
        raise ValueError("Xbox 360 requires an existing registered ISO")
    executable = Path(config["engine"]) / "usr/bin/xenia_edge"
    if not executable.is_file():
        raise ValueError("Xbox 360 engine must be an extracted Xenia Edge AppImage")
    captures = config.get("captures_s", 0)
    if type(captures) is not int or not (captures == 0 or 10 <= captures <= 600):
        raise ValueError(f"captures_s must be 0 or 10 to 600 seconds, not {captures!r}")
    xuids = profiles(slot, profile_key(config))
    environment = [
        *room.engine_environment(config),
        "-e",
        f"NEL3AB_CAPTURES_S={captures}",
        # Xwayland, et pas de plein écran imposé par Sway: voir supervise.py.
        "-e",
        "NEL3AB_SWAY_X11=1",
    ]
    command = [
        "bash",
        "/xbox360/xenia.sh",
        f"/game/input{rom.suffix.lower()}",
        f"--storage_root={STORAGE}",
        f"--log_file={STORAGE}/xenia.log",
        "--gpu=vulkan",
        "--apu=sdl",
        "--hid=sdl",
        "--discord=false",
        # Sans menus ni barre d'outils, et sans le menu du bouton Guide par-dessus le jeu.
        "--fullscreen=true",
        "--guide_button=false",
        # Une notification à l'écran repasse chaque image par le fil de
        # l'interface, le chemin qui a figé l'image en Wayland le 21 novembre.
        "--show_achievement_notification=false",
        "--disable_game_window_mouse=true",
        "--keyboard_passthrough=true",
        "--mappings_file=/xbox360/manettes.txt",
        # Une ligne par seconde qui porte le compteur d'images du jeu (f:...).
        "--guest_scheduler_stats=true",
        *(f"--logged_profile_slot_{seat}_xuid={xuid}" for seat, xuid in enumerate(xuids)),
    ]
    return room.EngineLaunch(
        environment,
        ["-v", f"{TOOLS}:/xbox360:ro"],
        command,
        4,
        "xbox",
    )


def backup(slot: Path) -> Path | None:
    """Copie les sauvegardes des quatre profils avant et après la partie."""
    source = slot / "xenia" / "content"
    if not source.exists():
        return None
    target = slot / "backups" / f"{time.strftime('%Y%m%dT%H%M%S', time.gmtime())}-{time.time_ns()}"
    target.mkdir(parents=True)
    shutil.copytree(source, target / "content")
    return target


def main() -> None:
    rom, title, choice, pads = sys.argv[1:]
    if not re.fullmatch(TITLE, title) or not re.fullmatch(room.SLOT, choice):
        raise ValueError("Invalid Xbox 360 title or save slot")
    config = json.loads(Path(os.environ["NEL3AB_XBOX360_CONFIG"]).read_text())
    slot = Path(config["state"]).resolve() / title.lower() / choice
    slot.mkdir(parents=True, exist_ok=True)
    with (slot / "running.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        plan = launch(config, Path(rom).resolve(), slot)
        backup(slot)
        room.serve(config, Path(rom).resolve(), slot, Path(pads).resolve(), plan, backup)


if __name__ == "__main__":
    main()
