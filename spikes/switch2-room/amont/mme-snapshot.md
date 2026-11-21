# Prototype de lecture des arguments MME

Expérience locale du 8 novembre 2026, sur Eglantine
`216d3e294367abd4742d7ebd736ef25a8db6f365`. MME désigne le moteur de macros,
qui prépare ici les arguments des dessins. Le [plan vers 60 FPS](../../../docs/plan-60fps-switch2-2026-11-08.md)
conserve le diagnostic et ses limites. Le
[correctif](eglantine-216d3e-mme-snapshot.patch) repart du code amont figé,
sans le précédent prototype d'attente par notification.

## Contrat

`EDEN_NX2_MME_SNAPSHOT=1` active le chemin expérimental. Sa valeur par défaut
le laisse désactivé. `WaitForEntries` attend toutes les commandes déjà
envoyées, y compris les dessins. Il ne permet pas au fil avant d'utiliser
le gestionnaire Vulkan du fil arrière. Le chemin traditionnel de `Drain`
et son attente de fin de soumission restent conservés.

Les pages d'arguments sont déclarées avant l'attente pour prendre en compte
une première écriture GPU encore dans la file. Après cette attente, une
page jamais écrite par le GPU utilise les lectures CPU par mot d'origine.
Ces lectures connaissent les registres virtuels de synchronisation, ce
qu'une copie d'octets ne ferait pas. Une page GPU utilise le mécanisme
existant de copie versionnée ou de mémoire déjà synchronisée. Une version
périmée, une couverture partielle, une page écrite par un dessin ou une
adresse inconnue conserve le chemin prudent de vidage et téléchargement.
Le prototype ne mémorise pas des valeurs d'arguments en les supposant constantes.

Les règles de version et d'invalidation du cache existant sont extraites
dans `Nx2ListSnapshotState`. Les tests appellent cette même structure.
Les copies et leurs clôtures GPU restent possédées par le cache d'origine.
La fin des commandes et l'ordre d'arrêt du moteur restent inchangés.

## Construction et tests

Le laboratoire reprend Ubuntu 24.04, GCC 13.3, CMake 3.31.10, Ninja,
`RelWithDebInfo`, `-O3 -g1 -DNDEBUG -fno-omit-frame-pointer`, sans LTO ni PGO.
Il conserve la même image et les mêmes dépendances pour les deux conditions.
Le journal vérifie la reconstruction de `maxwell_3d.cpp`, `gpu_split.cpp`
et des implémentations du cache. Le même exécutable sert de témoin avec
l'option coupée, puis de variante avec l'option activée. Ce témoin inclut
l'extraction des métadonnées, il n'est pas le paquet amont intact.

Les tests intégrés utilisent le filtre Catch2 `[nx2_mme]`. Le fichier peut
aussi être compilé seul depuis la racine du code Eglantine corrigé :

```sh
c++ -std=c++20 -O2 -DNX2_MME_STANDALONE -Isrc \
  src/tests/video_core/nx2_mme_snapshot.cpp -o /tmp/nx2-mme-test
timeout 15s /tmp/nx2-mme-test
```

Ils vérifient une première écriture GPU encore en attente, cent réécritures
immédiatement relues, les écritures CPU, les dessins, les frontières de page,
les copies incomplètes, les adresses non alignées ou absentes et les
débordements. Quatre variantes volontairement erronées doivent échouer :
barrière supprimée, écriture CPU ignorée, garde des dessins supprimée et
bornes de copie ignorées. Les contrôles mémoire du test isolé passent.
La suite complète du moteur donne 240 réussites et quatre tests réseau
ignorés faute d'interface IPv4 dans le conteneur isolé.

## Mesure

`EDEN_NX2_MME_READ_STATS=1` est réservé au diagnostic, hors comparaison de FPS.
Il compte les lectures et leurs sources, sans journaliser les octets du jeu.
Sa mémoire de valeurs est bornée à 4 096 adresses ; les lectures non suivies
sont comptées. Une égalité de condensat n'est pas une preuve de validité
et ne sert jamais à décider une réutilisation dans le moteur.

La comparaison alterne option coupée/activée/coupée/activée, même Kokiri,
même mise à jour, même caméra et mêmes caches de départ. Les messages
d'activation et de première lecture réussie prouvent le chemin atteint.
Les comparaisons refusent une CI, un compilateur, des tests locaux ou un
profileur actifs. Une CI apparue avant la première phase a retardé les
mesures ; elle n'est pas interrompue.

## Résultat et décision

| Condition | Passages | Fenêtres retenues | Cadence regroupée |
|---|---|---|---|
| Option coupée | 22,19 ; 22,08 images/s | 2 400 présentations, 108,43 s | 22,13 images/s |
| Option activée | 22,25 ; 22,64 images/s | 1 800 présentations, 79,96 s | 22,51 images/s |

L'écart observé est de +1,70 %, avec deux passages par condition et une
couverture inégale du journal tamponné. Le CPU du fil avant reste vers
80 % d'un processeur logique. Le prototype reste isolé, sans installation
dans la salle ni soumission amont. Les quatre phases ferment normalement.
Un premier démarrage option coupée a échoué sur une allocation Vulkan
avant la partie ; cet échec reste exclu des FPS et sa cause inconnue.

Le profil CPU séparé montre encore l'attente de commandes sur le fil avant.
Le plan détaille les mesures suivantes sur les dépendances et les tampons.
La marche au sol, une sauvegarde et sa reprise passent ; le signal stéréo
est présent sans preuve de synchronisation précise. `NO_MESH` continue
d'omettre des objets. Le [rapport numérique](../mme-snapshot-2026-11-08.json)
conserve les fenêtres, les exclusions, le profil et la remise en état.
