"""Le relais préféré ne doit pas être présenté comme le trajet utilisé."""

from unittest.mock import AsyncMock

import httpx
import pytest

from nel3ab_control.connection import Connection, read_connection, route_of


@pytest.mark.parametrize(
    "active,cur,relay,expected",
    [
        (True, "192.0.2.1:1234", "par", "direct"),
        (True, "", "par", "relay"),
        (False, "192.0.2.1:1234", "par", "unknown"),
        (True, "", "", "unknown"),
    ],
)
def test_observed_route(active, cur, relay, expected):
    status = {
        "Peer": {
            "private-key": {
                "TailscaleIPs": ["100.64.0.2"],
                "Active": active,
                "CurAddr": cur,
                "Relay": relay,
            }
        }
    }
    assert route_of(status, "100.64.0.2").model_dump() == {"kind": expected}
    assert route_of(status, "100.64.0.3").kind == "unknown"


@pytest.mark.parametrize(
    "response",
    [httpx.Response(503), httpx.Response(200, content=b"bad"), httpx.Response(200, json=[])],
)
async def test_unavailable_status_is_unknown(response):
    assert (
        await read_connection("100.64.0.2", httpx.MockTransport(lambda _: response))
    ).kind == "unknown"


async def test_endpoint_uses_the_transport_peer_not_a_supplied_address(client, monkeypatch):
    from nel3ab_control.api.routes import me

    read = AsyncMock(return_value=Connection(kind="direct"))
    monkeypatch.setattr(me, "read_connection", read)
    response = await client.get(
        "/api/me/connection?address=100.64.0.99", headers={"X-Forwarded-For": "100.64.0.99"}
    )
    assert response.json() == {"kind": "direct"}
    read.assert_awaited_once()
    assert read.call_args.args[0] != "100.64.0.99"
