"""Ce que le salon fait quand une page dit quelque chose.

Chaque geste laisse une ligne dans le journal des séances. Le pourquoi est dans
[`nel3ab_control.journal`]: une soirée dont personne ne garde trace est une
soirée qu'on ne peut pas expliquer le lendemain, et ça s'est produit.

L'inscription se fait ICI plutôt que dans les contrôleurs, parce que c'est ici
qu'on sait à la fois QUI parle, ce qu'il vient de faire, et à quoi la salle
ressemble à cet instant. Un contrôleur ne connaît qu'un tiers de la ligne.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from functools import wraps
from time import monotonic
from typing import Any, Protocol

from socketio.exceptions import ConnectionRefusedError as Refused

from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.controllers.salles import SALLES
from nel3ab_control.api.schemas.error import SeatTaken
from nel3ab_control.api.schemas.player import NAME_MAX
from nel3ab_control.api.ws.server import broadcast, piece, sio
from nel3ab_control.connection import read_connection
from nel3ab_control.identity import caller_of
from nel3ab_control.journal import Journal
from nel3ab_control.worker import may_decide

logger = logging.getLogger(__name__)


def _name(value: object) -> str | None:
    """Le même plafond que PUT /me, sans convertir un objet en pseudo."""
    if not isinstance(value, str) or len(value) > NAME_MAX:
        return None
    return value.strip() or None


class Handler(Protocol):
    """Ce qu'un gestionnaire de message est.

    Un protocole plutôt qu'un simple `Callable`, pour une raison précise: le
    garde de cadence range son horodate sous le NOM du gestionnaire, et un
    `Callable` ne promet pas d'en avoir un. Le dire ici fait vérifier par le
    typeur ce qui serait sinon un `getattr` avec une valeur de repli, c'est-à-
    dire une fusion silencieuse de deux quotas le jour où quelqu'un décore
    autre chose qu'une fonction.
    """

    __name__: str

    def __call__(self, sid: str, data: dict[str, Any]) -> Awaitable[object]: ...


def _port(data: dict[str, Any]) -> int | None:
    """Le port d'un message, ou rien. Ce qui arrive d'une page n'est pas un
    nombre parce qu'on l'espère."""
    try:
        port = int(data.get("port", 0))
    except (TypeError, ValueError):
        return None
    return port if 1 <= port <= 4 else None


async def _pour(sid: str) -> tuple[RoomController, PeopleController, Journal, int]:
    """Les contrôleurs de LA salle dont cette socket parle, et son numéro.

    Le numéro est posé à la connexion, depuis ce que la page annonce, et il ne
    bouge plus: une socket appartient à une salle pour toute sa vie. Le relire
    ici à chaque événement plutôt que de le passer de main en main évite qu'un
    gestionnaire oublie de le transmettre et serve la salle 1 à quelqu'un
    d'ailleurs.
    """
    session = await sio.get_session(sid)
    salle = session.get("salle", 1)
    rooms, people, journal = _state(sio.get_environ(sid), salle)
    return rooms, people, journal, salle


def _salle_demandee(auth: dict[str, Any]) -> int:
    """La salle qu'une page annonce en se connectant.

    Un numéro qui n'est pas une salle retombe sur la première: la page le tire
    de son adresse, donc s'en écarter est le signe d'un proxy mal réglé plutôt
    que d'une demande à honorer.
    """
    try:
        salle = int(auth.get("salle", 1))
    except (TypeError, ValueError):
        return 1
    return salle if salle in SALLES else 1


def _state(
    environ: dict[str, Any], salle: int = 1
) -> tuple[RoomController, PeopleController, Journal]:
    """Les contrôleurs, tirés de la portée ASGI que l'application y a mise.

    Par la portée plutôt que par une dépendance, parce qu'un gestionnaire
    Socket.IO n'est pas un point d'entrée FastAPI et n'en a pas. Le couplage que
    ça crée, à la façon dont l'application est montée, est la raison pour
    laquelle le salon a un essai d'intégration contre un vrai serveur plutôt
    qu'un test unitaire avec une fausse session.
    """
    app = environ["asgi.scope"]["app"]
    return app.state.salons.pour(salle), app.state.people, app.state.journal


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
        # Écrit seulement quand c'est vrai. Un `false` sur chaque ligne de
        # chaque événement serait trois cents kilo-octets par soirée pour dire
        # « normal », et un journal qu'on lit mal est un journal qu'on n'ouvre
        # pas.
        **({"manette": True} if session.get("manette") else {}),
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


#: Ce qu'un relevé du navigateur a le droit de peser, en octets une fois remis
#: en JSON.
#:
#: Deux kilo-octets. Un vrai relevé en fait trois cents; le facteur six laisse
#: la place à des champs futurs sans laisser la place à autre chose. Sans cette
#: borne, une page — la nôtre modifiée, ou celle de quelqu'un d'autre sur le
#: réseau — peut faire grossir le journal aussi vite qu'elle sait écrire, et le
#: balayage de deux jours n'y peut rien puisqu'il est journalier.
VITALS_MAX = 2048

#: Ce qu'un SIGNALEMENT a le droit de peser, en octets.
#:
#: Seize kilo-octets, huit fois la borne d'un relevé, parce qu'un signalement
#: emporte les deux dernières minutes à la seconde. Une trace pleine en fait
#: environ trois; le reste est de la marge pour des colonnes futures.
#:
#: Deux bornes et pas une seule: un relevé arrive six fois par minute et par
#: personne, un signalement demande un clic. Leur donner la même borne
#: reviendrait à autoriser le débit du premier à la taille du second.
COMPLAINT_MAX = 16_384

#: Le temps minimum entre deux relevés d'une même page, en secondes.
#:
#: La page en envoie un toutes les dix secondes. Cinq laisse de la marge à un
#: minuteur de navigateur, qui n'arrive jamais à l'heure, sans laisser la place à
#: autre chose.
#:
#: Ce n'est pas de la prudence: mesuré le 17 août 2026, une seule page émettant
#: en boucle a fait écrire **22,6 Mo en trente secondes**, soit 2,7 Go par heure.
#: La taille d'un relevé était bornée, son DÉBIT ne l'était pas, et le balayage
#: de deux jours n'y peut rien puisqu'il efface des journées entières. Un disque
#: plein sur cette machine emporte les parties en cours avec le journal.
VITALS_EVERY = 5.0

#: Et entre deux signalements. Vingt secondes.
#:
#: Le bouton se désarme déjà trois secondes pour éviter le double clic, mais ça
#: vit dans la page, donc ça ne protège rien: ce qui compte est ce que le serveur
#: accepte. Un signalement pèse jusqu'à seize kilo-octets.
COMPLAINT_EVERY = 20.0

#: Le temps minimum entre deux messages de salle d'une même page, en secondes.
#:
#: Prendre une manette, la demander, répondre, changer de pseudo: tous des gestes
#: humains, tous rares. Une demi-seconde ne gêne personne et borne ce qu'une page
#: peut faire faire au salon.
#:
#: Et ce qu'elle fait faire n'est pas petit. Mesuré le 19 août 2026 sur le journal
#: du 18: un `seat` écrit 277 octets, appelle `GET /roms` sur le worker, et
#: diffuse l'état de la salle à toutes les pages connectées. Un message reçu
#: coûtait donc une écriture disque, une requête réseau, et autant de messages
#: sortants qu'il y a de monde. Le premier audit avait borné le débit des
#: relevés; il avait borné une charge utile plutôt qu'une classe, et ces
#: quatre-là étaient restés dehors.
ROOM_EVERY = 0.5


def not_too_often(gap: float) -> Callable[[Handler], Handler]:
    """Refuse un message qui arrive trop tôt après le précédent accepté.

    Un décorateur plutôt qu'un appel dans chaque corps, parce que c'est
    exactement l'oubli qu'on répare: l'appel existait, il était juste absent de
    quatre gestionnaires sur six.

    La cadence est retenue par NOM d'événement, donc prendre une manette ne
    consomme pas le droit de changer de pseudo. Sur le temps monotone, comme le
    reste: régler l'horloge de la machine ne doit ni ouvrir les vannes ni
    bloquer quelqu'un pour une heure.

    Le comptage se fait AVANT que le gestionnaire regarde la charge utile. Un
    message mal formé consomme donc le tour de celui qui l'envoie, ce qui est le
    bon sens: ça coûte à l'émetteur plutôt qu'au salon.
    """

    def wrap(handler: Handler) -> Handler:
        key = f"last_{handler.__name__}"

        @wraps(handler)
        async def guarded(sid: str, data: object = None) -> object:
            session = await sio.get_session(sid)
            now = monotonic()
            if too_soon(session.get(key), now, gap):
                return {"ok": False, "error": "Demande trop rapprochée. Réessaie dans un instant."}
            await sio.save_session(sid, {**session, key: now})
            # Une liste vide devenait {}, donc pouvait rendre une manette.
            # Refuser après le quota évite aussi de rendre les erreurs gratuites.
            if not isinstance(data, dict):
                return {"ok": False, "error": "Message invalide."}
            return await handler(sid, data)

        return guarded

    return wrap


def too_soon(previous: float | None, now: float, gap: float) -> bool:
    """Vrai quand ce message arrive trop tôt après le précédent accepté.

    Sur le temps MONOTONE, comme les demandes de manette: régler l'horloge de la
    machine ne doit ni ouvrir les vannes ni bloquer quelqu'un pour une heure.

    `None` veut dire « le premier », et un premier n'est jamais trop tôt: une
    page qui vient d'arriver doit pouvoir parler tout de suite, sinon on perd la
    fenêtre où les problèmes de connexion se voient le mieux.
    """
    return previous is not None and (now - previous) < gap


@sio.event
async def connect(sid: str, environ: dict[str, Any], auth: object) -> None:
    """Une page arrive, et le proxy dit déjà qui c'est.

    L'identité vient de la MONTÉE EN GRADE de la WebSocket, où Tailscale écrit le
    même en-tête que sur une requête ordinaire (vérifié le 16 août 2026). Il n'y
    a donc pas de jeton à faire circuler entre une route et une socket, ce qui
    est une pièce de moins à se faire voler.

    Sans proxy devant, on retombe sur le prénom que la page envoie: c'est du
    développement local, où il n'y a personne à usurper.
    """
    if auth is None:
        auth = {}
    if not isinstance(auth, dict):
        raise Refused("les informations de connexion doivent être un objet")
    salle = _salle_demandee(auth)
    rooms, people, journal = _state(environ, salle)
    caller = await caller_of(environ["asgi.scope"])
    login = caller[0] if caller else None
    name = people.name_for(login, caller[1]) if caller else _name(auth.get("name", "quelqu'un"))
    if name is None:
        raise Refused(f"le pseudo doit contenir de 1 à {NAME_MAX} caractères")
    # L'instant d'arrivée est MONOTONE et pas une heure: il ne sert qu'à mesurer
    # une durée au départ, et régler l'horloge de la machine ne doit pas donner
    # une séance de moins l'infini.
    session = {
        "name": name,
        "login": login,
        "visite": str((auth or {}).get("visite") or "")[:16] or None,
        "banc": bool((auth or {}).get("banc")),
        # Vrai quand cette page ne sert que de manette: elle n'ouvre ni la vidéo
        # ni le son. Sans ce drapeau, une page-manette et une page dont l'image
        # est cassée se ressemblent exactement dans le journal, puisque ni l'une
        # ni l'autre n'envoie de relevé.
        "manette": bool((auth or {}).get("manette")),
        "since": monotonic(),
        #: La salle de cette socket, pour toute sa vie. Voir `_pour`.
        "salle": salle,
    }
    admitted = False
    try:
        await sio.save_session(sid, session)
        people.arrived(sid, login, name, salle)
        await sio.enter_room(sid, piece(salle))
        journal.write("arrivée", **_who(sid, session), salle=_room_now(rooms, people))
        await broadcast(rooms, people, journal, bool(session.get("banc")), salle=salle)
        admitted = True
    except Exception as error:
        # Socket.IO ne nettoie sa propre connexion que pour ce refus nommé.
        # La trace technique reste ici ; le client ne reçoit aucun détail local.
        logger.exception("connexion au salon abandonnée", extra={"sid": sid})
        raise Refused("le salon ne peut pas encore accueillir cette connexion") from error
    finally:
        # Couvre aussi l'annulation pendant l'attente du worker. Une présence
        # ajoutée avant CONNECT ne doit jamais survivre à son échec.
        if not admitted:
            people.left(sid)
            rooms.release(sid)
            await sio.leave_room(sid, piece(salle))


@sio.event
@not_too_often(ROOM_EVERY)
async def seat(sid: str, data: dict[str, Any]) -> None:
    """Une page dit quelle manette le worker lui a donnée.

    Trois lectures possibles de ce qui arrive, et elles ne se confondent pas:
    une place absente veut dire « je rends la mienne », une place valide veut
    dire « je prends celle-là », et n'importe quoi d'autre ne veut rien dire.

    Ce troisième cas manquait. `int(port)` était appelé sans borne, alors que
    `ask` et `answer` passaient déjà par `_port`, et un objet à la place d'un
    nombre levait une `TypeError` que personne ne rattrapait.
    """
    session = await sio.get_session(sid)
    rooms, people, journal, salle = await _pour(sid)
    receipt = data.get("claim")
    if receipt is not None and (not isinstance(receipt, str) or len(receipt) > 53):
        return
    if data.get("port") is None:
        port = None
        if not rooms.watch(sid):
            return
    else:
        port = _port(data)
        if port is None:
            return
        if rooms.announced(sid, port, receipt):
            return
        await rooms.synchronise()
        # Rendre d'abord ce que des sockets mortes tiennent encore.
        #
        # Une page qui recharge ouvre sa nouvelle socket AVANT que l'ancienne
        # soit déclarée partie, alors que le worker a déjà réattribué le port:
        # il ne compte que les tuyaux vivants. Sans ce balayage, la nouvelle
        # annonce tombait sur une place tenue par un fantôme.
        rooms.forget_absent(people.live())
        try:
            rooms.claim(port, sid, session["name"], receipt)
        except SeatTaken:
            # Refusée, mais la salle est prévenue QUAND MÊME.
            #
            # L'exception traversait le gestionnaire sans que personne ne la
            # rattrape: ni le journal ni la diffusion ne tournaient, donc les
            # autres pages restaient sur l'affichage d'avant et le refus était
            # invisible. Une place refusée est un fait à montrer, pas une panne.
            journal.write(
                "place refusée",
                **_who(sid, session),
                place=port,
                raison="attribution absente" if receipt is None else "attribution non confirmée",
                salle=_room_now(rooms, people),
            )
            await broadcast(rooms, people, journal, bool(session.get("banc")), salle=salle)
            return
    journal.write(
        "place",
        **_who(sid, session),
        place=port,
        salle=_room_now(rooms, people),
    )
    await broadcast(rooms, people, journal, bool(session.get("banc")), salle=salle)


@sio.event
@not_too_often(ROOM_EVERY)
async def ask(sid: str, data: dict[str, Any]) -> None:
    """Quelqu'un demande la manette d'un autre.

    Une demande et pas une prise: le porteur est en train de jouer, et la lui
    arracher est le geste que cette salle ne doit pas rendre facile. Le serveur
    sait qui tient quoi, donc la page n'envoie qu'un numéro de port; elle n'a
    jamais à savoir comment adresser une autre page.
    """
    rooms, people, journal, _salle = await _pour(sid)
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
@not_too_often(ROOM_EVERY)
async def answer(sid: str, data: dict[str, Any]) -> None:
    """Le porteur accepte ou refuse.

    En acceptant, il libère la place ICI aussi: sans ça, la salle continuerait
    de l'afficher à son nom pendant que l'autre s'y branche, et les deux pages
    se contrediraient le temps d'un aller-retour.
    """
    rooms, people, journal, salle = await _pour(sid)
    port = _port(data)
    if port is None:
        return
    # Seul le PORTEUR répond. Sans cette ligne, n'importe qui — y compris celui
    # qui demande — pouvait envoyer « oui » à sa propre demande et libérer la
    # place de quelqu'un en train de jouer: exactement la prise que « demander
    # au lieu de prendre » existe pour empêcher. Trouvé par l'audit du
    # 2026-09-05. Vérifié AVANT de consommer la demande, sinon un faux « oui »
    # l'effacerait et le vrai porteur n'aurait plus rien à quoi répondre.
    if rooms.holder_of(port) != sid:
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
    await broadcast(rooms, people, journal, bool(session.get("banc")), salle=salle)


@sio.event
@not_too_often(ROOM_EVERY)
async def rename(sid: str, data: dict[str, Any]) -> None:
    """Quelqu'un change de pseudo, et la salle le voit tout de suite.

    Le changement est écrit par la route `PUT /api/me`, qui est la seule à savoir
    l'enregistrer. Ce message-ci ne fait que rafraîchir la session ouverte et
    prévenir les autres: sans lui, une salle continuerait d'afficher l'ancien
    pseudo jusqu'à la prochaine reconnexion.
    """
    session = await sio.get_session(sid)
    rooms, people, journal, salle = await _pour(sid)
    was = session["name"]
    now = people.name_for(session["login"]) if session["login"] else _name(data.get("name"))
    if now is None:
        return
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
    await broadcast(rooms, people, journal, bool(session.get("banc")), salle=salle)


def _measured(data: dict[str, Any], ceiling: int = VITALS_MAX) -> dict[str, Any] | None:
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
    return data if len(json.dumps(data, ensure_ascii=False)) <= ceiling else None


@sio.event
@not_too_often(VITALS_EVERY)
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
    rooms, people, journal, _salle = await _pour(sid)
    journal.write("mesures", **_who(sid, session), vu=kept, salle=_room_now(rooms, people))


@sio.event
@not_too_often(COMPLAINT_EVERY)
async def plainte(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """« Ça saccade, maintenant. »

    Le repère qui manquait le plus. Une plainte arrive le lendemain avec une
    heure approximative, et il a fallu deux fois demander une capture d'écran à
    quelqu'un qui jouait pour savoir ce qui se passait chez lui.

    Écrit comme un relevé, mais sous un autre nom pour que `just sessions` puisse
    le mettre en évidence: c'est la ligne autour de laquelle on lira les autres.

    Il emporte en plus les deux dernières minutes à la seconde, ce que les
    relevés ordinaires ne portent pas. La question devant un signalement est
    toujours « et juste avant, ça allait ? », et le relevé de dix secondes y
    répond trop grossièrement: trois secondes qui rament au milieu de sept qui
    vont bien s'y lisent comme une fenêtre à peine moins bonne.
    """
    kept = _measured(data, COMPLAINT_MAX)
    if kept is None:
        return {"ok": False, "error": "Le relevé est trop volumineux."}
    session = await sio.get_session(sid)
    rooms, people, journal, _salle = await _pour(sid)
    scope = sio.get_environ(sid)["asgi.scope"]
    peer = scope.get("client")
    connection = await read_connection(peer[0] if peer else "")
    lost = journal.dropped
    journal.write(
        "plainte",
        **_who(sid, session),
        vu=kept,
        lien=connection.kind,
        salle=_room_now(rooms, people),
    )
    return {
        "ok": journal.dropped == lost,
        "error": "Le journal n'a pas pu enregistrer le signalement.",
    }


@sio.event
async def disconnect(sid: str) -> None:
    """Une page part. SES manettes retournent à la salle, pas celles du même nom
    sur une autre machine."""
    rooms, people, journal, salle = await _pour(sid)
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
    await broadcast(rooms, people, journal, bool(session.get("banc")), salle=salle)


#: Les deux emplacements de sauvegarde, nommés comme la page les nomme.
#:
#: Un deuxième exemplaire de deux chaînes, et il est assumé: l'alternative serait
#: de laisser la page envoyer le texte à afficher, donc de laisser n'importe quel
#: navigateur écrire ce qu'il veut sur l'écran des autres. Ici, une page n'envoie
#: qu'un code, et c'est le serveur qui parle.
#:
#: Les deux exemplaires ne peuvent pas diverger en silence: un essai lit
#: `front/src/lib/saves.ts` et compare, parce que deux libellés qui se
#: contredisent donneraient à celui qui lance et à ceux qui regardent deux
#: versions différentes du même écran.
SAVES = ("partie neuve", "tout débloqué")


@sio.event
@not_too_often(ROOM_EVERY)
async def booting(sid: str, data: dict[str, Any]) -> None:
    """« Je change de jeu, tenez-vous prêts. »

    Le worker ne peut pas porter ce message: changer de jeu l'arrête, et ses
    sockets partent avec lui. Le salon reste debout pendant ces dix secondes,
    donc c'est lui qui prévient. Sans ça, seul celui qui a cliqué voyait l'écran
    de chargement; les autres regardaient du noir sans savoir si c'était cassé.

    La page envoie l'INDICE du jeu et le CODE de l'emplacement. Le serveur les
    traduit depuis sa propre bibliothèque, donc une page ne peut pas écrire un
    texte de son choix sur l'écran des autres.

    Et seul CELUI QUI DÉCIDE est relayé. Sans ce contrôle, n'importe quelle page
    pourrait cacher le jeu de tous derrière un écran de chargement qui ne mène
    nulle part.

    La règle est DEMANDÉE AU WORKER, pas rejouée ici. Ce gestionnaire tranchait
    autrefois sur son propre propriétaire élu, celui du plan de contrôle, qui est
    « le premier arrivé identifié » et ne connaît pas les absences. Le jour où le
    worker s'est mis à laisser décider quelqu'un d'autre quand le propriétaire a
    quitté son écran, les deux règles ont divergé: le lancement passait, et
    l'annonce était jetée ici. Celui qui cliquait voyait son écran de chargement,
    tous les autres voyaient dix secondes de noir.

    Le repli quand le worker ne répond pas est l'ancienne règle, et pas
    « laisser passer »: un worker muet est un worker qui redémarre, et ce n'est
    pas le moment d'ouvrir la porte à toutes les pages.
    """
    rooms, people, journal, salle = await _pour(sid)
    session = await sio.get_session(sid)
    seat = rooms.seat_of(sid)
    verdict = await may_decide(rooms.settings.worker_control, seat) if seat is not None else None
    if verdict is False:
        return
    if verdict is None:
        boss = people.owner()
        if boss is not None and session.get("login") != boss[0]:
            return
    try:
        index = int(data.get("jeu", -1))
        slot = int(data.get("sauvegarde", 0))
    except (TypeError, ValueError):
        return
    if not 0 <= slot < len(SAVES):
        return
    library, _ = await rooms.library()
    if not 0 <= index < len(library):
        return
    game = library[index].name
    journal.write(
        "changement",
        **_who(sid, session),
        jeu=game,
        sauvegarde=SAVES[slot],
        salle=_room_now(rooms, people),
    )
    # À tout le monde SAUF celui qui a cliqué: sa page a déjà posé l'écran, tout
    # de suite et sans attendre le salon. Le lui renvoyer ne ferait que remettre
    # à zéro son compteur d'images, donc allonger son attente.
    await sio.emit(
        "booting",
        {"game": game, "save": SAVES[slot], "saveSlot": slot},
        room=piece(salle),
        skip_sid=sid,
    )


@sio.event
async def preparation(sid: str, data: object = None) -> dict[str, str | bool]:
    """Chaque joueur confirme son choix ; l'initiateur lance quand tous sont prêts."""
    from nel3ab_control.api.controllers.preparation import Participant, Preparation
    from nel3ab_control.worker import launch_prepared

    if not isinstance(data, dict) or data.get("action") not in (
        "begin",
        "choose",
        "cancel",
        "launch",
    ):
        return {"error": "Demande de préparation invalide."}
    action = data["action"]
    rooms, people, journal, salle = await _pour(sid)
    session = await sio.get_session(sid)
    now = monotonic()
    # Quatre actions bornées, chacune avec la cadence existante. Le 6 septembre,
    # Chromium a confirmé « prêt » puis « lancer » dans la même demi-seconde :
    # le bouton actif était refusé parce qu'il partageait le compteur du précédent.
    # On permet cet enchaînement, tout en refusant les répétitions de chaque action.
    rate_key = f"last_preparation_{action}"
    if too_soon(session.get(rate_key), now, ROOM_EVERY):
        return {"error": "Attends un instant avant de confirmer à nouveau."}
    await sio.save_session(sid, {**session, rate_key: now})
    async with rooms.preparing:
        await rooms.synchronise()
        room = await rooms.describe(people)
        port = rooms.seat_of(sid)
        seat = next((s for s in room.seats if s.port == port), None)
        if seat is None or seat.claim is None:
            return {"error": "Attends que ta manette soit attribuée, puis réessaie."}
        try:
            if action == "begin":
                if await may_decide(rooms.settings.worker_control, seat.port) is not True:
                    raise ValueError("Cette manette ne peut pas changer le jeu maintenant.")
                index = data.get("game")
                save = data.get("save", 0)
                # Trois emplacements depuis le 12 septembre 2026: la partie neuve,
                # celle où tout est débloqué, et celle de la personne qui lance.
                if type(index) is not int or type(save) is not int or save not in (0, 1, 2):
                    raise ValueError("Le jeu ou la sauvegarde est invalide.")
                game = next((g for g in room.library if g.index == index), None)
                # La GameCube passe par ici depuis le 12 septembre 2026. Elle se
                # lançait en deux pressions, sans passer par le salon, et ce
                # raccourci coûtait l'identité: seul le salon certifie qui
                # lance, donc « ta sauvegarde » retombait en silence sur la
                # partie neuve pour ces jeux-là.
                #
                # Un disque dont la console est INCONNUE reste dehors: on ne
                # sait pas quel appareil lui présenter, et une préparation qui
                # propose une manette au hasard déciderait à la place du joueur.
                if game is None or game.console not in ("gc", "wii", "switch"):
                    raise ValueError(
                        "Cette préparation demande de savoir de quelle console est le disque."
                    )
                if rooms.preparation is not None:
                    raise ValueError("Une préparation est déjà ouverte.")
                rooms.preparation = Preparation(
                    game=index,
                    save=save,
                    starter=seat.claim,
                    # Les appareils qu'on peut présenter au jeu. Une GameCube
                    # n'en a qu'un: la préparation lui sert à choisir la
                    # sauvegarde et à confirmer, pas à choisir une manette.
                    allowed=[4]
                    if game.console == "switch"
                    else [0]
                    if game.console == "gc"
                    else game.guide.allowed
                    if game.guide
                    else [1, 0, 2, 3],
                    players=[
                        Participant(port=s.port, name=s.player, claim=s.claim)
                        for s in room.seats
                        if s.claim
                    ],
                )
            else:
                pending = rooms.preparation
                if pending is None or data.get("id") != pending.id:
                    raise ValueError(
                        "Cette préparation est terminée. Rouvre le jeu depuis le menu."
                    )
                if action == "choose":
                    pad = data.get("pad")
                    ready = data.get("ready")
                    if type(pad) is not int or type(ready) is not bool:
                        raise ValueError("Choisis un type de manette puis confirme.")
                    pending.choose(seat.claim, pad, ready)
                elif action == "cancel":
                    if seat.claim != pending.starter:
                        raise ValueError("Seule la personne qui prépare peut annuler le lancement.")
                    rooms.preparation = None
                elif action == "launch":
                    pads = pending.launch(seat.claim)
                    # L'identité vient de la SESSION, que le proxy a établie, et
                    # pas de ce que la page raconte: c'est elle qui décide dans
                    # quel dossier la partie sera écrite. Vide quand aucun proxy
                    # n'est devant, et le worker retombe alors sur la partie neuve.
                    if not await launch_prepared(
                        rooms.settings.worker_control,
                        seat.port,
                        seat.claim,
                        pending.game,
                        pending.save,
                        pads,
                        [s.claim or "-" for s in room.seats],
                        session["login"] or "",
                    ):
                        raise ValueError(
                            "Le worker n'a pas accepté le lancement. La préparation reste ouverte."
                        )
                    game = room.library[pending.game]
                    journal.write(
                        "changement",
                        **_who(sid, session),
                        jeu=game.name,
                        sauvegarde=SAVES[pending.save],
                        salle=_room_now(rooms, people),
                    )
                    await sio.emit(
                        "booting",
                        {
                            "game": game.name,
                            "save": SAVES[pending.save],
                            "saveSlot": pending.save,
                            "pads": {p.claim: p.pad for p in pending.players},
                        },
                        room=piece(salle),
                    )
                    rooms.preparation = None
                else:
                    raise ValueError("Cette action de préparation est inconnue.")
        except ValueError as error:
            return {"error": str(error)}
        await broadcast(rooms, people, journal, bool(session.get("banc")), salle=salle)
    return {"ok": True}


