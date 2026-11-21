"""Ce que le plan de contrôle dit au worker, et ce qu'il lui demande.

Deux messages. Le premier DIT quelle place a le droit de changer de jeu. Le
second DEMANDE si une place a ce droit maintenant, ce qui n'est pas la même
question: le worker sait une chose que le plan de contrôle ne peut pas savoir,
depuis quand le propriétaire n'a rien touché.

Les deux partent sur un port que le proxy ne relaie pas, donc que seul un
processus de cette machine peut atteindre — c'est ce qui fait la différence entre
une règle et une convention d'affichage.

Une ligne de texte plutôt qu'une requête HTTP: deux messages, et une
bibliothèque de plus pour les écrire serait une dépendance à tenir à jour pour
trois mots.
"""

import re

import anyio

#: Ce qui peut mal se passer sur cette socket, et qui ne doit jamais remonter.
#:
#: `EndOfStream` et `BrokenResourceError` viennent d'anyio et ne sont PAS des
#: `OSError`: un worker qui accepte la connexion puis raccroche sans répondre
#: lève la première, et rien ne l'attrapait. Trouvé le 31 août 2026 par l'essai
#: qui répond zéro octet, pas en lisant le code. Une diffusion de salon serait
#: morte sur une exception pour un worker en train de redémarrer.
MUTE = (OSError, TimeoutError, ValueError, anyio.EndOfStream, anyio.BrokenResourceError)


def seat_receipts(line: bytes) -> list[str | None] | None:
    """Quatre repères exacts, ou aucune réponse exploitable.

    Ce n'est pas une identité : le salon conserve la personne authentifiée et
    compare seulement son attribution à celle que le worker tient maintenant.
    """
    try:
        values = line.decode("ascii").strip().split()
    except UnicodeError:
        return None
    if len(values) != 4:
        return None
    if any(
        value != "-" and not re.fullmatch(r"[0-9a-f]{32}-[1-9][0-9]{0,19}", value)
        for value in values
    ):
        return None
    occupied = [value for value in values if value != "-"]
    if len(set(occupied)) != len(occupied):
        return None
    return [None if value == "-" else value for value in values]


async def read_seats(address: str) -> list[str | None] | None:
    """Lit le worker même si aucune page ne tient plus de manette.

    Au plus 256 octets : quatre préfixes de 32 caractères, quatre compteurs
    u64 de 20 chiffres et leurs séparateurs tiennent dans 216 octets. Un vieux
    worker répond `no`, ce qui reste distinct de quatre places libres.
    """
    host, _, port = address.rpartition(":")
    try:
        with anyio.fail_after(2):
            async with await anyio.connect_tcp(host or "127.0.0.1", int(port)) as stream:
                await stream.send(b"seats\n")
                answer = b""
                while b"\n" not in answer and len(answer) < 256:
                    answer += await stream.receive(256 - len(answer))
                if not answer.endswith(b"\n"):
                    return None
        return seat_receipts(answer)
    except MUTE:
        return None


async def tell_owner(address: str, seat: int) -> bool:
    """Dit au worker quelle place décide. `0` veut dire personne.

    Rend si l'ordre a été pris. Un worker qui ne répond pas n'est pas une erreur
    à remonter: il redémarre à chaque changement de jeu, et la salle marche sans
    lui le temps qu'il revienne. Il redemandera son propriétaire à la prochaine
    diffusion.
    """
    host, _, port = address.rpartition(":")
    try:
        with anyio.fail_after(2):
            stream = await anyio.connect_tcp(host or "127.0.0.1", int(port))
            async with stream:
                await stream.send(f"owner {seat}\n".encode())
                answer = await stream.receive(16)
        return answer.strip() == b"ok"
    except MUTE:
        return False


async def may_decide(address: str, seat: int) -> bool | None:
    """Cette place a-t-elle le droit de changer de jeu, selon le worker ?

    `None` veut dire « le worker n'a pas répondu », et l'appelant décide alors
    lui-même plutôt que de supposer. Ne pas confondre avec `False`, qui est une
    réponse: traiter les deux pareil rendrait la salle muette chaque fois que le
    worker redémarre, c'est-à-dire à chaque changement de jeu.
    """
    if not 1 <= seat <= 4:
        return False
    host, _, port = address.rpartition(":")
    try:
        with anyio.fail_after(2):
            stream = await anyio.connect_tcp(host or "127.0.0.1", int(port))
            async with stream:
                await stream.send(f"decides {seat}\n".encode())
                answer = await stream.receive(16)
    except MUTE:
        return None
    said = answer.strip()
    # `yes` et `no` sont les deux seules réponses attendues. Tout le reste est un
    # worker qui n'a pas compris, donc une absence de réponse et non un refus.
    if said == b"yes":
        return True
    return False if said == b"no" else None


