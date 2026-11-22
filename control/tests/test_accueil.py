"""La page d'accueil: elle est servie, et elle ne demande rien à personne."""

from pathlib import Path

import httpx
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


async def test_le_salon_ne_redeclare_pas_ses_propres_couleurs_de_page(
    client: httpx.AsyncClient,
) -> None:
    """Le jumeau: une page qui reposerait `--fond` après la régie l'écraserait.

    Le graphite était recopié à la main dans les trois pages; c'est par là
    qu'une page aurait dérivé seule, et la régie de jour n'aurait jamais pris.
    """
    regie = (Path(regie_module.__file__).with_name("regie.css")).read_text(encoding="utf-8")
    for chemin in ("/", "/importer", "/profil"):
        page = (await client.get(chemin, headers={})).text.replace(regie, "")
        for role in ("--fond:", "--plaque:", "--creux:", "--legende:", "--trait:"):
            assert role not in page, f"{chemin} redéclare {role}"
