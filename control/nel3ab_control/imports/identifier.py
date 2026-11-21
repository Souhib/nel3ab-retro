"""Ce qu'un fichier est, lu dans ses octets, jamais dans son nom.

# Pourquoi les octets et pas l'extension

Une extension est une convention que n'importe qui peut écrire. `.iso` sert à
cinq consoles, un `.nsp` peut être une mise à jour plutôt qu'un jeu, et un
fichier renommé à la main garde son ancien contenu. Chaque format pose ici des
mots connus à des endroits connus, vérifiés le 20 novembre 2026 sur les vingt
fichiers réels de la bibliothèque et dans les sources de Dolphin et de
switchbrew (voir l'audit d'import). L'identifiant ne reçoit donc PAS le nom du
fichier: il ne pourrait que le croire.

# Pourquoi un lecteur et pas 64 Kio

Le navigateur n'a sous la main que le début du fichier, et son estimation
s'arrête là. Le serveur a le fichier entier: une image Xbox 360 cache son
système de fichiers à 0xFD90000, et un GCZ ne dit sa console qu'une fois son
premier bloc décompressé. `lire(decalage, longueur)` rend ce qu'il trouve,
plus court en fin de fichier, et l'identifiant ne lit que ce qu'il cherche.

# Ce que ce module ne fait jamais

Il ne lance aucun programme, aucun conteneur, et ne lit aucune clé. Un fichier
venu d'un navigateur n'a pas à toucher Docker, qui équivaut à root. Ce qui ne
se lit pas sans clé reste « à vérifier » ici: le titre chiffré d'un jeu Switch
se lit à part, dans `switch_nca.py`, avec la seule clé d'en-tête de la console.

Il ne lève pas non plus sur des octets abîmés: un en-tête tronqué, une table
qui pointe hors du fichier ou des octets au hasard donnent « inconnu ».
"""

import re
import struct
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field

#: Lit `longueur` octets à `decalage`, ou moins en fin de fichier.
Lecteur = Callable[[int, int], bytes]


@dataclass(frozen=True)
class Identification:
    """Ce qu'on sait d'un fichier après l'avoir lu.

    `console` vaut `None` quand aucune console n'est établie: fichier inconnu,
    archive, ou format connu dont la console ne se lit pas sans décompresser.
    Ce n'est jamais un défaut deviné.
    """

    console: str | None
    format: str
    titre: str = ""
    identifiant: str = ""
    drapeaux: frozenset[str] = frozenset()
    preuve: str = ""
    details: dict[str, str] = field(default_factory=dict)


INCONNU = "inconnu"

MAGIE_WII = 0x5D1C9EA3
MAGIE_GC = 0xC2339F3D

#: Les décalages possibles de la partition de jeu d'un disque Xbox. Zéro pour
#: une image extraite (« xiso »), puis XGD2 et XGD3 pour la Xbox 360, et XGD1
#: pour la Xbox d'origine.
PARTITIONS_XBOX = ((0, None), (0xFD90000, "XGD2"), (0x2080000, "XGD3"), (0x18300000, "XGD1"))

LOGO_GB = bytes.fromhex(
    "CEED6666CC0D000B03730083000C000D0008111F8889000EDCCC6EE6DDDDD999BBBB67636E0EECCCDDDC999FBBB9333E"
)
LOGO_GBA = bytes.fromhex("24FFAE51699AA221")

#: Les types de contenu STFS dont le nom est sûr. Les autres sont donnés en
#: chiffres plutôt que devinés.
TYPES_STFS = {
    0x00000001: "sauvegarde",
    0x00000002: "contenu téléchargeable",
    0x00007000: "Games on Demand",
    0x000B0000: "mise à jour",
    0x000D0000: "jeu Arcade",
}


class _Lecture:
    """Le lecteur, avec des lectures qui ne lèvent jamais."""

    def __init__(self, lire: Lecteur, taille: int) -> None:
        self._lire = lire
        self.taille = taille

    def octets(self, decalage: int, longueur: int) -> bytes:
        """Exactement `longueur` octets, ou rien s'ils n'y sont pas tous."""
        if decalage < 0 or longueur <= 0 or decalage + longueur > self.taille:
            return b""
        lus = self._lire(decalage, longueur)
        return lus if len(lus) == longueur else b""

    def egal(self, decalage: int, attendu: bytes) -> bool:
        return self.octets(decalage, len(attendu)) == attendu

    def entier(self, decalage: int, forme: str) -> int | None:
        taille = struct.calcsize(forme)
        lus = self.octets(decalage, taille)
        return struct.unpack(forme, lus)[0] if lus else None


