"""Une archive s'ouvre entrée par entrée, ou pas du tout.

Les archives sont fabriquées ici: `zipfile` pour le zip, et `fabrique.sept_zip`
pour un 7z écrit à la main, que les vrais `lsar` et `unar` lisent.
"""

import io
import stat
import struct
import zipfile
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from nel3ab_control.api.controllers.imports import ImportsController
from nel3ab_control.imports import archives
from nel3ab_control.imports.archives import ArchiveRefusee, lister_zip, nom_dangereux
from tests.imports import fabrique as f
from tests.imports.protocole import annoncer, envoyer, finir, quarantaine

GC = f.iso_nintendo(wii=False, identifiant="GALE01", titre="Super Essai Melee") + b"\x5a" * 0x800
WII = f.iso_nintendo(wii=True, identifiant="RMCP01", titre="Essai Kart Wii") + b"\x33" * 0x800

OUTILS = archives.Outils.trouver()
#: Le chemin réel par `lsar` et `unar`. Sauté, et dit, là où ils manquent:
#: c'est le cas du lanceur de CI, pas celui de la machine qui héberge le salon.
AVEC_OUTILS = pytest.mark.skipif(OUTILS is None, reason="lsar et unar absents de cette machine")


def zip_de(entrees: list[tuple[str, bytes]], *, compresse: bool = True) -> bytes:
    tampon = io.BytesIO()
    methode = zipfile.ZIP_DEFLATED if compresse else zipfile.ZIP_STORED
    with zipfile.ZipFile(tampon, "w", methode) as archive:
        for nom, octets in entrees:
            archive.writestr(nom, octets)
    return tampon.getvalue()


@pytest.fixture
def roms(app: FastAPI) -> Path:
    for dossier in app.state.settings.rom_dir.split(":"):
        Path(dossier).mkdir(parents=True, exist_ok=True)
    return Path(app.state.settings.rom_dir.split(":")[0]).parent


@pytest.fixture
def imports(app: FastAPI) -> ImportsController:
    controleur: ImportsController = app.state.imports
    return controleur


async def deposer(
    client: httpx.AsyncClient, imports: ImportsController, octets: bytes, nom: str
) -> dict:
    ident = (await annoncer(client, octets, nom=nom)).json()["id"]
    await envoyer(client, ident, octets, morceau=0x1000)
    return await finir(client, imports, ident)


def contenu(app: FastAPI, ident: str) -> list[str]:
    dossier = quarantaine(app) / ident / "contenu"
    return sorted(p.name for p in dossier.iterdir()) if dossier.exists() else []


# ── Les noms ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "nom",
    ["../x.iso", "a/../../x", "/etc/passwd", "..\\x.iso", "C:\\jeux\\x.iso", "C:x", "", "a\0b"],
)
def test_un_nom_qui_sort_de_son_dossier_est_dangereux(nom: str) -> None:
    assert nom_dangereux(nom)


@pytest.mark.parametrize("nom", ["Jeu.iso", "dossier/Jeu.iso", "Zelda: Wind Waker.iso", "a..b"])
def test_un_nom_ordinaire_ne_l_est_pas(nom: str) -> None:
    assert not nom_dangereux(nom)


# ── La liste d'un zip ──────────────────────────────────────────────────────


def lister(octets: bytes, budget: int = 1 << 30) -> list[archives.Entree]:
    with zipfile.ZipFile(io.BytesIO(octets)) as archive:
        return lister_zip(archive, budget)


def test_un_zip_ordinaire_donne_ses_fichiers_sans_ses_dossiers() -> None:
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w") as archive:
        archive.mkdir("jeux")
        archive.writestr("jeux/a.iso", GC)
    entrees = lister(tampon.getvalue())

    assert [(e.nom, e.taille) for e in entrees] == [("jeux/a.iso", len(GC))]


def test_un_zip_avec_une_remontee_est_refuse_en_entier() -> None:
    with pytest.raises(ArchiveRefusee, match="sortirait"):
        lister(zip_de([("bon.iso", GC), ("../../.bashrc", b"x")]))


def test_un_zip_avec_un_chemin_absolu_est_refuse() -> None:
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w") as archive:
        info = zipfile.ZipInfo("x")
        info.filename = "/etc/cron.d/x"
        archive.writestr(info, b"x")

    with pytest.raises(ArchiveRefusee, match="sortirait"):
        lister(tampon.getvalue())


def test_un_zip_avec_un_lien_est_refuse() -> None:
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w") as archive:
        info = zipfile.ZipInfo("lien")
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, "/etc/passwd")

    with pytest.raises(ArchiveRefusee, match="lien"):
        lister(tampon.getvalue())


def test_un_zip_chiffre_est_refuse() -> None:
    """`zipfile` n'écrit pas d'entrée chiffrée: le drapeau est posé à la main."""
    tampon = bytearray(zip_de([("secret.iso", b"x")]))
    for signature, decalage in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        a = tampon.index(signature) + decalage
        struct.pack_into("<H", tampon, a, struct.unpack_from("<H", tampon, a)[0] | 0x1)

    with pytest.raises(ArchiveRefusee, match="chiffrée"):
        lister(bytes(tampon))


def test_soixante_quatre_entrees_passent_et_pas_soixante_cinq() -> None:
    assert len(lister(zip_de([(f"{i}.bin", b"x") for i in range(64)]))) == 64
    with pytest.raises(ArchiveRefusee, match="65 entrées"):
        lister(zip_de([(f"{i}.bin", b"x") for i in range(65)]))


