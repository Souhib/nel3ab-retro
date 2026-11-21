"""Lire le titre d'un jeu Switch dans l'en-tête chiffré de ses NCA.

Aucune vraie clé, aucun vrai jeu. Chaque essai tire une clé de 32 octets au
hasard; `fabrique` chiffre avec elle des en-têtes écrits octet par octet, selon
la règle de switchbrew et sans le code testé. Un module qui écrirait le numéro
de secteur dans le mauvais ordre ne relirait rien de ce qui est fabriqué ici.
"""

import secrets
from pathlib import Path

import pytest

from nel3ab_control.imports.rangement import fiche_switch, nom_switch
from nel3ab_control.imports.switch_nca import (
    CleEntete,
    Contenu,
    Illisible,
    Incertain,
    Lecture,
    SansCle,
    charger_cle,
    dechiffrer_entete,
    lire_contenu,
    sorte_de,
)
from nel3ab_control.imports.traitement import Regles
from tests.imports import fabrique as f

#: Un identifiant de jeu inventé: ses treize bits du bas sont à zéro.
JEU = 0x0100ABCDEF012000
MAJ = JEU | 0x800
AJOUT = JEU + 0x1001
AUTRE = 0x0100ABCDEF014000

#: La fiche que le worker lit dans son propre essai (`emulator::switch`).
FICHE_PARTAGEE = Path(__file__).resolve().parents[3] / "consoles" / "fiche-switch.json"


@pytest.fixture
def cle() -> bytes:
    return secrets.token_bytes(32)


def nsp(cle: bytes, programme: int = JEU, meta: int = JEU) -> bytes:
    """Un NSP comme la console les écrit: programme, Meta, Control et ticket."""
    return f.pfs0_avec(
        [
            ("aa.nca", f.nca(cle, f.TYPE_PROGRAM, programme)),
            ("bb.cnmt.nca", f.nca(cle, f.TYPE_META, meta)),
            ("cc.nca", f.nca(cle, f.TYPE_CONTROL, programme)),
            (f"{meta:016x}0000000000000004.tik", b"ticket"),
        ]
    )


def lire(octets: bytes, format_: str, cle: bytes) -> Lecture:
    return lire_contenu(f.lecteur(octets), len(octets), format_, CleEntete(cle))


# ── Le déchiffrement ───────────────────────────────────────────────────────


def test_l_entete_dechiffre_est_exactement_celui_qui_a_ete_chiffre(cle: bytes) -> None:
    clair = f.entete_nca(f.TYPE_META, JEU, 0xE00)

    assert dechiffrer_entete(f.chiffrer_entete(clair, cle), CleEntete(cle)) == clair


def test_une_autre_cle_ne_rend_pas_la_marque_nca3(cle: bytes) -> None:
    """Le jumeau: le même chiffré, une autre clé, des octets au hasard."""
    clair = f.entete_nca(f.TYPE_META, JEU, 0xE00)

    autre = dechiffrer_entete(f.chiffrer_entete(clair, cle), CleEntete(secrets.token_bytes(32)))

    assert autre[0x200:0x204] != b"NCA3"


# ── Jeu, mise à jour, contenu additionnel ──────────────────────────────────


def test_un_nsp_de_jeu_donne_son_titre_et_sa_sorte(cle: bytes) -> None:
    lu = lire(nsp(cle), "nsp", cle)

    assert isinstance(lu, Contenu)
    assert (lu.sorte, lu.titre, lu.base, lu.generation) == ("jeu", JEU, JEU, 0x11)
    assert [p.nom for p in lu.parties] == ["aa.nca", "bb.cnmt.nca", "cc.nca"]


def test_une_mise_a_jour_porte_le_programme_du_jeu_et_sa_propre_meta(cle: bytes) -> None:
    """Son Program dit le titre du jeu: seule sa Meta la distingue."""
    lu = lire(nsp(cle, programme=JEU, meta=MAJ), "nsp", cle)

    assert isinstance(lu, Contenu)
    assert (lu.sorte, lu.titre, lu.base) == ("mise-a-jour", MAJ, JEU)


