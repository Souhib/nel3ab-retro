"""Les deux messages entre le plan de contrôle et le worker."""

import anyio
import anyio.lowlevel
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


@pytest.mark.parametrize(
    "answer",
    [
        b"no\n",
        b"- - -\n",
        b"- - - - extra\n",
        b"\xff - - -\n",
        b"anything - - -\n",
        b"a" * 32 + b"-1 " + b"a" * 32 + b"-1 - -\n",
    ],
)
def test_an_invalid_snapshot_is_not_four_free_seats(answer: bytes) -> None:
    from nel3ab_control.worker import seat_receipts

    assert seat_receipts(answer) is None


async def test_seats_can_arrive_in_several_reads() -> None:
    from nel3ab_control.worker import read_seats

    receipt = "a" * 32 + "-1"
    heard = []

    async def listener(stream: SocketStream) -> None:
        async with stream:
            heard.append(await stream.receive(64))
            await stream.send(receipt[:10].encode())
            await anyio.lowlevel.checkpoint()
            await stream.send((receipt[10:] + " - - -\n").encode())

    async with await anyio.create_tcp_listener(local_host="127.0.0.1", local_port=0) as server:
        port = server.extra(SocketAttribute.local_address)[1]  # noqa: S610
        async with anyio.create_task_group() as group:
            group.start_soon(server.serve, listener)
            assert await read_seats(f"127.0.0.1:{port}") == [receipt, None, None, None]
            group.cancel_scope.cancel()
    assert heard == [b"seats\n"]


def test_four_free_seats_are_a_valid_snapshot() -> None:
    from nel3ab_control.worker import seat_receipts

    assert seat_receipts(b"- - - -\n") == [None, None, None, None]


async def heard_launch(key: str | None = None) -> tuple[bool, list[bytes]]:
    """Ce qu'un vrai port de contrôle entend d'un lancement, et la réponse rendue."""
    from nel3ab_control.worker import launch_prepared

    heard: list[bytes] = []

    async def listener(stream: SocketStream) -> None:
        async with stream:
            heard.append(await stream.receive(2048))
            await stream.send(b"ok\n")

    claim = "a" * 32 + "-1"
    async with await anyio.create_tcp_listener(local_host="127.0.0.1", local_port=0) as server:
        port = server.extra(SocketAttribute.local_address)[1]  # noqa: S610
        async with anyio.create_task_group() as group:
            group.start_soon(server.serve, listener)
            await anyio.sleep(0.05)
            said = await launch_prepared(
                f"127.0.0.1:{port}",
                1,
                claim,
                0,
                0,
                [0, 0, 0, 0],
                [claim, "-", "-", "-"],
                key=key,
            )
            await anyio.sleep(0.05)
            group.cancel_scope.cancel()
    return said, heard


async def test_a_launch_by_key_sends_the_file_name_in_hexadecimal() -> None:
    """La clé part entière, espaces et accents compris, sans couper la ligne."""
    key = "Mario Kart (Rev 1) é.rvz"
    said, heard = await heard_launch(key=key)
    assert said is True
    fields = heard[0].decode().split()
    assert fields[3] == "k" + key.encode().hex()
    assert bytes.fromhex(fields[3][1:]).decode() == key
    assert len(fields) == 14


async def test_without_a_key_the_position_still_goes_for_an_older_worker() -> None:
    said, heard = await heard_launch()
    assert said is True
    assert heard[0].decode().split()[3] == "0"


@pytest.mark.parametrize(
    "key", ["", ".", "..", "../x", "/etc/shadow", "gc/Melee.rvz", "a\nb", "é" * 128]
)
async def test_a_path_like_key_never_reaches_the_worker(key: str) -> None:
    said, heard = await heard_launch(key=key)
    assert said is False
    assert heard == [], "une clé qui ressemble à un chemin est partie vers le worker"
