# Jouer à la Switch dans la salle

État au **11 septembre 2026**. Les choix et leurs expériences restent dans
l'[étude Switch](etude-switch-2026-09-07.md) ; les travaux communs à la salle
sont indexés dans l'[état du projet](etat-du-projet.md).

La Switch apparaît dans le même catalogue que la GameCube et la Wii. Le chef
choisit un jeu et son emplacement de sauvegarde. Chaque joueur assis reçoit
l'écran de préparation : tester sa manette, charger ou enregistrer son profil,
puis choisir « Je suis prêt ». Le chef lance quand toutes les places présentes
ont confirmé. Une personne qui regarde ne bloque pas le lancement.

Les profils Switch sont personnels, synchronisés comme les touches clavier.
Une perte du salon conserve les modifications en attente dans le navigateur.
Le chargement d'un profil nommé reste manuel : la préférence par jeu du
configurateur Dolphin n'est pas encore proposée pour la Switch.
Le clavier, une manette physique et les commandes tactiles produisent une
manette Pro. Home, Capture, le mouvement et les Joy-Con séparés ne sont pas
raccordés. Mario Tennis dispose d'une fiche de commandes ; les options internes
au jeu peuvent modifier R et ZR.

« Fermer le jeu » dans le rayon salle laisse le catalogue ouvert. Le worker
attend la fermeture de l'émulateur et la copie des sauvegardes. La réattribution
des manettes suit sa reconnexion ; si un lancement arrive pendant cette courte
fenêtre, le salon demande explicitement de réessayer.

## Jeux et données privées

Le fichier privé `~/.config/nel3ab/switch.json` désigne les chemins et valeurs suivants :

| Champ | Contenu |
|---|---|
| `image` | Identifiant de l'image Docker validée |
| `engine` | Dossier contenant `publish/Ryujinx` |
| `template` | Configuration système privée de Ryubing |
| `state` | Racine des sauvegardes par jeu et emplacement |
| `updates` | Dossier privé des mises à jour et contenus additionnels, monté en lecture seule |

L'unité du worker fournit `NEL3AB_SWITCH_CONFIG`. Les fichiers du jeu restent
hors du dépôt. Le catalogue n'accepte un NSP ou XCI qu'avec un fichier voisin
`<nom-du-jeu>.xci.nel3ab.json`, ou son équivalent NSP :

```json
{"console":"switch","name":"Mario Tennis Aces","title":"0100BDE00862A000"}
```

