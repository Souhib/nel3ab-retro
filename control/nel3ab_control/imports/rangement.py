"""Ranger un fichier dans la bibliothèque, sans jamais rien remplacer.

# Le nom fixe les sauvegardes

Pour GameCube et Wii, la clé des sauvegardes, personnelles comprises, vient du
NOM DE FICHIER (`emulator::saves::key`, extension comprise). Le nom choisi ici
ne pourra donc plus changer sans détacher la progression de chacun. Il vient du
titre écrit dans le disque, nettoyé, et pas du nom qu'avait le fichier chez
celui qui l'envoie: deux personnes qui envoient le même jeu sous deux noms
doivent tomber sur le même nom, donc sur le refus d'un doublon.

# Ce qui est refusé, et pourquoi

- un nom déjà pris dans N'IMPORTE QUEL dossier de la liste: le balayage du
  worker écarte le second fichier de même nom, sans rien montrer;
- un nom dont la clé de sauvegarde est déjà prise (`Jeu.iso` et `jeu.iso`):
  les deux jeux partageraient leurs sauvegardes;
- le même fichier, octet pour octet, déjà rangé n'importe où;
- le même jeu (code et numéro de disque) déjà dans le même dossier, sous un
  autre format ou une autre révision.

Ces contrôles se font sous un verrou, puis le fichier est LIÉ à sa place:
`link` échoue si le nom existe, là où `rename` l'écraserait. Si un fichier
apparaît entre le contrôle et le lien, rien n'est remplacé.
"""

import contextlib
import errno
import fcntl
import hashlib
import os
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from nel3ab_control.imports.destinations import EXTENSIONS
from nel3ab_control.imports.empreinte import empreinte_rapide, lecteur_fd
from nel3ab_control.imports.identifier import identifier

#: La longueur maximale d'un nom, en octets UTF-8, extension non comprise.
#: Un nom de fichier ext4 tient en 255 octets; la marge garde la place du
#: suffixe de disque et des fichiers d'inscription Switch (`.nel3ab.json`).
NOM_MAX = 120

#: Ce qu'un nom de fichier ne porte jamais: le séparateur de chemin, et ce que
#: Windows refuse, parce que la bibliothèque se copie parfois sur un partage.
INTERDITS = frozenset('/\\:*?"<>|')

#: Le préfixe des fichiers provisoires d'une copie entre deux disques.
PROVISOIRE = ".nel3ab-import-"


class Refus(Exception):  # noqa: N818 - c'est un verdict, pas une panne
    """Le fichier ne sera pas rangé, pour une raison qu'on peut dire."""

    def __init__(self, etat: str, message: str) -> None:
        super().__init__(message)
        self.etat = etat
        self.message = message


def nettoyer(texte: str) -> str:
    """Un texte qui peut servir de nom de fichier, ou rien.

    Pas de séparateur, pas de caractère de contrôle, pas de point en tête ni
    en fin: `..` ne survit pas, et un nom ne devient jamais un fichier caché.
    """
    texte = unicodedata.normalize("NFC", texte)
    garde = "".join(
        " " if c in INTERDITS or unicodedata.category(c).startswith(("C", "Z")) else c
        for c in texte
    )
    garde = " ".join(garde.split()).strip(" .")
    while len(garde.encode("utf-8")) > NOM_MAX:
        garde = garde[:-1].rstrip(" .")
    return garde


def repli(nom_annonce: str) -> str:
    """Le nom annoncé par le navigateur, sans dossier ni extension."""
    dernier = PurePosixPath(nom_annonce.replace("\\", "/")).name
    return dernier.rsplit(".", 1)[0] if "." in dernier.lstrip(".") else dernier


def nom_canonique(titre: str, annonce: str, identifiant: str, disque: str, format_: str) -> str:
    """Le nom définitif: le titre lu dans le fichier, nettoyé, et son extension."""
    base = nettoyer(titre) or nettoyer(repli(annonce)) or nettoyer(identifiant) or "jeu"
    if disque not in ("", "1"):
        base = f"{base} (Disque {disque})"
    return base + EXTENSIONS[format_]


def cle_sauvegarde(nom: str) -> str:
    """La même clé que `emulator::saves::key`, recopiée et essayée sur ses exemples."""
    sortie: list[str] = []
    for caractere in nom:
        if caractere.isascii() and caractere.isalnum():
            sortie.append(caractere.lower())
        elif not sortie or sortie[-1] != "-":
            sortie.append("-")
    return "".join(sortie).strip("-") or "sans-nom"


def _sha256(fd: int) -> str:
    calcul = hashlib.sha256()
    decalage = 0
    while morceau := os.pread(fd, 1 << 20, decalage):
        calcul.update(morceau)
        decalage += len(morceau)
    return calcul.hexdigest()


@dataclass(frozen=True)
class Existant:
    """Un fichier déjà dans la bibliothèque."""

    dossier: Path
    nom: str
    taille: int

    @property
    def montre(self) -> str:
        return f"{self.dossier.name}/{self.nom}"


