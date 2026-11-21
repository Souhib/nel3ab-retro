"""Ce qu'un fichier est, d'après ses octets: chaque console, et son jumeau.

Chaque format reconnu a son cas positif ET un cas qui lui ressemble sans
l'être. Un identifiant qui répond « GameCube » à tout passerait tous les cas
positifs; ce sont les jumeaux qui l'arrêtent.
"""

import inspect
import random

import pytest

from nel3ab_control.imports.identifier import Identification, identifier
from tests.imports import fabrique as f


def lu(octets: bytes) -> Identification:
    return identifier(f.lecteur(octets), len(octets))


# ── GameCube et Wii ────────────────────────────────────────────────────────


def test_un_iso_gamecube_donne_sa_console_son_code_et_son_titre() -> None:
    trouve = lu(f.iso_nintendo(wii=False, identifiant="GALE01", titre="Super Essai Melee"))

    assert (trouve.console, trouve.format) == ("gc", "iso")
    assert trouve.identifiant == "GALE01"
    assert trouve.titre == "Super Essai Melee"
    assert "nkit" not in trouve.drapeaux
    assert "0x1C" in trouve.preuve


def test_un_iso_wii_est_wii_et_pas_gamecube() -> None:
    trouve = lu(f.iso_nintendo(wii=True, identifiant="RMCP01", titre="Essai Kart Wii"))

    assert (trouve.console, trouve.format) == ("wii", "iso")
    assert trouve.identifiant == "RMCP01"
    assert trouve.titre == "Essai Kart Wii"


def test_le_deuxieme_disque_d_un_jeu_garde_son_numero() -> None:
    trouve = lu(f.iso_nintendo(wii=False, identifiant="GTOE8P", disque=1))

    assert trouve.details["disque"] == "2"


def test_une_image_nkit_est_signalee() -> None:
    assert "nkit" in lu(f.iso_nintendo(wii=False, nkit=True)).drapeaux


def test_un_iso_sans_mot_magique_n_est_pas_un_disque_nintendo() -> None:
    """Le jumeau: un en-tête qui a l'air d'un disque, sans ses mots magiques.

    C'est l'ISO d'une autre console, ou un fichier abîmé: le ranger dans le
    dossier GameCube ferait apparaître au menu un jeu qui ne démarre pas.
    """
    octets = bytearray(f.iso_nintendo(wii=False))
    octets[0x1C:0x20] = b"\0\0\0\0"

    assert lu(bytes(octets)).console is None


@pytest.mark.parametrize(("type_disque", "console"), [(1, "gc"), (2, "wii")])
def test_un_rvz_dit_sa_console_par_son_type_de_disque(type_disque: int, console: str) -> None:
    trouve = lu(f.rvz(type_disque=type_disque, identifiant="RSBE01", titre="Essai Bros"))

    assert (trouve.console, trouve.format) == (console, "rvz")
    assert trouve.identifiant == "RSBE01"
    assert trouve.titre == "Essai Bros"
    assert "a-verifier" not in trouve.drapeaux


def test_un_wia_est_reconnu_comme_tel() -> None:
    trouve = lu(f.rvz(type_disque=2, wia=True))

    assert (trouve.console, trouve.format) == ("wii", "wia")


@pytest.mark.parametrize("type_disque", [0, 3, 0xFFFFFFFF])
def test_un_rvz_au_type_de_disque_inconnu_n_a_pas_de_console(type_disque: int) -> None:
    trouve = lu(f.rvz(type_disque=type_disque, wii=False))

    assert trouve.console is None
    assert trouve.format == "rvz"


def test_un_rvz_dont_la_copie_du_disque_contredit_le_type_est_a_verifier() -> None:
    """Type 2 (Wii) annoncé, mais la copie du disque porte le mot GameCube."""
    trouve = lu(f.rvz(type_disque=2, wii=False))

    assert trouve.console == "wii"
    assert "a-verifier" in trouve.drapeaux


