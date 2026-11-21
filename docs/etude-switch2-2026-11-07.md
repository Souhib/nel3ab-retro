# Essais Switch 2 du 7 novembre 2026

Cette étude accompagne l'ajout demandé de la Switch 2. Eglantine du 7 novembre
est retenu pour Zelda, avec un joueur et des spectateurs. Les résultats portent
sur les passages décrits ici, pas sur une partie complète.

## Reprise du 8 novembre : paquets PGO

PGO signifie *Profile-Guided Optimization*. Le compilateur utilise des profils
d'exécution pour optimiser les opérations fréquentes. Les auteurs publient
ces paquets ; aucun changement du code de l'émulateur n'est nécessaire ici.

Le paquet PGO officiel d'Eglantine reprend le même commit `216d3e2943` que le
paquet standard installé. Son empreinte SHA-256 est
`8618540a929a8cad211e89ff024b0e2323bde3c769e250f4fa26ad275f2386c7`.
Lichii 117 PGO, publié le 7 novembre à 22:39 UTC, reprend `89440b29a9` ; son
empreinte est `a2eda749105395ac6910c905f0f3c564528b7bfd132ebaf7616963fe28c6dd98`.
Les tailles et empreintes des deux téléchargements correspondent aux
métadonnées de leurs publications. Les essais restent dans un laboratoire
privé daté du 8 novembre.

### Eglantine standard contre PGO

Quatre phases mesurées alternent standard, PGO, standard, PGO. Deux démarrages
Lichii bloqués, non mesurés, séparent les deux tours. Chaque phase reprend la
même sauvegarde sur le balcon de Kokiri et les mêmes mouvements de caméra
pendant 90 secondes, après deux allers-retours de préparation. Les deux caches
Eglantine reçoivent initialement la même copie, puis restent séparés. Le mode
TV, le rendu 1×, la précision basse, la synchronisation réactive et les
contournements installés restent identiques. La génération d'images reste
désactivée. La boîte noire est suspendue pour éviter un profil automatique ;
aucun autre essai ni compilation n'accompagne les mesures.

| Paquet | Tour 1, images/s | Tour 2, images/s | Plus grand intervalle retenu | Images au-delà de 100 ms |
|---|---:|---:|---:|---:|
| Standard | 22,84 | 22,51 | 186 ms | 2 |
| PGO | 23,94 | 23,97 | 153 ms | 1 |

Les fenêtres complètes couvrent 2 400 présentations par paquet : 105,84
secondes pour le standard et 100,18 secondes pour PGO. La cadence regroupée
passe de 22,68 à 23,96 images/s, soit **5,7 % de plus sur ce passage**.
Les quatre arrêts sont normaux, avec le code zéro. Le processeur se réchauffe
au fil des essais, de 65 à 87 °C ; le gain PGO apparaît dans les deux tours.
Ces observations ne démontrent ni 30 images/s, ni une disparition des gels
dans de nouvelles zones. Les trois intervalles de plus de 100 ms ne suffisent
pas à comparer la fréquence des gels. Les résultats et publications épinglées
sont conservés dans `spikes/switch2-room/pgo-2026-11-08.json`.

La validation fonctionnelle suit cette comparaison avant toute sélection du
paquet pour la salle habituelle. Un enregistrement de 100 secondes de
cinématique donne neuf correspondances exploitables, avec une avance sonore
comprise entre −0,13 et +0,20 seconde. Les dix autres points calculés sont
refusés. L'incertitude reste de 0,5 seconde ; ce résultat ne couvre pas la fin
du film et ne prouve pas une synchronisation à quelques millisecondes.

Zelda confirme une sauvegarde manuelle et retrouve sa position après un arrêt
complet. Cependant, l'arrêt de cette reprise quitte avec le code 139, après
la fermeture de sa fenêtre. Ce résultat empêche de déclarer le parcours
entier réussi et déclenche une comparaison d'arrêt avec le paquet standard.
Ces deux contrôles reprennent chacun une copie identique de la sauvegarde et
du cache, puis ferment la fenêtre dès la position retrouvée. Le standard et
PGO quittent tous deux avec le code zéro. Le plantage n'est donc pas reproduit
et ne peut pas être attribué à PGO avec ces seuls essais. Pour un gain de
1,28 image/s sur le passage mesuré, cette incertitude ne justifie pas le
remplacement du paquet installé. **Eglantine standard reste en service.**
La configuration et les fichiers de progression de la salle habituelle ne
changent pas. Les rapports d'arrêt et les contrôles de sauvegarde sont dans
`spikes/switch2-room/followup-2026-11-08.json` ; l'analyse sonore complète est
dans `spikes/switch2-room/audio-2026-11-08.json`.

Correction de lecture des captures, le 8 novembre : les noms `house` et
`resumed-house` du pilote privé ne prouvent pas une entrée dans la maison.
La capture de reprise affiche explicitement « Kokiri Forest ». Elle démontre
la reprise à la position sauvegardée dans ce passage, pas un changement de
zone. Les anciens résultats de ce pilote ne doivent pas être repris comme
preuve d'une transition maison/forêt sans une observation distincte.

### Lichii 117 reste non validé sur cette configuration

Le paquet standard de la même version est également téléchargé et vérifié :
son empreinte est `f0441333e371efae484c97b317e75eda40cc212e4a208da6bb9df25e16daa1a1`.
Cinq lancements valides couvrent le paquet PGO avec les réglages installés,
un cache vierge, les réglages de lancement par défaut, ces derniers sans les
deux correctifs Zelda intégrés, puis le paquet standard avec les réglages
par défaut. Le contournement `NO_MESH=1` reste présent dans tous ces essais.
Ils ne disent donc rien d'un lancement sans ce contournement, avec un autre
pilote ou sur une autre carte graphique.

Les cinq lancements restent sur une image uniforme avant le menu ; aucune
cadence de jeu n'est retenue. Les essais bornés attendent 150 secondes avant
de refuser la mesure. Tous les arrêts nécessitent ensuite un arrêt forcé,
environ 30 secondes après la demande de fermeture. Les rapports Docker ne
signalent pas de destruction par manque de mémoire. La cause du blocage
reste inconnue.

Un sixième lancement ne compte pas comme essai sans correctifs : le journal
montrait qu'ils étaient encore appliqués. Le lecteur de configuration exige
`default=false` sur l'identifiant du titre et sur chaque nom désactivé.
Après correction de cette configuration privée, le journal confirme que
« Max Resolution » et « Dynamic FPS by Dark » sont ignorés. Le blocage reste
présent. Ce contrôle évite d'attribuer un résultat à un réglage jamais appliqué.

Lichii 117 n'est pas retenu pour la salle. La vitesse réelle avec son correctif
Dynamic FPS et Mario Tennis Fever sur cette version restent non validés.
Les six rapports, dont celui invalidé, sont dans
`spikes/switch2-room/lichii-117-2026-11-08.json`.

La porte locale complète `just` et l'audit des dépendances passent après les
essais. Les conteneurs de jeu et de manettes sont supprimés. La boîte noire,
suspendue pendant les mesures, est relancée. Les empreintes des fichiers de
progression habituels restent identiques. Aucun paquet n'est installé à la
place du standard et aucun commit ni envoi n'est créé. Ces résultats locaux
ne constituent pas une nouvelle exécution de CI distante.

La suite demandée le 8 novembre après 02:00 UTC teste aussi la branche
expérimentale d'Eglantine et Orchid. Ces essais ne remplacent pas le moteur de
la salle habituelle et n'ajoutent pas Tennis à son catalogue.

## Suite du 8 novembre : Eglantine expérimental et Orchid

La branche Eglantine `nx2-experimental`, publiée le 7 novembre à 23:34 UTC,
correspond au commit `eab2c2246d`. Ses paquets standard et PGO sont vérifiés
contre les tailles et empreintes publiées. Elle contient notamment deux
corrections de fermeture des tâches de compilation graphique. Le paquet
Orchid 0.9.0 standard correspond à `e420cf2bea` et est vérifié de la même façon.
Les données restent privées et séparées des sauvegardes habituelles.

