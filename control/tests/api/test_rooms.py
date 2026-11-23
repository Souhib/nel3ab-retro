"""The room a page reads, and the pads it claims."""

import os
import time
from datetime import UTC, datetime

import httpx
import pytest
from fastapi import FastAPI

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.schemas.error import NoSuchSeat, SeatTaken, WorkerUnreachable
from nel3ab_control.parties import Fin, JeuJoue
from nel3ab_control.personnes import empreinte
from nel3ab_control.settings import Settings
from tests.conftest import LIBRARY


async def test_the_room_reports_the_game_the_worker_is_running(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/room")

    assert response.status_code == 200
    room = response.json()
    assert room["name"] == "Salon d'essai"
    assert room["game"] == {
        "index": 1,
        # Le faux worker a la forme d'avant le 21 novembre 2026, sans clé: la
        # page retombe alors sur la position.
        "key": None,
        "guide": None,
        "name": "Super Smash Bros Melee",
        "maker": "Nintendo/HAL Laboratory,Inc.",
        "about": "Let the melee begin!",
        "art": True,
        "console": "?",
    }
    assert [game["name"] for game in room["library"]] == [
        "Mario Kart Double Dash",
        "Super Smash Bros Melee",
    ]


async def test_every_pad_is_listed_even_when_nobody_holds_it(client: httpx.AsyncClient) -> None:
    """A page draws four seats whether or not anybody sits in them."""
    room = (await client.get("/api/room")).json()

    assert [seat["port"] for seat in room["seats"]] == [1, 2, 3, 4]
    assert all(seat["player"] is None for seat in room["seats"])


async def test_a_claimed_pad_carries_the_name(
    client: httpx.AsyncClient, rooms: RoomController
) -> None:
    rooms.claim(2, "sid-souhib", "Souhib")

    room = (await client.get("/api/room")).json()
    assert room["seats"][1] == {
        "port": 2,
        "player": "Souhib",
        "held": None,
        "claim": None,
        "premiere": None,
    }


async def test_a_pad_another_session_claims_is_refused(
    client: httpx.AsyncClient, rooms: RoomController
) -> None:
    rooms.claim(1, "sid-souhib", "Souhib")

    with pytest.raises(SeatTaken):
        rooms.claim(1, "sid-yassine", "Yassine")

    room = (await client.get("/api/room")).json()
    assert room["seats"][0]["player"] == "Souhib", "le refus ne doit rien avoir déplacé"


async def test_claiming_your_own_pad_again_is_not_a_conflict(rooms: RoomController) -> None:
    """Une page qui se reconnecte redit la même chose, et lui répondre non
    l'enfermerait dehors de la place où elle est assise."""
    rooms.claim(3, "sid-souhib", "Souhib")

    rooms.claim(3, "sid-souhib", "Souhib")

    assert rooms.seat_of("sid-souhib") == 3


async def test_leaving_gives_back_only_that_session_s_pads() -> None:
    """Le coeur du modèle: une place appartient à une SESSION, pas à un nom.

    La même personne peut ouvrir la salle sur deux appareils. Avec des places
    rangées par nom, fermer un onglet libérait la manette de l'autre machine, et
    la salle affichait quelqu'un comme parti alors qu'il jouait encore.
    """
    settings = Settings(worker_url="http://worker.test")
    rooms = RoomController(settings, httpx.AsyncClient())
    rooms.claim(1, "portable", "Souhib")
    rooms.claim(2, "bureau", "Souhib")
    rooms.claim(3, "sid-yassine", "Yassine")

    rooms.release("portable", Fin.DECONNECTEE)

    assert [seat.player for seat in rooms.seats()] == [None, "Souhib", "Yassine", None]


async def test_a_worker_that_does_not_answer_says_so() -> None:
    """A room that cannot be described says why, rather than reporting an empty
    library that reads as "you own no games"."""

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nobody there")

    settings = Settings(worker_url="http://worker.test")
    rooms = RoomController(settings, httpx.AsyncClient(transport=httpx.MockTransport(refuse)))

    with pytest.raises(WorkerUnreachable) as raised:
        await rooms.library()

    assert raised.value.status_code == 503
    assert "worker.test" in raised.value.detail


async def test_a_seat_conflict_names_the_pad() -> None:
    """The error a page shows has to say WHICH pad, or the player cannot act on it."""
    settings = Settings()
    rooms = RoomController(settings, httpx.AsyncClient())
    rooms.claim(2, "sid-souhib", "Souhib")

    with pytest.raises(SeatTaken) as raised:
        rooms.claim(2, "sid-yassine", "Yassine")

    assert "2" in raised.value.detail


async def test_the_room_lists_everybody_not_only_the_pads(client: httpx.AsyncClient) -> None:
    """Une salle où quelqu'un regarde sans manette avait l'air vide.

    Les places ne disent que ceux qui jouent. La liste des présents dit aussi les
    spectateurs, ce qui est la moitié d'une soirée à quatre manettes.
    """
    room = (await client.get("/api/room")).json()

    # Personne n'est connecté au salon dans ce test: la liste est vide et les
    # places existent quand même. C'est la distinction qui compte.
    assert room["people"] == []
    assert len(room["seats"]) == 4


async def test_a_room_without_identities_has_no_owner(client: httpx.AsyncClient) -> None:
    """Sans proxy devant, tout le monde est anonyme et personne ne décide.

    C'est le développement local et les pilotes de navigateur. La salle retombe
    alors sur sa règle d'avant, où tenir une manette suffit à changer de jeu:
    refuser tout serait une salle où personne ne peut plus rien.
    """
    room = (await client.get("/api/room")).json()

    assert room["owner"] is None


async def test_a_worker_that_goes_away_does_not_take_the_lobby_with_it(
    settings: Settings, worker: httpx.MockTransport
) -> None:
    """Changer de jeu REDÉMARRE le worker, et toutes les pages se reconnectent
    pendant ce redémarrage.

    Sans ce repli, chaque connexion et chaque départ faisait échouer la diffusion
    du salon: la salle ne disait plus qui était là, et le journal se remplissait
    de traces pour un worker qui revenait cinq secondes plus tard.
    """
    alive = {"ok": True}

    def flaky(request: httpx.Request) -> httpx.Response:
        if not alive["ok"]:
            raise httpx.ConnectError("le worker redémarre")
        return httpx.Response(200, json=LIBRARY)

    async with httpx.AsyncClient(transport=httpx.MockTransport(flaky)) as http:
        rooms = RoomController(settings, http)
        first = await rooms.describe()
        assert first.game is not None

        alive["ok"] = False
        during = await rooms.describe()
        assert [game.name for game in during.library] == [game.name for game in first.library]


async def test_a_worker_that_was_never_there_is_an_error(
    settings: Settings,
) -> None:
    """Le jumeau négatif: une salle qui n'a JAMAIS su quels jeux elle a n'est pas
    une salle qui a perdu le contact, et se taire là cacherait une panne."""

    def dead(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("aucun worker")

    async with httpx.AsyncClient(transport=httpx.MockTransport(dead)) as http:
        with pytest.raises(WorkerUnreachable):
            await RoomController(settings, http).describe()


def test_an_unanswered_request_expires(rooms: RoomController) -> None:
    """Un « oui » tapé cinq minutes plus tard téléporterait une manette au
    milieu d'une partie, et celui qui avait demandé aurait oublié la question."""
    rooms.asked(2, "sid-vincent", now=100.0)

    assert rooms.take_ask(2, now=109.0) == "sid-vincent"

    rooms.asked(2, "sid-vincent", now=100.0)
    assert rooms.take_ask(2, now=111.0) is None


def test_an_expired_request_is_forgotten_not_kept(rooms: RoomController) -> None:
    """Le jumeau négatif: une demande expirée ne doit pas rester à traîner et
    répondre plus tard à la question suivante."""
    rooms.asked(3, "sid-vincent", now=100.0)
    assert rooms.take_ask(3, now=200.0) is None

    assert rooms.take_ask(3, now=200.0) is None


async def test_a_worker_that_still_lists_plain_names_is_understood(
    settings: Settings,
) -> None:
    """Le worker et ce service redémarrent séparément.

    Pendant les quelques secondes où l'un est neuf et l'autre pas, la salle doit
    continuer à répondre. Un nom seul est ce que le worker disait avant
    d'apprendre à lire les jaquettes.
    """

    def old_worker(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"players": 4, "current": 0, "roms": ["Melee"]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(old_worker)) as http:
        library, running = await RoomController(settings, http).library()

    assert [game.name for game in library] == ["Melee"]
    assert running is not None
    assert running.art is False, "sans jaquette plutôt qu'avec une qui n'existe pas"


def test_a_seat_that_does_not_exist_cannot_be_claimed(settings: Settings) -> None:
    """Le dictionnaire des places n'accepte que des places.

    Sans ce refus, `claim(2**40, ...)` marchait: la salle retenait une place que
    personne ne peut voir ni libérer, et une page pouvait en créer autant qu'elle
    voulait. Une définition de « une place existe » vit ici, parce que c'est ici
    que les places sont retenues.
    """
    rooms = RoomController(settings, httpx.AsyncClient())

    for absurd in (0, -1, 5, 999999, 2**40):
        with pytest.raises(NoSuchSeat):
            rooms.claim(absurd, "sid-souhib", "Souhib")

    assert all(seat.player is None for seat in rooms.seats())


def test_the_four_real_seats_are_still_claimable(settings: Settings) -> None:
    """Le jumeau. Une borne qui refuserait tout satisferait le test au-dessus."""
    rooms = RoomController(settings, httpx.AsyncClient())

    for port in (1, 2, 3, 4):
        rooms.claim(port, f"sid-{port}", f"joueur {port}")

    assert [seat.player for seat in rooms.seats()] == [
        "joueur 1",
        "joueur 2",
        "joueur 3",
        "joueur 4",
    ]


async def test_a_session_holds_one_seat_at_a_time() -> None:
    """Se rebrancher ailleurs rend la place d'avant.

    Le défaut du 5 septembre 2026: `claim` retenait la nouvelle place sans
    lâcher l'ancienne. Une page qui recharge et à qui le worker donne un autre
    port occupait alors DEUX places, et son nom s'affichait sous deux numéros —
    rapporté comme « mon nom apparaît sous joueur 1 alors que je suis 2 ».
    """
    settings = Settings()
    rooms = RoomController(settings, httpx.AsyncClient())

    rooms.claim(1, "sid-souhib", "Souhib")
    rooms.claim(2, "sid-souhib", "Souhib")

    held = {seat.port: seat.player for seat in rooms.seats()}
    assert held[2] == "Souhib"
    assert held[1] is None, f"la place d'avant doit être rendue: {held}"


async def test_a_seat_held_by_somebody_gone_can_be_taken() -> None:
    """Une place retenue par une socket morte se rend, elle ne bloque pas.

    Sur un rechargement, l'ancienne socket tient encore la place quand la
    nouvelle l'annonce: le worker, lui, a déjà réattribué le port. Refuser la
    nouvelle laissait la salle afficher l'ancien état, et le refus n'était même
    pas rattrapé — le gestionnaire mourait avant de prévenir qui que ce soit.
    """
    settings = Settings()
    rooms = RoomController(settings, httpx.AsyncClient())
    rooms.claim(1, "sid-avant", "Souhib")

    # Seule la nouvelle socket est encore là.
    rooms.forget_absent({"sid-apres"})
    rooms.claim(1, "sid-apres", "Souhib")

    assert rooms.holder_of(1) == "sid-apres"


async def test_a_seat_held_by_somebody_still_here_is_left_alone() -> None:
    """Le jumeau: on ne rend que ce qui est vraiment parti.

    Sans lui, un balayage qui viderait tout passerait l'essai du dessus et
    libérerait la manette de quelqu'un en train de jouer.
    """
    settings = Settings()
    rooms = RoomController(settings, httpx.AsyncClient())
    rooms.claim(1, "sid-souhib", "Souhib")
    rooms.claim(2, "sid-yassine", "Yassine")

    rooms.forget_absent({"sid-souhib", "sid-yassine"})

    assert rooms.holder_of(1) == "sid-souhib"
    assert rooms.holder_of(2) == "sid-yassine"


async def test_a_page_of_one_room_is_told_about_that_room_only(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    """Le défaut relevé par l'audit du 20 novembre 2026.

    La dépendance choisissait bien le contrôleur de la salle annoncée par la
    page, mais la route décrivait les présents et le chef de la salle 1. Une page
    de la salle 2 voyait donc qui jouait dans la salle 1, et pas qui était avec
    elle.
    """
    people = app.state.people
    people.arrived("sid-souhib", "souhib@example.com", "Souhib", 1)
    people.arrived("sid-vincent", "vincent@example.com", "Vincent", 2)
    people.arrived("sid-yassine", "yassine@example.com", "Yassine", 2)

    two = (await client.get("/api/room", headers={"X-Nel3ab-Salle": "2"})).json()

    assert [person["name"] for person in two["people"]] == ["Vincent", "Yassine"]
    assert two["owner"]["name"] == "Vincent"


async def test_room_one_still_sees_its_own_people(client: httpx.AsyncClient, app: FastAPI) -> None:
    """Le jumeau: une route qui rendrait toujours la salle 2, ou personne,
    passerait l'essai du dessus. Le paramètre `?salle=` dit la même chose que
    l'en-tête, et l'absence des deux veut dire la salle 1."""
    people = app.state.people
    people.arrived("sid-souhib", "souhib@example.com", "Souhib", 1)
    people.arrived("sid-vincent", "vincent@example.com", "Vincent", 2)

    answers = {
        "en-tête": await client.get("/api/room", headers={"X-Nel3ab-Salle": "1"}),
        "paramètre": await client.get("/api/room", params={"salle": "1"}),
        "rien": await client.get("/api/room"),
    }
    for asked, answer in answers.items():
        one = answer.json()
        assert [person["name"] for person in one["people"]] == ["Souhib"], asked
        assert one["owner"]["name"] == "Souhib", asked
    three = (await client.get("/api/room", params={"salle": "3"})).json()
    assert three["people"] == []
    assert three["owner"] is None


def _worker_avec_cles(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "players": 4,
            "current": None,
            "roms": [
                {"name": "Super Smash Bros Melee", "console": "gc", "key": "Melee.rvz"},
                {"name": "Mario Kart", "console": "gc", "key": "Kart.rvz"},
            ],
        },
    )


async def test_the_room_names_its_last_game_from_its_own_folder(settings: Settings) -> None:
    """D06: la salle sur son menu dit encore à quoi elle a joué en dernier, et
    quand ce jeu a été choisi. Le titre vient de la bibliothèque du worker."""
    dossier = settings.salles_dir / "2"
    dossier.mkdir(parents=True)
    (dossier / "chosen-rom").write_text("Kart.rvz")
    os.utime(dossier / "chosen-rom", (1_763_666_000.0, 1_763_666_000.0))

    async with httpx.AsyncClient(transport=httpx.MockTransport(_worker_avec_cles)) as http:
        room = await RoomController(settings, http, 2).describe()

    assert room.game is None
    assert room.dernier_jeu is not None
    assert (room.dernier_jeu.cle, room.dernier_jeu.titre) == ("Kart.rvz", "Mario Kart")
    assert room.dernier_jeu.quand == datetime.fromtimestamp(1_763_666_000.0, tz=UTC)


async def test_a_last_game_the_library_no_longer_has_is_not_named(settings: Settings) -> None:
    """Le jumeau: le fichier retenu n'est plus là, et la salle n'invente rien.
    Et la salle 1 ne lit pas le dossier de la salle 2."""
    (settings.salles_dir / "2").mkdir(parents=True)
    (settings.salles_dir / "2" / "chosen-rom").write_text("Parti.rvz")
    (settings.salles_dir / "1").mkdir(parents=True)
    (settings.salles_dir / "1" / "chosen-rom").write_text("Kart.rvz")

    async with httpx.AsyncClient(transport=httpx.MockTransport(_worker_avec_cles)) as http:
        deux = await RoomController(settings, http, 2).describe()
        trois = await RoomController(settings, http, 3).describe()

    assert deux.dernier_jeu is None
    assert trois.dernier_jeu is None, "la salle 3 n'a rien retenu"


class WorkerQuiChange:
    """Un worker de papier dont le jeu en cours change au fil de l'essai."""

    def __init__(self) -> None:
        self.courant: int | None = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "players": 4,
                "current": self.courant,
                "roms": [
                    {"name": "Super Smash Bros Melee", "console": "gc", "key": "Melee.rvz"},
                    {"name": "Mario Kart", "console": "gc", "key": "Kart.rvz"},
                ],
            },
        )


