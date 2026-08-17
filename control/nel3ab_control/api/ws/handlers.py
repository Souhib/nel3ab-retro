"""Ce que le salon fait quand une page dit quelque chose.

Chaque geste laisse une ligne dans le journal des séances. Le pourquoi est dans
[`nel3ab_control.journal`]: une soirée dont personne ne garde trace est une
soirée qu'on ne peut pas expliquer le lendemain, et ça s'est produit.

L'inscription se fait ICI plutôt que dans les contrôleurs, parce que c'est ici
qu'on sait à la fois QUI parle, ce qu'il vient de faire, et à quoi la salle
ressemble à cet instant. Un contrôleur ne connaît qu'un tiers de la ligne.
"""

import json
from time import monotonic
from typing import Any

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.ws.server import ROOM, broadcast, sio
from nel3ab_control.identity import from_headers
from nel3ab_control.journal import Journal


def _port(data: dict[str, Any]) -> int | None:
    """Le port d'un message, ou rien. Ce qui arrive d'une page n'est pas un
    nombre parce qu'on l'espère."""
    try:
        port = int(data.get("port", 0))
    except (TypeError, ValueError):
        return None
    return port if 1 <= port <= 4 else None


def _state(environ: dict[str, Any]) -> tuple[RoomController, PeopleController, Journal]:
    """Les contrôleurs, tirés de la portée ASGI que l'application y a mise.

    Par la portée plutôt que par une dépendance, parce qu'un gestionnaire
    Socket.IO n'est pas un point d'entrée FastAPI et n'en a pas. Le couplage que
    ça crée, à la façon dont l'application est montée, est la raison pour
    laquelle le salon a un essai d'intégration contre un vrai serveur plutôt
    qu'un test unitaire avec une fausse session.
    """
    app = environ["asgi.scope"]["app"]
    return app.state.rooms, app.state.people, app.state.journal


def _who(sid: str, session: dict[str, Any]) -> dict[str, Any]:
    """De qui parle la ligne de journal.

    Les trois identifiants et pas un seul, parce qu'ils ne durent pas pareil:

    - la **visite** naît au chargement de la page et survit aux reconnexions,
      donc c'est elle qui recolle une mauvaise connexion en une seule séance;
    - la **socket** change à chaque reconnexion, donc c'est elle qui les compte;
    - le **login** vient du proxy et survit à tout, donc c'est lui qui relie deux
      soirées de la même personne.

    Le `banc` dit que ce n'est pas quelqu'un mais un pilote d'essai. Sans lui, le
    journal se noie dès le premier jour dans mes propres pilotes, qui ouvrent la
    salle des dizaines de fois par soirée et prennent de vraies places.
    """
    return {
        "visite": session.get("visite"),
        "socket": sid,
        "login": session.get("login"),
        "pseudo": session.get("name"),
        "banc": bool(session.get("banc")),
    }


def _room_now(rooms: RoomController, people: PeopleController) -> dict[str, Any]:
    """La salle à cet instant, telle qu'une ligne seule doit pouvoir la raconter.

    Recopiée dans CHAQUE ligne, ce qui est une redondance assumée: ça coûte une
    centaine d'octets et ça évite de rejouer tout le fichier depuis le début pour
    répondre à « qui d'autre était là ». À deux jours de rétention, la place ne
    se discute pas.

    Le jeu vient de ce que le worker a dit la dernière fois, sans l'appeler: une
    trace ne doit pas ajouter un aller-retour réseau au chemin d'un joueur.
    """
    return {
        "jeu": rooms.known_game(),
        "présents": len(people.present()),
        "places": {
            str(seat.port): seat.player for seat in rooms.seats() if seat.player is not None
        },
    }


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
    rooms, people, journal = _state(environ)
    caller = from_headers(environ["asgi.scope"]["headers"])
    login = caller[0] if caller else None
    name = (
        people.name_for(login, caller[1]) if caller else ((auth or {}).get("name") or "quelqu'un")
    )
    # L'instant d'arrivée est MONOTONE et pas une heure: il ne sert qu'à mesurer
    # une durée au départ, et régler l'horloge de la machine ne doit pas donner
    # une séance de moins l'infini.
    session = {
        "name": name,
        "login": login,
        "visite": str((auth or {}).get("visite") or "")[:16] or None,
        "banc": bool((auth or {}).get("banc")),
        "since": monotonic(),
    }
    await sio.save_session(sid, session)
    people.arrived(sid, login, name)
    await sio.enter_room(sid, ROOM)
    journal.write("arrivée", **_who(sid, session), salle=_room_now(rooms, people))
    await broadcast(rooms, people, journal, bool(session.get("banc")))