@pytest.mark.parametrize("compresse", [True, False])
def test_un_gcz_est_lu_apres_decompression_de_son_premier_bloc(compresse: bool) -> None:
    disque = f.entete_disque(wii=True, identifiant="SOUE01", titre="Essai compresse")
    trouve = lu(f.gcz(disque, compresse=compresse))

    assert (trouve.console, trouve.format) == ("wii", "gcz")
    assert trouve.titre == "Essai compresse"
    assert "compresse" in trouve.drapeaux


def test_un_gcz_au_bloc_illisible_n_a_pas_de_console() -> None:
    octets = bytearray(f.gcz(f.entete_disque(wii=False)))
    octets[48:64] = b"\xff" * 16

    trouve = lu(bytes(octets))
    assert (trouve.console, trouve.format) == (None, "gcz")


def test_un_ciso_lit_le_disque_dans_son_premier_bloc() -> None:
    trouve = lu(f.ciso(f.entete_disque(wii=False, identifiant="GM4E01", titre="Essai Kart")))

    assert (trouve.console, trouve.format) == ("gc", "ciso")
    assert trouve.identifiant == "GM4E01"


def test_un_ciso_sans_disque_nintendo_n_est_pas_un_jeu_gamecube() -> None:
    """La même magie sert aux CSO de la PSP: sans disque Nintendo dedans, pas de console."""
    assert lu(f.ciso(b"\0" * 0x80)).console is None


def test_un_wbfs_est_un_jeu_wii() -> None:
    trouve = lu(f.wbfs(f.entete_disque(wii=True, identifiant="RMGE01", titre="Essai Galaxie")))

    assert (trouve.console, trouve.format) == ("wii", "wbfs")
    assert trouve.titre == "Essai Galaxie"


def test_un_wbfs_sans_disque_wii_n_a_pas_de_console() -> None:
    assert lu(f.wbfs(f.entete_disque(wii=False))).console is None


# ── Switch ─────────────────────────────────────────────────────────────────

TICKET_JEU = "0100bde00862a0000000000000000004.tik"
TICKET_MAJ = "0100bde00862a8000000000000000004.tik"


def test_un_nsp_est_switch_et_son_ticket_propose_un_titre_de_jeu() -> None:
    trouve = lu(f.pfs0(["a.nca", "b.cnmt.nca", TICKET_JEU, "0100.cert"]))

    assert (trouve.console, trouve.format) == ("switch", "nsp")
    assert trouve.details["titre_propose"] == "0100bde00862a000"
    assert trouve.details["contenu"] == "jeu"


def test_un_nsp_de_mise_a_jour_n_est_pas_un_jeu() -> None:
    trouve = lu(f.pfs0(["a.nca", "b.cnmt.nca", TICKET_MAJ]))

    assert trouve.console == "switch"
    assert trouve.details["contenu"] == "mise-a-jour"


def test_un_nsp_sans_ticket_ne_propose_aucun_titre() -> None:
    trouve = lu(f.pfs0(["a.nca", "b.cnmt.nca"]))

    assert trouve.console == "switch"
    assert "titre_propose" not in trouve.details


def test_un_nsz_se_reconnait_a_ses_parties_compressees() -> None:
    trouve = lu(f.pfs0(["a.ncz", "b.cnmt.nca", TICKET_JEU]))

    assert (trouve.console, trouve.format) == ("switch", "nsz")
    assert "compresse" in trouve.drapeaux


def test_un_pfs0_a_la_table_impossible_n_est_pas_un_nsp() -> None:
    octets = bytearray(f.pfs0(["a.nca"]))
    octets[4:8] = (10**6).to_bytes(4, "little")

    assert lu(bytes(octets)).console is None


@pytest.mark.parametrize("zone_cle", [False, True])
def test_une_carte_xci_est_switch(zone_cle: bool) -> None:
    trouve = lu(f.xci(zone_cle=zone_cle))

    assert (trouve.console, trouve.format) == ("switch", "xci")


