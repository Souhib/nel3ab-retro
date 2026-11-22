# La Xbox 360 dans la salle

Jouable depuis le 21 novembre 2026. Depuis le 22 novembre 2026, c'est une
console ordinaire de la salle : son nom n'a plus de mention entre parenthèses,
à la demande du propriétaire, après une partie de Sonic de douze minutes et
demie sans gel sous X11. Seule la Switch 2 garde cette mention. Ce qui n'est
pas encore prouvé est écrit plus bas, et la note de la console le dit au
joueur dans le menu.

Une salle Xbox 360 lance **Xenia Edge** (`01ca7a5`) sous le même Sway que la
salle Switch, avec ses quatre manettes virtuelles, sa capture et son son. Le
récit et les raisons sont dans le carnet (entrée « 21 novembre : la Xbox 360
devient jouable »).

## Comment un jeu entre

1. Déposer l'image du disque (ISO) sur `/importer`.
2. Le salon lit le titre du jeu dans le `default.xex` du disque (8 chiffres
   hexadécimaux, `534507D6` pour Sonic the Hedgehog) et range le fichier dans
   `~/roms/xbox360`, avec sa fiche `<fichier>.nel3ab.json`.
3. La salle l'inscrit par cette fiche. Un `.iso` sans fiche reste sur le chemin
   de Dolphin, qui partage l'extension.

Un `default.xex` seul, un paquet Games on Demand ou un paquet Xbox Live ne sont
pas rangés : il leur manque le reste du disque. Un jeu resté en quarantaine
avant que la console soit jouable se réexamine sans le renvoyer :

```
cd control && NEL3AB_ROM_DIR=<celui de l'unité du salon> \
    uv run python -m nel3ab_control.imports.reexaminer <identifiant de l'envoi>
```

## Ce qui est installé, et où

| Quoi | Où |
|---|---|
| Xenia Edge, dépaqueté sans exécution | `~/.local/share/nel3ab/xenia/edge-01ca7a5/` (provenance à côté) |
| Configuration de la salle | `~/.config/nel3ab/xbox360.json` (`NEL3AB_XBOX360_CONFIG`), Sway à `refresh_hz: 120` comme les salles Switch depuis le 21 novembre 2026 |
| Clé des profils, hors dépôt | `~/.config/nel3ab/xenia-profils.cle` (0600) |
| Image du conteneur | celle de la salle Switch, par son empreinte |
| Parties | `~/.local/state/nel3ab/xbox360/<titre>/<emplacement>/` |
| Ce que le carnet de jeu en montre | la taille et la date de `xenia/content` de l'emplacement personnel, le nom du jeu lu au catalogue (`/profil`, depuis le 22 novembre 2026) |

La clé chiffre les fichiers `Account` des quatre profils (« Joueur 1 » à
« Joueur 4 »), écrits avant le premier lancement pour que Xenia n'ouvre pas sa
fenêtre « No Profiles Found ». C'est une clé de la console, copiée du code de
Xenia : elle reste locale, comme les clés de la Switch.

## Ce qu'une partie laisse dans son emplacement

| Fichier | Ce qu'il dit |
|---|---|
| `xenia-horodate.log` | tout le journal de Xenia, chaque ligne avec l'heure UTC et l'horloge monotone |
| `xenia/xenia.log` | le même journal, sans heure, écrit par Xenia |
| `captures/*.png` | une capture de l'écran toutes les `captures_s` secondes (30 par défaut) |
| `captures/grim.log` | les erreurs de l'outil de capture, s'il y en a |
| `emulator.log`, `sway.log`, `pulse.log` | le conteneur, le compositeur, le son |
| `lifecycle.json`, `exit.json` | comment la partie s'est arrêtée |
| `backups/` | les sauvegardes des quatre profils, avant et après |

Pour relire la cadence du jeu (images présentées par seconde, fenêtres de 5 s,
compilations de shaders, erreurs) :

```
just xbox360-releve ~/.local/state/nel3ab/xbox360/534507d6/<emplacement> [salle]
```

