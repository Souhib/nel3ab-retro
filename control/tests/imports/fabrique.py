"""Des en-têtes de jeux fabriqués ici, octet par octet, et rien d'autre.

Aucun vrai jeu, aucune vraie ROM, aucune vraie clé: chaque fonction écrit les
quelques octets qu'un format place à un endroit connu, et des zéros ailleurs.
Les en-têtes NCA de la Switch sont chiffrés avec une clé que chaque essai tire
au hasard, et qui disparaît avec lui.
Le module ne dépend PAS du code qu'il sert à tester. Un décalage faux dans
l'identifiant ne peut donc pas être recopié ici sans qu'on le voie: les deux
côtés écrivent la même règle chacun de leur côté.

Les fichiers de plusieurs centaines de mégaoctets (une image Xbox 360 dont la
partition de jeu commence à 0xFD90000) sont décrits par un `Clairseme`: des
morceaux posés à leur décalage, des zéros entre eux, et une taille annoncée.
Rien n'est écrit sur le disque pour eux.
"""

import struct
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

#: Le logo Nintendo que la console de démarrage de la Game Boy compare, 48 octets.
LOGO_GB = bytes.fromhex(
    "CEED6666CC0D000B03730083000C000D0008111F8889000EDCCC6EE6DDDDD999BBBB67636E0EECCCDDDC999FBBB9333E"
)
#: Le début du logo compressé de la Game Boy Advance.
LOGO_GBA = bytes.fromhex("24FFAE51699AA221")

MAGIE_WII = 0x5D1C9EA3
MAGIE_GC = 0xC2339F3D


def poser(tampon: bytearray, decalage: int, octets: bytes) -> None:
    """Écrit `octets` à `decalage`, en agrandissant le tampon s'il le faut."""
    fin = decalage + len(octets)
    if len(tampon) < fin:
        tampon.extend(b"\0" * (fin - len(tampon)))
    tampon[decalage:fin] = octets


def be32(valeur: int) -> bytes:
    return struct.pack(">I", valeur)


def le32(valeur: int) -> bytes:
    return struct.pack("<I", valeur)


def le64(valeur: int) -> bytes:
    return struct.pack("<Q", valeur)


def entete_disque(
    *,
    wii: bool,
    identifiant: str = "GALE01",
    titre: str = "Super Essai Melee",
    disque: int = 0,
    revision: int = 0,
) -> bytes:
    """Les 0x80 premiers octets d'un disque GameCube ou Wii."""
    tampon = bytearray(0x80)
    poser(tampon, 0, identifiant.encode("ascii"))
    tampon[6] = disque
    tampon[7] = revision
    if wii:
        poser(tampon, 0x18, be32(MAGIE_WII))
    else:
        poser(tampon, 0x1C, be32(MAGIE_GC))
    poser(tampon, 0x20, titre.encode("cp1252")[:0x40])
    return bytes(tampon)


def iso_nintendo(
    *,
    wii: bool,
    nkit: bool = False,
    identifiant: str = "GALE01",
    titre: str = "Super Essai Melee",
    disque: int = 0,
) -> bytes:
    """Une image brute: l'en-tête du disque à 0, et la marque NKit à 0x200."""
    tampon = bytearray(entete_disque(wii=wii, identifiant=identifiant, titre=titre, disque=disque))
    poser(tampon, 0x440, b"\0")
    if nkit:
        poser(tampon, 0x200, b"NKIT")
    return bytes(tampon)


def rvz(
    *,
    type_disque: int,
    wia: bool = False,
    wii: bool | None = None,
    identifiant: str = "GALE01",
    titre: str = "Super Essai Melee",
) -> bytes:
    """Un en-tête RVZ ou WIA: magie, type de disque à 0x48, copie du disque à 0x58."""
    tampon = bytearray(0x100)
    poser(tampon, 0, b"WIA\x01" if wia else b"RVZ\x01")
    poser(tampon, 0x48, be32(type_disque))
    porte_wii = type_disque == 2 if wii is None else wii
    poser(tampon, 0x58, entete_disque(wii=porte_wii, identifiant=identifiant, titre=titre))
    return bytes(tampon)


def gcz(interieur: bytes, *, compresse: bool = True) -> bytes:
    """Un GCZ d'un seul bloc: en-tête de 32 octets, pointeur, empreinte, données."""
    taille_bloc = 0x4000
    clair = interieur.ljust(taille_bloc, b"\0")
    donnees = zlib.compress(clair) if compresse else clair
    pointeur = 0 if compresse else 1 << 63
    tete = le32(0xB10BC001) + le32(0) + le64(len(donnees)) + le64(taille_bloc)
    tete += le32(taille_bloc) + le32(1)
    return tete + le64(pointeur) + le32(zlib.adler32(donnees)) + donnees


