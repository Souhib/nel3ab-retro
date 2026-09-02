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

import anyio

#: Ce qui peut mal se passer sur cette socket, et qui ne doit jamais remonter.
#:
#: `EndOfStream` et `BrokenResourceError` viennent d'anyio et ne sont PAS des
#: `OSError`: un worker qui accepte la connexion puis raccroche sans répondre
#: lève la première, et rien ne l'attrapait. Trouvé le 31 août 2026 par l'essai
#: qui répond zéro octet, pas en lisant le code. Une diffusion de salon serait
#: morte sur une exception pour un worker en train de redémarrer.
MUTE = (OSError, TimeoutError, ValueError, anyio.EndOfStream, anyio.BrokenResourceError)


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
