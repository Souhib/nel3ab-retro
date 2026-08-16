# La page

Ce que voit un joueur : l'image, le son, les quatre prises de manette, la
bibliothèque, et les mesures à droite.

## La règle qui gouverne ce dossier

**React ne touche pas au chemin de l'image.**

La boucle média vit dans `src/media/`, en TypeScript ordinaire : elle possède le
canevas, décode, ordonnance et peint sur `requestAnimationFrame`, et ne provoque
jamais de rendu. React lui donne le canevas au montage et le reprend au
démontage, rien d'autre.

Les chiffres remontent par `src/lib/useSession.ts`, qui s'abonne avec
`useSyncExternalStore` à un instantané reconstruit **deux fois par seconde**.
C'est la vitesse à laquelle un humain lit un nombre, pas celle à laquelle il
change.

Un composant qui voudrait lire l'image, la redimensionner ou compter des trames
est un composant à réécrire en module.

## Les deux services derrière

| chemin | qui répond | ce qu'il donne |
|---|---|---|
| `/video`, `/sound`, `/input` | le worker | l'image, le son, les manettes |
| `/roms` | le worker | la bibliothèque, et le jeu en cours |
| `/api`, `/socket.io` | le plan de contrôle | le nom du salon, les noms des joueurs |

Les deux doivent répondre sur **la même origine** : le worker refuse une
WebSocket dont l'`Origin` n'est pas son propre `Host`. En production, un seul
nom d'hôte est réparti par `tailscale serve` ; en développement, le proxy de
Vite fait la même chose (`vite.config.ts`).

Si le plan de contrôle ne répond pas, la page se rabat sur le worker seul : elle
affiche « occupée » au lieu d'un prénom, et tout le reste marche.

## Les commandes

| | |
|---|---|
| `npm run dev` | la page en développement, avec les deux proxys |
| `npm run build` | écrit la page **dans l'arborescence du worker** |
| `node stamp.mjs` | marque la page avec le haché de ses sources |
| `node stamp.mjs --check` | échoue si la page ne vient pas de ces sources |
| `npm test` | les tests unitaires (vitest) |
| `npm run generate` | régénère le client depuis `../control/openapi.json` |

`just front`, `just front-build` et `just front-check` les enveloppent, et
`just check` les fait tourner.

## Pourquoi la page est committée

Le worker la porte dans son binaire (`include_str!`), donc elle doit exister
comme fichier. La construire depuis `build.rs` ferait dépendre chaque
compilation Rust de node. Le prix est un artefact committé, et la marque est ce
qui empêche qu'il devienne périmé (ADR D13).
