"""Les réglages de manette, rangés sous la personne et pas sous la machine.

Le défaut qu'ils corrigent: une manette GameCube demande seize questions pour
s'apprendre, et les réponses vivaient dans le `localStorage` d'un navigateur.
Changer de machine, ou vider son navigateur, voulait dire recommencer les seize.
"""

import json
from pathlib import Path

import httpx
from asgi_lifespan import LifespanManager

from nel3ab_control.app import create_app
from nel3ab_control.settings import Settings
from tests.conftest import SOUHIB, VINCENT

PROFILE = {
    "pads": {
        "adaptateur": {
            "id": "adaptateur",
            "buttons": {"A": {"button": 1, "rest": 0}},
            "triggers": {},
            "sticks": {"x": {"axis": 0, "sign": 1, "rest": 0.25}},
        }
    },
    "keys": {"KeyX": {"kind": "button", "name": "A"}},
}


async def test_what_someone_sets_comes_back_to_them(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/me/bindings", headers=SOUHIB)).json() == {"pads": {}, "keys": {}}

    kept = await client.put("/api/me/bindings", json=PROFILE, headers=SOUHIB)
    assert kept.status_code == 200

    found = (await client.get("/api/me/bindings", headers=SOUHIB)).json()
    # Le repos du stick fait le voyage: c'est LUI qui empêche un personnage de
    # courir tout seul, et un réglage qui perd ce nombre en route ne règle rien.
    assert found["pads"]["adaptateur"]["sticks"]["x"]["rest"] == 0.25
    assert found["keys"]["KeyX"] == {"kind": "button", "name": "A"}


async def test_the_settings_are_written_under_the_address_the_proxy_gave(
    client: httpx.AsyncClient,
) -> None:
    """Le jumeau: on ne règle que SA manette.

    Sans cette moitié, un service qui rangerait tout sous une seule clé
    satisferait le test au-dessus et donnerait à chacun la manette du dernier
    arrivé.
    """
    await client.put("/api/me/bindings", json=PROFILE, headers=SOUHIB)

    autre = (await client.get("/api/me/bindings", headers=VINCENT)).json()
    assert autre == {"pads": {}, "keys": {}}


async def test_without_a_proxy_there_is_no_drawer_to_open(client: httpx.AsyncClient) -> None:
    """Sans identité, la page garde ses réglages dans le navigateur.

    Lire rend du vide plutôt qu'une erreur, parce que la salle marche sans son
    proxy. Écrire, en revanche, doit refuser: garder des réglages sous personne
    les donnerait au suivant qui passe.
    """
    assert (await client.get("/api/me/bindings")).json() == {"pads": {}, "keys": {}}
    assert (await client.put("/api/me/bindings", json=PROFILE)).status_code == 401


async def test_settings_too_big_to_be_settings_are_refused(client: httpx.AsyncClient) -> None:
    """Le plafond, et il protège le disque de la machine.

    Seize commandes par manette tiennent dans deux kilo-octets. Sans plafond, une
    page pourrait remplir le disque avec une requête.
    """
    huge = {"pads": {"gros": {"remplissage": "x" * 40_000}}, "keys": {}}

    assert (await client.put("/api/me/bindings", json=huge, headers=SOUHIB)).status_code == 422
    # Et rien n'a été gardé au passage.
    assert (await client.get("/api/me/bindings", headers=SOUHIB)).json()["pads"] == {}


async def test_the_settings_survive_a_restart(settings: Settings) -> None:
    """Ce qui compte vraiment: retrouver sa manette après un redémarrage.

    Vérifié par le FICHIER plutôt que par un deuxième appel, parce qu'un
    contrôleur qui garderait tout en mémoire passerait un deuxième appel et
    perdrait tout au premier redémarrage, c'est-à-dire au seul moment qui compte.
    """
    from nel3ab_control.api.controllers.bindings import BindingsController

    keeper = BindingsController(settings.bindings_file)
    await keeper.keep("souhib@example.com", PROFILE)

    again = BindingsController(settings.bindings_file)
    assert again.of("souhib@example.com") == PROFILE
    assert json.loads(settings.bindings_file.read_text(encoding="utf-8")) == {
        "souhib@example.com": PROFILE
    }


#: La référence de la salle: ce que quelqu'un qui entre reçoit sans rien régler.
REFERENCE = {
    "pads": {
        "DualSense": {
            "id": "DualSense",
            "buttons": {"A": {"button": 1, "rest": 0}},
            "triggers": {},
            "sticks": {},
        }
    },
    "keys": {"byName": {"défaut": {"KeyX": {"kind": "button", "name": "A"}}}, "active": "défaut"},
}


async def test_a_room_without_a_reference_answers_nothing_rather_than_failing(
    client: httpx.AsyncClient,
) -> None:
    """Une salle qui n'a jamais publié se comporte comme avant.

    C'est ce qui rend le déploiement sans surprise: la page demande, reçoit du
    vide, et garde ses réglages. Répondre 404 obligerait la page à distinguer
    « pas encore publié » de « service cassé », deux choses qu'elle traite pareil.
    """
    assert (await client.get("/api/room/bindings")).json() == {"pads": {}, "keys": {}}


async def test_the_reference_is_readable_without_an_identity(
    client: httpx.AsyncClient,
) -> None:
    """Sans en-tête, contrairement au dossier personnel.

    La référence est ce que la salle PROPOSE à qui entre. Exiger de savoir qui
    demande la rendrait invisible exactement à ceux qui n'ont encore rien réglé,
    c'est-à-dire aux seuls à qui elle sert vraiment.
    """
    published = await client.put("/api/room/bindings", json=REFERENCE, headers=SOUHIB)
    assert published.status_code == 200

    assert (await client.get("/api/room/bindings")).json() == REFERENCE


async def test_only_the_named_person_publishes_the_reference(
    client: httpx.AsyncClient,
) -> None:
    """Le jumeau, et il porte toute la garantie.

    Une référence à laquelle on veut revenir QUOI QU'IL ARRIVE ne vaut rien si
    n'importe qui l'écrase. Le propriétaire de la salle ne convenait pas: il
    change quand quelqu'un part, et il se donne tout seul quand celui qui le
    tient s'absente trois minutes.
    """
    refused = await client.put("/api/room/bindings", json=REFERENCE, headers=VINCENT)

    assert refused.status_code == 403
    # Et rien n'a été écrit: un refus qui publierait quand même serait pire qu'un
    # refus absent, parce qu'il aurait l'air de protéger.
    assert (await client.get("/api/room/bindings")).json() == {"pads": {}, "keys": {}}


async def test_publishing_without_an_identity_is_refused(client: httpx.AsyncClient) -> None:
    """Sans proxy devant, tout le monde est anonyme. Anonyme ne publie pas."""
    assert (await client.put("/api/room/bindings", json=REFERENCE)).status_code == 401


async def test_a_room_with_no_admin_lets_nobody_publish(settings: Settings, tmp_path: Path) -> None:
    """Le défaut d'une salle fraîche: personne ne publie.

    La protection ne vient pas d'une comparaison écrite dans la route mais de la
    frontière d'identité: les deux chemins refusent déjà une adresse vide, donc
    personne ne peut porter celle qui correspondrait à une configuration vide.
    L'essai épingle le COMPORTEMENT sans prétendre que le mécanisme est ici.
    """
    settings.admin = ""
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as bare,
        LifespanManager(app),
    ):
        refused = await bare.put("/api/room/bindings", json=REFERENCE, headers=SOUHIB)

    assert refused.status_code == 403


