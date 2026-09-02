"""Ouvre un `data.bin`, l'export de sauvegarde d'une Wii.

    python3 tools/wii-save-decode.py data.bin dossier/de/sortie

# Pourquoi ce fichier existe

Une sauvegarde Wii ne se télécharge pas comme un fichier de carte mémoire. Ce
qui circule est un `data.bin`: l'export CHIFFRÉ qu'une console écrit sur une
carte SD, et que seule une console est censée relire. Dolphin sait l'importer,
mais par son interface graphique, et cette machine n'en a pas.

La clé est publique depuis 2008 et le format est documenté. Ce script ne fait
donc que suivre le format, et ce qu'il produit va directement dans un emplacement
de sauvegarde (`just saves` dit lesquels existent).

Le format est public. Ce qui est écrit ici ne fait que le suivre, et VÉRIFIE
chaque invariant plutôt que de le supposer: un en-tête qui ne porte pas sa
signature veut dire qu'on s'est trompé de clé, de position ou de taille, et
continuer donnerait des octets plausibles qui ne sont pas une sauvegarde.

# Deux choses relevées sur le fichier plutôt que lues dans une documentation

- l'en-tête `Bk` s'écrit `taille, "Bk", version`, et non `taille, version, "Bk"`;
- la zone chiffrée du début est plus longue que ce que le champ « taille de
  bannière » annonce. On CHERCHE donc l'en-tête `Bk` au lieu de le calculer: une
  position déduite d'un seul fichier se trompe sur le suivant.

Et le nom d'un fichier occupe 0x45 octets, pas 0x40. Le vecteur commence donc à
0x50 et non à 0x4B. Ces cinq octets d'écart ont coûté deux jours, parce que leur
effet est presque invisible: en CBC, un mauvais vecteur ne corrompt QUE LE
PREMIER BLOC DE SEIZE OCTETS. Tout le reste du fichier sort parfaitement, avec
sa structure et ses zéros, donc le fichier a l'air bon à toute inspection
superficielle. Le jeu, lui, lit son en-tête dans ces seize octets: il démarre,
affiche son menu, et annonce « data is corrupted » à l'ouverture.

Ce texte décrivait déjà la correction alors que le code, lui, lisait toujours à
0x4B. Une explication écrite n'est pas une garantie, d'où la vérification
mécanique qui suit.
"""
import struct
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# La clé et le vecteur de la carte SD, publics depuis 2008: c'est ce qui permet
# à une console de relire l'export d'une autre.
SD_KEY = bytes.fromhex("ab01b9d8e1622b08afbad84dbfc2a55d")
SD_IV = bytes.fromhex("216712e6aa1f689f95c5a223124dc5f7")
BK_HEADER = bytes.fromhex("00000070") + b"Bk" + bytes.fromhex("0001")
FILE_MAGIC = bytes.fromhex("03adf17e")

# L'en-tête d'un fichier, champ par champ, et la vérification qui rend l'erreur
# impossible à écrire. Les champs doivent PAVER les 0x80 octets exactement: la
# version fautive donnait un nom de 0x40 octets, donc un vecteur à 0x4B, donc
# cinq octets que rien ne réclamait. C'est cette soustraction qui manquait.
#
# Pourquoi cette forme de contrôle plutôt qu'une autre: on ne peut pas vérifier
# un vecteur depuis le fichier. Rechiffrer ce qu'on a déchiffré redonne toujours
# la source, quel que soit le vecteur, donc l'aller-retour ne prouve rien. Et le
# champ de nom n'est PAS rempli de zéros — mesuré le 31 août 2026, il contient
# des octets quelconques juste après le terminateur — donc « le vecteur commence
# par des zéros » ne dit rien non plus. L'arithmétique, elle, est décidable.
HEADER_SIZE = 0x80
NAME_AT, NAME_LEN = 0x0B, 0x45
IV_AT, IV_LEN = NAME_AT + NAME_LEN, 0x10
TAIL_LEN = 0x20
assert IV_AT == 0x50, "le vecteur commence là où le nom finit"
assert IV_AT + IV_LEN + TAIL_LEN == HEADER_SIZE, (
    f"les champs ne pavent pas l'en-tête: {IV_AT + IV_LEN + TAIL_LEN:#x} au lieu de {HEADER_SIZE:#x}"
)


