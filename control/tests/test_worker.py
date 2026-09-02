"""Les deux messages entre le plan de contrôle et le worker."""

import anyio
import pytest
from anyio.abc import SocketAttribute, SocketStream

from nel3ab_control.worker import may_decide, tell_owner


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


async def _answering(said: bytes, seat: int) -> bool | None:
    """Pose la question à un faux worker qui répond `said`."""

    async def listener(stream: SocketStream) -> None:
        async with stream:
            await stream.receive(64)
            await stream.send(said)

    async with await anyio.create_tcp_listener(local_host="127.0.0.1", local_port=0) as server:
        port = server.extra(SocketAttribute.local_address)[1]  # noqa: S610
        async with anyio.create_task_group() as group:
            group.start_soon(server.serve, listener)
            await anyio.sleep(0.05)
            answer = await may_decide(f"127.0.0.1:{port}", seat)
            group.cancel_scope.cancel()
    return answer


async def test_the_worker_says_whether_a_seat_may_decide() -> None:
    """La question, et ses deux réponses.

    Le jumeau compte autant que le cas positif: une lecture qui rendrait
    toujours vrai laisserait n'importe quelle page poser un écran de chargement
    sur celui des autres, ce qui est exactement ce que ce contrôle empêche.
    """
    assert await _answering(b"yes\n", 3) is True
    assert await _answering(b"no\n", 3) is False


async def test_a_worker_that_says_something_else_has_not_answered() -> None:
    """Trois états, pas deux, et les confondre coûte cher.

    `False` est un refus, `None` est une absence de réponse, et l'appelant ne
    fait pas la même chose dans les deux cas: sur une absence il tranche
    lui-même, sur un refus il se tait. Un worker qui répondrait `ok` — l'accusé
    de réception de l'AUTRE message — doit compter comme une absence, sinon un
    croisement de fils lirait « je n'ai pas compris » comme « oui ».
    """
    assert await _answering(b"ok\n", 3) is None
    assert await _answering(b"", 3) is None


async def test_a_worker_that_is_not_there_leaves_the_question_open() -> None:
    """Et pas `False`. Un worker muet est un worker qui redémarre, ce qui arrive
    à chaque changement de jeu. Le lire comme un refus rendrait la salle muette
    exactement quand elle a le plus besoin de parler."""
    assert await may_decide("127.0.0.1:1", 2) is None
    assert await may_decide("pas une adresse", 2) is None


@pytest.mark.parametrize("seat", [0, 5, -1])
async def test_a_seat_that_is_not_one_is_refused_without_asking(seat: int) -> None:
    """Une place est `1..=4`. Refuser ici plutôt que d'ouvrir une socket évite
    de demander au worker ce qu'il ne peut pas répondre, et surtout: c'est un
    refus, pas une absence de réponse, donc ça ne retombe pas sur l'ancienne
    règle."""
    assert await may_decide("127.0.0.1:1", seat) is False
