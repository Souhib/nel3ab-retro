# Correctif local de l'attente GPU d'Eglantine

Expérience demandée le 8 novembre 2026. Le correctif vise exclusivement
Eglantine `216d3e294367abd4742d7ebd736ef25a8db6f365`, dépôt
<https://github.com/Djihads80/Eglantine>. Il n'est ni installé dans la salle,
ni envoyé au projet amont. La salle garde `SPLIT=0` ; les fonctions visées
ne sont utilisées que lorsque le traitement graphique est réparti sur deux fils.

Le [plan vers 60 FPS](../../../docs/plan-60fps-switch2-2026-11-08.md)
explique le diagnostic, le protocole et les limites. Les résultats de
l'expérience sont conservés dans le [rapport daté](../drain-2026-11-08.json).

## Contrat du changement

`GpuSplitProgress` attend une modification de génération avec les opérations
atomiques C++20 `wait` et `notify_all`. Le fil arrière avance cette génération
après publication des positions consommées, après la fin de sa soumission
différée et à sa sortie. Le fil avant lit la génération avant de vérifier sa
condition. L'ordre inverse peut perdre une notification et bloquer la partie.

Trois conditions restent distinctes :

- `WaitForSpace` : assez de place rendue dans la file ;
- `WaitForWriters` : position de la dernière écriture atteinte ;
- `Drain` : toutes les commandes consommées et soumission différée terminée.

Le changement ne permet pas d'abandonner les commandes lorsqu'un arrêt est
demandé. `ThreadManager::NotifyShutdown` attend d'abord le fil avant, puis
arrête le fil arrière. Ce dernier doit donc continuer à publier ses
progressions pendant cette première attente. Un réveil ne suffit jamais à
faire retourner une fonction : sa condition doit être vérifiée à nouveau.

## Construire et vérifier

Appliquer [eglantine-216d3e-drain-progress.patch](eglantine-216d3e-drain-progress.patch)
dans une copie privée du dépôt à la révision exacte.
`git apply --check` vérifie les chemins avant l'application. Ne jamais
utiliser le répertoire de sauvegardes de la salle pour ces essais.

Le laboratoire utilise Ubuntu 24.04, GCC 13.3, CMake 3.31.10, Ninja,
`RelWithDebInfo`, `-O3 -g1 -DNDEBUG -fno-omit-frame-pointer`, sans LTO ni PGO.
Le formatage de texte `fmt` et SDL3 utilisent leurs versions prévues par
le projet. Qt, les effets ReShade, le service web et la vérification de
mise à jour sont désactivés pour **les deux** binaires. Le fichier
`build.py` privé conserve les arguments exacts. Cette compilation de
laboratoire n'est pas le paquet officiel installé.

Une copie de sources qui conserve des dates anciennes peut empêcher Ninja
de reconstruire un fichier modifié. Le premier binaire étiqueté corrigé a
rencontré ce défaut et son passage est exclu. Vérifier les fichiers réellement
compilés et le message `GPU split front waits: progress notifications` à
l'activation du mode 2. Le binaire de référence doit être dépourvu de ce
message. Le désassemblage de `GpuSplit::Drain` distingue aussi l'ancienne
boucle du nouveau mécanisme. Les tests du seul nouvel en-tête ne prouvent
pas que le programme de jeu contient ce code.

Construire `eden-cli` et `tests` dans les deux états du code. Le test intégré
se lance avec le filtre Catch2 `[gpu_split]`. Son même fichier peut aussi être
compilé seul sous Linux, depuis la racine du dépôt Eglantine corrigé :

```sh
c++ -std=c++20 -O2 -pthread -DNX2_PROGRESS_STANDALONE -Isrc \
  src/tests/video_core/gpu_split_progress.cpp -o /tmp/nx2-progress-test
timeout 15s /tmp/nx2-progress-test
```

Les tests couvrent l'état déjà terminé, la notification avant le sommeil,
les progressions partielles, la fin de la soumission, la visibilité des
données, le dépassement de la position attendue, l'arrêt et cent sessions
successives. Le temps CPU pendant une attente imposée est vérifié sous Linux.
Les autres plateformes gardent les vérifications de synchronisation.

Le test doit échouer si `wait` est remplacé par une boucle `yield`. Il doit
se bloquer, puis être arrêté par son délai externe, si la génération est
lue après la condition. Ces deux réintroductions sont essayées dans des
copies distinctes ; le code corrigé est conservé dans l'arbre de compilation.
Un délai externe qui expire est un échec, jamais un passage silencieux.

## Mesurer en jeu