def _texte(octets: bytes, codage: str = "ascii") -> str:
    """Un texte d'en-tête: coupé au premier zéro, sans caractère de contrôle."""
    brut = octets.split(b"\0", 1)[0]
    lu = brut.decode(codage, "replace")
    return " ".join("".join(c for c in lu if c.isprintable()).split())


def _texte_utf16(octets: bytes) -> str:
    fin = next((i for i in range(0, len(octets) - 1, 2) if octets[i : i + 2] == b"\0\0"), None)
    lu = octets[:fin].decode("utf-16-be", "replace")
    return " ".join("".join(c for c in lu if c.isprintable()).split())


def _code(octets: bytes) -> str:
    """Un code de jeu: lettres et chiffres ASCII seulement, sinon rien."""
    texte = octets.decode("ascii", "replace")
    return texte if texte.isascii() and texte.isalnum() else ""


# ── GameCube et Wii ────────────────────────────────────────────────────────


def _disque_nintendo(entete: bytes) -> tuple[str | None, str, str, dict[str, str]]:
    """Console, code, titre et détails d'un en-tête de disque de 0x80 octets.

    Wii d'abord: un disque GameCube porte un zéro à 0x18, un disque Wii un zéro
    à 0x1C, et les deux mots ne se trouvent jamais ensemble.
    """
    if len(entete) < 0x60:
        return None, "", "", {}
    console = None
    if struct.unpack_from(">I", entete, 0x18)[0] == MAGIE_WII:
        console = "wii"
    elif struct.unpack_from(">I", entete, 0x1C)[0] == MAGIE_GC:
        console = "gc"
    if console is None:
        return None, "", "", {}
    code = _code(entete[:6])
    # Les jeux japonais écrivent leur titre en Shift-JIS, les autres en
    # Windows-1252: c'est ce que fait Dolphin, selon la région du code.
    codage = "shift_jis" if len(code) == 6 and code[3] == "J" else "cp1252"
    titre = _texte(entete[0x20:0x60], codage)
    details = {"disque": str(entete[6] + 1), "revision": str(entete[7])}
    return console, code, titre, details


def _resultat_disque(
    entete: bytes, format_: str, preuve: str, drapeaux: frozenset[str] = frozenset()
) -> Identification:
    console, code, titre, details = _disque_nintendo(entete)
    if console is None:
        return Identification(
            None, format_, drapeaux=drapeaux, preuve=f"{preuve}, sans disque Nintendo lisible"
        )
    mot = "0x5D1C9EA3 à 0x18" if console == "wii" else "0xC2339F3D à 0x1C"
    return Identification(
        console, format_, titre, code, drapeaux, f"{preuve}, puis {mot} du disque", details
    )


def _iso_nintendo(lu: _Lecture) -> Identification | None:
    entete = lu.octets(0, 0x80)
    console, _, _, _ = _disque_nintendo(entete)
    if console is None:
        return None
    drapeaux = frozenset({"nkit"}) if lu.egal(0x200, b"NKIT") else frozenset()
    return _resultat_disque(entete, "iso", "image brute", drapeaux)


def _rvz_wia(lu: _Lecture) -> Identification | None:
    magie = lu.octets(0, 4)
    if magie not in (b"RVZ\x01", b"WIA\x01"):
        return None
    format_ = "rvz" if magie == b"RVZ\x01" else "wia"
    type_disque = lu.entier(0x48, ">I")
    entete = lu.octets(0x58, 0x80)
    preuve = f"« {format_.upper()}\\x01 » à 0, type de disque {type_disque} à 0x48"
    attendu = {1: "gc", 2: "wii"}.get(type_disque or 0)
    if attendu is None or not entete:
        return Identification(None, format_, preuve=f"{preuve}: ni 1 (GameCube) ni 2 (Wii)")
    console, code, titre, details = _disque_nintendo(entete)
    drapeaux = frozenset({"compresse"} if format_ == "rvz" else set())
    if console != attendu:
        # Le type annoncé et la copie du disque se contredisent: on garde le
        # type, que Dolphin lit en premier, et on le dit.
        drapeaux |= {"a-verifier"}
        preuve += ", mais la copie du disque à 0x58 ne porte pas le mot attendu"
    return Identification(attendu, format_, titre, code, drapeaux, preuve, details)