#: La plus longue clé qu'un nom de fichier Linux permet, en octets (`NAME_MAX`).
KEY_MAX_BYTES = 255


def valid_key(key: str) -> bool:
    """Ce qu'un nom de fichier dans une bibliothèque peut être, et rien d'un chemin.

    Les mêmes règles que `GameKey::new` côté worker. Le salon ne joint jamais une
    clé à un dossier, mais il ne doit pas non plus envoyer au worker ce que le
    worker refusera: le refus y serait un « no » sans raison lisible ici.
    """
    return (
        bool(key)
        and len(key.encode()) <= KEY_MAX_BYTES
        and key not in (".", "..")
        and "/" not in key
        and not any(ord(letter) < 0x20 or 0x7F <= ord(letter) <= 0x9F for letter in key)
    )


def game_field(game: int, key: str | None) -> str | None:
    """Le jeu tel que la ligne de lancement l'écrit, ou rien s'il est invalide.

    La clé en hexadécimal, après un `k`: un nom de jeu porte des espaces, et la
    ligne se découpe aux espaces. Sans clé, la position, pour un worker qui n'en
    publie pas encore.
    """
    if key is not None:
        return "k" + key.encode().hex() if valid_key(key) else None
    return str(game) if 0 <= game <= 255 else None


async def launch_prepared(
    address: str,
    seat: int,
    claim: str,
    game: int,
    save: int,
    pads: list[int],
    expected: list[str],
    person: str = "",
    *,
    key: str | None = None,
) -> bool:
    """Un ordre complet, avec un accusé de réception du worker.

    `person` est l'identité de qui lance, pour l'emplacement de sauvegarde
    personnel. Vide veut dire personne, et le worker retombe alors sur la partie
    neuve. Elle part d'ICI et de nulle part ailleurs: le salon est le seul à la
    tenir du proxy, donc le seul à pouvoir la certifier.

    `key` désigne le jeu par son nom de fichier (ADR D23). Quand elle est donnée,
    c'est elle qui part, et le worker la résout contre sa propre bibliothèque:
    `game` n'est alors plus envoyé.
    """
    field = game_field(game, key)
    if (
        seat not in range(1, 5)
        or field is None
        or save not in (0, 1, 2)
        # Un espace couperait la ligne en deux et décalerait tout ce qui suit.
        or len(person) > 64
        or any(blanc in person for blanc in " \t\n\r")
        or len(expected) != 4
        or seat_receipts((" ".join(expected)).encode()) is None
        or len(pads) != 4
        or any(p not in (0, 1, 2, 3, 4) for p in pads)
    ):
        return False
    if not re.fullmatch(r"[0-9a-f]{32}-[1-9][0-9]{0,19}", claim):
        return False
    host, _, port = address.rpartition(":")
    try:
        with anyio.fail_after(2):
            async with await anyio.connect_tcp(host or "127.0.0.1", int(port)) as stream:
                await stream.send(
                    (
                        f"launch {seat} {claim} {field} {save} "
                        + " ".join(map(str, pads))
                        + " "
                        + " ".join(expected)
                        # Un tiret pour « personne », comme une place libre.
                        + " "
                        + (person or "-")
                        + "\n"
                    ).encode()
                )
                answer = b""
                while b"\n" not in answer and len(answer) < 16:
                    answer += await stream.receive(16 - len(answer))
                return answer == b"ok\n"
    except MUTE:
        return False


async def stop_game(address: str, expected: list[str]) -> bool:
    """Ferme le jeu par le port privé, après autorisation dans le salon."""
    if seat_receipts((" ".join(expected)).encode()) is None:
        return False
    host, _, port = address.rpartition(":")
    try:
        with anyio.fail_after(2):
            async with await anyio.connect_tcp(host or "127.0.0.1", int(port)) as stream:
                await stream.send(("stop " + " ".join(expected) + "\n").encode())
                answer = b""
                while b"\n" not in answer and len(answer) < 16:
                    answer += await stream.receive(16 - len(answer))
                return answer == b"ok\n"
    except MUTE:
        return False