Alterner original/correctif/original/correctif en mode 2, même copie de
Kokiri, même mise à jour et mêmes options. Les caches sont identiques au
départ, puis indépendants. Vérifier Link et le monde à l'image, puis
mesurer les fenêtres complètes de 600 présentations dans la phase de caméra.
Lire les compteurs CPU du noyau à faible fréquence, de façon identique dans
les deux versions. Aucun compilateur, profileur ou test CI ne doit tourner
pendant cette comparaison.

Vérifier ensuite un déplacement au sol, les chargements, le signal sonore
et une sauvegarde privée reprise après arrêt complet. Garder les défauts
visuels connus dans le rapport. Une baisse du CPU pendant l'attente
ne démontre pas une hausse des FPS, et le contournement `NO_MESH=1`
ne valide pas un monde sans objets manquants.

Le [second prototype de lecture des arguments MME](mme-snapshot.md) repart
du code amont sans ce correctif d'attente. Il suit la piste précisée par
le profil, avec ses propres tests et comparaisons.


Le [troisième prototype de résumé mémoire et d'horodatage GPU](buffer-clean-and-gpu-timing.md)
repart aussi de l'amont intact, sans les deux précédents. Ses quatre phases
en mode 0 donnent 22,37 contre 21,34 images/s, soit −4,61 %. Il reste hors
de l'installation ; ses diagnostics et tests servent à préparer la suite.


La [sonde GPU par soumission](coarse-gpu-timing.md), commencée le 8 et terminée
le 9 novembre, repart de l'amont sans les prototypes précédents. Elle compare
son coût d'activation et vérifie sa couverture par programme. Elle reste un
outil de diagnostic privé, avec un écart observé de −2,74 % sur les FPS et
sans certification de transparence ; les intervalles ne sont pas des durées
matérielles exclusives.


Le [regroupement des copies de listes en mode 0](single-list-copy-batch.md)
repart de rc3 `78743f30c`, publiée le 8 novembre. Ses quatre passages du 9
novembre donnent 22,05 contre 21,14 images/s, avec une limite de cache froid
sur le premier témoin. Il reste expérimental et n'atteint pas 30 images/s.

## Essai du 9 novembre : transferts et réservation de l'anneau

[Le prototype d'anneau](host-buffer-ring.md) conserve les transferts en mémoire
système testés et écartés après quatre passages alternés, ainsi que le défaut
de réservation découvert à cette occasion. Le test reproduit ce dernier avant
correction et par réintroduction. Aucun correctif n'est installé.

Le [prototype de banques et de plages invalidées](native-bank-range-lab.md)
conserve ensuite une amélioration modeste observée sur quatre passages
alternés. Il reste privé, sous 30 images/s et avec des preuves de rendu et
de cohérence encore manquantes.

Le [port sur Lichii `986a2b684`](lichii-986a2b-correctness.md) vérifie ensuite
les changements récents de l'amont et conserve deux corrections de données.
Il passe les tests et les déplacements isolés, mais ses premiers essais de
cadence restent autour de 20 images/s. Aucun remplacement n'est installé.

Le [port de la publication constante #874](lichii-payload-release-874.md)
conserve le changement amont exact et neuf tests réels de requêtes et clôtures.
Ses quatre passages alternés donnent 21,08 contre 20,07 images/s au total,
avec une couverture inégale. Il reste expérimental et sous 30 images/s.

La [composition des lectures anticipées sur `0b83798bf`](lichii-0b83798-readback-composed.md)
ajoute ensuite le nouveau code amont et corrige son interaction avec #874.
La comparaison alternée atteint 24,17 contre 19,69 images/s au total,
avec couverture inégale et anomalie de bonnet à qualifier. Elle reste
isolée, sous 30 images/s et hors de la salle installée.

Le port sélectif #1056, décrit dans cette même note, conserve ensuite `0b83798`
et ses correctifs, sans le cache V2. Ses patches fonctionnel et d'activation
reconstruisent les douze fichiers portés. Les 1 145 tests et le diagnostic
de lectures passent. Les quatre phases alternées donnent 26,96 contre
26,19 images/s au total, +2,93 % observés. Le port reste isolé et sous
30 images/s, avec la même limite de fidélité `NO_MESH=1`.

Le port précis #1059 est conservé dans la même note et dans deux patches
séparés. Ses 1 148 tests et son diagnostic passent, mais ses quatre phases
donnent 26,92 contre 26,80 images/s, avec des couples de signes opposés.
Aucun gain utile répété n'est retenu ; #1056 reste la référence du laboratoire.

La variante privée d'acquisitions `Reference`, décrite dans la même note,
conserve les attentes et la lecture du miroir avant de préparer un essai
du mode 2. Les tests intégrés et leurs quatre mutations passent leurs
contrôles ; le candidat complet passe 1 148 tests et les 86 régressions
ciblées sous cette politique. Le diagnostic réel reste nécessaire ; aucun
gain de cadence n'est encore annoncé.

Ce diagnostic refuse ensuite le mode 2 : lectures et descripteurs passent,
mais des différences de mémoire miroir des registres apparaissent, hors
du compteur ordinaire qui reste à zéro. Leur plafond ne prouve pas leur
disparition en jeu. Le rapport `../reference-acquire-2026-11-09.json`
conserve cet échec ; aucune comparaison de FPS n'est acceptée.

Le patch `lichii-front-shadow-verify-on-reference-0b.patch` reproduit et
corrige ensuite une erreur du vérificateur lui-même avec des écritures
en attente. Il ajoute les totaux séparés non plafonnés. Ses 1 149 tests,
87 régressions et le test séparé du journal passent ; les cinq mutations
sont détectées. Le diagnostic réel passe ensuite, avec les trois totaux
à zéro. Les quatre phases 2/1/2/1 donnent 29,80 contre 26,24 images/s au
total, +13,57 % observés avec couverture inégale. Le candidat devient la
base expérimentale, sans atteindre 30 images/s constantes ni remplacer
le moteur installé : `../front-shadow-verify-2026-11-09.json`.

La reprise exacte de #1059 sur cette base en mode 2 donne ensuite 30,64
contre 30,04 images/s, +1,99 % observés sur quatre passages alternés.
Le port devient la base privée, avec préparations et couvertures inégales,
et un maximum de 55,38 ms qui ne prouve pas 30 FPS constants. Aucun moteur
installé ne change : `../uniform-span-mode2-2026-11-09.json`.
La revue du compteur reproduit ensuite un biais commun d'environ 0,17 %
sur les FPS historiques ; sa correction et la mesure de régularité restent
distinctes d'un gain de calcul.

Le patch [lichii-present-stats-on-shadow-span.patch](lichii-present-stats-on-shadow-span.patch)
s'applique à cette dernière base exacte. Il corrige le diviseur et ajoute
la sonde `EDEN_NX2_PRESENT_STATS=1`, désactivée par défaut. Les 1 157 tests,
les 87 régressions, le test du journal et les cinq nouveaux tests passent.
Le diagnostic réel utilise des bornes d'horloge monotone vérifiées :
728 des 2 400 intervalles de caméra dépassent 33,333333 ms, maximum
58,10 ms. Les percentiles restent séparés par fenêtre. La marche courte
est fonctionnelle, sans qualification d'un long trajet ni d'une zone.
Aucun gain n'est attribué au compteur :
`../present-pacing-2026-11-09.json`.

Le port ciblé #1095 s'applique ensuite à cette base avec compteur corrigé :
[lichii-1095-on-pacing.patch](lichii-1095-on-pacing.patch), puis
[lichii-1095-activation-tests.patch](lichii-1095-activation-tests.patch).
Il conserve le miroir et les dessins différés lors des écritures de
registres. Les 1 159 tests et les régressions passent. Le diagnostic réel
sans profileur active la nouvelle branche, dessine les maillages par calcul
GPU et contrôle les téléchargements, descripteurs et registres sans divergence.
Les quatre passages donnent ensuite 29,806 contre 29,519 images/s,
avec +1,97 % puis -0,06 % par couple. Aucun gain stable n'est retenu.
La base sans #1095 reste la référence privée avec maillages par calcul :
`../state-write-2026-11-09.json`.

Un contrôle de configuration, sans nouveau correctif C++, désactive ensuite
seulement « Max Resolution (built-in) ». Les commandes des mêmes programmes
3D prouvent une baisse de 1440p à 1080p dans les images échantillonnées,
avec FPS Unlock toujours actif. Les traces ne constituent pas une mesure
FPS. Une comparaison alternée des intervalles reste à faire avant de juger
ce compromis visuel : `../max-resolution-2026-11-09.json`.

Les quatre passages de résolution donnent ensuite +1,98 % observé au total,
mais +3,79 % puis -0,33 % par couple. Aucun gain stable n'est retenu ;
32,24 % des intervalles dynamiques dépassent encore le budget de 30 FPS.
Les quatre arrêts sont normaux et la référence privée reste en pleine
résolution. L'option existante « No sharpening » est la piste suivante,
avec copie réussie et qualité à vérifier avant toute comparaison.

Le contrôle NoSharpening prouve ensuite la copie en 1440p, sans valider
30 FPS constants ni une accélération causale. La comparaison alternée reste
à faire : `../no-sharpening-2026-11-09.json`. La revue du fork BC-250
est conservée dans `../bc250-review-2026-11-09.json` ; aucune modification
n'est portée sans preuve des producteurs couverts par la synchronisation.

La comparaison NoSharpening donne ensuite +7,82 % de débit observé,
avec deux couples positifs, mais 23,21 % d'intervalles hors budget et
un gel de plus de 100 ms. L'option reste candidate privée avec compromis
visuel. Aucun nouveau correctif C++ n'est ajouté et aucune version n'est
installée : `../no-sharpening-2026-11-09.json`.

Le plafond de présentation30 est ensuite contrôlé séparément : il fonctionne
avec vblank60 et vitesse100, mais ses p99 restent à44–48ms. Aucun gain
de calcul ni30FPS constants n'est revendiqué. Les sondes natives de réveil
sont la prochaine étape : `../present-30-2026-11-09.json`.

La sonde globale HostTiming n'établit pas la cause des écarts de présentation :
`../host-timing-2026-11-09.json`. La correction amont #1143 fusionnée à22h52
est conservée pour adaptation ciblée des pointeurs après éviction. Son
application directe échoue sur les contextes de notre base sans cachev2 ;
aucun code n'est importé : `../upstream-refresh-2318-2026-11-09.json`.

Une nouvelle copie privée doit ensuite porter des sondes ciblées VI2 et WSI,
sans activer DKB global ni modifier les attentes. Conception et preuves requises :
`../service-wsi-probe-2026-11-09.json`. La construction et la qualification
réelle restent à faire ; le binaire de référence demeure figé.

Le delta diagnostic est maintenant disponible dans
[lichii-service-wsi-on-pacing.patch](lichii-service-wsi-on-pacing.patch).
Il s'applique à la référence avec compteur de présentation corrigé.
Les quatre cas CPU passent et treize versions volontairement cassées sont
détectées.
Une collision de nomX11 trouvée au premier build est corrigée et couverte ;
la construction complète puis l'activation réelle restent requises.

La construction complète passe ensuite avec le CLI `d4480279…854fe4`,
1161tests réussis et4ignorés. Les régressions et la fraîcheur des objets sont
vérifiées. L'activation réelle des deux sondes reste la prochaine porte ;
aucun changement de cadence ni installation n'est revendiqué.

L'activation réelle des deux sondes est ensuite prouvée sur d448 :
`../service-wsi-runtime-2026-11-09.json`. Les moyennes restent à30 mais les
p99 à45–47ms. La reprise du10novembre contrôle le réglage natif de cadence
Vulkan, sans nouveau changementC++ ni installation.

Le premier contrôle du réglage Vulkan30 est prometteur sur les intervalles,
sans nouveau codeC++ : `../host-pacing-2026-11-10.json`. Quatre nouvelles
phases alternées sont préparées avant de retenir un effet ; aucun des deux
diagnostics successifs n'entre dans leurs totaux.

Les quatre nouvelles phases confirment ensuite l'effet sur les retours Vulkan :
les p99 de fenêtre vont de 33,58 à 36,30 ms avec le réglage, contre 46,06 à
48,00 ms en automatique. Le débit moyen reste voisin de 30 et le maximum
activé atteint encore 43,52 ms. Le réglage reste privé pour la prochaine
qualification en déplacement, avec zones, vitesse, son et sauvegarde/reprise.
Les fenêtres ne prouvent ni des contenus distincts ni un affichage physique.
Rapport : `../host-pacing-confirmation-2026-11-10.json`.

Le port ciblé [lichii-1143-on-service-wsi.patch](lichii-1143-on-service-wsi.patch)
s'applique à la référence d448. Il conserve les classifications des pointeurs
à travers l'éviction et la reconstruction des pipelines graphiques, sans
importer le cache V2 ni désactiver l'éviction. Cinq cas CPU passent
85 assertions ; l'ancien producteur et cinq mutations échouent après
compilation. La construction complète puis l'exécution réelle restent
à qualifier. Les limites du correctif et les preuves sont dans
`../eviction-pointer-retention-2026-11-10.json`.

La construction complète du port passe ensuite avec `65defb74…` : 1 164 tests
réussis et quatre ignorés sans réseau. Objets frais et code natif sont vérifiés.
Le parcours réel, les zones et la sauvegarde/reprise restent à qualifier avant
une adoption dans la salle.

La qualification suivante valide ensuite une sauvegarde manuelle et sa reprise
après arrêt, puis un passage local de 90 secondes de marche continue.
Les fenêtres Vulkan donnent 30,00 retours/s, maximum 34,58 ms, sans intervalle
au-delà de 100 ms. L'unique capture intermédiaire reste signalée. Ces preuves
ne qualifient pas le son, les cinématiques, une longue route ni la chaîne
navigateur : `../continuous-walk-2026-11-10.json` et
`../functional-qualification-2026-11-10.json`.
