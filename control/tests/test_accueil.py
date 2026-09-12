"""La page d'accueil: elle est servie, et elle ne demande rien à personne."""

import httpx
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
