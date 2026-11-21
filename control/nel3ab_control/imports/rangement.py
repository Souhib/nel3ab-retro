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
  autre format ou une autre révision;
- pour la Switch, le même identifiant de titre déjà inscrit par la fiche d'un
  autre fichier, ou au catalogue des salles: la salle range ses sauvegardes
  par ce titre, donc deux fichiers du même jeu partageraient la progression de
  chacun.

Ces contrôles se font sous un verrou, puis le fichier est LIÉ à sa place:
`link` échoue si le nom existe, là où `rename` l'écraserait. Si un fichier
apparaît entre le contrôle et le lien, rien n'est remplacé.

# La fiche d'un jeu Switch

Un jeu Switch n'entre au catalogue qu'avec sa fiche `<fichier>.nel3ab.json`
(`emulator::switch::registered`). Elle est écrite AVANT le jeu, sous un nom
provisoire, forcée sur le disque, puis liée à son nom sans remplacement. Un
lecteur voit donc soit rien, soit la fiche entière. Un jeu sans fiche ne serait
pas listé; une fiche sans jeu n'inscrit rien. Si le lien du jeu échoue, la fiche
qu'on vient de créer est retirée, et seulement elle: elle reste ouverte jusque-là,
et son inode, que personne d'autre ne peut recevoir tant qu'elle l'est, le prouve.
"""

import contextlib
import errno
import fcntl
import hashlib
import json
import os
import re
import unicodedata
from collections.abc import Iterator, Mapping
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

#: Ce qu'on ajoute au nom d'un jeu pour nommer sa fiche, et sa taille la plus
#: grande: celles que lit `emulator::switch::registered`.
FICHE = ".nel3ab.json"
FICHE_MAX = 4096

#: Ce qu'une copie de jeu Switch ajoute à son nom: identifiant entre crochets,
#: version, région, taille. Retiré du nom affiché.
ETIQUETTES = re.compile(r"\[[^\]]*\]|\([^)]*\)")

TITRE = re.compile(r"^[0-9a-fA-F]{16}$")


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


def nom_switch(annonce: str, titre: int) -> str:
    """Le nom d'un jeu Switch, sans extension: le nom annoncé, sans ses étiquettes.

    Le titre du jeu est écrit dans sa partie Control, chiffrée avec une autre
    clé que celle d'en-tête: il n'est pas lu. Le nom du fichier est donc la
    seule source, débarrassée de ce que les copies y ajoutent:
    « Mario Kart 8 Deluxe [0100152000022000][v0] (7.03 GB).nsp » devient
    « Mario Kart 8 Deluxe ». Sans rien d'autre, l'identifiant sert de nom.
    """
    return nettoyer(ETIQUETTES.sub(" ", repli(annonce)).replace("_", " ")) or f"{titre:016X}"


@dataclass(frozen=True)
class Fiche:
    """L'inscription d'un jeu Switch: son titre, et les octets écrits à côté de lui."""

    #: L'identifiant de titre en minuscules, comme le worker le garde.
    titre: str
    octets: bytes


def fiche_switch(nom: str, titre: int) -> Fiche:
    """La fiche que `emulator::switch::registered` accepte pour ce jeu.

    Le champ `inscription` dit d'où elle vient: les fiches écrites à la main
    suivent un lancement d'essai, celle-ci la lecture de l'en-tête NCA. Le
    worker ne le lit pas. Le même texte est dans `consoles/fiche-switch.json`,
    qu'un essai Rust passe au vrai `registered`.
    """
    contenu = {
        "console": "switch",
        "name": nom,
        "title": f"{titre:016X}",
        "inscription": "import: titre lu dans l'en-tête NCA, sans lancement d'essai",
    }
    octets = (json.dumps(contenu, ensure_ascii=False, indent=2) + "\n").encode()
    if len(octets) > FICHE_MAX:
        raise ValueError(f"une fiche dépasse {FICHE_MAX} octets")
    return Fiche(f"{titre:016x}", octets)


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


@dataclass(frozen=True)
class Inscrit:
    """Un jeu que la fiche voisine inscrit sous un identifiant de titre."""

    jeu: Existant
    #: Le nom que la fiche lui donne, ou rien.
    nom: str


class Bibliotheque:
    """Les dossiers de jeux, et la seule porte par laquelle un import y entre."""

    def __init__(
        self,
        dossiers: list[Path],
        verrou: Path,
        connus: frozenset[str] = frozenset(),
        titres_connus: Mapping[str, str] | None = None,
    ) -> None:
        self.dossiers = dossiers
        self.verrou = verrou
        #: Les noms du catalogue que les salles écrivent (ADR D24). Ils couvrent
        #: aussi un dossier que le worker balaie et que le salon ne connaît pas.
        self.connus = connus
        #: Du même catalogue: l'identifiant de titre de chaque jeu Switch inscrit,
        #: en minuscules, et le nom du fichier qu'il désigne.
        self.titres_connus = titres_connus or {}

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

    def inscrits(self) -> dict[str, Inscrit]:
        """Chaque identifiant de titre qu'une fiche inscrit, en minuscules.

        Seule compte une fiche posée à côté de son jeu: une fiche orpheline
        n'inscrit rien pour le worker, et ne doit pas bloquer un import. Une
        fiche illisible ou trop grosse est ignorée, comme le worker l'ignore.
        """
        tous = list(self.existants())
        presents = {(e.dossier, e.nom): e for e in tous}
        trouves: dict[str, Inscrit] = {}
        for existant in tous:
            if not existant.nom.endswith(FICHE) or existant.taille > FICHE_MAX:
                continue
            jeu = presents.get((existant.dossier, existant.nom.removesuffix(FICHE)))
            if jeu is None:
                continue
            try:
                fd = self._ouvrir(existant)
                try:
                    valeur = json.loads(os.read(fd, FICHE_MAX + 1))
                finally:
                    os.close(fd)
            except (OSError, ValueError):
                continue
            titre = valeur.get("title") if isinstance(valeur, dict) else None
            if not isinstance(titre, str) or not TITRE.match(titre):
                continue
            nom = valeur.get("name")
            trouves.setdefault(titre.lower(), Inscrit(jeu, nom if isinstance(nom, str) else ""))
        return trouves

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
        self,
        destination: Path,
        nom: str,
        taille: int,
        sha256: str,
        jeu: tuple[str, str] | None,
        fiche: Fiche | None,
    ) -> None:
        if fiche is not None and (deja := self.inscrits().get(fiche.titre)):
            raise Refus(
                "doublon",
                f"le même jeu (titre {fiche.titre.upper()}) est déjà inscrit: "
                f"« {deja.jeu.montre} »",
            )
        if fiche is not None and (cle_connue := self.titres_connus.get(fiche.titre)):
            raise Refus(
                "doublon",
                f"le même jeu (titre {fiche.titre.upper()}) est au catalogue des salles: "
                f"« {cle_connue} »",
            )
        cle = cle_sauvegarde(nom)
        for connu in self.connus:
            if connu == nom:
                raise Refus("doublon", f"« {connu} » est déjà au catalogue des salles")
            if cle_sauvegarde(connu) == cle:
                raise Refus(
                    "doublon",
                    f"« {connu} », au catalogue des salles, partagerait ses sauvegardes avec ce "
                    f"jeu (même clé « {cle} »)",
                )
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
        fiche: Fiche | None = None,
    ) -> str:
        """Lie le fichier ouvert `source` sous `destination/nom`, ou refuse.

        Rend `dossier/nom`. Le fichier de quarantaine n'est PAS retiré ici:
        c'est à l'appelant de le faire une fois ce retour reçu, et seulement
        alors, pour qu'un échec laisse toujours une copie quelque part. Avec
        une `fiche`, elle est écrite à côté du jeu, avant lui.
        """
        taille = os.fstat(source).st_size
        with self._verrouillee():
            self._controler(destination, nom, taille, sha256, jeu, fiche)
            # Lisible comme les autres jeux: la quarantaine crée en 0600, dans
            # un dossier en 0700 qui suffit à la protéger.
            os.fchmod(source, 0o644)
            dossier = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            try:
                ecrite = None if fiche is None else ecrire_fiche(dossier, nom + FICHE, fiche)
                try:
                    lier_sans_remplacer(source, dossier, nom)
                except BaseException:
                    if ecrite is not None:
                        retirer_si_meme(dossier, nom + FICHE, ecrite)
                    raise
                finally:
                    if ecrite is not None:
                        os.close(ecrite)
                os.fsync(dossier)
            finally:
                os.close(dossier)
        return f"{destination.name}/{nom}"


def ecrire_fiche(dossier: int, nom: str, fiche: Fiche) -> int:
    """Écrit la fiche sous `nom` dans `dossier`, entière ou pas du tout, sans écraser.

    Rend le fichier écrit, OUVERT: c'est à l'appelant de le fermer. Tant qu'il
    l'est, son inode ne peut servir à aucun autre fichier, et `retirer_si_meme`
    peut comparer sans se tromper. Fermé, le numéro serait libre: un fichier
    créé juste après peut le recevoir, ce que l'essai a montré sur ce disque.
    """
    provisoire = f"{PROVISOIRE}{os.getpid()}-{os.urandom(4).hex()}"
    fd = os.open(
        provisoire,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o644,
        dir_fd=dossier,
    )
    try:
        os.fchmod(fd, 0o644)
        vue = memoryview(fiche.octets)
        while vue:
            vue = vue[os.write(fd, vue) :]
        os.fsync(fd)
        try:
            os.link(provisoire, nom, src_dir_fd=dossier, dst_dir_fd=dossier, follow_symlinks=False)
        except FileExistsError as erreur:
            raise Refus(
                "doublon", f"une fiche « {nom} » existe déjà, sans son jeu: rien n'a été remplacé"
            ) from erreur
    except BaseException:
        os.close(fd)
        raise
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(provisoire, dir_fd=dossier)
    return fd


def retirer_si_meme(dossier: int, nom: str, ouvert: int) -> None:
    """Retire `nom` de `dossier` s'il désigne encore le fichier `ouvert`, et rien d'autre."""
    attendu = os.fstat(ouvert)
    with contextlib.suppress(FileNotFoundError):
        etat = os.stat(nom, dir_fd=dossier, follow_symlinks=False)
        if (etat.st_dev, etat.st_ino) == (attendu.st_dev, attendu.st_ino):
            os.unlink(nom, dir_fd=dossier)


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
