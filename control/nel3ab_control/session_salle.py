"""Ce que le salon lit et écrit dans le dossier de session d'une salle.

Le dossier `salles_dir/N` appartient au worker de la salle N: il y écrit le jeu
retenu (`chosen-rom`), la sauvegarde retenue et sa bibliothèque. Les conteneurs
des moteurs y montent aussi des sous-dossiers en écriture. Le salon y lit le
dernier jeu (ADR D38), la bibliothèque et les images des jeux (`catalogue`), et
y pose deux marqueurs: `game-closed`, qui fait arriver une salle sur son menu,
et `ouverte-le`, qui dit depuis quand elle est ouverte. Toutes ces lectures
passent par ce module.

L'hôte ne suit jamais un lien dans ce dossier (ADR D36). Le dossier numéroté
s'ouvre avec `O_NOFOLLOW` depuis `salles_dir`, et chaque fichier depuis ce
descripteur, encore avec `O_NOFOLLOW`. Un lien laissé par un moteur à la place
d'un fichier fait échouer la lecture, qui rend « rien », au lieu de faire lire
ou écrire au salon un fichier de l'hôte. Les lectures sont aussi bornées et
sans attente: un tube nommé à la place d'un fichier bloquerait le salon pour
toujours (`parties._ouvrir_regulier`, relevé du 20 novembre 2026).
"""

import contextlib
import os
import secrets
import stat
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from nel3ab_control.worker import valid_key

#: Ouvrir un dossier sans suivre de lien.
DOSSIER = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

#: Le jeu que le worker a retenu, écrit par `remember_choice` (worker/main.rs).
JEU_RETENU = "chosen-rom"

#: Le marqueur « ouverte, mais sans jeu », lu par `Playback::read` (playback.rs).
SANS_JEU = "game-closed"

#: Le repère que le salon pose quand IL ouvre la salle. Voir `Ouverture`.
OUVERTE_LE = "ouverte-le"

#: L'ordre d'ouvrir la salle sur un jeu, lu et retiré par le worker à son
#: démarrage (`nel3ab_emulator::OPEN_ORDER`, D17). Voir `OrdreOuverture`.
ORDRE = "ouvrir-sur"

#: Ce qu'une clé de jeu peut peser: un nom de fichier Linux, 255 octets
#: (`worker.KEY_MAX_BYTES`), plus un retour à la ligne. 512 laisse la marge d'un
#: fichier mal fini sans laisser lire autre chose qu'une clé.
CLE_MAX = 512

#: Ce que pèse un repère d'ouverture: 36 caractères d'identifiant de démarrage,
#: un espace, au plus vingt chiffres et un retour à la ligne, soit 58 octets.
REPERE_MAX = 128