@sio.event
async def close_game(sid: str, data: object = None) -> dict[str, str | bool]:
    """Le chef peut fermer le jeu même après avoir rendu sa manette.

    Cette autorisation porte sur son identité authentifiée, jamais sur un nom
    envoyé par la page. Sans identité, la règle habituelle du worker s'applique
    à une attribution vérifiée. Le port privé ne peut pas être appelé par le web.
    """
    from nel3ab_control.worker import read_seats, stop_game

    rooms, people, journal, salle = await _pour(sid)
    session = await sio.get_session(sid)
    now = monotonic()
    if too_soon(session.get("last_close_game"), now, ROOM_EVERY):
        return {"error": "Attends un instant avant de réessayer."}
    await sio.save_session(sid, {**session, "last_close_game": now})
    async with rooms.preparing:
        observed = await read_seats(rooms.settings.worker_control)
        if observed is None:
            return {"error": "Le jeu ne répond pas. Réessaie dans un instant."}
        rooms.observe_seats(observed)
        boss = people.owner()
        seat = rooms.seat_of(sid)
        allowed = (
            session.get("login") == boss[0]
            if boss is not None
            else seat is not None and await may_decide(rooms.settings.worker_control, seat) is True
        )
        if not allowed:
            return {"error": "Seul le chef de la salle peut fermer le jeu."}
        _, running = await rooms.library()
        if not isinstance(data, dict) or running is None or data.get("game") != running.index:
            return {"error": "Le jeu a changé. Rouvre le menu avant de le fermer."}
        if not await stop_game(rooms.settings.worker_control, [r or "-" for r in observed]):
            return {"error": "La fermeture n'a pas été acceptée. Réessaie."}
        rooms.preparation = None
        journal.write("fermeture", **_who(sid, session), jeu=running.name)
        await broadcast(rooms, people, journal, salle=salle)
        return {"ok": True}