def decrypt(blob: bytes, iv: bytes) -> bytes:
    keep = len(blob) - len(blob) % 16
    dec = Cipher(algorithms.AES(SD_KEY), modes.CBC(iv)).decryptor()
    return dec.update(blob[:keep]) + dec.finalize()


raw = Path(sys.argv[1]).read_bytes()
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

title, banner_size = struct.unpack_from(">QI", decrypt(raw[:0x20], SD_IV), 0)
print(f"  titre    : {title:016x}")
print(f"  bannière : {banner_size} octets annoncés")

# La bannière d'abord: elle est dans la même zone chiffrée que l'en-tête, avant
# la liste des fichiers. C'est l'image que la salle affiche pour un jeu Wii (voir
# `emulator::banner::parse_wii`), et sans elle un jeu qu'on n'a jamais lancé
# resterait sans jaquette même après avoir posé sa sauvegarde.
# La taille ANNONCÉE, pas une constante: une bannière porte de une à huit
# icônes, donc elle mesure 0x72A0, 0xBAA0 ou 0xF0A0 selon le jeu. En figer une
# tronque les autres, et une bannière tronquée reste lisible au début — donc le
# défaut passe la vérification de signature et ne se voit qu'à l'écran.
# L'en-tête porte une empreinte à 0x0E, sur seize octets. Elle N'EST PAS
# vérifiée ici, et c'est un manque assumé plutôt qu'un oubli: la portée qu'elle
# couvre ne s'est pas laissée retrouver. Essayé le 31 août 2026, en MD5 et en
# SHA-1, sur la zone en-tête plus bannière annoncée, sur la zone jusqu'à
# l'en-tête `Bk`, et pour toutes les positions de champ de 0x00 à 0x20: rien ne
# reproduit la valeur du fichier. Un contrôle qu'on écrirait faux serait pire
# que pas de contrôle, donc il n'y en a pas, et la garde sur le vecteur plus bas
# fait le travail qui comptait.
banner = decrypt(raw[: 0x20 + banner_size], SD_IV)[0x20 : 0x20 + banner_size]
if banner[:4] == b"WIBN":
    (out / "banner.bin").write_bytes(banner)
    print(f"  banner.bin {len(banner)} octets")
else:
    print("  pas de bannière lisible: le jeu écrira la sienne au premier lancement")

at = raw.find(BK_HEADER)
assert at > 0, "aucun en-tête Bk: ce fichier n'est pas un export de sauvegarde"
count, files_size = struct.unpack_from(">II", raw, at + 0x0C)
kept_hi, kept_lo = struct.unpack_from(">II", raw, at + 0x60)
print(f"  fichiers : {count} pour {files_size} octets")
print(f"  titre Bk : {kept_hi:08x}{kept_lo:08x}")
assert (kept_hi << 32 | kept_lo) == title, "les deux en-têtes ne parlent pas du même jeu"

at += 0x80
for _ in range(count):
    assert raw[at : at + 4] == FILE_MAGIC, f"pas d'en-tête de fichier à {at:#x}"
    (length,) = struct.unpack_from(">I", raw, at + 4)
    kind = raw[at + 0x0A]
    name = raw[at + NAME_AT : at + NAME_AT + NAME_LEN].split(b"\x00")[0].decode("ascii", "replace")
    iv = raw[at + IV_AT : at + IV_AT + IV_LEN]
    at += HEADER_SIZE
    # Un dossier: il faut le CRÉER, parce que les fichiers qui suivent portent
    # un chemin dedans. Se contenter de l'annoncer laissait le fichier suivant
    # échouer sur un dossier absent.
    if kind == 2:
        (out / name).mkdir(parents=True, exist_ok=True)
        print(f"    dossier {name}/")
        continue
    rounded = (length + 0x3F) & ~0x3F
    where = out / name
    where.parent.mkdir(parents=True, exist_ok=True)
    where.write_bytes(decrypt(raw[at : at + rounded], iv)[:length])
    print(f"    {name:<16} {length} octets")
    at += rounded
