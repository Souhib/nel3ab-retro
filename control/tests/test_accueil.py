"""La page d'accueil: elle est servie, et elle ne demande rien à personne."""

import json
import re
import shutil
from pathlib import Path

import anyio
import httpx
import pytest
from fastapi import FastAPI

from nel3ab_control.api.routes import accueil as regie_module


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


async def test_les_trois_pages_du_salon_portent_la_regie_de_la_salle(
    client: httpx.AsyncClient,
) -> None:
    """Une seule identité: les jetons de `front/src/regie.css`, dans chaque page.

    Le salon reçoit une copie de la feuille de la salle (`routes/regie.css`,
    comparée octet pour octet par `front/src/lib/regie.test.ts`). Ici on vérifie
    qu'elle arrive VRAIMENT dans ce qui est servi: une copie juste qu'aucune page
    n'inclut ne change rien à l'écran.
    """
    regie = (Path(regie_module.__file__).with_name("regie.css")).read_text(encoding="utf-8")
    for chemin in ("/", "/importer", "/profil"):
        page = (await client.get(chemin, headers={})).text
        assert "/*__REGIE__*/" not in page, chemin
        assert regie in page, f"{chemin} ne porte pas la régie"
        # Les deux thèmes, et le système qui choisit entre eux.
        assert "@media (prefers-color-scheme: light)" in page, chemin
        assert ':root[data-theme="jour"]' in page, chemin


def _jetons_de_la_regie(regie: str) -> set[str]:
    """Chaque nom que `regie.css` déclare: primitives, rôles et composants."""
    return set(re.findall(r"(?<![\w-])(--[a-z0-9-]+)\s*:", regie))


def _redeclares(page: str, jetons: set[str]) -> list[str]:
    """Les jetons de la régie qu'une page déclare à nouveau, en CSS ou en style en ligne."""
    return sorted(
        nom for nom in re.findall(r"(?<![\w-])(--[a-z0-9-]+)[\"']?\s*:", page) if nom in jetons
    )


def test_la_liste_des_jetons_vient_de_la_feuille() -> None:
    """La précondition: une liste vide ou réduite rendrait le garde muet.

    La première version cherchait cinq rôles écrits à la main, et un
    `--encre` ou un `--signal` redéclaré passait (relecture du 22 novembre
    2026). La liste est maintenant lue dans la feuille.
    """
    regie = (Path(regie_module.__file__).with_name("regie.css")).read_text(encoding="utf-8")
    jetons = _jetons_de_la_regie(regie)

    for attendu in (
        "--fond",
        "--encre",
        "--signal",
        "--p3-encre",
        "--bouton-plein-fond",
        "--ecran",
    ):
        assert attendu in jetons, attendu
    # `--color-fond` n'est pas `--fond`: le nom se lit entier.
    assert "--color-fond" not in jetons
    assert _redeclares("a{--color-fond: red}", jetons) == []
    assert _redeclares(".tampon{--encre: var(--alerte)}", jetons) == ["--encre"]
    assert _redeclares('style="--signal: #f0f"', jetons) == ["--signal"]


async def test_le_salon_ne_redeclare_pas_ses_propres_couleurs_de_page(
    client: httpx.AsyncClient,
) -> None:
    """Le jumeau: une page qui reposerait `--fond` après la régie l'écraserait.

    Le graphite était recopié à la main dans les trois pages; c'est par là
    qu'une page aurait dérivé seule, et la régie de jour n'aurait jamais pris.
    Un rôle redéfini localement contourne aussi `regie.test.ts`, qui calcule
    les contrastes sur les valeurs de la feuille et non sur celles de la page:
    le dépôt avait dû renommer son `--encre` local en `--tampon` pour cette
    raison. Aucun jeton de la feuille, quelle que soit sa couche.
    """
    regie = (Path(regie_module.__file__).with_name("regie.css")).read_text(encoding="utf-8")
    jetons = _jetons_de_la_regie(regie)
    for chemin in ("/", "/importer", "/profil"):
        page = (await client.get(chemin, headers={})).text
        assert regie in page, chemin
        assert _redeclares(page.replace(regie, ""), jetons) == [], chemin
