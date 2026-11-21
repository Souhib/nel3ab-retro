"""What routes ask for, and where it comes from."""

from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Request, status

from nel3ab_control.api.controllers.bindings import (
    BindingsController,
    RoomBindingsController,
)
from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.controllers.salles import SalleInconnue, SallesController
from nel3ab_control.api.controllers.salons import Salons
from nel3ab_control.identity import caller_of
from nel3ab_control.parties import Parties
from nel3ab_control.settings import Settings


def get_settings(request: Request) -> Settings:
    """The settings this app was built with."""
    return request.app.state.settings


#: Les méthodes qui changent quelque chose. La garde d'origine ne porte que sur
#: elles: une lecture venue d'une page étrangère arrive, mais le navigateur ne
#: lui rend pas la réponse, puisque le salon n'envoie aucun en-tête qui lève la
#: règle de même origine.
WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Ce que `Sec-Fetch-Site` peut dire d'une écriture légitime. `same-origin`
#: pour une page du salon, `none` pour un geste de la personne elle-même sans
#: page derrière. `same-site` n'en fait pas partie: un autre sous-domaine du même
#: domaine n'est pas une page du salon.
SITES = ("same-origin", "none")


async def same_origin(request: Request) -> None:
    """Refuse une écriture qui ne vient pas d'une page du salon.

    # Pourquoi c'est nécessaire

    Le salon reconnaît les gens par leur adresse dans le réseau privé, sans
    cookie ni jeton. Une page étrangère ouverte dans le navigateur d'un membre
    peut donc écrire au salon, et l'écriture arrive avec l'identité du membre.
    Le navigateur protège les lectures, pas les écritures dites simples: un
    `POST` sans corps part sans aucune vérification préalable. Relevé par
    l'audit du 20 novembre 2026, et reproduit le lendemain par
    `tests/api/test_writes.py`.

    # Ce qui est vérifié

    `Origin`, que tout navigateur joint à une écriture, doit être UNE des
    origines des réglages, les mêmes que celles de la socket du salon. Absente,
    en double ou différente, la demande est refusée: deux valeurs sur une
    garde, c'est choisir laquelle croire, et c'est la faille.

    `Sec-Fetch-Site`, quand le navigateur l'écrit, doit dire `same-origin` ou
    `none`. Une page ne peut écrire aucun de ces deux en-têtes elle-même.

    # Ce que ça ne fait pas

    Arrêter un programme de la machine. Il écrit les en-têtes qu'il veut, y
    compris celui de l'identité: voir le carnet, entrée du 21 novembre 2026.

    Posée sur l'APPLICATION, pas sur chaque route: une route ajoutée demain
    l'hérite sans que personne y pense. `test_no_writing_route_can_forget_the_origin_guard`
    vérifie qu'elle est bien dans l'arbre de chaque écriture.
    """
    if request.method not in WRITES:
        return
    origins = request.headers.getlist("origin")
    if len(origins) != 1 or origins[0] not in get_settings(request).origins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="cette demande ne vient pas d'une page du salon",
        )
    sites = request.headers.getlist("sec-fetch-site")
    if sites and (len(sites) != 1 or sites[0] not in SITES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="cette demande part d'un autre site que le salon",
        )


def get_client(request: Request) -> httpx.AsyncClient:
    """The shared HTTP client, opened once for the life of the app.

    Shared rather than per-request: a new client per call means a new connection
    pool per call, which is a TCP handshake to the worker every time a page asks
    what game is loaded.
    """
    return request.app.state.client


def get_rooms(request: Request) -> RoomController:
    """La salle dont CETTE page parle.

    Le numéro voyage en paramètre de requête, `?salle=2`, et vaut 1 par défaut:
    une page qui ne le dit pas est une page d'avant les salles multiples, et la
    salle 1 est celle qu'elle voyait. Lu ici plutôt que dans chaque route, pour
    qu'aucune route ne puisse l'oublier.

    Un numéro qui n'est pas une salle est refusé plutôt que ramené à 1: servir
    la salle 1 à qui demande la salle 7 lui montrerait les places et le jeu de
    quelqu'un d'autre en croyant voir les siens.
    """
    # Le paramètre d'abord, l'en-tête ensuite: le premier se lit dans une trace
    # et se forge à la main pour essayer une salle, le second évite d'ajouter un
    # paramètre à chaque appel du client engendré.
    demande = request.query_params.get("salle") or request.headers.get("X-Nel3ab-Salle")
    if demande is None:
        return request.app.state.salons.pour(1)
    try:
        numero = int(demande)
    except ValueError as error:
        raise SalleInconnue(0) from error
    return request.app.state.salons.pour(numero)


def get_salles(request: Request) -> SallesController:
    """Les salles de la machine, ouvertes ou non."""
    return request.app.state.salles


def get_salons(request: Request) -> Salons:
    """Les contrôleurs de chaque salle, tels que les pages les voient."""
    return request.app.state.salons


def get_parties(request: Request) -> Parties:
    """Le journal des parties, un fichier par personne."""
    return request.app.state.parties


def get_people(request: Request) -> PeopleController:
    """Les pseudos et les présents."""
    return request.app.state.people


def get_bindings(request: Request) -> BindingsController:
    """Les réglages de manette de chacun."""
    return request.app.state.bindings


def get_room_bindings(request: Request) -> RoomBindingsController:
    """La configuration de référence de la salle."""
    return request.app.state.room_bindings


async def get_caller(request: Request) -> tuple[str, str] | None:
    """Qui appelle, d'après le proxy, ou rien.

    Établit l'IDENTITÉ et s'arrête là. Ce qu'on a le droit de faire avec est la
    décision des contrôleurs, et mélanger les deux ici rendrait chaque règle
    invisible depuis la route qui l'applique.

    Rendre `None` plutôt que refuser: sans proxy devant, la salle marche encore,
    elle ne sait juste pas qui est qui. Le développement local et les pilotes de
    navigateur passent par là.
    """
    return await caller_of(request.scope)


SettingsDep = Annotated[Settings, Depends(get_settings)]
PeopleDep = Annotated[PeopleController, Depends(get_people)]
BindingsDep = Annotated[BindingsController, Depends(get_bindings)]
RoomBindingsDep = Annotated[RoomBindingsController, Depends(get_room_bindings)]
CallerDep = Annotated[tuple[str, str] | None, Depends(get_caller)]
ClientDep = Annotated[httpx.AsyncClient, Depends(get_client)]
RoomsDep = Annotated[RoomController, Depends(get_rooms)]
SallesDep = Annotated[SallesController, Depends(get_salles)]
SalonsDep = Annotated[Salons, Depends(get_salons)]
PartiesDep = Annotated[Parties, Depends(get_parties)]
