"""Ce qu'un NSP ou un XCI contient, lu dans l'en-tête chiffré de ses NCA.

# Pourquoi la clé d'en-tête

Un jeu Switch entre dans la salle par une fiche `<fichier>.nel3ab.json` qui
porte son identifiant de titre (`emulator::switch::registered`). Cet
identifiant est écrit dans l'en-tête de chaque NCA, le conteneur interne des
contenus Switch, et cet en-tête est chiffré avec la clé d'en-tête de la
console. Le nom du ticket le propose aussi, mais ce nom n'est pas chiffré:
n'importe qui peut l'écrire. Seul l'en-tête déchiffré le prouve.

La machine tient déjà cette clé, dans le `prod.keys` privé du moteur Switch.
Le salon en lit UNE ligne, `header_key`, et rien d'autre. Elle reste en
mémoire, n'est écrite nulle part, et aucun message ne la montre: une raison
d'échec dit ce qui manque, jamais une valeur lue.

# Le chiffrement

AES-128-XTS sur des secteurs de 0x200 octets, avec le numéro de secteur écrit
en GROS-BOUTISTE sur 128 bits comme valeur d'ajustement (« tweak »). Le
standard l'écrit en petit-boutiste; Nintendo fait l'inverse (switchbrew, page
NCA). `docker/switch-dlc.py` fait le même calcul, vérifié le 11 septembre 2026
sur une vraie mise à jour et 99 contenus additionnels. Seuls les 0xC00
premiers octets de chaque NCA sont déchiffrés. Pour un NCA3, ce sont six
secteurs numérotés de 0 à 5. Un NCA2 chiffre ses quatre en-têtes de section
chacun comme un secteur 0; ce module ne lit que les secteurs 0 et 1, communs
aux deux versions.

# Ce qui prouve que la clé est la bonne

Une mauvaise clé donne des octets au hasard. Deux contrôles indépendants le
voient: la marque « NCA3 » (ou « NCA2 ») à 0x200, et la taille que l'en-tête
annonce à 0x208, qui doit être celle de la partie dans le conteneur. Un
fichier dont une seule partie échoue est refusé en entier.

# Jeu, mise à jour ou contenu additionnel

La partie Meta (le CNMT, qui décrit un contenu) porte l'identifiant du contenu
lui-même. Un jeu de base finit par 000 avec le bit 0x1000 à zéro; sa mise à
jour est le même nombre plus 0x800; un contenu additionnel est le jeu plus
0x1000, puis son numéro. La partie Program d'une mise à jour porte au
contraire l'identifiant du jeu: elle seule ne distingue pas un jeu de sa mise à
jour, d'où l'exigence d'une partie Meta. Le type exact écrit DANS le CNMT
demande de déchiffrer la section avec une autre clé, et n'est pas lu ici.

Ce module ne lève pas sur des octets abîmés: il rend `Illisible` ou
`Incertain`, avec la raison.
"""

import re
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from nel3ab_control.imports.identifier import Lecteur

#: Ce qui est déchiffré de chaque NCA: l'en-tête et ses quatre en-têtes de section.
TAILLE_ENTETE = 0xC00
SECTEUR = 0x200

#: Les types de contenu à 0x205 de l'en-tête déchiffré (switchbrew).
PROGRAM = 0
META = 1
CONTROL = 2
PUBLIC_DATA = 5
TYPES = {0: "Program", 1: "Meta", 2: "Control", 3: "Manual", 4: "Data", 5: "PublicData"}

#: Les identifiants des applications de la Switch: au-dessous, des titres du
#: système; à partir de 0x02, d'autres familles, dont la Switch 2 (0x04).
PREMIERE_APPLICATION = 0x0100000000010000
FIN_SWITCH = 0x0200000000000000

#: Un `prod.keys` fait quelques Kio. Au-delà, ce n'est pas lui.
CLES_MAX = 1 << 16

#: Les mêmes bornes que l'identifiant pour une table PFS0 ou HFS0.
ENTREES_MAX = 4096
NOMS_MAX = 1 << 20

Sorte = Literal["jeu", "mise-a-jour", "contenu-additionnel"]