def ciso(interieur: bytes) -> bytes:
    """Un CISO: magie, taille de bloc, carte des blocs, puis le premier bloc à 0x8000."""
    tampon = bytearray(0x8000)
    poser(tampon, 0, b"CISO")
    poser(tampon, 4, le32(0x200000))
    tampon[8] = 1
    poser(tampon, 0x8000, interieur)
    return bytes(tampon)


def wbfs(interieur: bytes, *, secteur: int = 9) -> bytes:
    """Un WBFS: magie, taille de secteur en puissance de deux, disque au secteur 1."""
    tampon = bytearray(0x400)
    poser(tampon, 0, b"WBFS")
    poser(tampon, 4, be32(1))
    tampon[8] = secteur
    tampon[9] = 21
    tampon[0xC] = 1
    poser(tampon, 1 << secteur, interieur)
    return bytes(tampon)


def pfs0(noms: list[str], *, taille_entree: int = 0x10) -> bytes:
    """Un conteneur PFS0 (NSP ou NSZ) dont les fichiers sont des zéros."""
    table = b""
    chaines = b""
    for rang, nom in enumerate(noms):
        table += le64(rang * taille_entree) + le64(taille_entree) + le32(len(chaines)) + le32(0)
        chaines += nom.encode() + b"\0"
    chaines = chaines.ljust((len(chaines) + 0x1F) & ~0x1F, b"\0")
    tete = b"PFS0" + le32(len(noms)) + le32(len(chaines)) + le32(0)
    return tete + table + chaines + b"\0" * (taille_entree * len(noms))


def hfs0(noms: list[str], tailles: list[int] | None = None) -> bytes:
    """Une partition HFS0, dont chaque entrée fait 0x40 octets."""
    tailles = tailles or [0x10] * len(noms)
    table = b""
    chaines = b""
    decalage = 0
    for nom, taille in zip(noms, tailles, strict=True):
        table += le64(decalage) + le64(taille) + le32(len(chaines)) + le32(0x200)
        table += b"\0" * 8 + b"\0" * 0x20
        chaines += nom.encode() + b"\0"
        decalage += taille
    tete = b"HFS0" + le32(len(noms)) + le32(len(chaines)) + le32(0)
    return tete + table + chaines


def xci(*, zone_cle: bool = False, secure: list[str] | None = None) -> bytes:
    """Une carte Switch: « HEAD » à 0x100, partition racine HFS0 à 0xF000."""
    base = 0x1000 if zone_cle else 0
    tampon = bytearray(base + 0x200)
    poser(tampon, base + 0x100, b"HEAD")
    racine_a = 0xF000
    secure = secure if secure is not None else ["0123456789abcdef0123456789abcdef.nca"]
    interieur = hfs0(secure)
    racine = hfs0(["update", "normal", "secure"], [0x10, 0x10, len(interieur)])
    poser(tampon, base + 0x130, le64(racine_a))
    poser(tampon, base + 0x138, le64(len(racine)))
    poser(tampon, base + racine_a, racine)
    poser(tampon, base + racine_a + len(racine) + 0x20, interieur)
    return bytes(tampon)


def xex(titre_id: int) -> bytes:
    """Un exécutable Xbox 360: « XEX2 », un en-tête optionnel d'exécution."""
    tampon = bytearray(0x200)
    poser(tampon, 0, b"XEX2")
    poser(tampon, 0x14, be32(1))
    poser(tampon, 0x18, be32(0x00040006) + be32(0x100))
    poser(tampon, 0x100 + 0x0C, be32(titre_id))
    return bytes(tampon)


def stfs(magie: bytes, *, titre_id: int, type_contenu: int, nom: str) -> bytes:
    """Un paquet STFS (CON, LIVE ou PIRS): type à 0x344, titre à 0x360, nom à 0x411."""
    tampon = bytearray(0x1800)
    poser(tampon, 0, magie)
    poser(tampon, 0x344, be32(type_contenu))
    poser(tampon, 0x360, be32(titre_id))
    poser(tampon, 0x411, nom.encode("utf-16-be"))
    return bytes(tampon)


