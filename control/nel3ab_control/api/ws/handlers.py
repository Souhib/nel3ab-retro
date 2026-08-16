"""Ce que le salon fait quand une page dit quelque chose."""

from typing import Any

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.ws.server import ROOM, broadcast, sio
from nel3ab_control.identity import from_headers


def _port(data: dict[str, Any]) -> int | None:
    """Le port d'un message, ou rien. Ce qui arrive d'une page n'est pas un
    nombre parce qu'on l'espère."""
    try:
        port = int(data.get("port", 0))
    except (TypeError, ValueError):
        return None
    return port if 1 <= port <= 4 else None


def _state(environ: dict[str, Any]) -> tuple[RoomController, PeopleController]:
    """Les contrôleurs, tirés de la portée ASGI que l'application y a mise.

    Par la portée plutôt que par une dépendance, parce qu'un gestionnaire
    Socket.IO n'est pas un point d'entrée FastAPI et n'en a pas. Le couplage que
    ça crée, à la façon dont l'application est montée, est la raison pour
    laquelle le salon a un essai d'intégration contre un vrai serveur plutôt
    qu'un test unitaire avec une fausse session.
    """
    app = environ["asgi.scope"]["app"]
    return app.state.rooms, app.state.people


@sio.event
async def connect(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None) -> None:
    """Une page arrive, et le proxy dit déjà qui c'est.

    L'identité vient de la MONTÉE EN GRADE de la WebSocket, où Tailscale écrit le
    même en-tête que sur une requête ordinaire (vérifié le 16 août 2026). Il n'y
    a donc pas de jeton à faire circuler entre une route et une socket, ce qui
    est une pièce de moins à se faire voler.

    Sans proxy devant, on retombe sur le prénom que la page envoie: c'est du
    développement local, où il n'y a personne à usurper.
    """
    rooms, people = _state(environ)
    caller = from_headers(environ["asgi.scope"]["headers"])
    login = caller[0] if caller else None
    name = (
        people.name_for(login, caller[1]) if caller else ((auth or {}).get("name") or "quelqu'un")
    )
    await sio.save_session(sid, {"name": name, "login": login})
    people.arrived(sid, login, name)
    await sio.enter_room(sid, ROOM)
    await broadcast(rooms, people)


@sio.event
async def seat(sid: str, data: dict[str, Any]) -> None:
    """Une page dit quelle manette le worker lui a donnée."""
    session = await sio.get_session(sid)
    rooms, people = _state(sio.get_environ(sid))
    port = data.get("port")
    if port is None:
        rooms.release(sid)
    else:
        rooms.claim(int(port), sid, session["name"])
    await broadcast(rooms, people)


@sio.event
async def ask(sid: str, data: dict[str, Any]) -> None:
    """Quelqu'un demande la manette d'un autre.

    Une demande et pas une prise: le porteur est en train de jouer, et la lui
    arracher est le geste que cette salle ne doit pas rendre facile. Le serveur
    sait qui tient quoi, donc la page n'envoie qu'un numéro de port; elle n'a
    jamais à savoir comment adresser une autre page.
    """
    rooms, _people = _state(sio.get_environ(sid))
    port = _port(data)
    if port is None:
        return
    holder = rooms.holder_of(port)
    if holder is None or holder == sid:
        return
    session = await sio.get_session(sid)
    rooms.asked(port, sid)
    await sio.emit("asked", {"from": session["name"], "port": port}, to=holder)


@sio.event
async def answer(sid: str, data: dict[str, Any]) -> None:
    """Le porteur accepte ou refuse.

    En acceptant, il libère la place ICI aussi: sans ça, la salle continuerait
    de l'afficher à son nom pendant que l'autre s'y branche, et les deux pages
    se contrediraient le temps d'un aller-retour.
    """
    rooms, people = _state(sio.get_environ(sid))
    port = _port(data)
    if port is None:
        return
    asker = rooms.take_ask(port)
    if asker is None:
        return
    session = await sio.get_session(sid)
    agreed = bool(data.get("ok"))
    if agreed:
        rooms.free(port)
    await sio.emit("answered", {"ok": agreed, "port": port, "from": session["name"]}, to=asker)
    await broadcast(rooms, people)


@sio.event
async def rename(sid: str, data: dict[str, Any]) -> None:
    """Quelqu'un change de pseudo, et la salle le voit tout de suite.

    Le changement est écrit par la route `PUT /api/me`, qui est la seule à savoir
    l'enregistrer. Ce message-ci ne fait que rafraîchir la session ouverte et
    prévenir les autres: sans lui, une salle continuerait d'afficher l'ancien
    pseudo jusqu'à la prochaine reconnexion.
    """
    session = await sio.get_session(sid)
    rooms, people = _state(sio.get_environ(sid))
    was = session["name"]
    now = people.name_for(session["login"]) if session["login"] else str(data.get("name") or was)
    if now != was:
        # La place suit son occupant: elle est retenue sous un nom, et un nom qui
        # change sans que la place suive laisse une manette au nom d'un fantôme.
        rooms.rename(sid, now)
        people.renamed(sid, now)
        await sio.save_session(sid, {**session, "name": now})
    await broadcast(rooms, people)


@sio.event
async def disconnect(sid: str) -> None:
    """Une page part. SES manettes retournent à la salle, pas celles du même nom
    sur une autre machine."""
    rooms, people = _state(sio.get_environ(sid))
    people.left(sid)
    rooms.release(sid)
    await broadcast(rooms, people)