def _gcz(lu: _Lecture) -> Identification | None:
    if lu.entier(0, "<I") != 0xB10BC001:
        return None
    preuve = "0xB10BC001 à 0"
    drapeaux = frozenset({"compresse"})
    taille_bloc = lu.entier(0x18, "<I") or 0
    blocs = lu.entier(0x1C, "<I") or 0
    taille_compressee = lu.entier(0x08, "<Q") or 0
    if not (0x200 <= taille_bloc <= 64 << 20) or not (1 <= blocs <= 1 << 26):
        return Identification(None, "gcz", drapeaux=drapeaux, preuve=f"{preuve}, en-tête faux")
    debut = 32 + 12 * blocs
    premier = lu.entier(32, "<Q") or 0
    suivant = lu.entier(40, "<Q") if blocs > 1 else None
    brut = bool(premier & (1 << 63))
    premier &= ~(1 << 63)
    fin = (suivant & ~(1 << 63)) if suivant is not None else taille_compressee
    longueur = min(max(fin - premier, 0), taille_bloc + 0x1000)
    donnees = lu.octets(debut + premier, longueur) if longueur else b""
    try:
        clair = donnees[:0x80] if brut else zlib.decompressobj().decompress(donnees, 0x80)
    except zlib.error:
        clair = b""
    return _resultat_disque(clair, "gcz", f"{preuve}, premier bloc décompressé", drapeaux)


def _ciso(lu: _Lecture) -> Identification | None:
    if not lu.egal(0, b"CISO"):
        return None
    # La carte des blocs dit si le premier est présent. Sans lui, pas d'en-tête.
    if lu.octets(8, 1) != b"\x01":
        return Identification(None, "ciso", preuve="« CISO » à 0, premier bloc absent")
    entete = lu.octets(0x8000, 0x80)
    nkit = frozenset({"nkit"}) if lu.egal(0x8200, b"NKIT") else frozenset()
    return _resultat_disque(entete, "ciso", "« CISO » à 0, disque lu à 0x8000", nkit)


def _wbfs(lu: _Lecture) -> Identification | None:
    if not lu.egal(0, b"WBFS"):
        return None
    puissance = lu.octets(8, 1)
    if not puissance or not 9 <= puissance[0] <= 12 or lu.octets(0xC, 1) == b"\0":
        return Identification(None, "wbfs", preuve="« WBFS » à 0, aucun disque dans la table")
    secteur = 1 << puissance[0]
    trouve = _resultat_disque(
        lu.octets(secteur, 0x80), "wbfs", f"« WBFS » à 0, disque au secteur 1 ({secteur:#x})"
    )
    if trouve.console == "gc":
        # Un WBFS ne range que des disques Wii.
        return Identification(None, "wbfs", preuve=f"{trouve.preuve}: un disque GameCube")
    return trouve


# ── Switch ─────────────────────────────────────────────────────────────────


def _table_conteneur(lu: _Lecture, a: int, magie: bytes, taille_entree: int) -> list[str] | None:
    """Les noms d'une table PFS0 ou HFS0, ou rien si elle est impossible."""
    if not lu.egal(a, magie):
        return None
    nombre = lu.entier(a + 4, "<I")
    longueur_noms = lu.entier(a + 8, "<I")
    if nombre is None or longueur_noms is None or nombre > 4096 or longueur_noms > 1 << 20:
        return None
    table = lu.octets(a + 0x10, nombre * taille_entree) if nombre else b""
    chaines = lu.octets(a + 0x10 + nombre * taille_entree, longueur_noms)
    if (nombre and not table) or (longueur_noms and not chaines):
        return None
    noms = []
    for rang in range(nombre):
        debut = struct.unpack_from("<I", table, rang * taille_entree + 16)[0]
        fin = chaines.find(b"\0", debut)
        if debut >= len(chaines) or fin < 0:
            return None
        noms.append(chaines[debut:fin].decode("utf-8", "replace"))
    return noms