MELEE_JOUE = JeuJoue(cle="Melee.rvz", console="gc", titre="Super Smash Bros Melee")


async def test_the_room_says_who_launched_the_running_game_and_on_which_save(
    settings: Settings,
) -> None:
    """D08: une page qui arrive pendant la partie lit « Sami l'a lancé sur sa
    sauvegarde. » Le repère de Sami, jamais son adresse ni son empreinte."""
    people = PeopleController(settings.state_file)
    worker = WorkerQuiChange()
    async with httpx.AsyncClient(transport=httpx.MockTransport(worker)) as http:
        rooms = RoomController(settings, http, 1)
        await rooms.library()
        rooms.tablee.lance("sami@example.com", "Sami", MELEE_JOUE, 2)
        worker.courant = 0

        room = await rooms.describe(people)

    assert room.lancement is not None
    assert room.lancement.par.name == "Sami"
    assert room.lancement.par.id == people.repere("sami@example.com")
    assert room.lancement.sauvegarde == "lanceur"
    texte = room.model_dump_json()
    assert "sami@example.com" not in texte
    assert empreinte("sami@example.com") not in texte
    sienne = room.vue_par(people.repere("sami@example.com")).lancement
    autre = room.vue_par(None).lancement
    assert sienne is not None and autre is not None
    assert (sienne.par.moi, autre.par.moi) == (True, False)