Quatre phases alternent Eglantine installé et Eglantine expérimental PGO, avec
la même sauvegarde de Kokiri et les mêmes réglages. Le standard donne 23,22
puis 22,72 images/s ; l'expérimental donne 23,91 puis 23,89. Les cadences
regroupées sont 22,97 et 23,90 images/s, soit **4,1 % de plus sur ce passage**.
Chaque paquet fournit 2 400 présentations retenues. Les quatre arrêts rendent
le code zéro. Ce résultat ne classe pas les gels de nouvelles zones.
Les versions, empreintes et fenêtres sont conservées dans
`spikes/switch2-room/experimental-2026-11-08.json`.

La sauvegarde manuelle est confirmée à l'écran. Son empreinte change après
l'écriture et reste identique après reprise de la position dans Kokiri.
Les deux arrêts de ce parcours sont normaux. L'enregistrement de 100 secondes
de cinématique donne dix points exploitables, entre −0,03 et +0,28 seconde
d'avance sonore, avec une incertitude de 0,5 seconde. Les neuf autres points
sont refusés. Le cinquième arrêt observé du paquet expérimental est normal
lui aussi. Ces cinq arrêts ne prouvent pas la disparition du plantage rare
du premier PGO. Les détails sont dans
`spikes/switch2-room/experimental-validation-2026-11-08.json`.

Un piège de chronométrage est corrigé avant cette comparaison. Le dernier
message du journal avait environ sept secondes de retard au début d'une
phase standard. L'utiliser comme une horloge incluait une fenêtre de
préparation contenant 48 intervalles de plus de 100 ms. La borne de début
est recalculée avec l'heure du conteneur et celle de la phase observée ;
cette fenêtre est exclue. Les fenêtres retenues commencent plus de 25 secondes
après cette borne. Le contrôle rejoue l'ancien calcul, qui accepte bien la
préparation, puis le nouveau, qui la refuse. Les quatre phases de la première
comparaison PGO du 8 novembre sont également relues : leurs fenêtres restent
valides et le résultat publié de 5,7 % ne change pas.

### Orchid 0.9.0 sur Mario Tennis Fever

Le jeu est le même NUP que le 7 novembre, avec la même mise à jour numérique
`327680`. Le nom fourni annonce 1.1.1 ; le « 5.0.0 » à l'écran reste le repli
synthétique du lecteur NUP, pas une preuve de version commerciale.

Le profil recommandé par Orchid est repris dans une configuration privée :
précision graphique basse, synchronisation graphique « Balanced », vidage
réactif désactivé et présentation asynchrone. Cette synchronisation règle
quand les commandes graphiques attendent leur achèvement. Les autres réglages
reprennent aussi le profil publié. La génération d'images est désactivée et
la variable qui supprime les dessins de maillage est entièrement absente.
Ce profil diffère donc du profil Eglantine installé.

Deux matchs simples en sept points se terminent sur le court en gazon : Mario
contre Harmonie, puis Mario contre Kamek, tous deux contrôlés par l'ordinateur
en difficulté intermédiaire. Les deux écrans de résultat montrent 0–7. Les
déplacements, les services et les coups sont commandés par la manette privée.
La fin du premier match, le lancement du suivant et sa fin ne plantent pas.
Les captures récentes et les deux scènes de victoire montrent les personnages.
Une pose précoce de Mario présente un rendu partiel et certains glyphes de
commande ou certaines lettres sont incomplets. La cause de cette pose
inhabituelle n'est pas établie. Tous les mouvements et effets ne sont pas
validés.

La portion du premier match observée jusqu'au score 0–5 contient des attentes
entre les points. Ses fenêtres complètes couvrent 6 000 présentations sur
131,97 secondes, soit **45,5 images/s**, avec un intervalle maximal de 110 ms
et un seul intervalle au-delà de 100 ms. Ce ne sont pas des échanges continus
et ce chiffre ne classe pas les moteurs : l'adversaire et les réglages
diffèrent des essais précédents. La préparation initiale, exclue de cette
mesure, comporte notamment un intervalle de 795 ms.

Un enregistrement du serveur sonore privé contient vingt secondes de signal
stéréo non silencieux. Il prouve l'émission sonore, pas sa synchronisation
exacte avec les coups. Orchid se ferme avec le code zéro en 1,5 seconde,
redémarre et rejoint à nouveau son menu avec les commandes du laboratoire.
La deuxième fermeture est normale aussi. Aucun match à plusieurs joueurs,
autre court ou soirée entière n'est validé. Le raccordement d'Orchid à une
salle du navigateur n'est pas testé par ce parcours natif.

Orchid devient un candidat pour Tennis. L'adaptateur installé impose encore
les réglages Eglantine aux jeux Switch 2 ; le remplacer globalement par Orchid
ne constituerait pas une intégration vérifiée. La salle conserve donc son
moteur et son catalogue pendant ces essais. Les rapports sont dans
`spikes/switch2-room/orchid-2026-11-08.json`.

La porte locale complète `just` et l'audit passent après cette suite. Les
producteurs de jeu, de son et de manettes du laboratoire sont arrêtés et ses
conteneurs sont supprimés. La boîte noire est relancée. La configuration du
moteur installé et les empreintes de progression habituelles sont identiques
à celles relevées avant ces essais. Aucun commit ni envoi n'est créé.

## Contrôle d'Orchid sur Zelda, le 8 novembre après 11:20 UTC

Les deux matchs précédents ne validaient pas Ocarina of Time sur Orchid.
La demande de vérifier les déplacements déclenche donc un essai distinct,
avec le même NUP Zelda et une copie de la sauvegarde sur le balcon de Kokiri.
Le chargement de cette sauvegarde évite la cinématique d'introduction.
Le paquet standard Orchid 0.9.0, commit `e420cf2bea`, reste la dernière
publication affichée par son dépôt lors du contrôle à 11:32 UTC.

Trois lancements utilisent Vulkan, une précision basse, le rendu 1× et aucune
génération d'images. Le premier conserve seulement `EDEN_NX2_NO_MESH=1` parmi
les variables de contournement. Le deuxième reprend aussi les variables
Eglantine installées, dont `SPLIT=0`. Le troisième retire toutes les variables
`EDEN_NX2_*`, y compris `NO_MESH`. Le cache du pilote est déplacé avant les
deux relancements. La synchronisation réactive reste désactivée dans les
trois configurations privées ; aucun profil Zelda officiel n'est supposé.

Les trois essais atteignent les cœurs et la carte de Kokiri, mais le décor
reste noir ou flou et Link n'est pas correctement dessiné. Des commandes de
déplacement sont envoyées dans chaque essai ; le troisième exerce aussi
le stick droit. Voir l'interface ne prouve donc pas que le monde est rendu.
**Aucune cadence jouable n'est retenue pour Orchid sur Zelda.**

Les journaux rejettent des programmes graphiques, notamment pour
`native stage buffer read outside geometry stage` et
`native extended integer comparison`, puis indiquent des dessins ignorés
faute de programme utilisable. Ces refus existent aussi sans `NO_MESH`.
Ils orientent le diagnostic vers une incompatibilité de traduction graphique
sur cette configuration. Ils ne permettent pas de classer le matériel à partir
d'un nombre d'images d'un monde manquant.

Le troisième essai reste sans monde correctement rendu 120 secondes après
l'apparition des cœurs et de la carte, malgré les commandes envoyées.
Le premier arrêt est forcé, avec le code 137 ; les deux autres rendent zéro.
Aucun des trois rapports Docker ne relève une destruction par manque de
mémoire. Le journal du noyau ne contient pas de réinitialisation du GPU ni
de délai dépassé signalé pendant ce parcours.

Un contrôle reprend le même fichier et la même sauvegarde avec Eglantine
standard et ses réglages installés. Link et le décor sont visibles, le
personnage passe du balcon à l'échelle et la caméra change d'orientation.
L'arrêt rend zéro. Cette vérification fonctionnelle confirme que le fichier,
la sauvegarde et le chemin des commandes permettent ce passage avec le moteur
installé. Elle ne mesure pas une nouvelle comparaison de vitesse ni un
changement de zone. La capture privée nommée `ground-walk` montre encore
Link sur l'échelle ; son nom n'est pas une preuve de marche au sol.

