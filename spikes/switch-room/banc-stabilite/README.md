# Banc de stabilité de la Switch 1

Une salle Switch privée, sur des ports libres, avec un état, une session et des
sauvegardes jetables, lancée par le vrai worker et le vrai adaptateur. Le banc
date chaque image et ce que faisait l'émulateur à ce moment-là, pour attribuer
chaque accroc à sa cause. Rien n'est écrit sous `~/.local/state`, et les
caches de production ne sont que lus (copiés dans la racine de la phase).

Construit le 27 novembre 2026 pour la question du propriétaire : avec ou sans
chargement de shaders, la partie doit rester stable, au rythme d'une console.

## Ce qu'il relève

| Fichier d'une phase | Contenu |
|---|---|
| `full-trace.txt` | l'heure du compositeur de chaque image capturée (µs, `CLOCK_MONOTONIC`), une par ligne |
| `echantillons.jsonl` | toutes les 50 ms : temps sur processeur et en file d'attente de chaque fil de Ryujinx (`schedstat`, ns), taille de `shared.toc` (8 octets par programme), occupation du GPU |
| `mesa-mtimes.txt` | l'heure de chaque entrée du cache Mesa de la phase : une compilation du pilote |
| `emulator.log` | le journal du conteneur, avec les lignes des sondes du moteur quand elles sont allumées |
| `garde.txt` | début et fin, avec Jellyfin (ffmpeg), ollama (kfd), la CI, les salles de production et la pression processeur |

## Les crochets

Deux crochets que la salle n'a pas, dans `crochets.patch` : `banc_env` (des
variables d'environnement pour le conteneur du moteur, lues dans la copie de
`switch.json`) et `NEL3AB_CAPTURE_TRACE=1` (la capture écrit l'heure de chaque
image). Ils se posent dans une copie de travail, jamais dans l'arbre
principal : le worker relit les scripts de salle depuis l'arbre où il a été
construit, à chaque partie. `phase.sh` refuse l'arbre principal et tout arbre
sans les crochets.

    git worktree add ~/nel3ab-chantiers/banc main
    cd ~/nel3ab-chantiers/banc && git apply spikes/switch-room/banc-stabilite/crochets.patch
    (cd core && cargo build -p nel3ab-worker)

## Lancer

    # une phase : ÉTIQUETTE ARBRE ROM TITRE DURÉE SORTIE GRAINE [CONFIG_JSON]
    MAJ=1 phase.sh a1 ~/nel3ab-chantiers/banc "$HOME/roms/switch/Mario Kart 8 Deluxe.nsp" \
        0100152000022000 300 /tmp/sortie froid '{"banc_env": {"NEL3AB_SHADER_PROBE": "1"}}'
    # une campagne alternée : chaque bras a sa graine et sa configuration
    MAJ=1 campagne.sh SORTIE ARBRE "A B B A" 300 ROM TITRE GRAINE_A JSON_A GRAINE_B JSON_B

- `GRAINE` : `froid`, ou un dossier qui contient `cache/` et `mesa/`, copiés
  dans la phase. Le dossier d'une phase finie (`racine.txt`) en fournit une.
- `MAJ=1` : l'emplacement neuf reçoit le gabarit de la salle et le choix de mise
  à jour et de contenus additionnels de l'emplacement neuf réel. Sans lui, le
  jeu tourne sans sa mise à jour : un emplacement neuf de banc n'a pas
  `updates.json`.
- `photos.sh SORTIE_PHASE PÉRIODE NOMBRE` prend une photo de l'écran (`grim`)
  toutes les PÉRIODE secondes, pour voir la scène.
- La démo de l'écran titre de Mario Kart 8 Deluxe joue des courses seule, sans
  manette, vers 60 à 130 s après le lancement, sur un circuit tiré au hasard.

## Lire

- `analyse.py PHASE [--detail N] [--json]` : images perdues, accrocs par seuil,
  et pour chaque accroc sa cause : `programme` (un programme neuf dans
  `shared.toc`), `pipeline` (une compilation Mesa sans programme neuf), `autre`.
  Un accroc est un écart de plus de 1,5 période ; la période est la cadence de
  console (60, 30 ou 20 images par seconde) la plus proche de la médiane des
  10 s autour. Éprouvé par `test_analyse.py` (`python3 -B -m unittest test_analyse`).
- `compare.py DOSSIER` : le tableau des phases d'une campagne.
- `regime.py PHASE...` : les tranches de 10 s sans aucun shader neuf.
- `sonde.py PHASE...` : les totaux de la sonde des shaders (`NEL3AB_SHADER_PROBE`).

## Ce qui a coûté du temps le 27 novembre

- La première image d'un enregistreur est la copie de la sortie vide de Sway :
  l'analyse l'écarte.
- Retoucher `phase.sh` pendant que bash l'exécute : bash relit un script par
  position d'octet. `campagne.sh` exécute une copie figée.
- Une campagne avec une seule graine pour deux bras : chaque bras a maintenant
  la sienne, en argument.
- Un mutant d'`analyse.py` restauré dans la même seconde, à la même taille :
  Python a gardé son bytecode. Les mutants se rejouent avec `python3 -B`.
- Le jeu sans sa mise à jour, sans le savoir : `MAJ=1`.

Les résultats et leur lecture sont dans le carnet de bord, au 27 novembre au
soir. Les données brutes de ces phases (traces, échantillons, journaux, photos,
graines de cache) sont archivées dans
`~/.local/share/nel3ab/archives/switch1-banc-2026-11-27/`, avec leur inventaire.
