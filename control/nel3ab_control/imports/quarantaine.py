"""La quarantaine: où un envoi arrive, et où reste ce qu'on ne range pas.

# Le client ne nomme jamais un chemin

Un envoi vit dans `<quarantaine>/<id>/`, où `<id>` est tiré au hasard par le
serveur, et son contenu s'appelle toujours `fichier`. Le nom que le navigateur
annonce est gardé pour l'affichage et rien d'autre: `../../.bashrc` est un
texte qu'on montre, pas une adresse où l'on écrit.

# Chaque ouverture vérifie ce qu'elle ouvre

Les dossiers et les fichiers s'ouvrent avec `O_NOFOLLOW`, relativement au
dossier parent déjà ouvert: un lien symbolique planté à la place de `fichier`
fait échouer l'ouverture au lieu de faire écrire ailleurs. `O_NOFOLLOW` ne voit
pas un LIEN DUR, qui est un fichier ordinaire; c'est pourquoi l'envoi retient le
périphérique et le numéro d'inode du fichier qu'il a créé, et refuse d'écrire
dans un autre, ou dans un fichier qui porte deux noms.

Ce module est synchrone. Le contrôleur l'appelle depuis un fil, pour qu'une
écriture sur le disque ne bloque pas le salon.
"""

import contextlib
import os
import re
import secrets
import shutil
import stat
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

IDENTIFIANT = re.compile(r"^[0-9a-f]{32}$")
DONNEES = "fichier"
ETAT = "etat.json"
CONTENU = "contenu"

#: Un fichier d'état plus gros que ceci n'a pas été écrit par ce module.
ETAT_MAX = 1 << 20

OUVRIR_DOSSIER = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

EtatEnvoi = Literal["envoi", "verification", "termine", "erreur"]
EtatElement = Literal[
    "range",
    "pas-jouable",
    "a-confirmer",
    "inconnu",
    "doublon",
    "refuse",
    "archive-non-prise-en-charge",
]


class QuarantaineAbimee(Exception):  # noqa: N818 - un constat sur le disque, pas une panne
    """Un fichier de la quarantaine n'est plus celui que ce module a créé."""


class Element(BaseModel):
    """Un fichier traité: le fichier envoyé, ou une entrée de son archive."""

    nom: str
    taille: int
    #: Où il est dans le dossier de l'envoi: `fichier` ou `contenu/<n>`. Tant
    #: qu'il n'est pas rangé. Jamais montré: c'est un nom du serveur.
    source: str = ""
    sha256: str = ""
    console: str | None = None
    format: str = "inconnu"
    titre: str = ""
    identifiant: str = ""
    drapeaux: list[str] = Field(default_factory=list)
    preuve: str = ""
    details: dict[str, str] = Field(default_factory=dict)
    etat: EtatElement = "inconnu"
    message: str = ""
    #: `dossier/nom` une fois rangé: le nom du dossier, jamais le chemin complet.
    destination: str = ""


class Envoi(BaseModel):
    """Un envoi, tel qu'il est écrit dans `etat.json` à côté de ses octets."""

    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    nom: str
    taille: int = Field(gt=0)
    empreinte_rapide: str = Field(pattern=r"^[0-9a-f]{64}$")
    par: str
    cree: float
    etat: EtatEnvoi = "envoi"
    decalage: int = Field(default=0, ge=0)
    #: Le périphérique et l'inode du fichier créé, pour refuser un autre fichier.
    inode: tuple[int, int]
    sha256: str = ""
    message: str = ""
    elements: list[Element] = Field(default_factory=list)


def _verifier(fd: int, attendu: tuple[int, int] | None) -> os.stat_result:
    etat = os.fstat(fd)
    if not stat.S_ISREG(etat.st_mode):
        raise QuarantaineAbimee("ce n'est plus un fichier ordinaire")
    if etat.st_nlink != 1:
        raise QuarantaineAbimee("le fichier porte un deuxième nom")
    if attendu is not None and (etat.st_dev, etat.st_ino) != tuple(attendu):
        raise QuarantaineAbimee("ce n'est plus le fichier que l'envoi a créé")
    return etat