La salle habituelle conserve Eglantine. Les configurations, refus graphiques
et arrêts sont conservés dans
`spikes/switch2-room/orchid-zelda-2026-11-08.json`. Les quatre empreintes de
progression habituelles et la configuration installée sont identiques à
celles du début. Les conteneurs et manettes du laboratoire sont supprimés
et la boîte noire est relancée.

La porte locale complète `just` et l'audit passent après ce contrôle aussi.
Aucun code d'émulateur n'est modifié, aucun moteur installé n'est remplacé,
et aucun commit ni envoi n'est créé. Ces vérifications locales ne constituent
pas une nouvelle exécution de CI distante.

## Profilage de Zelda et parallélisme, le 8 novembre après 12:25 UTC

La demande suivante autorise une recherche dans l'émulateur lui-même.
Le premier relevé utilise le paquet standard Eglantine installé, sans changer
son code. L'instrumentation native `EDEN_NX2_GPU_PROFILE` chronomètre les
étapes du fil qui prépare les commandes graphiques sur le processeur.
Ce fil n'est pas la carte graphique. Les chronomètres comprennent les attentes
qui surviennent dans leur étape ; ils ne mesurent pas uniquement du calcul.

Sept fenêtres complètes couvrent 70,21 secondes de mouvements de caméra sur
le balcon de Kokiri, après préparation. Par seconde écoulée, le traitement des
méthodes graphiques prend 232 ms, les macros 126 ms, la liaison des tampons
126 ms et le traitement des commandes en amont 103 ms. Les macros sont de
petits programmes qui produisent des commandes de dessin. Les tampons sont
des zones de mémoire dont ces dessins ont besoin. Le relevé du système donne
au fil nommé `GPU` une consommation moyenne de 79,4 % d'un processeur logique
sur les secondes complètes de la phase. Ces mesures ne désignent pas encore
une fonction unique dont la correction suffirait à atteindre 60 images/s.

Ce premier profil reste préliminaire : ses relevés machine montrent une charge
de 12 à 18 et une température CPU proche de 96 °C. La comparaison suivante
retrouve une CI externe qui lance de nombreux navigateurs. Les parts de temps
de ce relevé chargé ne sont pas assimilées à un profil sur machine calme.
Elles devront être contrôlées de nouveau avant de choisir une correction.

Les déplacements sont ensuite exercés séparément : Link rejoint l'échelle,
la lâche, s'en éloigne et marche sur le sol de la forêt. Une capture relue
montre bien ses pieds au sol à côté de l'échelle. Le moteur ferme normalement.
Les valeurs de ce parcours instrumenté ne servent pas à classer les FPS.
Le rapport `spikes/switch2-room/split-2026-11-08.json` conserve les fenêtres
et leurs limites.

Les modes `SPLIT=1` et `SPLIT=2` atteignent ensuite Kokiri avec Link et le
décor visibles. Le journal confirme le second fil dans les deux cas, et les
macros sur le premier fil dans le mode 2. Les commandes tournent la caméra
et déplacent Link sur l'échelle. Les deux fermetures sont normales. Ces
contrôles fonctionnels restent sous la charge de la CI externe ; ils ne
classent pas la vitesse des modes. Aucun résultat à 60 images/s n'est établi.

Le premier passage non instrumenté est refusé : ses bornes strictes ne
contiennent aucune fenêtre complète de 600 présentations. Ses relevés donnent
une charge de 18 à 24 et une température CPU proche de 96 °C. De nombreux
navigateurs appartiennent au runner de tests Secret Hitler, extérieur à
Nel3ab. Le jeu de laboratoire est arrêté pendant cette charge ; la boîte
noire est relancée. La comparaison alternée et le profil sur machine calme
restent alors à effectuer, sans modifier le moteur installé ni les sauvegardes
habituelles.

Après la fin de cette CI, le profil est repris sans autre travail de test.
Huit fenêtres couvrent 80,13 secondes. Par seconde écoulée, les méthodes
graphiques prennent 270 ms, les macros 151 ms, la liaison des tampons 150 ms
et le traitement des commandes en amont 133 ms. Le fil nommé `GPU` consomme
94,1 % d'un processeur logique sur les 90 secondes complètes du relevé système.
Aucun processus de CI n'apparaît dans les échantillons. La charge machine
va de 2,91 à 3,86 pendant le jeu. La température CPU reste entre 92,6 et
95,3 °C ; cette mesure sur le serveur inclut donc son fonctionnement à chaud.
Elle désigne le traitement graphique exécuté sur le processeur comme une
priorité à examiner. Elle ne prouve pas que la carte graphique ne limite
jamais une autre scène, ni qu'un changement de processeur donnerait 60 images/s.

### Sept passages sans instrumentation

Les phases de 90 secondes alternent dans l'ordre `0, 1, 2, 0, 2, 1, 0`.
Chaque lancement restaure la même sauvegarde du balcon, prépare deux
allers-retours de caméra, puis rejoue les mêmes commandes. Les trois caches
partent de 1 860 fichiers identiques, vérifiés par leurs empreintes, et
évoluent ensuite séparément. Vulkan, la précision basse, le rendu 1×, le mode
TV, la synchronisation réactive et `NO_MESH=1` restent identiques. La génération
d'images est désactivée. Aucun profilage ni compilation n'accompagne les
mesures ; aucun processus de CI n'apparaît dans leurs échantillons.

| Mode | Images/s par passage | Cadence regroupée | Présentations retenues |
|---|---|---:|---:|
| `SPLIT=0`, installé | 21,31 ; 20,13 ; 20,53 | 20,64 | 3 600 |
| `SPLIT=1`, méthodes sur un second fil | 20,45 ; 20,78 | 20,61 | 2 400 |
| `SPLIT=2`, macros sur le premier fil | 20,63 ; 20,86 | 20,72 | 3 000 |

Les fenêtres complètes couvrent 435,63 secondes et 9 000 présentations du jeu.
Le mode 1 diffère de −0,16 % de la référence regroupée ; le mode 2 de +0,35 %.
Ces écarts sont petits devant la variation de la référence entre ses trois
passages. **Aucun gain net du parallélisme n'est observé sur cette scène.**
Les journaux confirment son activation réelle dans les modes 1 et 2, sans
arrêt du second fil pendant la partie. Les sept fermetures sont normales.
Les captures relues retrouvent Link, le décor et le même point de vue final.

Les plus grands intervalles retenus sont 187 ms, 118 ms et 226 ms pour les
modes 0, 1 et 2. Les comptages au-delà de 100 ms valent 34, 11 et 36, avec des
durées et des nombres de fenêtres différents. Les premières fenêtres de
plusieurs phases sont plus lentes, sans cause isolée. Ces observations ne
classent donc pas la fréquence des gels de zones nouvelles et ne remplacent
pas un parcours de découverte de la carte.

