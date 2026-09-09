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
| `GET /api/me`, `PUT /api/me` | identité reçue du proxy, pseudo et droit de publier la référence ; modification du pseudo |
| `GET /api/me/bindings`, `PUT /api/me/bindings` | réglages personnels, profils et préférences par jeu |
| `GET /api/me/connection` | trajet Tailscale observé pour cette connexion, lorsqu'il est disponible |
| `GET /api/room/bindings`, `PUT /api/room/bindings` | référence de touches ; publication réservée à l'administrateur configuré |
| `/socket.io` | présence, annonce de place, préparation collective, reprise du rôle ou d'une manette, fermeture du jeu et signalements |
| `/openapi.json` | le contrat, d'où le client TypeScript est engendré |

Les changements de place passent par le worker et une annonce Socket.IO portant
son reçu. L'ancienne route `POST /api/room/seats/{port}` n'existe plus. Le jeu
courant peut être nul : la salle reste ouverte après « Fermer le jeu ».

## Les commandes

```
uv run poe check     # lint + format + types + tests, ce que la CI lance
uv run poe fix       # formate et corrige ce qui se corrige
uv run poe serve     # sur le port 8200, rechargement à chaud
```

## Identité et autorité, état du 9 septembre 2026

Tailscale identifie la personne sans formulaire de connexion. La porte `.ts.net`
reçoit les en-têtes écrits par tailscaled ; la porte `nel3ab.app` retire ceux que
le client pourrait forger, puis le service consulte tailscaled avec l'adresse
du pair fournie par le proxy de confiance. Les deux origines de jeu figurent
dans l'unité du service. Le repli sans proxy conserve un nom de navigateur,
pas les droits d'une identité authentifiée. ADR D14 décrit ces frontières.

Le worker est l'autorité des places. Le salon lit ses quatre reçus sur le port
de contrôle privé et les rapproche des annonces des navigateurs. Une annonce
ancienne ne peut pas renommer le nouveau titulaire. Une réponse manquante
conserve la dernière lecture complète ; seule une place confirmée libre efface
son nom. Les personnes en attente d'attribution ne deviennent pas spectatrices
par déduction. Voir D16 et les tests de reçus dans `tests/api`.

Le chef choisit les jeux ; l'administrateur publie la référence de touches.
Ce sont deux droits distincts. Reprendre un rôle ou une manette d'une personne
absente suit D19 : avertissement, réponse possible, puis confirmation explicite.
La préparation Wii ou Switch exige le choix des places présentes et vérifie
encore leurs reçus avant le lancement. Aucune commande de jeu ne traverse Python.

Les présences, le chef choisi et les préparations sont en mémoire. Redémarrer
le salon provoque les reconnexions et une nouvelle élection. Les pseudos,
correspondances et références sont persistants, avec des écritures sérialisées.
Les copies locales restent sur le même disque ; une sauvegarde hors machine
avec restauration exercée n'est pas encore en place.

Le [suivi du projet](../docs/etat-du-projet.md) relie ces contrats aux incidents,
aux corrections et aux limites des essais. Les fixtures utilisent des ports et
des fichiers temporaires : un worker HTTP simulé n'isole pas à lui seul le port
de contrôle de la salle en service.