def test_un_zip_qui_depasse_le_budget_une_fois_extrait_est_refuse() -> None:
    octets = zip_de([("a.bin", b"\0" * 1000), ("b.bin", b"\0" * 1000)])

    assert len(lister(octets, budget=2000)) == 2
    with pytest.raises(ArchiveRefusee, match="budget"):
        lister(octets, budget=1999)


def mentir_sur_la_taille(octets: bytes, vraie: int, annoncee: int) -> bytes:
    """Écrit une taille décompressée plus petite dans les deux en-têtes du zip."""
    tampon = bytearray(octets)
    for signature, decalage in ((b"PK\x03\x04", 22), (b"PK\x01\x02", 24)):
        a = tampon.index(signature)
        assert struct.unpack_from("<I", tampon, a + decalage)[0] == vraie
        struct.pack_into("<I", tampon, a + decalage, annoncee)
    return bytes(tampon)


# ── De bout en bout ────────────────────────────────────────────────────────


async def test_un_zip_qui_contient_un_jeu_le_range_et_garde_le_reste(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    octets = zip_de([("Jeu (Europe).iso", GC), ("lisez-moi.txt", f.texte())])

    fini = await deposer(client, imports, octets, "jeu.zip")

    etats = [(e["nom"], e["console"], e["etat"]) for e in fini["elements"]]
    assert etats == [("Jeu (Europe).iso", "gc", "range"), ("lisez-moi.txt", None, "inconnu")]
    assert (roms / "gc" / "Super Essai Melee.iso").read_bytes() == GC
    ident = fini["id"]
    assert not (quarantaine(app) / ident / "fichier").exists(), "l'archive est retirée"
    assert contenu(app, ident) == ["2"], "seul le fichier inconnu reste en quarantaine"


async def test_un_zip_qui_remonte_reste_en_quarantaine_sans_rien_extraire(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    octets = zip_de([("Jeu.iso", GC), ("../../Jeu.iso", GC)])

    fini = await deposer(client, imports, octets, "jeu.zip")

    [element] = fini["elements"]
    assert element["etat"] == "refuse"
    assert "sortirait" in element["message"]
    assert (quarantaine(app) / fini["id"] / "fichier").read_bytes() == octets
    assert contenu(app, fini["id"]) == []
    assert not list((roms / "gc").iterdir())


async def test_une_entree_qui_ment_sur_sa_taille_arrete_tout_et_efface_le_reste(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    octets = mentir_sur_la_taille(zip_de([("b.iso", GC)]), len(GC), 100)

    fini = await deposer(client, imports, octets, "bombe.zip")

    [element] = fini["elements"]
    assert element["etat"] == "refuse"
    assert contenu(app, fini["id"]) == []
    assert not list((roms / "gc").iterdir())


async def test_une_archive_dans_l_archive_n_est_pas_ouverte(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path
) -> None:
    octets = zip_de([("dedans.zip", zip_de([("Jeu.iso", GC)]))])

    fini = await deposer(client, imports, octets, "poupee.zip")

    assert fini["elements"][0]["etat"] == "archive-non-prise-en-charge"
    assert not list((roms / "gc").iterdir())


async def test_une_archive_qui_ferait_passer_le_disque_sous_la_marge_est_refusee(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    octets = zip_de([("Jeu.iso", GC)])
    ident = (await annoncer(client, octets, nom="jeu.zip")).json()["id"]
    await envoyer(client, ident, octets, morceau=0x1000)
    app.state.settings.imports_marge = 10**6
    imports.espace_libre = lambda chemin: 10**6 + len(GC) - 1

    fini = await finir(client, imports, ident)

    assert fini["elements"][0]["etat"] == "refuse"
    assert "pas assez de place" in fini["elements"][0]["message"]


async def test_un_7z_sans_lsar_ni_unar_reste_en_quarantaine(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    imports.outils = lambda: None
    octets = f.sept_zip([("Jeu.iso", GC)])

    fini = await deposer(client, imports, octets, "jeu.7z")

    [element] = fini["elements"]
    assert (element["format"], element["etat"], element["libelle"]) == (
        "7z",
        "archive-non-prise-en-charge",
        "archive non prise en charge",
    )
    assert (quarantaine(app) / fini["id"] / "fichier").read_bytes() == octets


def test_sans_lsar_ou_sans_unar_les_outils_sont_absents() -> None:
    chemins = {"lsar": "/usr/bin/lsar", "unar": None}

    assert archives.Outils.trouver(chemins.get) is None
    chemins["unar"] = "/usr/bin/unar"
    trouves = archives.Outils.trouver(chemins.get)
    assert trouves is not None
    assert trouves.doux == ()


@AVEC_OUTILS
async def test_un_7z_passe_par_lsar_et_unar_et_range_son_jeu(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    octets = f.sept_zip([("Jeu.iso", GC), ("Essai Kart.iso", WII)])

    fini = await deposer(client, imports, octets, "jeux.7z")

    assert [(e["console"], e["etat"]) for e in fini["elements"]] == [
        ("gc", "range"),
        ("wii", "range"),
    ]
    assert (roms / "gc" / "Super Essai Melee.iso").read_bytes() == GC
    assert (roms / "wii" / "Essai Kart Wii.iso").read_bytes() == WII
    assert not (quarantaine(app) / fini["id"] / "fichier").exists()


@AVEC_OUTILS
async def test_un_7z_qui_remonte_est_refuse_par_sa_liste(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    octets = f.sept_zip([("Jeu.iso", GC), ("../../evasion.iso", GC)])

    fini = await deposer(client, imports, octets, "jeux.7z")

    assert fini["elements"][0]["etat"] == "refuse"
    assert contenu(app, fini["id"]) == []
    assert not list((roms / "gc").iterdir())
