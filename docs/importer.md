# Déposer un jeu

La page `/importer` du salon reçoit des fichiers de jeu, reconnaît leur console
dans leurs octets, et range ceux que la salle sait faire tourner. Le récit de sa
construction est dans le [carnet](carnet-de-bord.md), entrée « 21 novembre :
déposer un jeu et le laisser se ranger ».

## Qui peut déposer

L'administrateur du salon (`NEL3AB_ADMIN`), et les adresses écrites dans
`NEL3AB_IMPORTEURS`, une liste JSON vide par défaut :

```ini
Environment='NEL3AB_IMPORTEURS=["ami@example.com"]'
```

Les autres voient la page avec une phrase qui explique le refus, et l'accueil
ne leur montre pas le lien. Les routes refusent elles-mêmes : 401 sans
identité, 403 pour une adresse non admise.

## Déposer

1. Ouvrir `https://nel3ab.app/importer`, ou le lien « déposer un jeu » en bas de
   l'accueil.
2. Lâcher un ou plusieurs fichiers dans la zone, ou cliquer pour les choisir.
3. Chaque fichier reçoit une carte. La ligne marquée « estimation » est ce que
   la page a lu au début du fichier. Le verdict qui compte arrive ensuite, en
   tampon : c'est le serveur qui relit le fichier entier.

Pause, reprise et abandon sont sur chaque carte. Un envoi coupé, ou une page
fermée, reprend où le serveur en était : il suffit de redéposer le même fichier.

La page n'est servie que par le domaine `nel3ab.app`. Sur la porte
`.ts.net:8443`, la racine mène encore à l'ancien port 8100.

## Ce qui arrive à chaque console

| Console | Ce que fait l'import |
|---|---|
| GameCube, Wii (ISO, RVZ, GCZ, CISO) | rangé dans le dossier `gc` ou `wii`, sous le titre écrit dans le disque |
| GameCube, Wii (WBFS, WIA) | gardé de côté : la salle ne liste pas ces formats, à convertir en RVZ |
| Image NKit | à confirmer : Dolphin la lit mal |
| Switch (NSP, XCI) | à confirmer : l'identifiant de titre demande la clé de la console, que le salon ne lit pas. L'inscription `<fichier>.nel3ab.json` s'écrit à la main ([Switch dans la salle](switch-room.md)) |
| Switch (NSZ, XCZ) | gardé de côté : format compressé, à décompresser |
| Switch 2 (NUP) | à confirmer : inscription à la main |
| Xbox 360 (XEX, STFS, XISO) | reconnu, pas encore jouable |
| NES, N64, Game Boy, GBA, DS, Mega Drive, PlayStation | reconnu, pas encore jouable |
| Archive zip | ouverte, chaque fichier suit la ligne de sa console |
| Archive 7z ou rar | ouverte par `lsar` et `unar` s'ils sont installés, sinon gardée de côté |
| Fichier inconnu | gardé en quarantaine |

Un jeu rangé apparaît à la prochaine ouverture de salle ou au prochain
changement de jeu : une salle lit sa bibliothèque à son démarrage.

Le rangement refuse un nom déjà pris, un nom qui partagerait les sauvegardes
d'un autre jeu (« Jeu.iso » et « jeu.iso »), le même fichier déjà rangé, et le
même jeu, même code et même disque, déjà dans le même dossier. Il ne remplace
jamais un fichier existant.

## La quarantaine

Ce qui n'est pas rangé reste dans `~/.local/state/nel3ab/imports/<id>/`. Le
bouton « retirer » d'une carte efface ce dossier ; un jeu déjà rangé n'y est
plus, et n'est pas touché. Rien n'est effacé automatiquement.

## Réglages du salon

| Variable | Défaut | Rôle |
|---|---|---|
| `NEL3AB_ROM_DIR` | `~/roms/gc:~/roms/wii` | les dossiers de jeux, la même liste que le worker ; un jeu va dans celui qui porte le nom de sa console |
| `NEL3AB_IMPORTEURS` | `[]` | qui peut déposer, en plus de l'administrateur |
| `NEL3AB_IMPORTS_DIR` | `~/.local/state/nel3ab/imports` | la quarantaine, sur le même disque que les jeux |
| `NEL3AB_IMPORTS_MARGE` | 100 Gio | l'espace qui doit rester libre sur le disque après un envoi |
| `NEL3AB_IMPORTS_MAX` | 48 Gio | la taille la plus grande d'un envoi |
| `NEL3AB_IMPORTS_TOTAL` | 128 Gio | ce que la quarantaine peut tenir en tout |

Les tailles s'écrivent en octets. La marge et les plafonds sont des choix, pas
des mesures. Un changement demande de redémarrer `nel3ab-control`.

## Le protocole

Pour un outil qui voudrait déposer sans la page. Chaque écriture porte
l'origine d'une page du salon (`Origin`), comme toute écriture au salon.

- `POST /api/imports` avec `{nom, taille, empreinte_rapide}` : rend `{id,
  decalage}`, ou 409 si le fichier est déjà dans la bibliothèque ou déjà en
  route (avec son `id` et son `decalage` quand il est à la même personne).
- `PUT /api/imports/{id}?decalage=N` : un morceau brut de 32 Mio au plus, avec
  un `Content-Length` exact. 409 avec le vrai décalage si `N` est faux.
- `GET /api/imports/{id}` : le décalage, l'état et ce qui a été reconnu.
- `POST /api/imports/{id}/fin` : lance la vérification et le rangement.
- `DELETE /api/imports/{id}` : abandonne et efface la quarantaine de l'envoi.

L'empreinte rapide est le SHA-256 des 4 premiers Mio, des 4 derniers (sans
recouvrir les premiers) et de la taille sur 8 octets gros-boutistes.