TICKET = re.compile(r"^([0-9a-fA-F]{16})[0-9a-fA-F]{16}\.tik$")


def _nsp(lu: _Lecture) -> Identification | None:
    noms = _table_conteneur(lu, 0, b"PFS0", 24)
    if noms is None:
        return None
    parties = [nom for nom in noms if nom.endswith((".nca", ".ncz"))]
    compresse = any(nom.endswith(".ncz") for nom in noms)
    format_ = "nsz" if compresse else "nsp"
    drapeaux = {"compresse"} if compresse else set()
    preuve = f"« PFS0 » à 0, {len(noms)} fichiers dont {len(parties)} parties NCA"
    details: dict[str, str] = {}
    titres = {m.group(1).lower() for nom in noms if (m := TICKET.match(nom))}
    if len(titres) == 1:
        # Le nom d'un ticket commence par l'identifiant du titre. C'est une
        # PROPOSITION: le nom n'est pas chiffré, donc pas prouvé, et
        # l'inscription exige le titre lu dans l'en-tête NCA, qui l'est.
        titre = titres.pop()
        details["titre_propose"] = titre
        details["contenu"] = (
            "jeu"
            if titre.endswith("000")
            else "mise-a-jour"
            if titre.endswith("800")
            else "contenu-additionnel"
        )
    if not parties:
        drapeaux.add("a-verifier")
    return Identification("switch", format_, "", "", frozenset(drapeaux), preuve, details)


def _xci(lu: _Lecture) -> Identification | None:
    for base in (0, 0x1000):
        if lu.egal(base + 0x100, b"HEAD"):
            break
    else:
        return None
    preuve = f"« HEAD » à {base + 0x100:#x}"
    format_ = "xci"
    racine = lu.entier(base + 0x130, "<Q") or 0
    noms = _table_conteneur(lu, base + racine, b"HFS0", 0x40) if racine else None
    if noms is not None and "secure" in noms:
        rang = noms.index("secure")
        nombre = len(noms)
        longueur_noms = lu.entier(base + racine + 8, "<I") or 0
        entree = base + racine + 0x10 + rang * 0x40
        decalage = lu.entier(entree, "<Q") or 0
        a = base + racine + 0x10 + nombre * 0x40 + longueur_noms + decalage
        secure = _table_conteneur(lu, a, b"HFS0", 0x40) or []
        if any(nom.endswith(".ncz") for nom in secure):
            format_ = "xcz"
            preuve += ", parties NCZ dans la partition « secure »"
    drapeaux = frozenset({"compresse"}) if format_ == "xcz" else frozenset()
    return Identification("switch", format_, drapeaux=drapeaux, preuve=preuve)


def _nup(lu: _Lecture) -> Identification | None:
    if not lu.egal(0, b"NUP\x01"):
        return None
    # Un seul exemplaire lu, aucune spécification: « à vérifier », jamais « sûr ».
    return Identification(
        "switch2", "nup", drapeaux=frozenset({"a-verifier"}), preuve="« NUP\\x01 » à 0"
    )


# ── Xbox et Xbox 360 ───────────────────────────────────────────────────────


def _titre_xex(lu: _Lecture, debut: int) -> str:
    """L'identifiant de titre d'un exécutable XEX2 commençant à `debut`, ou "".

    Il est dans l'en-tête optionnel d'exécution (clé 0x00040006), à 0x0C de
    la structure qu'il désigne; la structure est relative au début du XEX.
    """
    nombre = lu.entier(debut + 0x14, ">I") or 0
    for rang in range(min(nombre, 64)):
        cle = lu.entier(debut + 0x18 + rang * 8, ">I")
        if cle == 0x00040006:
            valeur = lu.entier(debut + 0x18 + rang * 8 + 4, ">I") or 0
            titre = lu.entier(debut + valeur + 0x0C, ">I")
            return f"{titre:08X}" if titre else ""
    return ""


def _xex(lu: _Lecture) -> Identification | None:
    if not lu.egal(0, b"XEX2"):
        return None
    return Identification("x360", "xex", identifiant=_titre_xex(lu, 0), preuve="« XEX2 » à 0")