# ── La clé ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CleEntete:
    """La clé d'en-tête de la console: 32 octets, jamais montrés.

    `repr=False`: un `Regles` écrit dans un journal ou une trace d'erreur ne
    doit pas emporter la clé avec lui.
    """

    octets: bytes = field(repr=False)

    def __post_init__(self) -> None:
        if len(self.octets) != 32:
            raise ValueError("une clé d'en-tête fait 32 octets")


@dataclass(frozen=True)
class SansCle:
    """Pas de clé, et pourquoi. Le jeu attend alors une inscription à la main."""

    raison: str


LIGNE_CLE = re.compile(r"^\s*header_key\s*=\s*(\S*)\s*$")


def charger_cle(chemin: Path | None) -> CleEntete | SansCle:
    """La ligne `header_key` d'un `prod.keys`, ou la raison de son absence.

    Aucune raison ne contient un octet du fichier: elle dit ce qui manque.
    """
    if chemin is None:
        return SansCle("aucun fichier de clés n'est réglé (NEL3AB_SWITCH_KEYS)")
    try:
        with chemin.open("rb") as flux:
            brut = flux.read(CLES_MAX + 1)
    except OSError as erreur:
        return SansCle(
            f"le fichier de clés réglé (NEL3AB_SWITCH_KEYS) ne se lit pas: {erreur.strerror}"
        )
    if len(brut) > CLES_MAX:
        return SansCle("le fichier de clés réglé est trop gros pour être un prod.keys")
    texte = brut.decode("ascii", "replace")
    valeurs = [m.group(1) for ligne in texte.splitlines() if (m := LIGNE_CLE.match(ligne))]
    if not valeurs:
        return SansCle("le fichier de clés réglé n'a pas de ligne header_key")
    if len(valeurs) > 1:
        return SansCle("le fichier de clés réglé a plusieurs lignes header_key")
    valeur = valeurs[0]
    if not re.fullmatch(r"[0-9a-fA-F]{64}", valeur):
        return SansCle("la ligne header_key n'a pas 64 chiffres hexadécimaux")
    return CleEntete(bytes.fromhex(valeur))


# ── Les résultats ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Nca:
    """Ce que l'en-tête déchiffré d'une partie NCA dit d'elle."""

    nom: str
    version: str
    type_contenu: int
    titre: int
    #: La plus grande des deux générations de clé (0x206 et 0x220).
    generation: int


@dataclass(frozen=True)
class Contenu:
    """Un fichier lu: ce qu'il est, et le jeu auquel il appartient."""

    sorte: Sorte
    #: L'identifiant de la partie Meta: celui du jeu, de la mise à jour ou du
    #: contenu additionnel.
    titre: int
    #: L'identifiant du jeu de base auquel il appartient.
    base: int
    generation: int
    parties: tuple[Nca, ...]


@dataclass(frozen=True)
class Illisible:
    """Les en-têtes ne se lisent pas: clé fausse, ou fichier abîmé. Refusé."""

    raison: str


@dataclass(frozen=True)
class Incertain:
    """Les en-têtes se lisent, mais ne disent pas « un seul jeu de base »."""

    raison: str


Lecture = Contenu | Illisible | Incertain | SansCle


class _Illisible(Exception):  # noqa: N818 - un constat sur les octets, pas une panne
    pass


class _Incertain(Exception):  # noqa: N818 - un constat sur les octets, pas une panne
    pass


# ── Les conteneurs ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Partie:
    """Un fichier d'un conteneur PFS0 ou HFS0, à son décalage dans le fichier."""

    nom: str
    decalage: int
    taille: int


def _octets(lire: Lecteur, taille: int, decalage: int, longueur: int) -> bytes:
    if decalage < 0 or longueur < 0 or decalage + longueur > taille:
        raise _Illisible(f"une table pointe hors du fichier ({decalage:#x}, {longueur} octets)")
    lus = lire(decalage, longueur) if longueur else b""
    if len(lus) != longueur:
        raise _Illisible(f"le fichier s'arrête avant {decalage + longueur:#x}")
    return lus


