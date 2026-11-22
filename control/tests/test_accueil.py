"""La page d'accueil: elle est servie, et elle ne demande rien à personne."""

import json
import shutil
from pathlib import Path

import anyio
import httpx
import pytest
from fastapi import FastAPI


async def test_la_page_d_accueil_est_servie(client: httpx.AsyncClient) -> None:
    reponse = await client.get("/")

    assert reponse.status_code == 200
    assert reponse.headers["content-type"].startswith("text/html")
    assert "salle" in reponse.text


async def test_l_accueil_ne_demande_aucune_identite(client: httpx.AsyncClient) -> None:
    """Sans proxy devant, la liste doit rester visible.

    C'est la première page que voit quelqu'un qui arrive, et une page qui se
    cache à qui n'est pas encore reconnu ne montre rien du tout.
    """
    reponse = await client.get("/", headers={})

    assert reponse.status_code == 200


def test_l_accueil_n_est_pas_dans_le_contrat(app: FastAPI) -> None:
    """Le jumeau: une page n'est pas une ressource.

    L'inscrire au schéma ajouterait au client TypeScript de la salle une
    fonction qui rend du HTML et que personne n'appellera jamais.
    """
    assert "/" not in app.openapi()["paths"]


# ── La liste ne parle que quand elle change ───────────────────────────────

RACINE = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")
JSDOM = RACINE / "front/node_modules/jsdom/package.json"
#: Node et jsdom sont là sur la machine et sur le lanceur de CI, qui installe les
#: dépendances de la page avant `just check`. Sauté, et dit, ailleurs.
AVEC_JSDOM = pytest.mark.skipif(
    NODE is None or not JSDOM.exists(), reason="node ou front/node_modules/jsdom absent"
)
RUNNER = Path(__file__).with_name("accueil_module.mjs")


def salles(depuis: int, jeu: str = "Mario Kart Wii", deux_ouverte: bool = False) -> list[dict]:
    """Ce que `/api/salles` répond: la salle 1 ouverte, la 2 selon le tour."""
    return [
        {
            "numero": 1,
            "ouverte": True,
            "chemin": "/r/1/",
            "jeu": jeu,
            "switch": False,
            "gens": ["un joueur"],
            "ouverte_depuis": depuis,
            "places": 3,
        },
        {
            "numero": 2,
            "ouverte": deux_ouverte,
            "chemin": "/r/2/",
            "jeu": None,
            "switch": False,
            "gens": [],
            "ouverte_depuis": 12 if deux_ouverte else None,
            "places": 4 if deux_ouverte else None,
        },
    ]


@AVEC_JSDOM
async def test_la_liste_ne_reecrit_rien_tant_que_rien_ne_change(client: httpx.AsyncClient) -> None:
    """A11Y-08, audit d'accessibilité du 21 novembre 2026.

    La liste était une région `aria-live` réécrite toutes les cinq secondes, même
    identique: 18 remplacements de texte comptés en 11 s, autant d'occasions pour
    un lecteur d'écran de la relire. Le jumeau: un vrai changement change la
    liste, et une seule ligne l'annonce en phrase.
    """
    page = (await client.get("/")).text
    tours = [
        salles(3600),
        # Le salon compte les secondes: 1H00 reste 1H00.
        salles(3605),
        salles(3610),
        salles(3615, deux_ouverte=True),
        salles(3620, jeu="Wii Sports", deux_ouverte=True),
        salles(3625, jeu="Wii Sports"),
    ]
    assert NODE is not None
    with anyio.fail_after(60):
        sortie = await anyio.run_process(
            [NODE, str(RUNNER)],
            input=json.dumps({"page": page, "tours": tours}).encode(),
            check=False,
        )
    assert sortie.returncode == 0, sortie.stderr.decode()
    *rendus, fin = json.loads(sortie.stdout)
    pareil, encore, ouverte, autre_jeu, fermee = rendus

    assert pareil["mutations"] == [], pareil["mutations"]
    assert encore["mutations"] == []
    assert pareil["annonce"] == encore["annonce"] == ""
    assert ouverte["mutations"], "la salle 2 ouverte doit changer la liste"
    assert ouverte["annonce"] == "la salle 2 vient de s'ouvrir"
    assert autre_jeu["annonce"] == "la salle 1 passe à Wii Sports"
    assert fermee["annonce"] == "la salle 2 s'est fermée"
    # La liste n'est plus une région vivante: la ligne d'annonce l'est.
    assert fin["vivante"] is None
    assert fin["role"] == "status"
    assert "Wii Sports" in fin["texte"]
