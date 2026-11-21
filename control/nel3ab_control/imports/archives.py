"""Ouvrir une archive sans la laisser écrire où elle veut.

Les jeux arrivent souvent en archive: le 20 novembre 2026, le dossier personnel
du serveur en tenait 14 en .rar, 4 en .7z et 2 en .zip. Une archive est aussi la
forme la plus simple d'un fichier hostile: une entrée `../../.bashrc`, un lien
vers `/etc`, ou quelques kilo-octets qui se décompressent en cent gigaoctets.

# La liste d'abord, puis une entrée à la fois

Toute l'archive est refusée si UNE entrée est un lien, un chemin absolu, un
chemin qui contient `..`, une entrée chiffrée, ou si elles sont plus de 64, ou
si leur taille annoncée dépasse le budget. Ensuite chaque entrée est extraite
vers un nom choisi par le serveur (`contenu/1`, `contenu/2`…), en comptant les
octets: une entrée qui écrit plus que sa taille annoncée, ou plus que le budget,
est arrêtée et effacée. Le nom écrit dans l'archive ne sert jamais de chemin,
seulement d'affichage et de repli pour le nom du jeu.

Le .zip se lit avec `zipfile`, sans programme extérieur. Le .7z et le .rar
passent par `lsar` et `unar` quand ils sont installés: `lsar -j` donne la liste,
`unar -o -` écrit une entrée sur sa sortie standard, que ce module compte et
écrit lui-même. Sans eux, l'archive reste en quarantaine.
"""

import json
import os
import shutil
import stat
import subprocess
import tempfile
import threading
import zipfile
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath

#: Au-delà, une archive n'est plus « un jeu et ses fichiers ».
ENTREES_MAX = 64

#: Ce qu'on lit d'un coup d'une entrée.
BLOC = 1 << 20


class ArchiveRefusee(Exception):  # noqa: N818 - c'est un verdict, pas une panne
    """L'archive ne sera pas ouverte, pour une raison qu'on peut dire."""


@dataclass(frozen=True)
class Entree:
    """Une entrée de l'archive, telle que la liste l'annonce."""

    nom: str
    taille: int
    #: Ce qui permet de la retrouver: son rang pour `zipfile`, son index pour `unar`.
    rang: int


def nom_dangereux(nom: str) -> bool:
    """Vrai pour un nom absolu, un nom qui remonte, ou un nom vide."""
    if not nom or "\0" in nom:
        return True
    for forme in (PurePosixPath(nom), PureWindowsPath(nom)):
        if forme.is_absolute() or forme.anchor or ".." in forme.parts:
            return True
    return False


def _verifier_liste(entrees: list[Entree], budget: int) -> None:
    if len(entrees) > ENTREES_MAX:
        raise ArchiveRefusee(f"{len(entrees)} entrées, plus que les {ENTREES_MAX} admises")
    total = sum(entree.taille for entree in entrees)
    if total > budget:
        raise ArchiveRefusee(f"{total} octets une fois extraite, plus que le budget de {budget}")
    for entree in entrees:
        if nom_dangereux(entree.nom):
            raise ArchiveRefusee(f"l'entrée « {entree.nom} » sortirait de son dossier")


# ── zip ────────────────────────────────────────────────────────────────────


def lister_zip(archive: zipfile.ZipFile, budget: int) -> list[Entree]:
    """Les fichiers d'un zip, ou un refus pour toute l'archive."""
    infos = archive.infolist()
    if len(infos) > ENTREES_MAX:
        raise ArchiveRefusee(f"{len(infos)} entrées, plus que les {ENTREES_MAX} admises")
    entrees = []
    for rang, info in enumerate(infos):
        if nom_dangereux(info.filename):
            raise ArchiveRefusee(f"l'entrée « {info.filename} » sortirait de son dossier")
        if stat.S_ISLNK(info.external_attr >> 16):
            raise ArchiveRefusee(f"l'entrée « {info.filename} » est un lien")
        if info.flag_bits & 0x1:
            raise ArchiveRefusee(f"l'entrée « {info.filename} » est chiffrée")
        if not info.is_dir():
            entrees.append(Entree(info.filename, info.file_size, rang))
    _verifier_liste(entrees, budget)
    return entrees


def extraire_zip(archive: zipfile.ZipFile, entree: Entree, sortie: int) -> None:
    """Écrit une entrée dans le fichier ouvert `sortie`, sans dépasser sa taille."""
    info = archive.infolist()[entree.rang]
    ecrits = 0
    try:
        with archive.open(info) as flux:
            while bloc := flux.read(BLOC):
                ecrits += len(bloc)
                if ecrits > entree.taille:
                    raise ArchiveRefusee(f"« {entree.nom} » écrit plus que sa taille annoncée")
                os.write(sortie, bloc)
    except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError, RuntimeError) as erreur:
        # `zipfile` coupe lui-même une entrée à sa taille annoncée, puis lève sur
        # sa somme CRC: une entrée qui ment s'arrête donc ici aussi.
        raise ArchiveRefusee(f"« {entree.nom} » ne s'extrait pas: {erreur}") from erreur
    if ecrits != entree.taille:
        raise ArchiveRefusee(f"« {entree.nom} » est plus courte que sa taille annoncée")


# ── 7z et rar, par lsar et unar ────────────────────────────────────────────