def xdvdfs(executable: str) -> dict[int, bytes]:
    """Le volume XDVDFS d'une partition de jeu: secteur 32 et répertoire racine.

    Rend des morceaux RELATIFS au début de la partition, que l'appelant pose au
    décalage qu'il veut (0, 0xFD90000 ou 0x2080000).
    """
    volume = b"MICROSOFT*XBOX*MEDIA" + le32(33) + le32(0x800)
    nom = executable.encode()
    entree = struct.pack("<HHIIBB", 0, 0, 40, 0x1000, 0x20, len(nom)) + nom
    return {0x10000: volume, 33 * 0x800: entree}


def nes(*, nes2: bool = False) -> bytes:
    tampon = bytearray(16 + 0x4000 + 0x2000)
    poser(tampon, 0, b"NES\x1a")
    tampon[4] = 1
    tampon[5] = 1
    tampon[7] = 0x08 if nes2 else 0
    return bytes(tampon)


def n64(ordre: str = "z64", titre: str = "SUPER ESSAI 64") -> bytes:
    """Un en-tête N64 en z64 (gros-boutiste), puis réordonné en v64 ou n64."""
    tampon = bytearray(0x1000)
    poser(tampon, 0, bytes.fromhex("80371240"))
    poser(tampon, 0x20, titre.encode("ascii").ljust(20, b" "))
    poser(tampon, 0x3B, b"NSEP")
    octets = bytes(tampon)
    if ordre == "v64":
        return b"".join(octets[i + 1 : i + 2] + octets[i : i + 1] for i in range(0, len(octets), 2))
    if ordre == "n64":
        return b"".join(octets[i : i + 4][::-1] for i in range(0, len(octets), 4))
    return octets


def game_boy(*, couleur: int = 0, somme_fausse: bool = False, titre: str = "ESSAI") -> bytes:
    tampon = bytearray(0x8000)
    poser(tampon, 0x104, LOGO_GB)
    poser(tampon, 0x134, titre.encode("ascii"))
    tampon[0x143] = couleur
    somme = 0
    for octet in tampon[0x134:0x14D]:
        somme = (somme - octet - 1) & 0xFF
    tampon[0x14D] = (somme + 1) & 0xFF if somme_fausse else somme
    return bytes(tampon)


def gba(*, complement_faux: bool = False) -> bytes:
    tampon = bytearray(0x200)
    poser(tampon, 4, LOGO_GBA)
    poser(tampon, 0xA0, b"ESSAI AVANCE")
    poser(tampon, 0xAC, b"AEXF")
    poser(tampon, 0xB0, b"01")
    tampon[0xB2] = 0x96
    complement = (-sum(tampon[0xA0:0xBD]) - 0x19) & 0xFF
    tampon[0xBD] = (complement + 1) & 0xFF if complement_faux else complement
    return bytes(tampon)


def nds(*, crc_logo: int = 0xCF56) -> bytes:
    tampon = bytearray(0x200)
    poser(tampon, 0, b"ESSAI DS")
    poser(tampon, 0x0C, b"AEXP")
    poser(tampon, 0x15C, struct.pack("<H", crc_logo))
    return bytes(tampon)


def mega_drive() -> bytes:
    tampon = bytearray(0x200)
    poser(tampon, 0x100, b"SEGA MEGA DRIVE ")
    poser(tampon, 0x120, b"ESSAI DOMESTIQUE".ljust(48, b" "))
    poser(tampon, 0x150, b"SONIC ESSAI".ljust(48, b" "))
    return bytes(tampon)


def iso9660(*, systeme: str, boot: str | None, brut: bool = False) -> bytes:
    """Un disque ISO 9660: descripteur au secteur 16, racine, et SYSTEM.CNF.

    En secteurs de 2048 octets, ou bruts de 2352 en mode 2 (données à +24).
    """
    taille_secteur = 2352 if brut else 2048
    debut = 24 if brut else 0
    secteurs: dict[int, bytes] = {}
    pvd = bytearray(2048)
    pvd[0] = 1
    poser(pvd, 1, b"CD001")
    poser(pvd, 8, systeme.encode().ljust(32, b" "))
    poser(pvd, 40, b"ESSAI_DISQUE".ljust(32, b" "))
    racine = bytearray(2048)
    enregistrements = b""
    for nom, lba in ((b"\0", 18), (b"\1", 18)) + (((b"SYSTEM.CNF;1", 19),) if boot else ()):
        longueur = 33 + len(nom) + (len(nom) + 1) % 2
        rec = bytearray(longueur)
        rec[0] = longueur
        poser(rec, 2, le32(lba))
        poser(rec, 10, le32(2048 if lba == 18 else 64))
        rec[32] = len(nom)
        poser(rec, 33, nom)
        enregistrements += bytes(rec)
    poser(racine, 0, enregistrements)
    poser(pvd, 156, enregistrements[:34])
    secteurs[16] = bytes(pvd)
    secteurs[18] = bytes(racine)
    if boot:
        secteurs[19] = boot.encode().ljust(64, b"\n")
    tampon = bytearray(20 * taille_secteur)
    if brut:
        # Chaque secteur brut commence par sa synchronisation et son mode.
        for lba in range(20):
            poser(tampon, lba * taille_secteur, b"\0" + b"\xff" * 10 + b"\0")
            tampon[lba * taille_secteur + 15] = 2
    for lba, donnees in secteurs.items():
        poser(tampon, lba * taille_secteur + debut, donnees)
    return bytes(tampon)


