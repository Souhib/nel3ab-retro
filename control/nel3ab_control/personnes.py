"""Le nom sous lequel le worker range les affaires d'une personne, recalculé ici.

# Pourquoi le salon le recalcule

Le worker range la sauvegarde personnelle d'un jeu dans un dossier
`joueur-<lisible>-<empreinte>`, calculé en Rust par `saves::person_key`
(`core/crates/emulator/src/saves.rs`). Les adaptateurs Switch reçoivent ce nom
tout fait et le vérifient par leur motif `SLOT`. Le salon, lui, doit retrouver
ces dossiers pour montrer à chacun ses sauvegardes, sans démarrer de salle.

Un calcul recopié dans une autre langue peut diverger sans bruit: le profil
paraîtrait alors vide, ou pire, montrerait le dossier d'un autre. Les deux
calculs sont donc tenus par les MÊMES vecteurs, rangés dans
`core/crates/emulator/person-key-vectors.json`. Un essai Rust et un essai Python
les relisent; changer l'un des deux calculs fait échouer l'un des deux essais.

# Trois pièges que les vecteurs épinglent

- le nettoyage ne garde que les lettres et chiffres ASCII. `é` devient un tiret,
  alors que `str.isalnum` le garderait;
- l'empreinte porte sur l'adresse coupée de ses blancs au sens de Rust
  (`str::trim`, propriété Unicode White_Space). `str.strip` de Python coupe en
  plus les séparateurs `\\x1c` à `\\x1f`, que Rust garde;
- une adresse sans aucune lettre ni chiffre n'a pas de dossier personnel: le
  worker retombe alors sur la partie neuve commune.
"""

import hashlib

#: Ce que `key` rend quand il ne reste rien de lisible, comme en Rust.
SANS_NOM = "sans-nom"

#: Les caractères que `str::trim` de Rust retire: la propriété Unicode
#: White_Space, telle que la documentation de `char::is_whitespace` l'énumère.
#: Écrite en entier plutôt que déduite de `str.isspace`, qui en compte quatre de
#: plus (les séparateurs U+001C à U+001F).
#: Par points de code et non par caractères: seize d'entre eux sont des espaces
#: qu'aucun œil ne distingue d'un espace ordinaire dans le source.
BLANCS_RUST = frozenset(
    chr(point)
    for point in (
        *range(0x09, 0x0E),
        0x20,
        0x85,
        0xA0,
        0x1680,
        *range(0x2000, 0x200B),
        0x2028,
        0x2029,
        0x202F,
        0x205F,
        0x3000,
    )
)

#: La longueur du préfixe lisible, en caractères, comme `take(24)` en Rust.
PREFIXE = 24


def cle(texte: str) -> str:
    """Le nettoyage de `saves::key`: lettres et chiffres ASCII, le reste en tirets.

    Les tirets ne s'accumulent pas et ne restent pas aux bords. Un texte qui ne
    garde rien rend `sans-nom`.
    """
    sortie: list[str] = []
    for caractere in texte:
        if caractere.isascii() and caractere.isalnum():
            sortie.append(caractere.lower())
        elif not sortie or sortie[-1] != "-":
            sortie.append("-")
    nettoye = "".join(sortie).strip("-")
    return nettoye or SANS_NOM


def coupe_comme_rust(texte: str) -> str:
    """`str::trim` de Rust: les blancs Unicode des deux bords, et eux seuls."""
    debut, fin = 0, len(texte)
    while debut < fin and texte[debut] in BLANCS_RUST:
        debut += 1
    while fin > debut and texte[fin - 1] in BLANCS_RUST:
        fin -= 1
    return texte[debut:fin]


def empreinte(login: str) -> str:
    """L'empreinte SHA-256 de l'adresse, celle qui termine le dossier personnel.

    Sert aussi de nom au journal des parties de cette personne. C'est une
    pseudonymisation, pas un secret: quiconque connaît l'adresse la recalcule.
    Les dossiers de sauvegarde la portent déjà, avec un préfixe lisible en plus.
    """
    return hashlib.sha256(coupe_comme_rust(login).encode("utf-8")).hexdigest()


def cle_personne(login: str) -> str | None:
    """`saves::person_key`, ou rien quand l'adresse n'a rien de lisible.

    Rien plutôt que `sans-nom`: c'est le cas où le worker ne compose pas de
    dossier personnel du tout (`folder_for` le refuse), donc il n'y a rien à
    chercher sur le disque.
    """
    lisible = cle(login)
    if lisible == SANS_NOM:
        return None
    return f"{lisible[:PREFIXE]}-{empreinte(login)}"


def dossier_personnel(login: str) -> str | None:
    """Le nom du dossier personnel, `joueur-<clé>`, ou rien sans clé."""
    trouve = cle_personne(login)
    return None if trouve is None else f"joueur-{trouve}"
