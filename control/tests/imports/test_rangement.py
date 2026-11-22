"""Ranger sans jamais rien remplacer, sous un nom qui ne bougera plus."""

import dataclasses
import errno
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import pytest

from nel3ab_control import consoles as manifeste
from nel3ab_control.imports import destinations, rangement
from nel3ab_control.imports.destinations import destination, dossiers
from nel3ab_control.imports.identifier import Identification
from nel3ab_control.imports.rangement import (
    Bibliotheque,
    Refus,
    cle_sauvegarde,
    ecrire_fiche,
    fiche_switch,
    lier_sans_remplacer,
    nettoyer,
    nom_canonique,
    retirer_si_meme,
)
from nel3ab_control.imports.switch_nca import Contenu, Illisible, Incertain, Lecture, SansCle
from nel3ab_control.imports.traitement import VISIBLE, decider
from tests.imports import fabrique as f

# ── Le nom ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("titre", "attendu"),
    [
        ("Super Smash Bros. Melee", "Super Smash Bros. Melee"),
        ("  Mario   Kart:  Double Dash!! ", "Mario Kart Double Dash!!"),
        ("../../../etc/passwd", "etc passwd"),
        ("..", ""),
        (".cache", "cache"),
        ("a\0b\x1fc\nd", "a b c d"),
        ("Pokémon Colosseum", "Pokémon Colosseum"),
        ('Que* "vaut" <ceci>?|', "Que vaut ceci"),
    ],
)
def test_un_titre_devient_un_nom_de_fichier_sans_chemin(titre: str, attendu: str) -> None:
    nom = nettoyer(titre)

    assert nom == attendu
    assert "/" not in nom
    assert not nom.startswith(".")


