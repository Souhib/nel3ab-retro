"""La page de dépôt: servie, autonome, et d'accord avec le serveur.

Le module de la page est exécuté sous Node, comme un module, sur les mêmes
fichiers que le serveur. L'empreinte rapide doit être IDENTIQUE: sans elle, un
fichier redéposé ne retrouverait jamais son envoi. L'estimation doit dire la
même console que le serveur partout où le début du fichier suffit.
"""

import json
import random
import re
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from nel3ab_control.imports.empreinte import empreinte_rapide
from nel3ab_control.imports.identifier import identifier
from tests.imports import fabrique as f

MIO = 1024 * 1024
RUNNER = Path(__file__).with_name("page_module.mjs")
NODE = shutil.which("node")
#: Node est là sur la machine et sur le lanceur de CI (la porte `front` en a
#: besoin). Sauté, et dit, ailleurs.
AVEC_NODE = pytest.mark.skipif(NODE is None, reason="node absent de cette machine")


async def test_la_page_de_depot_est_servie_garnie(client: httpx.AsyncClient) -> None:
    reponse = await client.get("/importer")

    assert reponse.status_code == 200
    assert reponse.headers["content-type"].startswith("text/html")
    page = reponse.text
    assert "Déposer un jeu" in page
    assert page.count('class="bob"') == 4, "la zone, puis loupe, tampon et repos dans le modèle"
    assert 'data-pose="loupe"' in page
    assert 'data-pose="salue"' in page
    assert "<!--BOBINE" not in page
    assert "/*__" not in page
    assert "@font-face" in page
    assert "export async function empreinteRapide" in page


async def test_la_page_ne_demande_rien_a_un_autre_site(client: httpx.AsyncClient) -> None:
    page = (await client.get("/importer")).text

    assert not re.findall(r"""(?:src|href|action)\s*=\s*["'](?!/|#|data:)""", page)
    assert not re.findall(r"url\(\s*['\"]?(?!data:)", page)
    assert not re.findall(r"""fetch\(\s*["'`](?!/|\$\{API)""", page)
    assert "https://" not in page.split("<script", 1)[1]


async def test_la_page_respecte_le_mouvement_reduit(client: httpx.AsyncClient) -> None:
    page = (await client.get("/importer")).text

    assert "@media (prefers-reduced-motion: reduce)" in page
    # Ce qui bouge ne bouge que par `transform` et `opacity`.
    for transition in re.findall(r"transition:\s*([^;]+);", page):
        for partie in transition.split(","):
            assert partie.split()[0] in ("opacity", "transform", "none"), transition


def test_la_page_n_est_pas_dans_le_contrat(app: FastAPI) -> None:
    assert "/importer" not in app.openapi()["paths"]


async def test_l_accueil_ne_montre_le_lien_qu_apres_avoir_demande_les_droits(
    client: httpx.AsyncClient,
) -> None:
    accueil = (await client.get("/")).text

    assert "/api/imports/droits" in accueil
    assert re.search(r'<a[^>]*id="importer"[^>]*hidden', accueil), "caché par défaut"


def ecrire(dossier: Path, nom: str, octets: bytes) -> Path:
    chemin = dossier / nom
    chemin.write_bytes(octets)
    return chemin