class Quarantaine:
    """Les envois, un dossier chacun, sous une racine que le serveur choisit."""

    def __init__(self, racine: Path) -> None:
        self.racine = racine

    def ouvrir_racine(self) -> int:
        """La racine, créée au premier besoin et jamais au travers d'un lien."""
        self.racine.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            return os.open(self.racine, OUVRIR_DOSSIER)
        except OSError as erreur:
            raise QuarantaineAbimee(f"la quarantaine n'est pas un dossier: {erreur}") from erreur

    def preparer(self) -> None:
        """Crée la racine si elle manque, pour pouvoir mesurer son disque."""
        os.close(self.ouvrir_racine())

    @contextlib.contextmanager
    def dossier(self, ident: str) -> Iterator[int]:
        """Le dossier d'un envoi, ouvert sans suivre de lien."""
        if not IDENTIFIANT.match(ident):
            raise QuarantaineAbimee("identifiant d'envoi impossible")
        racine = self.ouvrir_racine()
        try:
            fd = os.open(ident, OUVRIR_DOSSIER, dir_fd=racine)
        except OSError as erreur:
            raise QuarantaineAbimee(f"dossier d'envoi illisible: {erreur}") from erreur
        finally:
            os.close(racine)
        try:
            yield fd
        finally:
            os.close(fd)

    def creer(self, nom: str, taille: int, empreinte: str, par: str) -> Envoi:
        """Un envoi neuf: son dossier, son fichier vide, son état."""
        ident = secrets.token_hex(16)
        racine = self.ouvrir_racine()
        try:
            os.mkdir(ident, 0o700, dir_fd=racine)
        finally:
            os.close(racine)
        with self.dossier(ident) as dossier:
            fd = os.open(
                DONNEES,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
                dir_fd=dossier,
            )
            try:
                etat = _verifier(fd, None)
            finally:
                os.close(fd)
        envoi = Envoi(
            id=ident,
            nom=nom,
            taille=taille,
            empreinte_rapide=empreinte,
            par=par,
            cree=time.time(),
            inode=(etat.st_dev, etat.st_ino),
        )
        self.sauver(envoi)
        return envoi

    def ouvrir(self, envoi: Envoi, source: str = DONNEES, *, ecriture: bool = False) -> int:
        """Les octets d'un envoi, ouverts et vérifiés.

        `source` vaut `fichier`, ou `contenu/<n>` pour une entrée d'archive.
        Le fichier envoyé doit être celui que `creer` a fait; une entrée
        d'archive doit seulement être un fichier ordinaire à un seul nom.
        """
        with self.dossier(envoi.id) as dossier:
            parent = dossier
            nom = source
            if source != DONNEES:
                if not re.fullmatch(rf"{CONTENU}/[0-9]+", source):
                    raise QuarantaineAbimee("source impossible")
                parent = os.open(CONTENU, OUVRIR_DOSSIER, dir_fd=dossier)
                nom = source.split("/", 1)[1]
            try:
                mode = os.O_RDWR if ecriture else os.O_RDONLY
                fd = os.open(nom, mode | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
            except OSError as erreur:
                raise QuarantaineAbimee(f"« {source} » ne s'ouvre pas: {erreur}") from erreur
            finally:
                if parent != dossier:
                    os.close(parent)
        try:
            _verifier(fd, envoi.inode if source == DONNEES else None)
        except QuarantaineAbimee:
            os.close(fd)
            raise
        return fd

    def nouvelle_entree(self, envoi: Envoi, rang: int) -> tuple[str, int]:
        """Un fichier neuf pour une entrée d'archive, sous un nom du serveur."""
        with self.dossier(envoi.id) as dossier:
            with contextlib.suppress(FileExistsError):
                os.mkdir(CONTENU, 0o700, dir_fd=dossier)
            parent = os.open(CONTENU, OUVRIR_DOSSIER, dir_fd=dossier)
            try:
                fd = os.open(
                    str(rang),
                    os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                    0o600,
                    dir_fd=parent,
                )
            finally:
                os.close(parent)
        return f"{CONTENU}/{rang}", fd

    def effacer_source(self, envoi: Envoi, source: str) -> None:
        """Retire un fichier de la quarantaine, une fois rangé ou extrait."""
        with self.dossier(envoi.id) as dossier:
            if source == DONNEES:
                os.unlink(DONNEES, dir_fd=dossier)
                return
            if not re.fullmatch(rf"{CONTENU}/[0-9]+", source):
                raise QuarantaineAbimee("source impossible")
            parent = os.open(CONTENU, OUVRIR_DOSSIER, dir_fd=dossier)
            try:
                os.unlink(source.split("/", 1)[1], dir_fd=parent)
            finally:
                os.close(parent)

    def sauver(self, envoi: Envoi) -> None:
        """Écrit l'état à côté des octets, en entier ou pas du tout."""
        texte = envoi.model_dump_json().encode()
        with self.dossier(envoi.id) as dossier:
            provisoire = f"{ETAT}.provisoire"
            fd = os.open(
                provisoire,
                os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
                dir_fd=dossier,
            )
            try:
                os.write(fd, texte)
                os.fsync(fd)
            finally:
                os.close(fd)
            os.replace(provisoire, ETAT, src_dir_fd=dossier, dst_dir_fd=dossier)

    def charger(self) -> list[Envoi]:
        """Les envois laissés par un salon précédent.

        La taille reçue est relue sur le disque plutôt que crue: un arrêt
        pendant un morceau a pu écrire plus que l'état ne le dit. Un dossier
        illisible est laissé où il est, et ne bloque pas les autres.
        """
        if not self.racine.is_dir():
            return []
        racine = self.ouvrir_racine()
        try:
            noms = sorted(n for n in os.listdir(racine) if IDENTIFIANT.match(n))
        finally:
            os.close(racine)
        envois = []
        for nom in noms:
            try:
                envoi = self._relire(nom)
            except (OSError, QuarantaineAbimee, ValidationError):
                continue
            envois.append(envoi)
        return envois

    def _relire(self, ident: str) -> Envoi:
        with self.dossier(ident) as dossier:
            fd = os.open(ETAT, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dossier)
            try:
                texte = os.read(fd, ETAT_MAX + 1)
            finally:
                os.close(fd)
        if len(texte) > ETAT_MAX:
            raise QuarantaineAbimee("état trop gros")
        envoi = Envoi.model_validate_json(texte)
        if envoi.id != ident:
            raise QuarantaineAbimee("état d'un autre envoi")
        if envoi.etat in ("envoi", "verification"):
            fd = self.ouvrir(envoi)
            try:
                envoi.decalage = min(os.fstat(fd).st_size, envoi.taille)
            finally:
                os.close(fd)
            if envoi.etat == "verification":
                # La vérification ne survit pas à un redémarrage: l'envoi
                # redevient complet, et la page peut la redemander.
                envoi.etat = "envoi"
                envoi.message = "le salon a redémarré pendant la vérification"
        return envoi

    def supprimer(self, envoi: Envoi) -> None:
        """Efface le dossier de l'envoi, et seulement lui.

        Un jeu rangé n'y est plus: il a été déplacé hors de la quarantaine.
        `rmtree` refuse un lien symbolique à la place du dossier, et parcourt
        le reste par descripteurs ouverts.
        """
        if not IDENTIFIANT.match(envoi.id):
            raise QuarantaineAbimee("identifiant d'envoi impossible")
        chemin = self.racine / envoi.id
        if not stat.S_ISDIR(os.lstat(chemin).st_mode):
            raise QuarantaineAbimee("le dossier de l'envoi a été remplacé")
        shutil.rmtree(chemin)