async def test_a_lobby_that_restarted_does_not_invent_the_launch(settings: Settings) -> None:
    """Le jumeau: un salon neuf n'a vu aucun lancement, la page dira « inconnue »."""
    worker = WorkerQuiChange()
    worker.courant = 0
    async with httpx.AsyncClient(transport=httpx.MockTransport(worker)) as http:
        room = await RoomController(settings, http, 1).describe()

    assert room.game is not None
    assert room.lancement is None


async def test_a_game_that_came_back_without_the_lobby_has_no_launcher(
    settings: Settings,
) -> None:
    """Melee lancé par Sami, puis Mario Kart, puis Melee revenu par le menu du
    worker sans passer par le salon: ce n'est plus le lancement de Sami."""
    worker = WorkerQuiChange()
    async with httpx.AsyncClient(transport=httpx.MockTransport(worker)) as http:
        rooms = RoomController(settings, http, 1)
        await rooms.library()
        rooms.tablee.lance("sami@example.com", "Sami", MELEE_JOUE, 2)
        worker.courant = 0
        assert (await rooms.describe()).lancement is not None
        worker.courant = 1
        assert (await rooms.describe()).lancement is None, "Mario Kart n'a pas été lancé ici"
        worker.courant = 0

        room = await rooms.describe()

    assert room.lancement is None


