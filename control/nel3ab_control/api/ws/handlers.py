"""What the lobby does when a page says something."""

from typing import Any

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.ws.server import ROOM, broadcast, sio


def _rooms(environ: dict[str, Any]) -> RoomController:
    """The room controller, out of the ASGI scope the app put it in.

    Reaching into the scope rather than taking a dependency, because a Socket.IO
    handler is not a FastAPI endpoint and has none. The coupling that creates —
    to how the socket app is mounted — is why the lobby has an integration test
    against a real server rather than a unit test with a fake session.
    """
    rooms: RoomController = environ["asgi.scope"]["app"].state.rooms
    return rooms


@sio.event
async def connect(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None) -> None:
    """A page arrived. It is in the room before it has said who it is."""
    name = (auth or {}).get("name") or "quelqu'un"
    await sio.save_session(sid, {"name": name})
    await sio.enter_room(sid, ROOM)
    await broadcast(_rooms(environ))


@sio.event
async def seat(sid: str, data: dict[str, Any]) -> None:
    """A page says which pad the worker gave it."""
    session = await sio.get_session(sid)
    rooms = _rooms(sio.get_environ(sid))
    port = data.get("port")
    if port is None:
        rooms.release(session["name"])
    else:
        rooms.claim(int(port), session["name"])
    await broadcast(rooms)


@sio.event
async def disconnect(sid: str) -> None:
    """A page left. Its pads go back to the room."""
    session = await sio.get_session(sid)
    rooms = _rooms(sio.get_environ(sid))
    rooms.release(session["name"])
    await broadcast(rooms)