def _table(lire: Lecteur, taille: int, a: int, magie: bytes, taille_entree: int) -> list[Partie]:
    """Les fichiers d'une table PFS0 (24 octets par entrée) ou HFS0 (0x40)."""
    tete = _octets(lire, taille, a, 0x10)
    if tete[:4] != magie:
        raise _Illisible(f"« {magie.decode()} » attendu à {a:#x}")
    nombre, longueur_noms = struct.unpack_from("<II", tete, 4)
    if nombre > ENTREES_MAX or longueur_noms > NOMS_MAX:
        raise _Illisible(f"table {magie.decode()} impossible à {a:#x}")
    table = _octets(lire, taille, a + 0x10, nombre * taille_entree)
    noms = _octets(lire, taille, a + 0x10 + nombre * taille_entree, longueur_noms)
    donnees = a + 0x10 + nombre * taille_entree + longueur_noms
    parties = []
    for rang in range(nombre):
        decalage, longueur, debut_nom = struct.unpack_from("<QQI", table, rang * taille_entree)
        fin_nom = noms.find(b"\0", debut_nom)
        if debut_nom >= len(noms) or fin_nom < 0:
            raise _Illisible(f"un nom de la table {magie.decode()} sort de sa table")
        nom = noms[debut_nom:fin_nom].decode("utf-8", "replace")
        if donnees + decalage + longueur > taille:
            raise _Illisible(f"« {nom} » dépasse la fin du fichier: fichier tronqué")
        parties.append(Partie(nom, donnees + decalage, longueur))
    return parties


def parties_nsp(lire: Lecteur, taille: int) -> list[Partie]:
    """Les fichiers d'un NSP: une table PFS0 à 0."""
    return _table(lire, taille, 0, b"PFS0", 24)


def parties_xci(lire: Lecteur, taille: int) -> list[Partie]:
    """Les fichiers de la partition « secure » d'un XCI, où sont les NCA du jeu.

    L'en-tête « HEAD » est à 0x100, ou à 0x1100 quand la copie garde la zone
    de clé de la carte devant lui; les décalages se comptent alors depuis 0x1000.
    """
    for base in (0, 0x1000):
        if taille >= base + 0x140 and _octets(lire, taille, base + 0x100, 4) == b"HEAD":
            break
    else:
        raise _Illisible("« HEAD » absent à 0x100 et à 0x1100")
    (racine,) = struct.unpack("<Q", _octets(lire, taille, base + 0x130, 8))
    partitions = _table(lire, taille, base + racine, b"HFS0", 0x40)
    secure = [p for p in partitions if p.nom == "secure"]
    if len(secure) != 1:
        raise _Illisible("la carte n'a pas une et une seule partition « secure »")
    return _table(lire, taille, secure[0].decalage, b"HFS0", 0x40)


# ── Les en-têtes ───────────────────────────────────────────────────────────


