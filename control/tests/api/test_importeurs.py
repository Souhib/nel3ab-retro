"""La liste de l'administrateur: qui a accès au salon, et qui peut y déposer.

Le tailnet est un double posé sur `identity.tailnet` (la fixture commune le
rend injoignable partout ailleurs), et chaque essai a son fichier de droits
dans un dossier jetable (`settings.importeurs_file`).
"""

import json

import httpx
import pytest
from fastapi import FastAPI

from nel3ab_control import identity
from nel3ab_control.api.controllers.importeurs import ImporteursController
from nel3ab_control.identity import Membre
from nel3ab_control.imports.droits import Registre
from tests.conftest import SOUHIB, VINCENT
from tests.imports.protocole import GC, annoncer

ALICE = {"Tailscale-User-Login": "alice@github", "Tailscale-User-Name": "Alice"}

MEMBRES = [
    Membre("alice@github", "Alice A", appareils=2, en_ligne=True, partage=True),
    Membre("souhib@example.com", "Souhib T", appareils=3, en_ligne=True, partage=False),
    Membre("vincent@example.com", "Vincent L", appareils=1, en_ligne=False, partage=False),
]


@pytest.fixture
def tailnet(monkeypatch: pytest.MonkeyPatch) -> list[Membre] | None:
    """Le tailnet de l'essai. Un essai peut le vider ou le rendre injoignable."""
    vus: list[Membre] | None = list(MEMBRES)

    async def lire(_socket: str = "") -> list[Membre] | None:
        return vus

    monkeypatch.setattr(identity, "tailnet", lire)
    return vus


@pytest.fixture
def roms(app: FastAPI) -> None:
    from pathlib import Path

    for dossier in app.state.settings.rom_dir.split(":"):
        Path(dossier).mkdir(parents=True, exist_ok=True)


def droits_ecrits(app: FastAPI) -> list[str] | None:
    fichier = app.state.settings.importeurs_file
    return json.loads(fichier.read_text())["importeurs"] if fichier.exists() else None


# ── Qui peut voir la liste ─────────────────────────────────────────────────


async def test_sans_identite_la_liste_et_ses_ecritures_rendent_401(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre]
) -> None:
    for methode in ("GET", "PUT", "DELETE"):
        chemin = "/api/importeurs" if methode == "GET" else "/api/importeurs/vincent@example.com"
        assert (await client.request(methode, chemin)).status_code == 401, methode
    assert droits_ecrits(app) is None


async def test_une_autre_personne_que_l_administrateur_rend_403(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre]
) -> None:
    """Même une personne qui peut déposer: la liste montre des adresses."""
    app.state.settings.importeurs = ["vincent@example.com"]
    for methode in ("GET", "PUT", "DELETE"):
        chemin = "/api/importeurs" if methode == "GET" else "/api/importeurs/alice@github"
        reponse = await client.request(methode, chemin, headers=VINCENT)
        assert reponse.status_code == 403, methode
    assert droits_ecrits(app) is None


async def test_la_page_sait_qui_est_l_administrateur(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/imports/droits", headers=SOUHIB)).json()["administrateur"]
    assert not (await client.get("/api/imports/droits", headers=VINCENT)).json()["administrateur"]


# ── Ce que la liste montre ─────────────────────────────────────────────────


async def test_la_liste_rassemble_le_tailnet_les_pseudos_et_les_droits(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre]
) -> None:
    app.state.settings.importeurs = ["config@example.com"]
    await app.state.people.rename("vincent@example.com", "Vince")
    await app.state.people.rename("venu@example.com", "Déjà venu")

    corps = (await client.get("/api/importeurs", headers=SOUHIB)).json()

    assert corps["tailnet"] is True
    assert corps["registre_lisible"] is True
    vues = {une["login"]: une for une in corps["personnes"]}
    assert [une["login"] for une in corps["personnes"]][:2] == [
        "souhib@example.com",
        "config@example.com",
    ], "l'administrateur d'abord, puis la configuration"
    assert vues["souhib@example.com"]["droit"] == "administrateur"
    assert vues["config@example.com"]["droit"] == "configuration"
    assert vues["config@example.com"]["sources"] == []
    assert vues["alice@github"] == {
        "login": "alice@github",
        "nom": "Alice A",
        "pseudo": None,
        "sources": ["tailnet"],
        "appareils": 2,
        "en_ligne": True,
        "partage": True,
        "droit": "aucun",
    }
    assert vues["vincent@example.com"]["sources"] == ["tailnet", "salon"]
    assert vues["vincent@example.com"]["pseudo"] == "Vince"
    assert vues["venu@example.com"]["sources"] == ["salon"]
    assert len(vues) == 5