def _stfs(lu: _Lecture) -> Identification | None:
    magie = lu.octets(0, 4)
    if magie not in (b"CON ", b"LIVE", b"PIRS"):
        return None
    type_contenu = lu.entier(0x344, ">I")
    titre_id = lu.entier(0x360, ">I")
    nom = _texte_utf16(lu.octets(0x411, 0x80))
    if type_contenu is None or titre_id is None:
        return Identification(None, "stfs", preuve=f"« {magie.decode()} » à 0, en-tête tronqué")
    sorte = TYPES_STFS.get(type_contenu, f"type {type_contenu:#x}")
    god = type_contenu == 0x7000
    return Identification(
        "x360",
        "god" if god else "stfs",
        nom,
        f"{titre_id:08X}",
        frozenset({"plusieurs-fichiers"}) if god else frozenset(),
        f"« {magie.decode()} » à 0, {sorte} à 0x344",
        {"contenu": sorte},
    )


def _entree_xdvdfs(lu: _Lecture, table: int, taille: int, nom: bytes) -> int | None:
    """Le secteur de `nom` dans un répertoire XDVDFS, ou None.

    Un répertoire est un arbre binaire d'entrées: deux sauts (gauche, droite)
    comptés en mots de 4 octets depuis le début de la table, le secteur, la
    taille, les attributs, puis le nom. Les fins de secteur sont remplies de
    0xFF. Le parcours est borné et ne revisite rien: une image abîmée ne le
    fait pas tourner.
    """
    vues: set[int] = set()
    pile = [0]
    while pile and len(vues) < 1024:
        relatif = pile.pop()
        if relatif in vues or relatif + 14 > taille:
            continue
        vues.add(relatif)
        entete = lu.octets(table + relatif, 14)
        if len(entete) < 14 or entete[:4] == b"\xff\xff\xff\xff":
            continue
        gauche, droite, secteur, _taille, _attributs, longueur = struct.unpack("<HHIIBB", entete)
        if lu.octets(table + relatif + 14, longueur).lower() == nom:
            return secteur
        pile.extend(saut * 4 for saut in (gauche, droite) if saut)
    return None


def _xiso(lu: _Lecture) -> Identification | None:
    for base, nom_disque in PARTITIONS_XBOX:
        if not lu.egal(base + 0x10000, b"MICROSOFT*XBOX*MEDIA"):
            continue
        secteur = lu.entier(base + 0x10014, "<I") or 0
        taille = min(lu.entier(base + 0x10018, "<I") or 0, 0x10000)
        racine = lu.octets(base + secteur * 0x800, taille).lower()
        preuve = f"« MICROSOFT*XBOX*MEDIA » au secteur 32 de la partition à {base:#x}"
        if b"default.xex" in racine:
            # Le titre du disque est celui de son exécutable: sans lui, la salle
            # ne saurait ni inscrire le jeu ni ranger ses sauvegardes.
            trouve = _entree_xdvdfs(lu, base + secteur * 0x800, taille, b"default.xex")
            titre = ""
            if trouve is not None and lu.egal(base + trouve * 0x800, b"XEX2"):
                titre = _titre_xex(lu, base + trouve * 0x800)
            return Identification(
                "x360",
                "xiso",
                identifiant=titre,
                preuve=f"{preuve}, default.xex à la racine"
                + (f", titre {titre} dans son en-tête" if titre else ", titre illisible"),
            )
        if b"default.xbe" in racine:
            return Identification("xbox", "xiso", preuve=f"{preuve}, default.xbe à la racine")
        if nom_disque in ("XGD2", "XGD3"):
            return Identification(
                "x360",
                "xiso",
                drapeaux=frozenset({"a-verifier"}),
                preuve=f"{preuve} ({nom_disque})",
            )
        return Identification(None, "xiso", preuve=f"{preuve}, sans exécutable à la racine")
    return None


# ── Consoles reconnues, pas encore jouables ────────────────────────────────


def _nes(lu: _Lecture) -> Identification | None:
    if not lu.egal(0, b"NES\x1a"):
        return None
    drapeau = lu.octets(7, 1)
    nes2 = bool(drapeau) and drapeau[0] & 0x0C == 0x08
    return Identification("nes", "nes2" if nes2 else "ines", preuve="« NES\\x1A » à 0")


