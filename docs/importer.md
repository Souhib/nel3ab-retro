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
| Jeu Switch (NSP, XCI) | rangé dans le dossier `switch` avec sa fiche `<fichier>.nel3ab.json`, quand le salon a la clé d'en-tête de la console (voir [La Switch](#la-switch)) |
| Jeu Switch, sans clé réglée | à confirmer : la fiche s'écrit à la main ([Switch dans la salle](switch-room.md)) |
| Mise à jour Switch | mise à jour, gardée de côté : la salle Switch la lit dans son dossier privé, jeu par jeu |
| Contenu additionnel Switch | contenu additionnel, gardé de côté : `switch-dlc.py` l'inscrit pour son jeu |
| Switch illisible avec la clé | refusé : clé fausse, ou fichier abîmé |
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
d'un autre jeu (« Jeu.iso » et « jeu.iso »), le même fichier déjà rangé, le
même jeu, même code et même disque, déjà dans le même dossier, et un jeu Switch
dont l'identifiant de titre est déjà inscrit par la fiche d'un autre fichier ou
au catalogue des salles. Il ne remplace jamais un fichier existant.

## La Switch

Un jeu Switch n'entre dans la salle qu'avec une fiche `<fichier>.nel3ab.json`
qui porte son identifiant de titre. Cet identifiant est écrit dans l'en-tête de
chaque NCA du jeu, chiffré avec la clé d'en-tête de la console. Le salon lit
cette clé dans le `prod.keys` désigné par `NEL3AB_SWITCH_KEYS`, et n'en lit que
la ligne `header_key`. Il ne l'écrit nulle part et ne la montre jamais.

Pour un NSP, ou la partition « secure » d'un XCI, l'import déchiffre les 0xC00
premiers octets de chaque NCA. Chaque en-tête doit porter la marque « NCA3 » ou
« NCA2 » et annoncer la taille exacte de sa partie : sinon le fichier est
refusé, puisqu'une mauvaise clé ou un fichier abîmé donne des octets au hasard.
La partie Meta dit ensuite ce qu'est le fichier :

- un identifiant qui finit par `000` : un jeu. Il est rangé, et sa fiche est
  écrite à côté de lui, avant lui ;
- le même plus `0x800` : sa mise à jour, gardée de côté ;
- le même plus `0x1000` et un numéro : un contenu additionnel, gardé de côté ;
- plusieurs jeux dans un fichier, aucune partie Meta, un jeu sans sa partie
  Program, un titre du système ou de la Switch 2 : à confirmer.

Le nom du jeu vient du nom du fichier, sans ce qui est entre crochets ou entre
parenthèses : « Mario Kart 8 Deluxe [0100152000022000][v0].nsp » devient
« Mario Kart 8 Deluxe.nsp ». Le titre écrit dans le jeu est dans sa partie
Control, chiffrée avec une autre clé, et n'est pas lu. La fiche écrite est :

```json
{
  "console": "switch",
  "name": "Mario Kart 8 Deluxe",
  "title": "0100152000022000",
  "inscription": "import: titre lu dans l'en-tête NCA, sans lancement d'essai"
}
```

Le champ `inscription` la distingue des fiches écrites à la main après un
lancement d'essai ; le worker ne le lit pas. Rien n'est ajouté pour l'image,
l'éditeur ou la présentation : ils s'ajoutent à la main, comme avant.

Une mise à jour ou un contenu additionnel n'est pas installé par cette page.
La salle Switch les lit dans son dossier privé `updates`, choisis jeu par jeu
dans les deux emplacements de sauvegarde ; un contenu additionnel s'y inscrit
avec `docker/switch-dlc.py`, salle fermée. Le message de la carte nomme le jeu
quand il est déjà dans la bibliothèque. La Switch 2 (NUP) reste à confirmer.

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
| `NEL3AB_SWITCH_KEYS` | aucun | le `prod.keys` de la console, pour lire le titre d'un jeu Switch ; sans lui, la Switch reste à confirmer |

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
