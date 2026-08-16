# Le plan de contrôle

Qui est là, comment il s'appelle, quelle partie tourne, qui tient quelle manette.
**Jamais une image, jamais un son, jamais un appui de bouton** : ceux-là passent
par les sockets du worker, que le navigateur ouvre lui-même (ADR D12).

La preuve n'est pas une affirmation : **arrêtez ce service, une partie déjà
ouverte continue**. Ce qui casserait était sur le chemin critique et n'aurait pas
dû s'y trouver.

## Ce qu'il expose

| | |
|---|---|
| `GET /api/room` | le salon : jeu en cours, bibliothèque, places et noms |
| `POST /api/room/seats/{port}` | untel dit qu'il tient cette manette |
| `/socket.io` | les événements du salon : qui arrive, qui part, qui prend une place |
| `/openapi.json` | le contrat, d'où le client TypeScript est engendré |

## Les commandes

```
uv run poe check     # lint + format + types + tests, ce que la CI lance
uv run poe fix       # formate et corrige ce qui se corrige
uv run poe serve     # sur le port 8200, rechargement à chaud
```

## Ce qu'il ne fait pas

**Il n'authentifie personne.** Une personne donne un nom, et c'est tout : les
salons sont privés et partagés avec des gens déjà sur le réseau. Le jour où un
salon se partage hors du tailnet, c'est la première décision à reprendre.

**Les places qu'il montre sont RÉCLAMÉES, pas tenues.** Le worker est le seul à
savoir qui a vraiment une manette. Les deux peuvent diverger une seconde après
une reconnexion, et la page croit le worker.