def _n64(lu: _Lecture) -> Identification | None:
    entete = lu.octets(0, 0x40)
    ordres = {b"\x80\x37\x12\x40": "z64", b"\x37\x80\x40\x12": "v64", b"\x40\x12\x37\x80": "n64"}
    ordre = ordres.get(entete[:4])
    if ordre is None:
        return None
    if ordre == "v64":
        entete = b"".join(entete[i + 1 : i + 2] + entete[i : i + 1] for i in range(0, 0x40, 2))
    elif ordre == "n64":
        entete = b"".join(entete[i : i + 4][::-1] for i in range(0, 0x40, 4))
    drapeaux = frozenset() if ordre == "z64" else frozenset({"ordre-octets"})
    return Identification(
        "n64",
        ordre,
        _texte(entete[0x20:0x34]),
        _code(entete[0x3B:0x3F]),
        drapeaux,
        f"mot {entete[:4].hex().upper()} à 0, lu en {ordre}",
    )


def _gb(lu: _Lecture) -> Identification | None:
    if not lu.egal(0x104, LOGO_GB):
        return None
    entete = lu.octets(0x134, 0x1A)
    if not entete:
        return None
    somme = 0
    for octet in entete[:0x19]:
        somme = (somme - octet - 1) & 0xFF
    if somme != entete[0x19]:
        return Identification(None, INCONNU, preuve="logo Game Boy à 0x104, mais somme fausse")
    couleur = entete[0x0F]
    console = "gbc" if couleur & 0x80 else "gb"
    titre = _texte(entete[: 0x0F if console == "gbc" else 0x10])
    return Identification(
        console, console, titre, preuve=f"logo Nintendo à 0x104, drapeau {couleur:#04x} à 0x143"
    )


def _gba(lu: _Lecture) -> Identification | None:
    entete = lu.octets(0, 0xC0)
    if not entete or entete[0xB2] != 0x96 or entete[4:12] != LOGO_GBA:
        return None
    complement = (-sum(entete[0xA0:0xBD]) - 0x19) & 0xFF
    if complement != entete[0xBD]:
        return None
    return Identification(
        "gba",
        "gba",
        _texte(entete[0xA0:0xAC]),
        _code(entete[0xAC:0xB0]),
        preuve="logo à 0x04, 0x96 à 0xB2, complément juste à 0xBD",
    )


def _ds(lu: _Lecture) -> Identification | None:
    if lu.entier(0x15C, "<H") != 0xCF56:
        return None
    entete = lu.octets(0, 0x20)
    return Identification(
        "ds",
        "nds",
        _texte(entete[:0x0C]),
        _code(entete[0x0C:0x10]),
        preuve="CRC du logo 0xCF56 à 0x15C",
    )


def _mega_drive(lu: _Lecture) -> Identification | None:
    if not lu.egal(0x100, b"SEGA"):
        return None
    entete = lu.octets(0x100, 0x90)
    # Le titre international d'abord, celui du Japon s'il est seul.
    titre = (_texte(entete[0x50:0x80]) or _texte(entete[0x20:0x50])) if entete else ""
    return Identification("md", "md", titre, preuve="« SEGA » à 0x100")


def _iso9660(lu: _Lecture) -> Identification | None:
    """Un disque ISO 9660, en secteurs de 2048 octets ou bruts de 2352."""
    for taille_secteur, debut in ((2048, 0), (2352, 24), (2352, 16)):
        if taille_secteur == 2352 and not lu.egal(0, b"\0" + b"\xff" * 10 + b"\0"):
            continue
        pvd = lu.octets(16 * taille_secteur + debut, 2048)
        if pvd[:6] == b"\x01CD001":
            break
    else:
        return None

    def secteur(lba: int, longueur: int) -> bytes:
        # Un seul secteur pour une image brute: le suivant commence par son
        # propre en-tête de synchronisation, qui couperait l'enregistrement.
        plafond = 2048 if taille_secteur == 2352 else 0x10000
        return lu.octets(lba * taille_secteur + debut, min(longueur, plafond))

    systeme = _texte(pvd[8:40])
    volume = _texte(pvd[40:72])
    preuve = f"« CD001 » au secteur 16 ({taille_secteur} octets), système « {systeme} »"
    if systeme != "PLAYSTATION":
        return Identification(None, "iso9660", volume, preuve=preuve)
    racine = secteur(*struct.unpack_from("<I4xI", pvd, 158))
    cnf = b""
    a = 0
    while a + 33 < len(racine) and racine[a]:
        longueur, nom = racine[a], racine[a + 33 : a + 33 + racine[a + 32]]
        if nom.upper() == b"SYSTEM.CNF;1":
            cnf = secteur(*struct.unpack_from("<I4xI", racine, a + 2))[:2048]
            break
        a += longueur
    boot = re.search(rb"BOOT(2?)\s*=\s*cdrom0?:\\?\\?([A-Za-z0-9_.]+)", cnf)
    format_ = "bin" if taille_secteur == 2352 else "iso"
    if boot is None:
        return Identification(
            "ps1", format_, volume, drapeaux=frozenset({"a-verifier"}), preuve=preuve
        )
    console = "ps2" if boot.group(1) else "ps1"
    identifiant = boot.group(2).decode("ascii")
    return Identification(console, format_, volume, identifiant, preuve=f"{preuve}, SYSTEM.CNF lu")


