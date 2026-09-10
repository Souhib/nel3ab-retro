# Mesurer la chaîne Switch étape par étape

Ce dossier découpe, pour un joueur Switch, le délai entre un appui et la
première image changée. Toutes les heures viennent de l'horloge monotone de la
machine, celle qui compte depuis le démarrage et ne recule jamais. Elles se
comparent donc sans recalage.

| Étape | De | À | Qui date |
|---|---|---|---|
| entrée | envoi de la trame | événement de la manette virtuelle | `process.hrtime` du pilote, puis le noyau (`horloge-manette.py`) |
| lecture | événement du noyau | état du joueur 1 changé dans la mémoire que le jeu lit | le noyau, puis `NEL3AB_HID` |
| jeu | mémoire HID | dernière image remise au compositeur avant l'image changée | `NEL3AB_HID`, puis `NEL3AB_PRESENT` |
| · programme | mémoire HID | le jeu remet l'image N qui montre l'appui | `NEL3AB_HID`, puis `NEL3AB_QUEUE` |
| · vsync | image N remise | prise par le compositeur Switch émulé | `NEL3AB_QUEUE`, puis `NEL3AB_ACQUIRE` |
| · passage | prise | le fil GPU commence à présenter l'image N | `NEL3AB_ACQUIRE`, puis `NEL3AB_RENDER` |
| · barrière | début de présentation | le jeu a fini de dessiner l'image N | `NEL3AB_RENDER`, puis `NEL3AB_READY` |
| · rendu | barrière levée | image remise au compositeur de la machine | `NEL3AB_READY`, puis `NEL3AB_PRESENT` |
| compositeur | image remise | composition par Sway | `NEL3AB_PRESENT`, puis l'horodatage que chaque paquet porte |
| transit | composition | arrivée de l'image au pilote | l'horodatage du paquet, puis `process.hrtime` |

Les marqueurs `NEL3AB_*` sont posés dans Ryubing par
`../amont/ryubing-latency-probe.patch`. Les images Switch portent leur numéro
de la remise à la présentation, ce qui les suit d'une étape à l'autre. Ils n'écrivent rien tant que
`NEL3AB_LATENCY_PROBE` ne vaut pas 1, et ce correctif n'a pas sa place dans le
moteur de la salle.

## Ce qu'il faut

1. Un moteur construit avec les trois correctifs de `../amont/` :
   `NEL3AB_LATENCY_PROBE_BUILD=1 ../amont/build.sh <dossier>`.
2. Le programme de test `../guest/nel3ab-probe.nro`, qui dessine l'état de
   chaque bouton à chaque image : le plus petit délai qu'un jeu puisse ajouter.
3. ffmpeg, Node, et root pour lire la manette virtuelle. La lecture est seule :
   le lecteur ne l'attrape pas, Ryujinx lit les mêmes événements.

## Déroulé

    NEL3AB_SWITCH_CONFIG_BASE=~/.config/nel3ab/switch.json python3 sonde.py essai <dossier du moteur>
    # attendre capture_age_ms dans adapter-guest-essai.log (dossier NEL3AB_SONDE)
    sudo python3 horloge-manette.py /dev/input/eventN > boutons.jsonl &
    REACTION_DUMP=vidage.json node ../../m3-browser-drive/switch-reaction.mjs <url> 10 1 guest
    docker logs nel3ab-switch-room-guest-essai > moteur.log 2>&1
    python3 recoller.py vidage.json boutons.jsonl moteur.log

Avec `NEL3AB_HOLD_FRONT_BUFFER=1` dans l'environnement de `sonde.py`, le moteur
garde l'image affichée jusqu'à la suivante : l'expérience du 10 septembre. Le
correctif est toujours construit par `../amont/build.sh` ; dans la salle, c'est
`hold_front_buffer` de `switch.json` qui l'allume.

`/dev/input/eventN` est la première entrée de `devices.json` dans le dossier de
manettes de la sonde. `sonde.py` reprend l'image Docker et les dossiers de la
configuration de la salle, mais la sonde a ses propres conteneurs, manettes et
sauvegarde. Le son se vérifie sur la même sonde avec
`node ../../m3-browser-drive/switch-son.mjs <url> 20 440 880`.

## Mesure du 10 septembre 2026

Amont `475615f` avec les trois correctifs, dix appuis, dix recollés :

| Étape | Médiane | Écart |
|---|---|---|
| entrée | 0,4 ms | 0,4 à 0,6 |
| lecture | 1,6 ms | 1,1 à 1,9 |
| jeu | 54,5 ms | 46,0 à 60,7 |
| compositeur | 8,5 ms | 2,9 à 14,2 |
| transit | 4,2 ms | 2,4 à 7,2 |
| total | 69,6 ms | 53,4 à 83,5 |

Même mesure, Sway à 120 Hz (`refresh_hz: 120`, 10 appuis) : compositeur
0,3 ms, total 57,2 ms, contre 10,8 et 65,7 ms dans le passage à 60 Hz fait
juste avant.

L'étape « jeu », découpée à 120 Hz (10 appuis, total 60,4 ms) : programme
27,2 ms, vsync 23,8 ms, passage 0,0, barrière 0,0, rendu 2,7. Sur toutes les
images de la série, une image remise attend 24,1 ms médians sa prise, et il y en
a presque toujours déjà une autre en file (4013 remises sur 4017). Ni le réseau du joueur ni son navigateur ne sont dans ces
chiffres. Le carnet de
bord, entrée du 10 septembre, donne les limites et les pièges de la mesure.
