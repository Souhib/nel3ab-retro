"""L'identité que le proxy donne, et le pseudo que la personne choisit."""

import httpx

from nel3ab_control.settings import Settings
from tests.conftest import SOUHIB, VINCENT


async def test_the_proxy_says_who_it_is(client: httpx.AsyncClient) -> None:
    found = (await client.get("/api/me", headers=SOUHIB)).json()

    assert found["login"] == "souhib.t@hotmail.fr"
    # Faute de pseudo choisi, on propose le prénom du fournisseur d'identité.
    assert found["name"] == "Souhib"


async def test_without_a_proxy_there_is_nobody(client: httpx.AsyncClient) -> None:
    """Le développement local et les pilotes de navigateur passent par là.

    Pas une erreur: la salle marche encore, elle ne sait juste pas qui est qui.
    """
    found = (await client.get("/api/me")).json()

    assert found["login"] is None
    assert found["name"] == ""


async def test_a_chosen_name_is_kept_and_survives(client: httpx.AsyncClient) -> None:
    kept = (await client.put("/api/me", json={"name": "Souhib"}, headers=SOUHIB)).json()
    assert kept["name"] == "Souhib"

    again = (await client.put("/api/me", json={"name": "le boss"}, headers=SOUHIB)).json()
    assert again["name"] == "le boss"
    assert (await client.get("/api/me", headers=SOUHIB)).json()["name"] == "le boss"


async def test_a_name_is_written_under_the_address_the_proxy_gave(
    client: httpx.AsyncClient,
) -> None:
    """Le jumeau négatif de « on choisit son pseudo »: on ne choisit que le sien.

    Le corps de la requête ne porte qu'un nom, jamais une adresse, et c'est
    délibéré: une adresse dans le corps serait une adresse que le client choisit.
    """
    await client.put("/api/me", json={"name": "le boss"}, headers=SOUHIB)

    assert (await client.get("/api/me", headers=VINCENT)).json()["name"] == "Vincent"


async def test_renaming_without_an_identity_is_refused(client: httpx.AsyncClient) -> None:
    answer = await client.put("/api/me", json={"name": "quelqu'un"})

    assert answer.status_code == 401


async def test_an_empty_name_is_refused(client: httpx.AsyncClient) -> None:
    answer = await client.put("/api/me", json={"name": "   "}, headers=SOUHIB)

    assert answer.status_code == 422


async def test_a_name_longer_than_the_contract_is_refused(client: httpx.AsyncClient) -> None:
    """La longueur est le contrat du schéma, et il est publié dans l'OpenAPI.

    Vingt-quatre suffisent à un prénom et à un surnom, et la page borne déjà son
    champ: un nom plus long ne peut venir que d'autre chose que le formulaire.
    """
    answer = await client.put("/api/me", json={"name": "x" * 80}, headers=SOUHIB)

    assert answer.status_code == 422


async def test_the_previous_names_are_kept_beside_the_new_ones(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Le renommage protège d'une coupure, pas d'une bêtise de notre part.

    Écrire un dictionnaire vide serait atomique et perdrait quand même tous les
    pseudos, et ce fichier est le seul état du projet qui n'existe qu'en un
    exemplaire.
    """
    await client.put("/api/me", json={"name": "Souhib"}, headers=SOUHIB)
    await client.put("/api/me", json={"name": "Kitaru"}, headers=SOUHIB)

    kept = settings.state_file.with_suffix(".json.bak")
    assert kept.exists(), "aucune copie de la version d'avant"
    assert "Souhib" in kept.read_text(encoding="utf-8")
    assert "Kitaru" in settings.state_file.read_text(encoding="utf-8")
