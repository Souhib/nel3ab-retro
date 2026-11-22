"""L'emplacement de sauvegarde d'une salle: son nom, son chemin, son verrou.

Repris de `docker/switch-room.py` (SLOT, puis le début des trois `main()`), où
il reste jusqu'à la bascule de chaque console.

L'hôte ne suit aucun lien dans un emplacement. Le conteneur du moteur le monte
en écriture (`-v {slot}:/run-data`) sous le compte de l'hôte: un moteur
compromis peut y laisser un lien vers un fichier de l'hôte qu'il ne voit pas,
et l'hôte, en écrivant un journal ou en copiant une sauvegarde, aurait écrit ou
lu ce fichier à sa place (relecture du 22 novembre 2026). `ouvrir_sans_lien`,
`dossier_sans_lien` et `sans_lien` sont recopiés tels quels dans
`docker/switch-room.py`; `test_differentiel.py` compare leur arbre.
"""

from __future__ import annotations

import contextlib
import errno
import fcntl
import os
import re
import stat
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import IO

#: Les emplacements de sauvegarde qu'une salle peut demander.
#:
#: Les deux de la salle, ou celui d'une personne. Un SEUL segment, sans barre ni
#: point: ce texte vient du worker et sert à construire un chemin sous l'état
#: des jeux, donc un `..` ou une barre y ouvrirait n'importe quel dossier.
SLOT = r"^(neuve|debloquee|joueur-[a-z0-9][a-z0-9-]*)$"
#: Le message d'un lien refusé, suivi du chemin où il se trouve.
REFUS = "l'hôte ne suit aucun lien de l'emplacement"


def valide(choix: str) -> bool:
    return re.fullmatch(SLOT, choix) is not None


def chemin(state: str, titre: str, choix: str) -> Path:
    """`<state>/<titre en minuscules>/<emplacement>`, comme `unlocked::directories`.

    Les minuscules ne changent rien à la Switch ni à la Switch 2, qui n'acceptent
    que des minuscules; la Xbox 360 les impose déjà (xbox360-room.py).
    """
    return Path(state).resolve() / titre.lower() / choix


@contextmanager
def tenu(emplacement: Path) -> Iterator[None]:
    """L'emplacement, créé et verrouillé pour toute la partie, ou un refus immédiat."""
    emplacement.mkdir(parents=True, exist_ok=True)
    with ouvrir_sans_lien(emplacement, "running.lock") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


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