def test_un_contenu_additionnel_dit_a_quel_jeu_il_appartient(cle: bytes) -> None:
    ajout = f.pfs0_avec(
        [
            ("dd.nca", f.nca(cle, f.TYPE_PUBLIC_DATA, AJOUT)),
            ("ee.cnmt.nca", f.nca(cle, f.TYPE_META, AJOUT)),
        ]
    )

    lu = lire(ajout, "nsp", cle)

    assert isinstance(lu, Contenu)
    assert (lu.sorte, lu.titre, lu.base) == ("contenu-additionnel", AJOUT, JEU)


@pytest.mark.parametrize(
    ("titre", "attendu"),
    [
        (JEU, ("jeu", JEU)),
        (MAJ, ("mise-a-jour", JEU)),
        (AJOUT, ("contenu-additionnel", JEU)),
        (JEU + 0x1FFF, ("contenu-additionnel", JEU)),
        # Les jumeaux: ni un jeu, ni une mise à jour, ni un ajout.
        (JEU + 0x1000, None),
        (JEU + 0x0001, None),
        (JEU + 0x0801, None),
    ],
)
def test_la_sorte_se_lit_dans_les_bits_du_bas(titre: int, attendu: tuple[str, int] | None) -> None:
    assert sorte_de(titre) == attendu


@pytest.mark.parametrize("zone_cle", [False, True])
def test_une_carte_avec_sa_mise_a_jour_est_le_jeu(cle: bytes, zone_cle: bool) -> None:
    """Une carte récente porte la mise à jour de son jeu dans la partition « secure »."""
    carte = f.xci_avec(
        [
            ("aa.nca", f.nca(cle, f.TYPE_PROGRAM, JEU)),
            ("bb.cnmt.nca", f.nca(cle, f.TYPE_META, JEU)),
            ("cc.cnmt.nca", f.nca(cle, f.TYPE_META, MAJ)),
            ("dd.nca", f.nca(cle, f.TYPE_PROGRAM, JEU)),
        ],
        zone_cle=zone_cle,
    )

    lu = lire(carte, "xci", cle)

    assert isinstance(lu, Contenu)
    assert (lu.sorte, lu.titre, lu.base) == ("jeu", JEU, JEU)


def test_une_carte_qui_tient_deux_jeux_est_a_confirmer(cle: bytes) -> None:
    carte = f.xci_avec(
        [
            ("aa.nca", f.nca(cle, f.TYPE_PROGRAM, JEU)),
            ("bb.cnmt.nca", f.nca(cle, f.TYPE_META, JEU)),
            ("cc.nca", f.nca(cle, f.TYPE_PROGRAM, AUTRE)),
            ("dd.cnmt.nca", f.nca(cle, f.TYPE_META, AUTRE)),
        ]
    )

    lu = lire(carte, "xci", cle)

    assert isinstance(lu, Incertain)
    assert "plusieurs jeux" in lu.raison


@pytest.mark.parametrize(
    ("parties", "raison"),
    [
        ([("aa.nca", f.TYPE_PROGRAM, JEU)], "aucune partie Meta"),
        ([("bb.cnmt.nca", f.TYPE_META, JEU)], "partie Program du jeu"),
        (
            [
                ("aa.nca", f.TYPE_PROGRAM, MAJ),
                ("cc.cnmt.nca", f.TYPE_META, MAJ),
                ("dd.cnmt.nca", f.TYPE_META, AJOUT),
            ],
            "plusieurs contenus",
        ),
        ([("bb.cnmt.nca", f.TYPE_META, 0x0100000000008000)], "pas celui d'un jeu Switch"),
        ([("bb.cnmt.nca", f.TYPE_META, 0x0400486024DEC000)], "pas celui d'un jeu Switch"),
        ([("bb.cnmt.nca", f.TYPE_META, JEU + 1)], "ni un jeu"),
        ([], "aucune partie NCA"),
    ],
)
def test_ce_qui_n_est_pas_un_seul_jeu_lisible_est_a_confirmer(
    cle: bytes, parties: list[tuple[str, int, int]], raison: str
) -> None:
    octets = f.pfs0_avec([(nom, f.nca(cle, sorte, titre)) for nom, sorte, titre in parties])

    lu = lire(octets, "nsp", cle)

    assert isinstance(lu, Incertain)
    assert raison in lu.raison