def executer_page(chemins: list[Path]) -> dict[str, dict]:
    assert NODE is not None
    fini = subprocess.run(  # noqa: S603 - node et un fichier du dépôt, aucun texte du dehors
        [NODE, str(RUNNER)],
        input=json.dumps([str(c) for c in chemins]),
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert fini.returncode == 0, fini.stderr
    return {rendu["chemin"]: rendu for rendu in json.loads(fini.stdout)}


@AVEC_NODE
def test_la_page_et_le_serveur_ont_la_meme_empreinte_rapide(tmp_path: Path) -> None:
    """Autour de chaque frontière: 4 Mio, 8 Mio, et un fichier d'un octet."""
    hasard = random.Random(1121)  # noqa: S311 - des octets d'essai, pas un secret
    tailles = [1, 100, 4 * MIO - 1, 4 * MIO, 4 * MIO + 1, 8 * MIO, 8 * MIO + 3, 9 * MIO + 7]
    chemins = [ecrire(tmp_path, f"{taille}.bin", hasard.randbytes(taille)) for taille in tailles]

    rendus = executer_page(chemins)

    for chemin in chemins:
        octets = chemin.read_bytes()
        attendu = empreinte_rapide(f.lecteur(octets), len(octets))
        assert rendus[str(chemin)]["empreinte"] == attendu, chemin.name


ACCORDS = {
    "gc.iso": f.iso_nintendo(wii=False),
    "wii.iso": f.iso_nintendo(wii=True),
    "gc.rvz": f.rvz(type_disque=1),
    "wii.rvz": f.rvz(type_disque=2),
    "inconnu.rvz": f.rvz(type_disque=7, wii=False),
    "wii.wia": f.rvz(type_disque=2, wia=True),
    "gc.ciso": f.ciso(f.entete_disque(wii=False)),
    "wii.wbfs": f.wbfs(f.entete_disque(wii=True)),
    "jeu.nsp": f.pfs0(["a.nca", "0100bde00862a0000000000000000004.tik"]),
    "jeu.nsz": f.pfs0(["a.ncz"]),
    "jeu.xci": f.xci(),
    "cle.xci": f.xci(zone_cle=True),
    "jeu.nup": b"NUP\x01" + b"\0" * 64,
    "jeu.xex": f.xex(1),
    "jeu.stfs": f.stfs(b"CON ", titre_id=1, type_contenu=0xD0000, nom="x"),
    "jeu.god": f.stfs(b"LIVE", titre_id=1, type_contenu=0x7000, nom="x"),
    "jeu.chd": f.chd(),
    "jeu.zip": b"PK\x03\x04" + b"\0" * 60,
    "jeu.7z": f.sept_zip([("a", b"a")]),
    "jeu.rar": b"Rar!\x1a\x07\x01\x00" + b"\0" * 20,
    "jeu.nes": f.nes(),
    "jeu.z64": f.n64("z64"),
    "jeu.v64": f.n64("v64"),
    "jeu.gb": f.game_boy(),
    "jeu.gbc": f.game_boy(couleur=0xC0),
    "faux.gb": f.game_boy(somme_fausse=True),
    "jeu.gba": f.gba(),
    "faux.gba": f.gba(complement_faux=True),
    "jeu.nds": f.nds(),
    "jeu.md": f.mega_drive(),
    "ps1.bin": f.iso9660(systeme="PLAYSTATION", boot="BOOT = cdrom:\\SLUS_005.94;1", brut=True),
    "autre.iso": f.iso9660(systeme="LINUX", boot=None),
    "texte.iso": f.texte(),
}

#: Là où la page ne peut PAS savoir, et le dit sans console: le serveur lira.
#: Chaque écart est voulu, et l'essai vérifie qu'il ne dit pas autre chose.
ECARTS = {"jeu.gcz": (None, "gcz"), "jeu.xiso": (None, "xiso")}


@AVEC_NODE
def test_l_estimation_de_la_page_dit_la_console_du_serveur(tmp_path: Path) -> None:
    chemins = [ecrire(tmp_path, nom, octets) for nom, octets in ACCORDS.items()]

    rendus = executer_page(chemins)

    for chemin in chemins:
        octets = chemin.read_bytes()
        serveur = identifier(f.lecteur(octets), len(octets))
        page = rendus[str(chemin)]
        assert (page["console"], page["format"]) == (serveur.console, serveur.format), chemin.name


@AVEC_NODE
def test_ce_que_la_page_ne_peut_pas_lire_elle_le_laisse_au_serveur(tmp_path: Path) -> None:
    xiso = f.Clairseme(taille=0x20000)
    for decalage, octets in f.xdvdfs("default.xex").items():
        xiso.poser(decalage, octets)
    fichiers = {
        "jeu.gcz": f.gcz(f.entete_disque(wii=False)),
        "jeu.xiso": xiso.lire(0, xiso.taille),
    }
    chemins = [ecrire(tmp_path, nom, octets) for nom, octets in fichiers.items()]

    rendus = executer_page(chemins)

    for chemin in chemins:
        page = rendus[str(chemin)]
        assert (page["console"], page["format"]) == ECARTS[chemin.name]
        octets = chemin.read_bytes()
        assert identifier(f.lecteur(octets), len(octets)).console is not None, (
            "le jumeau: le serveur, lui, sait"
        )
