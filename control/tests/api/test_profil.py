"""Le carnet de jeu: quatre lectures, à son nom et au sien seul.

Les lignes du journal sont écrites avec leur heure, par le vrai `Parties`, puis
relues par les routes: c'est le chemin du salon. Les sauvegardes sont de vrais
dossiers jetables, aux noms que le worker leur donne.
"""

import json
import os
import re
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

import anyio
import httpx
import pytest
from fastapi import FastAPI

from nel3ab_control.catalogue import NAME
from nel3ab_control.parties import JeuJoue, Parties
from nel3ab_control.personnes import dossier_personnel, empreinte
from nel3ab_control.settings import Settings
from tests.conftest import SOUHIB, VINCENT

ALICE = {"Tailscale-User-Login": "alice@example.com", "Tailscale-User-Name": "Alice"}
BENOIT = {"Tailscale-User-Login": "benoit@example.com", "Tailscale-User-Name": "Benoit"}
ROUTES = ["/api/me/profil", "/api/me/jeux", "/api/me/parties", "/api/me/sauvegardes"]
MARIO = {"cle": "Mario Kart Double Dash.rvz", "console": "gc", "titre": "Mario Kart Double Dash"}
TENNIS = {"cle": "Mario Tennis Aces.nsp", "console": "switch", "titre": "Mario Tennis Aces"}
#: Une soirée passée: les places « en cours » commencent maintenant, donc après elle.
SOIR = datetime(2026, 11, 14, 20, 0, tzinfo=UTC)


def place(
    parties: Parties,
    login: str,
    ident: str,
    debut: datetime,
    secondes: float | None,
    jeu: dict | None = MARIO,
    lance: tuple[str, str] | None = None,
    sauvegarde: str = "lanceur",
    salle: int = 1,
) -> None:
    """Une place au journal, telle que la tablée l'écrit. Sans fin si `secondes` est rien."""
    parties.ecrire(
        login,
        "place_debut",
        quand=debut,
        id=ident,
        salle=salle,
        place=1,
        jeu=jeu,
        lance={"empreinte": empreinte(lance[0]), "pseudo": lance[1]} if lance else None,
        sauvegarde=sauvegarde,
    )
    if secondes is not None:
        parties.ecrire(
            login,
            "place_fin",
            quand=debut + timedelta(seconds=secondes),
            id=ident,
            salle=salle,
            secondes=secondes,
            raison="deconnectee",
        )


@pytest.fixture
def parties(app: FastAPI) -> Parties:
    return app.state.parties


async def test_sans_identite_chaque_lecture_refuse(client: httpx.AsyncClient) -> None:
    for route in ROUTES:
        reponse = await client.get(route)
        assert reponse.status_code == 401, route


async def test_avec_identite_chaque_lecture_repond(client: httpx.AsyncClient) -> None:
    """Le jumeau: un carnet vide est un carnet, pas une erreur."""
    for route in ROUTES:
        reponse = await client.get(route, headers=ALICE)
        assert reponse.status_code == 200, (route, reponse.text)
    profil = (await client.get("/api/me/profil", headers=ALICE)).json()
    assert profil["pseudo"] == "Alice"
    assert (profil["jeux"], profil["parties"], profil["secondes"]) == (0, 0, 0)
    assert profil["depuis"] is None


def test_aucune_lecture_ne_prend_d_adresse_en_parametre(app: FastAPI) -> None:
    """Personne ne peut demander le carnet d'un autre: il n'y a rien à demander."""
    chemins = app.openapi()["paths"]
    for route in ROUTES:
        parametres = chemins[route]["get"].get("parameters", [])
        noms = {parametre["name"] for parametre in parametres}
        assert noms <= {"avant", "limite"}, (route, noms)
    assert "/profil" not in chemins