def _chd(lu: _Lecture) -> Identification | None:
    if not lu.egal(0, b"MComprHD"):
        return None
    version = lu.entier(12, ">I")
    return Identification(
        None,
        "chd",
        drapeaux=frozenset({"compresse", "a-verifier"}),
        preuve=f"« MComprHD » à 0, version {version}: la console se lit après décompression",
    )


def _archive(lu: _Lecture) -> Identification | None:
    tete = lu.octets(0, 8) or lu.octets(0, min(lu.taille, 8))
    signatures = (
        (b"PK\x03\x04", "zip"),
        (b"PK\x05\x06", "zip"),
        (b"7z\xbc\xaf\x27\x1c", "7z"),
        (b"Rar!\x1a\x07\x01\x00", "rar"),
        (b"Rar!\x1a\x07\x00", "rar"),
    )
    for signature, format_ in signatures:
        if tete.startswith(signature):
            return Identification(
                None, format_, drapeaux=frozenset({"archive"}), preuve=f"signature {format_} à 0"
            )
    return None


FICHE_CUE = re.compile(rb'^\s*FILE\s+"[^"\r\n]+"\s+(BINARY|MOTOROLA|WAVE|MP3|AIFF)\s*$', re.M)


def _cue(lu: _Lecture) -> Identification | None:
    if lu.taille > 0x10000:
        return None
    texte = lu.octets(0, lu.taille)
    if b"\0" in texte or not FICHE_CUE.search(texte) or b"TRACK" not in texte:
        return None
    return Identification(
        None,
        "cue",
        drapeaux=frozenset({"plusieurs-fichiers"}),
        preuve="fiche de pistes qui nomme ses fichiers .bin",
    )


#: L'ordre compte. Les conteneurs à magie en tête d'abord, puis les disques
#: Nintendo bruts. L'image Xbox passe AVANT l'ISO 9660: un disque Xbox 360
#: complet commence par une partition vidéo qui en porte un.
ESSAIS = (
    _rvz_wia,
    _gcz,
    _ciso,
    _wbfs,
    _nsp,
    _nup,
    _xex,
    _stfs,
    _chd,
    _archive,
    _nes,
    _iso_nintendo,
    _xci,
    _n64,
    _gba,
    _ds,
    _gb,
    _mega_drive,
    _xiso,
    _iso9660,
    _cue,
)


def identifier(lire: Lecteur, taille: int) -> Identification:
    """Ce qu'est un fichier de `taille` octets, lu par `lire`.

    Ne lève pas sur des octets abîmés: un en-tête faux donne « inconnu », et
    l'envoi reste en quarantaine au lieu d'arrêter son traitement.
    """
    lu = _Lecture(lire, max(taille, 0))
    for essai in ESSAIS:
        try:
            trouve = essai(lu)
        except (struct.error, ValueError, OverflowError, IndexError) as erreur:
            # Une table qui pointe hors de ce qu'on a lu: ce format n'est pas
            # celui-là, ou le fichier est abîmé. Le suivant a sa chance.
            trouve = Identification(None, INCONNU, preuve=f"en-tête illisible ({erreur})")
            if essai is ESSAIS[-1]:
                return trouve
            continue
        if trouve is not None:
            return trouve
    return Identification(None, INCONNU, preuve="aucune signature reconnue")