def test_un_en_tete_nca2_se_lit_comme_un_nca3(cle: bytes) -> None:
    octets = f.pfs0_avec(
        [
            ("aa.nca", f.nca(cle, f.TYPE_PROGRAM, JEU, magie=b"NCA2")),
            ("bb.cnmt.nca", f.nca(cle, f.TYPE_META, JEU, magie=b"NCA2")),
        ]
    )

    assert isinstance(lire(octets, "nsp", cle), Contenu)


# ── Ce qui est refusé ──────────────────────────────────────────────────────


def test_une_mauvaise_cle_fait_refuser_le_fichier(cle: bytes) -> None:
    lu = lire(nsp(cle), "nsp", secrets.token_bytes(32))

    assert isinstance(lu, Illisible)
    assert "clé d'en-tête fausse" in lu.raison


@pytest.mark.parametrize("magie", [b"NCA0", b"NCA4", b"\0\0\0\0"])
def test_une_autre_marque_que_nca3_ou_nca2_est_refusee(cle: bytes, magie: bytes) -> None:
    octets = f.pfs0_avec(
        [
            ("aa.nca", f.nca(cle, f.TYPE_PROGRAM, JEU)),
            ("bb.cnmt.nca", f.nca(cle, f.TYPE_META, JEU, magie=magie)),
        ]
    )

    assert isinstance(lire(octets, "nsp", cle), Illisible)


def test_une_taille_annoncee_differente_de_la_partie_est_refusee(cle: bytes) -> None:
    """Le second contrôle de la clé: la marque seule passerait une fois sur 2³²."""
    octets = f.pfs0_avec(
        [
            ("aa.nca", f.nca(cle, f.TYPE_PROGRAM, JEU)),
            ("bb.cnmt.nca", f.nca(cle, f.TYPE_META, JEU, annonce=0xE01)),
        ]
    )

    lu = lire(octets, "nsp", cle)

    assert isinstance(lu, Illisible)
    assert "annonce 3585 octets" in lu.raison


def test_une_partie_plus_courte_que_son_en_tete_est_refusee(cle: bytes) -> None:
    octets = f.pfs0_avec(
        [
            ("aa.nca", f.nca(cle, f.TYPE_PROGRAM, JEU)),
            ("bb.cnmt.nca", f.nca(cle, f.TYPE_META, JEU, taille=0x400)),
        ]
    )

    lu = lire(octets, "nsp", cle)

    assert isinstance(lu, Illisible)
    assert "tronqué" in lu.raison


def test_aucune_coupure_du_fichier_ne_donne_un_jeu_ni_ne_leve(cle: bytes) -> None:
    """Toutes les longueurs plus courtes que le fichier entier, jusqu'au dernier octet."""
    entier = nsp(cle)
    longueurs = [*range(0, len(entier), 61), len(entier) - 1]

    for longueur in longueurs:
        coupe = entier[:longueur]
        lu = lire(coupe, "nsp", cle)
        assert not isinstance(lu, Contenu), longueur
    assert isinstance(lire(entier, "nsp", cle), Contenu), "le jumeau entier se lit"


def test_une_carte_sans_partition_secure_est_refusee(cle: bytes) -> None:
    carte = f.xci_avec([("aa.nca", f.nca(cle, f.TYPE_PROGRAM, JEU))])
    debut = carte.index(b"update\0normal\0secure\0")
    carte = carte[:debut] + b"update\0normal\0privee\0" + carte[debut + 21 :]

    lu = lire(carte, "xci", cle)

    assert isinstance(lu, Illisible)
    assert "secure" in lu.raison


# ── La clé ─────────────────────────────────────────────────────────────────


def test_la_cle_se_lit_dans_un_prod_keys(tmp_path: Path, cle: bytes) -> None:
    chemin = tmp_path / "prod.keys"
    chemin.write_text(f.prod_keys(cle))

    lue = charger_cle(chemin)

    assert lue == CleEntete(cle)


def test_sans_fichier_regle_il_n_y_a_pas_de_cle() -> None:
    lue = charger_cle(None)

    assert isinstance(lue, SansCle)
    assert "NEL3AB_SWITCH_KEYS" in lue.raison