def test_une_carte_xcz_se_reconnait_a_sa_partition_securisee() -> None:
    trouve = lu(f.xci(secure=["0123456789abcdef0123456789abcdef.ncz"]))

    assert (trouve.console, trouve.format) == ("switch", "xcz")


def test_un_nup_est_switch_2_et_reste_a_verifier() -> None:
    trouve = lu(b"NUP\x01" + b"\0" * 0x200)

    assert (trouve.console, trouve.format) == ("switch2", "nup")
    assert "a-verifier" in trouve.drapeaux


# ── Xbox 360 ───────────────────────────────────────────────────────────────


def test_un_xex_donne_son_identifiant_de_titre() -> None:
    trouve = lu(f.xex(0x4D5307E6))

    assert (trouve.console, trouve.format) == ("x360", "xex")
    assert trouve.identifiant == "4D5307E6"


@pytest.mark.parametrize("magie", [b"CON ", b"LIVE", b"PIRS"])
def test_un_paquet_stfs_donne_son_nom_et_son_titre(magie: bytes) -> None:
    trouve = lu(f.stfs(magie, titre_id=0x58410889, type_contenu=0x000D0000, nom="Essai Arcade"))

    assert (trouve.console, trouve.format) == ("x360", "stfs")
    assert trouve.identifiant == "58410889"
    assert trouve.titre == "Essai Arcade"


def test_un_jeu_games_on_demand_est_signale_en_plusieurs_fichiers() -> None:
    trouve = lu(f.stfs(b"LIVE", titre_id=0x4D5307E6, type_contenu=0x7000, nom="Essai GOD"))

    assert trouve.format == "god"
    assert "plusieurs-fichiers" in trouve.drapeaux


@pytest.mark.parametrize("partition", [0, 0xFD90000, 0x2080000])
def test_une_image_xiso_est_reconnue_a_chacun_des_decalages(partition: int) -> None:
    fichier = f.Clairseme(taille=partition + 0x200000)
    for decalage, octets in f.xdvdfs("default.xex").items():
        fichier.poser(partition + decalage, octets)

    trouve = identifier(fichier.lire, fichier.taille)
    assert (trouve.console, trouve.format) == ("x360", "xiso")


@pytest.mark.parametrize("voisins", [0, 3])
def test_une_image_xiso_donne_le_titre_de_son_executable(voisins: int) -> None:
    # Sans titre, la salle ne peut ni inscrire le jeu ni ranger ses sauvegardes.
    # L'exécutable est cherché dans l'arbre du répertoire, pas seulement à la
    # première entrée: un vrai disque range d'autres fichiers avant lui.
    fichier = f.Clairseme(taille=0xFD90000 + 0x200000)
    for decalage, octets in f.xdvdfs("default.xex", 0x534507D6, voisins).items():
        fichier.poser(0xFD90000 + decalage, octets)

    trouve = identifier(fichier.lire, fichier.taille)
    assert (trouve.console, trouve.format, trouve.identifiant) == ("x360", "xiso", "534507D6")


def test_une_image_xiso_sans_xex_lisible_n_invente_pas_de_titre() -> None:
    # Le jumeau: le nom est à la racine, mais pas d'en-tête XEX2 à son secteur.
    fichier = f.Clairseme(taille=0x200000)
    for decalage, octets in f.xdvdfs("default.xex").items():
        fichier.poser(decalage, octets)

    trouve = identifier(fichier.lire, fichier.taille)
    assert (trouve.console, trouve.format, trouve.identifiant) == ("x360", "xiso", "")


def test_une_image_xbox_d_origine_n_est_pas_une_xbox_360() -> None:
    fichier = f.Clairseme(taille=0x200000)
    for decalage, octets in f.xdvdfs("default.xbe").items():
        fichier.poser(decalage, octets)

    trouve = identifier(fichier.lire, fichier.taille)
    assert (trouve.console, trouve.format) == ("xbox", "xiso")


