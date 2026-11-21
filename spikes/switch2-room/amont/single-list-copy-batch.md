# Regrouper les copies de listes en mode 0

Prototype privé du 9 novembre 2026, pour Eglantine
`78743f30c251f66bd77e6eea6c28d8632d642d6f`, version officielle rc3 du 8 novembre.
Il repart de cette révision sans les prototypes précédents. Il n'est pas installé
ni envoyé au projet amont. Le [rapport](../copy-batch-2026-11-09.json) conserve
les quatre passages, les empreintes et les limites.

## Construire et activer

Appliquer [single-list-copy-batch.patch](single-list-copy-batch.patch) dans une
copie privée à la révision exacte, après `git apply --check`. Construire
`eden-cli` et `tests`, avec les mêmes compilateur, options et dépendances que
le témoin local. Le laboratoire utilise GCC 13.3, `-O3 -g1 -DNDEBUG
-fno-omit-frame-pointer`, sans LTO ni PGO. Il conserve SDL 3.4.14 pour les deux
constructions. Les unités Vulkan modifiées doivent être recompilées, avec des
dates de sources récentes. Une empreinte différente du binaire ne suffit pas.

Le correctif reste désactivé par défaut. Il exige `EDEN_NX2_SPLIT=0` et
`EDEN_NX2_SINGLE_LIST_US=8000` pour l'essai réalisé. Une valeur absente, invalide,
nulle ou supérieure à 8 000 désactive l'expérience. La durée est une fenêtre
vérifiée aux demandes suivantes ; aucun minuteur ne garantit une interruption
automatique après huit millisecondes.

Le marqueur `Single GPU list-copy batch active` prouve qu'une copie a réellement
été différée. `pending copies submitted at list return` prouve le chemin de
retour de liste. Ce dernier apparaît à la seconde 94 du premier passage,
après la première image prête ; l'exiger dès cette image avait rejeté à tort
une préparation valide. Les journaux complets conservent les deux événements.

## Contrat et tests

Seul le fil propriétaire peut différer les copies d'un titre natif, dans le
mode non séparé. Les fences gardent leur soumission immédiate du mode 0. Une
lecture CPU soumet ses copies encore en attente avant de patienter. Le retour
d'une liste soumet les copies restantes, même sans dessin, avant de rendre
la commande. Les barrières et les écritures ne sont pas supprimées.

Lancer `bin/tests '[single_list]'`, puis la suite entière avec les fenêtres
0 et 8 000, toutes deux avec `EDEN_NX2_SPLIT=0`. Les 242 tests passent dans les
deux cas ; quatre tests réseau restent ignorés sans réseau. Les cinq
réintroductions testées doivent échouer : autoriser un autre fil, autoriser le
mode séparé, accepter la borne dépassée, lire avant soumission, soumettre au
retour depuis un autre fil. Ces tests compilent le même en-tête que le moteur.

## Résultat et limites

Quatre passages alternés, sur le même checkpoint de Kokiri et la même mise à
jour, donnent 21,14 images/s au témoin local et 22,05 au prototype. L'écart
observé est +4,33 %. Les caches initiaux sont identiques, puis indépendants.
Le premier témoin comporte vingt intervalles de plus de 100 ms ; le gain en
régime chaud reste à confirmer. Les deux marqueurs sont observés dans le vrai
moteur. Le filtre de journal réel reste `*:Info` dans cette série, identique
pour les deux variantes. Le laboratoire écrivait auparavant sa demande de
filtre dans la mauvaise catégorie, corrigée après la série.

Une préparation de caches croise la phase entière du dernier passage mais
précède toutes ses fenêtres complètes retenues, même avec deux secondes de
marge. Le rapport garde ses bornes et n'affirme pas que la copie est neutre.
Aucun compilateur, profileur ni travailleur de CI n'apparaît dans les relevés.

Link descend l'échelle et marche au sol dans deux directions. Les quatre arrêts
sont normaux. Le son, une nouvelle zone et une sauvegarde reprise ne sont pas
validés pour ce prototype. Les omissions visuelles connues de `NO_MESH=1`
restent présentes. Le correctif n'atteint pas 30 images/s et reste au laboratoire.
Un éventuel essai avec le compilateur et le profil PGO officiels doit comparer
ses propres témoins ; opposer ce GCC au paquet officiel n'isolerait pas le
regroupement.
