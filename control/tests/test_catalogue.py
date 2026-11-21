"""La bibliothèque lue sans salle ouverte, dans les fichiers que les workers écrivent."""

import json
from pathlib import Path

import httpx
import pytest
from asgi_lifespan import LifespanManager

from nel3ab_control.app import create_app
from nel3ab_control.catalogue import NAME, freshest, read_one
from nel3ab_control.settings import Settings

#: Les octets exacts que `library_file` écrit, épinglés par le test Rust
#: `the_library_file_has_the_room_entries_and_no_room_state`. Les deux essais
#: tiennent la même chaîne: un champ renommé d'un côté fait rougir l'autre.
WRITTEN_BY_THE_WORKER = (
    '{"version":1,"scanned_ms":1763700000123,"roms":[{"name":"Melee","maker":null,'
    '"about":null,"art":false,"console":"gc","key":"Melee.rvz"}]}'
)


def room(salles: Path, numero: str, contents: str | dict) -> Path:
    dossier = salles / numero
    dossier.mkdir(parents=True, exist_ok=True)
    chemin = dossier / NAME
    chemin.write_text(contents if isinstance(contents, str) else json.dumps(contents))
    return chemin


def library(scanned_ms: int, *keys: str) -> dict:
    return {
        "version": 1,
        "scanned_ms": scanned_ms,
        "roms": [
            {
                "name": key.rsplit(".", 1)[0],
                "maker": None,
                "about": None,
                "art": False,
                "console": "gc",
                "key": key,
            }
            for key in keys
        ],
    }


def test_what_the_worker_writes_is_what_the_lobby_reads(tmp_path: Path) -> None:
    found = read_one(room(tmp_path, "1", WRITTEN_BY_THE_WORKER), 1)
    assert found is not None
    assert found.scanned_ms == 1_763_700_000_123
    assert [(game.key, game.name, game.console, game.art) for game in found.games] == [
        ("Melee.rvz", "Melee", "gc", False)
    ]


def test_the_freshest_room_wins(tmp_path: Path) -> None:
    """Une salle démarrée avant l'arrivée d'un fichier décrit la liste d'avant."""
    room(tmp_path, "1", library(100, "Zelda.rvz"))
    room(tmp_path, "2", library(300, "Animal.rvz", "Zelda.rvz"))
    room(tmp_path, "3", library(200, "Zelda.rvz"))

    found = freshest(tmp_path)

    assert found is not None
    assert (found.room, [game.key for game in found.games]) == (2, ["Animal.rvz", "Zelda.rvz"])


@pytest.mark.parametrize(
    "broken",
    [
        "{",
        json.dumps({**library(900, "Zelda.rvz"), "version": 2}),
        json.dumps({**library(900, "Zelda.rvz"), "scanned_ms": -1}),
        json.dumps(library(900, "../Zelda.rvz")),
        json.dumps(library(900, "/home/x/roms/gc/Zelda.rvz")),
        json.dumps(library(900, "Zelda.rvz", "Zelda.rvz")),
        json.dumps({**library(900), "roms": [{"name": "Zelda", "console": "gc", "art": False}]}),
    ],
)
def test_a_broken_file_is_set_aside_whole_for_the_next_one(tmp_path: Path, broken: str) -> None:
    """Plus frais mais faux: écarté en entier, et le suivant prend sa place."""
    room(tmp_path, "1", library(100, "Melee.rvz"))
    room(tmp_path, "2", broken)

    found = freshest(tmp_path)

    assert found is not None
    assert (found.room, [game.key for game in found.games]) == (1, ["Melee.rvz"])


def test_only_numbered_rooms_are_read(tmp_path: Path) -> None:
    room(tmp_path, "session", library(900, "Ailleurs.rvz"))
    room(tmp_path, "0", library(900, "Zero.rvz"))
    assert freshest(tmp_path) is None
    assert freshest(tmp_path / "absent") is None


async def test_the_lobby_lists_the_library_without_asking_a_worker(tmp_path: Path) -> None:
    asked: list[str] = []

    def worker(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        return httpx.Response(503)

    settings = Settings(
        room_name="essai",
        worker_url="http://worker.test",
        state_file=tmp_path / "people.json",
        bindings_file=tmp_path / "bindings.json",
        room_bindings_file=tmp_path / "room-bindings.json",
        journal_dir=tmp_path / "sessions",
        salles_dir=tmp_path / "salles",
    )
    built = create_app(settings)
    async with LifespanManager(built):
        built.state.client = httpx.AsyncClient(transport=httpx.MockTransport(worker))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=built), base_url="http://control.test"
        ) as http:
            missing = await http.get("/api/catalogue")
            room(settings.salles_dir, "1", WRITTEN_BY_THE_WORKER)
            found = await http.get("/api/catalogue")

    # Le jumeau d'abord: sans fichier, une absence nommée, pas une liste vide.
    assert missing.status_code == 404
    assert "aucune salle" in missing.json()["detail"]
    assert found.status_code == 200
    assert found.json()["games"][0]["key"] == "Melee.rvz"
    assert asked == [], "le salon a demandé la liste à un worker"
