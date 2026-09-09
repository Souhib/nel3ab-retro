# Jouer à la Switch dans la salle

État au **9 septembre 2026**. Les choix et leurs expériences restent dans
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
| `updates` | Dossier privé des mises à jour sélectionnées, monté en lecture seule |

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
python3 docker/switch-saves.py ~/.config/nel3ab/switch.json 0100bde00862a000 debloquee import-tennis /chemin/sauvegarde.zip
```

L'importateur n'accepte que ces deux noms, refuse les chemins d'archive et borne
les tailles. Une copie précède l'écriture. L'origine et l'empreinte de l'archive
sont retenues dans `import.json` à côté de cet emplacement.

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
