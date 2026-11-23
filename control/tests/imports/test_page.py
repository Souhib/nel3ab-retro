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

import anyio
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
    assert page.count('class="bob"') == 5, (
        "la zone, puis loupe, tampon et repos dans le modèle, puis le trousseau"
    )
    assert 'id="cles"' in page and 'id="modele-personne"' in page
    assert 'data-pose="loupe"' in page
    assert 'data-pose="salue"' in page
    assert "<!--BOBINE" not in page
    assert "/*__" not in page
    assert "@font-face" in page
    assert "export async function empreinteRapide" in page


#: Une adresse CSS qui sortirait de la page. Permis: une adresse `data:`, avec
#: ou sans guillemets, et un renvoi `#id` à un élément de la page (le filtre de
#: l'écran bombé, ADR D37). Le premier motif laissait le guillemet facultatif
#: AVANT la garde: devant `url("data:…")`, il sautait le guillemet et la garde
#: voyait `"data:`, si bien qu'une adresse `data:` entre guillemets passait
#: pour une sortie (23 novembre 2026, la flèche de souris du thème rétro).
URL_SORTANTE = re.compile(r"""url\(\s*(?!['"]?(?:data:|#))""")


def test_le_garde_des_adresses_css_voit_une_sortie_et_laisse_la_page() -> None:
    """Les jumeaux du motif: ce qu'il doit voir, et ce qu'il doit laisser."""
    for sortie in ('url("https://x.test/a.png")', "url(//x.test/a)", "url( 'police.woff2')"):
        assert URL_SORTANTE.search(sortie), sortie
    for permis in (
        'url("data:image/svg+xml,%3Csvg")',
        "url(data:font/woff2;base64,AA)",
        'url("#rt-bombe")',
    ):
        assert not URL_SORTANTE.search(permis), permis


async def test_la_page_ne_demande_rien_a_un_autre_site(client: httpx.AsyncClient) -> None:
    page = (await client.get("/importer")).text

    assert not re.findall(r"""(?:src|href|action)\s*=\s*["'](?!/|#|data:)""", page)
    assert not URL_SORTANTE.findall(page)
    assert not re.findall(r"""fetch\(\s*["'`](?!/|\$\{API|\$\{CLES)""", page)
    assert 'const CLES = "/api/importeurs";' in page
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


TROUSSEAU = Path(__file__).with_name("trousseau_module.mjs")


@AVEC_NODE
def test_le_trousseau_nomme_range_et_colore_chaque_personne_toujours_pareil() -> None:
    """Les fonctions pures du trousseau, exécutées sous Node comme dans la page."""
    personnes = [
        {
            "login": "alice@github",
            "nom": "Alice A",
            "pseudo": None,
            "sources": ["tailnet"],
            "appareils": 2,
            "en_ligne": True,
            "partage": True,
            "droit": "aucun",
        },
        {
            "login": "vincent@example.com",
            "nom": "Vincent L",
            "pseudo": "Vince",
            "sources": ["tailnet", "salon"],
            "appareils": 1,
            "en_ligne": False,
            "partage": False,
            "droit": "nomme",
        },
        {
            "login": "parti@example.com",
            "nom": "",
            "pseudo": None,
            "sources": [],
            "appareils": 0,
            "en_ligne": False,
            "partage": False,
            "droit": "nomme",
        },
        {
            "login": "config@example.com",
            "nom": "",
            "pseudo": None,
            "sources": [],
            "appareils": 0,
            "en_ligne": False,
            "partage": False,
            "droit": "configuration",
        },
    ]
    assert NODE is not None
    sortie = subprocess.run(  # noqa: S603 - node et un fichier du dépôt, aucun texte du dehors
        [NODE, str(TROUSSEAU)],
        input=json.dumps(personnes),
        capture_output=True,
        text=True,
        check=True,
    )
    rendus = json.loads(sortie.stdout)

    assert [r["nom"] for r in rendus] == ["Alice A", "Vince", "parti", "config"]
    assert rendus[0]["puces"] == [
        ["INVITÉ PAR PARTAGE", False],
        ["EN LIGNE", True],
        ["2 APPAREILS", False],
    ]
    assert rendus[1]["puces"] == [["TAILNET", False], ["DÉJÀ VENU", False]]
    assert rendus[2]["puces"] == [["PLUS SUR LE TAILNET", False]]
    assert rendus[3]["puces"] == [["CONFIGURATION", False]]
    assert all(r["prise"] in (1, 2, 3, 4) for r in rendus)
    assert rendus[0]["prise"] == rendus[0]["prise_encore"], "la même adresse, la même couleur"
    assert sorted(rendus, key=lambda r: r["rang"])[0]["nom"] == "config", "la configuration d'abord"


