"""Le seul message que le plan de contrôle envoie au worker."""

import anyio
import pytest
from anyio.abc import SocketAttribute, SocketStream

from nel3ab_control.worker import tell_owner


async def test_the_worker_is_told_which_seat_decides() -> None:
    """Une ligne, et une réponse. Contre une vraie socket plutôt qu'un faux
    objet: ce qui vaut d'être vérifié ici est ce qui part sur le fil."""
    heard: list[bytes] = []

    async def listener(stream: SocketStream) -> None:
        async with stream:
            heard.append(await stream.receive(64))
            await stream.send(b"ok\n")

    async with await anyio.create_tcp_listener(local_host="127.0.0.1", local_port=0) as server:
        # `extra` d'anyio, pas celui de Django: la règle S610 vise une méthode
        # de requête ORM qui porte le même nom. Il n'y a pas de base ici.
        port = server.extra(SocketAttribute.local_address)[1]  # noqa: S610
        async with anyio.create_task_group() as group:
            group.start_soon(server.serve, listener)
            await anyio.sleep(0.05)
            assert await tell_owner(f"127.0.0.1:{port}", 3) is True
            group.cancel_scope.cancel()

    assert heard == [b"owner 3\n"]


async def test_a_worker_that_is_not_there_is_not_an_error() -> None:
    """Le worker redémarre à chaque changement de jeu, et la salle marche sans
    lui le temps qu'il revienne. Remonter une erreur là ferait échouer une
    diffusion de salon pour un service qui revient en cinq secondes."""
    assert await tell_owner("127.0.0.1:1", 2) is False


@pytest.mark.parametrize("address", ["pas une adresse", "127.0.0.1:abc"])
async def test_an_address_that_is_not_one_does_not_raise(address: str) -> None:
    assert await tell_owner(address, 1) is False