async def test_the_reference_replaces_rather_than_merges(client: httpx.AsyncClient) -> None:
    """Publier remplace tout.

    Fusionner ferait survivre un profil qu'on vient de retirer, et « retirer de
    la salle » est un bouton qui doit marcher.
    """
    await client.put("/api/room/bindings", json=REFERENCE, headers=SOUHIB)
    await client.put(
        "/api/room/bindings",
        json={"pads": {}, "keys": {"byName": {"guitare": {}}, "active": "guitare"}},
        headers=SOUHIB,
    )

    assert (await client.get("/api/room/bindings")).json()["pads"] == {}


async def test_the_reference_survives_a_restart(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Sur le disque, pas en mémoire. Le service redémarre; la salle reste."""
    await client.put("/api/room/bindings", json=REFERENCE, headers=SOUHIB)

    assert json.loads(settings.room_bindings_file.read_text(encoding="utf-8")) == REFERENCE


async def test_a_reference_too_big_to_be_one_is_refused(client: httpx.AsyncClient) -> None:
    """Le même plafond que les dossiers personnels, et pour la même raison: sans
    lui, une requête peut remplir le disque de la machine."""
    huge = {"pads": {}, "keys": {"byName": {"gros": {"KeyA": "x" * 40_000}}, "active": "gros"}}

    assert (await client.put("/api/room/bindings", json=huge, headers=SOUHIB)).status_code == 422


async def test_the_admin_address_is_read_without_regard_for_case(
    settings: Settings,
) -> None:
    """Une majuscule dans l'unité systemd ne doit pas fermer la porte.

    L'identité arrive en minuscules — `from_headers` et `whois` normalisent tous
    les deux — et la configuration est écrite à la main. Sans mise en minuscules
    des deux côtés, la personne qui tient la salle se voit refuser sa propre
    salle et rien ne dit pourquoi. Le genre de défaut qui coûte une soirée pour
    un caractère.
    """
    settings.admin = "  Souhib@Example.COM  "
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as bare,
        LifespanManager(app),
    ):
        allowed = await bare.put("/api/room/bindings", json=REFERENCE, headers=SOUHIB)

    assert allowed.status_code == 200


async def test_only_the_admin_is_told_they_may_publish(client: httpx.AsyncClient) -> None:
    """La page demande ce qu'ELLE peut faire, pas qui est l'administrateur.

    Un booléen et non l'adresse: personne n'a besoin de connaître l'adresse de
    quelqu'un d'autre pour savoir s'il faut afficher un bouton. Et le jumeau
    compte autant — un booléen toujours vrai montrerait le bouton à tout le
    monde, qui se le verrait refuser sans comprendre.
    """
    assert (await client.get("/api/me", headers=SOUHIB)).json()["publishes"] is True
    assert (await client.get("/api/me", headers=VINCENT)).json()["publishes"] is False


async def test_nobody_is_told_they_may_publish_without_an_identity(
    client: httpx.AsyncClient,
) -> None:
    """Sans proxy devant, personne n'a d'adresse, donc personne ne publie."""
    assert (await client.get("/api/me")).json()["publishes"] is False