# ── Les noms des consoles et ce qui se range, venus du manifeste ──────────────

NOMS = Path(__file__).with_name("noms_module.mjs")
MODULE = Path(__file__).resolve().parents[2] / "nel3ab_control/api/routes/importer.mjs"


def noms_de_la_page(page: str) -> str:
    """Le texte de l'élément `#noms-consoles`, tel que le navigateur le lira."""
    prise = re.search(
        r'<script type="application/json" id="noms-consoles">(.*?)</script>', page, re.DOTALL
    )
    assert prise, "la page ne porte pas les noms des consoles"
    return prise.group(1)


async def test_la_page_dit_ce_qui_se_range_d_apres_le_manifeste(client: httpx.AsyncClient) -> None:
    """« GameCube, Wii et jeux Switch » était écrit à la main, et périmé dès que
    la Xbox 360 a été rangée par l'import, le 21 novembre 2026."""
    # Le texte tel qu'il se lit, sans les retours à la ligne du source.
    page = " ".join((await client.get("/importer")).text.split())

    assert "GameCube, Wii et jeux Switch" not in page
    assert "Les jeux GameCube, Wii, Switch et Xbox 360 sont rangés tout de suite" in page
    # Le jumeau: la Switch 2 s'inscrit encore à la main, elle reste de côté.
    assert "Switch 2 sont" not in page and "Switch 2 et" not in page


async def test_la_page_porte_les_noms_du_manifeste_et_le_module_n_en_recopie_aucun(
    client: httpx.AsyncClient,
) -> None:
    from nel3ab_control.imports.destinations import noms

    page = (await client.get("/importer")).text
    lus = json.loads(noms_de_la_page(page))

    assert lus == noms()
    assert lus["x360"] == "Xbox 360"
    assert lus["switch2"] == "Switch 2"
    assert lus["n64"] == "Nintendo 64", "les consoles reconnues sans être servies aussi"
    module = MODULE.read_text(encoding="utf-8")
    for nom in lus.values():
        assert f'"{nom}"' not in module, f"{nom} est encore recopié dans importer.mjs"


def test_un_nom_qui_fermerait_le_script_est_echappe() -> None:
    from nel3ab_control.api.routes.importer import noms_en_json

    texte = noms_en_json({"x": "</script><script>alert(1)</script>"})

    assert "</" not in texte
    assert json.loads(texte) == {"x": "</script><script>alert(1)</script>"}


@AVEC_NODE
async def test_le_module_lit_les_noms_de_la_page_servie(client: httpx.AsyncClient) -> None:
    from nel3ab_control.imports.destinations import noms

    texte = noms_de_la_page((await client.get("/importer")).text)
    assert NODE is not None
    with anyio.fail_after(60):
        sortie = await anyio.run_process(
            [NODE, str(NOMS)], input=json.dumps([texte, None, "{", "[1, 2]", ""]).encode()
        )
    lus, absent, casse, liste, vide = json.loads(sortie.stdout)

    assert lus == noms()
    # Les jumeaux: sans élément ou avec un texte faux, aucun nom inventé; la carte
    # dit alors le code de la console.
    assert absent == casse == liste == vide == {}


@pytest.mark.parametrize(
    ("mots", "phrase"),
    [
        (["GameCube", "Wii", "Switch", "Xbox 360"], "GameCube, Wii, Switch et Xbox 360"),
        (["GameCube", "Wii"], "GameCube et Wii"),
        (["GameCube"], "GameCube"),
        # Un manifeste sans console rangée n'arrête pas le salon à son démarrage.
        ([], "d'aucune console"),
    ],
)
def test_la_liste_des_consoles_se_dit_comme_une_phrase(mots: list[str], phrase: str) -> None:
    from nel3ab_control.api.routes.importer import enumerer

    assert enumerer(mots) == phrase


# ── Le dépôt finit sur « Jouer maintenant » (audit P14) ───────────────────────

JOUER = Path(__file__).with_name("jouer_module.mjs")