def test_la_marque_xdvdfs_ailleurs_qu_au_secteur_32_ne_compte_pas() -> None:
    fichier = f.Clairseme(taille=0x200000)
    for decalage, octets in f.xdvdfs("default.xex").items():
        fichier.poser(decalage + 0x800, octets)

    assert identifier(fichier.lire, fichier.taille).console is None


# ── Consoles reconnues, pas encore jouables ────────────────────────────────


@pytest.mark.parametrize(("nes2", "format_"), [(False, "ines"), (True, "nes2")])
def test_une_rom_nes(nes2: bool, format_: str) -> None:
    trouve = lu(f.nes(nes2=nes2))

    assert (trouve.console, trouve.format) == ("nes", format_)


@pytest.mark.parametrize("ordre", ["z64", "v64", "n64"])
def test_les_trois_ordres_d_octets_n64_donnent_le_meme_titre(ordre: str) -> None:
    trouve = lu(f.n64(ordre, titre="SUPER ESSAI 64"))

    assert (trouve.console, trouve.format) == ("n64", ordre)
    assert trouve.titre == "SUPER ESSAI 64"
    assert trouve.identifiant == "NSEP"


@pytest.mark.parametrize(("drapeau", "console"), [(0, "gb"), (0x80, "gbc"), (0xC0, "gbc")])
def test_une_rom_game_boy_et_son_drapeau_couleur(drapeau: int, console: str) -> None:
    trouve = lu(f.game_boy(couleur=drapeau))

    assert trouve.console == console
    assert trouve.titre == "ESSAI"


def test_un_logo_game_boy_avec_une_somme_fausse_n_est_pas_reconnu() -> None:
    """La console de démarrage refuse cette cartouche: nous aussi."""
    trouve = lu(f.game_boy(somme_fausse=True))

    assert trouve.console is None
    assert "somme" in trouve.preuve


def test_une_rom_gba() -> None:
    trouve = lu(f.gba())

    assert (trouve.console, trouve.format) == ("gba", "gba")
    assert trouve.identifiant == "AEXF"
    assert trouve.titre == "ESSAI AVANCE"


def test_une_rom_gba_au_complement_faux_n_est_pas_reconnue() -> None:
    assert lu(f.gba(complement_faux=True)).console is None


def test_une_rom_ds() -> None:
    trouve = lu(f.nds())

    assert (trouve.console, trouve.format) == ("ds", "nds")
    assert trouve.identifiant == "AEXP"


def test_un_crc_de_logo_ds_faux_n_est_pas_reconnu() -> None:
    assert lu(f.nds(crc_logo=0xCF57)).console is None


def test_une_rom_mega_drive() -> None:
    trouve = lu(f.mega_drive())

    assert trouve.console == "md"
    assert trouve.titre == "SONIC ESSAI"


@pytest.mark.parametrize("brut", [False, True])
def test_un_disque_playstation_lit_son_system_cnf(brut: bool) -> None:
    trouve = lu(f.iso9660(systeme="PLAYSTATION", boot="BOOT = cdrom:\\SLUS_005.94;1", brut=brut))

    assert trouve.console == "ps1"
    assert trouve.identifiant == "SLUS_005.94"


def test_un_disque_playstation_2_n_est_pas_une_playstation() -> None:
    trouve = lu(f.iso9660(systeme="PLAYSTATION", boot="BOOT2 = cdrom0:\\SLUS_200.62;1"))

    assert trouve.console == "ps2"


def test_un_iso_9660_ordinaire_n_a_pas_de_console() -> None:
    trouve = lu(f.iso9660(systeme="LINUX", boot=None))

    assert (trouve.console, trouve.format) == (None, "iso9660")


def test_un_chd_est_reconnu_sans_console() -> None:
    trouve = lu(f.chd())

    assert (trouve.console, trouve.format) == (None, "chd")