def chd() -> bytes:
    return b"MComprHD" + be32(124) + be32(5) + b"\0" * 112


def texte() -> bytes:
    return ("Liste de courses\n- pain\n- lait\n" * 40).encode()


@dataclass
class Clairseme:
    """Un fichier immense décrit par quelques morceaux, et des zéros entre eux."""

    taille: int
    morceaux: dict[int, bytes] = field(default_factory=dict)

    def poser(self, decalage: int, octets: bytes) -> None:
        self.morceaux[decalage] = octets

    def lire(self, decalage: int, longueur: int) -> bytes:
        if decalage >= self.taille or longueur <= 0:
            return b""
        fin = min(self.taille, decalage + longueur)
        tampon = bytearray(fin - decalage)
        for debut, octets in self.morceaux.items():
            a = max(debut, decalage)
            b = min(debut + len(octets), fin)
            if a < b:
                tampon[a - decalage : b - decalage] = octets[a - debut : b - debut]
        return bytes(tampon)


def lecteur(octets: bytes) -> Callable[[int, int], bytes]:
    """Lit dans un fichier tenu en mémoire, comme `os.pread` lirait sur disque."""
    return lambda decalage, longueur: octets[decalage : decalage + max(longueur, 0)]


def _nombre_7z(valeur: int) -> bytes:
    """Un NUMBER du format 7z: un octet sous 0x80, sinon 0xFF et huit octets."""
    return bytes([valeur]) if valeur < 0x80 else b"\xff" + le64(valeur)


def sept_zip(fichiers: list[tuple[str, bytes]]) -> bytes:
    """Une archive 7z sans compression (méthode « Copy »), un dossier par fichier.

    Écrite à la main parce que la machine n'a pas `7z`: `lsar` et `unar` la
    lisent comme une vraie, ce qui fait passer l'essai par ces outils réels.
    """
    paquets = b"".join(donnees for _, donnees in fichiers)
    n = len(fichiers)
    tete = b"\x01\x04"
    tete += b"\x06" + _nombre_7z(0) + _nombre_7z(n)
    tete += b"\x09" + b"".join(_nombre_7z(len(d)) for _, d in fichiers) + b"\x00"
    tete += b"\x07\x0b" + _nombre_7z(n) + b"\x00"
    tete += (_nombre_7z(1) + b"\x01\x00") * n
    tete += b"\x0c" + b"".join(_nombre_7z(len(d)) for _, d in fichiers) + b"\x00"
    tete += b"\x08\x0a\x01" + b"".join(le32(zlib.crc32(d)) for _, d in fichiers) + b"\x00"
    tete += b"\x00"
    noms = b"\x00" + b"".join(nom.encode("utf-16-le") + b"\0\0" for nom, _ in fichiers)
    tete += b"\x05" + _nombre_7z(n) + b"\x11" + _nombre_7z(len(noms)) + noms + b"\x00"
    tete += b"\x00"
    debut = le64(len(paquets)) + le64(len(tete)) + le32(zlib.crc32(tete))
    signature = b"7z\xbc\xaf\x27\x1c\x00\x04" + le32(zlib.crc32(debut)) + debut
    return signature + paquets + tete


# ── Switch: des NCA chiffrés ICI, avec une clé tirée au hasard par l'essai ──
#
# Le chiffrement est écrit ici, avec `cryptography` directement, sans le module
# testé. La règle de Nintendo vient de switchbrew (page NCA): AES-128-XTS sur
# des secteurs de 0x200 octets, numéro de secteur en GROS-BOUTISTE sur 16
# octets. Un module qui l'écrirait en petit-boutiste ne relirait pas ces octets.

TYPE_PROGRAM = 0
TYPE_META = 1
TYPE_CONTROL = 2
TYPE_PUBLIC_DATA = 5