class Bibliotheque:
    """Les dossiers de jeux, et la seule porte par laquelle un import y entre."""

    def __init__(self, dossiers: list[Path], verrou: Path) -> None:
        self.dossiers = dossiers
        self.verrou = verrou

    def existants(self) -> Iterator[Existant]:
        """Chaque fichier ordinaire de chaque dossier, sans suivre de lien."""
        for dossier in self.dossiers:
            try:
                entrees = list(os.scandir(dossier))
            except OSError:
                continue
            for entree in entrees:
                if entree.is_file(follow_symlinks=False) and not entree.name.startswith(PROVISOIRE):
                    taille = entree.stat(follow_symlinks=False).st_size
                    yield Existant(dossier, entree.name, taille)

    def _ouvrir(self, existant: Existant) -> int:
        return os.open(existant.dossier / existant.nom, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)

    def deja_la(self, taille: int, empreinte: str) -> Existant | None:
        """Un fichier de même taille ET de même empreinte rapide, ou rien.

        Seuls les fichiers de la même taille au octet près sont relus, et
        seulement leurs 8 Mio de bouts: une bibliothèque de 76 Gio ne se relit
        pas à chaque envoi.
        """
        for existant in self.existants():
            if existant.taille != taille:
                continue
            with contextlib.suppress(OSError):
                fd = self._ouvrir(existant)
                try:
                    if empreinte_rapide(lecteur_fd(fd), taille) == empreinte:
                        return existant
                finally:
                    os.close(fd)
        return None

    @contextlib.contextmanager
    def _verrouillee(self) -> Iterator[None]:
        self.verrou.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(self.verrou, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def _controler(
        self, destination: Path, nom: str, taille: int, sha256: str, jeu: tuple[str, str] | None
    ) -> None:
        cle = cle_sauvegarde(nom)
        for existant in self.existants():
            if existant.nom == nom:
                raise Refus("doublon", f"« {existant.montre} » porte déjà ce nom")
            if cle_sauvegarde(existant.nom) == cle:
                raise Refus(
                    "doublon",
                    f"« {existant.montre} » partagerait ses sauvegardes avec ce jeu "
                    f"(même clé « {cle} »)",
                )
            if existant.taille != taille and existant.dossier != destination:
                continue
            with contextlib.suppress(OSError):
                fd = self._ouvrir(existant)
                try:
                    if existant.taille == taille and _sha256(fd) == sha256:
                        raise Refus(
                            "doublon",
                            f"le même fichier, octet pour octet, est « {existant.montre} »",
                        )
                    if jeu and existant.dossier == destination:
                        lu = identifier(lecteur_fd(fd), existant.taille)
                        if (lu.identifiant, lu.details.get("disque", "")) == jeu:
                            raise Refus(
                                "doublon",
                                f"le même jeu ({jeu[0]}, disque {jeu[1]}) est déjà "
                                f"« {existant.montre} »",
                            )
                finally:
                    os.close(fd)

    def ranger(
        self,
        source: int,
        destination: Path,
        nom: str,
        *,
        sha256: str,
        jeu: tuple[str, str] | None,
    ) -> str:
        """Lie le fichier ouvert `source` sous `destination/nom`, ou refuse.

        Rend `dossier/nom`. Le fichier de quarantaine n'est PAS retiré ici:
        c'est à l'appelant de le faire une fois ce retour reçu, et seulement
        alors, pour qu'un échec laisse toujours une copie quelque part.
        """
        taille = os.fstat(source).st_size
        with self._verrouillee():
            self._controler(destination, nom, taille, sha256, jeu)
            # Lisible comme les autres jeux: la quarantaine crée en 0600, dans
            # un dossier en 0700 qui suffit à la protéger.
            os.fchmod(source, 0o644)
            dossier = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            try:
                lier_sans_remplacer(source, dossier, nom)
                os.fsync(dossier)
            finally:
                os.close(dossier)
        return f"{destination.name}/{nom}"


def lier_sans_remplacer(source: int, dossier: int, nom: str) -> None:
    """Donne au fichier ouvert `source` le nom `nom` dans `dossier`, sans écraser.

    Par `/proc/self/fd`: c'est le fichier OUVERT qui est lié, celui dont la
    quarantaine a vérifié l'inode, et non ce que son nom désigne à cet instant.
    Entre deux disques, le lien est impossible: copie dans un fichier provisoire
    du dossier d'arrivée, `fsync`, puis le même lien sans remplacement.
    """
    try:
        os.link(f"/proc/self/fd/{source}", nom, dst_dir_fd=dossier, follow_symlinks=True)
    except FileExistsError as erreur:
        raise Refus(
            "doublon",
            f"un fichier « {nom} » est apparu pendant le rangement: rien n'a été remplacé",
        ) from erreur
    except OSError as erreur:
        if erreur.errno != errno.EXDEV:
            raise
        _copier_puis_lier(source, dossier, nom)


def _copier_puis_lier(source: int, dossier: int, nom: str) -> None:
    provisoire = f"{PROVISOIRE}{os.getpid()}-{os.urandom(4).hex()}"
    copie = os.open(
        provisoire,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o644,
        dir_fd=dossier,
    )
    try:
        decalage = 0
        while morceau := os.pread(source, 1 << 20, decalage):
            os.write(copie, morceau)
            decalage += len(morceau)
        os.fsync(copie)
        os.close(copie)
        copie = -1
        try:
            os.link(provisoire, nom, src_dir_fd=dossier, dst_dir_fd=dossier, follow_symlinks=False)
        except FileExistsError as erreur:
            raise Refus(
                "doublon",
                f"un fichier « {nom} » est apparu pendant la copie: rien n'a été remplacé",
            ) from erreur
    finally:
        if copie >= 0:
            os.close(copie)
        with contextlib.suppress(FileNotFoundError):
            os.unlink(provisoire, dir_fd=dossier)
