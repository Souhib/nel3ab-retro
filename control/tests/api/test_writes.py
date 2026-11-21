"""Une écriture ne vient que d'une page du salon.

Le défaut relevé par l'audit du 20 novembre 2026: l'origine n'était vérifiée
que pour la socket du salon. Une page étrangère ouverte dans le navigateur d'un
membre du réseau pouvait donc envoyer une écriture au salon, et le salon
l'attribuait au membre, puisqu'il reconnaît les gens par leur adresse réseau.

Les routes sont lues dans l'application elle-même, et pas recopiées ici: une
route ajoutée demain entre dans ces essais sans que personne ait à y penser.
"""

import json
import re
import shlex
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, RouteContext, iter_route_contexts
from starlette.routing import Mount, Route

from tests.conftest import PAGE, SOUHIB
from tests.faux_systeme import FauxSysteme

WRITES = {"POST", "PUT", "PATCH", "DELETE"}

#: Un corps valide pour chaque écriture connue, pour que l'essai prouve qu'une
#: écriture REFUSÉE n'a rien fait, et pas seulement qu'elle a échoué à valider
#: son corps. Une route qui n'est pas ici reçoit un corps vide: elle doit quand
#: même être refusée, avant toute lecture de ce corps.
BODIES = {
    "/api/me": {"name": "Intrus"},
    "/api/me/bindings": {},
    "/api/room/bindings": {},
}


def _routes(app: FastAPI) -> list[RouteContext]:
    """Les routes telles que l'application les sert, routeurs inclus dépliés.

    Par `iter_route_contexts` et pas par `app.routes`: depuis FastAPI 0.141,
    `app.routes` garde chaque routeur inclus comme UN élément, sans chemin ni
    méthode. Parcourir `app.routes` rendait une liste vide, et chaque boucle de
    ce fichier passait sans rien vérifier. C'est le premier jet de cet essai
    qui l'a montré, le 21 novembre 2026, par l'assertion de précondition
    ci-dessous. Le contexte porte aussi les dépendances EFFECTIVES, celles de
    l'application et du routeur comprises, qui sont celles que le serveur
    exécute.
    """
    return list(iter_route_contexts(app.routes))


def _writing_routes(app: FastAPI) -> list[tuple[str, str]]:
    """Chaque écriture de l'application, avec un vrai numéro à la place d'un paramètre."""
    found = []
    for context in _routes(app):
        if isinstance(context.original_route, APIRoute):
            for method in sorted((context.methods or set()) & WRITES):
                found.append((method, re.sub(r"\{[^}]+\}", "1", str(context.path))))
    return found