def chiffrer_entete(clair: bytes, cle: bytes) -> bytes:
    """Les octets d'un en-tête NCA3, chiffrés comme la console les écrit."""
    chiffre = b""
    for secteur in range(len(clair) // 0x200):
        ajustement = secteur.to_bytes(16, "big")
        chiffreur = Cipher(algorithms.AES(cle), modes.XTS(ajustement)).encryptor()
        chiffre += chiffreur.update(clair[secteur * 0x200 : (secteur + 1) * 0x200])
        chiffre += chiffreur.finalize()
    return chiffre


def entete_nca(
    type_contenu: int,
    titre: int,
    taille: int,
    *,
    magie: bytes = b"NCA3",
    generation: int = 0x11,
) -> bytes:
    """Un en-tête NCA en clair: magie à 0x200, type à 0x205, taille à 0x208, titre à 0x210."""
    tampon = bytearray(0xC00)
    poser(tampon, 0x200, magie)
    tampon[0x205] = type_contenu
    tampon[0x206] = 2
    poser(tampon, 0x208, le64(taille))
    poser(tampon, 0x210, le64(titre))
    tampon[0x220] = generation
    return bytes(tampon)


def nca(
    cle: bytes,
    type_contenu: int,
    titre: int,
    *,
    taille: int = 0xE00,
    annonce: int | None = None,
    magie: bytes = b"NCA3",
    generation: int = 0x11,
) -> bytes:
    """Une partie NCA entière: l'en-tête chiffré, puis des zéros jusqu'à `taille`.

    `annonce` est la taille écrite dans l'en-tête, la vraie par défaut. Une
    `taille` sous 0xC00 coupe l'en-tête lui-même.
    """
    ecrite = taille if annonce is None else annonce
    clair = entete_nca(type_contenu, titre, ecrite, magie=magie, generation=generation)
    return (chiffrer_entete(clair, cle) + b"\0" * max(taille - 0xC00, 0))[:taille]


def pfs0_avec(fichiers: list[tuple[str, bytes]]) -> bytes:
    """Un NSP: table PFS0 de 24 octets par entrée, noms, puis les données bout à bout."""
    chaines = b""
    debuts = []
    for nom, _ in fichiers:
        debuts.append(len(chaines))
        chaines += nom.encode() + b"\0"
    chaines = chaines.ljust((len(chaines) + 0x1F) & ~0x1F, b"\0")
    table = b""
    position = 0
    for (_, donnees), debut in zip(fichiers, debuts, strict=True):
        table += le64(position) + le64(len(donnees)) + le32(debut) + le32(0)
        position += len(donnees)
    tete = b"PFS0" + le32(len(fichiers)) + le32(len(chaines)) + le32(0)
    return tete + table + chaines + b"".join(d for _, d in fichiers)


def hfs0_avec(fichiers: list[tuple[str, bytes]]) -> bytes:
    """Une partition HFS0: 0x40 octets par entrée, noms, puis les données."""
    chaines = b""
    debuts = []
    for nom, _ in fichiers:
        debuts.append(len(chaines))
        chaines += nom.encode() + b"\0"
    table = b""
    position = 0
    for (_, donnees), debut in zip(fichiers, debuts, strict=True):
        table += le64(position) + le64(len(donnees)) + le32(debut) + le32(0x200)
        table += b"\0" * 8 + b"\0" * 0x20
        position += len(donnees)
    tete = b"HFS0" + le32(len(fichiers)) + le32(len(chaines)) + le32(0)
    return tete + table + chaines + b"".join(d for _, d in fichiers)


def xci_avec(secure: list[tuple[str, bytes]], *, zone_cle: bool = False) -> bytes:
    """Une carte: « HEAD » à 0x100, racine HFS0 à 0xF000, puis update, normal, secure."""
    base = 0x1000 if zone_cle else 0
    tampon = bytearray(base + 0x200)
    poser(tampon, base + 0x100, b"HEAD")
    racine = hfs0_avec(
        [("update", hfs0_avec([])), ("normal", hfs0_avec([])), ("secure", hfs0_avec(secure))]
    )
    poser(tampon, base + 0x130, le64(0xF000))
    poser(tampon, base + 0x138, le64(len(racine)))
    poser(tampon, base + 0xF000, racine)
    return bytes(tampon)


def prod_keys(cle: bytes) -> str:
    """Un `prod.keys` d'essai: la ligne de la clé d'en-tête entre deux autres."""
    return (
        f"aes_kek_generation_source = {'00' * 16}\n"
        f"header_key = {cle.hex()}\n"
        f"master_key_00 = {'11' * 16}\n"
    )