async def test_sans_tailscaled_la_liste_le_dit_et_garde_les_pseudos(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    """La fixture commune rend le tailnet injoignable: la page doit le savoir."""
    await app.state.people.rename("vincent@example.com", "Vince")

    corps = (await client.get("/api/importeurs", headers=SOUHIB)).json()

    assert corps["tailnet"] is False
    assert {une["login"] for une in corps["personnes"]} == {
        "souhib@example.com",
        "vincent@example.com",
    }


# ── Donner et reprendre ────────────────────────────────────────────────────


async def test_donner_la_cle_permet_de_deposer_et_reprendre_la_retire(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre], roms: None
) -> None:
    assert (await annoncer(client, GC, qui=ALICE)).status_code == 403

    donne = await client.put("/api/importeurs/Alice@GitHub", headers=SOUHIB)

    assert donne.status_code == 200
    assert donne.json()["droit"] == "nomme"
    assert droits_ecrits(app) == ["alice@github"]
    assert (await client.get("/api/imports/droits", headers=ALICE)).json()["peut_importer"]
    assert (await annoncer(client, GC, qui=ALICE)).status_code == 201

    repris = await client.delete("/api/importeurs/alice@github", headers=SOUHIB)

    assert repris.status_code == 200
    assert repris.json()["droit"] == "aucun"
    assert droits_ecrits(app) == []
    assert (await annoncer(client, GC, qui=ALICE)).status_code == 403


async def test_donner_deux_fois_ne_l_ecrit_qu_une_fois(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre]
) -> None:
    for _ in range(2):
        assert (await client.put("/api/importeurs/alice@github", headers=SOUHIB)).status_code == 200

    assert droits_ecrits(app) == ["alice@github"]


async def test_reprendre_la_cle_coupe_un_envoi_en_route(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre], roms: None
) -> None:
    await client.put("/api/importeurs/alice@github", headers=SOUHIB)
    ident = (await annoncer(client, GC, qui=ALICE)).json()["id"]
    await client.delete("/api/importeurs/alice@github", headers=SOUHIB)

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:512], headers=ALICE
    )

    assert reponse.status_code == 403


async def test_ni_l_administrateur_ni_la_configuration_ne_se_retirent_d_ici(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre]
) -> None:
    """Leur droit ne vient pas du fichier: répondre « fait » serait mentir."""
    app.state.settings.importeurs = ["config@example.com"]

    for login in ("souhib@example.com", "config@example.com"):
        reponse = await client.delete(f"/api/importeurs/{login}", headers=SOUHIB)
        assert reponse.status_code == 409, login
    assert droits_ecrits(app) is None
    corps = (await client.get("/api/importeurs", headers=SOUHIB)).json()
    vues = {une["login"]: une["droit"] for une in corps["personnes"]}
    assert vues["souhib@example.com"] == "administrateur"
    assert vues["config@example.com"] == "configuration"


async def test_reprendre_a_qui_n_a_rien_ne_change_rien(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre]
) -> None:
    reponse = await client.delete("/api/importeurs/vincent@example.com", headers=SOUHIB)

    assert reponse.status_code == 200
    assert reponse.json()["droit"] == "aucun"
    assert droits_ecrits(app) is None, "rien à retirer, rien d'écrit"


@pytest.mark.parametrize("login", ["pas-une-adresse", "a@b@c", "%20@example.com"])
async def test_ce_qui_n_est_pas_une_adresse_est_refuse_sans_rien_ecrire(
    client: httpx.AsyncClient, app: FastAPI, login: str
) -> None:
    assert (await client.put(f"/api/importeurs/{login}", headers=SOUHIB)).status_code == 422
    assert droits_ecrits(app) is None


async def test_une_ecriture_venue_d_un_autre_site_est_refusee(
    app: FastAPI, tailnet: list[Membre]
) -> None:
    """La garde d'origine de l'application couvre aussi ces routes."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://control.test",
        headers={"Origin": "https://evil.example", **SOUHIB},
    ) as ailleurs:
        reponse = await ailleurs.put("/api/importeurs/alice@github")

    assert reponse.status_code == 403
    assert droits_ecrits(app) is None


# ── Ce qui dure ────────────────────────────────────────────────────────────


def redemarrer(app: FastAPI) -> None:
    """Ce que le démarrage du salon fait des droits: relire le fichier, rien d'autre.

    Pas un second salon complet: son cycle de vie lancerait les observateurs des
    salles numérotées, et un essai ne doit jamais interroger leurs vrais ports.
    """
    app.state.registre = Registre(app.state.settings.importeurs_file)
    app.state.importeurs = ImporteursController(
        app.state.settings, app.state.registre, app.state.people
    )


async def test_un_droit_donne_survit_au_redemarrage_du_salon(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre]
) -> None:
    await client.put("/api/importeurs/alice@github", headers=SOUHIB)

    redemarrer(app)

    assert (await client.get("/api/imports/droits", headers=ALICE)).json()["peut_importer"]


async def test_un_fichier_de_droits_illisible_n_est_jamais_ecrase(
    client: httpx.AsyncClient, app: FastAPI, tailnet: list[Membre]
) -> None:
    fichier = app.state.settings.importeurs_file
    fichier.write_text('{"importeurs": ["alice@github"')
    redemarrer(app)

    corps = (await client.get("/api/importeurs", headers=SOUHIB)).json()
    reponse = await client.put("/api/importeurs/vincent@example.com", headers=SOUHIB)

    assert corps["registre_lisible"] is False
    assert reponse.status_code == 503
    assert not (await client.get("/api/imports/droits", headers=ALICE)).json()["peut_importer"]
    assert fichier.read_text() == '{"importeurs": ["alice@github"'
