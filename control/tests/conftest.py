"""What every test needs: an app whose worker is a fake, and a client for it."""

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.controllers.salles import SallesController
from nel3ab_control.app import create_app
from nel3ab_control.settings import Settings
from tests.faux_systeme import FauxSysteme

LIBRARY = {
    "players": 4,
    "current": 1,
    "roms": [
        {"name": "Mario Kart Double Dash", "maker": None, "about": None, "art": False},
        {
            "name": "Super Smash Bros Melee",
            "maker": "Nintendo/HAL Laboratory,Inc.",
            "about": "Let the melee begin!",
            "art": True,
        },
    ],
}


@pytest.fixture(autouse=True)
def isolate_worker_control(monkeypatch: pytest.MonkeyPatch) -> None:
    """Un test de salon ne doit jamais nommer le propriétaire du worker réel.

    Les scénarios de protocole donnent leur propre port éphémère. Les autres
    utilisent une porte fermée, même sur la machine qui héberge une partie.
    """
    monkeypatch.setenv("NEL3AB_WORKER_CONTROL", "127.0.0.1:1")


@pytest.fixture(autouse=True)
def isolate_personal_state(
    monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory
) -> None:
    """Aucun essai n'écrit au vrai journal des parties ni ne lit les vraies sauvegardes.

    Par l'environnement, et pas seulement par la fixture `settings`: plusieurs
    essais construisent leurs propres réglages, `Settings(...)` ou `Settings()`,
    sans nommer ces dossiers. Le 21 novembre 2026, le premier passage de la
    suite avec le journal des parties a écrit cinq fichiers d'identités d'essai
    dans `~/.local/state/nel3ab/parties`, par un essai de socket qui ne
    l'isolait pas. Ils ont été retirés; ce garde existe pour que ça ne se
    reproduise pas, et `test_personal_state_is_isolated` le vérifie.
    """
    racine = tmp_path_factory.mktemp("etat-personnel")
    monkeypatch.setenv("NEL3AB_PARTIES_DIR", str(racine / "parties"))
    monkeypatch.setenv("NEL3AB_PERSONAL_SAVE_ROOT", str(racine / "personal-saves"))
    monkeypatch.setenv("NEL3AB_SWITCH_CONFIG", str(racine / "switch.json"))
    monkeypatch.setenv("NEL3AB_SWITCH2_CONFIG", str(racine / "switch2.json"))