async def test_relaunching_the_running_game_keeps_its_launcher(settings: Settings) -> None:
    """Le jumeau: relancer le jeu qui tourne ne fait voir aucun changement."""
    worker = WorkerQuiChange()
    worker.courant = 0
    async with httpx.AsyncClient(transport=httpx.MockTransport(worker)) as http:
        rooms = RoomController(settings, http, 1)
        await rooms.library()
        rooms.tablee.lance(None, "Bo", MELEE_JOUE, 1)

        room = await rooms.describe()

    assert room.lancement is not None
    assert (room.lancement.par.name, room.lancement.par.id) == ("Bo", None)
    assert room.lancement.sauvegarde == "commune"


class WorkerAJalons:
    """Un worker de papier qui publie (ou non) les jalons de son démarrage."""

    def __init__(self, jalons: dict | None) -> None:
        self.jalons = jalons
        self.muet = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.muet:
            raise httpx.ConnectError("il redémarre")
        corps = {"players": 4, "current": 0, "roms": [{"name": "Melee", "key": "Melee.rvz"}]}
        return httpx.Response(200, json={**corps, **(self.jalons or {})})


async def test_the_room_says_where_the_start_of_its_game_stands(settings: Settings) -> None:
    """D04: moteur lancé, première image partie, et depuis quand."""
    maintenant_ms = int(time.time() * 1000)
    worker = WorkerAJalons(
        {"depuis_ms": maintenant_ms - 30_000, "moteur": "lance", "image_ms": maintenant_ms}
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(worker)) as http:
        room = await RoomController(settings, http, 1).describe()

    assert room.partie is not None
    assert (room.partie.lance, room.partie.image) == (True, True)
    assert room.partie.depuis_s == pytest.approx(30, abs=2)