def test_une_fiche_cue_est_un_disque_en_plusieurs_fichiers() -> None:
    fiche = b'FILE "Essai (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n'

    trouve = lu(fiche)
    assert trouve.format == "cue"
    assert "plusieurs-fichiers" in trouve.drapeaux


# ── Archives ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("octets", "format_"),
    [
        (b"PK\x03\x04" + b"\0" * 60, "zip"),
        (b"PK\x05\x06" + b"\0" * 18, "zip"),
        (b"7z\xbc\xaf\x27\x1c\x00\x04" + b"\0" * 24, "7z"),
        (b"Rar!\x1a\x07\x00" + b"\0" * 20, "rar"),
        (b"Rar!\x1a\x07\x01\x00" + b"\0" * 20, "rar"),
    ],
)
def test_les_archives_sont_reconnues(octets: bytes, format_: str) -> None:
    trouve = lu(octets)

    assert trouve.format == format_
    assert trouve.console is None
    assert "archive" in trouve.drapeaux


# ── Les jumeaux qui ne sont rien ───────────────────────────────────────────


def test_un_fichier_texte_n_est_rien() -> None:
    trouve = lu(f.texte())

    assert (trouve.console, trouve.format) == (None, "inconnu")


def test_un_fichier_vide_n_est_rien() -> None:
    assert lu(b"").format == "inconnu"


def test_un_fichier_qui_ment_par_son_extension_est_lu_par_ses_octets() -> None:
    """Le nom ne participe pas: l'identifiant ne le reçoit même pas.

    Un disque GameCube déposé sous le nom `jeu.nsp` reste un disque GameCube,
    et un texte nommé `jeu.wbfs` reste un texte.
    """
    assert lu(f.iso_nintendo(wii=False)).console == "gc"
    assert lu(f.texte()).console is None
    assert list(inspect.signature(identifier).parameters) == ["lire", "taille"]


ECHANTILLONS = {
    "gc": f.iso_nintendo(wii=False),
    "rvz": f.rvz(type_disque=1),
    "gcz": f.gcz(f.entete_disque(wii=False)),
    "ciso": f.ciso(f.entete_disque(wii=False)),
    "wbfs": f.wbfs(f.entete_disque(wii=True)),
    "nsp": f.pfs0(["a.nca", TICKET_JEU]),
    "xci": f.xci(),
    "xex": f.xex(1),
    "stfs": f.stfs(b"LIVE", titre_id=1, type_contenu=0x7000, nom="x"),
    "nes": f.nes(),
    "n64": f.n64("n64"),
    "gb": f.game_boy(),
    "gba": f.gba(),
    "ds": f.nds(),
    "ps1": f.iso9660(systeme="PLAYSTATION", boot="BOOT = cdrom:\\X;1", brut=True),
}


@pytest.mark.parametrize("nom", sorted(ECHANTILLONS))
def test_un_en_tete_tronque_a_chaque_longueur_ne_leve_jamais(nom: str) -> None:
    """Un envoi coupé, un fichier abîmé: chaque longueur de 0 à 0x500 octets.

    Aucune ne doit lever: une exception ici arrêterait le traitement de
    l'envoi au lieu de le laisser en quarantaine avec « inconnu ».
    """
    complet = ECHANTILLONS[nom]
    for longueur in range(0, min(len(complet), 0x500)):
        identifier(f.lecteur(complet[:longueur]), longueur)


def test_des_octets_au_hasard_ne_levent_jamais() -> None:
    hasard = random.Random(20261121)  # noqa: S311 - des octets d'essai, pas un secret
    for _ in range(300):
        octets = bytes(hasard.getrandbits(8) for _ in range(hasard.randrange(0, 0x2000)))
        identifier(f.lecteur(octets), len(octets))
        # Une taille annoncée plus grande que ce qu'on peut lire: un envoi en cours.
        identifier(f.lecteur(octets), len(octets) + 0x10000000)