async def test_un_parametre_d_adresse_glisse_dans_la_demande_est_ignore(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    place(parties, "benoit@example.com", "b" * 16, SOIR, 600)
    for nom in ("login", "qui", "salle"):
        reponse = await client.get(f"/api/me/jeux?{nom}=benoit@example.com", headers=ALICE)
        assert reponse.status_code == 200
        assert reponse.json() == []
    # Le jumeau: Benoît, lui, voit son jeu.
    assert len((await client.get("/api/me/jeux", headers=BENOIT)).json()) == 1


async def test_deux_adresses_au_meme_nom_lisible_et_au_meme_pseudo_ne_se_voient_pas(
    client: httpx.AsyncClient, app: FastAPI, parties: Parties, settings: Settings
) -> None:
    plus = {"Tailscale-User-Login": "alex+test@example.com", "Tailscale-User-Name": "Alex"}
    tiret = {"Tailscale-User-Login": "alex-test@example.com", "Tailscale-User-Name": "Alex"}
    place(parties, "alex+test@example.com", "1" * 16, SOIR, 600)
    place(parties, "alex-test@example.com", "2" * 16, SOIR, 60, jeu=TENNIS)
    sauvegarde(settings, "alex+test@example.com", "mario-kart-double-dash-rvz")

    vu_plus = (await client.get("/api/me/jeux", headers=plus)).json()
    vu_tiret = (await client.get("/api/me/jeux", headers=tiret)).json()
    assert [jeu["titre"] for jeu in vu_plus] == ["Mario Kart Double Dash"]
    assert [jeu["titre"] for jeu in vu_tiret] == ["Mario Tennis Aces"]
    assert len((await client.get("/api/me/sauvegardes", headers=plus)).json()) == 1
    assert (await client.get("/api/me/sauvegardes", headers=tiret)).json() == []


async def test_joue_chez_quelqu_un_n_est_pas_une_sauvegarde_a_soi(
    client: httpx.AsyncClient, parties: Parties, settings: Settings
) -> None:
    """Décision du 21 novembre 2026: la sauvegarde est à qui a lancé."""
    benoit = ("benoit@example.com", "Benoît")
    parties.ecrire(
        "benoit@example.com",
        "lancement",
        quand=SOIR,
        salle=1,
        jeu=MARIO,
        emplacement="reprendre",
        sauvegarde="lanceur",
    )
    place(parties, "benoit@example.com", "b" * 16, SOIR, 3600, lance=benoit)
    place(parties, "alice@example.com", "a" * 16, SOIR, 3000, lance=benoit)
    sauvegarde(settings, "benoit@example.com", "mario-kart-double-dash-rvz")

    alice = (await client.get("/api/me/jeux", headers=ALICE)).json()
    assert len(alice) == 1
    assert alice[0]["chez"] == [{"pseudo": "Benoît", "parties": 1, "secondes": 3000}]
    assert alice[0]["sauvegarde"] is None
    assert alice[0]["lancements"] == 0
    partie = (await client.get("/api/me/parties", headers=ALICE)).json()["parties"][0]
    assert (partie["sauvegarde"], partie["lance_par"]) == ("du_lanceur", "Benoît")
    assert (await client.get("/api/me/sauvegardes", headers=ALICE)).json() == []

    # Le jumeau: chez Benoît, c'est sa sauvegarde, et elle est sur sa carte.
    lui = (await client.get("/api/me/jeux", headers=BENOIT)).json()
    assert lui[0]["chez"] == []
    assert lui[0]["lancements"] == 1
    assert lui[0]["sauvegarde"]["octets"] == len(b"progression")
    sienne = (await client.get("/api/me/parties", headers=BENOIT)).json()["parties"][0]
    assert (sienne["sauvegarde"], sienne["lance_par"]) == ("mienne", None)


async def test_tout_debloque_est_commun_meme_lance_par_un_autre(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    place(
        parties,
        "alice@example.com",
        "a" * 16,
        SOIR,
        900,
        lance=("benoit@example.com", "Benoît"),
        sauvegarde="commune",
    )
    jeu = (await client.get("/api/me/jeux", headers=ALICE)).json()[0]
    assert jeu["chez"] == []
    assert jeu["communes"] == 1
    partie = (await client.get("/api/me/parties", headers=ALICE)).json()["parties"][0]
    assert (partie["sauvegarde"], partie["lance_par"]) == ("commune", "Benoît")


async def test_les_places_de_suite_font_une_partie_et_deux_onglets_ne_comptent_pas_double(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    alice = "alice@example.com"
    # Une reconnexion de trente secondes: la même partie.
    place(parties, alice, "1" * 16, SOIR, 600)
    place(parties, alice, "2" * 16, SOIR + timedelta(seconds=630), 300)
    # Un deuxième onglet ouvert pendant la place 2: rien de plus.
    place(parties, alice, "3" * 16, SOIR + timedelta(seconds=700), 100)
    # Dix minutes plus tard: une autre partie.
    place(parties, alice, "4" * 16, SOIR + timedelta(seconds=1530), 60)

    reponse = (await client.get("/api/me/parties", headers=ALICE)).json()["parties"]
    assert [(partie["id"], partie["secondes"]) for partie in reponse] == [
        ("4" * 16, 60),
        ("1" * 16, 900),
    ]
    profil = (await client.get("/api/me/profil", headers=ALICE)).json()
    assert (profil["parties"], profil["secondes"], profil["jeux"]) == (2, 960, 1)


async def test_un_autre_jeu_entre_deux_places_coupe_la_partie(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    alice = "alice@example.com"
    place(parties, alice, "1" * 16, SOIR, 600)
    place(parties, alice, "2" * 16, SOIR + timedelta(seconds=610), 10, jeu=TENNIS)
    place(parties, alice, "3" * 16, SOIR + timedelta(seconds=630), 60)
    reponse = (await client.get("/api/me/parties", headers=ALICE)).json()["parties"]
    assert [partie["titre"] for partie in reponse] == [
        "Mario Kart Double Dash",
        "Mario Tennis Aces",
        "Mario Kart Double Dash",
    ]


async def test_le_menu_n_est_pas_une_partie(client: httpx.AsyncClient, parties: Parties) -> None:
    place(parties, "alice@example.com", "1" * 16, SOIR, 600, jeu=None)
    assert (await client.get("/api/me/parties", headers=ALICE)).json()["parties"] == []
    profil = (await client.get("/api/me/profil", headers=ALICE)).json()
    assert profil["jeux"] == 0
    # La ligne compte quand même pour « depuis quand »: c'est une visite.
    assert profil["depuis"] is not None


async def test_une_fin_jamais_vue_reste_inconnue_et_une_place_ouverte_est_en_cours(
    client: httpx.AsyncClient, app: FastAPI, parties: Parties
) -> None:
    place(parties, "alice@example.com", "1" * 16, SOIR, None)
    partie = (await client.get("/api/me/parties", headers=ALICE)).json()["parties"][0]
    assert (partie["complete"], partie["secondes"], partie["fin"], partie["en_cours"]) == (
        False,
        0,
        None,
        False,
    )
    assert (await client.get("/api/me/profil", headers=ALICE)).json()["inconnues"] == 1

    # Le jumeau: une place tenue en ce moment dans une salle est en cours, avec
    # son temps déjà écoulé, et la place d'avant reste inconnue.
    rooms = app.state.salons.pour(1)
    rooms.tablee.jeu(JeuJoue(cle=MARIO["cle"], console="gc", titre=MARIO["titre"]))
    rooms.claim(2, "sid-alice", "Alice", login="alice@example.com")
    recentes = (await client.get("/api/me/parties", headers=ALICE)).json()["parties"]
    assert [(partie["en_cours"], partie["complete"]) for partie in recentes] == [
        (True, True),
        (False, False),
    ]
    assert recentes[0]["fin"] is None
    jeux = (await client.get("/api/me/jeux", headers=ALICE)).json()
    assert [jeu["en_cours"] for jeu in jeux] == [True]
    assert (await client.get("/api/me/profil", headers=ALICE)).json()["inconnues"] == 1


async def test_les_parties_se_lisent_par_pages(client: httpx.AsyncClient, parties: Parties) -> None:
    for rang in range(5):
        debut = SOIR + timedelta(hours=rang)
        place(parties, "alice@example.com", f"{rang:016x}", debut, 60)
    vues: list[str] = []
    avant = None
    pages = 0
    while True:
        adresse = "/api/me/parties?limite=2" + (f"&avant={avant}" if avant else "")
        page = (await client.get(adresse, headers=ALICE)).json()
        vues.extend(partie["id"] for partie in page["parties"])
        pages += 1
        avant = page["suivant"]
        if avant is None:
            break
    assert pages == 3
    assert vues == [f"{rang:016x}" for rang in reversed(range(5))]


@pytest.mark.parametrize(
    ("requete", "attendu"),
    [
        ("limite=0", 422),
        ("limite=101", 422),
        ("limite=1", 200),
        ("limite=100", 200),
        ("avant=pas-un-curseur", 422),
        (f"avant={'f' * 16}", 422),
    ],
)
async def test_les_bornes_de_la_pagination(
    client: httpx.AsyncClient, parties: Parties, requete: str, attendu: int
) -> None:
    place(parties, "alice@example.com", "1" * 16, SOIR, 60)
    reponse = await client.get(f"/api/me/parties?{requete}", headers=ALICE)
    assert reponse.status_code == attendu, reponse.text


def sauvegarde(settings: Settings, login: str, jeu: str) -> Path:
    """Une sauvegarde Dolphin personnelle, au nom que le worker lui donne."""
    nom = dossier_personnel(login)
    assert nom is not None
    dossier = settings.personal_save_root / jeu / nom
    dossier.mkdir(parents=True)
    (dossier / "01-GM4E-MarioKart.gci").write_bytes(b"progression")
    return dossier


def switch(settings: Settings, login: str, titre: str, famille: str = "switch") -> Path:
    racine = settings.personal_save_root.parent / f"etat-{famille}"
    config = settings.switch_config if famille == "switch" else settings.switch2_config
    config.write_text(json.dumps({"state": str(racine)}))
    nom = dossier_personnel(login)
    assert nom is not None
    return racine / titre / nom


async def test_les_sauvegardes_viennent_du_disque_sans_rien_ouvrir(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    alice = "alice@example.com"
    gc = sauvegarde(settings, alice, "mario-kart-double-dash-rvz")
    os.utime(gc / "01-GM4E-MarioKart.gci", (1_763_000_000, 1_763_000_000))
    historique = gc.parent / "history"
    historique.mkdir()
    for suffixe in ("1763000000000000001", "1763000000000000002"):
        (historique / f"{gc.name}-{suffixe}").mkdir()
    # Ni la version d'un autre, ni un nom qui n'en est pas une.
    (historique / f"{dossier_personnel('benoit@example.com')}-1").mkdir()
    (historique / f"{gc.name}-copie").mkdir()
    # Un ancien emplacement d'avant l'empreinte n'appartient à personne.
    (gc.parent / "joueur-alice-example-com").mkdir()
    (settings.salles_dir / "1").mkdir(parents=True)
    (settings.salles_dir / "1" / NAME).write_text(
        json.dumps(
            {
                "version": 1,
                "scanned_ms": 1,
                "roms": [
                    {
                        "name": "Mario Kart: Double Dash!!",
                        "maker": None,
                        "about": None,
                        "art": False,
                        "console": "gc",
                        "key": "Mario Kart Double Dash.rvz",
                    }
                ],
            }
        )
    )

    tennis = switch(settings, alice, "0100bde00862a000")
    partie = tennis / "data/bis/user/save/0000000000000001/0"
    partie.mkdir(parents=True)
    (partie / "save.dat").write_bytes(b"x" * 1000)
    # Un tube nommé DANS la partie: un lecteur qui l'ouvrirait attendrait pour toujours.
    os.mkfifo(tennis / "data/bis/user/flux.h264")
    os.mkfifo(tennis / "full.h264")
    # Un lien vers un gros fichier hors de la partie n'est pas suivi.
    gros = settings.personal_save_root.parent / "gros"
    gros.write_bytes(b"y" * 5000)
    (tennis / "data/bis/user/lien").symlink_to(gros)
    # Le système émulé, hors du sous-arbre sauvegardé, ne compte pas.
    (tennis / "data/system").mkdir(parents=True)
    (tennis / "data/system/firmware.bin").write_bytes(b"z" * 9000)
    for copie in ("20260913T191500", "20260913T201500"):
        (tennis / "backups" / copie).mkdir(parents=True)

    vues = (await client.get("/api/me/sauvegardes", headers=ALICE)).json()
    par_titre = {vue["titre"]: vue for vue in vues}
    assert set(par_titre) == {"Mario Kart: Double Dash!!", "0100BDE00862A000"}
    mario = par_titre["Mario Kart: Double Dash!!"]
    assert (mario["relie"], mario["console"]["code"]) == (True, "gc")
    # D19: la clé du jeu, pour savoir si « ma sauvegarde » existe pour lui.
    assert mario["cle"] == "Mario Kart Double Dash.rvz"
    assert mario["sauvegarde"]["versions"] == 2
    assert mario["sauvegarde"]["octets"] == len(b"progression")
    assert mario["sauvegarde"]["derniere_ecriture"].startswith("2025-11-13")
    switch_vue = par_titre["0100BDE00862A000"]
    assert (switch_vue["relie"], switch_vue["console"]["code"]) == (False, "switch")
    assert switch_vue["cle"] is None, "pas relié: pas de clé"
    assert switch_vue["sauvegarde"]["octets"] == 1000
    assert switch_vue["sauvegarde"]["copies"] == 2


async def test_rien_ne_sort_qui_dise_une_adresse_un_chemin_ou_un_dossier(
    client: httpx.AsyncClient, parties: Parties, settings: Settings
) -> None:
    place(parties, "alice@example.com", "a" * 16, SOIR, 600, lance=("benoit@example.com", "Benoît"))
    sauvegarde(settings, "alice@example.com", "mario-kart-double-dash-rvz")
    tout = ""
    for route in ROUTES:
        tout += (await client.get(route, headers=ALICE)).text
    assert "@" not in tout
    assert str(settings.personal_save_root.parent) not in tout
    assert "joueur-" not in tout
    assert empreinte("benoit@example.com") not in tout
    assert empreinte("alice@example.com") not in tout
    assert not re.search(r"[0-9a-f]{64}", tout)


async def test_le_carnet_est_servi_sans_identite_et_sans_rien_demander_ailleurs(
    client: httpx.AsyncClient,
) -> None:
    reponse = await client.get("/profil", headers={})
    assert reponse.status_code == 200
    assert reponse.headers["content-type"].startswith("text/html")
    page = reponse.text
    assert "<!--BOBINE" not in page
    assert "/*__BOBINE__*/" not in page
    assert "/*__POLICES__*/" not in page
    assert "@font-face" in page
    # Le tableau des dernières parties remplace l'étagère, les tambours et
    # Bobine (ADR D41, 24 novembre 2026).
    assert 'class="scores rt-scores"' in page
    for parti in ('id="tambours"', 'id="etagere"', 'class="bob', 'class="bulle"'):
        assert parti not in page, parti
    # Aucune requête vers une autre machine: ni police, ni image, ni script.
    assert not re.search(r"""(src|href)=["']?(https?:)?//""", page)
    assert "url(http" not in page
    # Il demande ses données au salon, et à lui seul.
    for route in ("/api/me/profil", "/api/me/sauvegardes", "/api/me/parties"):
        assert route in page


async def test_le_carnet_ne_nomme_pas_le_service_quand_il_se_tait(
    client: httpx.AsyncClient,
) -> None:
    """La charte de la page (front/src/lib/mots.ts): l'effet, puis l'action.

    « Le salon ne répond pas. » nommait un programme que le visiteur ne connaît
    pas; la page de la salle l'avait retiré, le carnet le gardait (vérification
    finale du 22 novembre 2026).
    """
    page = (await client.get("/profil", headers={})).text
    assert "salon ne répond" not in page
    # Le jumeau: le message existe toujours, en mots du visiteur.
    assert "Pas de réponse. Recharge la page dans un instant." in page


async def test_l_accueil_mene_au_carnet_les_visiteurs_identifies(client: httpx.AsyncClient) -> None:
    page = (await client.get("/")).text
    assert 'href="/profil"' in page
    assert 'fetch("/api/me"' in page


async def test_deux_personnes_deux_carnets_par_les_entetes_du_proxy(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    """Avec les identités communes des essais, pour le pseudo choisi par le salon."""
    place(parties, "souhib@example.com", "1" * 16, SOIR, 120)
    assert (await client.get("/api/me/profil", headers=SOUHIB)).json()["parties"] == 1
    assert (await client.get("/api/me/profil", headers=VINCENT)).json()["parties"] == 0


@pytest.mark.parametrize(
    ("title_id", "relie"),
    [
        ("0100bde00862a000", True),
        # Les jumeaux: un identifiant mal formé ne relie rien, et ne fait pas
        # tomber le jeu du catalogue.
        ("0100BDE00862A000", False),
        ("../0100bde00862a0", False),
        (None, False),
    ],
)
async def test_une_sauvegarde_switch_porte_le_nom_du_jeu_que_le_catalogue_publie(
    client: httpx.AsyncClient, settings: Settings, title_id: str | None, relie: bool
) -> None:
    alice = "alice@example.com"
    (settings.salles_dir / "1").mkdir(parents=True)
    (settings.salles_dir / "1" / NAME).write_text(
        json.dumps(
            {
                "version": 1,
                "scanned_ms": 1,
                "roms": [
                    {
                        "name": "Mario Tennis Aces",
                        "maker": None,
                        "about": None,
                        "art": True,
                        "console": "switch",
                        "key": "Mario Tennis Aces.xci",
                        "title_id": title_id,
                    }
                ],
            }
        )
    )
    partie = switch(settings, alice, "0100bde00862a000") / "data/bis/user/save/1/0"
    partie.mkdir(parents=True)
    (partie / "save.dat").write_bytes(b"x" * 10)

    vues = (await client.get("/api/me/sauvegardes", headers=ALICE)).json()
    assert len(vues) == 1
    assert vues[0]["relie"] is relie
    assert vues[0]["titre"] == ("Mario Tennis Aces" if relie else "0100BDE00862A000")
    assert vues[0]["cle"] == ("Mario Tennis Aces.xci" if relie else None)
    assert vues[0]["console"]["code"] == "switch"
    catalogue = (await client.get("/api/catalogue")).json()
    assert [jeu["key"] for jeu in catalogue["games"]] == ["Mario Tennis Aces.xci"]


def xbox360(settings: Settings, login: str, titre: str) -> Path:
    """L'emplacement personnel Xbox 360, au chemin que `xbox360-room.py` lui donne.

    La configuration est écrite là où la fixture `settings` la place, sans lire
    le réglage: l'essai doit pouvoir échouer sur un salon qui ne le connaît pas.
    """
    racine = settings.personal_save_root.parent / "etat-xbox360"
    (settings.personal_save_root.parent / "xbox360.json").write_text(
        json.dumps({"state": str(racine)})
    )
    nom = dossier_personnel(login)
    assert nom is not None
    return racine / titre / nom


def catalogue_sonic(settings: Settings, title_id: str | None = "534507d6") -> None:
    (settings.salles_dir / "1").mkdir(parents=True)
    (settings.salles_dir / "1" / NAME).write_text(
        json.dumps(
            {
                "version": 1,
                "scanned_ms": 1,
                "roms": [
                    {
                        "name": "Sonic the Hedgehog",
                        "maker": None,
                        "about": None,
                        "art": True,
                        "console": "x360",
                        "key": "Sonic the Hedgehog.iso",
                        "title_id": title_id,
                    }
                ],
            }
        )
    )


async def test_une_sauvegarde_xbox_360_est_listee_et_porte_le_nom_de_son_jeu(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Jusqu'au 22 novembre 2026, le carnet ne connaissait que Dolphin et les deux Switch."""
    alice = "alice@example.com"
    catalogue_sonic(settings)
    sonic = xbox360(settings, alice, "534507d6")
    # Ce que `backup` de l'adaptateur garde: les profils et leurs parties.
    partie = sonic / "xenia/content/E030000012345678/534507D6/00000001"
    partie.mkdir(parents=True)
    (partie / "SAVE").write_bytes(b"x" * 700)
    # Ce qui n'est pas la partie: le journal et les captures d'écran de Xenia.
    (sonic / "xenia-horodate.log").write_bytes(b"j" * 9000)
    (sonic / "captures").mkdir()
    (sonic / "captures/0001.png").write_bytes(b"p" * 9000)
    (sonic / "xenia/cache_host").mkdir(parents=True)
    (sonic / "xenia/cache_host/shaders.bin").write_bytes(b"c" * 9000)
    for copie in ("20261121T201500-1", "20261121T213000-2"):
        (sonic / "backups" / copie / "content").mkdir(parents=True)

    vues = (await client.get("/api/me/sauvegardes", headers=ALICE)).json()

    assert len(vues) == 1, vues
    (vue,) = vues
    assert (vue["titre"], vue["relie"], vue["console"]["code"]) == (
        "Sonic the Hedgehog",
        True,
        "x360",
    )
    assert vue["console"]["label"] == "Xbox 360"
    # Sans la mention « expérimental » depuis le 22 novembre 2026 (test_consoles.py).
    assert vue["console"]["experimental"] is False
    assert vue["sauvegarde"]["octets"] == 700
    assert vue["sauvegarde"]["copies"] == 2


async def test_sans_le_jeu_au_catalogue_la_sauvegarde_xbox_360_garde_son_titre(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Le jumeau du nom: un jeu retiré de la bibliothèque garde son identifiant."""
    catalogue_sonic(settings, title_id=None)
    (xbox360(settings, "alice@example.com", "534507d6") / "xenia/content").mkdir(parents=True)

    (vue,) = (await client.get("/api/me/sauvegardes", headers=ALICE)).json()

    assert (vue["titre"], vue["relie"], vue["console"]["code"]) == ("534507D6", False, "x360")
    assert vue["cle"] is None


@pytest.mark.parametrize(
    "dossier",
    [
        # Le titre d'une autre console sous la racine Xbox 360, une écriture que
        # l'adaptateur ne produit pas (il met le titre en minuscules), et un
        # titre trop court.
        "0100bde00862a000",
        "534507D6",
        "534507d",
    ],
)
async def test_un_dossier_qui_n_a_pas_la_forme_d_un_titre_xbox_360_n_est_pas_liste(
    client: httpx.AsyncClient, settings: Settings, dossier: str
) -> None:
    (xbox360(settings, "alice@example.com", dossier) / "xenia/content").mkdir(parents=True)

    assert (await client.get("/api/me/sauvegardes", headers=ALICE)).json() == []


async def test_un_titre_xbox_360_sous_la_racine_switch_n_est_pas_liste(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Le jumeau croisé: chaque racine n'accepte que la forme de sa console."""
    (switch(settings, "alice@example.com", "534507d6") / "data/bis/user").mkdir(parents=True)

    assert (await client.get("/api/me/sauvegardes", headers=ALICE)).json() == []


def test_le_reglage_xbox_360_de_la_fixture_est_jetable(settings: Settings, tmp_path: Path) -> None:
    assert settings.xbox360_config == tmp_path / "xbox360.json"


# ---- Le carnet commun (D12, 24 novembre 2026): avec qui, et qui regardait ----

CLARA = {"Tailscale-User-Login": "clara@example.com", "Tailscale-User-Name": "Clara"}
DORA = {"Tailscale-User-Login": "dora@example.com", "Tailscale-User-Name": "Dora"}


def presence(
    parties: Parties,
    login: str,
    ident: str,
    debut: datetime,
    secondes: float | None,
    *,
    regard: bool = False,
    place_tenue: int = 1,
    pseudo: str | None = None,
    salle: int = 1,
    jeu: dict | None = MARIO,
) -> None:
    """Une place ou un regard au journal, telle que la tablée l'écrit depuis D12."""
    quoi = "regard" if regard else "place"
    champs: dict = {"id": ident, "salle": salle, "jeu": jeu}
    if not regard:
        champs.update(place=place_tenue, lance=None, sauvegarde="inconnue")
    if pseudo is not None:
        champs["pseudo"] = pseudo
    parties.ecrire(login, f"{quoi}_debut", quand=debut, **champs)
    if secondes is not None:
        parties.ecrire(
            login,
            f"{quoi}_fin",
            quand=debut + timedelta(seconds=secondes),
            id=ident,
            salle=salle,
            secondes=secondes,
            raison="deconnectee",
        )


async def une_partie(client: httpx.AsyncClient, qui: dict[str, str]) -> dict:
    reponse = await client.get("/api/me/parties", headers=qui)
    assert reponse.status_code == 200, reponse.text
    (partie,) = reponse.json()["parties"]
    return partie


async def test_deux_joueurs_de_la_meme_soiree_se_voient_chacun_dans_son_carnet(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    presence(parties, "alice@example.com", "a" * 16, SOIR, 3600, pseudo="Alice")
    presence(
        parties,
        "benoit@example.com",
        "b" * 16,
        SOIR + timedelta(minutes=10),
        600,
        place_tenue=3,
        pseudo="Benoît",
    )
    vue_alice = await une_partie(client, ALICE)
    vue_benoit = await une_partie(client, BENOIT)
    assert vue_alice["avec"] == [{"nom": "Benoît", "place": 3}]
    assert vue_benoit["avec"] == [{"nom": "Alice", "place": 1}]
    assert vue_alice["regardaient"] == vue_benoit["regardaient"] == []


async def test_le_carnet_commun_ne_nomme_que_la_meme_salle_le_meme_jeu_et_le_meme_moment(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    """Les jumeaux: une autre salle, un autre jeu, après la fin, et avant le début."""
    presence(parties, "alice@example.com", "a" * 16, SOIR, 600, pseudo="Alice")
    presence(parties, "benoit@example.com", "b" * 16, SOIR, 600, salle=2, pseudo="Benoît")
    presence(parties, "clara@example.com", "c" * 16, SOIR, 600, jeu=TENNIS, pseudo="Clara")
    presence(
        parties, "dora@example.com", "d" * 16, SOIR + timedelta(seconds=600), 60, pseudo="Dora"
    )
    presence(parties, "eve@example.com", "e" * 16, SOIR - timedelta(seconds=60), 60, pseudo="Eve")
    assert (await une_partie(client, ALICE))["avec"] == []
    # Et chacun d'eux ne voit pas Alice non plus.
    assert (await une_partie(client, BENOIT))["avec"] == []
    assert (await une_partie(client, DORA))["avec"] == []


async def test_qui_regardait_est_dit_a_part_de_qui_jouait(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    presence(parties, "alice@example.com", "a" * 16, SOIR, 600, pseudo="Alice")
    presence(
        parties,
        "clara@example.com",
        "c" * 16,
        SOIR + timedelta(seconds=30),
        120,
        regard=True,
        pseudo="Clara",
    )
    presence(
        parties,
        "dora@example.com",
        "d" * 16,
        SOIR + timedelta(seconds=10),
        60,
        regard=True,
        pseudo="Dora",
    )
    # Le jumeau: un regard après la fin de la partie.
    presence(
        parties,
        "eve@example.com",
        "e" * 16,
        SOIR + timedelta(seconds=700),
        60,
        regard=True,
        pseudo="Eve",
    )
    partie = await une_partie(client, ALICE)
    assert partie["avec"] == []
    assert partie["regardaient"] == ["Dora", "Clara"]
    # Qui regardait puis a pris une place compte comme joueur, une seule fois.
    presence(
        parties,
        "dora@example.com",
        "f" * 16,
        SOIR + timedelta(seconds=70),
        100,
        place_tenue=2,
        pseudo="Dora",
    )
    partie = await une_partie(client, ALICE)
    assert partie["avec"] == [{"nom": "Dora", "place": 2}]
    assert partie["regardaient"] == ["Clara"]


async def test_le_pseudo_actuel_l_emporte_et_sans_pseudo_personne_n_est_nomme(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    presence(parties, "alice@example.com", "a" * 16, SOIR, 600, pseudo="Alice")
    presence(parties, "benoit@example.com", "b" * 16, SOIR, 600, place_tenue=2, pseudo="Ben")
    # Une ligne d'avant D12, sans pseudo, d'une personne qui n'en a jamais choisi.
    presence(parties, "clara@example.com", "c" * 16, SOIR, 600, place_tenue=3)
    assert (await une_partie(client, ALICE))["avec"] == [{"nom": "Ben", "place": 2}]
    renomme = await client.put(
        "/api/me",
        headers={**BENOIT, "Origin": "https://nel3ab.app", "Sec-Fetch-Site": "same-origin"},
        json={"name": "Benoît le grand"},
    )
    assert renomme.status_code == 200, renomme.text
    assert (await une_partie(client, ALICE))["avec"] == [{"nom": "Benoît le grand", "place": 2}]


async def test_une_place_sans_fin_ne_compte_que_si_elle_commence_pendant_la_mienne(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    """Jamais prolongée: un salon redémarré au milieu ne fait pas inventer un compagnon."""
    presence(parties, "alice@example.com", "a" * 16, SOIR, 600, pseudo="Alice")
    presence(
        parties, "benoit@example.com", "b" * 16, SOIR + timedelta(seconds=300), None, pseudo="Ben"
    )
    presence(
        parties, "clara@example.com", "c" * 16, SOIR - timedelta(seconds=1), None, pseudo="Clara"
    )
    assert (await une_partie(client, ALICE))["avec"] == [{"nom": "Ben", "place": 1}]


async def test_le_carnet_commun_ne_rend_ni_adresse_ni_empreinte(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    presence(parties, "alice@example.com", "a" * 16, SOIR, 600, pseudo="Alice")
    presence(parties, "benoit@example.com", "b" * 16, SOIR, 600, place_tenue=2, pseudo="Ben")
    presence(parties, "clara@example.com", "c" * 16, SOIR, 60, regard=True, pseudo="Clara")
    texte = (await client.get("/api/me/parties", headers=ALICE)).text
    assert "Ben" in texte and "Clara" in texte
    for login in ("benoit@example.com", "clara@example.com"):
        assert login not in texte
        assert empreinte(login) not in texte
    # Les autres lectures n'ouvrent pas les fichiers des autres.
    for route in ("/api/me/profil", "/api/me/jeux"):
        assert "Ben" not in (await client.get(route, headers=ALICE)).text


async def test_une_longue_presence_reste_trouvee_derriere_une_courte_finie_avant(
    client: httpx.AsyncClient, parties: Parties
) -> None:
    """Deux onglets de Benoît: l'un regarde toute la soirée, l'autre tient une
    place dix secondes avant la partie d'Alice. Le regard la touche encore."""
    presence(parties, "alice@example.com", "a" * 16, SOIR, 600, pseudo="Alice")
    presence(
        parties,
        "benoit@example.com",
        "b" * 16,
        SOIR - timedelta(seconds=60),
        3600,
        regard=True,
        pseudo="Ben",
    )
    presence(
        parties, "benoit@example.com", "c" * 16, SOIR - timedelta(seconds=30), 10, pseudo="Ben"
    )
    assert (await une_partie(client, ALICE))["regardaient"] == ["Ben"]


# ---- La page du carnet dit avec qui (D12) ----

RACINE = Path(__file__).resolve().parents[3]
NODE = shutil.which("node")
AVEC_JSDOM = pytest.mark.skipif(
    NODE is None or not (RACINE / "front/node_modules/jsdom/package.json").exists(),
    reason="node ou front/node_modules/jsdom absent",
)


def partie_lue(id_: str, avec: list[dict], regardaient: list[str]) -> dict:
    return {
        "id": id_,
        "salle": 1,
        "titre": "Mario Kart Double Dash",
        "console": {"code": "gc", "label": "GameCube"},
        "debut": "2026-11-14T20:00:00+00:00",
        "fin": "2026-11-14T20:10:00+00:00",
        "secondes": 600,
        "complete": True,
        "en_cours": False,
        "sauvegarde": "mienne",
        "lance_par": None,
        "avec": avec,
        "regardaient": regardaient,
    }


@AVEC_JSDOM
async def test_la_page_du_carnet_dit_avec_qui_et_qui_regardait(
    client: httpx.AsyncClient,
) -> None:
    page = (await client.get("/profil")).text
    reponses = {
        "/api/me/profil": {
            "pseudo": "Alice",
            "depuis": None,
            "jeux": 1,
            "parties": 3,
            "secondes": 1800,
            "inconnues": 0,
            "sauvegardes": 0,
            "dernier": None,
        },
        "/api/me/jeux": [],
        "/api/me/sauvegardes": [],
        "/api/me/parties": {
            "parties": [
                partie_lue(
                    "a" * 16, [{"nom": "Ben", "place": 2}, {"nom": "Clara", "place": 3}], ["Dora"]
                ),
                partie_lue("b" * 16, [], ["Dora", "Eve"]),
                # Le jumeau: seule, personne à nommer.
                partie_lue("c" * 16, [], []),
            ],
            "suivant": None,
        },
    }
    assert NODE is not None
    with anyio.fail_after(60):
        sortie = await anyio.run_process(
            [NODE, str(Path(__file__).parents[1] / "profil_module.mjs")],
            input=json.dumps({"page": page, "reponses": reponses}).encode(),
            check=False,
        )
    assert sortie.returncode == 0, sortie.stderr.decode()
    une, deux, seule = json.loads(sortie.stdout)
    assert une["avec"] == "Tu as joué avec Ben (2P) et Clara (3P). Dora a regardé."
    assert deux["avec"] == "Dora et Eve ont regardé."
    assert seule["avec"] is None
    assert "joué avec" not in seule["texte"]


async def _carnet(client: httpx.AsyncClient, reponses: dict, **entree: object) -> dict:
    """La vraie page du carnet, ouverte dans jsdom, vue entière."""
    page = (await client.get("/profil")).text
    assert NODE is not None
    with anyio.fail_after(60):
        sortie = await anyio.run_process(
            [NODE, str(Path(__file__).parents[1] / "profil_module.mjs")],
            input=json.dumps(
                {"page": page, "reponses": reponses, "complet": True, **entree}
            ).encode(),
            check=False,
        )
    assert sortie.returncode == 0, sortie.stderr.decode()
    return json.loads(sortie.stdout)


def _profil(parties: int) -> dict:
    return {
        "pseudo": "Bilel",
        "depuis": "2026-08-14T18:00:00+00:00",
        "jeux": 4,
        "parties": parties,
        "secondes": 61320,
        "inconnues": 0,
        "sauvegardes": 1,
        "dernier": None,
    }


def _partie(id_: str, debut: str, **champs: object) -> dict:
    return {**partie_lue(id_, [], []), "debut": debut, **champs}


#: Cinq parties sur deux soirées. Celle de 1 h 30 (heure de Paris) le dimanche
#: 22 appartient à la soirée du samedi 21: on ne se couche pas à minuit.
CINQ = [
    _partie("e" * 16, "2026-11-22T00:30:00+00:00", secondes=4360),
    _partie("d" * 16, "2026-11-21T20:00:00+00:00", complete=False),
    _partie("c" * 16, "2026-11-21T19:00:00+00:00", sauvegarde="du_lanceur", lance_par="Sami"),
    _partie("b" * 16, "2026-11-14T20:30:00+00:00", sauvegarde="commune"),
    _partie("a" * 16, "2026-11-14T20:00:00+00:00", en_cours=True, complete=False),
]


@AVEC_JSDOM
async def test_le_carnet_range_ses_parties_par_soiree_au_tableau_des_scores(
    client: httpx.AsyncClient,
) -> None:
    """Le tableau DERNIÈRES PARTIES: une tête par soirée, une ligne par partie.

    La durée s'écrit en chiffres d'afficheur, une fin inconnue ne s'invente
    pas, et la sauvegarde est nommée.
    """
    vue = await _carnet(
        client,
        {
            "/api/me/profil": _profil(23),
            "/api/me/sauvegardes": [],
            "/api/me/parties": {"parties": CINQ, "suivant": None},
        },
    )

    assert vue["groupes"] == [
        {"soiree": "Samedi 21 novembre", "lignes": 3},
        {"soiree": "Samedi 14 novembre", "lignes": 2},
    ]
    assert [ligne["duree"] for ligne in vue["lignes"]] == [
        "01:12:40",
        "--:--:--",
        "00:10:00",
        "00:10:00",
        "en cours",
    ]
    assert vue["lignes"][2]["sauvegarde"] == "la sauvegarde de Sami"
    assert vue["lignes"][2]["lancePar"] == "Sami"
    assert vue["lignes"][0]["lancePar"] == "toi"
    assert vue["lignes"][3]["sauvegarde"] == "tout débloqué"
    assert (
        vue["phrase"] == "Bilel, 23 parties sur 4 jeux depuis le 14 août : 17 h 02 de jeu en tout."
    )
    assert vue["voirSalles"] is False

    # Le jumeau: un carnet vide n'a qu'un bouton plein, « Voir les salles ».
    vide = await _carnet(
        client,
        {
            "/api/me/profil": _profil(0),
            "/api/me/sauvegardes": [],
            "/api/me/parties": {"parties": [], "suivant": None},
        },
    )
    assert vide["voirSalles"] is True
    assert vide["groupes"] == []


@AVEC_JSDOM
async def test_le_carnet_nomme_les_sauvegardes_comme_le_lexique(client: httpx.AsyncClient) -> None:
    """« ma sauvegarde », comme le panneau de lancement de la salle, et « la
    sauvegarde d'Ami », élidée comme la salle élide (`de`, `elisions.json`).

    Le carnet écrivait « ta sauvegarde » et « la sauvegarde de Ami » avant que
    ses mots passent par `mots.ts` (24 novembre 2026). Le jumeau sans élision,
    « la sauvegarde de Sami », est dans l'essai du tableau.
    """
    parties = [
        _partie("b" * 16, "2026-11-21T20:00:00+00:00", sauvegarde="du_lanceur", lance_par="Ami"),
        _partie("a" * 16, "2026-11-21T19:00:00+00:00"),
    ]
    vue = await _carnet(
        client,
        {
            "/api/me/profil": _profil(2),
            "/api/me/sauvegardes": [],
            "/api/me/parties": {"parties": parties, "suivant": None},
        },
    )
    assert parties[1]["sauvegarde"] == "mienne", "précondition: la seconde est la sienne"
    assert [ligne["sauvegarde"] for ligne in vue["lignes"]] == [
        "la sauvegarde d'Ami",
        "ma sauvegarde",
    ]


@AVEC_JSDOM
async def test_sans_identite_le_carnet_le_dit_et_mene_aux_salles(
    client: httpx.AsyncClient,
) -> None:
    vue = await _carnet(
        client,
        {"/api/me/profil": 401, "/api/me/sauvegardes": 401, "/api/me/parties": 401},
    )
    assert vue["phrase"] == "nel3ab ne sait pas qui tu es sur cet appareil."
    assert vue["voirSalles"] is True


@AVEC_JSDOM
async def test_ain_range_la_soiree_que_cet_appareil_n_avait_pas_vue(
    client: httpx.AsyncClient,
) -> None:
    """La scène « range », une fois, et la ligne nouvelle s'allume.

    Le jumeau: la même partie déjà vue ne rejoue rien; un appareil qui ouvre le
    carnet pour la première fois retient la partie sans scène.
    """
    reponses = {
        "/api/me/profil": _profil(23),
        "/api/me/sauvegardes": [],
        "/api/me/parties": {"parties": CINQ, "suivant": None},
    }
    neuve = await _carnet(client, reponses, stockage={"nel3ab:carnet-vu": "a" * 16})
    assert neuve["scenes"] == ["range"]
    assert neuve["vu"] == "e" * 16
    assert [ligne["nouvelle"] for ligne in neuve["lignes"]] == [True] + [False] * 4

    vue = await _carnet(client, reponses, stockage={"nel3ab:carnet-vu": "e" * 16})
    assert vue["scenes"] == []
    assert not any(ligne["nouvelle"] for ligne in vue["lignes"])

    premiere = await _carnet(client, reponses)
    assert premiere["scenes"] == []
    assert premiere["vu"] == "e" * 16


@AVEC_JSDOM
async def test_changer_ton_nom_se_fait_dans_le_carnet(client: httpx.AsyncClient) -> None:
    """« Changer ton nom » ouvre une boîte sur la page même (PUT /api/me)."""
    reponses = {
        "/api/me/profil": _profil(23),
        "/api/me/sauvegardes": [],
        "/api/me/parties": {"parties": [], "suivant": None},
        "/api/me": {"login": "bilel@exemple", "name": "Bilel", "display": "Bilel"},
    }
    vue = await _carnet(client, reponses, nom="  Zoé ")
    assert vue["puts"] == [{"name": "Zoé"}]
    assert vue["etiquette"] == "Zoé"
    assert vue["boiteOuverte"] is False

    # Le jumeau: un nom vide n'est pas envoyé, et la boîte reste ouverte.
    vide = await _carnet(client, reponses, nom="   ")
    assert vide["puts"] == []
    assert vide["etiquette"] == "Bilel"
    assert vide["boiteOuverte"] is True