@sio.event
async def seat(sid: str, data: dict[str, Any]) -> None:
    """Une page dit quelle manette le worker lui a donnée."""
    session = await sio.get_session(sid)
    rooms, people, journal = _state(sio.get_environ(sid))
    port = data.get("port")
    if port is None:
        rooms.release(sid)
    else:
        rooms.claim(int(port), sid, session["name"])
    journal.write(
        "place",
        **_who(sid, session),
        place=None if port is None else int(port),
        salle=_room_now(rooms, people),
    )
    await broadcast(rooms, people, journal, bool(session.get("banc")))


@sio.event
async def ask(sid: str, data: dict[str, Any]) -> None:
    """Quelqu'un demande la manette d'un autre.

    Une demande et pas une prise: le porteur est en train de jouer, et la lui
    arracher est le geste que cette salle ne doit pas rendre facile. Le serveur
    sait qui tient quoi, donc la page n'envoie qu'un numéro de port; elle n'a
    jamais à savoir comment adresser une autre page.
    """
    rooms, people, journal = _state(sio.get_environ(sid))
    port = _port(data)
    if port is None:
        return
    holder = rooms.holder_of(port)
    if holder is None or holder == sid:
        return
    session = await sio.get_session(sid)
    rooms.asked(port, sid)
    journal.write("demande", **_who(sid, session), place=port, salle=_room_now(rooms, people))
    await sio.emit("asked", {"from": session["name"], "port": port}, to=holder)


@sio.event
async def answer(sid: str, data: dict[str, Any]) -> None:
    """Le porteur accepte ou refuse.

    En acceptant, il libère la place ICI aussi: sans ça, la salle continuerait
    de l'afficher à son nom pendant que l'autre s'y branche, et les deux pages
    se contrediraient le temps d'un aller-retour.
    """
    rooms, people, journal = _state(sio.get_environ(sid))
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
    journal.write(
        "réponse",
        **_who(sid, session),
        place=port,
        accordé=agreed,
        salle=_room_now(rooms, people),
    )
    await sio.emit("answered", {"ok": agreed, "port": port, "from": session["name"]}, to=asker)
    await broadcast(rooms, people, journal, bool(session.get("banc")))


@sio.event
async def rename(sid: str, data: dict[str, Any]) -> None:
    """Quelqu'un change de pseudo, et la salle le voit tout de suite.

    Le changement est écrit par la route `PUT /api/me`, qui est la seule à savoir
    l'enregistrer. Ce message-ci ne fait que rafraîchir la session ouverte et
    prévenir les autres: sans lui, une salle continuerait d'afficher l'ancien
    pseudo jusqu'à la prochaine reconnexion.
    """
    session = await sio.get_session(sid)
    rooms, people, journal = _state(sio.get_environ(sid))
    was = session["name"]
    now = people.name_for(session["login"]) if session["login"] else str(data.get("name") or was)
    if now != was:
        # La place suit son occupant: elle est retenue sous un nom, et un nom qui
        # change sans que la place suive laisse une manette au nom d'un fantôme.
        rooms.rename(sid, now)
        people.renamed(sid, now)
        session = {**session, "name": now}
        await sio.save_session(sid, session)
        # Après la mise à jour, pour que la ligne porte le nom d'ARRIVÉE de la
        # suite du journal plutôt que celui qu'on vient d'abandonner: c'est ce
        # nom-là qu'on cherchera dans les lignes suivantes.
        journal.write("pseudo", **_who(sid, session), avant=was, salle=_room_now(rooms, people))
    await broadcast(rooms, people, journal, bool(session.get("banc")))