Cette inscription suit une vérification du jeu lancé. Une extension NSP seule
peut désigner une mise à jour. Les sauvegardes sont rangées par identifiant de
jeu, jamais par position dans le menu. Ajouter une inscription n'installe ni
firmware ni mise à jour. Les procédures et les versions modifiées de Ryubing et
du capturateur restent décrites dans
[l'étude](etude-switch-2026-09-07.md) et `spikes/switch-room/README.md`.

L'inscription accepte aussi `maker` (éditeur, 128 octets maximum) et `about`
(présentation courte, 1 024 octets maximum). Une image locale voisine,
`<nom-du-jeu>.xci.nel3ab.png`, alimente la même route de jaquette que les autres
consoles. Le PNG doit être complet, mesurer au plus 1 024 × 1 024 pixels et peser
au plus 1 Mio. Un fichier absent ou invalide laisse le jeu visible sans image.
La salle ne lance pas Dolphin et ne contacte pas un site externe pour cette lecture.

Pour Mario Tennis, l'image vient de la
[fiche Nintendo](https://www.nintendo.com/us/store/products/mario-tennis-aces-switch/),
récupérée le 9 septembre 2026 en 640 × 360 pixels, soit 497 170 octets.
L'adresse d'origine est conservée dans l'inscription privée du jeu. Elle est
servie par nel3ab avec l'éditeur et une courte description ; les trois menus
gardent l'image entière dans leur cadre.

## Copies et restauration

Chaque jeu possède deux dossiers indépendants : `neuve` pour la progression,
`debloquee` pour une partie importée. La progression continue d'une visite à
l'autre. Une copie locale de son système de fichiers utilisateur est faite avant
le lancement et après l'arrêt. Ces copies protègent d'une mauvaise importation,
pas de la perte du disque de la machine.

Fermer le jeu avant toute modification. Le verrou de l'emplacement refuse les
imports et restaurations tant que l'émulateur l'utilise.

```sh
python3 docker/switch-saves.py ~/.config/nel3ab/switch.json 0100bde00862a000 neuve list
python3 docker/switch-saves.py ~/.config/nel3ab/switch.json 0100bde00862a000 neuve backup
python3 docker/switch-saves.py ~/.config/nel3ab/switch.json 0100bde00862a000 neuve restore NOM_DE_LA_COPIE
```

Une sauvegarde complète s'importe dans `debloquee`, pour un jeu dont une
sauvegarde a déjà été ouverte dans le jeu lui-même :

```sh
python3 docker/switch-saves.py ~/.config/nel3ab/switch.json TITRE debloquee prepare
# lancer et fermer cet emplacement une fois, pour que le jeu crée sa sauvegarde
python3 docker/switch-saves.py ~/.config/nel3ab/switch.json TITRE debloquee import /chemin/sauvegarde.zip \
  --source ADRESSE --note "ce que l'auteur annonce"
```

La liste `RULES` de `docker/switch-saves.py` dit, jeu par jeu, quels fichiers
de l'archive sont pris : des noms précis, ou tout un dossier. Un jeu absent de
cette liste est refusé. L'outil retrouve la sauvegarde du joueur par ses
métadonnées (`ExtraData0` : programme et type), car le modèle apporte aussi le
conteneur de Mario Tennis dans chaque emplacement. Il refuse une archive dont un
chemin sort de ses dossiers, borne les tailles, copie l'emplacement avant
d'écrire, remplace entièrement les deux banques `0` et `1`, et retient l'origine,
l'empreinte et les fichiers pris dans `import.json`.

La restauration conserve aussi l'état remplacé. Ne pas supprimer les fichiers
`ExtraData` ou les dossiers `0` et `1` : les index du système les référencent.
La création d'un emplacement vierge conserve cette structure et vide seulement
les fichiers de progression.

## Mario Tennis : sauvegarde communautaire

Une sauvegarde annoncée « Complete + Online Skins Unlocked » provient de
[l'index NX_Saves](https://github.com/Viren070/NX_Saves/blob/main/index.md).
L'archive contient seulement `save.dat` et `save7.dat`. Son empreinte SHA-256 est
`aa1c8f76aa60bc263ad6612433d6abb85bb05c867ebfec6b9d6f22f2867c1685`.

Le 9 septembre 2026, l'importation dans un emplacement isolé se charge avec la
version 1.0.0 du jeu : Mario niveau 99, carte d'aventure ouverte et six raquettes
visibles. Après raccordement de la mise à jour 3.1.0, les quatre personnages du double
et les courts d'aventure ont aussi été ouverts. Toutes les tenues et chaque défi
n'ont pas été inspectés. Cela confirme
la compatibilité observée, pas l'affirmation exhaustive « 100 % » de l'auteur.

```sh
python3 docker/switch-saves.py ~/.config/nel3ab/switch.json 0100bde00862a000 debloquee prepare
python3 docker/switch-saves.py ~/.config/nel3ab/switch.json 0100bde00862a000 debloquee import /chemin/sauvegarde.zip
```

L'importateur ne prend que ces deux noms pour ce jeu.

## Looney Tunes : Wacky World of Sports

Le jeu fourni est inscrit sous `0100D3601D4B4000`. Le 9 septembre 2026, son XCI
et sa mise à jour NSP `65536` démarrent ensemble dans une salle isolée.
L'émulateur annonce la version `0.1.0.27382`. La mise à jour reste dans le dossier
privé `updates` et sa sélection est conservée dans chacun des deux emplacements.
La jaquette vient de la
[fiche Nintendo](https://www.nintendo.com/en-gb/Games/Nintendo-Switch-games/Looney-Tunes-Wacky-World-of-Sports-2648344.html),
en 512 × 288 pixels, soit 735 445 octets.

À l'écran titre, appuyer sur **L et R ensemble**. Dans Sports Mode, choisir
**Classic**, puis **4P** pour quatre personnes. Motion demande des mouvements que
la salle ne transmet pas. Chaque personne choisit son équipe et son personnage.
L'essai traverse ce parcours avec quatre navigateurs et déplace les quatre
personnages dans un match de basket. Il ne vérifie pas les quatre sports ni toutes
leurs commandes. Les neuf portraits de base sont proposés dès la partie neuve.

Aucune sauvegarde Switch complète et vérifiable n'a été trouvée dans les sources
consultées. L'index NX_Saves ne contient pas ce titre à la date de la recherche.
Une page annonçant une sauvegarde PC du contenu additionnel ne prouve pas sa
compatibilité avec la Switch. Aucun fichier de cette origine n'est importé.
Les deux emplacements commencent donc sans progression ; le nom générique
« débloquée » du menu ne signifie pas qu'un 100 % a été installé pour ce jeu.

## Contenus additionnels

Ryubing lit, pour chaque jeu, un fichier `data/games/<titre>/dlc.json` dans
l'emplacement. Chaque entrée désigne un NSP et la partie de données (NCA) qu'il
contient, avec son identifiant de titre. Les NSP vont dans un dossier du
dossier privé `updates`, puis :

```sh
python3 docker/switch-dlc.py ~/.config/nel3ab/switch.json TITRE DOSSIER
```

L'outil lit l'en-tête de chaque NCA avec la clé d'en-tête de la console
(`template/system/prod.keys`), au lieu de croire le nom du fichier. Il refuse un
NSP qui n'a pas exactement une partie de données, ou dont le titre n'appartient
pas au jeu : le titre d'un contenu additionnel est celui du jeu plus `0x1000`,
puis son numéro. Il écrit la même liste dans les deux emplacements, qui doivent
être fermés. Au lancement, l'adaptateur refuse de démarrer si un fichier listé
manque : Ryubing se contenterait d'un avertissement, et Smash démarrerait sans
ses combattants. Le journal du moteur annonce chaque contenu chargé
(`AddAocItem: Found AddOnContent`).

## Mario Kart 8 Deluxe

Inscrit sous `0100152000022000`, avec la mise à jour 4.0.0 (`1441792`) et le
Booster Course Pass (`0100152000023001`, dans `updates/mario-kart-8-deluxe-dlc`).
Ce contenu additionnel n'est qu'une licence : les circuits sont dans la mise à
jour. Le 11 septembre 2026, en 1.0.0, l'essai à deux joueurs allait jusqu'au
choix de la cylindrée, sans écran de choix des manettes. Au premier lancement,
le jeu demande un Mii.

L'import ne prend que `userdata.dat`, le fichier de progression. En 1.0.0, les
fantômes et replays d'une version plus récente faisaient planter le jeu 54 s
après le démarrage. Dans `debloquee`, la sauvegarde « Unlocked Perfect + Wave
1,2,3,4,5 + Amiibo » d'octobre 2023, de
[l'index NX_Saves](https://github.com/Viren070/NX_Saves/blob/main/index.md),
se charge en 4.0.0 : Mirror et 200cc ouverts, coupes d'or, personnages du
Booster Course Pass, et la deuxième page de douze coupes, Golden Dash Cup
comprise avec son trophée d'or. Les coupes de la dernière vague n'ont pas été
regardées une par une.

## Mario Party Superstars

Inscrit sous `01006FE013472000`, avec la mise à jour 1.1.1 (`131072`). Le jeu
montre une manette par place occupée. Il associe chaque joueur à un profil de la
console, et Ryubing n'en a qu'un : pour le joueur 2, descendre sur « OK! » et
appuyer sur A. Une place vide plus de 5 s pendant la préparation rouvre l'écran
des manettes, comme une manette débranchée sur console. À l'inverse, choisir
« 1 » joueur avec deux places prises peut bloquer sur « OK! » : le jeu demande
une manette et en reçoit deux.

`debloquee` contient une sauvegarde « LV99 with all pages and stickers »,
exportée avec JKSV et partagée sur MEGA en réponse à
[une question GameBanana](https://gamebanana.com/questions/92518) (janvier 2026).
Le 11 septembre 2026, le panneau du joueur (X sur la place) affiche Mario Party
niveau 99, 3 235 pièces et 86 heures de jeu. L'importateur ne prend que
`hs_save_data`. Pages et autocollants n'ont pas été parcourus un par un. Choisir
le tuyau du mode Mario Party sur la place lance à chaque fois son ouverture :
ce n'est pas un retour au début de partie.

## Super Mario Party Jamboree

Inscrit sous `0100965017338000`, avec la mise à jour 2.3.0 (`458752`). Le
11 septembre 2026, le jeu passe son introduction et son écran titre (L et R
ensemble), puis le choix du personnage mène à la Party Plaza. Aucune partie à
plusieurs n'a été jouée. Aucune sauvegarde complète vérifiable : l'index
NX_Saves ne contient pas ce jeu. Souhib a fourni un export Checkpoint du
23 octobre 2024 (`bqSaveData`, `bqSaveData2`) : avec lui, le choix des
personnages en propose 22, Pauline et Ninji compris, et la place propose la
montgolfière. Il est importé dans `debloquee`. Ce n'est pas un 100 % vérifié.

## Super Smash Bros. Ultimate

Inscrit sous `01006A800016E000`, avec la mise à jour 13.0.5 (`2031616`) et 99
contenus additionnels dans `updates/super-smash-bros-ultimate-dlc`, nommés par
leur titre. Ils comprennent les onze Challenger Packs, Piranha Plant, les
costumes Mii et les packs d'esprits. Ce sont des licences de quelques
kilo-octets : les combattants eux-mêmes sont dans la mise à jour. Sur une partie
neuve, le jeu annonce Piranha Plant, Joker et les autres combattants
additionnels, puis une centaine d'objets à valider. Le raccourci « X Skip »
ne réagissait pas le 11 septembre : c'était l'inversion de X et Y décrite
ci-dessous, pas le jeu.

Le cache de shaders des deux emplacements part d'un cache partagé sur
[Ryujinx-Shader-Cache](https://github.com/Lone-Wolf-Co/Ryujinx-Shader-Cache)
(10 395 shaders, fichiers `guest` et `shared`), recompilé pour cette carte dans
une sonde, puis complété par cinq combats. Ryubing le charge en 13 s. Les caches
précédents sont gardés à côté, dans `cache-shader-avant-2026-09-11`. Le détail
des mesures est dans le carnet (« les petits gels de Smash »).

`debloquee` contient la sauvegarde « All Spirits July 15 2021 » de
[l'index NX_Saves](https://github.com/Viren070/NX_Saves/blob/main/index.md),
dossier `__user__` seulement. Le dossier `__bcat__` voisin contient les
événements en ligne, pas la progression. Avec cette sauvegarde, l'écran des
combattants montre les 89, contenus additionnels compris, et toutes les arènes.
Le joueur 2 rejoint avec A. Aucun combat n'a été lancé.

## D'où viennent les gels

Mesuré le 12 septembre 2026 avec un moteur à marqueurs, sur deux enregistrements
de 200 s : **chacun des 32 trous d'image vient du jeu émulé qui n'a pas produit
l'image**. Au moment du trou, le moteur n'a rien présenté (`NEL3AB_PRESENT`
absent), le compositeur émulé a trouvé sa file vide à chaque tic de 16,67 ms, et
notre chaîne n'a rien perdu : 11 878 images livrées pour 11 877 présentées, avec
0,3 ms entre la présentation et l'horodatage du paquet. Rien n'attend non plus :
au plus 4,6 ms d'attente du répartiteur, aucun fil en attente disque, aucune
lecture, pression du cgroup plate, GPU entre 3 et 9 %.

Deux familles se partagent les trous. Les petits, de 50 à 83 ms : le fil
principal du jeu calcule 76 à 146 ms, et la traduction de code à la demande en
explique plus de la moitié dans trois cas sur huit (29 à 63 ms, contre 0 à 42 ms
dans les fenêtres témoins décalées). Les gros, de 117 à 367 ms : le fil de
décompression de ressources du jeu travaille 185 à 264 ms, avec 5 000 à 7 700
défauts de page mineurs contre 707 dans douze fenêtres calmes, et aucune
traduction. Ce sont donc des chargements du jeu lui-même.

Ce qui n'est pas en cause, vérifié : notre correctif du tampon affiché (un seul
refus d'acquisition en 200 s), la vérification d'intégrité des fichiers, le
partage du GPU avec l'encodeur, et la capture. Le déversement d'un rapport de jeu
dans le journal coïncide avec des trous en fin de match sur trois enregistrements
(122 lignes d'un coup), mais aucun trou de combat mesuré avec marqueurs ne
contient de ligne de journal.

Ce qu'on ne peut pas savoir ici : si une vraie Switch produirait ces images. Il
faudrait une console pour comparer.

## X et Y

Les manettes virtuelles se présentent comme des manettes Xbox 360. SDL lit
alors le code `BTN_X` (0x133, aussi nommé `BTN_NORTH`) comme le bouton X Xbox,
à gauche, et `BTN_Y` (0x134) comme le Y Xbox, en haut. Le profil Ryubing associe
le X Switch au bouton du haut. `pads.py` envoie donc le X de la page sous
`BTN_Y`. Jusqu'au 11 septembre 2026, il l'envoyait sous `BTN_NORTH`, et le X de
la page arrivait au jeu comme Y : Mario Party ouvrait son panneau X sur Y.
`just switch-controls-test` lit les codes du noyau, pas ce que le jeu reçoit :
une modification de ces boutons se vérifie aussi dans un jeu qui affiche X.

## Caches de shaders et de traduction

Un jeu garde deux caches : celui de Ryubing (`data/games/<titre>/cache`, shaders
traduits et fonctions traduites à l'avance) et celui du pilote graphique
(`home/.cache/mesa_shader_cache`). Ils ne contiennent aucune progression : juste
le travail de préparation, identique pour les deux emplacements. Ils sont donc
partagés par jeu, dans `<state>/<titre>/cache` et `<state>/<titre>/mesa`, montés
dans l'emplacement au lancement. Le premier lancement après cette mise en place
recopie le plus rempli des deux emplacements, une seule fois : 442 Mo et 125 Mo
en 2,9 s pour Smash le 11 septembre 2026.

Supprimer ces dossiers ne perd aucune sauvegarde ; le jeu les refabrique en
jouant, au prix de quelques gels le temps de recompiler.

## Vérifier une modification

`just` inclut les tests de sauvegardes et de capture. `just switch-controls-test`
parcourt les seize boutons, les axes, les profils et quatre périphériques Linux
jetables. Il demande aussi une vibration depuis chaque périphérique, vérifie le
navigateur destinataire, puis refuse volontairement la livraison : les boutons
doivent continuer de répondre. Les droits du conteneur et le récepteur du worker
sont ceux de la salle installée. Pour le parcours avec les vrais jeux :

```sh
NEL3AB_TEST_SWITCH_CONFIG=~/.config/nel3ab/switch.json \
  just switch-room-test '/chemin/Mario Tennis Aces.xci'
```

Le pilote copie la configuration dans un dossier temporaire, donne des ports
privés au worker et au salon, et utilise ses propres sauvegardes. Il traverse les
trois consoles avec quatre navigateurs, ajoute un spectateur réduit à 5 Mbit/s,
puis décode le son du clip. Les parties Wii et GameCube de cet essai demandent
Mario Kart Wii et Melee dans les bibliothèques locales. Il vérifie les chemins du
logiciel ; il ne remplace pas une soirée avec quatre personnes sur leurs réseaux.
