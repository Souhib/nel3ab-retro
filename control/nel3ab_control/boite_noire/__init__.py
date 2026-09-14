"""La boîte noire des parties: ce que la machine faisait pendant qu'on jouait.

# Pourquoi elle existe

Le 13 septembre 2026, Mario Tennis à quatre est passé de 60 à 40 images par
seconde en trois quarts d'heure. Les pages avaient bien envoyé leur cadence au
salon, mais rien ne disait ce que faisait la machine au même moment: le fil de
rendu de l'émulateur, l'horloge du GPU, l'allocateur de la mémoire vidéo. Il a
fallu une nuit de sondes pour reconstruire ce qu'un relevé aurait montré tout de
suite, et la cause n'est apparue que dans un profil pris PENDANT une chute.

# Ce qu'elle fait

- toutes les cinq secondes pendant qu'un émulateur tourne, un relevé de la
  machine, écrit comme le journal du salon: un fichier JSONL par jour, à l'heure
  des joueurs, pour qu'une ligne se recolle à leurs mesures par l'heure seule;
- quand la cadence des pages reste sous un seuil, un profil `perf` du fil de
  rendu et le journal du worker autour, rangés dans un dossier daté;
- rien de plus vieux qu'une semaine.

# Ce qu'elle ne doit jamais faire

Gêner une partie. Elle tourne à la priorité la plus basse, ne lit que des
fichiers, et compte son propre temps processeur dans chaque relevé: son coût se
lit dans ses propres lignes au lieu de se supposer.
"""