@pytest.fixture
async def bare(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    """Un client SANS l'origine de la page, que chaque essai complète à la main."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://control.test"
    ) as http:
        yield http


def test_the_salon_has_the_writing_routes_these_tests_expect(app: FastAPI) -> None:
    """La précondition des essais qui suivent, affirmée plutôt que supposée.

    Une liste vide ferait passer chaque boucle ci-dessous sans rien vérifier.
    """
    found = _writing_routes(app)

    assert ("PUT", "/api/me") in found
    assert ("POST", "/api/salles") in found
    assert ("DELETE", "/api/salles/1") in found
    assert len(found) >= 5, found


@pytest.mark.parametrize(
    "origin",
    [
        [("Origin", "https://evil.example")],
        # Le même hôte sur un autre port n'est pas la même origine.
        [("Origin", "https://lgf.tail3bd01c.ts.net:8444")],
        # Ni le même nom en clair.
        [("Origin", "http://nel3ab.app")],
        # Ni l'absence d'origine: un navigateur en joint une à toute écriture.
        [],
        # Ni deux origines: choisir laquelle croire serait la faille.
        [("Origin", "https://nel3ab.app"), ("Origin", "https://evil.example")],
    ],
    ids=["etrangere", "autre-port", "en-clair", "absente", "deux"],
)
async def test_a_write_from_anywhere_but_the_page_is_refused_and_does_nothing(
    app: FastAPI,
    bare: httpx.AsyncClient,
    systeme: FauxSysteme,
    origin: list[tuple[str, str]],
) -> None:
    refused = {}
    for method, path in _writing_routes(app):
        answer = await bare.request(
            method,
            path,
            headers=[*origin, *SOUHIB.items()],
            json=BODIES.get(path),
        )
        refused[(method, path)] = answer.status_code

    assert set(refused.values()) == {403}, refused
    # Rien n'a été exécuté derrière le refus: ni salle allumée ou éteinte, ni
    # pseudo changé.
    assert [c for c in systeme.commandes if "start" in c or "stop" in c] == []
    assert (await bare.get("/api/me", headers=SOUHIB)).json()["name"] != "Intrus"


@pytest.mark.parametrize("site", ["cross-site", "same-site"])
async def test_a_listed_origin_from_another_site_is_refused(
    bare: httpx.AsyncClient, site: str
) -> None:
    """`Sec-Fetch-Site` est écrit par le navigateur, pas par la page.

    Quand il est là, il dit d'où part la demande. `same-site` couvre un autre
    sous-domaine du même domaine, qui n'est pas une page du salon.
    """
    answer = await bare.put(
        "/api/me",
        headers={**PAGE, **SOUHIB, "Sec-Fetch-Site": site},
        json={"name": "Intrus"},
    )

    assert answer.status_code == 403


@pytest.mark.parametrize("site", [None, "same-origin", "none"])
async def test_the_page_itself_still_writes(bare: httpx.AsyncClient, site: str | None) -> None:
    """Le jumeau: une garde qui refuserait tout passerait les essais du dessus.

    `none` est ce qu'un navigateur écrit pour un geste de la personne elle-même,
    sans page derrière. Absent, c'est un navigateur ancien ou un client qui
    n'est pas un navigateur, et l'origine seule décide.
    """
    extra = {} if site is None else {"Sec-Fetch-Site": site}

    answer = await bare.put("/api/me", headers={**PAGE, **SOUHIB, **extra}, json={"name": "Moi"})

    assert answer.status_code == 200
    assert answer.json()["name"] == "Moi"


async def test_the_one_deployed_door_may_write_and_the_old_one_may_not(
    bare: httpx.AsyncClient, app: FastAPI
) -> None:
    """Les origines viennent des réglages, les mêmes que celles de la socket.

    Lit la valeur livrée à systemd, pas une liste recopiée dans le test. Depuis
    le 21 novembre 2026, `nel3ab.app` est la seule porte: l'ancienne porte
    `.ts.net:8443` ne sert plus de page, elle renvoie vers ce nom
    (`deploy/Caddyfile`), et son origine ne doit plus pouvoir écrire.
    """
    unit = Path(__file__).parents[3] / "deploy/nel3ab-control.service"
    lines = [line for line in unit.read_text().splitlines() if line.startswith("Environment=")]
    environment = dict(shlex.split(line.partition("=")[2])[0].split("=", 1) for line in lines)
    deployed = json.loads(environment["NEL3AB_ORIGINS"])
    app.state.settings.origins = deployed
    assert deployed == ["https://nel3ab.app"], deployed

    for origin, attendu in [
        ("https://nel3ab.app", 200),
        ("https://lgf.tail3bd01c.ts.net:8443", 403),
    ]:
        answer = await bare.put(
            "/api/me",
            headers={"Origin": origin, "Sec-Fetch-Site": "same-origin", **SOUHIB},
            json={"name": "Moi"},
        )
        assert answer.status_code == attendu, origin


async def test_reading_does_not_ask_for_an_origin(bare: httpx.AsyncClient) -> None:
    """La garde porte sur les écritures seulement.

    Une lecture venue d'une page étrangère arrive, mais le navigateur ne lui
    rend pas la réponse: c'est la règle de même origine, et le salon n'envoie
    aucun en-tête qui la lève. Exiger une origine ici ne protégerait rien et
    casserait les pilotes d'essai qui lisent la salle sans navigateur.
    """
    foreign = {"Origin": "https://evil.example"}
    assert (await bare.get("/api/room")).status_code == 200
    assert (await bare.get("/api/room", headers=foreign)).status_code == 200


def _calls(dependant: Dependant) -> list[object]:
    """Toutes les fonctions qu'une route appelle avant elle, sous-dépendances comprises."""
    found: list[object] = []
    for sub in dependant.dependencies:
        found.append(sub.call)
        found.extend(_calls(sub))
    return found


def test_no_writing_route_can_forget_the_origin_guard(app: FastAPI) -> None:
    """La garde est dans l'arbre de dépendances de CHAQUE écriture.

    L'essai qui fait échouer une route oubliée demain. Les deux autres sortes
    de routes sont bornées aussi: une route Starlette nue n'a pas de dépendance
    du tout, donc elle ne doit jamais écrire, et le seul montage est la socket
    du salon, dont la bibliothèque vérifie déjà l'origine (voir
    `test_a_foreign_origin_cannot_open_the_lobby`).
    """
    from nel3ab_control.dependencies import same_origin

    unguarded = []
    writes = 0
    for context in _routes(app):
        route = context.original_route
        if isinstance(route, APIRoute):
            if (context.methods or set()) & WRITES:
                writes += 1
                if same_origin not in _calls(context.dependant):
                    unguarded.append((sorted(context.methods or ()), context.path))
        elif isinstance(route, Mount):
            assert route.path == "/socket.io", route.path
        elif isinstance(route, Route):
            assert not (route.methods or set()) & WRITES, route.path
        else:
            pytest.fail(f"une route d'une sorte inconnue: {route!r}")

    assert writes >= 5, "la précondition: l'essai a bien trouvé les écritures"
    assert unguarded == []