def dechiffrer_entete(chiffre: bytes, cle: CleEntete) -> bytes:
    """Les 0xC00 premiers octets d'un NCA, déchiffrés secteur par secteur."""
    if len(chiffre) != TAILLE_ENTETE:
        raise ValueError(f"un en-tête NCA fait {TAILLE_ENTETE} octets")
    clair = bytearray()
    for secteur in range(TAILLE_ENTETE // SECTEUR):
        # Le numéro du secteur en gros-boutiste: la variante de Nintendo.
        ajustement = secteur.to_bytes(16, "big")
        dechiffreur = Cipher(algorithms.AES(cle.octets), modes.XTS(ajustement)).decryptor()
        morceau = chiffre[secteur * SECTEUR : (secteur + 1) * SECTEUR]
        clair += dechiffreur.update(morceau) + dechiffreur.finalize()
    return bytes(clair)


def lire_nca(lire: Lecteur, taille: int, partie: Partie, cle: CleEntete) -> Nca:
    """L'en-tête d'une partie NCA, vérifié, ou `_Illisible`."""
    if partie.taille < TAILLE_ENTETE:
        raise _Illisible(
            f"la partie « {partie.nom} » fait {partie.taille} octets, moins que son en-tête "
            f"({TAILLE_ENTETE}): fichier tronqué"
        )
    clair = dechiffrer_entete(_octets(lire, taille, partie.decalage, TAILLE_ENTETE), cle)
    version = clair[0x200:0x204]
    if version not in (b"NCA3", b"NCA2"):
        raise _Illisible(
            f"la partie « {partie.nom} » ne porte pas « NCA3 » une fois déchiffrée: "
            "clé d'en-tête fausse, ou fichier abîmé"
        )
    (annonce,) = struct.unpack_from("<Q", clair, 0x208)
    if annonce != partie.taille:
        raise _Illisible(
            f"la partie « {partie.nom} » annonce {annonce} octets et le conteneur en donne "
            f"{partie.taille}: clé d'en-tête fausse, ou fichier abîmé"
        )
    (titre,) = struct.unpack_from("<Q", clair, 0x210)
    return Nca(
        nom=partie.nom,
        version=version.decode(),
        type_contenu=clair[0x205],
        titre=titre,
        generation=max(clair[0x206], clair[0x220]),
    )


# ── Le verdict ─────────────────────────────────────────────────────────────


def sorte_de(titre: int) -> tuple[Sorte, int] | None:
    """La sorte d'un identifiant de contenu, et le jeu de base auquel il appartient.

    Un contenu additionnel numéroté 0 n'existe pas: le jeu plus 0x1000 est la
    base de leur famille, que la console ne distribue jamais seule.
    """
    bas = titre & 0x1FFF
    if bas == 0:
        return "jeu", titre
    if bas == 0x800:
        return "mise-a-jour", titre & ~0x1FFF
    if bas & 0x1000 and bas & 0xFFF:
        return "contenu-additionnel", titre & ~0x1FFF
    return None


def _verdict(ncas: list[Nca]) -> Contenu:
    if not ncas:
        raise _Incertain("aucune partie NCA dans le fichier")
    metas = sorted({nca.titre for nca in ncas if nca.type_contenu == META})
    if not metas:
        raise _Incertain(
            "aucune partie Meta: sans elle, un jeu et sa mise à jour portent le même titre"
        )
    sortes: dict[int, tuple[Sorte, int]] = {}
    for titre in metas:
        lue = sorte_de(titre)
        if lue is None:
            raise _Incertain(
                f"le titre {titre:016X} n'est ni un jeu, ni une mise à jour, ni un ajout"
            )
        sortes[titre] = lue
    bases = {base for _, base in sortes.values()}
    if len(bases) != 1:
        noms = ", ".join(f"{b:016X}" for b in sorted(bases))
        raise _Incertain(f"le fichier tient plusieurs jeux ({noms})")
    (base,) = bases
    if not PREMIERE_APPLICATION <= base < FIN_SWITCH:
        raise _Incertain(f"le titre {base:016X} n'est pas celui d'un jeu Switch")
    generation = max(nca.generation for nca in ncas)
    if base in sortes:
        # Le jeu, éventuellement avec sa mise à jour ou ses ajouts sur la même
        # carte: c'est le jeu qui s'inscrit. Son programme doit y être.
        if not any(n.type_contenu == PROGRAM and n.titre == base for n in ncas):
            raise _Incertain(f"la partie Program du jeu {base:016X} manque")
        return Contenu("jeu", base, base, generation, tuple(ncas))
    sortes_lues = {sorte for sorte, _ in sortes.values()}
    if len(sortes_lues) != 1 or len(metas) != 1:
        raise _Incertain(
            f"le fichier tient plusieurs contenus du jeu {base:016X}, sans le jeu lui-même"
        )
    return Contenu(sortes_lues.pop(), metas[0], base, generation, tuple(ncas))


def lire_contenu(lire: Lecteur, taille: int, format_: str, cle: CleEntete | SansCle) -> Lecture:
    """Ce qu'est un NSP ou un XCI, d'après les en-têtes déchiffrés de ses NCA."""
    if isinstance(cle, SansCle):
        return cle
    try:
        if format_ == "nsp":
            parties = parties_nsp(lire, taille)
        elif format_ == "xci":
            parties = parties_xci(lire, taille)
        else:
            return Incertain(f"le format {format_} n'est pas un NSP ou un XCI")
        ncas = [
            lire_nca(lire, taille, partie, cle)
            for partie in parties
            if partie.nom.lower().endswith(".nca")
        ]
        return _verdict(ncas)
    except _Illisible as raison:
        return Illisible(str(raison))
    except _Incertain as raison:
        return Incertain(str(raison))
    except (struct.error, ValueError, OverflowError) as erreur:
        return Illisible(f"en-tête illisible ({erreur})")