@AVEC_NODE
async def test_jouer_maintenant_rejoint_une_salle_ouverte_sinon_en_ouvre_une() -> None:
    """La page disait « visible à la prochaine ouverture de salle », sans bouton.

    Avec une salle ouverte, on la rejoint: en allumer une seconde séparerait le
    groupe sur la même carte graphique. Sans salle, on en ouvre une, qui lit sa
    bibliothèque au démarrage et montre donc le jeu rangé. Le jumeau: un refus
    d'ouvrir ne mène nulle part et dit pourquoi.
    """
    ouverte = {"numero": 1, "ouverte": True, "redemarre": False, "chemin": "/r/1/"}
    fermee = {"numero": 2, "ouverte": False, "redemarre": False, "chemin": "/r/2/"}
    cas = [
        {"salles": {"status": 200, "corps": [fermee, ouverte]}, "ouvre": None},
        {
            "salles": {"status": 200, "corps": [fermee]},
            "ouvre": {"status": 201, "corps": {"chemin": "/r/2/"}},
        },
        {
            "salles": {"status": 200, "corps": [fermee]},
            "ouvre": {"status": 409, "corps": {"detail": "les deux emplacements sont pris"}},
        },
    ]
    assert NODE is not None
    with anyio.fail_after(60):
        sortie = await anyio.run_process([NODE, str(JOUER)], input=json.dumps(cas).encode())
    rejoint, ouvre, refuse = json.loads(sortie.stdout)

    assert rejoint["vers"] == "/r/1/?entrer=jouer"
    assert rejoint["faites"] == ["GET /api/salles"], (
        "une salle ouverte ne doit pas en ouvrir une autre"
    )
    assert ouvre["vers"] == "/r/2/?entrer=jouer"
    assert ouvre["faites"] == ["GET /api/salles", "POST /api/salles"]
    assert refuse["vers"] is None
    assert refuse["refus"] == "les deux emplacements sont pris"


@AVEC_NODE
async def test_jouer_maintenant_rejoint_une_salle_qui_redemarre() -> None:
    """Une salle qui redémarre pour un changement de jeu vaut ouverte=false,
    redemarre=true (`api/schemas/salle.py`). La première version en ouvrait une
    seconde: un autre émulateur sur la carte graphique commune, et le groupe
    séparé (relecture du 22 novembre 2026). Le jumeau: une salle fermée seule
    s'ouvre toujours.
    """
    redemarre = {"numero": 1, "ouverte": False, "redemarre": True, "chemin": "/r/1/"}
    fermee = {"numero": 2, "ouverte": False, "redemarre": False, "chemin": "/r/2/"}
    cas = [
        {"salles": {"status": 200, "corps": [redemarre, fermee]}, "ouvre": None},
        {
            "salles": {"status": 200, "corps": [fermee]},
            "ouvre": {"status": 201, "corps": {"chemin": "/r/2/"}},
        },
    ]
    assert NODE is not None
    with anyio.fail_after(60):
        sortie = await anyio.run_process([NODE, str(JOUER)], input=json.dumps(cas).encode())
    rejoint, ouvre = json.loads(sortie.stdout)
    assert rejoint["vers"] == "/r/1/?entrer=jouer"
    assert rejoint["faites"] == ["GET /api/salles"]
    assert ouvre["faites"] == ["GET /api/salles", "POST /api/salles"]


@AVEC_NODE
async def test_le_bouton_dit_ce_qu_il_fait() -> None:
    """« Jouer maintenant » menait dans une salle déjà ouverte, dont le menu ne
    montre pas encore le jeu déposé: le worker lit sa bibliothèque au démarrage
    seulement. Avec une salle à rejoindre, le bouton la nomme et dit quand le
    jeu apparaîtra; sans salle, il garde « Jouer maintenant », puisqu'une salle
    qu'on ouvre lit le jeu au démarrage.
    """
    ouverte = {"numero": 1, "ouverte": True, "redemarre": False, "chemin": "/r/1/"}
    redemarre = {"numero": 3, "ouverte": False, "redemarre": True, "chemin": "/r/3/"}
    fermee = {"numero": 2, "ouverte": False, "redemarre": False, "chemin": "/r/2/"}
    assert NODE is not None
    cas = [[fermee, ouverte], [redemarre], [fermee], "pas une liste"]
    with anyio.fail_after(60):
        sortie = await anyio.run_process(
            [NODE, str(JOUER), "--libelle"], input=json.dumps(cas).encode()
        )
    salle1, salle3, aucune, illisible = json.loads(sortie.stdout)
    assert salle1 == {
        "texte": "Aller dans la salle 1",
        "note": "Le jeu apparaîtra au prochain changement de jeu.",
    }
    assert salle3["texte"] == "Aller dans la salle 3"
    assert aucune == {"texte": "Jouer maintenant", "note": ""}
    assert illisible == {"texte": "Jouer maintenant", "note": ""}


async def test_un_jeu_range_propose_de_jouer(client: httpx.AsyncClient) -> None:
    """Le bouton existe dans le modèle de carte, caché tant que rien n'est rangé."""
    page = (await client.get("/importer")).text
    assert (
        '<button type="button" class="jouer" data-ici="jouer" hidden>Jouer maintenant</button>'
        in page
    )
    module = MODULE.read_text(encoding="utf-8")
    assert 'this.ici("jouer").hidden = !range;' in module