Le compteur du jeu seul ne dit pas ce que les joueurs voient : le
21 novembre 2026, il donnait 59,5 images par seconde pendant que leur image
était figée. Le relevé lit donc aussi, dans le journal du worker de la salle
(la salle 1 par défaut) et entre la première et la dernière ligne de la
partie, ce que la capture a reçu de Sway. Il dit combien d'images la salle a
reçues, combien de silences de la capture il y a eu, si les trous de plus
d'une demi-seconde suivent un ralentissement du jeu lui-même, et, en
majuscules, si l'image s'est arrêtée pendant que le jeu tournait. Une partie
relancée dans le même emplacement range la précédente dans `history/`, à côté
de l'emplacement : le relevé s'y applique de la même façon.

La machine (processeur, carte, mémoire, Xenia par son nom `xenia_edge`, et
depuis le 22 novembre 2026 le serveur `Xwayland` de la salle parmi l'entourage)
est relevée par la boîte noire, comme pour les autres consoles :
`just boite-noire`. Sur une chute, elle prend l'image de l'affichage que la
salle a écrit dans `display.json`, au lieu de supposer `wayland-1`. Ce chemin
n'a pas encore été vu sur une vraie chute d'une salle Xbox 360.
Ses heures sont celles de Paris, une heure de plus que l'UTC des journaux des
salles en hiver.

## Réglages de Xenia que la salle impose

Plein écran sans menus ni barre d'outils, demandé par Xenia lui-même : Sway ne
l'impose pas à cette fenêtre (voir plus bas). Menu du bouton Guide coupé,
notifications de succès à l'écran coupées, son par le PulseAudio de la salle,
manettes par SDL dans l'ordre des places (`SDL_JOYSTICK_DEVICE`) avec la table
`spikes/xbox360/manettes.txt`, une ligne de statistiques par seconde
(`--guest_scheduler_stats`). Les manettes gardent X à gauche et Y en haut : la
salle Switch les échange, pas celle-ci.

Xenia passe par **X11**, à travers le Xwayland que Sway démarre
(`NEL3AB_SWAY_X11=1`, lu par `spikes/switch-room/supervise.py`). Sous Wayland,
Xenia Edge demande chaque image au fil de son interface, et cette demande peut
se perdre pour de bon : l'image s'est figée au bout de 40 secondes le
21 novembre 2026 pendant que le jeu continuait. Sous X11, le fil du jeu
présente lui-même, sauf pendant une fenêtre ou une notification de Xenia à
l'écran ; d'où les notifications coupées. Le récit est dans le carnet,
entrée « 21 novembre au soir : l'image de Sonic se fige, le jeu continue ».

## Ce qui n'est pas prouvé

La console est ordinaire depuis le 22 novembre 2026 sur une seule partie
réussie. Ce que cette partie prouve, et ce qu'elle laisse ouvert, est écrit
ici. La note du manifeste dit au joueur ce qu'il sent : « gâchettes tout ou
rien, à-coups possibles ». Elle tient en 41 caractères : la première version,
de 90 caractères, était coupée par le menu juste avant ce qui n'est pas
prouvé. Les sauvegardes des places 2 à 4, jamais essayées, restent écrites
ici et dans le manifeste, pas dans le menu.

Premier essai, 21 novembre 2026 : profil chargé sans fenêtre d'avertissement,
manette et son entendus par le propriétaire, 59,5 images par seconde côté
jeu ; image figée au bout de 40 secondes et barre de menus visible, sous
Wayland.

Second essai, sous X11, le même soir (12 minutes 30 relues) : aucune ligne
`capture_quiet`, 60 images par seconde reçues en médiane, plein écran sans
menus sur les 26 captures, 59,0 images par seconde côté jeu sans fenêtre sous
45, sauvegarde écrite. Les rares trous d'une seconde suivent des
ralentissements du jeu lui-même, à des transitions ; leur cause n'est pas
établie. Une seule partie, un seul joueur : ce n'est pas encore une soirée.
Reste à relire l'arrêt propre de la salle (`window_closed` dans
`lifecycle.json`).

Les sauvegardes d'un joueur 2 à 4 n'ont jamais été essayées : seule celle du
profil Joueur 1 a été vue écrite. Les gâchettes arrivent tout ou rien, comme
pour la Switch : un jeu de course qui dose l'accélérateur le sentira. Aucun
verrou ne limite encore les salles Xbox 360 (`lock` vaut `null` dans le
manifeste) : le coût de deux salles Xbox 360 ensemble, ou d'une à côté d'une
salle Switch, n'a pas été mesuré. Le passage de la salle à `refresh_hz: 120`
n'a pas encore été relu sur une partie.

