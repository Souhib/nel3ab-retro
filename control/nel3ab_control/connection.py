"""Le trajet Tailscale du demandeur, sans exposer la liste de ses pairs."""

from typing import Any, Literal

import httpx
from pydantic import BaseModel

from nel3ab_control.identity import TAILSCALED


class Connection(BaseModel):
    """Une observation de trajet, jamais une mesure de qualité."""

    kind: Literal["direct", "relay", "unknown"] = "unknown"


def route_of(status: dict[str, Any], address: str) -> Connection:
    """Même distinction que tailscale status : un relais préféré n'est pas actif.

    Relay reste rempli même en connexion directe. CurAddr est donc prioritaire,
    et une connexion inactive reste inconnue plutôt que faussement directe.
    """
    peers = status.get("Peer")
    if not isinstance(peers, dict):
        return Connection()
    for peer in peers.values():
        if not isinstance(peer, dict) or address not in (peer.get("TailscaleIPs") or []):
            continue
        if not peer.get("Active"):
            return Connection()
        if peer.get("CurAddr"):
            return Connection(kind="direct")
        if peer.get("PeerRelay") or peer.get("Relay"):
            return Connection(kind="relay")
    return Connection()


async def read_connection(
    address: str, transport: httpx.AsyncBaseTransport | None = None
) -> Connection:
    """Une question locale bornée à une seconde, hors du chemin des images."""
    if not address:
        return Connection()
    try:
        async with httpx.AsyncClient(
            transport=transport or httpx.AsyncHTTPTransport(uds=TAILSCALED), timeout=1.0
        ) as client:
            answer = await client.get("http://local-tailscaled.sock/localapi/v0/status")
            answer.raise_for_status()
            status = answer.json()
        return route_of(status, address) if isinstance(status, dict) else Connection()
    except (OSError, ValueError, httpx.HTTPError):
        return Connection()