async def test_a_milestone_not_reached_yet_is_false(settings: Settings) -> None:
    """Le worker publie ses jalons: l'absence de `moteur` veut dire « pas encore »."""
    worker = WorkerAJalons({"depuis_ms": int(time.time() * 1000)})
    async with httpx.AsyncClient(transport=httpx.MockTransport(worker)) as http:
        room = await RoomController(settings, http, 1).describe()

    assert room.partie is not None
    assert (room.partie.lance, room.partie.image) == (False, False)


async def test_an_older_worker_says_nothing_rather_than_not_started(settings: Settings) -> None:
    """Le jumeau: sans `depuis_ms`, on ne sait pas, ce qui n'est pas « pas lancé »."""
    async with httpx.AsyncClient(transport=httpx.MockTransport(WorkerAJalons(None))) as http:
        room = await RoomController(settings, http, 1).describe()

    assert room.partie is not None
    assert (room.partie.lance, room.partie.image, room.partie.depuis_s) == (None, None, None)


async def test_a_restarting_worker_does_not_keep_the_old_milestones(settings: Settings) -> None:
    """La bibliothèque d'avant reste affichée pendant une relance, ses jalons non:
    ils diraient « image partie » d'un jeu qui ne tourne plus."""
    maintenant_ms = int(time.time() * 1000)
    worker = WorkerAJalons(
        {"depuis_ms": maintenant_ms, "moteur": "lance", "image_ms": maintenant_ms}
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(worker)) as http:
        rooms = RoomController(settings, http, 1)
        assert (await rooms.describe()).partie is not None
        worker.muet = True

        room = await rooms.describe()

    assert room.game is not None, "le jeu d'avant reste affiché"
    assert room.partie is None
