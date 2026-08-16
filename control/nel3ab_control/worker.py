"""Ce que le plan de contrôle dit au worker.

Un seul message existe: quelle place a le droit de changer de jeu. Il part sur un
port que le proxy ne relaie pas, donc que seul un processus de cette machine peut
atteindre — c'est ce qui fait la différence entre une règle et une convention
d'affichage.

Une ligne de texte plutôt qu'une requête HTTP: un seul message, et une
bibliothèque de plus pour l'écrire serait une dépendance à tenir à jour pour deux
mots.
"""

import anyio


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
    except (OSError, TimeoutError, ValueError):
        return False