@pytest.mark.parametrize(
    ("contenu", "raison"),
    [
        (None, "ne se lit pas"),
        ("master_key_00 = " + "11" * 16 + "\n", "pas de ligne header_key"),
        ("header_key = " + "ab" * 31 + "a\n", "64 chiffres"),
        ("header_key = " + "zz" * 32 + "\n", "64 chiffres"),
        ("header_key = " + "ab" * 32 + "\nheader_key = " + "cd" * 32 + "\n", "plusieurs lignes"),
        ("x" * (1 << 17), "trop gros"),
    ],
)
def test_un_fichier_de_cles_faux_dit_ce_qui_manque_sans_rien_montrer(
    tmp_path: Path, contenu: str | None, raison: str
) -> None:
    chemin = tmp_path / "prod.keys"
    if contenu is not None:
        chemin.write_text(contenu)

    lue = charger_cle(chemin)

    assert isinstance(lue, SansCle)
    assert raison in lue.raison
    for valeur in ("ab" * 31, "cd" * 32, "11" * 16):
        assert valeur not in lue.raison


def test_sans_cle_la_lecture_rend_la_raison(cle: bytes) -> None:
    sans = SansCle("pas de clé ici")

    assert lire_contenu(f.lecteur(nsp(cle)), len(nsp(cle)), "nsp", sans) is sans


def test_la_cle_ne_se_montre_ni_seule_ni_dans_les_regles(tmp_path: Path, cle: bytes) -> None:
    """Une trace d'erreur ou un journal écrit les objets: la clé n'y est pas."""
    regles = Regles(
        rom_dir="",
        verrou=tmp_path / "verrou",
        budget=1,
        marge=0,
        espace_libre=lambda _: 0,
        outils=None,
        cle_switch=CleEntete(cle),
    )

    for texte in (repr(CleEntete(cle)), repr(regles), str(regles)):
        assert cle.hex() not in texte
        assert repr(cle) not in texte


def test_une_cle_qui_n_a_pas_32_octets_n_existe_pas() -> None:
    with pytest.raises(ValueError, match="32 octets"):
        CleEntete(b"\0" * 31)
    with pytest.raises(ValueError, match="32 octets"):
        CleEntete(b"\0" * 33)
    assert CleEntete(b"\1" * 32).octets == b"\1" * 32


# ── Le nom et la fiche ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("annonce", "nom"),
    [
        ("Mario Kart 8 Deluxe [0100152000022000][v0] (7.03 GB).nsp", "Mario Kart 8 Deluxe"),
        ("Super_Mario_Odyssey.xci", "Super Mario Odyssey"),
        ("Super Smash Bros. Ultimate.nsp", "Super Smash Bros. Ultimate"),
        ("dossier/../../Pokémon Écarlate (Europe).nsp", "Pokémon Écarlate"),
        ("[0100ABCDEF012000][v0].nsp", "0100ABCDEF012000"),
        ("(Europe) [v0].nsp", "0100ABCDEF012000"),
    ],
)
def test_le_nom_d_un_jeu_switch_vient_du_fichier_sans_ses_etiquettes(
    annonce: str, nom: str
) -> None:
    assert nom_switch(annonce, JEU) == nom


def test_la_fiche_ecrite_est_celle_que_le_worker_accepte() -> None:
    """`consoles/fiche-switch.json` est passée au vrai `registered` par un essai Rust.

    Changer ce que le salon écrit fait échouer cet essai; il faut alors refaire
    la fiche partagée, et l'essai Rust dit si le worker la lit encore.
    """
    fiche = fiche_switch("Super Essai Kart Écarlate", JEU)

    assert fiche.octets == FICHE_PARTAGEE.read_bytes()
    assert fiche.titre == "0100abcdef012000"


def test_une_fiche_trop_grosse_pour_le_worker_n_est_pas_ecrite() -> None:
    """Le worker refuse une fiche de plus de 4 096 octets."""
    with pytest.raises(ValueError, match="4096"):
        fiche_switch("é" * 2100, JEU)
    assert len(fiche_switch("é" * 1900, JEU).octets) <= 4096
