"""Avertir, laisser répondre, puis confirmer une reprise sans relancer le jeu."""

from time import monotonic
from typing import Any

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.recovery import EXPIRES_AFTER, Recovery
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.ws.handlers import ROOM_EVERY, _state, _who, too_soon
from nel3ab_control.api.ws.server import broadcast, sio
from nel3ab_control.worker import read_seats


def current(request: Recovery, rooms: RoomController, people: PeopleController) -> bool:
    if request.asker not in people.live():
        return False
    if request.port is None:
        boss = people.owner()
        return boss is not None and boss[0] == request.expected
    return rooms.seats()[request.port - 1].claim == request.expected


async def notify(request: Recovery, reason: str | None = None) -> None:
    for sid in [request.asker, *request.targets]:
        await sio.emit(
            "recovery",
            {
                "id": request.id,
                "port": request.port,
                "from": request.source,
                "to": request.target,
                "asking": sid == request.asker,
                "remaining": request.remaining(monotonic()),
                "reason": reason,
            },
            to=sid,
        )


async def expire(rooms: RoomController, people: PeopleController) -> None:
    """Une demande ne survit ni à sa personne ni à l'attribution visée."""
    async with rooms.recovering:
        request = rooms.recovery
        if request and (request.expired(monotonic()) or not current(request, rooms, people)):
            rooms.recovery = None
            await notify(request, "La demande a expiré ou la place a changé. Réessaie.")


@sio.event
async def recover(sid: str, data: object) -> dict[str, Any]:
    rooms, people, journal = _state(sio.get_environ(sid))
    if not isinstance(data, dict) or sid not in people.live():
        return {"ok": False, "error": "La demande n'est pas valide."}
    # Une demande à la fois, sans tâche différée qui pourrait agir après une
    # reconnexion. Réponse et confirmation partagent ce verrou, même entre pages.
    async with rooms.recovering:
        try:
            session = await sio.get_session(sid)
            now = monotonic()
            request = rooms.recovery
            if request and (request.expired(now) or not current(request, rooms, people)):
                rooms.recovery = None
                await notify(request, "La demande n'est plus disponible.")
                request = None
            action = data.get("action")
            if action == "begin":
                if too_soon(session.get("last_recover"), now, ROOM_EVERY):
                    raise ValueError("Attends un instant avant de redemander.")
                await sio.save_session(sid, {**session, "last_recover": now})
                if request:
                    raise ValueError("Une reprise est déjà en attente dans la salle.")
                port = data.get("port")
                if port is not None and (type(port) is not int or not 1 <= port <= 4):
                    raise ValueError("Cette manette n'existe pas.")
                if port is None:
                    boss = people.owner()
                    if boss is None or boss[0] is None or not session.get("login"):
                        raise ValueError(
                            "Une identité est nécessaire pour reprendre le rôle de chef."
                        )
                    expected, target = boss
                    if expected == session["login"]:
                        raise ValueError("Tu es déjà le chef de la salle.")
                    targets = people.sessions()[expected]
                else:
                    observed = await read_seats(rooms.settings.worker_control)
                    if observed is None:
                        raise ValueError("Les manettes ne répondent pas. Réessaie.")
                    rooms.observe_seats(observed)
                    holder = rooms.holder_of(port)
                    seat = rooms.seats()[port - 1]
                    if holder is None or seat.claim is None or seat.player is None:
                        raise ValueError("Cette place a changé. Sélectionne-la à nouveau.")
                    if holder == sid:
                        raise ValueError("Tu tiens déjà cette manette.")
                    expected, target, targets = seat.claim, seat.player, [holder]
                refused = rooms.recovery_refused.get(port or 0)
                if refused and refused[0] == expected and now < refused[1]:
                    raise ValueError("Cette personne vient de répondre. Attends une minute.")
                request = Recovery(
                    sid, session.get("login"), targets, session["name"], target, port, expected, now
                )
                rooms.recovery = request
                await notify(request)
            else:
                if request is None or data.get("id") != request.id:
                    raise ValueError("Cette demande n'est plus disponible.")
                if action == "answer":
                    if type(data.get("ok")) is not bool:
                        raise ValueError("La réponse doit être oui ou non.")
                    request.respond(sid, now)
                    if not data["ok"]:
                        rooms.recovery_refused[request.port or 0] = (
                            request.expected,
                            now + EXPIRES_AFTER,
                        )
                        rooms.recovery = None
                        await notify(
                            request,
                            f"{request.target} est là et garde "
                            + ("son rôle." if request.port is None else "sa manette."),
                        )
                    else:
                        await notify(request)
                elif action == "cancel":
                    if request.asker != sid:
                        raise ValueError("Seule la personne qui demande peut annuler.")
                    rooms.recovery = None
                    await notify(request, "Demande annulée.")
                elif action == "finish":
                    request.finish(sid, now)
                    if request.port is None:
                        if request.login is None or not people.transfer_owner(
                            request.expected, request.login
                        ):
                            raise ValueError("Le chef a changé. Réessaie.")
                        rooms.told_owner = -1
                    else:
                        observed = await read_seats(rooms.settings.worker_control)
                        if observed is None:
                            raise ValueError("Les manettes ne répondent pas. Réessaie.")
                        rooms.observe_seats(observed)
                        if not current(request, rooms, people):
                            raise ValueError("Cette manette a changé de mains. Réessaie.")
                    rooms.recovery = None
                    await notify(
                        request,
                        f"{request.source} reprend "
                        + (
                            "le rôle de chef."
                            if request.port is None
                            else f"la manette {request.port}."
                        ),
                    )
                    await broadcast(rooms, people, journal, bool(session.get("banc")))
                else:
                    raise ValueError("Cette action n'existe pas.")
            journal.write(
                "reprise",
                **_who(sid, session),
                étape=action,
                place=request.port,
                cible=request.target,
                salle=None,
            )
            return {
                "ok": True,
                "port": request.port if action == "finish" else None,
                "claim": request.expected if action == "finish" and request.port else None,
            }
        except ValueError as error:
            return {"ok": False, "error": str(error)}