#: Ce qu'un relevé du navigateur a le droit de peser, en octets une fois remis
#: en JSON.
#:
#: Deux kilo-octets. Un vrai relevé en fait trois cents; le facteur six laisse
#: la place à des champs futurs sans laisser la place à autre chose. Sans cette
#: borne, une page — la nôtre modifiée, ou celle de quelqu'un d'autre sur le
#: réseau — peut faire grossir le journal aussi vite qu'elle sait écrire, et le
#: balayage de deux jours n'y peut rien puisqu'il est journalier.
VITALS_MAX = 2048


def _measured(data: dict[str, Any]) -> dict[str, Any] | None:
    """Un relevé, ou rien s'il n'a pas la tête d'un relevé.

    Ce qui arrive d'une page n'est pas un relevé parce qu'on l'espère. On garde
    la forme plutôt que chaque champ: la liste des mesures va bouger souvent, et
    un contrôle champ par champ ici deviendrait une deuxième définition à tenir
    d'accord avec celle de la page.

    Ce qu'on vérifie est donc ce qui protège le FICHIER, pas ce qui décrit une
    bonne mesure: que ce soit un objet, et qu'il tienne dans sa borne.

    Ce qu'on ne vérifie PAS, parce que la structure s'en charge: le relevé est
    rangé sous sa propre clé plutôt que fondu dans la ligne. Une page qui
    enverrait un champ `login` ne peut donc pas se réécrire une identité, et le
    gestionnaire ne peut pas tomber sur un argument en double. C'est une
    contrainte de forme plutôt qu'un contrôle, donc elle ne s'oublie pas.
    """
    if not isinstance(data, dict):
        return None
    return data if len(json.dumps(data, ensure_ascii=False)) <= VITALS_MAX else None


@sio.event
async def mesures(sid: str, data: dict[str, Any]) -> None:
    """Ce que ce navigateur voit, toutes les dix secondes.

    Le salon ne fait que l'écrire. Il n'en tire aucune conclusion et n'agit sur
    rien: décider quoi que ce soit à partir d'un chiffre qu'une page envoie
    donnerait à cette page le pouvoir de changer la salle en mentant.

    Aucune diffusion non plus. Les autres n'ont pas à savoir que la liaison de
    quelqu'un est mauvaise, et une diffusion toutes les dix secondes par personne
    serait un trafic ajouté à une salle qui va déjà mal.
    """
    kept = _measured(data)
    if kept is None:
        return
    session = await sio.get_session(sid)
    rooms, people, journal = _state(sio.get_environ(sid))
    journal.write("mesures", **_who(sid, session), vu=kept, salle=_room_now(rooms, people))


@sio.event
async def plainte(sid: str, data: dict[str, Any]) -> None:
    """« Ça saccade, maintenant. »

    Le repère qui manquait le plus. Une plainte arrive le lendemain avec une
    heure approximative, et il a fallu deux fois demander une capture d'écran à
    quelqu'un qui jouait pour savoir ce qui se passait chez lui.

    Écrit comme un relevé, mais sous un autre nom pour que `just sessions` puisse
    le mettre en évidence: c'est la ligne autour de laquelle on lira les autres.
    """
    kept = _measured(data)
    if kept is None:
        return
    session = await sio.get_session(sid)
    rooms, people, journal = _state(sio.get_environ(sid))
    journal.write("plainte", **_who(sid, session), vu=kept, salle=_room_now(rooms, people))


@sio.event
async def disconnect(sid: str) -> None:
    """Une page part. SES manettes retournent à la salle, pas celles du même nom
    sur une autre machine."""
    rooms, people, journal = _state(sio.get_environ(sid))
    session = await sio.get_session(sid)
    people.left(sid)
    rooms.release(sid)
    journal.write(
        "départ",
        **_who(sid, session),
        # Combien de temps la socket a tenu. Court et répété est la signature
        # d'une mauvaise connexion; c'est le chiffre qui distingue « il est
        # parti » de « il a été déconnecté onze fois ».
        secondes=round(monotonic() - float(session.get("since") or monotonic()), 1),
        salle=_room_now(rooms, people),
    )
    await broadcast(rooms, people, journal, bool(session.get("banc")))
