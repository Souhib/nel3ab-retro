# La Xbox 360 dans la salle

Expérimentale depuis le 21 novembre 2026. Une salle Xbox 360 lance **Xenia Edge**
(`01ca7a5`) sous le même Sway que la salle Switch, avec ses quatre manettes
virtuelles, sa capture et son son. Le récit et les raisons sont dans le carnet
(entrée « 21 novembre : la Xbox 360 devient jouable »).

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
| Configuration de la salle | `~/.config/nel3ab/xbox360.json` (`NEL3AB_XBOX360_CONFIG`) |
| Clé des profils, hors dépôt | `~/.config/nel3ab/xenia-profils.cle` (0600) |
| Image du conteneur | celle de la salle Switch, par son empreinte |
| Parties | `~/.local/state/nel3ab/xbox360/<titre>/<emplacement>/` |

La clé chiffre les fichiers `Account` des quatre profils (« Joueur 1 » à
« Joueur 4 »), écrits avant le premier lancement pour que Xenia n'ouvre pas sa
fenêtre « No Profiles Found ». C'est une clé de la console, copiée du code de
Xenia : elle reste locale, comme les clés de la Switch.

## Ce qu'une partie laisse dans son emplacement

| Fichier | Ce qu'il dit |
|---|---|
| `xenia-horodate.log` | tout le journal de Xenia, chaque ligne avec l'heure UTC et l'horloge monotone |
| `xenia/xenia.log` | le même journal, sans heure, écrit par Xenia |
| `captures/*.jpg` | une capture de l'écran toutes les `captures_s` secondes (30 par défaut) |
| `emulator.log`, `sway.log`, `pulse.log` | le conteneur, le compositeur, le son |
| `lifecycle.json`, `exit.json` | comment la partie s'est arrêtée |
| `backups/` | les sauvegardes des quatre profils, avant et après |

Pour relire la cadence du jeu (images présentées par seconde, fenêtres de 5 s,
compilations de shaders, erreurs) :

```
just xbox360-releve ~/.local/state/nel3ab/xbox360/534507d6/<emplacement>
```

La machine (processeur, carte, mémoire, Xenia par son nom `xenia_edge`) est
relevée par la boîte noire, comme pour les autres consoles : `just boite-noire`.

## Réglages de Xenia que la salle impose

Plein écran sans menus ni barre d'outils, menu du bouton Guide coupé, son par
le PulseAudio de la salle, manettes par SDL dans l'ordre des places
(`SDL_JOYSTICK_DEVICE`) avec la table `spikes/xbox360/manettes.txt`, une ligne
de statistiques par seconde (`--guest_scheduler_stats`). Les manettes gardent X
à gauche et Y en haut : la salle Switch les échange, pas celle-ci.

## Ce qui n'est pas prouvé

Au 21 novembre 2026, aucune partie n'a été jouée dans une salle. Le premier
essai doit montrer, dans `xenia-horodate.log` : le profil chargé
(« Loaded Joueur 1 … to slot 0 ») sans fenêtre d'avertissement, l'image en
plein écran sur les captures, la manette lue, le son entendu. La cadence de
Sonic n'a jamais été mesurée ici. Les sauvegardes d'un joueur 2 à 4 non plus.
Les gâchettes arrivent tout ou rien, comme pour la Switch : un jeu de course
qui dose l'accélérateur le sentira.
