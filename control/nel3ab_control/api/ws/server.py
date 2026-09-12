"""Lobby events: who arrived, who left, who took which pad.

Socket.IO rather than a bare WebSocket, because this is the layer where
reconnection, rooms and broadcast are the whole job and are worth not writing
again — the same reasoning, and the same library, as the owner's other services.

No Redis client manager here, unlike Majlisna: there is one process. A manager
exists to share state between several, and adding one would mean running Redis to
serve a room that fits in a dictionary.
"""

import logging

import anyio
import socketio

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.journal import Journal
from nel3ab_control.worker import tell_owner

sio = socketio.AsyncServer(
    async_mode="asgi",
    # Posée par `create_app` depuis les réglages: voir `allow_origins`. Le
    # commentaire d'avant disait « vide: même origine seulement ». C'était le
    # contraire: pour python-socketio, une liste vide DÉSACTIVE le contrôle, et
    # n'importe quel site ouvert dans le navigateur d'un membre du tailnet
    # ouvrait une session que le service identifiait, par `whois` sur l'adresse
    # du membre, comme le membre lui-même. Une garde qui n'existait pas, avec un
    # commentaire qui disait qu'elle existait. Trouvé par l'audit du 5 septembre
    # 2026, vérifié avec une origine forgée.
    cors_allowed_origins=["https://nel3ab.app"],
    ping_interval=15,
    ping_timeout=10,
    logger=False,
    engineio_logger=False,
)

socketio_app = socketio.ASGIApp(sio, socketio_path="/socket.io")


def allow_origins(origins: list[str]) -> None:
    """Les origines admises, depuis les réglages, jamais vides.

    Refuse une liste vide plutôt que de la passer: vide, c'est « tout le monde »
    chez python-socketio, et c'est exactement le défaut qu'on ferme.
    """
    if not origins:
        raise ValueError("NEL3AB_ORIGINS ne peut pas être vide: vide veut dire tout le monde")
    sio.eio.cors_allowed_origins = list(origins)


def piece(salle: int) -> str:
    """La « pièce » Socket.IO d'une salle, où sa diffusion est confinée.

    Une par salle, et c'est indispensable depuis qu'il y en a trois: une pièce
    unique aurait montré à chacun les places, les noms et les lancements des
    autres salles, et le chef de l'une aurait été désigné par la présence d'un
    joueur de l'autre.
    """
    return f"salle-{salle}"


#: La pièce de la salle 1, pour les appelants qui ne disent pas encore la leur.
ROOM = piece(1)


async def follow_seats(state) -> None:
    """Rafraîchit aussi les pages qui regardent sans socket de manette.

    Une seconde est un choix de fraîcheur : au plus une lecture locale par
    seconde, plus la bibliothèque, puis une diffusion si les places ou le jeu
    changent. La fermeture doit aussi parvenir aux seuls spectateurs. Aucun travail
    quand le salon est vide, aucun appel sur le chemin d'une image.
    """
    # Import local : ces événements utilisent le serveur une fois construit.
    from nel3ab_control.api.ws.recovery import expire

    known_game: dict[int, int | None] = {}
    while True:
        await anyio.sleep(1)
        try:
            # Chaque salle éveillée, et elles seules: une salle que personne n'a
            # ouverte n'a pas de worker, donc l'interroger reviendrait à frapper
            # une fois par seconde à une porte qui n'existe pas.
            for salle, rooms in state.salons.eveilles():
                ici = state.people.live(salle)
                await expire(rooms, state.people)
                if not ici:
                    continue
                changed = await rooms.synchronise()
                _, running = await rooms.library()
                current = running.index if running else None
                if changed or current != known_game.get(salle):
                    await broadcast(rooms, state.people, state.journal, salle=salle)
                known_game[salle] = current
        except Exception:
            logging.getLogger(__name__).exception("la lecture des places n'a pas abouti")


async def broadcast(
    rooms: RoomController,
    people: PeopleController,
    journal: Journal,
    banc: bool = False,
    salle: int = 1,
) -> None:
    """Dit à tout le monde à quoi la salle ressemble maintenant.

    Et au worker aussi, mais seulement quand la place du propriétaire CHANGE: le
    worker n'a pas besoin de savoir que quelqu'un a changé de pseudo, et lui
    ouvrir une socket à chaque événement du salon serait le défaut qu'on vient de
    corriger dans l'autre sens.
    """
    room = await rooms.describe(people, salle=salle)
    seat = room.owner.seat if room.owner and room.owner.seat else 0
    if seat != rooms.told_owner and await tell_owner(rooms.settings.worker_control, seat):
        rooms.told_owner = seat
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
    await sio.emit("room", room.model_dump(), room=piece(salle))