@contextlib.contextmanager
def dossier(salles_dir: Path, numero: int, creer: bool = False) -> Iterator[int]:
    """Le descripteur de `salles_dir/numero`, ouvert sans suivre de lien.

    `salles_dir` lui-même vient des réglages, écrits par le propriétaire: il est
    suivi comme n'importe quel chemin configuré. Le dossier numéroté, lui, ne
    l'est pas: c'est celui que le worker et ses moteurs écrivent.

    `creer` le crée s'il manque, avec ses parents, pour la seule écriture qui
    peut précéder le premier démarrage du worker (ouvrir une salle neuve).
    Lève `OSError` quand le dossier manque ou n'est pas un dossier ordinaire.
    """
    if creer:
        salles_dir.mkdir(parents=True, exist_ok=True)
    racine = os.open(salles_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        nom = str(numero)
        if creer:
            with contextlib.suppress(FileExistsError):
                os.mkdir(nom, 0o755, dir_fd=racine)
        fd = os.open(nom, DOSSIER, dir_fd=racine)
    finally:
        os.close(racine)
    try:
        yield fd
    finally:
        os.close(fd)


@dataclass(frozen=True)
class Lu:
    """Le contenu d'un fichier ordinaire, et l'heure de sa dernière écriture."""

    contenu: bytes
    #: Secondes depuis 1970, l'horloge des fichiers et non l'horloge monotone.
    ecrit: float


def lire(fd: int, nom: str, plafond: int) -> Lu | None:
    """Un fichier ordinaire de ce dossier, entier et sous son plafond, ou rien.

    Rien pour un fichier absent, un lien, un tube, un dossier, ou un fichier
    plus gros que `plafond`: un fichier tronqué n'est pas le fichier.
    """
    try:
        descripteur = os.open(
            nom, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd
        )
    except OSError:
        return None
    try:
        etat = os.fstat(descripteur)
        if not stat.S_ISREG(etat.st_mode):
            return None
        contenu = os.read(descripteur, plafond + 1)
    except OSError:
        return None
    finally:
        os.close(descripteur)
    if len(contenu) > plafond:
        return None
    return Lu(contenu=contenu, ecrit=etat.st_mtime)


def ecrire(fd: int, nom: str, contenu: bytes) -> None:
    """Remplace un fichier de ce dossier en une fois, sans suivre de lien.

    Écrit à côté sous un nom neuf (`O_EXCL`), puis renomme par-dessus. Un
    renommage remplace un lien laissé à ce nom au lieu de le suivre, et un
    lecteur ne voit jamais un fichier à moitié écrit. `write(2)` peut écrire
    moins qu'on lui donne (un disque qui se remplit): on reprend jusqu'au bout,
    et l'appel suivant lève, plutôt que de renommer un fichier coupé. Lève
    `OSError`.
    """
    provisoire = f".{nom}.{secrets.token_hex(6)}"
    descripteur = os.open(
        provisoire,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o644,
        dir_fd=fd,
    )
    try:
        try:
            reste = memoryview(contenu)
            while reste:
                reste = reste[os.write(descripteur, reste) :]
        finally:
            os.close(descripteur)
        os.replace(provisoire, nom, src_dir_fd=fd, dst_dir_fd=fd)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(provisoire, dir_fd=fd)
        raise


def retirer(fd: int, nom: str) -> None:
    """Retire un fichier de ce dossier, ou un lien à ce nom sans le suivre.

    Un fichier déjà absent n'est pas une erreur: retirer est idempotent.
    """
    with contextlib.suppress(FileNotFoundError):
        os.unlink(nom, dir_fd=fd)


def poser_vide(fd: int, nom: str) -> None:
    """Pose un fichier vide à ce nom, à la place de ce qui s'y trouvait.

    Retire d'abord, puis crée avec `O_EXCL`: un lien laissé à ce nom est retiré
    au lieu d'être suivi, et la création échoue plutôt que d'écrire ailleurs.
    """
    retirer(fd, nom)
    os.close(
        os.open(
            nom,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o644,
            dir_fd=fd,
        )
    )


def lire_dans(salles_dir: Path, numero: int, sous: str, nom: str, plafond: int) -> bytes | None:
    """Un fichier ordinaire d'un sous-dossier de la salle, ou rien.

    Le sous-dossier s'ouvre lui aussi avec `O_NOFOLLOW` depuis le dossier de la
    salle: un lien à sa place fait rendre rien, comme un lien au nom du fichier.
    """
    try:
        with dossier(salles_dir, numero) as fd:
            sous_fd = os.open(sous, DOSSIER, dir_fd=fd)
            try:
                lu = lire(sous_fd, nom, plafond)
            finally:
                os.close(sous_fd)
    except OSError:
        return None
    return lu.contenu if lu else None


@dataclass(frozen=True)
class JeuRetenu:
    """Le jeu que le worker de cette salle a retenu, et quand il l'a retenu."""

    cle: str
    #: Secondes depuis 1970: l'instant du CHOIX (l'écriture de `chosen-rom`),
    #: pas celui de la fin de la partie.
    choisi: float


def jeu_retenu(salles_dir: Path, numero: int) -> JeuRetenu | None:
    """Le jeu retenu dans le dossier de cette salle, ou rien.

    Rien quand le dossier ou le fichier manque, quand l'un des deux est un
    lien, quand le fichier dépasse `CLE_MAX` ou n'est pas une clé valide
    (`worker.valid_key`). `chosen-person`, à côté, n'est jamais lu: c'est une
    adresse, et rien de ce que le salon publie de la salle n'en porte.
    """
    try:
        with dossier(salles_dir, numero) as fd:
            lu = lire(fd, JEU_RETENU, CLE_MAX)
    except OSError:
        return None
    if lu is None:
        return None
    try:
        cle = lu.contenu.decode("utf-8").strip()
    except UnicodeDecodeError:
        return None
    if not valid_key(cle):
        return None
    return JeuRetenu(cle=cle, choisi=lu.ecrit)


def sur_son_menu(salles_dir: Path, numero: int) -> bool | None:
    """Vrai quand le marqueur « sans jeu » est posé, faux sans lui, rien sans dossier.

    Le worker lit ce marqueur en suivant les liens (`try_exists`); le salon ne
    le suit pas. Un lien à ce nom compte donc comme « on ne sait pas ».
    """
    try:
        with dossier(salles_dir, numero) as fd:
            try:
                etat = os.stat(SANS_JEU, dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                return False
    except OSError:
        return None
    return True if stat.S_ISREG(etat.st_mode) else None


@dataclass(frozen=True)
class Ouverture:
    """L'instant où le salon a ouvert cette salle, sur l'horloge monotone.

    L'horloge monotone repart à zéro à chaque démarrage de la machine: le repère
    porte donc l'identifiant de ce démarrage (`/proc/sys/kernel/random/boot_id`),
    et un repère d'un autre démarrage ne vaut rien.
    """

    demarrage: str
    #: Microsecondes d'horloge monotone, la même unité que systemd.
    monotone_us: int

    def ligne(self) -> bytes:
        return f"{self.demarrage} {self.monotone_us}\n".encode()

    @classmethod
    def lue(cls, contenu: bytes) -> "Ouverture | None":
        try:
            mots = contenu.decode("ascii").split()
        except UnicodeDecodeError:
            return None
        if len(mots) != 2 or not mots[1].isdecimal() or len(mots[0]) > 64:
            return None
        return cls(demarrage=mots[0], monotone_us=int(mots[1]))


@dataclass(frozen=True)
class OrdreOuverture:
    """Ouvrir la salle directement sur ce jeu, dans cet emplacement (D17).

    Le salon n'écrit QUE cet ordre. Le worker le passe à `remember_choice`, qui
    écrit seul le jeu retenu, la manette retenue pour ce jeu et la demande de
    partie neuve: écrire `chosen-rom` d'ici aurait pu démarrer un jeu Wii sur la
    manette d'un autre jeu, ou rejouer une vieille demande de partie neuve.
    """

    cle: str
    #: 0 partie neuve, 2 « ma sauvegarde »: les codes de la ligne de lancement.
    sauvegarde: int
    #: L'identité de qui ouvre, pour l'emplacement personnel; vide pour personne.
    personne: str

    def texte(self) -> bytes:
        """Les octets exacts que `OpenOrder::parse` lit, épinglés des deux côtés."""
        return (
            f"nel3ab-ouvrir 1\n{self.cle}\n{self.sauvegarde}\n{self.personne or '-'}\n"
        ).encode()


def poser_ouverture(salles_dir: Path, numero: int, ouverture: Ouverture) -> None:
    """Écrit le repère d'ouverture de cette salle. Lève `OSError`."""
    with dossier(salles_dir, numero, creer=True) as fd:
        ecrire(fd, OUVERTE_LE, ouverture.ligne())


def lire_ouverture(salles_dir: Path, numero: int) -> Ouverture | None:
    """Le repère d'ouverture de cette salle, ou rien (absent, lien, mal formé)."""
    try:
        with dossier(salles_dir, numero) as fd:
            lu = lire(fd, OUVERTE_LE, REPERE_MAX)
    except OSError:
        return None
    return Ouverture.lue(lu.contenu) if lu else None


def retirer_ouverture(salles_dir: Path, numero: int) -> None:
    """Retire le repère d'ouverture, sans jamais lever.

    Appelé après l'arrêt d'une salle: un dossier absent n'a rien à retirer, et
    un dossier remplacé par un lien ne doit pas faire croire l'arrêt raté. Un
    repère resté là est encore écarté à la lecture (`SallesController`).
    """
    with contextlib.suppress(OSError), dossier(salles_dir, numero) as fd:
        retirer(fd, OUVERTE_LE)


def retirer_ordre(salles_dir: Path, numero: int) -> None:
    """Retire l'ordre d'ouverture de cette salle, sans jamais lever.

    Après un démarrage refusé et à la fermeture: un ordre resté là déciderait du
    jeu d'un démarrage que personne n'a demandé sur lui.
    """
    with contextlib.suppress(OSError), dossier(salles_dir, numero) as fd:
        retirer(fd, ORDRE)


def demarrage_actuel() -> str | None:
    """L'identifiant du démarrage de cette machine, ou rien hors de Linux."""
    try:
        return Path("/proc/sys/kernel/random/boot_id").read_text(encoding="ascii").strip() or None
    except OSError:
        return None