@pytest.fixture(autouse=True)
def isolate_tailscaled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Un test ne demande jamais au VRAI tailscaled qui est derrière une adresse.

    Sans l'en-tête du proxy, l'identité se demande à tailscaled par sa socket
    locale. Les essais qui veulent « personne » passaient donc par le tailscaled
    de la machine qui héberge les parties, et leur verdict dépendait de lui. Ici,
    personne n'est reconnu sans l'en-tête; `test_identity.py` pose ses propres
    doubles par-dessus.
    """
    from nel3ab_control import identity

    async def nobody(_address: str) -> None:
        return None

    monkeypatch.setattr(identity, "whois", nobody)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # Les pseudos vont dans un dossier jetable: un test qui écrit dans le vrai
    # fichier renommerait quelqu'un pour de bon.
    return Settings(
        room_name="Salon d'essai",
        worker_url="http://worker.test",
        state_file=tmp_path / "people.json",
        # Et les réglages de manette, pour exactement la même raison. Oubliés au
        # premier jet, les tests écrivaient dans le VRAI fichier: ils auraient
        # remplacé les manettes de quelqu'un par celles d'un test.
        bindings_file=tmp_path / "bindings.json",
        # La référence de la salle, jetable aussi: un essai qui publie dans le
        # vrai fichier remplacerait la configuration de tout le monde.
        room_bindings_file=tmp_path / "room-bindings.json",
        # Et une adresse qui a le droit de publier, sinon aucun essai ne
        # pourrait couvrir le chemin qui écrit.
        admin="souhib@example.com",
        # Et le journal aussi, pour la même raison ET une pire: le journal
        # BALAIE ce qu'il trouve de trop vieux. Une suite de tests pointée sur le
        # vrai dossier effacerait la soirée qu'on voulait relire, et le premier
        # jet de ce fichier l'a fait.
        journal_dir=tmp_path / "sessions",
        # Le journal des parties et les sauvegardes, nommés ici aussi pour que
        # l'essai les lise dans `settings` plutôt que dans l'environnement.
        parties_dir=tmp_path / "parties",
        personal_save_root=tmp_path / "personal-saves",
        switch_config=tmp_path / "switch.json",
        switch2_config=tmp_path / "switch2.json",
        # La quarantaine et les dossiers de jeux, jetables eux aussi. Sans ces
        # deux lignes, un essai d'import écrirait sous ~/.local/state et
        # rangerait un faux jeu dans la VRAIE bibliothèque de la machine.
        imports_dir=tmp_path / "imports",
        rom_dir=f"{tmp_path / 'roms' / 'gc'}:{tmp_path / 'roms' / 'wii'}",
        # Et les dossiers des salles: ouvrir une salle y pose le marqueur « sans
        # jeu », et le salon y lit la bibliothèque que les workers écrivent
        # (ADR D24). Pointé sur le vrai dossier, un essai poserait le marqueur
        # chez la salle qui tourne pour de vrai, et listerait les jeux de la
        # machine.
        salles_dir=tmp_path / "salles",
    )


#: L'origine des pages servies par le salon, que tout navigateur joint à une
#: écriture. Le client d'essai l'envoie par défaut, comme la vraie page; les
#: essais de la garde d'origine la retirent ou la remplacent.
PAGE = {"Origin": "https://nel3ab.app"}


#: L'en-tête que le proxy Tailscale écrit, et que le client ne peut pas forger.
SOUHIB = {
    "Tailscale-User-Login": "souhib@example.com",
    "Tailscale-User-Name": "Souhib Trabelsi",
}
VINCENT = {"Tailscale-User-Login": "vincent@example.com", "Tailscale-User-Name": "Vincent Lemaire"}


@pytest.fixture
def worker() -> httpx.MockTransport:
    """A worker that answers the library and nothing else.

    A fake at the HTTP boundary rather than a patched controller: the thing worth
    testing is that this service reads what the worker really sends, and a mocked
    controller would test the mock.
    """

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/roms":
            return httpx.Response(200, json=LIBRARY)
        return httpx.Response(404)

    return httpx.MockTransport(handle)


@pytest.fixture
def systeme() -> FauxSysteme:
    """Le systemd que voit le contrôleur des salles de l'application d'essai."""
    return FauxSysteme()


@pytest.fixture
async def app(
    settings: Settings, worker: httpx.MockTransport, systeme: FauxSysteme
) -> AsyncIterator[FastAPI]:
    """L'application, avec un faux worker et un faux systemd derrière."""
    built = create_app(settings)
    async with LifespanManager(built):
        built.state.client = httpx.AsyncClient(transport=worker)
        # Le contrôleur des salles du cycle de vie garde le VRAI lanceur, et
        # interroge les vrais workers numérotés (8110, 8120...). Un essai qui
        # écrit sur `/api/salles` démarrerait ou arrêterait une vraie salle.
        # Remplacé avant la première requête: ni lanceur réel, ni client, ni
        # lecteur de places.
        built.state.salles = SallesController(settings, systeme)
        # DANS le registre, et pas à côté: les gestionnaires demandent le
        # contrôleur de leur salle au registre, donc un contrôleur posé ailleurs
        # serait observé par l'essai pendant que le salon en utilise un autre.
        built.state.rooms = RoomController(settings, built.state.client, 1, built.state.parties)
        built.state.salons.poser(1, built.state.rooms)
        # Les deux autres salles aussi, sur le même faux worker. Sans ça, une
        # page qui annonce la salle 2 ferait fabriquer au registre un contrôleur
        # pointé sur les VRAIS ports de la salle 2 (8120 et 8121), puisque le
        # registre déduit l'adresse du numéro.
        for numero in (2, 3):
            built.state.salons.poser(
                numero, RoomController(settings, built.state.client, numero, built.state.parties)
            )
        yield built


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://control.test", headers=PAGE
    ) as http:
        yield http


@pytest.fixture
def rooms(app: FastAPI) -> RoomController:
    """Le contrôleur derrière ce client.

    Par le contrôleur et non par une route: réserver une place passe par la
    socket du salon, qui sait QUELLE session parle. Une route HTTP ne le sait
    pas, et celle qui existait a été retirée pour cette raison.
    """
    controller: RoomController = app.state.rooms
    return controller
