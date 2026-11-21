# Lectures anticipées et publications, 9 novembre 2026

## Base isolée

Ce prototype repart de Lichii
`0b83798bf6e7e2440568b7cf69646ae45d681b11`,
[changement amont #1028](https://github.com/zortos293/Lichii/commit/0b83798bf6e7e2440568b7cf69646ae45d681b11).
Il déplace l'attente des copies GPU vers le fil qui lit et prépare certaines
copies avant la lecture. Le changement comprend le suivi des écritures
concurrentes, des copies encore en vol et des rapports différés.

`lichii-0b83798-readback-composed.patch` est le **bundle complet contre cette
base**, avec validation des octets des uniformes, correction du curseur,
port de #874 et tests. Ne pas l'empiler sur les patches pour `986a2b684`.
Le pin privé de téléchargement SDL est exclu du patch public. Les onze
fichiers C++ et de tests sont reconstruits exactement par ce patch puis le
marqueur optionnel séparé. Les sources et exécutables précédents restent figés.

## Défaut trouvé en composant les changements

Le [port #874](https://github.com/zortos293/Lichii/pull/874) distingue les
publications constantes immédiates des compteurs dépendant du GPU. Sur la
nouvelle base, ces publications doivent aussi être exclues de
`NoteReportPending` : `report_noted` exige donc `!immediate && !is_synced`.
Les appels `FinishReads`, `ScopeExit/FinishReport`, les miroirs et horodatages
du nouveau code restent présents.

Le test relie les vrais `QueryCacheBase`, `GuestStreamer`, `FenceManager`
et `BufferCache`, avec mémoire invitée réellement mappée. La page est apprise
pour les copies anticipées. Un rapport compteur R1 est différé, puis une
écriture GPU marque ses données comme réécrites. Une publication immédiate
R2 à la même adresse ne doit pas retirer cette protection. Le port naïf le
fait : après copie anticipée et callback R1, la lecture finale donne 73 au
lieu de 5. L'adaptation redonne 5. Un jumeau place l'écriture avant R1 et
attend 73 ; le simple nombre de rapports ne suffit donc pas à prouver le défaut.
Ces valeurs sont synthétiques et ne proviennent pas d'un jeu.

Le runtime de test représente les buffers par des tableaux CPU et simule
explicitement les ticks d'achèvement. Il n'exécute pas le thread de clôtures
Vulkan, les barrières matérielles ou un vrai compteur GPU. Il prouve cette
composition déterministe, sans attribuer un défaut observé à Zelda.

## Tests et limites

Le contrôle ciblé final passe 68 cas et 1 043 498 assertions. Il comprend
les tests d'uniformes, les neuf cas d'éligibilité et de nettoyage de #874,
les trois cas de curseur et les nouveaux cas de composition. Ces derniers
exercent les vrais appels de fin de lecture, une attente effective, les
variantes miroir/direct avec horodatages et le nettoyage après invalidation
ou valeur non synchronisée. Les neuf anciens cas, dont les nouveaux hooks
restent vides, ne sont pas présentés comme preuve des lectures anticipées.

Quatre mutations compilent et échouent sur les assertions attendues :
garde `!is_synced` retirée de l'inscription différée, validation des octets
retirée, fin de lecture supprimée, fin de rapport supprimée. Le premier
vert intermédiaire avait compilé les tests d'anneau sans les exécuter à
cause d'un filtre mal nommé ; le contrôle final utilise le bon filtre.

La construction complète reprend les mêmes Clang 23, profil PGO officiel,
ThinLTO et réglages Ryzen. Elle passe 1 140 tests et 71 906 299 assertions ;
quatre tests réseau sont ignorés sans réseau. Le CLI identifié est
`5ac642897062c2772d8e9f9fe81ec205ecdd8ddeb2e9100659f152a8e6291429`.
Les unités de compilation instanciant les changements sont reconstruites et
le callback de publication est observé dans l'exécutable réellement lancé.

Le diagnostic prévu utilise `READ_CHECK=1` avec comparaisons positives,
zéro désaccord et zéro octet attendu manquant. Les compteurs sont cumulatifs :
prendre leurs différences sur des intervalles entiers, sans additionner les
totaux successifs. Les octets réécrits exclus du contrôle restent comptés à
part. Les anciens réglages `ASYNC_READBACK` et `EARLY_READ_DOWNLOADS` du
message de commit n'existent plus dans son code final. Les FPS devront
comparer les binaires et se mesurer avec les sondes absentes.

Le premier contrôle est refusé comme qualification complète : le filtre
`Render.Vulkan:Warning` masque les rapports de descripteurs au niveau Info.
Les 93 643 téléchargements comparés sans différence restent une observation
réelle, mais ils ne prouvent pas ce compteur masqué. La reprise avec le bon
filtre vérifie 102 313 téléchargements, environ 364 681 Kio et 204 800
descripteurs dans les intervalles complets de mouvement, sans désaccord ni
octet attendu manquant. Les 22 986 octets réécrits exclus restent à part.
Les 677 517 reprises d'uniformes attestent l'exécution du code corrigé,
sans constituer un deuxième oracle indépendant. Les images avant et après
sont lues et les deux arrêts sont normaux.

Un premier passage sans sondes donne 25,06 images/s. Les quatre phases
appariées suivantes restaurent les mêmes 3 511 fichiers privés, puis le même
point Kokiri : 24,85/19,46/23,22/19,81 images/s, nouvelle base et témoin
alternés. Le total des fenêtres complètes donne 24,17 contre 19,69, soit
+22,74 % observés. La couverture diffère : 124,11 contre 91,3998 secondes.
Les quatre marches et arrêts sont normaux, sans image retenue au-delà de
100 ms. Aucun compilateur, profileur ou travail CI n'est observé dans les
échantillons de ces phases. Ce n'est pas un gain universel ni 30 images/s.

Une capture de marche de la nouvelle base montre un bonnet dressé et étiré.
Une ancienne capture présente déjà un bonnet long vers l'arrière, mais pas
la même pointe verticale parmi les six images comparées. Les poses et
cadrages diffèrent : aucune cause ni régression n'est établie. Le rapport
conserve cette limite de rendu, en plus du contournement `NO_MESH=1`.
Les captures restent privées. Rapport : `../readback-2026-11-09.json`.

Le mode 1 évite le raccourci d'acquire non qualifié du mode 2. Le maintien
de `NO_MESH=1` reste une limite de fidélité. Ce prototype ne remplace pas
le moteur installé et ne prouve ni 30 images/s ni une partie complète.

## Port sélectif suivant : attente des écrivains #1056

Le 9 novembre à 16 h 03, l'amont fusionne
[`1a5e995`](https://github.com/zortos293/Lichii/commit/1a5e995a38679e0f4f7e320f9ec6a5a2f4e4ef1e).
`lichii-1056-on-corrected-0b.patch` s'applique **après le bundle corrigé
ci-dessus**. Il conserve la base `0b83798`, sans le cache V2 de `0ab7736`.
Il remplace l'attente de tous les écrivains par celle des écrivains antérieurs
à la dernière synchronisation hôte, et déplace les macros qui lisent la mémoire
vers le fil arrière. La fusion manuelle conserve les anciens tests et ajoute
`turing_macro_effects.cpp` au même endroit que l'amont.

`lichii-1056-activation.patch` ajoute séparément un marqueur optionnel,
activé seulement par `EDEN_NX2_SYNCED_WRITERS_TRACE=1`. Il apparaît une fois
au premier appel réel de la nouvelle attente. Les deux patches reconstruisent
exactement les douze fichiers portés, sans modifier les sources figées.
Le marqueur #874 reste celui du patch optionnel précédent.

Le candidat identifié `4cc8216a6385e0d2bf9aadcef5126c5e9d338d3951762d3cd5f59aae179af527`
passe 1 145 tests et 71 899 449 assertions, avec quatre tests réseau ignorés.
Un contrôle distinct de sélection de position utilise le vrai header et les
vrais `NoteWriter` et `NoteSync`, mais remplace `WaitFor` par un enregistreur.
L'ancien helper échoue ; le nouveau passe huit cas ; les mutants de cible zéro
et de dernière synchronisation échouent comme attendu. Ce contrôle ne prouve
pas les réveils du vrai fil, couverts séparément par les tests amont.

Dans le diagnostic réel en mode 1, les deux marqueurs apparaissent une fois.
Les 101 614 téléchargements et 208 896 descripteurs vérifiés ne divergent pas ;
aucun octet GPU attendu ne manque. Les 32 259 octets réécrits exclus restent
comptés séparément. Les 680 781 reprises d'uniformes ne sont pas un oracle
indépendant. Les trois images sont lues et l'arrêt est normal.

La comparaison restaure les mêmes 3 511 fichiers avant chaque processus et
garde le mode 1, l'attente inactive à zéro et les sondes absentes. Les quatre
passages alternés donnent 26,94/26,26/26,97/26,12 images/s. Chaque condition
couvre 3 600 présentations : 133,5558 secondes pour le port, 137,4636 pour
le témoin. Le total donne 26,96 contre 26,19 images/s, soit +2,93 % observés.
Les quatre marches et arrêts sont normaux, avec toutes les captures lues.
Aucun intervalle retenu ne dépasse 100 ms et aucune CI, compilation ou sonde
CPU n'est observée dans les relevés de ces phases. Les durées de préparation
diffèrent ; ce petit écart ne constitue pas un gain universel.
Rapport : `../macro-back-2026-11-09.json`. Les 30 images/s constantes restent
non atteintes. Le mode 2 et le contournement `NO_MESH=1` ne sont pas requalifiés
par ce port ; aucun moteur installé n'est remplacé.

## Port précis suivant : petites plages contiguës #1059

`lichii-1059-on-macro-0b.patch` s'applique après le port #1056 ci-dessus.
Il reprend [#1059](https://github.com/zortos293/Lichii/pull/1059), tête
`a32f462aae4e6217cbeb273b322ba8f5ef37e244`, avec ses tests complémentaires.
Il conserve strictement nos `RebindKeptUniform` et `KeptUniformHolds` corrigés.
La comparaison en place concerne `BindSmallUniformReusing` ; notre garde
continue sa copie avant vérification. Le nouvel ordre jeu vers slot puis
slot vers allocation conserve les mêmes octets si l'allocateur provoque
une écriture invitée. Il ne garantit pas un snapshot atomique ou la durée
de vie d'un mapping concurrent.

`lichii-1059-activation.patch` ajoute séparément un marqueur stderr, uniquement
avec `EDEN_NX2_UNIFORM_SPAN_TRACE=1`. Absent, zéro et dix ne produisent aucun
marqueur ; un donne une ligne par chemin et par processus. Les deux patches
reconstruisent exactement les trois fichiers finaux, et leurs empreintes
correspondent aux entrées de la construction complète.

Les 60 tests ciblés passent 85 275 assertions. L'ancien helper échoue sur
les compteurs de chemins, sans défaut d'octets revendiqué. Deux mutants
compilent et échouent sur les bons octets : recopie depuis le jeu après
l'allocation et suppression de la validation réelle du keep. La mémoire
synthétique teste aussi trous, plages non contiguës et type sans `GetSpan`,
sans prétendre couvrir tous les remappings du gestionnaire réel.

Le CLI `8b5d388d01e4b3e7f0086e3ff832d37ca6610540889627b870a61ec551694461`
passe 1 148 tests et 71 885 559 assertions ; quatre tests réseau sont ignorés.
Les deux chemins sont réellement observés en jeu. Le diagnostic vérifie
97 774 téléchargements et 210 944 descripteurs sans divergence ni octet
attendu manquant, avec 22 360 octets réécrits exclus. Les reprises d'uniformes
ne sont pas un oracle indépendant. Les quatre phases alternées contre #1056
donnent 26,60/26,65/27,25/26,94 images/s. Le total des 3 600 présentations
par condition donne 26,92 contre 26,80 images/s, en 133,7208 contre 134,3508
secondes, soit +0,47 % observés. Les couples évoluent en sens opposés et
aucun gain utile répété n'est retenu. Les quatre marches et arrêts sont
normaux, sans intervalle retenu au-delà de 100 ms. Le marqueur compilé mais
désactivé peut avoir un coût non mesuré ; ce résultat ne condamne pas
l'algorithme sur toute machine. #1056 reste le candidat de référence.
Rapport : `../uniform-span-2026-11-09.json`. Aucun moteur installé n'est remplacé.

## Politique privée de référence pour les acquisitions

La variante suivante revient au candidat #1056, sans #1059 ni cache V2.
`lichii-reference-acquire-on-macro-0b.patch` ajoute une politique immuable,
choisie au démarrage par `EDEN_NX2_REFERENCE_ACQUIRE=1`. Elle force le
chemin existant qui attend le fil arrière puis lit le miroir, pour une
acquisition initiale et pour sa reprise. Absence, `0` et `10` conservent
le chemin rapide historique. Ce dernier reste connu incorrect en mode 2.
Le changement ne retire donc pas le coût des drainages.

`lichii-reference-acquire-activation.patch` ajoute seulement un marqueur
optionnel, activé par `EDEN_NX2_REFERENCE_ACQUIRE_TRACE=1`. Les deux patches
reconstruisent exactement les trois fichiers compilés. Le CLI obtenu est
`43fea79a7a986446d208e1e8dc5081874203bbaa4404f176a9ebf7f276bb560a`.
La construction complète passe 1 148 tests et 71 871 478 assertions,
avec quatre exclusions réseau. Les 86 cas ciblés sous `Reference` passent
31 854 assertions, dont les contrôles de propriété des macros de #1056.

Les nouveaux scénarios relient les vrais Puller, DmaPusher, fil arrière,
QueryCache, GuestStreamer, FenceManager et BufferCache sur les mêmes mots.
Ils vérifient le miroir et son alias, la reprise, puis un résultat de compteur
encore différé après consommation de la commande. L'ancien lecteur et
quatre défauts réintroduits compilent et se lient avant d'échouer sur les
assertions attendues. Les instants d'achèvement hôte restent simulés ;
le fil de clôtures Vulkan réel et toute la concurrence du mode 2 ne sont
pas prouvés par ces tests.

Le diagnostic réel doit encore montrer des contrôles positifs des lectures,
des descripteurs et des registres, ainsi que des acquisitions drainées et
aucune décision rapide. `EDEN_NX2_SPLIT_VERIFY` est le vrai nom du contrôle
de registres ; sa seule présence l'active, même avec `0`. Le pilote privé
ne le transmet donc que pour `1`, et doit l'omettre pendant les mesures.
Ce contrôle draine puis resynchronise les registres : zéro différence ne
remplace pas les tests de propriété. Aucun FPS n'est encore attribué à
cette variante. Rapport : `../reference-acquire-2026-11-09.json`.

Le diagnostic réel atteint ensuite Kokiri et s'arrête normalement après
91,59 secondes observées. Il vérifie 111 405 téléchargements et 230 400
descripteurs sans divergence, avec 32 337 octets réécrits exclus. Les
5 995 791 acquisitions drainées et l'absence d'acceptation rapide confirment
la politique choisie. Les 16 832 contrôles de registres dans la phase
ne qualifient pourtant pas le mode 2 : seize avertissements signalent des
différences de mémoire miroir pendant le chargement. Le résumé ordinaire
à zéro ne les compte pas, et leur plafond de seize cache les suivantes
si elles existent. Aucune comparaison de FPS n'est donc acceptée. La suite
reproduit ce défaut ou cette erreur du contrôle dans une autre copie isolée.
Les sources de ce premier diagnostic restent figées.

## Correction du vérificateur de mémoire miroir

`lichii-front-shadow-verify-on-reference-0b.patch` s'applique ensuite sur
ce candidat. Il corrige uniquement le calcul d'état attendu de `FrontVerify`
et ses tests. Les écritures encore dans `method_sink` sont projetées dans
le miroir attendu sous Track et TrackWithFilter. Replay et Passthrough
gardent leur règle ; aucune consommation forcée n'est ajoutée. L'ancien
vérificateur pouvait remplacer le bon miroir du premier fil par l'ancien :
le test avec la vraie file arrière et 4 096 appels de macro reproduit
une sortie zéro au lieu de `0x1234` après Replay.

Le nouveau résumé conserve son préfixe puis donne des totaux non plafonnés
pour les registres ordinaires, le miroir et son contrôle. Le test séparé
du vrai journal exige un nombre positif de contrôles et injecte des erreurs
sur le fil arrière : R+1, S+21 et C+1 restent comptés malgré seize warnings.
La suppression complète du vérificateur fait échouer ce test. Les quatre
autres mutations de projection et de comptage échouent aussi après compilation
et lien réussis. La suite normale passe 1 149 tests ; les 87 régressions
Reference avec vérification et les 17 assertions du test caché passent.

Le même vérificateur sert au secours d'une macro écrivant hors de son ensemble
prévu ; le changement n'est pas déclaré inerte dans tout fonctionnement sans
sonde. Aucun nouveau test complet de cette fuite n'est revendiqué. Les
avertissements du premier jeu ne sont pas tous attribués à cette seule
cause. Le prochain diagnostic doit encore montrer des contrôles positifs
et les trois totaux à zéro avant d'accepter des FPS.
Rapport : `../front-shadow-verify-2026-11-09.json`.

Le CLI reconstruit `64c061065565ab515f03b9793f737c04bf92db3a1d83b6a76f0365219cc27150`
passe ensuite la suite normale, les 87 régressions avec les deux options
et le test caché explicite. Le diagnostic réel de 91,61 secondes vérifie
117 940 téléchargements, 239 616 descripteurs et 17 472 contrôles de
registres pendant les mouvements, sans divergence. Les 346 résumés depuis
le chargement gardent les trois totaux à zéro. Les images sont lues et
l'arrêt est normal. Une comparaison alternée sans sondes est maintenant
autorisée ; aucune hausse de FPS n'est encore établie.

Les quatre phases sans sondes donnent ensuite 29,84/26,18/29,76/26,32
images/s, dans l'ordre 2/1/2/1, avec `Reference` et l'attente inactive à
zéro dans les deux conditions. Le même état de 3 511 fichiers est restauré
à chaque lancement. Le total donne 29,80 contre 26,24 images/s, +13,57 %
observés. Les couples vont dans le même sens ; la couverture diffère,
4 800 présentations en 161,088 secondes contre 3 000 en 114,3456 secondes,
et les durées de préparation varient. Le pourcentage ne s'étend pas à toute
une partie. Les quatre marches et arrêts sont normaux, les vingt-quatre
images sont lues et aucun intervalle retenu ne dépasse 100 ms. Les quinze
relevés de chaque phase ne montrent aucune charge CI, compilation ou profilage.
Les 66,34 ms du pire intervalle en mode 2 empêchent de conclure à 30 FPS
constants. La limite `NO_MESH=1` et le bonnet vertical vu dans les deux
conditions restent documentés. Configuration, huit progressions et politique
GPU sont vérifiées après retrait des manettes privées et reprise de la boîte
noire. Le candidat reste isolé, sans remplacement du moteur installé.

Le port #1059 est ensuite réévalué sur cette base corrigée en mode 2.
Les trois fichiers sont identiques au port précédent et ses tests restent
applicables ; le candidat combiné passe 1 152 tests et le diagnostic réel.
Les quatre passages donnent 30,63/29,71/30,65/30,38 images/s, soit 30,64
contre 30,04 au total, +1,99 % observés. Les deux couples vont dans le
même sens, à +3,11 % puis +0,88 %, avec couverture inégale de 3 600
contre 4 800 présentations et préparations différentes. Trois lancements
sont exclus avant mesure ; aucun FPS de ces préparations n'est retenu.
Les vingt-quatre images, marches et arrêts sont vérifiés. Le maximum du
port reste 55,38 ms et ne prouve pas 30 FPS constants. Ce candidat devient
la base privée, sans installation. Rapport :
`../uniform-span-mode2-2026-11-09.json`.

La convention du compteur de présentation a ensuite un défaut reproduit :
le diviseur reste 599 quand les fenêtres suivantes contiennent 600 intervalles.
Les valeurs historiques restent conservées, avec ce biais commun d'environ
0,17 % documenté. Sa correction ne sera pas comptée comme une optimisation.
FPS Unlock et Max Resolution sont appliqués ; la génération d'images est
désactivée. Les mesures comptent les demandes de présentation invitées,
pas la preuve de contenus tous distincts ou de la vitesse de toute la logique.

Le correctif du compteur et la sonde de distribution sont ensuite
qualifiés : 1 157 tests passent et le diagnostic réel compte 728 intervalles
au-delà de 33,333333 ms sur 2 400, maximum 58,10 ms. Les percentiles restent
propres à chaque fenêtre ; la marche courte est hors de ces fenêtres de
caméra. Le patch séparé `lichii-present-stats-on-shadow-span.patch`
s'applique à la base exacte avec #1059 et ne change pas le rythme du jeu.
Ce diagnostic n'est pas une optimisation :
`../present-pacing-2026-11-09.json`.

Le candidat suivant porte #1095 avec les patches séparés
`lichii-1095-on-pacing.patch` et `lichii-1095-activation-tests.patch`.
La construction complète et le diagnostic mémoire réel passent avec
le chemin de maillage par calcul GPU. Les quatre phases sans sondes donnent
29,806 contre 29,519 images/s, avec des couples qui ne se répètent pas.
Aucun gain stable n'est retenu ; les 208 ms/s de l'ancien profil ne chiffrent pas
l'économie possible ici, car ce profil utilisait le chemin lent.
Rapport : `../state-write-2026-11-09.json`.
