"""Qui parle, d'après le proxy plutôt que d'après le navigateur.

Tailscale termine la connexion WireGuard, sait donc quel pair authentifié est en
face, et l'écrit dans la requête qu'il transmet:

    Tailscale-User-Login: souhib.t@hotmail.fr
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