## Le canari du socle, pas encore branché

Depuis le 22 novembre 2026, le dépôt porte une seconde façon de lancer la salle
Xbox 360 : `docker/xbox360-room-socle.py`, qui passe par le socle commun des
salles externes et le module de Xenia (`moteurs/README.md`). **Aucune salle ne
l'utilise** : le worker lance toujours `docker/xbox360-room.py`, le chemin
écrit dans `consoles/consoles.json`.

Ce qui est prouvé sans carte ni Docker : pour chacun des dix-huit scénarios
Xbox 360 du banc doré, les deux scripts lancent les mêmes commandes Docker et
laissent le même emplacement, au fichier près (`just salles-dore`), sous le
compte de cette machine comme sous un autre. Les deux s'arrêtent quand le
worker ferme leur entrée standard, et le banc nommerait une salle qui ne
l'écoute plus. Ce qui ne l'est pas : qu'une vraie partie se passe bien par le
canari. C'est l'essai qui suit, à faire par le propriétaire, sur une seule
salle.

### Brancher une salle choisie

Choisir une salle `N` qui ne joue pas : `systemctl is-active nel3ab-worker@N`
répond `inactive`, et `docker ps --filter label=nel3ab.room-root` ne montre
aucun conteneur de cette salle. Puis :

```
sudo mkdir -p /etc/systemd/system/nel3ab-worker@N.service.d
sudo tee /etc/systemd/system/nel3ab-worker@N.service.d/50-canari-xbox360.conf <<'FIN'
[Service]
Environment=NEL3AB_XBOX360_ADAPTER=<dépôt>/docker/xbox360-room-socle.py
FIN
sudo systemctl daemon-reload
```

`<dépôt>` est le dossier que nomme `WorkingDirectory` dans l'unité, sans son
`core` final. Rien ne redémarre : l'ajout prend effet au prochain démarrage de
la salle `N`, quand quelqu'un l'ouvre depuis le salon. Les autres salles
gardent l'ancien script, parce que le worker lit cette variable dans son propre
environnement (`script_env` du manifeste).

Tant que l'ajout existe, `just deploy-check` le nomme
(`nel3ab-worker@N: NEL3AB_XBOX360_ADAPTER remplace l'adaptateur`). Il passe au
rouge si le fichier visé n'existe plus, ou si le canari, le module de Xenia ou
sa fiche ne se chargent pas avec le `python3` de l'unité. Un chemin relatif se
lit depuis le `WorkingDirectory` de l'unité, comme le worker le lit ; un chemin
absolu évite toute ambiguïté.

### L'essai, sur la salle N

Pendant la partie, `pgrep -af xbox360-room-socle.py` montre le processus de
l'adaptateur : c'est la preuve que la salle passe bien par le canari. Puis :

1. le journal de Xenia (`xenia/xenia.log` de l'emplacement) dit
   « Loaded Joueur 1 ... to slot 0 », sans fenêtre « No Profiles Found » ;
2. `lifecycle.json` montre un arrêt propre (`window_closed`) ;
3. un emplacement personnel, joué neuf puis repris, retrouve sa partie ;
4. les quatre manettes répondent, chacune avec un bouton lu dans le jeu ;
5. le son passe ;
6. la cadence, relue par `just xbox360-releve <emplacement> N`, est notée comme
   une tendance : une partie ne fait pas une comparaison.

Si l'adaptateur échoue, sa trace est dans `journalctl -u nel3ab-worker@N`. Une
trace qui passe par `moteurs/socle/salle.py` vient du canari.

### Retirer le canari

```
sudo rm /etc/systemd/system/nel3ab-worker@N.service.d/50-canari-xbox360.conf
sudo systemctl daemon-reload
```

Au prochain démarrage, la salle `N` reprend `docker/xbox360-room.py`. Les deux
scripts rangent les parties aux mêmes chemins (le doré le prouve) : une partie
jouée par le canari se reprend par l'ancien script.

Le fichier `docker/xbox360-room-socle.py` ne quitte le dépôt qu'une fois que
`just deploy-check` ne nomme plus aucune unité qui le vise : une salle dont
l'ajout viserait un fichier absent ne lancerait plus aucun jeu Xbox 360.