Le capteur CPU principal reste entre 95,75 et 96,38 °C pendant ces passages.
La [fiche AMD du Ryzen 5 3600](https://www.amd.com/en/support/downloads/drivers.html/processors/ryzen/ryzen-3000-series/amd-ryzen-5-3600.html)
annonce une température maximale de 95 °C. Le refroidissement est donc un
point à contrôler avant d'attribuer tout l'écart au code. Les fréquences
instantanées relevées ne prouvent pas à elles seules un bridage thermique
et ne quantifient pas les images/s récupérables. Aucun réglage de fréquence,
de ventilation ou de puissance n'est modifié pendant ces essais.

Le mode installé reste `SPLIT=0`. L'expérience complète des sept passages
prend environ 26 minutes avec les démarrages et les vérifications visuelles.
Elle ne valide ni 60 images/s, ni un rendu sans les omissions de `NO_MESH`,
ni toutes les zones du jeu. Les fenêtres et les conditions machine sont dans
`spikes/switch2-room/split-2026-11-08.json`.

### Ce que montre le profil du mode 2

Un dernier parcours instrumenté reprend la même caméra après les mesures.
Huit fenêtres couvrent environ 80 secondes pour chacun des deux fils. Le fil
avant consomme 92,9 % d'un processeur logique et passe 562 ms par seconde
dans l'attente `split drain`. Le fil arrière consomme 91,0 % d'un processeur
logique. Ses principaux temps sont les méthodes à 209 ms par seconde, la
liaison des tampons à 172 ms, le temps hors zones à 161 ms et l'attente de
travail à 147 ms. Ces parts appartiennent à des fils simultanés et ne
s'additionnent pas comme la durée d'une image.

Le chemin [`GpuSplit::Drain`](https://github.com/Djihads80/Eglantine/blob/216d3e294367abd4742d7ebd736ef25a8db6f365/src/video_core/gpu_split.cpp)
relit les indicateurs en boucle, avec une pause processeur puis un abandon
volontaire du tour d'exécution. Il n'attend pas ici une notification bloquante.
Le profil donne donc une cible précise : réduire cette attente active et
les dépendances qui imposent de vider la file. Une attente active continue
d'occuper le processeur en vérifiant si le travail demandé est terminé.
Une correction devra préserver l'ordre des écritures, la fin des soumissions
différées et le réveil lors de l'arrêt. Aucun remplacement de cette attente
n'est encore compilé ni validé dans le jeu ; aucun gain de FPS ne lui est
attribué. La liaison des tampons reste une autre étape à décomposer avant
de choisir une optimisation de copie ou de réutilisation.

L'expérience de code décrite dans la section suivante remplace cette piste
par un résultat mesuré, sans gain de FPS.

Le dernier arrêt est normal. Les conteneurs et manettes du laboratoire sont
supprimés, la boîte noire est relancée et les quatre empreintes de progression
habituelles restent identiques à celles du début. La configuration installée
reste strictement identique. La porte locale complète `just` et l'audit
passent pendant cette tâche ; le code de l'application et celui des émulateurs
ne changent pas. Aucun commit ni envoi n'est créé.

## Correctif d'attente et objectif 60 FPS, le 8 novembre après 14:00 UTC

Le [plan vers 60 images/s](plan-60fps-switch2-2026-11-08.md) reprend la piste
identifiée par le profil précédent. Deux compilations locales de la même
révision, avec les mêmes options et la même image de laboratoire, comparent
une attente par notification à la boucle existante. Le prototype préserve
les commandes consommées, la fin de la soumission différée et l'ordre d'arrêt.
Les tests reproduisent la boucle active et une notification perdue avant
de valider le mécanisme corrigé.

| Expérience alternée | Référence | Variante | Conclusion bornée |
|---|---|---|---|
| Résolution, mode 0 | 21,68 images/s à 1× | 21,63 à 0,5× | Aucun gain observé dans cette scène |
| Code d'attente, mode 2 | 21,28 images/s | 20,71 avec notification | Économie de CPU, baisse de cadence observée de 2,65 % |

Chaque condition retient 2 400 présentations. Les huit phases durent chacune
90 secondes après la même préparation de caméra. Les caches sont identiques
au départ de chaque comparaison, puis évoluent indépendamment. Les captures
montrent le même monde et Link. Les huit fermetures sont normales ; la dernière
vient de la limite de durée du laboratoire, après sa phase mesurée. Aucun
compilateur ou profileur ne tourne pendant les phases de FPS. Un relevé de
15 secondes par piles d'appels vient ensuite, dans des bornes séparées.

Le fil avant passe de 80,46 à 36,86 % d'un processeur logique. Le fil arrière
reste chargé. Cette économie ne représente pas une division par deux de
la consommation de toute l'application. Le code reste expérimental ; le
moteur installé et son mode 0 sont conservés.

Le profil des piles d'appels place 49,5 % des cycles utilisateur échantillonnés
du fil avant dans `Drain`. Parmi ces cycles dans l'attente, 78,6 % viennent
de `Maxwell3D::FrontDmaRead` et 19,0 % des sémaphores. La prochaine étude vise
les lectures d'arguments et leur copie valide, avec les mécanismes de pages
écrites par le GPU qui existent déjà. Le plan détaille les invalidations à
conserver et les tests qui doivent détecter une valeur périmée. La liaison
des tampons reste une autre cible du fil arrière. Ces parts de cycles ne
s'additionnent pas comme des gains de FPS disponibles.

Un premier binaire étiqueté corrigé avait conservé un ancien fichier objet,
car la copie de sources gardait une date antérieure à la compilation. Son
passage est exclu. La reconstruction réelle est vérifiée dans la liste des
fichiers compilés, le code machine et un message d'activation contrôlé par
le pilote. Un premier contrôle non modifié quitte aussi sur
`VK_ERROR_OUT_OF_DEVICE_MEMORY` avant la mesure 3D. Il charge normalement
au contrôle suivant ; sa cause reste indéterminée. Le rapport conserve ces
échecs séparément des phases retenues.

La marche au sol et une nouvelle sauvegarde reprise après arrêt complet
sont vérifiées visuellement. Les empreintes du fichier manuel changent à
l'écriture puis restent identiques à la reprise. Les deux arrêts sont normaux.
Un extrait stéréo de huit secondes contient un signal. Ces contrôles ne
valident pas une nouvelle zone ni une partie complète. Le contournement
`NO_MESH=1` et ses objets manquants restent dans toutes ces expériences.

Le CPU reste entre environ 92 et 97 °C selon les phases et leurs départs.
Le mode de performance et le boost sont déjà activés. Une lecture temporaire
par le pilote `nct6775` de la puce NCT6798 expose deux ventilateurs proches de 1 100 à 1 250 tours/min,
sans désigner physiquement le connecteur CPU. Le modèle du refroidisseur
reste inconnu. Une mesure fonctionnelle séparée donne environ 3,48 GHz sur
le fil avant et 3,74 sur le fil arrière quand ils sont exécutés. Aucune
comparaison à refroidissement constant ne permet d'attribuer un gain de FPS
à la seule température.

Le rapport `spikes/switch2-room/drain-2026-11-08.json` conserve les fenêtres,
les compteurs CPU, les empreintes des exécutables, les exclusions et les
limites. Le correctif est conservé dans `spikes/switch2-room/amont/`.
Les 239 tests de la version corrigée passent, avec quatre tests réseau ignorés
faute d'interface IPv4 dans le conteneur isolé. Les contrôles mémoire du test
isolé passent ; ThreadSanitizer refuse de démarrer sur cette machine et ne
valide donc aucun accès concurrent. La porte locale de l'application et
l'audit passent pendant ce travail. Aucune nouvelle CI distante n'est
revendiquée sans commit ni envoi.

Le contrôle sonore final reconnaît douze correspondances son/image sur environ
85 secondes de la cinématique. Les écarts observés vont de −0,10 à +0,01
seconde, avec une incertitude de 0,5 seconde. Aucun décalage important ni
dérive progressive n'est observé dans cette portion ; ce contrôle ne prouve
pas une synchronisation à 40 ms. Un premier extrait tardif ne couvrait que
dix secondes et une tentative fondée sur un démarrage fixe avait capturé
le menu. Ces limites et rejets restent dans le rapport. La détection du
titre est ensuite vérifiée contre un écran noir et une image de partie.
Les arrêts sont normaux. Les conteneurs et périphériques privés sont
supprimés, la boîte noire reprend son service et les quatre empreintes de
progression habituelles ainsi que la configuration installée restent identiques.

## Second prototype MME, le 8 novembre

La suite du [plan vers 60 images/s](plan-60fps-switch2-2026-11-08.md)
compte 845 091 lectures d'arguments sur 50,02 secondes de caméra. Aucune
ne demande un téléchargement GPU dans ce passage. Le prototype attend
les commandes précédentes sans demander aussi le repos du gestionnaire
graphique pour les arguments CPU. Il conserve des copies GPU versionnées
et le chemin de vidage prudent lorsque leur validité est inconnue.

Quatre phases alternent la même compilation avec l'option coupée puis
activée. Les résultats regroupés sont **22,13 et 22,51 images/s**, soit
**+1,70 % observé**. Les fenêtres complètes couvrent respectivement 2 400
présentations en 108,43 secondes et 1 800 en 79,96 secondes. Le journal
tamponné réduit les données retenues du premier passage activé ; les
bornes prudentes restent inchangées. Deux passages par condition ne
démontrent pas un gain important sur le jeu. Le CPU du fil avant reste
vers 80 % d'un processeur logique. Les quatre fermetures sont normales.

Un profil de 15 secondes vient ensuite, hors phases de FPS. Il place
51,5 % des cycles utilisateur échantillonnés du fil avant dans l'attente
des commandes. Sur le fil arrière, la liaison des tampons figure dans
21,2 % des cycles et leur synchronisation dans 16,1 %, avec recouvrement.
Le plan vise maintenant leurs dépendances et volumes de transfert, puis
des durées GPU par catégorie. Ces parts CPU ne donnent pas des gains
de FPS disponibles.

La sauvegarde au sol et sa reprise au même endroit passent. Le signal
stéréo est présent, sans mesure précise du décalage son/image. Un premier
témoin option coupée a quitté sur une allocation Vulkan impossible avant
la mesure ; sa cause reste inconnue. Les 240 tests du moteur passent,
quatre tests réseau sont ignorés dans le conteneur isolé, et quatre
réintroductions de défauts font échouer les tests du prototype.

Le code et les résultats restent dans `spikes/switch2-room/amont/` et
`spikes/switch2-room/mme-snapshot-2026-11-08.json`. Le moteur standard en
mode 0 est conservé dans la salle. Les conteneurs et manettes privés sont
supprimés, la boîte noire est relancée et la configuration ainsi que les
quatre fichiers de progression habituels restent identiques.

## Machine et copies utilisées

Le serveur possède un Ryzen 5 3600, six cœurs et douze fils d'exécution,
64 Gio de mémoire et une Radeon RX 6650 XT de 8 Gio. L'image de laboratoire
réutilise Mesa RADV 25.2.8 et Ubuntu 24.04 de l'intégration Switch existante.
RADV est le pilote Vulkan libre des cartes AMD sous Linux.

Les deux archives fournies contiennent Ocarina of Time et Mario Tennis Fever.
Seuls leurs jeux et mises à jour sont extraits. Les émulateurs joints à
l'archive Zelda ne sont pas utilisés.

Le NUP Zelda contient une base `0400486024DEC000`, version numérique `65536`,
et une mise à jour `0400486024DEC800`, version `131072`. Le contrôle de l'archive
et l'empreinte SHA-256 de l'index du NUP passent. Le module principal chargé
porte l'identifiant `E0F3CCFAF50065AE4EA01EB5AEB13B1A45DA3348`.
Ces identifiants permettent de comparer la même copie sans publier le jeu.

## Versions épinglées

Les quatre AppImage Linux x86-64 sont téléchargées depuis les dépôts des projets.
Leur taille et leur empreinte sont comparées aux métadonnées de publication.
Les copies privées conservent ces métadonnées et les empreintes vérifiées.

| Version | Publication | Empreinte SHA-256 du paquet |
|---|---|---|
| [Lichii 95](https://github.com/zortos293/Lichii/releases/tag/build-94) | 7 novembre, étiquette 94 erronée | `90be7d77c941f009dd805931bd562ae64e0d799171d0efcfe63ac1a28d7787fa` |
| [Lichii 93](https://github.com/zortos293/Lichii/releases/tag/build-93) | 6 novembre | `9c664d82f81027750aa3755f043290b0e2b10aa777e9ccfe3b433def2becd6ee` |
| [Eglantine du 7 novembre](https://github.com/Djihads80/Eglantine/releases/tag/daily-20261107) | 7 novembre | `293f1f69b6d6e0c3df68e3f0e0e244510487f4e96340e23d75e197a4f0d7176b` |
| [Superbuild v11](https://github.com/callme-sy/Lichii-Superbuild/releases/tag/v11) | 7 novembre | `0462dce5e08b292738d377b40052d073cc55777f287d6cc3948e8c10d4d04826` |

## Premières observations, avant la comparaison

Chaque lancement utilise un affichage Sway privé, un serveur sonore privé,
une configuration et un dossier de données distincts. Une manette virtuelle
du laboratoire est transmise à l'émulateur. Le jeu est monté en lecture seule.
La génération d'images intermédiaires est désactivée.

Lichii 95, avec `EDEN_NX2_SPLIT=2`, produit des erreurs répétées de macros
graphiques. Un premier passage de Lichii 93 sans cette séparation reste noir
pendant sa préparation. Ces passages exploratoires ne donnent pas de classement
de cadence. Le passage ultérieur de Superbuild montre pourquoi il faut laisser
finir cette préparation : son titre devient visible après plusieurs minutes.

Eglantine affiche le titre et les cinématiques. Son code remplace par défaut
le réseau d'agrandissement des films par une copie de l'image. Ce comportement
vient de cette version, pas d'un réglage universel des quatre émulateurs.
Au passage en 3D, il quitte avec `VK_ERROR_DEVICE_LOST`, après environ
219 secondes de ce lancement. Le journal du noyau relève un délai dépassé
du moteur graphique à 14:00:16 UTC, puis un redémarrage réussi du GPU.
Un conteneur isole les fichiers et les processus, pas le processeur graphique.

Superbuild, avec `EDEN_NX2_SPLIT=0` et `EDEN_NX2_NO_MESH=1`, atteint la maison
de Link puis sa sortie vers la forêt. Le stick le déplace et A ouvre la porte.
Des fichiers de progression sont créés. Le réglage `NO_MESH` supprime des dessins
que le pilote doit normalement exécuter : certains objets peuvent manquer.
Ce résultat ne prouve ni la stabilité d'une soirée, ni une partie satisfaisante.

Les journaux de Superbuild montrent aussi des périodes où dix secondes de film
demandent environ quinze secondes réelles. C'est un ralentissement du décodage,
pas encore une mesure indépendante du décalage entre l'image et le son.

## Conditions de la comparaison

Les premiers lancements préparent les caches de shaders. Ils restent distincts
des passages avec cache. Les caches restent séparés par version. Une sauvegarde
de référence fournit le même départ pour les passages jouables.

Les versions alternent sur le même parcours. Une compilation, un
profileur ou une autre charge de test ne doit pas accompagner la mesure.
Un autre projet exécutait `pytest` pendant une partie de l'exploration : les
cadences exploratoires ne constituent donc pas une comparaison contrôlée.

La cadence du compositeur, celle de la capture et celle du navigateur ne disent
pas combien d'images le jeu calcule. Les comptes de présentations du jeu et les
gels sont relevés sur des intervalles dont la scène a été vérifiée à l'écran.
Les sauvegardes sont reprises après un arrêt complet de l'émulateur.

## Premier tour sur la même sauvegarde

Une sauvegarde manuelle prise sur le balcon de la maison de Link sert de départ.
Chaque version reçoit une copie de sa NAND, la mémoire persistante émulée,
après l'arrêt du moteur précédent. Chaque phase déplace seulement la caméra
pendant 90 secondes, après deux allers-retours de préparation. Les quatre
versions alternent dans cet ordre : 95, 93, Eglantine, Superbuild, puis à nouveau
95, 93, Eglantine, Superbuild. Les caches restent propres à chaque version.

Les fenêtres complètes de 600 présentations du jeu, contenues dans la phase,
donnent provisoirement 13,6 images/s pour la 95, 19,9 pour la 93, 22,0 pour
Eglantine et 17,9 pour Superbuild. Ce premier tour ne suffit pas pour classer
les moteurs. La charge moyenne du serveur descend de 20,7 à 4,4 entre la 95
et Eglantine. Une charge moyenne compte aussi les tâches en attente et conserve
la trace des minutes précédentes. Ce n'est pas le pourcentage d'un processeur.

Les captures confirment le même emplacement de départ et d'arrivée. Celle de
Superbuild montre aussi des aplats bleus anormaux dans la forêt. Une cadence
seule aurait masqué ce défaut. Les quatre fermetures de ce tour rendent le code
zéro, après fermeture de la fenêtre, sans arrêt forcé. MangoHUD, l'outil qui
incruste et mesure des compteurs graphiques, est absent de ce tour. La cause
des erreurs de fermeture exploratoires reste à confirmer avec la même version.

## Deux tours terminés

| Moteur | Tour 1, images/s | Tour 2, images/s | Plus grand intervalle observé | Images au-delà de 100 ms, tours 1 puis 2 |
|---|---:|---:|---:|---:|
| Lichii 95 | 13,56 | 19,56 | 253 ms | 9 puis 2 |
| Lichii 93 | 19,93 | 19,80 | 256 ms | 0 puis 2 |
| Eglantine du 7 novembre | 22,00 | 22,08 | 180 ms | 0 puis 1 |
| Superbuild v11 | 17,89 | 18,13 | 74 ms | 0 puis 0 |

Le lecteur conserve seulement les fenêtres complètes. Elles couvrent entre
30 et 61 secondes d'une phase de 90 secondes, selon la position du compteur.
Les décomptes de gels portent sur ces fenêtres, pas sur les 90 secondes entières.
Ce ne sont pas non plus des percentiles d'images individuelles. Les données
et les huit résultats d'arrêt sont conservés dans le fichier local
`spikes/switch2-room/results-2026-11-07.json`. Le travail n'est pas encore
committé ; la copie de travail fait foi pour ces essais.

Les huit captures de fin montrent Link au même endroit. Les aplats bleus de
Superbuild ne sont pas présents sur sa deuxième capture. Leur disparition
ne prouve pas que le défaut est corrigé. Les huit processus se ferment avec
le code zéro, sans arrêt forcé, en 2,6 à 4,3 secondes après la demande.

Ces deux tours désignent Eglantine pour l'essai suivant dans une salle
temporaire. Ses passages donnent la meilleure cadence de ce protocole.
Les sections suivantes vérifient séparément les films, les commandes du
navigateur, le passage dans la maison et la reprise d'une nouvelle sauvegarde.

## Son et image de l'introduction

Chaque version lit ensuite le même début de nouvelle partie. Un enregistrement
de 100 secondes prend le son du serveur PulseAudio privé et une capture d'écran
toutes les cinq secondes. Le film original et son fichier sonore sont extraits
du NUP fourni. vgmstream décode le son à six voies. Une recherche du même signal
dans ce son original donne sa position, indépendamment de l'horloge vidéo.
La correspondance d'une capture avec les images du film donne la position de
l'image. La génération d'images intermédiaires reste désactivée.

Le calcul conserve les correspondances sonores supérieures à 0,5 et les
correspondances visuelles supérieures à 0,95. Le contrôle sonore retrouve un
décalage connu de 5,25 secondes et refuse un bruit indépendant et le silence.
Les captures visuelles retenues atteignent au moins 0,967 dans le cas Eglantine.
Trois captures tardives de ce moteur ne dépassent pas 0,55 et sont refusées.
Un premier calcul leur attribuait quand même une position : choisir le meilleur
score ne prouve pas qu'il existe une correspondance. Aucun chiffre de décalage
n'est conservé pour ces trois images.

| Moteur | Points retenus | Dernière avance sonore mesurée |
|---|---:|---:|
| Lichii 95 | 14 | 36,4 s |
| Lichii 93 | 15 | 36,3 s |
| Eglantine du 7 novembre | 10 | 0,04 s |
| Superbuild v11 | 15 | 35,9 s |

L'incertitude estimée est de 0,5 seconde : le film est échantillonné quatre fois
par seconde et la prise d'une image demande jusqu'à environ 0,45 seconde.
Le dernier point Eglantine retenu correspond à environ 93 secondes du film,
contre environ 72 pour les trois autres moteurs. Ses dix valeurs vont de
−0,03 à +0,28 seconde. Cette méthode ne démontre donc pas un écart de
40 millisecondes exact. Elle distingue un son proche de l'image d'une avance
de plus d'une demi-minute. Elle ne conclut pas sur la fin du film.

Les quatre enregistrements passent dans l'ordre 95, 93, Eglantine, Superbuild,
après la fin des compilations et des tests du code. Un seul enregistrement
par moteur est réalisé. Ce sont des observations de ces passages, pas une
distribution de résultats sur de nombreuses parties. Les points acceptés et
refusés sont conservés dans `spikes/switch2-room/audio-2026-11-07.json`.

## Première vérification de la salle

La salle temporaire utilise le vrai worker, la page construite et son empreinte,
le vrai salon, un proxy privé et les périphériques du helper installé.
Un joueur et deux spectateurs reçoivent l'image. Une demande réseau de
manette 2 reçoit une salle à une place, sans attribution, puis sa connexion
se ferme. Les commandes A du spectateur ne quittent pas le titre ; celles du
joueur permettent de charger la forêt.

Les déplacements, la caméra, le menu, les onglets et la sauvegarde sont utilisés
depuis cette page. X fait effectivement sauter Link ; la séquence Y voisine
le laisse au sol. Cette observation vérifie le nom du bouton lu par le jeu,
au-delà du contrôle des codes du noyau. Une nouvelle sauvegarde prise près de
la porte de la maison est écrite à 15:54 UTC. La fermeture par le menu rend le
code zéro, sans arrêt forcé, en 3,7 secondes, puis copie la NAND.

Une autre salle de test reprend cette copie après arrêt complet. Elle retrouve
la position près de la porte, différente du balcon de référence initial.
Le même parcours ferme le jeu, prend la manette 3 dans le salon, puis relance
Zelda : le lanceur obtient bien l'unique manette 1 et les deux autres pages
restent spectatrices. Une place reconnue par la page ne suffit pas pour tester
ce passage : l'essai attend aussi le reçu et le nom observés par le salon,
puis le nouveau jeu et sa capacité effective de un.

Le joueur entre ensuite dans la maison, puis ressort vers la forêt avec les
commandes de cette page. Il s'agit de ce passage proche, sans écran de
chargement distinct, et non d'un parcours à travers toutes les zones du jeu.

Les quatre moteurs effectuent aussi un dernier parcours fonctionnel depuis
la même copie arrêtée, près de la porte. Une séquence identique de commandes
précède une nouvelle sauvegarde manuelle, l'arrêt complet, puis la reprise
sans recopier la référence. Les quatre confirmations « Saved. » sont relues.
L'empreinte du fichier manuel change à l'écriture et reste identique après
la reprise. Les captures retrouvent la position enregistrée. Eglantine finit
près du seuil, les autres plus loin dans la maison : une durée de commande
identique ne garantit pas une distance identique dans un jeu ralenti.
Les huit arrêts rendent zéro, sans arrêt forcé. Le fichier
`spikes/switch2-room/saves-2026-11-07.json` garde ces résultats.

Des contrôles de code et la préparation des fichiers installés accompagnent
une partie de ce dernier parcours. Il vérifie le fonctionnement ; ses durées
ne sont pas utilisées pour comparer les performances. Les mesures de cadence
et de synchronisation précédentes étaient déjà terminées.

## Pièges du raccordement

Le premier pilote de salle temporaire fournissait bien des ports privés,
mais le registre du salon recalculait les ports habituels à partir du numéro
de salle. L'image passait par le worker de test, tandis que le salon contactait
l'adresse installée et rendait une erreur. Ce premier essai n'est pas retenu
comme preuve du salon. Le pilote injecte maintenant un registre privé avant
son démarrage, interdit les actions systemd et vérifie le jeu, les noms et
la place réellement publiés par le salon. Le proxy possède aussi ses propres
dossiers et désactive la persistance automatique de sa configuration.

Le moteur ignore un chemin de stockage configuré si son dossier n'existe pas.
Sans création préalable, une nouvelle partie écrit dans le dossier par défaut
d'Eglantine, alors que l'archive lit celui d'Eden. L'adaptateur crée donc tous
les dossiers configurés avant le lancement. En retirant cette création, le
test échoue sur le dossier absent. Les essais de sauvegarde vérifient aussi
qu'une archive ancienne et un autre emplacement restent intacts.

Le lanceur peut commencer sur la manette 3 avant de lancer Zelda. Le passage
solo conserve sa demande de manette 1 jusqu'à l'annonce du nouveau worker à
une place. Une dernière annonce de l'ancien worker à quatre places ne doit
pas effacer cette demande. Le test redevient rouge quand cette conservation
est retirée. Les spectateurs n'envoient aucune demande de manette.

## Installation du 7 novembre

Le serveur utilise Eglantine `216d3e2943` depuis un dossier stable hors du
laboratoire. La configuration privée est
`/home/souhib/.config/nel3ab/switch2.json`. Les jeux inscrits sont dans
`/home/souhib/roms/switch2`. La progression normale utilise
`/home/souhib/.local/state/nel3ab/switch2`, avec un emplacement et une archive
distincts par titre. Seuls les caches de cette révision sont repris des essais,
aucune progression de laboratoire.

Le worker optimisé et l'unité systemd sont installés. Le salon et la boîte
noire sont relancés avec les sources présentes. L'adresse habituelle rend la
page construite, dont l'empreinte est vérifiée, même avec un cookie de 16 Ko.
Son catalogue contient Zelda sous `switch2`. L'entrée « Switch 2, expérimental »
conserve l'avertissement sur les objets manquants et les ralentissements.
Mario Tennis Fever reste dans le laboratoire. Les essais du soir décrits
plus bas atteignent un match, mais trouvent des disparitions et deux plantages.
Le jeu n'est pas inscrit au catalogue habituel.

Les contrôles locaux finaux passent : `just`, `just switch-controls-test`,
`just audit` et `just docs`. La porte complète comprend les 81 essais GPU,
le clip sonore décodé, les sauvegardes des deux adaptateurs et la capture.
Les 392 essais du salon et les 623 essais du navigateur passent également.
Le contrôle des commandes crée quatre périphériques isolés, vérifie les
boutons, les axes proportionnels et la poursuite des entrées après refus
d'une vibration. Aucun conteneur de ces essais ne reste actif.

Le site documentaire servi contient cette étude. Aucun commit ni envoi n'est
créé ; aucune nouvelle exécution de CI distante n'est donc revendiquée.

## Retour de la partie Zelda, le soir

Souhib trouve les films presque corrects, puis des saccades au chargement de
la carte. Le journal de sa partie relève notamment une image de 3,619 secondes.
Des fenêtres ultérieures de 600 présentations descendent vers 18 à 20 images/s,
puis remontent vers 29 à 35. Ces scènes ne sont pas identifiées séparément :
elles ne servent pas à classer des réglages. Elles confirment des pauses du
jeu, tandis que la capture du worker reste généralement récente de quelques
millisecondes. Les caches existent et persistent : après l'arrêt, le cache
du titre contient environ 38 Mio de shaders Vulkan, 11 Mio de shaders de maillage
et 16 Mio de pipelines du pilote. Leur présence ne prouve pas que chaque zone
nouvelle est déjà préparée.

Les douze relevés machine pris entre 17:13:41 et la demande d'arrêt à
17:26:23 UTC ne reconnaissent pourtant aucun émulateur. Le lecteur suivait
les noms de processus Dolphin et Ryujinx, mais ignorait `eden-cli`.
Il prenait donc son relevé de repos toutes les minutes et lisait l'allocateur
de mémoire vidéo pendant la partie. Ces lectures ont déjà produit des pauses
dans les essais de septembre. La liste des moteurs inclut maintenant Eden
avec le rôle Switch 2. Un test du vrai lecteur et de la vraie boucle sur une
fausse machine échoue avant la correction, puis exige le pas de partie sans
lecture de l'allocateur. Réintroduire le défaut le fait échouer de nouveau.
Le jumeau remplace Eden par un shell et vérifie le retour aux lectures de repos.
Le service corrigé reconnaît le moteur et produit ensuite ses relevés à deux
secondes, sans l'allocateur. Aucun gain de cadence n'est attribué à cette seule
correction sans comparaison alternée.

La capture d'écran en cas de chute reconnaît aussi le rôle `switch2`, au lieu
de le limiter à `switch`. Les essais vérifient les deux moteurs et conservent
le refus d'une capture d'écran périodique. Le cas Switch 2 échoue avant la
correction, puis quand l'ancienne condition est réintroduite.

Les journaux et la progression de Souhib sont conservés. Le moteur ferme sa
fenêtre, rend zéro et archive sa NAND sans arrêt forcé, en 3,8 secondes.
`spikes/switch2-room/zelda-session-2026-11-07.json` garde les fenêtres de
présentations et les limites de ces observations. Les dates ajoutées par
Docker à la sortie peuvent être retardées par la mise en tampon des journaux :
elles ne datent pas précisément chaque pause du jeu.

### La synchronisation réactive ne donne pas de gain mesuré

Une autre série reprend la même sauvegarde sur le balcon, avec le même cache
et les mêmes mouvements de caméra pendant 90 secondes. Seul
`use_reactive_flushing` change. Ce réglage surveille les lectures du processeur
dans la mémoire suivie par le GPU. Les notes du moteur signalent son coût dans
un autre jeu ; cela ne prouve pas un gain pour Zelda sur cette machine.
Les phases alternent activé, désactivé, activé, désactivé, sans compilation,
profilage ni autre émulateur pendant les mesures.

| Phase | Réglage | Images calculées/s | Plus grand intervalle | Images au-delà de 100 ms |
|---|---|---:|---:|---:|
| 1 | activé | 22,54 | 169 ms | 1 |
| 2 | désactivé | 22,47 | 80 ms | 0 |
| 3 | activé | 22,66 | 82 ms | 0 |
| 4 | désactivé | 22,57 | 82 ms | 0 |

Chaque résultat porte sur 1 200 images, environ 53 secondes de fenêtres
complètes dans la phase. Les quatre images finales montrent la même position.
Les quatre moteurs ferment leur fenêtre et sortent sans arrêt forcé.
Le réglage désactivé ne donne pas de gain de cadence ; le réglage installé est
conservé. L'unique intervalle de 169 ms du premier passage ne suffit pas à
attribuer une différence de fréquence des gels à ce réglage.
Ce parcours ne reproduit pas chaque chargement de zone nouvelle.
`spikes/switch2-room/zelda-flushing-2026-11-07.json` conserve les fenêtres,
les arrêts et la décision.

Un passage exploratoire demande ensuite le mode portable, en conservant la
synchronisation réactive. Il retrouve 22,74 images/s sur 1 200 images, avec
un intervalle maximal de 77 ms et aucun au-delà de 100 ms dans les fenêtres
retenues. Des saccades accompagnent sa préparation avant ce relevé. C'est
un seul passage, après les précédents, avec un cache qui peut différer pour
ce mode : il ne constitue pas une comparaison alternée des modes de console.
Il n'établit pas de gain immédiat suffisant pour changer le mode TV installé.
Le processus sort normalement. Les détails sont dans
`spikes/switch2-room/zelda-handheld-2026-11-07.json`.

L'index du NUP Zelda est aussi relu : ses 372 587 fichiers utilisent tous le
stockage brut du conteneur. Le chargement de carte ne décompresse donc pas
ces fichiers au niveau du NUP. Cela n'exclut pas la décompression des textures
ou d'autres données à l'intérieur des fichiers du jeu. Les caches graphiques,
les fichiers du jeu et les compteurs observés ne suffisent pas à attribuer
chaque gel de la partie à une compilation précise.

## Mario Tennis Fever dans une vraie salle temporaire

Le jeu fourni porte l'identifiant `0400D4201C6EA000` et la mise à jour numérique
`327680`. Les deux ExeFS, les exécutables de base et de mise à jour, donnent
le même identifiant dans leurs métadonnées. Le NUP construit contient les deux
paquets ; l'empreinte de sa table d'index est vérifiée. Le dossier fourni se
nomme `v1.1.1`, mais l'écran affiche `5.0.0` : en l'absence de métadonnée de
version affichable, le chargeur NUP formate directement `327680` en `5.0.0`.
Ce texte n'est donc pas une vérification indépendante de la version commerciale.

Le pilote de salle lit désormais l'inscription du jeu au lieu d'écrire en dur
l'identifiant et le nom de Zelda. Il exige une famille `switch2`, un titre de
base et un nom. La copie d'essai reste hors de la bibliothèque installée.
Le vrai salon vérifie un joueur, deux spectateurs et le refus d'une manette 2.
Le jeu traverse son film, son tutoriel, son menu et un match libre simple sur
gazon. Le clavier de la page déplace Mario, sert et frappe. Le résultat du
match contre Boo est atteint.

Les fenêtres complètes de 600 présentations couvrent 81,027 secondes et
3 600 images pendant une observation de 108 secondes : 44,43 images/s,
avec une image de 104,8 ms et une seule au-delà de 100 ms. Les passages
entre points et les animations de résultat font partie de cet extrait.
Ce n'est pas une moyenne portant uniquement sur les échanges. Les bornes
utilisent l'âge du processus, avec cinq secondes retirées à chaque bord pour
écarter l'incertitude sur l'initialisation de l'horloge du journal.
Une préparation de manettes de laboratoire commence près de la fin : cette
observation ne constitue pas une comparaison contrôlée de performances.

Des images montrent Mario ou sa raquette absents, y compris dans la présentation
avant le premier échange. Le moteur sort ensuite avec le code 139, à
17:43:08 UTC, après le résultat du match. Son journal rapporte un accès mémoire
invalide dans le fil GPU. Le conteneur ne rapporte pas de manque de mémoire,
et le noyau ne redémarre pas le GPU. Le défaut n'est pas attribué au navigateur.

Un autre lancement utilise exactement le même exécutable, mais un petit
lanceur privé retire `EDEN_NX2_NO_MESH` avant de l'exécuter. La valeur `0`
ne suffirait pas : cette version regarde la présence de la variable.
Le match contre Donkey Kong atteint aussi des échanges ; une capture montre
encore Mario absent alors que la balle, le filet et l'adversaire restent
visibles. Les adversaires et l'état des caches diffèrent, donc les deux
passages ne servent pas à classer les performances ni à démontrer un gain.
La réactivation du maillage ne constitue pas une correction visuelle validée.
Ce deuxième moteur finit lui aussi avec le code 139 à 17:50:00 UTC, pendant
les points suivants. Il ne s'agit donc pas seulement d'une faiblesse du premier
enregistrement. La salle temporaire et ses producteurs sont ensuite arrêtés.

Un [rapport amont de disparitions similaires](https://github.com/Djihads80/Eglantine/issues/637)
décrit un essai de tailles de tampons de calcul sur NVIDIA et Windows.
Son auteur précise que la comparaison est incomplète et que de plus grandes
tailles dégradent d'autres jeux. Ce n'est pas une correction validée pour
ce serveur AMD. Aucun changement global de ce type n'est appliqué.
`spikes/switch2-room/fever-2026-11-07.json` conserve les observations.
Tennis Fever reste absent du catalogue installé tant que ces défauts ne sont
pas résolus.

La validation finale de cette reprise passe : `just` avec 395 essais du
salon, 623 du navigateur et 81 GPU, puis `just audit` et `just docs`.
Les services du salon et de la boîte noire sont relancés avec la correction.
La salle habituelle est ouverte au catalogue, sans jeu actif ; Zelda et ses
deux fichiers de progression sont conservés. Aucun processus de test, helper
ou producteur de capture ne reste actif. La page et cette étude sont relues
par le proxy habituel. Aucun commit ni nouvelle CI distante n'est créé.


## 8 novembre : troisième prototype sur les parcours mémoire

La suite du profil isole les demandes de synchronisation de tampons de leurs
transferts réels. Quatre fenêtres complètes couvrent 40,11 secondes : environ
139 000 appels/s pour 74,43 Mio/s copiés. La majorité des demandes ne transfère
rien. Le prototype ajoute un résumé prudent des pages modifiées par le CPU
et des pages dont la surveillance doit être réarmée, sans réutiliser une copie
sur la seule base de l'échantillon de contenu.

Quatre phases alternées en mode 0, avec mêmes options et caches initialement
identiques, donnent 22,42 puis 22,32 images/s au témoin amont intact compilé
localement, 21,45 puis 21,23 au prototype. Le regroupement donne **22,37 contre
21,34 images/s**, soit **−4,61 %**. Les sondes sont désactivées, aucun profileur,
compilateur ou CI ne tourne pendant les phases. Le résultat classe le prototype
complet, qui garde le coût du résumé et des branchements de diagnostic inactifs.
Il ne démontre pas lequel de ces coûts explique le recul. Le prototype reste
hors de la salle installée.

Six captures GPU réelles produisent 3 008 à 3 136 intervalles chacune,
sans événement abandonné. Les catégories se recouvrent et l'instrumentation
ajoute plusieurs milliers de commandes ; ces premiers résultats ne fixent
pas le coût GPU exclusif d'une image normale. Ils orientent vers une sonde
plus légère par grandes passes et vers l'identification des programmes coûteux.
Les 241 tests du moteur passent avec l'option coupée puis activée ; quatre
tests réseau sont ignorés dans chaque suite. Cinq mutations ciblées sont
refusées. Le rapport `spikes/switch2-room/buffers-2026-11-08.json` et le
[plan détaillé](plan-60fps-switch2-2026-11-08.md#troisieme-prototype-recherches-memoire-et-commandes-gpu)
conservent les mesures et leurs limites. Aucun palier à 30, 45 ou 60 images/s
n'est validé par ce troisième essai.


La marche au sol et la sauvegarde privée sont reprises au même endroit après
arrêt complet. Le fichier manuel reste identique à la reprise. L'extrait audio
contient un signal stéréo, sans précision de synchronisation revendiquée.
Aucun changement de zone n'est testé dans ce troisième prototype. Le laboratoire
et ses manettes sont retirés ; les huit fichiers de progression présents après
la partie normale du joueur restent identiques pendant les essais privés.
La boîte noire est relancée et le moteur installé reste inchangé.


## Du 8 au 9 novembre : sonde GPU par lots

Le profilage par soumission existante réduit le nombre de requêtes GPU par
capture. Quatre phases alternées donnent 22,36 images/s avec la sonde coupée
et 21,75 activée, soit −2,74 %. Le dernier passage activé concentre sept images
de plus de 100 ms ; la sonde n'est pas présentée comme transparente. Les quatre
sorties sont normales. Les 64 captures conservées situent les transferts à
0,80 ms et l'exécution principale à 24,87 ms en médiane, avec 155 segments de
soumission. Ces intervalles incluent des effets de pipeline et ne sont pas
des durées exclusives normales du matériel.

La couverture explicite révèle qu'une rotation sur une liste de programmes
changeante peut en manquer un fréquent. Son contrôle ciblé échoue d'abord
sur la vue sauvegardée au sol, où le programme est absent, puis le retrouve
sur le balcon : sept échantillons, 0,039 ms de médiane. Il reste un programme
rare non chronométré. Le plus long programme invité effectivement mesuré est
voisin de 1,97 ms dans la série de caméra, sans fonction identifiée ni coût
exclusif prouvé. Les calculs internes du moteur ne sont pas identifiés par
cette liste. La piste suivante concerne les nombreux petits lots et leurs
dépendances, en conservant le suivi correct des ressources.

Le [plan détaillé](plan-60fps-switch2-2026-11-08.md#sonde-gpu-par-lots-du-8-au-9-novembre)
et `spikes/switch2-room/coarse-gpu-2026-11-08.json` conservent les valeurs,
la couverture et leurs limites. Le moteur final passe 241 tests dans chacune
des deux configurations, avec quatre tests réseau ignorés ; quatre mutations
ciblées sont refusées. Marche au sol, signal stéréo, sauvegarde et reprise au
même endroit passent. Aucun changement de zone ni synchronisation précise
n'est validé. Les huit progressions normales et la configuration installée
restent identiques. Le laboratoire est retiré et la boîte noire relancée,
sans installation de la sonde, commit, envoi ni nouvelle CI distante.