def test_un_titre_trop_long_est_coupe_sous_la_limite_d_octets() -> None:
    nom = nettoyer("é" * 400)

    assert len(nom.encode()) <= rangement.NOM_MAX
    assert nom == "é" * (rangement.NOM_MAX // 2)


def test_le_nom_vient_du_titre_puis_du_nom_annonce_puis_du_code() -> None:
    assert nom_canonique("Titre Lu", "annonce.iso", "GALE01", "1", "iso") == "Titre Lu.iso"
    assert nom_canonique("", "../dossier/Annonce (Europe).iso", "GALE01", "1", "rvz") == (
        "Annonce (Europe).rvz"
    )
    assert nom_canonique("", "..", "GALE01", "1", "iso") == "GALE01.iso"
    assert nom_canonique("", "", "", "", "iso") == "jeu.iso"


def test_l_extension_vient_du_format_lu_et_pas_du_nom_annonce() -> None:
    assert nom_canonique("Jeu", "jeu.nsp", "", "", "rvz") == "Jeu.rvz"


def test_le_deuxieme_disque_porte_son_numero_et_pas_le_premier() -> None:
    assert nom_canonique("Tales", "", "GTOE8P", "2", "iso") == "Tales (Disque 2).iso"
    assert nom_canonique("Tales", "", "GTOE8P", "1", "iso") == "Tales.iso"


@pytest.mark.parametrize(
    ("nom", "cle"),
    [
        # Les exemples des essais de `emulator::saves::key`, recopiés.
        ("Super Mario Strikers.rvz", "super-mario-strikers-rvz"),
        (
            "Mario Kart Double Dash (Retro Track Grand Prix).rvz",
            "mario-kart-double-dash-retro-track-grand-prix-rvz",
        ),
        ("...///...", "sans-nom"),
        ("", "sans-nom"),
        ("../../etc/passwd", "etc-passwd"),
        ("Pokémon.iso", "pok-mon-iso"),
    ],
)
def test_la_cle_de_sauvegarde_est_celle_du_worker(nom: str, cle: str) -> None:
    assert cle_sauvegarde(nom) == cle


# ── Les décisions ──────────────────────────────────────────────────────────


@pytest.fixture
def bibliotheque(tmp_path: Path) -> tuple[str, Path]:
    racine = tmp_path / "roms"
    for nom in ("gc", "wii", "switch"):
        (racine / nom).mkdir(parents=True)
    rom_dir = ":".join(str(racine / nom) for nom in ("gc", "wii", "switch"))
    return rom_dir, racine


def lu(console: str | None, format_: str, *drapeaux: str, **details: str) -> Identification:
    return Identification(console, format_, drapeaux=frozenset(drapeaux), details=details)


@pytest.mark.parametrize(
    ("trouve", "etat"),
    [
        (lu("gc", "iso"), "range"),
        (lu("wii", "rvz"), "range"),
        (lu("wii", "wbfs"), "pas-jouable"),
        (lu("wii", "wia"), "pas-jouable"),
        (lu("gc", "iso", "nkit"), "a-confirmer"),
        (lu("wii", "rvz", "a-verifier"), "a-confirmer"),
        (lu("switch", "nsp", titre_propose="0100bde00862a000", contenu="jeu"), "a-confirmer"),
        (
            lu("switch", "nsp", titre_propose="0100bde00862a800", contenu="mise-a-jour"),
            "a-confirmer",
        ),
        (lu("switch", "xci"), "a-confirmer"),
        (lu("switch", "nsz", "compresse"), "pas-jouable"),
        (lu("switch2", "nup", "a-verifier"), "a-confirmer"),
        # Jouable depuis le 21 novembre 2026: un disque sans titre lisible
        # attend sa fiche; un exécutable seul ou un paquet n'est pas un disque.
        (lu("x360", "xiso"), "a-confirmer"),
        (lu("x360", "xex"), "pas-jouable"),
        (lu("x360", "god", "plusieurs-fichiers"), "pas-jouable"),
        (lu("nes", "ines"), "pas-jouable"),
        (lu("ps1", "bin"), "pas-jouable"),
        (lu(None, "chd"), "inconnu"),
        (lu(None, "inconnu"), "inconnu"),
    ],
)
def test_chaque_console_a_sa_decision(
    bibliotheque: tuple[str, Path], trouve: Identification, etat: str
) -> None:
    rom_dir, _ = bibliotheque

    assert decider(trouve, rom_dir).etat == etat


JEU = 0x0100ABCDEF012000


@pytest.mark.parametrize(
    ("lecture", "etat"),
    [
        (Contenu("jeu", JEU, JEU, 0x11, ()), "range"),
        (Contenu("mise-a-jour", JEU | 0x800, JEU, 0x11, ()), "mise-a-jour"),
        (Contenu("contenu-additionnel", JEU + 0x1001, JEU, 0x11, ()), "contenu-additionnel"),
        (Illisible("clé fausse"), "refuse"),
        (Incertain("deux jeux"), "a-confirmer"),
        (SansCle("pas de fichier"), "a-confirmer"),
        (None, "a-confirmer"),
    ],
)
def test_une_switch_lue_dans_ses_en_tetes_a_sa_decision(
    bibliotheque: tuple[str, Path], lecture: Lecture | None, etat: str
) -> None:
    rom_dir, racine = bibliotheque

    decision = decider(lu("switch", "nsp"), rom_dir, lecture)

    assert decision.etat == etat
    assert decision.dossier == (racine / "switch" if etat == "range" else None)


def test_un_nsz_reste_pas_jouable_meme_lu(bibliotheque: tuple[str, Path]) -> None:
    rom_dir, _ = bibliotheque

    assert decider(lu("switch", "nsz"), rom_dir, Contenu("jeu", JEU, JEU, 0, ())).etat == (
        "pas-jouable"
    )


def test_sans_dossier_switch_un_jeu_lu_attend_une_confirmation(tmp_path: Path) -> None:
    (tmp_path / "gc").mkdir()

    decision = decider(lu("switch", "xci"), str(tmp_path / "gc"), Contenu("jeu", JEU, JEU, 0, ()))

    assert decision.etat == "a-confirmer"
    assert "« switch »" in decision.message


def test_un_jeu_range_dit_quand_il_apparaitra(bibliotheque: tuple[str, Path]) -> None:
    rom_dir, racine = bibliotheque
    decision = decider(lu("gc", "iso"), rom_dir)

    assert decision.message == VISIBLE
    assert decision.dossier == racine / "gc"


def test_sans_dossier_pour_sa_console_un_jeu_attend_une_confirmation(tmp_path: Path) -> None:
    """Le dossier se choisit par son NOM: un dossier `wii` seul ne reçoit pas un jeu GameCube."""
    (tmp_path / "wii").mkdir()

    decision = decider(lu("gc", "iso"), str(tmp_path / "wii"))

    assert decision.etat == "a-confirmer"
    assert "« gc »" in decision.message


def test_jouable_dossier_et_formats_viennent_du_manifeste() -> None:
    """L'import ne tient pas sa propre table: il lit `consoles/consoles.json`."""
    x360 = destinations.console("x360")
    gc = destinations.console("gc")

    assert x360 is not None
    assert gc is not None
    assert (x360.jouable, x360.dossier, x360.inscription) == (True, "xbox360", "sidecar")
    # `gcm` est au manifeste, mais l'identifiant le lit comme un `iso`.
    assert gc.formats == {"iso", "rvz", "gcz", "ciso"}
    assert gc.inscription == "dolphin-header"


def test_une_console_retiree_au_manifeste_l_est_aussi_pour_l_import() -> None:
    """Le jumeau: changer le manifeste suffit, sans toucher à ce module.

    Jusqu'au 21 novembre 2026, l'exemple rendait la Xbox 360 jouable; elle
    l'est devenue, et l'essai la retire à la place.
    """
    entrees = tuple(
        dataclasses.replace(entree, playable=False) if entree.code == "x360" else entree
        for entree in manifeste.CONSOLES.consoles
    )
    modifie = dataclasses.replace(manifeste.CONSOLES, consoles=entrees)

    x360 = destinations.console("x360", modifie)
    assert x360 is not None
    assert not x360.jouable


def test_une_console_reconnue_hors_du_manifeste_n_a_ni_dossier_ni_moteur() -> None:
    nes = destinations.console("nes")

    assert nes is not None
    assert (nes.libelle, nes.dossier, nes.jouable) == ("NES", None, False)
    assert destinations.console("?") is None


def test_le_dossier_vient_du_nom_et_pas_de_la_position(tmp_path: Path) -> None:
    rom_dir = f"{tmp_path / 'wii'}:{tmp_path / 'gc'}"

    assert destination("gc", rom_dir) == tmp_path / "gc"
    assert destination("x360", rom_dir) is None
    assert dossiers("::" + rom_dir + ":") == [tmp_path / "wii", tmp_path / "gc"]


# ── Le rangement ───────────────────────────────────────────────────────────


def ranger(
    bibliotheque: tuple[str, Path], octets: bytes, nom: str, jeu: tuple[str, str] | None = None
) -> str:
    rom_dir, racine = bibliotheque
    source = racine.parent / "quarantaine-fichier"
    source.write_bytes(octets)
    fd = os.open(source, os.O_RDONLY)
    try:
        return Bibliotheque(dossiers(rom_dir), racine.parent / "verrou").ranger(
            fd, racine / "gc", nom, sha256=hashlib.sha256(octets).hexdigest(), jeu=jeu
        )
    finally:
        os.close(fd)


GC = f.iso_nintendo(wii=False, identifiant="GALE01", titre="Super Essai Melee")


def test_un_jeu_se_range_sous_son_nom(bibliotheque: tuple[str, Path]) -> None:
    _, racine = bibliotheque

    assert ranger(bibliotheque, GC, "Super Essai Melee.iso") == "gc/Super Essai Melee.iso"
    assert (racine / "gc" / "Super Essai Melee.iso").read_bytes() == GC
    assert (racine / "gc" / "Super Essai Melee.iso").stat().st_mode & 0o777 == 0o644


def test_un_nom_deja_pris_dans_un_autre_dossier_est_refuse(bibliotheque: tuple[str, Path]) -> None:
    """Le balayage du worker écarterait le second en silence."""
    _, racine = bibliotheque
    (racine / "wii" / "Super Essai Melee.iso").write_bytes(b"autre jeu")

    with pytest.raises(Refus, match="porte déjà ce nom"):
        ranger(bibliotheque, GC, "Super Essai Melee.iso")
    assert (racine / "wii" / "Super Essai Melee.iso").read_bytes() == b"autre jeu"
    assert not (racine / "gc" / "Super Essai Melee.iso").exists()


def test_un_nom_qui_partagerait_ses_sauvegardes_est_refuse(bibliotheque: tuple[str, Path]) -> None:
    _, racine = bibliotheque
    (racine / "gc" / "super essai melee.iso").write_bytes(b"autre")

    with pytest.raises(Refus, match="partagerait ses sauvegardes"):
        ranger(bibliotheque, GC, "Super Essai Melee.iso")


def test_le_meme_fichier_sous_un_autre_nom_est_un_doublon(bibliotheque: tuple[str, Path]) -> None:
    _, racine = bibliotheque
    (racine / "wii" / "Ancien nom.iso").write_bytes(GC)

    with pytest.raises(Refus, match="octet pour octet"):
        ranger(bibliotheque, GC, "Super Essai Melee.iso")


def test_le_meme_jeu_dans_un_autre_format_du_meme_dossier_est_un_doublon(
    bibliotheque: tuple[str, Path],
) -> None:
    _, racine = bibliotheque
    (racine / "gc" / "Ancien.rvz").write_bytes(f.rvz(type_disque=1, identifiant="GALE01"))

    with pytest.raises(Refus, match=r"même jeu \(GALE01, disque 1\)"):
        ranger(bibliotheque, GC, "Super Essai Melee.iso", jeu=("GALE01", "1"))


def test_le_deuxieme_disque_du_meme_jeu_n_est_pas_un_doublon(
    bibliotheque: tuple[str, Path],
) -> None:
    """Le jumeau: même code de jeu, autre disque."""
    _, racine = bibliotheque
    (racine / "gc" / "Tales.iso").write_bytes(f.iso_nintendo(wii=False, identifiant="GTOE8P"))
    disque2 = f.iso_nintendo(wii=False, identifiant="GTOE8P", disque=1)

    assert ranger(bibliotheque, disque2, "Tales (Disque 2).iso", jeu=("GTOE8P", "2")) == (
        "gc/Tales (Disque 2).iso"
    )


def test_si_le_jeu_ne_se_lie_pas_sa_fiche_neuve_est_retiree(
    bibliotheque: tuple[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un jeu apparu entre le contrôle et le lien: la fiche écrite pour lui part aussi."""
    rom_dir, racine = bibliotheque
    source = racine.parent / "quarantaine-fichier"
    source.write_bytes(b"un jeu switch")

    def apparu(source: int, dossier: int, nom: str) -> None:
        raise Refus("doublon", f"un fichier « {nom} » est apparu pendant le rangement")

    monkeypatch.setattr(rangement, "lier_sans_remplacer", apparu)
    fd = os.open(source, os.O_RDONLY)
    try:
        with pytest.raises(Refus, match="apparu"):
            Bibliotheque(dossiers(rom_dir), racine.parent / "verrou").ranger(
                fd,
                racine / "switch",
                "Jeu.nsp",
                sha256=hashlib.sha256(b"un jeu switch").hexdigest(),
                jeu=None,
                fiche=fiche_switch("Jeu", JEU),
            )
    finally:
        os.close(fd)

    assert not list((racine / "switch").iterdir())


def test_retirer_une_fiche_ne_retire_que_celle_qu_on_a_ecrite(tmp_path: Path) -> None:
    """Le jumeau: un fichier qui a pris la place de notre fiche reste où il est.

    La fiche reste ouverte pendant le remplacement. Fermée, son numéro d'inode
    serait libre, et le fichier suivant le reçoit souvent: la première version
    de ce module comparait un numéro gardé après fermeture, et cet essai a
    retiré la fiche de quelqu'un d'autre.
    """
    fiche = tmp_path / "Jeu.nsp.nel3ab.json"
    dossier = os.open(tmp_path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        ecrite = ecrire_fiche(dossier, fiche.name, fiche_switch("Jeu", JEU))
        try:
            fiche.unlink()
            fiche.write_text("la fiche de quelqu'un")
            retirer_si_meme(dossier, fiche.name, ecrite)
        finally:
            os.close(ecrite)
        assert fiche.read_text() == "la fiche de quelqu'un"

        fiche.unlink()
        ecrite = ecrire_fiche(dossier, fiche.name, fiche_switch("Jeu", JEU))
        try:
            retirer_si_meme(dossier, fiche.name, ecrite)
        finally:
            os.close(ecrite)
        assert not fiche.exists()
    finally:
        os.close(dossier)
    assert not list(tmp_path.iterdir()), "aucun fichier provisoire ne reste"


def test_lier_ne_remplace_jamais_un_fichier_existant(tmp_path: Path) -> None:
    """La garde qui compte: un fichier apparu entre le contrôle et le lien reste intact."""
    dossier = tmp_path / "gc"
    dossier.mkdir()
    (dossier / "Jeu.iso").write_bytes(b"le jeu de quelqu'un")
    (tmp_path / "neuf").write_bytes(b"le nouveau")
    source = os.open(tmp_path / "neuf", os.O_RDONLY)
    cible = os.open(dossier, os.O_RDONLY | os.O_DIRECTORY)
    try:
        with pytest.raises(Refus, match="rien n'a été remplacé"):
            lier_sans_remplacer(source, cible, "Jeu.iso")
    finally:
        os.close(source)
        os.close(cible)

    assert (dossier / "Jeu.iso").read_bytes() == b"le jeu de quelqu'un"


def test_entre_deux_disques_le_fichier_est_copie_puis_lie_sans_reste(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dossier = tmp_path / "gc"
    dossier.mkdir()
    (tmp_path / "neuf").write_bytes(GC)
    vrai_lien = os.link

    def lien(src: str, dst: str, **options: Any) -> None:
        if str(src).startswith("/proc/self/fd/"):
            raise OSError(errno.EXDEV, "autre disque")
        vrai_lien(src, dst, **options)

    monkeypatch.setattr(os, "link", lien)
    source = os.open(tmp_path / "neuf", os.O_RDONLY)
    cible = os.open(dossier, os.O_RDONLY | os.O_DIRECTORY)
    try:
        lier_sans_remplacer(source, cible, "Jeu.iso")
    finally:
        os.close(source)
        os.close(cible)

    assert (dossier / "Jeu.iso").read_bytes() == GC
    assert sorted(p.name for p in dossier.iterdir()) == ["Jeu.iso"], "aucun provisoire ne reste"


def test_entre_deux_disques_un_fichier_existant_n_est_pas_remplace_non_plus(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dossier = tmp_path / "gc"
    dossier.mkdir()
    (dossier / "Jeu.iso").write_bytes(b"le jeu de quelqu'un")
    (tmp_path / "neuf").write_bytes(GC)
    vrai_lien = os.link

    def lien(src: str, dst: str, **options: Any) -> None:
        if str(src).startswith("/proc/self/fd/"):
            raise OSError(errno.EXDEV, "autre disque")
        vrai_lien(src, dst, **options)

    monkeypatch.setattr(os, "link", lien)
    source = os.open(tmp_path / "neuf", os.O_RDONLY)
    cible = os.open(dossier, os.O_RDONLY | os.O_DIRECTORY)
    try:
        with pytest.raises(Refus):
            lier_sans_remplacer(source, cible, "Jeu.iso")
    finally:
        os.close(source)
        os.close(cible)

    assert (dossier / "Jeu.iso").read_bytes() == b"le jeu de quelqu'un"
    assert sorted(p.name for p in dossier.iterdir()) == ["Jeu.iso"]


# ── Xbox 360 ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("annonce", "nom"),
    [
        ("Sonic the Hedgehog (USA, Europe) (En,Ja,Fr,De,Es,It).iso", "Sonic the Hedgehog"),
        ("Halo_3 [Disc 1].iso", "Halo 3"),
        ("(USA).iso", "534507D6"),
    ],
)
def test_le_nom_d_un_disque_xbox_360_perd_ses_etiquettes(annonce: str, nom: str) -> None:
    from nel3ab_control.imports.rangement import nom_xbox360

    assert nom_xbox360(annonce, "534507D6") == nom


def test_une_fiche_xbox_360_refuse_un_titre_d_une_autre_forme() -> None:
    from nel3ab_control.imports.rangement import fiche_xbox360

    assert fiche_xbox360("Sonic", "534507d6").titre == "534507d6"
    with pytest.raises(ValueError, match="8 chiffres"):
        fiche_xbox360("Sonic", "0100ABCDEF012000")
    with pytest.raises(ValueError, match="8 chiffres"):
        fiche_xbox360("Sonic", "")


# ── Les titres inscrits par fiche, console par console ─────────────────────


def poser_jeu(dossier: Path, nom: str, fiche: dict) -> None:
    """Un jeu déjà dans la bibliothèque, avec la fiche écrite à côté de lui."""
    dossier.mkdir(parents=True, exist_ok=True)
    (dossier / nom).write_bytes(b"jeu deja la")
    (dossier / f"{nom}.nel3ab.json").write_text(json.dumps(fiche))


@pytest.mark.parametrize(
    ("fiche", "titre"),
    [
        # Sonic, inscrit par l'import depuis le 21 novembre 2026: ignoré
        # jusqu'au 22, quand la recherche de doublons exigeait 16 chiffres.
        ({"console": "x360", "name": "Sonic", "title": "534507D6"}, "534507d6"),
        ({"console": "x360", "name": "Sonic", "title": "534507d6"}, "534507d6"),
        ({"console": "switch", "name": "Tennis", "title": "0100BDE00862A000"}, "0100bde00862a000"),
        ({"console": "switch2", "name": "Zelda", "title": "0400486024DEC000"}, "0400486024dec000"),
    ],
)
def test_une_fiche_inscrit_le_titre_de_sa_console(tmp_path: Path, fiche: dict, titre: str) -> None:
    poser_jeu(tmp_path / "roms" / "jeux", "Le jeu.iso", fiche)
    bibliotheque = Bibliotheque([tmp_path / "roms" / "jeux"], tmp_path / "verrou")

    inscrits = bibliotheque.inscrits()

    assert list(inscrits) == [titre]
    assert inscrits[titre].nom == fiche["name"]


@pytest.mark.parametrize(
    "fiche",
    [
        # Les jumeaux: le titre d'une console sous le nom d'une autre, une
        # console sans titre, une mise à jour, et une fiche sans console, que le
        # worker n'inscrit pas non plus (`emulator::switch::registered`).
        {"console": "switch", "name": "Sonic", "title": "534507D6"},
        {"console": "x360", "name": "Tennis", "title": "0100BDE00862A000"},
        {"console": "gc", "name": "Melee", "title": "0100BDE00862A000"},
        {"console": "switch", "name": "Tennis", "title": "0100BDE00862A800"},
        {"name": "Tennis", "title": "0100BDE00862A000"},
        {"console": "x360", "name": "Sonic", "title": 0x534507D6},
    ],
)
def test_une_fiche_que_le_worker_n_inscrirait_pas_n_inscrit_rien(
    tmp_path: Path, fiche: dict
) -> None:
    poser_jeu(tmp_path / "roms" / "jeux", "Le jeu.iso", fiche)

    assert Bibliotheque([tmp_path / "roms" / "jeux"], tmp_path / "verrou").inscrits() == {}


def test_un_second_disque_xbox_360_du_meme_titre_est_un_doublon(tmp_path: Path) -> None:
    """Xenia range les sauvegardes par titre: deux fichiers partageraient la progression."""
    from nel3ab_control.imports.rangement import fiche_xbox360

    xbox = tmp_path / "roms" / "xbox360"
    poser_jeu(xbox, "Sonic.iso", {"console": "x360", "name": "Sonic", "title": "534507D6"})
    source = tmp_path / "quarantaine-fichier"
    source.write_bytes(b"un autre fichier du meme jeu")
    fd = os.open(source, os.O_RDONLY)
    try:
        with pytest.raises(Refus, match="titre 534507D6"):
            Bibliotheque([xbox], tmp_path / "verrou").ranger(
                fd,
                xbox,
                "Sonic the Hedgehog.iso",
                sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                jeu=None,
                fiche=fiche_xbox360("Sonic the Hedgehog", "534507D6"),
            )
    finally:
        os.close(fd)
    assert sorted(p.name for p in xbox.iterdir()) == ["Sonic.iso", "Sonic.iso.nel3ab.json"]


# ── Ce que la page de dépôt annonce comme rangé tout de suite ──────────────


def test_ce_qui_se_range_tout_de_suite_suit_le_manifeste_et_l_import(
    bibliotheque: tuple[str, Path],
) -> None:
    """La phrase de la page vient d'ici: écrite à la main, elle oubliait la Xbox 360."""
    from nel3ab_control.imports.traitement import FICHE_ECRITE_PAR_L_IMPORT, rangees

    rom_dir, _ = bibliotheque
    assert rangees() == ["GameCube", "Wii", "Switch", "Xbox 360"]
    # Le jumeau: la Switch 2 s'inscrit par fiche, que l'import n'écrit pas encore,
    # et `decider` le dit avec un fichier dont il ne reproche rien d'autre.
    assert "switch2" not in FICHE_ECRITE_PAR_L_IMPORT
    assert decider(lu("switch2", "nup"), rom_dir).etat == "a-confirmer"
    assert "à la main" in decider(lu("switch2", "nup"), rom_dir).message
    # Une console retirée du manifeste disparaît aussi de la phrase.
    sans = dataclasses.replace(
        manifeste.CONSOLES,
        consoles=tuple(one for one in manifeste.CONSOLES.consoles if one.code != "x360"),
    )
    assert rangees(sans) == ["GameCube", "Wii", "Switch"]


@pytest.mark.parametrize(
    "titre",
    [
        # Une mise à jour, un contenu additionnel, et un nombre trop grand pour
        # seize chiffres: aucune fiche de jeu ne les porte.
        JEU | 0x800,
        JEU + 0x1001,
        1 << 64,
    ],
)
def test_une_fiche_switch_refuse_un_titre_qui_n_est_pas_celui_d_un_jeu(titre: int) -> None:
    with pytest.raises(ValueError, match="jeu Switch"):
        fiche_switch("Jeu", titre)
    # Le jumeau: le jeu lui-même.
    assert fiche_switch("Jeu", JEU).titre == f"{JEU:016x}"
