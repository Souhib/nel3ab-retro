# gcmon : les pauses du ramasse-miettes de Ryubing

Ryubing est écrit en C#. Son ramasse-miettes (.NET) arrête de temps en temps
tous les fils du processus pour nettoyer la mémoire. Pendant ce temps, aucune
image ne sort. Le 28 novembre 2026, un de ces arrêts a figé Smash 837 ms en
plein jeu (ADR D56).

`gcmon` note chaque arrêt du processus et chaque nettoyage, avec sa durée, sa
génération, son type et sa raison. Il peut aussi provoquer un nettoyage complet
à intervalles réguliers, pour comparer deux réglages sur le même travail.

## Comment il voit l'émulateur

Il tourne dans le conteneur du moteur (`docker exec`). Le runtime .NET publie
une prise de diagnostic dans le `/tmp` du conteneur, et l'émulateur est le seul
processus .NET qui y tourne. Aucun réglage n'est ajouté à l'émulateur pour le
suivre. Une session EventPipe, avec le mot-clé GC (0x1) au niveau
Informational, donne les événements. Pour en provoquer un, une seconde session
s'ouvre avec le seul mot-clé ManagedHeapCollect (0x800000) : à son ouverture, le
runtime fait un nettoyage complet et bloquant, sans parcourir le tas
(`eventtrace.cpp`, `ForceGCForDiagnostics`, .NET 10.0.12).

Deux impasses du 28 novembre :

- la prise d'écoute qu'on nomme avec `DOTNET_DiagnosticPorts` est ignorée par
  le runtime (`ds-ipc.c`), et `ReversedDiagnosticsServer` est interne à la
  bibliothèque ;
- une prise Unix a un chemin de 108 octets au plus : avec un `TMPDIR` profond,
  le runtime n'en crée aucune, sans rien dire.

## Construire et lancer

    dotnet publish -c Release -r linux-x64 --self-contained \
        -p:PublishSingleFile=true -p:InvariantGlobalization=true -o bin
    docker cp bin/gcmon MOTEUR:/tmp/gcmon
    docker exec MOTEUR /tmp/gcmon 3600 > gc.jsonl              # tout noter, une heure
    docker exec MOTEUR /tmp/gcmon 380 120 30 > gc.jsonl        # et provoquer toutes les 30 s dès 120 s

Le conteneur disparaît avec sa partie, et la copie dans son `/tmp` avec lui.

## Ce qui l'éprouve

Le 28 novembre 2026, sur un programme témoin qui note lui-même les trous de son
horloge (un fil qui dort 1 ms) :

- les pauses mesurées collent aux trous du témoin à 1 ms près : 1 060,97 ms
  contre 1 061,7 ms, 1 078,14 ms contre 1 078,4 ms, 214,75 ms contre 215,8 ms ;
- quatre demandes ont donné quatre nettoyages « Induced », complets et bloquants ;
  le jumeau sans demande n'en a donné aucun ;
- avec `DOTNET_gcServer=1` et `DOTNET_GCHeapCount=4`, la connexion lit ces
  variables dans le processus suivi, et chaque nettoyage annonce 4 tas.

Sur Ryubing, chaque nettoyage provoqué laisse un trou d'image de la même durée
dans la trace du banc : 628 ms pour une pause de 615 ms, 416 ms pour 401 ms.

## La campagne et sa lecture

- `campagne-gc.sh SORTIE "A B B A" DUREE` (avec `REPO` et `GCMON`) : des phases du
  banc de stabilité sur Smash, cache réel copié, `gcmon` dans chaque conteneur,
  la mémoire du conteneur toutes les 10 s. La boîte noire est arrêtée pendant
  la campagne, seulement si aucune salle de production ne tourne, et relancée à
  toute sortie. Exécuter une copie figée.
- `analyse-gc.py CAMPAGNE` : nettoyages, pauses, tas et mémoire par phase.
- `etapes.py gc.jsonl...` : pour chaque longue pause, l'arrêt des fils, le
  travail et la reprise. L'arrêt des fils prend 0,1 à 0,4 ms : le temps est
  celui du nettoyage.
- `cpu.py PHASE...` : le temps processeur de l'émulateur après la première minute.

Les résultats et leur lecture sont dans le carnet de bord, au 28 novembre.