@dataclass(frozen=True)
class Outils:
    """Où sont `lsar` et `unar`, et comment les lancer doucement."""

    lsar: str
    unar: str
    #: `nice` et `ionice` devant, quand la machine les a: une extraction ne
    #: doit pas prendre de temps à une partie.
    doux: tuple[str, ...] = ()

    @classmethod
    def trouver(cls, chercher: Callable[[str], str | None] = shutil.which) -> "Outils | None":
        lsar, unar = chercher("lsar"), chercher("unar")
        if lsar is None or unar is None:
            return None
        doux: tuple[str, ...] = ()
        if nice := chercher("nice"):
            doux += (nice, "-n", "19")
        if ionice := chercher("ionice"):
            doux += (ionice, "-c", "3")
        return cls(lsar, unar, doux)


def _environnement() -> dict[str, str]:
    # Rien du salon: ni ses réglages, ni ses adresses. Juste de quoi tourner.
    return {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": "/nonexistent"}


def lister_xad(outils: Outils, fd: int, budget: int) -> list[Entree]:
    """La liste d'une archive 7z ou rar, d'après `lsar -j`.

    L'archive est passée par son descripteur (`/dev/fd/N`): l'outil lit le
    fichier que la quarantaine a vérifié, pas ce que son nom désigne.
    """
    commande = [*outils.doux, outils.lsar, "-j", "-nr", f"/dev/fd/{fd}"]
    try:
        fini = subprocess.run(  # noqa: S603 - commande fixe, aucun texte du client
            commande,
            pass_fds=(fd,),
            capture_output=True,
            timeout=120,
            env=_environnement(),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as erreur:
        raise ArchiveRefusee(f"lsar n'a pas pu lire l'archive: {erreur}") from erreur
    if fini.returncode != 0:
        raise ArchiveRefusee(f"lsar n'a pas pu lire l'archive: {fini.stderr[:200]!r}")
    try:
        liste = json.loads(fini.stdout)
        contenus = liste["lsarContents"]
    except (ValueError, KeyError, TypeError) as erreur:
        raise ArchiveRefusee("lsar a rendu une liste illisible") from erreur
    if len(contenus) > ENTREES_MAX:
        raise ArchiveRefusee(f"{len(contenus)} entrées, plus que les {ENTREES_MAX} admises")
    entrees = []
    for contenu in contenus:
        nom = str(contenu.get("XADFileName", ""))
        if nom_dangereux(nom):
            raise ArchiveRefusee(f"l'entrée « {nom} » sortirait de son dossier")
        if contenu.get("XADIsLink") or "XADLinkDestination" in contenu:
            raise ArchiveRefusee(f"l'entrée « {nom} » est un lien")
        if contenu.get("XADIsEncrypted"):
            raise ArchiveRefusee(f"l'entrée « {nom} » est chiffrée")
        if contenu.get("XADIsDirectory"):
            continue
        taille = contenu.get("XADFileSize")
        index = contenu.get("XADIndex")
        if not isinstance(taille, int) or not isinstance(index, int) or taille < 0:
            raise ArchiveRefusee(f"l'entrée « {nom} » n'annonce pas sa taille")
        entrees.append(Entree(nom, taille, index))
    _verifier_liste(entrees, budget)
    return entrees


def extraire_xad(outils: Outils, fd: int, entree: Entree, sortie: int) -> None:
    """Écrit une entrée par `unar -o -`, en comptant ce qui arrive.

    Les messages d'erreur vont dans un fichier et pas dans un tube: un tube
    plein bloquerait `unar` pendant qu'on attend ses données. Un minuteur tue
    l'outil s'il ne finit pas, à 20 Mo/s au pire plus dix minutes.
    """
    commande = [
        *outils.doux,
        outils.unar,
        "-q",
        "-nr",
        "-o",
        "-",
        "-i",
        f"/dev/fd/{fd}",
        str(entree.rang),
    ]
    with tempfile.TemporaryFile() as erreurs:
        processus = subprocess.Popen(  # noqa: S603 - commande fixe, aucun texte du client
            commande,
            pass_fds=(fd,),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=erreurs,
            env=_environnement(),
        )
        minuteur = threading.Timer(600 + entree.taille / 20e6, processus.kill)
        minuteur.start()
        ecrits = 0
        lu_jusqu_au_bout = False
        try:
            flux = processus.stdout
            while flux is not None and (bloc := flux.read(BLOC)):
                ecrits += len(bloc)
                if ecrits > entree.taille:
                    raise ArchiveRefusee(f"« {entree.nom} » écrit plus que sa taille annoncée")
                os.write(sortie, bloc)
            lu_jusqu_au_bout = True
        finally:
            # Arrêté en route, l'outil attendrait qu'on vide son tube: on le tue.
            if not lu_jusqu_au_bout:
                processus.kill()
            code = processus.wait()
            minuteur.cancel()
            if processus.stdout is not None:
                processus.stdout.close()
        erreurs.seek(0)
        dit = erreurs.read(200)
    if code != 0:
        raise ArchiveRefusee(f"unar n'a pas pu extraire « {entree.nom} » (code {code}): {dit!r}")
    if ecrits != entree.taille:
        raise ArchiveRefusee(f"« {entree.nom} » est plus courte que sa taille annoncée")
