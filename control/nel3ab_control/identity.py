"""Qui parle, d'après le proxy plutôt que d'après le navigateur.

Tailscale termine la connexion WireGuard, sait donc quel pair authentifié est en
face, et l'écrit dans la requête qu'il transmet:

    Tailscale-User-Login: souhib@example.com
    Tailscale-User-Name: Souhib Trabelsi

C'est une **preuve** et non une déclaration, pour deux raisons vérifiées le
16 août 2026 plutôt que supposées:

1. le proxy ÉCRASE ce que le client envoie. Une requête portant
   `Tailscale-User-Login: attaquant@example.com` arrive au service avec la vraie
   adresse, une seule fois;
2. les deux services n'écoutent que sur `127.0.0.1`, donc le proxy est le seul
   chemin. C'est ce qui transforme le point 1 en garantie, et c'est la raison
   pour laquelle cette liaison avait été choisie.

L'en-tête arrive aussi sur la MONTÉE EN GRADE d'une WebSocket, ce qui permet au
salon de reconnaître quelqu'un sans jeton à faire circuler.

Ce module ne fait que lire. Ce qu'on a le droit de faire avec cette identité est
la décision de quelqu'un d'autre, et cette séparation est délibérée.
"""

from collections.abc import Mapping
from typing import Any

LOGIN_HEADER = "tailscale-user-login"
NAME_HEADER = "tailscale-user-name"


def from_headers(headers: list[tuple[bytes, bytes]]) -> tuple[str, str] | None:
    """L'adresse et le nom du pair, ou rien.

    Prend la forme brute d'ASGI, une liste de paires d'octets, parce que c'est ce
    que python-socketio expose dans son `environ` et que FastAPI sait la donner
    aussi. Un seul lecteur pour les deux chemins, donc une seule chose à corriger
    le jour où la forme change.

    **Refuse un en-tête présent deux fois.** Le proxy n'en met qu'un, mesuré;
    mais si deux arrivaient un jour, choisir lequel croire serait exactement la
    faille. Ne rien croire est la bonne réponse à une ambiguïté sur une identité.
    """
    logins = [value for key, value in headers if key.lower() == LOGIN_HEADER.encode()]
    if len(logins) != 1:
        return None
    login = logins[0].decode("utf-8", "replace").strip().lower()
    if not login:
        return None

    names = [value for key, value in headers if key.lower() == NAME_HEADER.encode()]
    display = names[0].decode("utf-8", "replace").strip() if len(names) == 1 else ""
    return login, display


def suggested_name(login: str, display: str) -> str:
    """Le pseudo qu'on propose à quelqu'un qui n'en a pas encore choisi.

    Le prénom du nom affiché par le fournisseur d'identité, sinon ce qu'il y a
    avant l'arobase. Ce n'est qu'une proposition: le pseudo est à la personne, et
    elle en change quand elle veut.
    """
    first = display.split()[0] if display.split() else ""
    return first or login.split("@")[0] or "quelqu'un"


#: La socket par laquelle tailscaled répond aux questions de sa propre machine.
#:
#: Lisible par tout le monde (`srw-rw-rw-`), ce qui n'est pas une négligence: elle
#: n'expose que ce que la machine sait déjà de son tailnet, et poser la question
#: demande d'être sur la machine.
TAILSCALED = "/var/run/tailscale/tailscaled.sock"


async def whois(address: str, socket: str = TAILSCALED) -> tuple[str, str] | None:
    """Qui est derrière cette adresse du tailnet, d'après tailscaled.

    Pourquoi ça existe: le nom `.ts.net` est servi par tailscaled, qui écrit les
    en-têtes d'identité tout seul. Un nom de domaine à nous est servi par un
    proxy ordinaire, qui ne sait rien du tailnet et n'écrit donc rien. Le passage
    au domaine propre a fait tomber l'identité SANS RIEN CASSER DE VISIBLE: la
    salle marchait toujours, elle avait simplement cessé de savoir qui était là,
    donc plus personne n'était propriétaire et chacun pouvait changer le jeu.

    On redemande donc à tailscaled ce que tailscaled savait: la question porte
    sur l'adresse du pair, qui est une adresse du tailnet parce que le proxy
    n'écoute que sur les adresses du tailnet.

    Rend `None` sur tout échec. Un tailscaled absent, lent ou fâché doit donner
    une salle sans identité, ce qui marche, et jamais une salle qui refuse.
    """
    import httpx

    try:
        transport = httpx.AsyncHTTPTransport(uds=socket)
        async with httpx.AsyncClient(transport=transport, timeout=1.0) as client:
            # Le port est exigé par l'API et ne sert pas à identifier: tailscaled
            # répond sur l'adresse. Zéro plutôt qu'un nombre inventé qui aurait
            # l'air d'être une vraie connexion.
            #
            # Les CROCHETS autour d'une adresse v6, sinon les deux-points de
            # l'adresse et celui du port se confondent et l'API rend 404. C'est
            # le défaut qui a fait croire que le proxy n'écrivait rien: la salle
            # se joint en v6 depuis MagicDNS, donc le cas rare était le cas
            # normal, et le cas v4 que j'avais essayé à la main marchait.
            answer = await client.get(
                "http://local-tailscaled.sock/localapi/v0/whois",
                params={"addr": _with_port(address)},
            )
        if answer.status_code != 200:
            return None
        profile = answer.json().get("UserProfile") or {}
    except (OSError, ValueError, httpx.HTTPError):
        return None
    login = str(profile.get("LoginName") or "").strip().lower()
    if not login:
        return None
    return login, str(profile.get("DisplayName") or "").strip()


def _with_port(address: str) -> str:
    """L'adresse sous la forme que l'API locale attend, port compris."""
    return f"[{address}]:0" if ":" in address else f"{address}:0"


async def caller_of(scope: Mapping[str, Any]) -> tuple[str, str] | None:
    """Qui parle, par les deux portes, avec le même verdict.

    **Deux chemins, parce qu'il y a deux portes.** Le nom `.ts.net` est servi par
    tailscaled, qui écrit lui-même les en-têtes d'identité: c'est le chemin
    d'origine, et il reste le premier essayé. Le nom de domaine à nous passe par
    un proxy ordinaire, qui ne sait rien du tailnet. Là, on redemande à
    tailscaled qui se cache derrière l'adresse du pair.

    **Ce qui rend le deuxième chemin sûr n'est pas un en-tête.** `scope["client"]`
    est l'adresse que le serveur ASGI a établie: il ne remplace le pair réel par
    l'adresse annoncée dans `X-Forwarded-For` que si la connexion vient d'un
    proxy déclaré de confiance, et ce proxy est la boucle locale (voir
    `--forwarded-allow-ips` dans l'unité systemd). Lire l'en-tête nous-mêmes
    aurait posé une deuxième règle à côté de celle-là, et deux règles sur une
    identité finissent par ne pas dire la même chose.

    Une seule fonction pour HTTP et pour la WebSocket, pour la même raison: le
    jour où deux lecteurs divergent, c'est une porte qui laisse passer ce que
    l'autre refuse.
    """
    direct = from_headers(scope["headers"])
    if direct is not None:
        return direct
    client = scope.get("client")
    return await whois(str(client[0])) if client else None
