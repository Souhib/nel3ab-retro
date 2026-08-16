"""Lobby events: who arrived, who left, who took which pad.

Socket.IO rather than a bare WebSocket, because this is the layer where
reconnection, rooms and broadcast are the whole job and are worth not writing
again — the same reasoning, and the same library, as the owner's other services.

No Redis client manager here, unlike Majlisna: there is one process. A manager
exists to share state between several, and adding one would mean running Redis to
serve a room that fits in a dictionary.
"""

import socketio

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController

sio = socketio.AsyncServer(
    async_mode="asgi",
    # Empty: only same-origin handshakes. The page is served from this origin in
    # production and the dev proxy makes it same-origin in development, so an
    # allowed list would exist only to be forgotten when the address changes.
    cors_allowed_origins=[],
    ping_interval=15,
    ping_timeout=10,
    logger=False,
    engineio_logger=False,
)

socketio_app = socketio.ASGIApp(sio, socketio_path="/socket.io")

ROOM = "room"


async def broadcast(rooms: RoomController, people: PeopleController) -> None:
    """Dit à tout le monde à quoi la salle ressemble maintenant."""
    await sio.emit("room", (await rooms.describe(people)).model_dump(), room=ROOM)
