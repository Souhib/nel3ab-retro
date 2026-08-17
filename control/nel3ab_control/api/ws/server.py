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
from nel3ab_control.journal import Journal
from nel3ab_control.worker import tell_owner

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


async def broadcast(
    rooms: RoomController, people: PeopleController, journal: Journal, banc: bool = False
) -> None:
    """Dit à tout le monde à quoi la salle ressemble maintenant.

    Et au worker aussi, mais seulement quand la place du propriétaire CHANGE: le
    worker n'a pas besoin de savoir que quelqu'un a changé de pseudo, et lui
    ouvrir une socket à chaque événement du salon serait le défaut qu'on vient de
    corriger dans l'autre sens.
    """
    room = await rooms.describe(people)
    seat = room.owner.seat if room.owner and room.owner.seat else 0
    if seat != rooms.told_owner:
        rooms.told_owner = seat
        await tell_owner(rooms.settings.worker_control, seat)
    # Au journal aussi, et sur le COUPLE (nom, place): qui décide peut changer
    # sans que la place bouge, quand le premier arrivé part et que le suivant est
    # déjà assis au même endroit. Ne comparer que la place raterait ce cas-là.
    now = (room.owner.name if room.owner else None, seat)
    if now != rooms.noted_owner:
        rooms.noted_owner = now
        # Marquée du drapeau de la page qui vient de parler. Un changement de
        # propriétaire est un fait de la salle, mais celui que provoque un
        # pilote d'essai reste du bruit d'essai: sans ce drapeau, une soirée de
        # mise au point noie les vraies sous douze lignes qui ne disent rien.
        journal.write("propriétaire", pseudo=now[0], place=seat or None, banc=banc)
    await sio.emit("room", room.model_dump(), room=ROOM)
