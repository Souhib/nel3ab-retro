"""Deux réglages simultanés ne partagent jamais leur écriture temporaire."""

import json
from pathlib import Path
from types import SimpleNamespace

import anyio
import pytest

from nel3ab_control.api.controllers import bindings, people


@pytest.mark.parametrize("kind", ["pads", "reference", "names"])
async def test_writes_are_serialized(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    store = tmp_path / "settings.json"
    module = people if kind == "names" else bindings
    real_write = module._write
    started = anyio.Event()
    release = anyio.Event()
    writes = []

    async def delayed_write(_function, path, value):
        writes.append(value)
        started.set()
        await release.wait()
        real_write(path, value)

    monkeypatch.setattr(module, "to_thread", SimpleNamespace(run_sync=delayed_write))
    if kind == "pads":
        controller = bindings.BindingsController(store)

        async def change(login):
            await controller.keep(login, {"keys": login})

        expected = {"one": {"keys": "one"}, "two": {"keys": "two"}}
    elif kind == "names":
        names = people.PeopleController(store)

        async def change(login):
            await names.rename(login, login)

        expected = {"one": "one", "two": "two"}
    else:
        reference = bindings.RoomBindingsController(store)

        async def change(login):
            await reference.publish({"keys": login})

        expected = {"keys": "two"}

    async with anyio.create_task_group() as tasks:
        tasks.start_soon(change, "one")
        await started.wait()
        tasks.start_soon(change, "two")
        await anyio.wait_all_tasks_blocked()
        concurrent = len(writes)
        release.set()

    assert concurrent == 1
    assert len(writes) == 2
    assert json.loads(store.read_text()) == expected
    assert store.with_suffix(".json.bak").is_file()
