# Zelda Switch 2 : reprise vers 40 images/s constantes

Point de départ : 8 novembre 2026. Ce plan concerne la copie de Zelda déjà
testée, base `0400486024DEC000`, mise à jour `131072`, dans Kokiri. Il accompagne
l'[étude et ses mesures](etude-switch2-2026-11-07.md). Les étapes décrites comme
à faire sont des expériences proposées, sans gain garanti ni date de livraison.

## Mis de côté le 20 novembre

Souhib a demandé le 20 novembre de laisser le moteur Switch 2 de côté. La
reprise du 19 novembre, juste en dessous, reste exacte comme état du
laboratoire, mais aucune de ses prochaines actions n'est en cours ni
prévue. La salle garde Lichii `65defb74` plafonné à 30 ; rien n'est
installé. Avant de reprendre ce plan, lire l'entrée du
[carnet](carnet-de-bord.md) du 20 novembre et demander à Souhib si
l'objectif de 40 images par seconde tient toujours.

## Reprise au 19 novembre : l'amont gèle, une marge de rétention le corrige en laboratoire

Cette section est la consigne de reprise courante. Elle complète celle du
18 novembre, juste en dessous, qui reste valable sauf sur les points repris
ici. Récit : [carnet](carnet-de-bord.md), entrée « Nuit du 18 au 19
novembre ». Rapport : parties 10 à 13 de
`~/.local/share/nel3ab/nx2-lab/2026-11-12-probe/experiments/m-amont341/REPORT.md`.

### Ce qui est installé au 19 novembre

Rien de nouveau : Lichii `65defb74` plafonné à 30. Aucun moteur de l'essai M
n'est dans la salle.

### Ce qui est établi dans la nuit du 18 au 19

Moteur seul, cache chaud, trajet de 65 s dans Kokiri (tour de caméra, deux
boucles de marche, retour de caméra), plafond de 30.

| Constat | Mesure | Force |
|---|---|---|
| Les gels d'une demi-seconde sont propres à l'amont | Amont par défaut : 41 trajets gelés sur 152, une image de 0,46 à 0,61 s à chaque fois. Installé : 0 sur 12, en alternance avec un amont qui en gèle 5 sur 12. | Prouvé, un trajet |
| Le gel a une signature unique | Le moteur recrée une série de cinq images de texture ; l'allocation de la quatrième dure 17 à 23 ms au lieu de moins de 5 ; 190 à 290 Mio partent dans la mémoire du PC ; le moteur attend la carte 0,45 à 0,51 s. Les 34 gels tracés l'ont, aucune des 625 autres occurrences ne l'a. | Prouvé pour la signature ; ce que fait la carte pendant l'attente n'est pas mesuré |
| « La carte est pleine » n'est pas la bonne lecture | Avec la carte limitée à 7 424 Mio par un réglage de l'amont, le gel reste (3 sur 8). Le niveau de mémoire vidéo relevé chaque seconde ne sépare pas les trajets gelés des autres. | Réfutation prouvée |
| La règle de rétention de l'amont remplit la carte | Limite de rétention annoncée à 8 117 Mio pour un budget de 8 146. Rétention coupée, l'amont retombe à la mémoire vidéo de l'installé. | Prouvé |
| Une marge de 1 024 Mio sous cette limite retire le gel | Même binaire, séries alternées : 0 gel sur 72 trajets avec la marge, 9 sur 64 pour le témoin. Par lancement : 0 sur 12 contre 4 sur 11, soit 4 chances sur 100 par hasard. 0 allocation lente sur 251 recréations tracées. | Aucun contre-exemple ; pas une preuve au sens strict |
| La fréquence du gel change selon la période | 27 % des trajets le soir, 5 % de 03:00 à 07:15, 44 % de 07:16 à 08:53. Ni le binaire, ni Jellyfin, ni un autre client de la carte, ni la mémoire libre, ni la température. | Constaté ; cause inconnue |

### Le candidat du laboratoire

- Arbre `2026-11-14-pages/source-amontmarge` : build 341 plus une variable,
  `EDEN_NX2_TC_RETENTION_MARGIN_MIB=N`, qui retire N Mio à la limite de
  rétention. Sans la variable, rien ne change. Test rouge d'abord dans
  `src/tests/video_core/eviction_age.cpp`.
- Binaire `build-amontmarge/bin/eden-cli`, sha256 `de845859…`, bras M de
  `experiments/m-amont341/scripts/pass.py`.
- Un lancement de huit trajets avec la marge et la trace de saccades :
  `scripts/serie_tenue.py NOM:M:trajets8:EDEN_NX2_TC_RETENTION_MARGIN_MIB=1024,EDEN_NX2_STUTTER_TRACE=1`.
  Le témoin est la même ligne sans la première variable.
- Compter les gels : `scripts/images_recurrentes.py NOM:ETIQUETTE …` (lit
  la trace, voit chaque image). `scripts/seconde54.py` ne regarde que la
  seconde 54 du trajet. `scripts/fisher.py` donne la probabilité.

### Ce qui n'est pas prouvé au 19 novembre

- Que la marge retire le gel ailleurs que sur ce trajet, dans une salle
  complète, ou avec une autre taille. Seule la valeur 1 024 est essayée.
- Ce que la marge coûte en cadence. Elle fait recréer la série d'images
  plus souvent (3,9 fois par trajet au lieu de 3,0), chaque fois une image
  de 65 à 117 ms.
- La cause de la variation de fréquence du gel selon la période. Piste non
  établie : Link ne finit pas au même endroit d'un lancement à l'autre.
- Ce que font la carte et le pilote pendant l'attente. Il faudrait une
  trace du noyau, donc un compte administrateur.
- Tout ce qui ne l'était pas le 18, sauf la question des gels.

### Prochaine action au 19 novembre

1. Décision de Souhib : essai en salle complète de l'amont avec la marge.
   Rien n'entre dans la salle sans cette décision.
2. Dans toute série sur ce gel, garder un témoin sans marge dans la même
   alternance et compter avec la trace de saccades. Un témoin qui ne gèle
   pas ne prouve rien pour l'autre bras : le 19, il s'est tu quatre heures.
3. Vérifier la limite de rétention sur tout le lancement (lignes « Memory
   margins » du journal), pas seulement au démarrage : le moteur l'a baissée
   seul dans `sm-um1` après le passage d'un client étranger.
4. Avant la salle, il reste de la liste du 18 : recalibrer à la vue le
   trajet vers la maison de Link, et qualifier les 3 % de passages
   anticipés sur un trajet et un changement de zone.
5. Facultatif : essayer une marge plus petite (256, 512 Mio) pour connaître
   la plus petite qui suffit. Signaler le constat au projet Lichii est une
   action extérieure : sur décision de Souhib seulement.
6. Les points 7 et 8 du 18 novembre restent à faire (`recalc.py`, puis les
   8 à 14 % qui manquent pour 40).

## Reprise au 18 novembre : candidat écarté, amont à rattraper

Cette section était la consigne de reprise jusqu'au 19 novembre. Elle reste
valable, complétée par la reprise du 19 ci-dessus. Elle remplace la
« Prochaine action » du 14 novembre, conservée plus bas. L'objectif reste **au
moins 40 images de jeu par seconde, régulières**, avec la stabilité en
premier. Récit : [carnet](carnet-de-bord.md), entrées des 14 et 18 novembre.

### Ce qui est installé au 18 novembre

Rien de nouveau depuis le 14 : Lichii `65defb74` plafonné à 30, et la boîte
noire corrigée le 14 à 18:26 UTC. La machine a redémarré le 17 novembre sur le
noyau 7.0.0-43 (7.0.0-38 avant). Les chiffres d'avant le 17 ne se comparent
plus directement à ceux d'après : toujours alterner dans la même séance.

### Ce qui est établi depuis le 14

| Essai | Résultat | Force |
|---|---|---|
| J, candidat « pages » (`9b70df2e`) | Laisser ouvertes les pages que le jeu réécrit ne gagne rien : le moteur vérifie ces pages 80 fois plus souvent qu'il ne les recopie. Sans garde, 13 images par seconde au lieu de 31,6. | Prouvé, une scène |
| K, qualification | Candidat écarté. En alternance stricte sous plafond il coûte 0,8 % de plus que l'installé (étendues qui se recouvrent), et un essai unitaire montre un défaut de justesse. | Rejet prouvé ; écart de coût en tendance |
| L, état coûteux | Dans l'état coûteux, GPUBack rouvre et referme lui-même 26 pages voisines, 180 appels de plus par image. Le choix automatique des petits tampons uniformes n'en est pas la cause : forcé du côté du cache, il donne 21,5 images par seconde. La chasse du 18 (onze lancements) ne l'a pas rencontré. Référence de l'état bas sur le noyau 7.0.0-43 : 28,41 à 28,57 ms de GPUBack par image, 32,0 à 32,3 images par seconde sans plafond. | Prouvé pour la réfutation ; cause exacte non établie |
| Veille du 18 | L'amont (Lichii) a publié les builds 177, 228, 316 et 341 et fusionné 447 demandes depuis le 11. Plusieurs visent notre limite (1436, 1441, 1518, 1953, 2116). La 1436 décrit et retire l'aller-retour vu à l'essai L. | Lu ; mesuré en bloc à l'essai M |
| M, amont compilé ici | Build 341 (`9e2d66b0`) et tête de `nx2` (`badcc1b4`), recette du moteur installé, 13 fichiers portés pour l'instrument. Sans plafond, vue fixe : avec la politique d'attente de la production, 3,8 % de coût de GPUBack en moins mais 1,8 % d'images en plus seulement. Avec la politique de l'amont : 34,5 images par seconde contre 31,3 pour l'installé le même soir (+10 %), GPUBack à 27,1 ms par image. Build 341 et `nx2` se confondent. Vérificateurs de l'amont : zéro décision fausse sur 528 000 et 544 000 attentes passées sans vidange, 3 % de passages anticipés non qualifiés. | Prouvé, une scène, moteur seul, sans plafond |
| M, sous plafond et tenue | Sous le plafond de 30, vue fixe, alterné : 30,00 images par seconde pour les deux ; l'amont occupe GPUBack 82 % du temps au lieu de 86 % et consomme 17 % de processeur en moins par image (115 ms contre 138). Tenue, un lancement par moteur : aucun intervalle de plus de 100 ms à chaud en dix minutes pour aucun des deux ; à froid, 1 intervalle de plus de 100 ms sur le premier trajet pour l'amont, 13 pour l'installé ; l'amont ne détruit plus de programmes graphiques pendant une pause (l'installé en détruit 387 et en reconstruit 192 au retour). Réserve : trois intervalles isolés de 430 à 456 ms chez l'amont, non expliqués le 18 ; voir la reprise du 19 novembre, ils sont propres à l'amont. Changement de zone non mesuré : le trajet automatique n'atteint plus l'échelle, 0 lancement sur 6, sur les deux moteurs. | Plafond : prouvé, une vue, moteur seul. Tenue : tendance |

Rapports : `~/.local/share/nel3ab/nx2-lab/2026-11-12-probe/experiments/`
(`j-pages`, `k-qualif`, `l-etat-couteux`, `m-amont341`) et
`~/.local/share/nel3ab/nx2-lab/2026-11-18-veille/`.

### Ce qui n'est pas prouvé au 18 novembre

- Le gain de l'amont dans une salle complète, avec le navigateur et
  l'encodage. L'essai M mesure le moteur seul.
- La tenue de l'amont au-delà d'un lancement par scénario. Le changement de
  zone n'est pas mesuré, une séance de plus de dix minutes non plus.
- L'origine de trois intervalles isolés de 430 à 456 ms chez l'amont (deux
  à froid, un à chaud entre deux segments), et s'ils lui sont propres.
  Réglé le 19 novembre : ils lui sont propres (reprise du 19, plus haut).
- Toute comparaison de cadence en trajet : avec les mêmes entrées, les deux
  moteurs ne finissent pas au même endroit.
- La justesse de la politique d'attente de l'amont au-delà de ce que
  comptent ses deux vérificateurs. Dans 3 % des passages, le jeu continue
  avant que la carte graphique ait fini ; personne n'a regardé ce qu'il en
  fait.
- L'objectif de 40 : il manque encore 8 à 14 % de coût de GPUBack par image
  (27,1 ms mesurés, 23,4 à 25,0 nécessaires).
- La cause exacte de l'état coûteux dans le moteur installé. Il existe
  toujours depuis le redémarrage du 17 : absent des onze lancements de
  l'après-midi du 18, il a paru dans deux lancements du soir sur quatre.
  Il n'a paru dans aucun des onze lancements de l'amont, ce qui ne prouve
  pas que l'amont l'a retiré. Le moteur de diagnostic
  `0c11bbad` (source `source-ubo`, correctif
  `experiments/l-etat-couteux/ubo.diff`) désignera les tampons en cause s'il
  le rencontre : `experiments/l-etat-couteux/scripts/chasse.py PREFIXE 8`.
  Ne pas relancer cette chasse avant d'avoir mesuré une version amont.
- Tout ce qui ne l'était pas le 14 : salle complète, séance longue, mémoire
  sous préchargement.

### Avis rendu à Souhib le 18 novembre, en attente de sa réponse

1. **Ne pas écrire d'émulateur.** Garder Lichii comme base, compilé ici, avec
   une pile courte de retouches.
2. **Rattraper l'amont** au lieu d'optimiser l'ancienne base : compiler une
   version récente avec la recette du laboratoire, lui ajouter seulement les
   traces dont l'instrument a besoin, puis l'alterner contre l'installé.
3. **Fabrique de consoles** : utile côté salle, à faire après la stabilité de
   Zelda. Carte de l'existant dans `2026-11-18-veille/CARTE-MOTEURS.md`.
4. Restent à trancher depuis le 14 : les deux défauts de la boîte noire
   (démarrage compté comme un gel, onglet caché compté comme un gel).

### Prochaine action au 18 novembre

1. Fait le 18 : la chasse de l'essai L est close sans prise (huit lancements,
   tous dans l'état bas). L'amont a peut-être déjà retiré la cause (demande
   1436).
2. Fait le 18 : copies complètes de Lichii (toutes branches et étiquettes) et
   d'Eglantine dans `~/.local/share/nel3ab/nx2-lab/2026-11-18-amont/mirror/`.
3. Fait le 18 : le build 341 (`9c9a1dfa56`) et la tête de la branche `nx2`
   (`9cd2c9e014`, qui seule contient les demandes 2116 à 2161) sont
   compilés et mesurés sans plafond (essai M). Candidat retenu pour la
   suite : le build 341, version publiée, que `nx2` n'améliore pas ici.
   - `2026-11-18-amont/port_traces.py SOURCE source-base` porte sur un arbre
     amont ce que l'instrument exige (les quatre écarts de l'essai F) : le
     dossier de données « eden », les lignes de cadence, et la politique
     d'attente de la production. Il échoue si une ancre a bougé. Il passe sur
     les deux arbres.
   - `2026-11-14-pages/build_amont.py NOM` compile `source-NOM` avec la
     recette du moteur installé (les options s'appellent `LICHII_*` en amont).
   - Arbres : `2026-11-14-pages/source-amont341` et `source-amontnx2`.
   - Essai M (`experiments/m-amont341/`) : bras I installé, A build 341 avec
     la politique d'attente de la production, U build 341 avec celle de
     l'amont, N et V de même pour `nx2`. `scripts/serie.py PROFIL SEGMENTS
     SECONDES NOM:BRAS[:VAR=VALEUR]` enchaîne des lancements à vue fixe ;
     `scripts/serie_tenue.py NOM:BRAS:froid|long|zone` enchaîne la tenue.
4. Chercher dans le carnet chaque numéro de demande avant de la compter comme
   nouvelle : la 1095 avait été réessayée pour rien le 11 novembre.
5. Fait le 18 au soir : plafond de 30 (`sm-pi1`, `sm-pu1`, `sm-pu2`,
   `sm-pi2`), cache vide (`sm-fu1`, `sm-fi1`), dix minutes à chaud
   (`sm-lu1`, `sm-li1`). Résultats dans le tableau plus haut et aux parties
   7 et 8 du rapport `m-amont341`. Le changement de zone (`sm-zu1` à
   `sm-zi3`) n'a rien mesuré.
6. Avant de proposer l'amont pour la salle, trois choses, dans cet ordre :
   - Dire si les intervalles de 430 à 456 ms sont propres à l'amont :
     alterner installé et amont sur le scénario à froid et sur le scénario
     long (`scripts/serie_tenue.py`), au moins deux lancements par moteur,
     et compter les intervalles de plus de 300 ms. Le journal de l'amont
     n'écrit rien pendant ces intervalles : prévoir une trace. Lancé le 18
     à 22:20 UTC, ordre installé, amont, amont, installé : `sm-fi2`,
     `sm-fu2`, `sm-fu3`, `sm-fi3` à froid, puis `sm-li2`, `sm-lu2`,
     `sm-lu3`, `sm-li3` à chaud. Fait dans la nuit du 18 au 19 : ils sont
     propres à l'amont, et la suite est dans la reprise du 19 novembre.
   - Recalibrer à la vue le trajet vers la maison de Link (`prep_to_l` de
     `scripts/tenue.py`, d'après `d-stabilite/scripts/zone_route.sh`). Il
     échoue six fois sur six le 18 avec les entrées du 12. Ne pas corriger
     par calcul : un pas de côté de 0,36 s fait pivoter Link, et 23 pas de
     0,12 s ne prennent pas l'échelle.
   - Qualifier les 3 % de passages anticipés : vérificateurs de l'amont sur
     un trajet et un changement de zone, pas seulement la vue fixe.
   Puis un essai en salle complète. Rien n'entre dans la salle sans la
   décision de Souhib.
7. `k-qualif/scripts/recalc.py` reprend sans contrôle un horodatage coupé
   par une lecture en cours d'écriture (`sm-li1` t2). Le faire rejeter un
   horodatage qui recule, avec un jumeau négatif, avant la prochaine série.
8. Pour 40 : chercher les 8 à 14 % qui manquent sur GPUBack à partir de
   l'amont, plus sur l'ancienne base. 72 % des attentes vidangent encore
   (attentes d'égalité ou de masque) : c'est la première piste à mesurer.

## Reprise au 14 novembre : deux séries relues

Cette section est conservée comme historique : la consigne courante est celle
du 18 novembre, juste au-dessus. Elle remplaçait la « Prochaine action » du 12
novembre, conservée plus bas. Le récit complet est dans le
[carnet](carnet-de-bord.md), entrées des 12 et 14 novembre.

### Ce qui est installé au 14 novembre

Le moteur proposé reste Lichii `65defb74`, plafonné à 30. Jellyfin, le worker
et les sauvegardes n'ont pas été touchés. Aucun commit.

Un seul changement est installé, avec l'accord de Souhib : la boîte noire,
redémarrée le 14 novembre à 18:26 UTC. Son seuil de chute suit le plafond du
jeu (27 pour Zelda, 50 pour les autres), et son profileur roulant ne suit plus
le moteur Switch 2. Code : `control/nel3ab_control/boite_noire/` et
`settings.py` (`boite_noire_plafonds`, `boite_noire_part_plafond`,
`boite_noire_roulant_sauf`). Essais : `control/tests/boite_noire/`.

### Ce que la série 2 établit

Les rapports sont sous
`~/.local/share/nel3ab/nx2-lab/2026-11-12-probe/experiments/`. Chaque essai de
`d` à `g` finit par le verdict d'un relecteur, qui fait foi. Les essais `h` et
`i` sont faits par la session qui pilote, sans relecteur.

| Constat | Force | Rapport |
|---|---|---|
| Le préchargement retire l'accroc du retour de pause : un intervalle de 134 à 193 ms et une seconde qui perd 320 à 390 ms en production, quatre retours sur quatre ; rien de tel sur trois retours avec. Il coûte 0,7 seconde et 8,5 secondes de processeur au démarrage. | Prouvé, moteur seul, un trajet. Son risque sur la mémoire n'est pas mis à l'épreuve. | `d-stabilite` |
| Donner au jeu une priorité haute sur la carte le fait tomber : jeu perdu deux fois sur deux, une seconde après le départ d'un transcodage Vulkan. | Prouvé. Piste fermée sur ce noyau et cette carte. | `e-priorite` |
| Mettre le film en priorité basse remonte le jeu de 12,5 à 18,7 images par seconde. Le film passe de 2,13 à 1,83 fois la vitesse de lecture. Le jeu ne tient pas 30. | Mesuré, deux lancements par bras. Deux témoins manquent. Pas essayé dans le vrai Jellyfin. | `e-priorite` |
| Lichii build 160 n'a pas été lancé : le système de permissions de la session a refusé. Par lecture du source, l'amont ne détruit plus de pipeline sous 54 770 sur cette machine. Le binaire officiel n'est pas mesurable tel quel, et quatre choses le séparent du moteur installé. | Lecture, aucune mesure. | `f-build160` |
| Le profileur roulant de la boîte noire ajoute 2,5 à 3,0 % au coût de GPUBack. Quand la marge manque, il retire 3,6 à 4,3 % de cadence. | Prouvé, moteur seul. | `g-marge` |
| Le seuil de chute à 50 donne une fausse alerte toutes les cinq minutes pour un jeu à 30, et a masqué la vraie chute du 11 novembre. Au seuil 27, le rejeu des mesures réelles la prend. | Prouvé par rejeu. | `g-marge` |
| Le cœur réservé, dans la forme essayée, baisse le coût de GPUBack de 1,9 à 2,5 %. Il ne ramène pas 30 sous charge. | Prouvé pour cette forme. | `g-marge` |
| Le moteur installé a deux états. Dans le second, GPUBack coûte 4 % de plus, sans retour. Avec la boîte noire, le jeu passe alors à 29,4 à 29,6 images par seconde. | Existence prouvée sur cinq passages. Déclencheur inconnu. | `g-marge` |
| Cette hausse est entièrement dans `mprotect`. À l'état bas, le moteur fait 408 à 437 changements de protection par image, sur les mêmes 440 pages. | Prouvé par les profils de trois sauts et par une trace de l'état bas. Non relu. | `h-mprotect` |
| Désactiver `use_reactive_flushing` coûte 2,4 % à GPUBack et 1,2 % de cadence. Le réglage de la production est le bon. | Prouvé, quatre lancements alternés. Non relu. Piste fermée. | `i-reactive` |

### Ce qui n'est toujours pas prouvé

- Rien n'est mesuré dans une salle complète, avec worker, capture, encodage et
  navigateur.
- Le risque du préchargement sur la mémoire, à travers plusieurs lieux.
- Ce qui déclenche le second état du moteur.
- Tout chiffre sur build 160.
- Le gain réel d'une retouche du moteur sur les protections de mémoire.

### Où en est l'objectif de 40

Il faut 19 à 23 % de coût GPUBack en moins. Les pistes chiffrées à ce jour :
profileur roulant coupé (2,5 à 3 %), cœur réservé (2 %), protections de
mémoire (borne haute de 5 à 9 %). Même additionnées, elles restent sous 19 %.
Aucun réglage n'atteint 40 sur ce processeur. Il faut une retouche plus
profonde du moteur, ou un processeur environ 1,4 fois plus rapide par cœur.

### Réponses de Souhib le 14 novembre au soir

1. **Boîte noire : oui.** Fait et installé, voir plus haut.
2. **Retouche du moteur : oui**, et accord pour compiler n'importe quelle
   version de l'émulateur. Cela lève l'exclusion du 12 novembre sur la
   compilation du commit de build 160.
3. **Jellyfin : ne pas y toucher pour l'instant**, mais regarder s'il sert
   pendant les essais. Outil en lecture seule :
   `~/.local/share/nel3ab/nx2-lab/2026-11-14-pages/tools/jellyfin_actif.py`.
4. Rien n'entre dans la salle sans sa décision.

La liste qui suit est gardée pour mémoire. Ses points 2, 3 et 4 ont maintenant
leur réponse ; le point 1 est suspendu ; le point 5 reste ouvert.

### Décisions qui attendaient Souhib le 14 novembre

1. **Jellyfin.** Aucun remède côté moteur ne tient les deux critères. Il reste
   deux options côté Jellyfin, ou accepter la chute pendant un tel
   transcodage. Ne plus incruster les sous-titres image côté serveur : le jeu
   tient 29 à 30. Mettre le film en priorité basse (deux fichiers montés et
   trois variables dans le conteneur Jellyfin) : le jeu remonte à 18,7.
2. **Boîte noire.** Lier le seuil de chute au plafond du jeu. Couper ou
   alléger le profileur roulant pour ce jeu, au prix du profil des secondes
   d'avant une chute. Attention : le service tourne depuis le dossier du
   dépôt, et l'instrument l'arrête puis le relance à chaque passage. Modifier
   ces fichiers revient donc à installer au prochain redémarrage. C'est
   pourquoi rien n'est encore modifié.
3. **Build 160.** Le lancement du binaire officiel demande que Souhib
   l'autorise lui-même dans le système de permissions, ou le lance lui-même.
   Il ne dirait que si le moteur démarre et gèle moins. Pour comparer le coût,
   il faut compiler ici le commit `2eb5f081c8` avec les retouches du
   laboratoire. L'accord du 12 novembre excluait cette compilation.
4. **Retouche du moteur sur les protections.** Compiler un candidat privé
   depuis le source du laboratoire, qui ne referme plus les pages que le jeu
   réécrit à chaque image.
5. **Refroidissement du processeur.** Toujours sans réponse.

### Prochaine action au 14 novembre

En cours le 14 novembre au soir : le candidat moteur sur les protections de
mémoire. La fabrique est dans `~/.local/share/nel3ab/nx2-lab/2026-11-14-pages/`
(`build.py`, lire son en-tête). Elle est validée : le source du laboratoire,
recompilé, redonne le moteur installé à 24 octets près, la date de compilation
et l'identifiant de build. Un agent écrit et mesure le candidat (essai
`j-pages`), un second le relit et le qualifie (essai `k-qualif`). Le candidat
garde son comportement neuf derrière un interrupteur, pour comparer les deux
bras dans le même binaire.

Ensuite, dans cet ordre :

1. Essai alterné dans une salle complète : la production contre la production
   avec préchargement. Puis une séance de plus d'une heure à travers plusieurs
   lieux, mémoire relevée. Lire les deux séries d'intervalles du moteur et
   juger au-dessus de 130 ms : le trajet devant Saria frôle 100 ms tout seul.
2. Fait le 14 novembre : seuil de la boîte noire et profileur roulant. Deux
   défauts restent à proposer à Souhib : le démarrage du moteur compte comme
   un gel de 12 à 15 secondes et fait taire la salle cinq minutes, et un
   onglet caché compte comme un gel.
3. Reprendre `experiments/h-mprotect/scripts/trace.py` jusqu'à un saut d'état,
   pour comparer les plages touchées avant et après.
4. Selon le résultat du candidat : porter les retouches du laboratoire sur le
   commit de build 160 (`2eb5f081c8`), maintenant autorisé.

Règles ajoutées par la série 2 : suspendre ou dater les minuteries de la
machine pendant une mesure ; ne pas juger un essai sur une seule des deux
séries d'intervalles ; un essai en priorité haute remet à zéro des anneaux de
la carte, donc ne pas le refaire pendant les heures d'usage.

## Reprise au 12 novembre : audit, instrument et première série

La section du 14 novembre, juste au-dessus, remplace la « Prochaine action »
de celle-ci et précise ce que le préchargement prouve.

Cette section remplace l'ordre de travail du 11 novembre, conservé plus bas
comme historique. L'objectif reste **au moins 40 images de jeu par seconde,
régulières**, avec la stabilité en premier. Le récit complet est dans le
[carnet](carnet-de-bord.md), entrées du 12 novembre.

### Ce qui est installé

Rien n'a changé dans la salle le 12 novembre. Le moteur proposé reste Lichii
`65defb74`, plafonné à 30. Jellyfin, le worker et les sauvegardes n'ont pas été
touchés. Les seuls fichiers du dépôt modifiés ce jour-là sont des documents.

### Ce qui est établi, avec sa force

| Constat | Force | Preuve |
|---|---|---|
| Un transcodage Jellyfin qui incruste des sous-titres PGS fait tomber le jeu de 30 à 13 images par seconde. Tenu à la vitesse de lecture, il coûte encore 25 %. Le décodage et l'encodage matériels seuls ne coûtent presque rien. | Prouvé, moteur seul. Même ordre de grandeur dans la boîte noire du 11 novembre. | `experiments/a-jellyfin/REPORT.md` |
| À cache vide, la première compilation d'un pipeline gèle l'image 0,3 à 0,56 seconde. À cache appris, le même trajet n'a aucun intervalle de plus de 100 ms. | Prouvé par intervention, une zone. | `experiments/b-gels/REPORT.md` |
| Le retour après cinq minutes d'immobilité reconstruit 200 pipelines : 169 ms au plus, mais une seconde perd 350 ms. Le préchargement supprime ces reconstructions. | Reconstructions prouvées. Bénéfice du préchargement : tendance, un lancement long. | idem |
| Les deux modes qui sautent un dessin cassent l'écran titre à cache vide. | Prouvé, 4 lancements sur 4. | idem |
| Le moteur installé est tenu par le fil GPUBack. Ralentir son seul cœur de 33 % coûte 19 à 20 % de débit. | Prouvé. | `experiments/c-bornes/REPORT.md` |
| Aucun réglage de la machine n'atteint 40. Cœur réservé : coût -1,8 à -3,7 %. Horloge de la carte forcée : +1,1 %. Chaleur : 0 à 2 %. Meilleur débit vu : 34,76 (référence privée à demi-résolution). | Prouvé pour l'absence de 40. Réglages non combinés. | idem |
| Pour 40, il faut 19 à 23 % de coût GPUBack en moins par image. Pour 60, 46 à 52 %, et deux autres fils satureraient. | Calcul sur mesures. | idem |

Les rapports sont sous `~/.local/share/nel3ab/nx2-lab/2026-11-12-probe/`.
Chacun finit par les verdicts de deux relecteurs. Quand un verdict affaiblit
une affirmation, c'est le verdict qui fait foi.

### Ce qui n'est pas prouvé

- Aucun de ces essais ne tourne dans une salle complète. Le worker, la capture,
  l'encodage et le navigateur manquent.
- Que les gels ressentis en salle sont des premières compilations. Le cache de
  production est différent, et le lien de Souhib a sa propre gigue.
- L'effet d'un changement de zone après une pause.
- La cause des deux états de la référence privée `13158042`.

### Réponses de Souhib le 12 novembre

1. **Jellyfin.** Il ne veut pas dégrader Jellyfin pour ses utilisateurs. Une
   perte n'est acceptable que si elle est minime et aide vraiment la salle. Le
   remède cherché est donc du côté du moteur : la priorité de sa file Vulkan
   (essai `e-priorite`). Le critère de réussite a deux parts : le jeu tient
   30, et le transcodage reste au moins à la vitesse de lecture. Ne plus
   proposer de couper l'incrustation des sous-titres comme premier remède.
2. **Carte graphique.** Il l'avait déjà mise sur l'emplacement relié au
   processeur : la machine n'avait alors plus de réseau. La cause n'est pas
   établie. Un fait relevé : depuis le 5 octobre, `/etc/netplan/99-lan.yaml`
   reconnaît la carte réseau par son adresse matérielle et non par son nom.
   Si la panne venait d'un changement de nom de l'interface, elle ne se
   reproduirait pas ; ce n'est qu'une hypothèse. Ce déplacement n'est plus
   proposé sans accès physique de secours, et son gain pour ce jeu n'est pas
   mesuré.
3. **Lichii build 160.** Accord donné pour télécharger la version officielle
   et la lancer dans le conteneur privé d'essai.
4. **Refroidissement du processeur.** Pas de réponse : 87 à 97 °C en charge.

### Prochaine action

La série 2, avec l'instrument `nx2probe.py` et les gardes ajoutées après la
série 1 (charge hors moteur par segment, file d'intégration continue, session
pilote muette pendant un passage) :

1. Préchargement : second lancement long, copie du cache de production,
   mémoire après vingt minutes, changement de zone après une pause. Fait le
   12 novembre (essai `d-stabilite`) : le préchargement retire les deux
   accrocs de chaque retour de pause, coûte 0,7 seconde au démarrage et ne
   fait pas grossir la mémoire en vingt minutes. Relecture en cours. La série
   s'est arrêtée là faute de crédits ; elle reprend le 14 novembre dans
   l'ordre `e-priorite`, `f-build160`, `g-marge`.
2. Cœur réservé à GPUBack sous le plafond de 30, réglages combinés, et coût de
   la boîte noire sur ce moteur (essai `g-marge`, lancé à la suite). Corriger
   ensuite le seuil de 50 Hz de la boîte noire pour un jeu plafonné à 30.
3. Priorité de la file Vulkan du moteur face à un autre client de la carte
   (essai `e-priorite`, lancé à la suite).
4. Lichii build 160 officiel comme nouvelle base : coût de GPUBack par image
   contre `65defb74`, gels à cache vide, retour de pause. Il contient les
   correctifs 1334 et 1337 sur l'éviction et la reconstruction, et le 1313 sur
   un gel propre à ce jeu. La garde de sécurité de la session avait refusé
   ce lancement ; Souhib a donné son accord le 12 novembre. À lancer dès que
   la série 2 rend la carte, uniquement dans le conteneur privé.
5. Validation dans une vraie salle de la meilleure configuration de stabilité.

Les règles de la reprise du 11 novembre restent valables : ne rien
réinitialiser, commiter ou envoyer sans demande explicite ; ne pas restaurer
d'anciens fichiers installés ; ne pas arrêter Jellyfin, un autre service ou un
profiler inconnu.

## Reprise au 11 novembre après la pause et la restauration des sauvegardes

L'objectif courant est **au moins 40 images de jeu par seconde, régulières**.
Le titre historique du fichier conserve l'ancien objectif de 60. Les essais
restent en pause à la demande de Souhib ; cette note ne les relance pas.
**Depuis le 12 novembre, l'ordre de travail est celui de la section
précédente.** Ce qui suit reste l'état exact laissé le 11 novembre.
Le carnet raconte les décisions et les pièges. Cette section indique quoi
faire au prochain démarrage, sans devoir relire toute cette histoire.

### Ce qui est installé et ce qui reste privé

| Élément | État vérifié à cette reprise |
|---|---|
| Zelda proposé dans la salle | Lichii `65defb74`, profil installé le 10 novembre, plafond à 30 FPS. Le moteur n'a pas été remplacé pendant les essais suivants. |
| Worker de la salle | Binaire `14752026`, page `ac45f6bc`, correction du menu installée le 11 novembre. Ces versions ne sont pas celles du moteur d'émulation. |
| Progression de Souhib | Quatorze fichiers, profil compris, restaurés après son accord. La partie d'essai sort du dossier actif. La salle est fermée, sans demande de nouvelle partie en attente. |
| Référence privée suivante | `13158042`, candidat mémoire conservé après les essais précédents. Sans les ports 807 et 1095. |
| Candidat privé à comparer | `17ebf0c6`, port isolé du 1329 sur cette référence. Il évite un envoi de commandes devenu inutile. Aucun gain de cadence encore établi. |

Les mesures privées récentes donnent environ 30 à 31 retours de présentation
par seconde sur la vue fixe devant Saria, plafonds relevés à 60. Ce compteur
ne prouve pas des images de jeu uniques reçues par un navigateur. Les 40
constantes restent non atteintes et aucun plafond matériel n'est démontré.
Le retour de Souhib, parfois très fluide puis sujet à des freezes, reste
une observation de partie et non une comparaison contrôlée.

### Le point exact où reprendre

Le 1329 passe les 90 exécutions de corps réels extraits avec dépendances
simulées, la compilation complète, 37 cas natifs ciblés et 1 254 cas natifs
complets. Quatre cas réseau restent ignorés. Son premier salon privé termine
90 secondes : le premier envoi réellement évité est observé, les captures
gardent le checkpoint et l'arrêt est normal. Cette qualification fonctionnelle
ne compte pas les envois évités pendant la phase et ne mesure aucun gain.

**Aucun passage de comparaison 1329 n'est accepté.** Le premier témoin A1
est interrompu après 10,06 secondes par un processus `ffmpeg` extérieur sur
la même carte graphique. Il est exclu et ses 24 sorties sont archivées.
Une nouvelle admission refuse ensuite un autre processus `ffmpeg`, identifié
cette fois dans Jellyfin. Ne pas attribuer rétrospectivement le premier au
même service : son identité avait déjà disparu. Ne pas supposer non plus
que Jellyfin est encore actif à une reprise ultérieure.

La dernière vérification, après la vraie partie et la restauration, retrouve
les **281 entrées figées et leurs permissions identiques**. En revanche,
l'inventaire des données protégées passe de 8 652 à 8 678 fichiers : 26 chemins
supplémentaires, neuf contenus différents, aucun chemin supprimé. Cela demande
une revue des changements autorisés et une nouvelle protection de l'état réel.
**Ne pas restaurer d'anciens fichiers installés pour satisfaire cet inventaire.**
La page et le worker installés ont aussi changé ; leur intégration actuelle
doit être couverte par le prochain banc.

### Ordre de travail recommandé

1. Après une demande de reprise, lire l'arbre de travail et les reçus actuels.
   Une grande partie du chantier est non commitée. Le dernier commit visible
   à cette pause est `25ec487` ; il ne décrit pas à lui seul la machine.
   Ne rien réinitialiser, commiter ou envoyer sans demande explicite.
2. Conserver le banc 1329 précédent et son inventaire d'origine. Préparer une
   nouvelle copie pour le nouvel état protégé et l'intégration de la page.
   Distinguer les fichiers à copier, les chemins courants à relier et les
   preuves historiques à garder à leur adresse d'origine. Un remplacement
   global de chemins avait déjà créé vingt références inexistantes.
   Les données du chargeur, notamment `loader/policy.json`, font partie des entrées.
3. Requalifier cette nouvelle copie avant un jeu : les 22 commandes CPU du
   banc, les trois lancements de contrôle dans la vraie image avec son utilisateur,
   les cinq préparations de salon, les lecteurs de manifeste et les permissions.
   Les empreintes de l'exécutable viennent toutes du même manifeste par passage.
   Les anciens reçus natifs peuvent rester des preuves historiques ; ils ne
   remplacent pas les contrôles du nouveau chemin de lancement.
4. Vérifier l'absence de jeu ou de charge de compilation concurrente, les
   travaux actifs et en attente des dépôts enregistrés par les runners locaux,
   puis les vrais propriétaires de descripteurs GPU. Garder ce contrôle pendant
   la phase. Ne pas arrêter Jellyfin, un autre service ou un profiler inconnu.
   La boîte noire ne se suspend que pour l'essai admis et retrouve son état
   initial dans tous les chemins de sortie.
5. Refaire un essai fonctionnel dans le nouveau banc, puis **A1, B1, A2, B2**, un
   salon à la fois, 90 secondes chacun. A utilise `13158042` ; B utilise
   `17ebf0c6`. Lire les vraies captures avant d'autoriser les entrées : même
   position, caméra et personnage devant Saria. Le reçu préalable vérifie
   l'identité des processus et le budget restant dans la même opération.
6. Garder les mêmes réglages : résolution 1×, limites à 60, vitesse à 100 %,
   horloge invitée inchangée, mot natif `0x1003c`. Conserver deux abonnements
   vidéo et deux abonnements audio bruts, sans décodage local pendant la mesure.
   La sonde GPU reste dormante, sans capture produite ; pas de profilage
   concurrent ni de vérificateur qui remplace le chemin mesuré.
7. Pour chaque passage, contrôler les réglages effectifs, l'exécutable réel et
   les marqueurs. Le premier saut 1329 est requis dans B et absent dans A ; les
   marqueurs 807 et 1095 restent absents. Ce message ne donne pas une fréquence
   d'activation. Attendre l'arrêt dans le conteneur, vérifier la disparition
   de ses processus et manettes, puis décoder et lire les images conservées.
   Ne lancer le passage suivant qu'après cette revue et celle des fichiers protégés.
8. Calculer les deux écarts par paire et les intervalles entre images, en ne
   gardant que les fenêtres complètes dans les bornes réellement enregistrées.
   Un gain moyen avec des écarts de signes opposés ne justifie pas de garder
   le port. Les grandes pauses entre passages et les limites du garde restent
   dans le résultat. Aucune ancienne exception de nettoyage ne se transmet.
9. Si le gain se répète, qualifier ensuite une vraie lecture au navigateur,
   les entrées, le son, la régularité, les déplacements et d'autres zones.
   Observer chaque scène et transition ; des touches envoyées pendant une durée
   fixe ne prouvent pas le même trajet. Si le gain ne se répète pas, écarter
   le 1329 de la prochaine base et passer à une autre hypothèse isolée.

Les lettres A et B ci-dessus désignent les exécutables choisis dans les
manifestes des passages. Dans l'ancien `arm.json`, la valeur de protocole `B`
est commune aux cinq salons pour la réception sans décodage : elle ne choisit
pas l'exécutable. Ne pas la changer pour fabriquer un témoin. Les variables
activées par leur seule présence doivent être absentes pour être désactivées ;
leur donner la valeur zéro ne constitue pas un témoin négatif.

### Pistes après le 1329

Ces priorités sont celles de la pause, pas des promesses de gain. Toute reprise
amont commence par les révisions exactes et la recherche de leurs essais déjà
faits. Une fusion récente ne rend pas un algorithme nouveau.

| Piste | Pourquoi la regarder | Ce qui manque avant de l'essayer en jeu |
|---|---|---|
| 1331, réservations atomiques du processeur émulé | Le head `fd9066fe`, fusion `fd9c0133`, change le rangement mémoire des réservations entre cœurs. Sept patches relus, aucun essai Zelda local correspondant établi. | Vérifier les vraies dispositions et les pointeurs produits par le compilateur du jeu émulé, le dernier cœur, les invalidations entre cœurs et les valeurs de 128 bits. Le verrou vu dans GPUBack n'est pas ce verrou Dynarmic ; aucun budget FPS ne lui est attribué. |
| 1336, listes écrites par le GPU | Le head `24bd2237` contient une voie de calcul indépendante des mesh shaders et une copie des mots à leur place dans le flux. | Ne pas porter les 28 fichiers en bloc. Résoudre les échecs de lecture ignorés et la durée de vie des marqueurs avant une qualification native. La partie dessin demande les mesh shaders désactivés ici. |
| 1336, regroupement des instances | Peut réduire les commandes entre les fils avant et arrière, distinctement des listes de calcul. | Éprouver les vraies files, leur publication, leur vidage, les changements de contexte, l'arrêt et le débordement du compteur. Aucun gain local mesuré et aucun coût déduit des chiffres de l'auteur. |
| 1161, sous-parties à isoler | Certaines fermetures de fonctions, allocations et mises à jour de ressources peuvent mériter une mesure. | La réponse conservée annonce 110 fichiers, en contient seulement 100, dont 14 sans patch. Compléter les sources du head `4b2088a7` avant une revue générale. Le garde évitant certaines lectures sous verrou existe déjà dans notre base. Ne pas importer tout ce paquet. |
| Appelants et propriétaire du verrou chaud | Le profil privé relève `BackLoop`, les copies et `SpinRecursiveMutex`. | Identifier les vrais appelants et l'objet verrouillé. Une feuille résolue ne donne ni son appelant ni le temps économisable ; ne pas refaire l'alignement 807 sous un autre nom. |
| Freezes en vraie partie | Le test de Souhib confirme encore des gels intermittents sur le moteur installé. | Rapprocher les captures de la boîte noire, les journaux de compilation et la chronologie des images, sur les mêmes horloges. Distinguer attente de compilation, attente de présentation, capture et lecture navigateur. Une compilation voisine d'un gel ne prouve pas seule sa cause. |

**Prochain travail CPU concret pour le 1336, seulement si cette piste est retenue.**
La vérification directe de 14 h 16 retrouve le même head `24bd2237` ; douze
fichiers complets sont conservés. Le dossier `diagnostics` est vide : aucun
nouveau programme de contre-exemple n'a été compilé ou exécuté.
L'idée était d'extraire les vrais corps, avec empreintes et dépendances simulées
explicites, puis de tester :

- `ResolveGrid` quand la lecture réussit et quand elle échoue, puis le vrai
  appelant qui continue après cet échec. Exercer aussi un mot déjà remplacé,
  qui ne doit pas être écrasé par la résolution des autres mots.
- Les 64 entrées récentes, les 1 024 copies conservées et les 16 bits d'identifiant
  du marqueur : ancien identifiant 1, remplacement par 65, 1 025 ou 65 537,
  ancien état de lancement gardé après écriture ou suppression de sa mémoire.
- Le repli de `DmaPusher::ReadListWords` vers les mots actuels quand une copie
  ancienne a été évincée. Une lecture qui réussit peut encore rendre la mauvaise
  version ; vérifier la valeur attendue, pas seulement le booléen.

Ce sont des contre-exemples à construire, pas des bugs déjà reproduits en jeu.
Garder leurs jumeaux positifs et leurs échecs attendus distincts d'une erreur
de préparation. Un programme déterministe ne prouvera ni les barrières Vulkan
ni les courses réelles entre fils Linux.

### Conclusions à ne pas perdre

- 807 : +3,00 % puis −1,99 %. 1095 au message séparé : −1,51 % puis +1,19 %.
  Ces ports sont écartés faute de gain répétable. Le même head 1095 avait déjà
  un résultat négatif le 9 novembre. La taille du diagnostic compilé a été
  étudiée, mais son effet FPS n'a pas été isolé.
- 1245 avec 1246 : comparaison du 10 novembre sans gain répétable. Ne pas les
  réintroduire comme dépendance supposée du 1329. Le 1058 avec 1244 possède
  déjà une comparaison du 11 novembre ; relire ce résultat et les manifestes
  de la base avant de repartir de ses premiers bancs interrompus.
- Le placement mémoire de `13158042` montre une avance observée de +5,66 %
  puis +3,96 %, avec une réserve explicite sur le garde global A2 et une longue
  pause. Ce résultat ne transforme pas cette réserve en exception réutilisable.
- Les 93 captures de la sonde GPU incluent des attentes. Les médianes voisines
  de 25 ms ne sont pas une occupation exclusive de la carte ni la preuve d'un
  plafond matériel. Le profil de feuilles de GPUBack ne désigne pas davantage
  le CPU comme seule limite.
- La comparaison de résolution réduite reste incomplète ; ne pas en déduire
  que le rendu est gratuit. Conserver l'affinité installée : la série corrigée
  du 10 novembre pénalise le relâchement des masques dans les deux paires.
  Les précédents essais affectés par un autre client GPU restent exclus.
- Conserver le profil de puissance GPU normal. Les mesh shaders ont provoqué
  une réinitialisation de cette carte ; leur désactivation commune a un coût
  visuel connu. Aucun nouveau test ne doit cacher cette limite ou modifier
  ce facteur en même temps que la performance.

### Où retrouver les preuves et les fichiers de reprise

Les rapports publics sont sous `spikes/switch2-room/` :

| Rapport | Ce qu'il conserve |
|---|---|
| `emptyflush1329-preparation-2026-11-11.json` | Source, compilation, tests natifs, banc et essai fonctionnel du 1329 ; premier A1 exclu. |
| `statewrite1095-coldlog-comparison-2026-11-11.json` et `cachepad807-comparison-2026-11-11.json` | Deux comparaisons terminées sans gain répétable. |
| `uploadhost-comparison-2026-11-11.json` et `uploadhost-postphase-review-2026-11-11.json` | Référence mémoire retenue et portée exacte de la revue A2. |
| `goal40-readtick-comparison-2026-11-11.json` et `command-batching-comparison-2026-11-10.json` | Résultats déjà acquis des ports précédents. |
| `submission-cost-comparison-2026-11-11.json` et `uploadhost-leaf-profile-2026-11-11.json` | Horodatage GPU et profil CPU, avec leurs limites. |
| `cpu-affinity-guarded-2026-11-10.json` | Dernière comparaison d'affinité avec contrôle des clients GPU. |
| `upstream-refresh-1223-2026-11-11.json` | Revue amont bornée, pas une liste des nouveautés futures. |
| `save-recovery-2026-11-11.json` | Restauration des sauvegardes, menu corrigé, contrôles et worker installé. |

Sur cette machine, la racine privée est
`~/.local/share/nel3ab/nx2-lab/2026-11-09-30fps/`. Elle contient :

- `CURRENT-GOAL40.json`, point de reprise court et chemins des preuves ;
- `handoff-20261111/`, copie de l'ancien état de reprise et audit daté, pour
  conserver aussi les anciens champs au lieu de les confondre avec le candidat courant ;
- `emptyflush1329-preparation-20261111/`, reçus CPU, compilation, tests natifs
  et lecture du code produit ; `source-lichii-emptyflush1329-lab/` et
  `build-lichii-emptyflush1329/`, sources et construction indépendantes ;
- `goal40-emptyflush1329-ab-20261111/`, ancien banc à conserver, avec l'essai
  fonctionnel et `archive/A1-interrupted-20261111-1411/` ;
- `upstream-refresh-20261111-122327/`, revue de code précédente, puis
  `upstream-refresh-20261111-141655/`, douze sources épinglées du 1336.

La restauration possède son propre point d'entrée privé :
`~/.local/state/nel3ab/CURRENT-SAVE-RECOVERY.txt`. Les copies et comptes ne
doivent pas être publiés. Aucun fichier privé de cette liste n'est sauvegardé
par un futur commit du dépôt : il faudra les conserver séparément si la
machine doit être déplacée ou réinstallée.

## Historique des essais et du plan initial

**11 novembre : le 1095 au diagnostic séparé ne donne pas de gain répétable.**
Les quatre passages valides donnent 30,938, 30,472, 30,512 et 30,874 retours de
présentation par seconde. Les écarts de −1,51 % puis +1,19 % ne justifient pas
de le garder. Quinze fenêtres complètes couvrent 293,06 des 360,01 secondes
commandées, avec les mêmes réglages, la même scène immobile et les contrôles
globaux propres. La base suivante reste `13158042`, sans 807 ni 1095, pour
qualifier le 1329. Les 40 constantes restent non atteintes ; aucun plafond
matériel ne se déduit de cet essai. Rapport :
`spikes/switch2-room/statewrite1095-coldlog-comparison-2026-11-11.json`.

Le port isolé du 1329 est ensuite préparé sur `13158042`, sans les autres
essais écartés. Les 90 exécutions CPU passent, avec les vraies fonctions de
préparation, de soumission et de clôture des commandes, et des dépendances
explicitement simulées. Le binaire natif `17ebf0c6` compile et son garde est
relu dans les instructions produites. Les commandes, le profil et les
métadonnées de compilation restent identiques à la référence. Les 37 cas natifs
ciblés et les 1 254 cas complets passent, avec quatre cas réseau ignorés.
Le premier salon privé termine ensuite 90 secondes normales : son marqueur
prouve un premier envoi inutile réellement évité, les images gardent le même
emplacement devant Saria et l'arrêt est propre. Les fichiers protégés restent
intacts. La comparaison alternée est figée sur 281 entrées. Le premier témoin
est ensuite interrompu après 10,06 secondes par un accès GPU de `ffmpeg`
extérieur à l'essai. Il reste exclu et archivé, avec un arrêt normal ;
les quatre passages complets restent à faire depuis une graine propre.
Ce contrôle fonctionnel ne mesure aucun gain de cadence et ne compte pas
les envois évités pendant la phase. Rapport :
`spikes/switch2-room/emptyflush1329-preparation-2026-11-11.json`.


**11 novembre : la séparation des champs n'apporte pas de gain répétable.**
Le contrôle fonctionnel du port 807 passe, puis les quatre passages alternés
de 90 secondes donnent 30,191, 31,096, 31,220 et 30,599 retours de présentation
par seconde. Les changements de +3,00 % puis −1,99 % ne justifient pas de garder
ce port dans la base suivante. Les quinze fenêtres complètes couvrent
292,69 secondes des 360,01 commandées, sur le même checkpoint immobile et
avec réception brute sans décodage local. Les quantiles restent par fenêtre.

Les quatre contrôles globaux sont propres, sans exception héritée du précédent
essai mémoire. Les scènes sont lues pour les deux rôles, les arrêts sont normaux
et les 189 entrées figées avec leurs permissions restent identiques. Les caches,
les sauvegardes et le moteur installés ne changent pas. Les services permanents
et l'intervalle de 9 minutes et 10 secondes entre B1 et A2 limitent l'attribution.
Ces retours Vulkan ne prouvent pas des images uniques ou 40 FPS constants.

La prochaine expérience reprend seulement `13158042` et alterne sa sonde
d'horodatage GPU dormante et armée. Elle doit qualifier son coût sur ce binaire
exact avant d'interpréter les commandes mesurées. Cette comparaison est maintenant
terminée : 30,561, 30,954, 30,263 et 30,365 retours par seconde, soit +1,29 %
puis +0,34 %. Aucun ralentissement moyen n'est observé ; cela ne prouve pas
une transparence générale. Les quatorze fenêtres complètes couvrent 275,27
secondes des 360,01 commandées. Les 243 entrées figées restent intactes.

Les passages armés donnent 47 puis 46 captures complètes, avec deux autres
captures conservées hors fenêtre ; les témoins n'en produisent aucune. Les
médianes de l'union des intervalles sont 25,25 puis 25,31 ms. La somme, l'union et
l'enveloppe des intervalles restent distinctes ; aucune n'est une occupation
exclusive de la carte. Ces valeurs instrumentées ne prouvent pas que le CPU
est la seule limite, ou que 40 FPS sont impossibles. Les quatre contrôles globaux
restent propres. Rapports :
`spikes/switch2-room/cachepad807-functional-2026-11-11.json` et
`spikes/switch2-room/cachepad807-comparison-2026-11-11.json`.
Diagnostic : `spikes/switch2-room/submission-cost-comparison-2026-11-11.json`.

La revue directe de GitHub à 10 h 21 UTC trouve ensuite sept nouveaux commits
dans Lichii. Le [1095 intégré](https://github.com/zortos293/Lichii/pull/1095)
supprime des appels autour des écritures ordinaires de registres. Les quatre
fichiers du diff sont lus et le code n'est pas présent dans `13158042` ; il vise
un appel observé du fil arrière. Il devient le prochain port après la
qualification de la sonde, sans gain FPS local promis. Le 1333 corrige une
régression absente de notre base ; le 1336 dépend en partie de mesh shaders
désactivés ici et sa revue reste partielle. Fritchii 5.8.4 et la branche nx2
d'Eglantine n'ont pas changé depuis la revue précédente. Rapport :
`spikes/switch2-room/upstream-refresh-1021-2026-11-11.json`.

La reprise avait manqué le premier essai du même head 1095, terminé le
9 novembre sans gain répétable. Ce résultat décrit plus bas reste valable.
La fusion récente n'est donc pas une nouvelle piste à elle seule. Le seul
nouvel essai proposé compare la base mémoire actuelle et une journalisation
isolée, après le contrôle du code compilé décrit ci-dessous.

Le port isolé du 1095 est maintenant préparé sur `13158042`, avec quatre
fichiers modifiés et un marqueur au premier passage réel dans la nouvelle
branche. Les 46 exécutions de corps extraits et le véritable en-tête du réglage
passent sur CPU, avec des dépendances explicitement simulées. La compilation
complète et les tests natifs passent ensuite pour `37a7fbc0` : 40 exécutions
ciblées, 1 254 cas complets exécutés et quatre cas réseau ignorés. Un contrôle
du code produit montre toutefois que le message au premier passage grossit
`CallMethod` de 270 à 1 551 octets et change son appel final. Une copie indépendante
prépare donc une fonction séparée pour ce seul diagnostic. Le vrai code de
`32d0a6fd` confirme ensuite 349 octets pour l'appel principal et 115 pour le
message séparé, avec le booléen et le saut final conservés. Les 46 contrôles
de corps extraits passent à nouveau, puis les 40 exécutions ciblées et les
1 254 cas de la suite native, avec quatre cas réseau ignorés. La vérification
en jeu et la comparaison restent requises sur cette variante ; aucun gain FPS
n'est encore mesuré. Rapport :
`spikes/switch2-room/statewrite1095-preparation-2026-11-11.json`.

Le premier essai réel de cette variante atteint le checkpoint et écrit le
marqueur. Sa lecture échoue sur la séquence de fin de couleur du journal,
avant toute phase de 90 secondes. L'essai est conservé en échec, avec arrêt
normal et fichiers protégés inchangés. La correction du lecteur demande une
nouvelle copie indépendante du banc ; elle ne change pas le binaire qualifié.

La nouvelle copie passe ses 31 contrôles du lecteur, ses vingt commandes et
ses trois vérifications de lanceur. L'essai fonctionnel suivant termine les
90 secondes, avec marqueur réel et arrêt normal. Les quatre images distinctes
sont lues ; deux paires de rôles sont identiques. Les fichiers protégés et les
279 entrées figées restent intacts. La comparaison est ensuite figée sur
280 entrées ; les quatre passages terminent normalement et leurs images
gardent la même scène. Les deux écarts changent de signe, −1,51 % puis +1,19 %.
Ce port ne devient donc pas la base du prochain essai. La séparation du message
a son effet statique établi, mais son coût FPS n'a pas été comparé isolément.

La revue complémentaire de 12 h 23 désigne le 1329 intégré comme prochaine
qualification après le 1095. Le second envoi qu'il veut éviter est accessible
dans le vrai chemin des points d'attente de `13158042`. Il faudra préserver
les envois explicites, leurs signaux et les commandes encore différées, puis
mesurer combien de ces envois sont réellement redondants. Le 1245 est absent
du planificateur actuel et ne doit pas entrer dans ce port par dépendance
apparente. Aucun gain local n'est établi. La revue du nouveau 1336 reste
partielle, celle du 1161 est limitée par des patches manquants dans la réponse
sauvegardée. Rapport : `spikes/switch2-room/upstream-refresh-1223-2026-11-11.json`.

**11 novembre : le profil qui a motivé l'essai de séparation des champs.**

Le relevé normal du candidat mémoire dure 25,02 secondes, sans échantillon perdu
signalé. Les cycles GPUBack résolus placent `BackLoop` à 11,37 %, les copies
à 7,80 % et l'acquisition de verrou à 5,41 %. Les feuilles ne donnent pas les
appelants ou l'objet verrouillé. Les huit essais CPU avec Chrome réel valident
aussi l'ordre d'arrêt du pilote ; le relevé réel suit cet ordre et son garde
termine proprement.

Les deux alignements du correctif amont 807 ont donné le candidat privé décrit
en tête. Les vrais layouts Clang passent leurs six contrôles et mesurent un coût
de 128 octets par instance. La compilation complète et les tests natifs passent
pour `cfec5c81`. Le contrôle fonctionnel puis la comparaison à `13158042`
sont maintenant terminés. Le gain annoncé sur un autre jeu n'est pas repris pour Zelda.
Rapports : `spikes/switch2-room/uploadhost-leaf-profile-2026-11-11.json` et
`spikes/switch2-room/cachepad807-preparation-2026-11-11.json`.

**11 novembre : le placement mémoire apporte une avance observée, pas 40 constantes.**
Les quatre fenêtres alternées donnent 29,011, 30,654, 29,314 et 30,474 retours
de présentation par seconde, témoin puis candidat. L'avance observée est de
5,66 % puis 3,96 %. Les treize fenêtres complètes couvrent 261,92 secondes des
360,01 commandées. Les deux usages d'envoi activent normalement la nouvelle
politique, sans détail diagnostique pendant ces passages. Les 40 constantes
restent non atteintes ; ces retours Vulkan ne prouvent pas les images uniques
du jeu dans un navigateur.

Le contrôle global A2 reste échoué à cause d'un inventaire du navigateur privé
déjà disparu après la phase. L'audit séparé conserve ce fait et qualifie seulement
la fenêtre chronométrée ; les autres contrôles restent exigés. B2 termine avec
son garde propre. La pause de 21 minutes et 10 secondes entre les deux dernières
fenêtres et les services permanents empêchent d'isoler le gain causal. Les
sources et sauvegardes installées restent intactes. Le profil du coût restant
du candidat et l'ordre de fermeture du navigateur sont maintenant vérifiés,
comme décrit ci-dessus. Rapport :
`spikes/switch2-room/uploadhost-comparison-2026-11-11.json`.

**11 novembre : l'outil mémoire avait justifié le candidat.**
Un outil mémoire séparé termine maintenant quatre passages alternés : 1,792,
6,562, 1,794 et 6,447 Gio/s pour la politique actuelle puis la politique hôte
cachée et cohérente. Les vrais types choisis diffèrent et les lectures GPU des
quatre blocs contrôlés passent avant et après. La suppression du `memcpy`
chronométré, qui restait verte dans le premier outil, échoue après correction
du motif attendu. Les valeurs restent des tendances sur une machine partagée,
sans preuve d'un gain de FPS. Le candidat privé RADV pour les envois CPU compile
maintenant en 179,05 secondes. Ses 18 exécutions CPU, son test natif ciblé et
sa suite native de 1 258 cas passent, dont quatre cas réseau ignorés. Le contrôle
des allocations réelles puis l'alternance en jeu sont maintenant terminés,
avec les limites décrites en tête. Rapport :
`spikes/switch2-room/upload-memory-probe-2026-11-11.json`.

Le troisième profil retrouve maintenant les demandeurs des deux cadres ciblés :
319 échantillons viennent de l'envoi de tampons vers Vulkan, un d'un petit
paramètre graphique. Les retours et les emplacements sources compilés
concordent. Dans 295 observations du premier groupe, le segment demandé fait
64 Kio. Ce ne sont ni des comptes d'appels ni un volume total. La prochaine
expérience qualifie le type de mémoire et le coût de copies dans l'outil séparé
décrit ci-dessus, avant le port maintenant compilé. Le choix actuel préfère
la mémoire du GPU pour le tampon circulaire ; une politique hôte cachée et
cohérente devient un candidat privé à vérifier dans le moteur. Aucun gain FPS n'est
revendiqué. Rapport : `spikes/switch2-room/goal40-upload-callers-2026-11-11.json`.

Un second relevé localise maintenant deux sites de retour dans `ReadBlockUnsafe`,
le lecteur de blocs de mémoire invitée. Ils pèsent 12,00 % des cycles
échantillonnés de GPUBack pendant ses 25,02 secondes, avec 257 échantillons.
Les deux véritables appels à `memcpy` sont vérifiés dans l'exécutable conservé.
Le troisième relevé décrit ci-dessus identifie maintenant leurs demandeurs et
les tailles de segments observées, sans volume total.
Les notifications de carte mémoire rendent ce relevé plus instrumenté que le
précédent ; les pourcentages ne sont pas comparés comme un gain.
Aucun moteur installé n'est remplacé. Rapport :
`spikes/switch2-room/goal40-copy-returns-2026-11-11.json`.

Le profil de la version normale est maintenant relevé pendant 25,02 secondes.
Les symboles des bibliothèques exactes permettent de résoudre presque tous les
cycles échantillonnés des trois fils graphiques. GPUBack en passe 17,96 % dans
des routines de copie mémoire ; il ne collectait aucune pile d'appels.
Le second relevé décrit ci-dessus localise deux sites dominants, sans encore
identifier leurs demandeurs. Aucun gain FPS n'est déduit de ce
pourcentage. Rapport : `spikes/switch2-room/goal40-current-profile-2026-11-11.json`.

Le port complet 1216, avec 974, est préparé sur les sources du candidat précédent.
Quatorze exécutions CPU passent avec les défauts réintroduits. La compilation,
les contre-épreuves natives et le contrôle GPU restent à faire. L'auteur de 974
ne mesure pas de gain FPS sur ses trois vues de Zelda malgré davantage de
dessins réutilisés. Le coût de notre version normale doit donc guider la suite ;
le protocole d'un profil des fonctions exécutées est vérifié sur CPU, puis
appliqué au jeu dans le relevé décrit ci-dessus. Rapport :
`spikes/switch2-room/fastdraw1216-preparation-2026-11-11.json`.

À plafonds 60 et même résolution, les retours de présentation sont de 28,44,
29,01, 27,64 et 28,51 par seconde dans l'ordre témoin, candidat, témoin,
candidat. Les fenêtres complètes couvrent 295,35 secondes des 360,01 commandées.
L'avance observée de 2,0 % puis 3,1 % ne suffit pas pour atteindre 40 constantes
et son signe répété ne prouve pas seul une cause. Le p99 ne baisse pas
uniformément dans la première paire. Les scènes restent identiques et les
quatre nettoyages sont normaux, sans changement installé. Ce sont des retours
Vulkan avec réception brute, pas une qualification des images uniques en jeu
au navigateur. Lichii 1216 reste une piste préparée ; le diagnostic des lectures
mémoire décrit en tête guide maintenant le choix suivant. Rapport :
`spikes/switch2-room/goal40-readtick-comparison-2026-11-11.json`.

**11 novembre : compilation complète et tests natifs CPU réussis.**
Le contrôle fonctionnel en jeu est désormais accepté : 17 685 lectures servies
par le nouveau chemin entre deux relevés internes, copies vérifiées sans
divergence signalée, direction tenue puis relâchée prouvée dans les quatre
manettes et arrêt natif normal. Les 46,46 secondes de ce contrôle incluent les
copies synchrones du vérificateur ; elles ne mesurent pas le coût normal.
La comparaison distincte décrite ci-dessus le suit. Rapport :
`spikes/switch2-room/readtick-functional-2026-11-11.json`.

Les vingt petites unités du port composé 1058 et 1244 donnent les résultats
attendus. Le vrai candidat `c686c1ff` compile ensuite en 525,12 secondes,
avec six unités modifiées reconstruites. Les quinze tests natifs ciblés passent ;
la suite complète recense 1 257 cas, dont quatre ignorés sans réseau, sans échec.
Ces tests n'accèdent pas au GPU. Le contrôle réel décrit ci-dessus les complète.
Les quatre phases alternées à la même résolution sont maintenant terminées.
Le correctif du contrôleur d'entrées passe ses seize cas CPU et confirme
maintenant les relâchements dans une vraie page. La cadence mesurée reste
limitée aux conditions décrites ci-dessus ; aucun moteur installé n'est remplacé.

**Revue amont du 11 novembre.** Les publications Fritchii 5.8 à 5.8.3
viennent de `oot-gather-fix`, bien que sa branche principale soit inchangée.
Les copies de textures fournissent une nouvelle piste source. L'option de
compilation annoncée est déjà présente dans les en-têtes du profil courant.
Les changements de suivi mémoire et de macros doivent encore
prouver leur cohérence. Ils ne remplacent pas la qualification en cours du
candidat 1058 et 1244. Rapport : `spikes/switch2-room/upstream-2026-11-11.json`.

**Reprises fonctionnelles du 11 novembre.** La deuxième salle exerce les
lectures sans divergence dans les résumés, mais son lecteur kernel est refusé.
Le lecteur séparé est ensuite qualifié sur de vraies manettes. Le troisième
chargeur s'arrête avant commande sur un nom v2 recopié dans v3. La quatrième
préparation dérive ce dossier du module réel et teste aussi ses cinq départs
ordinaires avant admission. Elle ne change pas l'émulateur et attend une F1
complète ; aucun gain de FPS n'est retenu. Rapports :
`spikes/switch2-room/readtick-runtime-partial-2026-11-11.json` et
`spikes/switch2-room/readtick-loader-entry-2026-11-11.json`.

Les quatrième et cinquième départs retrouvent ensuite une autre dépendance :
déplacer les chemins dans le fichier de configuration change son empreinte.
Le constructeur, puis le lecteur des réglages, gardaient une valeur littérale.
Les deux départs sont exclus avant la phase. La sixième préparation prend ces
identités dans le paquet sélectionné et doit repasser les cinq lecteurs complets
sur les fichiers actuels avant tout nouvel essai. Rapport :
`spikes/switch2-room/readtick-config-identity-2026-11-11.json`.

**Premier lancement réel, sans phase mesurée.** Le candidat charge le
checkpoint observé et active son nouveau traitement de lectures. Les contrôles
natifs comparent 141 champs. Le banc s'arrête ensuite : un auxiliaire de test
manque et F1 démarre le garde de B1. Les contrôles CPU n'exerçaient pas ces
appels ultérieurs. L'arrêt natif est normal ; l'audit manuel retrouve les
ressources privées disparues et les 8 652 fichiers installés identiques.
Cette première préparation reste incomplète. La suivante doit attendre la
confirmation réelle du garde avant le worker et exercer les dépendances appelées.
Aucune cadence ni qualification fonctionnelle complète n'est retenue. Rapport :
`spikes/switch2-room/readtick-runtime-bootstrap-2026-11-11.json`.

**Objectif actif actualisé le 10 novembre au soir : au moins 40 images/s constantes.**
Le titre de ce plan conserve son origine ; l'objectif courant est celui demandé
par Souhib, avec une vitesse du jeu normale et sans compter des images générées
comme des images calculées par le jeu. Les anciens essais à plafond 30 restent
historiques. Un passage privé relève les deux plafonds à 60, garde l'horloge
invitée à 60 Hz et la vitesse à 100 %, puis vérifie le mot natif `0x1003c`.
Il donne 29,37 retours Vulkan/s sur 61,30 secondes de fenêtres complètes ;
90 secondes sont commandées, avec maximum 52,12 ms dans les fenêtres retenues.
Ce passage unique ne démontre pas de limite matérielle.

La comparaison suivante alterne résolution interne 0,5 et 1. Ses deux premiers
préparatifs sont conservés comme incomplets : des lecteurs de candidat puis
de politique communs arrêtent les témoins avant mesure. Le premier test du
lecteur omettait la politique. La troisième préparation passe les quatre
amorçages et le `gather` complet avec doubles CPU explicites, puis retire les
fichiers natifs communs. Ses 201 entrées sont gelées. Le vrai premier passage
termine normalement, à 27,91 retours/s sur 64,50 secondes retenues, maximum
68,11 ms. Sa cible tonemappée est réellement réduite à 1 280 × 720, décodée
après la mesure ; l'image devient moins nette. Le témoin normal passe ses contrôles, puis une salle installée apparaît
pendant sa phase, vers la 69e seconde. Le garde arrête notre essai ; B1 est
exclu et A2/B2 ne démarrent pas. L'arrêt natif privé est normal et tous ses PID
observés disparaissent, mais le contrôleur ne confirme pas sa neutralisation.
Aucune comparaison ni installation n'est retenue.
Les propositions 1058 et 1244 composées sur huit fichiers donnent maintenant
le candidat compilé décrit ci-dessus. Son accès de diagnostic lit les compteurs
avec des bornes monotones, sans accès GPU. Les 40 constantes restent non
atteintes et aucune impossibilité matérielle n'est démontrée. Rapports :
`spikes/switch2-room/goal40-uncapped-2026-11-10.json`,
`spikes/switch2-room/goal40-resolution-restart-2026-11-10.json` et
`spikes/switch2-room/readtick-preparation-2026-11-10.json`.

**Reprise du 10 novembre après la partie de Souhib.** Le profil Zelda installé
rend le jeu nettement plus fluide selon son retour, avec des freezes fréquents
en déplacement. Le journal de sa session contient un intervalle Vulkan de
1,565 seconde et des attentes de compilation. Les scènes ne sont pas capturées
et un travail extérieur occupe aussi la machine : aucune fréquence de freezes
en marche ni cause unique n'est déduite de ces comptes.

Une sonde limitée aux soumissions existantes est maintenant portée sur une
copie exacte des sources de `65defb74`, avec ses correctifs locaux. Le nouveau
binaire privé `be3c43fb` passe la compilation complète et les tests CPU.
Elle n'active pas la trace DKB ni ses chronométrages par dessin. Le stockage
borné rejette les captures incomplètes ; la lecture et la réutilisation
attendent la fermeture CPU et le tick GPU terminé. La destruction attend
aussi les dernières commandes soumises, seulement à l'arrêt.
Des doubles CPU compilent le vrai fichier et refusent quatre mutations des
contrôles de lecture et de disponibilité. Ils ne prouvent pas le comportement
du pilote réel. Le lancement
reste refusé en présence d'un client GPU extérieur, avant le jeu.
Il faut encore observer l'activation, les résultats complets et l'arrêt
normal, puis alterner l'activation pour mesurer le coût de la sonde.
Ses intervalles peuvent se recouvrir ; leur somme ou leur enveloppe ne
donneront pas un compteur exclusif d'occupation du GPU. Le candidat n'est
pas installé et aucun gain de performance n'est mesuré. Rapport :
`spikes/switch2-room/submission-gpu-65def-2026-11-10.json`.


**Complément après 19 heures.** La reprise de la conversation retrouve l'essai
fonctionnel terminé : le bon binaire et ses 141 réglages sont vérifiés,
sept des neuf captures GPU sont entièrement dans les 15 secondes de phase,
et l'arrêt natif est normal. Les images reçues montrent Link près de Saria.
Ce résultat qualifie le fonctionnement, pas le coût de la sonde ni les 30
régulières. Rapport :
`spikes/switch2-room/submission-gpu-runtime-2026-11-10.json`.
Un premier témoin de 90 secondes termine normalement mais fait tourner
la caméra ; aucune comparaison de coût ne lui est attribuée. La calibration
suivante alterne quatre vues fixes. Son témoin conserve la sonde manuelle
chargée, sans demande d'enregistrement : seul le coût d'activation est comparé.


**Calibration terminée après la reprise.** Quatre phases fixes alternent la
sonde désarmée et active. Les quatorze fenêtres complètes couvrent
292,35 des 360,01 secondes. Leurs débits sont 28,92 / 28,51 / 28,54 / 28,98
retours Vulkan/s, avec des maxima de 49,28 à 55,88 ms. L'effet d'activation
change de signe : −1,40 %, puis +1,52 %. Son coût reste indiscernable de la
variation observée ; aucune transparence n'est certifiée. Les vues conservent
la même caméra. Les deux passages actifs donnent 87 captures entièrement
dans leurs phases ; trois autres sont exclues. Les témoins n'en produisent
aucune. L'union médiane de leurs intervalles vaut 22,25 puis 19,92 ms,
et leur enveloppe 38,63 puis 30,53 ms. Ce ne sont pas des budgets exclusifs
d'occupation GPU. Aucun client GPU extérieur n'est observé ; les quatre
arrêts sont normaux et les 757 fichiers protégés restent identiques.
Les 30 régulières restent non atteintes, même sur cette vue fixe.
La suite essaie en privé le réglage existant `FENCE_FLUSH_US=2000`, contre
500, pour examiner le regroupement des soumissions. Aucune attente de
synchronisation n'est retirée et aucun moteur n'est installé.
Rapport : `spikes/switch2-room/submission-gpu-calibration-2026-11-10.json`.


**Revue amont du soir et nouveau candidat privé.** Dix-neuf commits Lichii
supplémentaires sont examinés jusqu'à `879b616b`. Fritchii 5.7, Superbuild v50
et Orchid 0.9.4 sont aussi publiés ; leurs promesses ne valent pas mesure sur
notre Zelda. Les correctifs ciblés Lichii 1245 et 1246 sont repris dans une
copie indépendante : regroupement de copies sans dépendance et barrière
conservée dans la commande de calcul. Le binaire privé `d7df6092` compile,
avec 1 251 tests natifs réussis, quatre cas réseau ignorés et douze mutants
CPU détectés. Les copies sous Vulkan logiciel rendent les bons octets,
mais un témoin de barrière retirée n'est pas détecté : aucune qualification
complète de synchronisation n'est revendiquée. Un essai privé termine ensuite quinze secondes de déplacements avec les deux
regroupements sélectionnés et un arrêt normal. La comparaison alternée sur
vue fixe termine ensuite sans gain répété, horodatages GPU désarmés dans les
deux conditions. Le profil installé reste inchangé.
La préparation du code CPU de la proposition 1225 reçoit ensuite un port
source privé, mais ses tests de cohérence refusent sa qualification en jeu.
Aucun gain de ce candidat n'est mesuré ici. Rapport :
`spikes/switch2-room/upstream-evening-review-2026-11-10.json`.


**Comparaison terminée du nouveau regroupement.** Les quatre phases fixes
alternées de 90 secondes terminent normalement, avec la même sauvegarde,
le même cache, les 141 réglages et les marqueurs attendus. Les débits des
fenêtres retenues sont 28,34 / 29,03 / 28,88 / 27,97 retours Vulkan/s.
Activer les deux correctifs donne +2,43 %, puis −3,14 %. Aucun gain répété
n'est retenu. Les p99 de fenêtre restent entre 42,09 et 46,53 ms, avec des
maxima de 50,35 à 55,30 ms. Les quatorze fenêtres couvrent 294,29 des
360,01 secondes ; aucun intervalle retenu ne dépasse 100 ms. Cette couverture
partielle et cette vue fixe ne qualifient ni les nouveaux lieux ni les
déplacements. Le port reste privé et le moteur installé n'est pas remplacé.
Les 30 régulières restent non atteintes. Rapport :
`spikes/switch2-room/command-batching-comparison-2026-11-10.json`.

**Préparation CPU non qualifiée pour le jeu.** La proposition Lichii 1225 est
appliquée à une copie indépendante, sans compilation complète ni lancement.
Les corps exacts testés avec des doubles CPU reproduisent une invalidation
perdue du cache de page : une instruction ancienne revient après consommation
de l'invalidation JIT dans le double. Ce mécanisme est préexistant ; le
préchauffage ajoute des lecteurs spéculatifs. Aucun verrou commun n'est trouvé
dans les appelants examinés, et aucune occurrence dans Zelda n'est démontrée.
Un second cas reproduit un dépassement évitable du budget entre groupes de
64 blocs. Ses 64 ms pour une tranche de 2 ms viennent d'une horloge synthétique,
pas d'une mesure du serveur. Les deux originaux échouent, leurs jumeaux corrigés
passent et réintroduire les originaux fait échouer les tests à nouveau.
Ces jumeaux ne qualifient pas un correctif de production. Le candidat reste
privé, sans gain ni plafond matériel démontré. La cohérence du cache et les
tests du vrai compilateur sont requis avant un essai en jeu. Rapport :
`spikes/switch2-room/jit-warmup-review-2026-11-10.json`.


Précision du 10 novembre à 18 h 55 UTC : Jellyfin reste démarré, mais son
transcodage est terminé et aucun client GPU n'est retrouvé. Hors jeu,
21 relevés espacés d'une seconde donnent une activité GPU et mémoire nulle.
Le contrôle des clients protège les comparaisons contre une charge inconnue ;
il ne mesure pas une saturation et n'impose pas d'arrêter Jellyfin pour jouer
ou vérifier le fonctionnement. Les diagnostics sous charge partagée restent
possibles avec cette limite explicite. Aucun essai en jeu n'est lancé pendant
ce contrôle ; le coût propre de Jellyfin n'est pas mesuré.

La séparation de la lecture locale a aussi été essayée, sans changer le moteur installé.
La variante conserve deux flux vidéo, deux flux sonores et les commandes,
mais retire le décodage vidéo et la lecture sonore du jeu dans les deux pages.
Les identités des processus de capture, d'encodage et de lecture du son natif
restent identiques. Un essai fonctionnel de 15 secondes passe, puis deux
passages de 90 secondes terminent. Chromium consomme environ 1,43 puis
0,56 processeur logique. Les fenêtres complètes relèvent 25,51 puis
28,79 retours Vulkan/s, avec des p99 de fenêtre encore supérieurs à 46 ms.
Les 30 régulières ne sont donc pas atteintes dans le passage léger observé.
La caméra tourne différemment : aucun pourcentage causal de gain n'est déduit.
La série alternée reste incomplète. Une tâche de CI reporte le troisième
lancement, puis un client GPU extérieur interrompt sa préparation. Des clients
Jellyfin sont ensuite identifiés sur le même GPU. Aucun de ces travaux
extérieurs n'est arrêté. Le quatrième passage ne démarre pas.
Le prochain essai doit repartir de copies propres quand ce GPU est libre,
avec des vues mieux appariées ou une portée explicitement exploratoire.
Le temps physique du GPU reste à mesurer séparément sur le moteur exact.
Rapport : `spikes/switch2-room/local-media-work-2026-11-10.json`.

La dernière comparaison complète reprend quatre phases neuves après la fin des
transcodages extérieurs. Aucun client GPU extérieur n'est relevé par les
contrôles de lancement et de session. Le témoin conserve les contraintes
de placement CPU ; la variante les libère après initialisation. Les retours
Vulkan donnent 27,37 / 22,70 / 24,87 / 22,83 par seconde. Les couples font
−17,06 %, puis −8,20 % avec la variante, et leurs maxima empirent. Le placement
installé est donc conservé pour la suite. Les p99 de fenêtre restent entre
46,33 et 62,04 ms : les 30 régulières ne sont pas atteintes. Les dix fenêtres
complètes couvrent 243,59 secondes sur 360,01 secondes ; aucun intervalle n'y
dépasse 100 ms. La couverture partielle, la caméra variable et la surveillance
périodique restent des limites. Les décodeurs locaux prennent environ 1,21
à 1,36 processeur logique. Leur charge et le temps physique du GPU restent
les deux prochains coûts à distinguer, en conservant capture, encodage,
commandes et vérification des paquets reçus. Rapport :
`spikes/switch2-room/cpu-affinity-guarded-2026-11-10.json`.

La séparation des sauvegardes est installée pour les quatre consoles. Zelda
retrouve la progression du compte par « reprendre ». « Partie neuve » crée
maintenant un nouveau départ personnel. (Le 22 novembre 2026, ces deux choix
ont pris les noms « ma sauvegarde » et « nouvelle partie » ; seul à jouer, le
choix lance le jeu sans panneau de préparation.) Le pilote privé devra donc conserver
explicitement sa propre progression et vérifier sa scène après ce changement.
La demi-série ancienne reste exclue. Une nouvelle comparaison complète part du
cache appris pendant cette partie, puis prépare la variante depuis cette copie
exacte. Les quatre passages alternés de 90 secondes terminent normalement.
Leurs fenêtres complètes donnent 28,51 / 29,17 / 29,48 / 28,27 retours Vulkan/s.
Les deux couples changent de signe : +2,32 %, puis −4,09 %. Aucun gain répété
n'est retenu et aucun cache privé préchauffé n'est installé. Les p99 de fenêtre
restent entre 40,02 et 50,50 ms. Aucun intervalle ne dépasse 100 ms dans les
fenêtres retenues, dont la couverture vaut 61,06 à 84,18 secondes par passage.
Ces comptes ne couvrent ni toutes les 90 secondes ni les nouveaux décors.
Les positions et la caméra dérivent légèrement au démarrage ; les deux clients
vidéo locaux consomment aussi environ 1,6 processeur logique. Aucune limite
matérielle n'est déduite de cet essai.

Les rares constructions lentes relevées se situent environ 35 à 48 secondes
avant les phases. Elles n'expliquent donc pas, à elles seules, l'irrégularité
observée en terrain déjà chargé. Un diagnostic CPU distinct conserve ensuite
6 009 échantillons dans 24,12 secondes de déplacement. Le fil graphique avant
passe environ 38,78 % de ses cycles échantillonnés dans `GpuSplit::Drain`,
qui attend l'avancement du fil arrière. C'est 4,39 % des cycles de tout
l'émulateur, sans équivalence directe en temps d'image récupérable. Le fil
arrière utilise environ 75 % d'un processeur logique ; ses fonctions de
traitement, de liaison et de verrouillage se partagent le travail observé.
Ses 15,19 % de cycles dans des instructions inconnues de la bibliothèque
système restent inconnus. Les piles d'appels sont trop incomplètes pour
reconstruire tout le chemin critique. Le temps physique du GPU reste à mesurer
sur ce moteur exact ; la sonde nommée `GPU_PROFILE` mesure des zones CPU.

Le serveur a six cœurs physiques et douze processeurs logiques. Les deux
décodeurs du banc tournent aussi sur lui, contrairement aux navigateurs des
joueurs distants. Leur effet causal demande des passages alternés où seuls
ces décodeurs changent, avec capture, encodage et commandes conservés et vérifiés.
Le diagnostic instrumenté ne sert pas de comparaison de cadence. Il ne prouve
ni une limite matérielle ni un gain de performance.

Pour les freezes de nouveaux passages, une autre piste
reste ouverte : `EDEN_NX2_PRELOAD_ALL_PIPELINES=1` existe dans le moteur exact.
Le code précharge les objets enregistrés et suspend leur éviction tardive,
alors que le précache temporaire testé ne remplit que le cache du pilote.
Les quatre journaux signalent 783 programmes ignorés au départ, dont 64 admis
en préparation de fond. Un premier contrôle privé de l'option met ensuite
2 525 programmes en préparation, contre 1 742 dans les témoins, sans le message
des 783 programmes écartés au départ. Le même binaire et les mêmes 141 réglages
terminent 90 secondes de déplacements, avec commandes et signal sonore reçu.
Le relevé atteint 11,63 Gio de mémoire résidente pour le processus entier,
sans mesurer son augmentation par rapport à un témoin. La mise en préparation
ne prouve pas la réussite de chaque construction. Ce passage unique ne compare
pas la fréquence des gels. Il reste à alterner des trajets nouveaux puis
revisités et à mesurer la mémoire des deux variantes. L'option n'est pas
activée en production et son gain reste inconnu.

Le trajet exploratoire suivant atteint un intérieur puis revient dehors.
Une fenêtre native relève un intervalle de 470,41 ms, avec un compteur
d'attente cumulée de 430,6 ms sur environ 60,21 secondes. Les pauses, le message
de récupération d'un cœur et les contacts avec le décor interdisent de
présenter ce passage comme une marche continue mesurée. Le compteur écrit
« dernières 10 secondes » mais ne se publie qu'à la prochaine construction ;
ses vraies bornes comptent davantage que son libellé. Les évictions commencent
après ce gel et ne l'expliquent donc pas.

Un lecteur CPU utilisant les tailles et l'empreinte de clé du code C++ exact
parcourt ensuite tous les enregistrements des deux fichiers. Les cinq clés
de constructions lentes sont absentes des 2 352 clés graphiques initiales,
puis présentes dans les 2 358 clés finales. Les 173 clés de calcul ne changent
pas. Le cache initial ne permet donc pas de précharger directement ces cinq
nouveaux dessins. Cela laisse ouverte une influence indirecte des tâches de
fond et la question des retraits après plusieurs minutes.

La comparaison suivante part du cache réellement appris sur ce trajet,
qui garde ces nouvelles clés dans sa liste récente, contre le cache initial.
Le démarrage confirme 1 748 travaux mis en préparation, contre 1 742 auparavant,
avec les mêmes 141 réglages et `PRELOAD_ALL_PIPELINES` absent. Les images
invalident toutefois la première paire : le témoin entre dans la pièce,
la variante reste près de sa porte. Les phases restantes sont arrêtées ;
aucun gain ne peut être déduit de ces scènes différentes. La reprise devra
observer chaque étape du trajet, au lieu de supposer que des durées de touches
identiques donnent le même passage. Ce cache de 4 867 fichiers reste privé.
Son supplément d'environ 405 Kio est une taille sur disque, pas une mesure
de mémoire vive ni un gain de vitesse. Le diagnostic des décodeurs locaux et
le temps physique du GPU restent nécessaires pour la cadence en terrain chargé.

Une autre série de quatre phases teste ensuite les contraintes de placement CPU.
Les deux fils graphiques et les six fils du jeu sont soit laissés sur leurs
groupes de cœurs, soit autorisés sur les douze processeurs logiques après
initialisation. Les masques Linux sont contrôlés au départ et à la fin.
Le cache appris, le moteur et les réglages restent identiques. Les quatre
phases de 90 secondes ciblent Saria avec de petits déplacements latéraux.
Les fenêtres complètes donnent 13,18 / 15,39 / 19,17 / 16,12 retours Vulkan/s,
et les couples changent de signe : +16,76 %, puis −15,91 %. Les p99 de fenêtre
restent entre 105,18 et 120,98 ms. Ces observations ne qualifient toutefois
aucun réglage : un audit ultérieur retrouve Jellyfin sur le même GPU pendant
les quatre phases et dans leurs six fenêtres complètes. Le contrôle de charge
ne surveillait que les compilateurs, profileurs et émulateurs. La conclusion
sur les contraintes CPU est retirée ; le profil installé est conservé faute
de mesure isolée. Le flou visible, la caméra différente et le débit sous cette
charge ne prouvent pas le coût propre de la scène ni une limite matérielle.

La reprise utilise un contrôle des vrais descripteurs GPU, avant lancement
et pendant chaque session. Les seuls clients admis sont ceux du pilote privé,
de ses descendants et de ses conteneurs, avec leur identité de processus
complète. La lecture périodique consulte les métadonnées et l'identité PCI,
sans demander les compteurs détaillés de mémoire au pilote graphique.
Son test réel refuse le transcodage en cours avant de lancer le jeu.
Les vérifications de fichiers simulées passent aussi dans les quatre pilotes.
Une activité créée et terminée entre deux lectures reste une limite du contrôle.
Le transcodage extérieur doit terminer avant la prochaine comparaison ; il
n'est pas interrompu. L'effet propre du contrôle sur une partie reste à mesurer.

Les échantillons du service relèvent des temps longs entre demandes du jeu,
alors que l'appel de présentation, son attente de clôture et son délai de
cadence restent courts. Il faut maintenant distinguer ce qui précède cet
appel : travail CPU, synchronisation ailleurs et exécution physique du GPU.
Une mesure par programme devra annoncer les identités observées et celles
réellement chronométrées, puis contrôler son propre coût. Les sondes CPU
existantes ne donnent pas ce temps physique. La charge des deux décodeurs
locaux reste une autre expérience à isoler.

Le réglage `FRAMES_AHEAD=2` est écarté avant essai : le code exact ne reconnaît
que la valeur commençant par `1`, et traite toute autre valeur explicite
comme zéro. Il ne permet donc pas deux images d'avance. La valeur installée
reste `1`. Libérer les masques après démarrage ne qualifie pas non plus tous
les effets possibles de `pin_gpu_threads=false` pendant l'initialisation.

Preuves : `spikes/switch2-room/current-cache-comparison-2026-11-10.json` et
`spikes/switch2-room/saves-accounts-and-freezes-2026-11-10.json` et
`spikes/switch2-room/hot-cpu-profile-2026-11-10.json` et
`spikes/switch2-room/preload-all-activation-2026-11-10.json` et
`spikes/switch2-room/route-cache-coverage-2026-11-10.json` et
`spikes/switch2-room/cpu-affinity-comparison-2026-11-10.json` et
`spikes/switch2-room/external-gpu-interference-2026-11-10.json`.

La revue amont du 10 novembre retrouve trois changements Lichii depuis la
dernière lecture : signe du décodage audio, remplacement de textures de copies
endommagées et proposition de réglages par l'interface Qt. Le premier est un
correctif sonore ciblé, le deuxième modifie les textures présentées au jeu et
le troisième ne s'applique pas automatiquement au lanceur sans interface.
Aucun ne justifie un changement général de moteur pour les freezes. Les
branches `nx2` d'Eglantine et Fritchii conservent leurs révisions déjà étudiées.

Une lecture ultérieure atteint Lichii `093e264c` et trouve quatre nouveaux
changements. Les correctifs de compilation MSVC et macOS n'apportent pas de
gain Linux. La protection du budget de mémoire engagée vise Windows ; son
appel système ne fournit pas de valeur sous Linux. Le retrait des alias GPU
après destruction de leur mémoire est un candidat de stabilité à qualifier
séparément, sans gain de cadence promis. Aucun rebase n'est installé.

Une autre piste de développement vient des
[bibliothèques de pipelines Vulkan](https://docs.vulkan.org/features/latest/features/proposals/VK_EXT_graphics_pipeline_library.html),
de [DXVK](https://github.com/doitsujin/dxvk/blob/2231570b2fffff759239f7c2f2ca41a2232db99e/src/dxvk/dxvk_graphics.cpp)
et du [modèle d'ANGLE](https://chromium.googlesource.com/angle/angle/+/refs/heads/main/src/libANGLE/renderer/vulkan/doc/PipelineCreation.md).
Elles préparent des parties réutilisables puis optimisent le résultat en fond.
Ce n'est pas une option déjà branchée dans le chemin Lichii inspecté.
Cinq des six nouvelles clés du trajet partagent une combinaison de programmes
invités avec le fichier initial, mais aucune ne garde exactement le même
environnement sérialisé. Le fragment du programme `4fa74d7d2eb5df96` est même
absent du fichier initial. Les seules empreintes invitées ne suffisent donc
pas comme clé de réutilisation côté hôte. Il faut vérifier les capacités du
pilote exact, les paramètres de traduction, le coût d'exécution provisoire
et la durée de vie des anciennes pipelines avant tout prototype joué.
Rapport : `spikes/switch2-room/pipeline-reuse-review-2026-11-10.json`.

Point courant du 9 novembre : la référence privée avec maillages par calcul
mesure 29,52 présentations/s sur ses passages de caméra. Le port #1095
donne 29,81, mais ses deux couples ne se répètent pas : aucun gain stable
n'est retenu. Les maxima dépassent encore le budget de 30 images/s.
L'ancien résultat à 30,64 utilisait `NO_MESH=1` et reste une autre condition.
Les étapes de cette reprise sont conservées dans
[l'objectif du 9 novembre](#objectif-du-9-novembre-30-imagess-regulieres).
Désactiver Max Resolution donne ensuite 30,09 contre 29,51 sur une autre
série instrumentée, mais l'écart ne se répète pas et environ un tiers des
intervalles dépasse 33,3 ms. L'option « No sharpening » atteint ensuite
32,06 contre 29,73, avec un avantage dans les deux couples. Elle reste
candidate privée avec compromis visuel : 23,21 % des intervalles dépassent
encore 33,3 ms et un gel dépasse 100 ms. Le plafond de présentation atteint ensuite 29,956
présentations/s mais laisse les p99 entre 44,22 et 47,62 ms. La sonde HostTiming globale relève ensuite des p99 de réveil sous0,34ms,
sans qualifier la reprise du fil invité. Le travail en cours vise la
présentation du service et la sortie Vulkan, puis un véritable trajet au sol.
La confirmation du 10 novembre sur quatre nouvelles phases alternées retient
le plafond natif Vulkan à 30 pour la qualification suivante : ses p99 de
fenêtre sont de 33,58 à 36,30 ms contre 46,06 à 48,00 ms en automatique,
avec un maximum encore à 43,52 ms. Le débit moyen reste voisin de 30 dans
les deux cas. C'est un gain de régularité des retours Vulkan sur la caméra,
sans preuve de calcul plus rapide, de marche fluide ou d'affichage physique.
Même ce passage limité demande encore environ un doublement
du débit pour atteindre 60.

État historique après trois prototypes du 8 novembre : aucun ne débloque 30 ou 60 images/s.
L'attente par notification économise du CPU sans accélérer le jeu ; la lecture
des arguments donne un écart observé de +1,7 %. Le troisième prototype de
parcours mémoire donne **22,37 contre 21,34 images/s**, soit **−4,61 %** :
il reste écarté de l'installation. La reprise suivante ajoute une sonde GPU par lots : elle réduit le nombre de
requêtes et donne des durées exploitables pour orienter le travail, avec un
coût observé de −2,74 % sur les FPS. Elle ne certifie donc pas un budget
matériel sans perturbation.

## Ce que signifie atteindre 60

La référence des sept passages alternés donne **20,64 images/s**, soit
**48,44 ms par image** en moyenne. À 60 images/s, le budget est **16,67 ms**.
Il faudrait multiplier le débit par **2,91**, ou enlever environ **65,6 %** du
temps actuel par image, soit environ **31,8 ms à enlever**. Même le précédent
meilleur résultat PGO à 23,96 images/s reste à un facteur 2,50 de 60, dans
une autre série de conditions. Les mesures concernent une caméra mobile sur le balcon
de Kokiri, avec des caches déjà utilisés. Elles ne décrivent pas toutes les
zones ni les chargements rencontrés en jouant.

Les 60 images doivent être calculées par le jeu, avec le monde complet,
la vitesse de déplacement correcte et le son synchronisé. La génération
d'images intermédiaires reste désactivée. Le rafraîchissement à 120 Hz du
compositeur ne compte pas comme 120 images calculées par le jeu. Une
présentation du jeu ne prouve pas non plus à elle seule que son contenu a changé.

Le journal de référence indique `swap interval 1 at 60 Hz`, mot `0x1003c`.
Le code `PaceToVblank` de cette révision interprète ce mot comme une image
par rafraîchissement. **Aucun plafond à 30 images/s n'est observé dans ce
passage.** Il faut encore vérifier ce mot dans les autres scènes et comparer
la vitesse du jeu à une référence. Forcer un intervalle ou la vitesse de
l'émulation peut accélérer le jeu plutôt que rendre son exécution plus efficace.

La validation finale proposée est une partie de dix minutes incluant caméra,
marche, combat, changement de zone et sauvegarde puis reprise. Dix minutes
servent à dépasser les courts passages déjà essayés et à éprouver les caches
et la température ; ce n'est pas une preuve pour tout le jeu. Le rapport
donnera la cadence par passage, les intervalles des images, le nombre de gels
de plus de 100 ms et leur durée maximale. Le seuil de 100 ms reste celui
du journal existant, environ six budgets d'image à 60 Hz. Une moyenne à 60
avec de longs gels ne sera pas qualifiée de fluide.

Le journal actuel donne une moyenne par 600 présentations, leur maximum
et le nombre de gels. Il ne permet pas de calculer les percentiles des
images individuelles. Avant de certifier une fluidité à 60, ajouter un
relevé léger des intervalles par image, puis publier leur médiane, leur
99e percentile et leur maximum. Le 99e percentile indique la limite sous
laquelle restent 99 % des intervalles ; il rend visibles des lenteurs
que la moyenne peut cacher. Vérifier séparément le coût de ce relevé en
alternant son activation. La comparaison de vitesse ne doit pas hériter
d'un profileur lourd laissé en marche.

## Obstacles connus et questions ouvertes

| Priorité | Observation ou inconnue | Cause possible | Expérience qui tranche | Correction envisageable |
|---|---|---|---|---|
| 1 | CPU à environ 96 °C pendant les anciens essais | Refroidissement insuffisant limitant le maintien des fréquences | Relever température et fréquence effective sous la même charge, puis recommencer après contrôle du refroidissement | Dépoussiérage, fixation du refroidisseur, pâte et ventilation si le contrôle physique révèle un défaut ; aucun gain chiffré avant comparaison |
| 2 | En mode 2, le fil avant attend activement pendant 56 % de son temps et consomme 93 % d'un processeur logique | La coordination utilise du CPU sans faire avancer la préparation graphique | Remplacer l'attente par une notification, tester les réveils, puis alterner les deux binaires compilés avec les mêmes options | Laisser dormir le fil jusqu'à une progression réelle ; conserver les dépendances de commandes et la fin des soumissions |
| 3 | Le mode 0 occupe environ 94 % d'un processeur logique pour la préparation graphique | Traduction des méthodes, macros ou préparation des tampons trop coûteuses et trop séquentielles | Profil avec symboles, dans une phase distincte des mesures de FPS ; compter les appels et leur coût CPU | Réutiliser un état ou une liaison inchangés, regrouper des traitements, éliminer des recherches répétées si les invalidations restent correctes |
| 4 | La durée réelle du travail sur le GPU reste inconnue | Certains programmes graphiques, copies ou synchronisations saturent la carte | Alterner 1× et 0,5× sur la même scène ; si nécessaire, ajouter des horodatages GPU par catégorie de travail | Réduire les passes et copies inutiles, améliorer la traduction des programmes identifiés ; baisser la résolution seulement comme compromis visuel mesuré |
| 5 | Les premières visites de zones saccadent davantage selon le retour de partie | Compilation, création de pipelines, transferts de textures, décompression ou lecture disque | Répéter exactement le même parcours avec caches privés froids puis chauds, compter les créations et corréler chaque gel | Préparation en avance, conservation des caches et travaux asynchrones avec un état stable ; traiter d'abord l'opération réellement observée |
| 6 | `NO_MESH=1` évite un chemin ayant redémarré le GPU, mais omet des objets | Défaut de traduction ou d'exécution de certains programmes de maillage | Identifier le programme et l'opération refusés, reproduire hors partie, puis vérifier une scène complète | Corriger la traduction ou le chemin compatible ; supprimer des objets ne valide pas le résultat final |
| 7 | La cadence des images distinctes arrivant au navigateur n'a pas été comparée à 60 natifs | Capture, encodage, réseau ou affichage peuvent devenir la prochaine limite | Quand le moteur approche 60, mesurer simultanément présentations, images encodées, reçues et affichées, ainsi que leur âge | Corriger la première étape qui accumule du retard ou perd des images, puis vérifier les commandes et le son |

Les températures et l'occupation CPU sont des observations. La baisse de
fréquence causée par la chaleur reste une hypothèse. L'occupation globale du
GPU ne donne pas son temps critique par image. Une attente chronométrée dans
un fil inclut le temps passé à attendre un autre fil ou la carte. **On ne
peut pas additionner les durées de fils parallèles pour expliquer 48 ms.**

## 1. Stabiliser la machine et établir les références

Le diagnostic initial voit `amd-pstate-epp`, le gouverneur `performance` et
la préférence énergétique `performance`. Les réglages ne sont pas modifiés.
Linux expose les températures du Ryzen mais aucune vitesse de ventilateur
CPU. Le ventilateur GPU à zéro tour, carte au repos en mode automatique,
ne prouve pas un défaut du refroidissement CPU. La carte mère identifiée est
une ASUS ROG STRIX B550-A GAMING ; aucun identifiant de carte n'est forcé
pour obtenir un capteur non reconnu.

Une sonde ultérieure charge temporairement le pilote standard `nct6775`.
Le [code du noyau](https://code.googlesource.com/linux/torvalds/linux/+/4e1b759c06721bc4e0fdfe5c179b58e7e20d3d13/drivers/hwmon/nct6775-platform.c)
prend explicitement en charge cette carte. La puce NCT6798 est reconnue
et les canaux 2 et 3 indiquent environ 1 129 et 1 259 tours/minute au
premier relevé. Les consignes lues sont proches de leur maximum. Aucun
canal n'est identifié physiquement comme CPU_FAN par ces seules données.
La [documentation du pilote](https://docs.kernel.org/hwmon/nct6775.html)
décrit les vitesses et modes de contrôle ; aucune commande de vitesse
n'est écrite ici. Le pilote est retiré après cette lecture pour garder les
conditions des mesures de FPS. Le modèle du refroidisseur et l'affectation
des connecteurs restent à confirmer.

Relever au repos, pendant la partie et pendant le retour au repos : `Tctl`,
`Tccd1`, fréquences, charge et présence d'autres travaux. Les relevés de
fréquence sysfs sont des instantanés. Une mesure des compteurs APERF/MPERF,
qui comptent l'activité du processeur, peut préciser sa fréquence effective
pendant une phase de diagnostic séparée. Elle ne désigne pas à elle seule
le fil qui limite le jeu. La documentation
[AMD sur Precision Boost](https://www.amd.com/en/resources/support-articles/faqs/CPU-PB2.html)
décrit plusieurs limites simultanées : température, puissance, courant et
charge. Une température haute ne suffit donc pas à attribuer chaque MHz perdu.

Le boost est bien activé. Un relevé fonctionnel séparé de 15 secondes
mesure aussi les cycles et le temps pendant lequel chaque fil est exécuté.
Leur rapport donne environ 3,48 GHz pour le fil avant et 3,74 GHz pour le
fil arrière. Ces moyennes ne portent pas sur toutes les fréquences de la
machine et ne comparent pas une situation froide à une situation chaude.
Elles ne prouvent donc pas une limitation causée par la température ni un
nombre de FPS récupérable avec un meilleur refroidissement.

Si la température reste proche de la limite officielle de 95 °C du
[Ryzen 5 3600](https://www.amd.com/en/support/downloads/drivers.html/processors/ryzen/ryzen-3000-series/amd-ryzen-5-3600.html),
le contrôle des ventilateurs dans le micrologiciel et du refroidisseur sur
la machine reste nécessaire. Un accès logiciel distant ne montre pas le
contact du radiateur ni la poussière. Aucune hausse de puissance, fréquence
ou tension ne fait partie de ce plan.

Les comparaisons alternent A/B/A/B et enregistrent tous leurs résultats.
Chaque binaire reçoit au départ une copie identique de la sauvegarde et
du cache, puis garde son propre cache. Les réglages, la mise à jour et le
script de commandes sont identiques. L'apparition des cœurs et de la carte
ne suffit pas : une capture doit montrer Link et le monde avant chaque mesure.
Les fenêtres de mesure restent entièrement dans la période observée.

Une CI qui charge cette machine, un compilateur ou un profileur invalide
une comparaison de vitesse. Une CI distante ne bloque pas si son routage
entièrement externe est prouvé pour sa révision et sa tentative ; un cas
inconnu reste bloquant. La préférence de Souhib reste d'attendre la fin d'une CI, sans
l'interrompre. Les journaux et captures sont privés ; les rapports du dépôt
ne doivent contenir ni jeu, ni clef, ni sauvegarde personnelle.

## 2. Réduire l'attente active sans casser les commandes

La correction expérimentale vise `GpuSplit::Drain`, `WaitForWriters` et
`WaitForSpace` du [code Eglantine figé pour cet essai](https://github.com/Djihads80/Eglantine/blob/216d3e294367abd4742d7ebd736ef25a8db6f365/src/video_core/gpu_split.cpp). Le fil arrière signale les positions consommées et la fin
de son travail différé. Le fil avant prend un numéro de progression **avant**
de vérifier sa condition, puis attend que ce numéro change. Le projet de
[norme C++ décrit ce mécanisme](https://eel.is/c++draft/atomics.wait).
Cela évite de perdre une notification entre la vérification et le sommeil.

`Drain` doit attendre deux faits : toutes les commandes envoyées sont
consommées **et** la soumission différée est terminée. Un arrêt demandé
ne dispense pas de terminer ces commandes : le propriétaire attend la fin du fil
avant puis arrête le fil arrière. Le correctif ne réorganise pas cette
propriété. Les attentes des écritures et de l'espace surveillent leur propre
position ; elles ne doivent pas attendre que tout le moteur soit au repos.

Les tests provoquent des progressions partielles, un réveil juste avant
l'endormissement, une soumission encore en cours, la publication de données,
un arrêt avec travail restant et des sessions répétées. Un test mesure le
temps CPU du fil pendant une attente imposée de 250 ms. Son plafond de 50 ms,
choisi le 8 novembre, tolère du bruit tout en rejetant les quelque 250 ms
consommées par la boucle d'origine. Il vérifie une réduction de CPU, pas
un délai garanti pour le jeu. Les versions volontairement cassées doivent
échouer : boucle réintroduite et prise du numéro après la condition.

La référence et le correctif sont compilés avec le même compilateur et les
mêmes dépendances. Le résultat publié ne mélangera pas le paquet officiel
optimisé et une compilation de développement. Une différence entre ce
laboratoire et le paquet installé sera décrite séparément.

La relecture des huit fenêtres du profil précédent compte environ **17 365
passages par seconde dans la zone d'attente**, avec **32,3 µs en moyenne**
par passage. La zone regroupe `Drain` et l'attente d'espace, sans distinguer
leurs appelants. Ce nombre ne mesure pas le temps propre du GPU. Il explique
pourquoi économiser le CPU de l'attente peut laisser presque toute sa durée
sur le chemin critique : le travail attendu reste à terminer et chaque
réveil peut avoir son propre coût.

Si les notifications économisent du CPU sans accélérer le jeu, deux
expériences deviennent prioritaires. La première vérifie le coût des
réveils : l'implémentation peut réveiller le fil avant une fois lorsque les
commandes sont consommées, puis une seconde fois après sa demande de fin
de soumission différée. Annoncer au fil arrière la position visée par
`Drain` avant l'attente pourrait lui permettre de terminer ce contrat et
de notifier directement son achèvement. Ce protocole reste à développer
et à tester ; les attentes d'écritures et d'espace doivent garder leurs
conditions distinctes.

La seconde expérience doit **réduire les rendez-vous nécessaires**. Compter séparément
leurs origines : lecture des arguments produits par le GPU dans
`Maxwell3D::FrontDmaRead`, lecture de commandes graphiques modifiées dans
`dma_pusher.cpp`, libération des clôtures dans `engines/puller.cpp` et
accès synchrones via `GpuSplit::Run`. Les compteurs doivent préciser
les octets relus et la raison de chaque invalidation.

Selon ce comptage, essayer d'attendre seulement les écritures qui produisent
la donnée demandée, de regrouper les lectures voisines ou de réutiliser
une copie dont la validité est démontrée. Le code possède déjà des chemins
de réutilisation : il faut identifier ceux qui retombent encore sur une
lecture synchrone. Les tests doivent opposer une page inchangée à une page
réécrite par le GPU et utilisée immédiatement. Lire trop tôt donne une
ancienne image des commandes et peut faire disparaître les arbres. Retirer
une attente sans suivre cette dépendance n'est pas une optimisation valide.

On mesure ensuite, sans profilage : FPS, gels, consommation par fil,
température, dessin et réponse aux commandes. Puis viennent marche,
chargement, sauvegarde et reprise. Une baisse du CPU sans hausse des FPS
reste utile, mais ne résout pas l'objectif 60. Une régression remet en cause
la correction, pas les critères du test.

## 3. Identifier la part CPU et la part GPU

Le test 1×/0,5× conserve la scène et les autres réglages. La seconde valeur
réduit les dimensions de rendu, donc approximativement le nombre de pixels
à un quart pour les cibles effectivement redimensionnées. Elle ne réduit
pas nécessairement les opérations de géométrie, de calcul ou les cibles
restées fixes. Il faut relire la résolution effective dans le journal et
la capture, plutôt que croire seulement la valeur du fichier de configuration.

Si le débit monte nettement dans les deux passages à 0,5×, le dessin GPU
ou ses transferts mérite la priorité. S'il ne bouge presque pas, cela écarte
seulement un coût dominé par le nombre de pixels dans cette scène. Cela
ne prouve pas que la carte est sans limite. La suite est un relevé des
durées GPU et des dépendances CPU/GPU sur quelques images représentatives.

Côté CPU, le profil existant donne, par seconde de jeu, environ 270 ms
de traitement des méthodes, 151 ms de macros, 150 ms de liaison des tampons
et 133 ms de traitement des commandes amont. Ce sont des priorités
d'investigation, pas des économies disponibles intégralement. Le profil
avec symboles doit distinguer recherches, copies, invalidations et attente.

Pour `BindHostStageBuffers`, dans `src/video_core/buffer_cache/`, et son
appel depuis `renderer_vulkan/vk_graphics_pipeline.cpp`, compter par image les liaisons réellement
changées, les recherches dans le cache, les copies et les invalidations
écrites par le jeu. Une réutilisation n'est possible que si le contenu et
les adresses surveillés n'ont pas changé. Les tests doivent opposer un état
inchangé à une écriture du jeu qui exige une nouvelle liaison. Un cache qui
ignore cette écriture peut augmenter les FPS tout en montrant un ancien état.

Le code possède déjà des masques de ressources actives et un chemin rapide
pour les liaisons inchangées. Il faut mesurer pourquoi ce chemin ne suffit
pas, plutôt qu'ajouter un second cache qui répéterait son travail.

Pour les méthodes et macros, identifier les séquences les plus fréquentes
et leur dépendance aux registres. Regrouper une séquence exige de conserver
ses effets et leur ordre. Les premiers essais de répartition sur deux fils
n'ayant donné aucun gain, déplacer davantage de code sans comprendre les
attentes n'est pas la prochaine expérience.

## 4. Traiter les chargements séparément du débit stabilisé

Créer un parcours de référence avec lieux relus à l'écran, mouvement sur
le sol et passage de porte réellement observé. Rejouer une première visite
puis une seconde sur les mêmes données privées. Enregistrer séparément
compilation de shaders, création de pipelines, chargements de textures,
décompression et lectures de fichiers. Un shader est un programme exécuté
sur la carte ; un pipeline assemble les programmes et leur état de dessin.

Corréler leurs dates avec les gels. Si la compilation est responsable,
préparer les programmes en avance ou conserver leurs résultats est une
piste. Si le gel vient d'une copie synchrone ou d'une invalidation, garder
plus de fichiers compilés ne résout pas ce coût. Mettre un travail en
arrière-plan exige une copie stable de ses entrées et une synchronisation
avant son utilisation. Le premier dessin ne doit pas utiliser une ressource
incomplète ou un état d'une autre image.

## 5. Décider à partir des étapes mesurées

| Étape | Preuve attendue | Décision suivante |
|---|---|---|
| Diagnostic initial et attente | Tests capables d'échouer, deux binaires comparables, tours alternés et arrêt normal | Garder la correction seulement pour ses bénéfices constatés et sans régression |
| Répartition CPU/GPU | Sensibilité à la résolution et profil du travail critique | Choisir une seule famille de corrections à la fois |
| Premier palier à 30 natifs | Budget moyen ramené vers 33,3 ms dans plusieurs scènes, gels publiés | Mesurer de nouveau : le goulot peut avoir changé |
| Palier à 45 natifs | Budget vers 22,2 ms sans accélération du jeu ni objets manquants | Corriger le nouveau travail critique et éprouver les premières visites |
| Objectif à 60 natifs | Budget vers 16,7 ms, partie réelle et intervalles publiés, son et reprise corrects | Mesurer ensuite la chaîne navigateur et la latence des commandes |

Ces paliers sont des objectifs de travail choisis le 8 novembre pour rendre
les progrès vérifiables. Ils ne prédisent pas un pourcentage de gain à chaque
correctif. Si, après réduction des coûts identifiés et contrôle du
refroidissement, un fil utile sature encore avant 16,7 ms, comparer alors
la même scène sur un CPU plus rapide permettrait d'estimer la part matérielle.
Si le GPU dépasse seul ce budget, comparer le programme et la carte devient
pertinent. **Le diagnostic actuel ne permet pas d'affirmer que cette machine
atteindra 60, ni qu'un achat précis le garantirait.**

## Résultats de la mise en œuvre

### Réduire la résolution ne débloque pas la cadence dans Kokiri

Quatre phases de 90 secondes alternent 1×, 0,5×, 1×, 0,5×, avec le binaire
local **sans correctif**, mode 0. Les fenêtres complètes retenues donnent
21,68 images/s à 1× et 21,63 à 0,5×, soit −0,23 %. Chacune de ces deux
conditions couvre 2 400 présentations et environ 111 secondes de fenêtres
complètes. Les quatre arrêts sont normaux. Les captures montrent le même
monde et Link, avec la baisse visible de résolution dans les tours réduits.
Les valeurs finales du fichier de configuration confirment l'option lue.

Cette expérience n'observe aucun gain de débit en réduisant les dimensions
de rendu dans cette scène. Elle ne mesure pas séparément les programmes
GPU de calcul, la géométrie ou les copies qui ne dépendent pas du nombre
de pixels. Elle donne donc la priorité au profil du CPU et des dépendances,
sans déclarer que toute limite GPU est exclue. La température CPU reste
entre 94,9 et 96,6 °C dans ces quatre phases. Aucun processus de CI n'est
observé dans leurs relevés et aucun compilateur ou profileur ne les accompagne.

### Le correctif économise le CPU de l'attente mais ne gagne pas de FPS

La série réellement corrigée alterne original, correctif, original,
correctif en mode 2. Les deux copies partent de 3 613 fichiers de cache
identiques après réinitialisation du protocole de construction. Les quatre
phases durent 90 secondes. Les fenêtres complètes donnent :

| Code | Cadences des deux passages | Cadence regroupée | Présentations retenues |
|---|---|---|---|
| Original local | 21,13 ; 21,43 | 21,28 images/s | 2 400 |
| Attente par notification | 20,61 ; 20,82 | 20,71 images/s | 2 400 |

La baisse observée est d'environ 2,65 %. Avec deux passages par version,
elle ne constitue pas une estimation précise de toutes les scènes. Elle
ne fournit aucun gain à retenir pour l'objectif de cadence. Le fil avant
consomme environ 80 % d'un processeur logique dans l'original et 37 % avec
le correctif. Les autres fils continuent à travailler. Cela ne signifie pas
que la consommation de toute l'application est divisée par deux.
Les captures montrent le même monde et le même avatar, avec les omissions
connues de `NO_MESH`. Les quatre fermetures sont normales ; la dernière
est demandée par la limite de durée du laboratoire après les mesures.

**Le correctif reste expérimental et le moteur installé reste inchangé.**
Le code, ses tests et la preuve de construction sont conservés pour une
prochaine modification. Les températures varient entre les passages ; la
série ne mesure pas un gain thermique causal. Les gels de plus de 100 ms
restent publiés dans le rapport, sans classement de stabilité à partir
de ces seuls courts passages.

### La prochaine cible précise est la lecture des arguments des macros

Un relevé séparé de 15 secondes, après la phase de FPS de l'original, examine
les piles d'appels à caméra fixe. Environ 49,5 % des cycles utilisateur
échantillonnés du fil avant passent dans `GpuSplit::Drain`. Parmi ces cycles
dans `Drain`, 78,6 % viennent de `Maxwell3D::FrontDmaRead` et 19,0 % du
traitement des sémaphores. `WaitForWriters` représente séparément environ
13,1 % des cycles échantillonnés du fil avant. Ces parts sont pondérées
par la période des échantillons. Ce sont des coûts CPU observés, sans
mesure du temps physique GPU ni promesse de gain équivalent.

La première modification à étudier se précise donc : éviter de vider toute
la file avant chaque lecture d'arguments lorsque la donnée peut être lue
dans une copie valide. `DmaPusher::ReadGpuWrittenCommands` possède déjà un
mécanisme de copie des pages de commandes après leur écriture. Examiner
son adaptation aux arguments lus par `FrontDmaRead`, plutôt que créer
une seconde infrastructure sans raison. Compter d'abord les lectures
réellement modifiées et celles qui répètent les mêmes données.

La copie doit porter une version et la dépendance qui la rend valide.
Les écritures CPU, les copies GPU, le calcul et les écritures depuis un
dessin doivent l'invalider quand elles touchent sa plage. Une situation
inconnue doit garder le chemin conservateur. Les tests doivent modifier
la donnée après une première lecture, y compris sur une page partiellement
recouverte, et vérifier que la nouvelle valeur arrive au dessin suivant.
Une simple hausse des FPS ne prouve pas ce contrat.

Sur le fil arrière, la liaison des tampons figure dans environ 21,5 % des
cycles échantillonnés via les piles d'appels. Cette part inclut les fonctions
appelées. Elle renforce le besoin de détailler les copies, recherches et
invalidations de ce chemin. Certains symboles de bibliothèques partagées
restent non résolus. Ce relevé à caméra fixe complète le profil précédent
avec rotation ; il ne le remplace pas par une comparaison de vitesse.

### Contrôles de partie et remise en état

La marche au sol, l'écriture d'une sauvegarde privée et sa reprise après
fermeture complète passent. Le fichier manuel change à l'écriture et garde
la même empreinte à la reprise. Les captures montrent le retour dans Kokiri.
Ces contrôles ne valident pas un changement de zone ni une partie complète.

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

Les pièces locales sont conservées dans
`spikes/switch2-room/drain-2026-11-08.json` et le correctif dans
`spikes/switch2-room/amont/eglantine-216d3e-drain-progress.patch`.
Les captures, journaux et copies de travail restent privés dans le
laboratoire daté. Aucun jeu, aucune clef et aucune sauvegarde personnelle
ne sont ajoutés aux artefacts du dépôt.

## Suite du 8 novembre : lectures des arguments sans mise au repos complète

La sonde conserve d'abord les lectures et attentes d'origine. Cinq fenêtres
complètes de caméra couvrent 50,02 secondes et 845 091 lectures de 24 octets.
Aucune ne demande un téléchargement du cache de tampons et aucune page lue
n'est alors marquée écrite par le GPU. Le temps cumulé dans `Drain` atteint
16,50 secondes sur cette période. Cette durée contient les rendez-vous
entre fils, sans mesurer le travail physique de la carte. La petite histoire
de valeurs suit au plus 4 096 adresses et manque la majorité des lectures :
elle ne classe pas l'ensemble des arguments en valeurs inchangées ou modifiées.

Ce résultat déplace l'expérience. Le prototype attend que toutes les
commandes antérieures soient exécutées, y compris les dessins, mais ne
demande pas aussi la mise au repos du gestionnaire graphique pour lire
des arguments dont la page n'a pas été écrite par le GPU. Il conserve la
lecture par mot, qui connaît aussi les registres virtuels de synchronisation.
Les pages susceptibles d'être écrites par le GPU sont suivies avant
l'attente. Leurs copies existantes ne sont acceptées qu'à la bonne version
et sur la plage couverte. Les écritures CPU et les dessins continuent
d'invalider ces copies. Un cas inconnu conserve le vidage et le
téléchargement d'origine.

Les tests refusent une copie périmée après réécriture, une plage incomplète,
un dessin encore dans la file, un débordement d'adresse et une lecture
non alignée. Supprimer la barrière, ignorer une écriture CPU, retirer la
prudence sur les dessins ou ignorer les bornes fait échouer les tests.
Les contrôles mémoire du test isolé passent. La suite complète du moteur
compte 240 tests réussis et quatre tests réseau ignorés faute d'interface
IPv4 dans le conteneur isolé.

La comparaison suivante utilise le même exécutable compilé localement,
avec l'option expérimentale désactivée puis activée. Ce témoin inclut
l'extraction des métadonnées de copie utilisée par les tests ; il ne doit
pas être appelé paquet amont intact. Les deux états privés partent de
3 641 fichiers identiques, dont 3 613 fichiers de cache. L'instrumentation
est coupée pendant les mesures de FPS et un message prouve l'option
effectivement activée. Une CI apparue avant la comparaison est attendue
sans être interrompue ; les contrôles fonctionnels continuent séparément.

### Résultat du second prototype

| Condition | Deux passages | Présentations retenues | Durée des fenêtres complètes | Cadence regroupée |
|---|---|---|---|---|
| Option coupée | 22,19 ; 22,08 | 2 400 | 108,43 s | 22,13 images/s |
| Option activée | 22,25 ; 22,64 | 1 800 | 79,96 s | 22,51 images/s |

Les quatre phases de caméra durent environ 91 secondes. Les fenêtres du
journal contiennent 600 présentations chacune. Un journal tamponné laisse
moins de fenêtres complètes dans le premier passage activé : les bornes
prudentes sont conservées et aucune donnée tardive n'est ajoutée après
lecture du résultat. L'écart regroupé est de **+1,70 %**, avec deux passages
par condition et une couverture inégale. Il reste une tendance modeste,
pas une amélioration importante établie sur plusieurs scènes.

Le CPU du fil avant passe de 80,37 à 80,63 % d'un processeur logique ; le
fil arrière de 78,17 à 78,66 %. Ces relevés portent sur les phases de caméra,
pas exactement sur le sous-ensemble des fenêtres de présentations. Ils ne
montrent pas d'économie de CPU. Une image de plus de 100 ms apparaît dans
les fenêtres du témoin, aucune dans celles du prototype. Leurs durées
inégales et leur brièveté ne permettent pas de conclure à une correction
des gels. Les températures CPU vont ici de 84,0 à 89,1 °C. Cette série ne
constitue pas une comparaison contrôlée du refroidissement avec les
mesures antérieures proches de 96 °C.

Les quatre arrêts mesurés sont normaux. Un premier démarrage du témoin,
option coupée, avait quitté avec `VK_ERROR_OUT_OF_DEVICE_MEMORY` après des
lectures non mappées et un format invalide. Il reste exclu des FPS et sa
cause reste inconnue. Ce type d'échec existait déjà dans le témoin amont
précédent ; aucune correction de démarrage n'est attribuée à ce prototype.

La marche sur les racines au pied de l'arbre, une sauvegarde manuelle et
sa reprise au même endroit après fermeture complète sont vérifiées. Le
fichier change à l'écriture et garde son empreinte à la reprise. Les trois
arrêts fonctionnels sont normaux. Un extrait de huit secondes contient un
signal stéréo non silencieux ; aucune précision de synchronisation
son/image n'est établie par ce contrôle. Aucun changement de zone n'est
validé ici.

**Le moteur installé reste le standard en mode 0.** Le second prototype
et son rapport `spikes/switch2-room/mme-snapshot-2026-11-08.json` restent
des artefacts du laboratoire. Les copies GPU sont couvertes par les tests,
mais la sonde en jeu observée utilise ici le chemin des arguments CPU.

### Ce qui reste à enlever pour progresser vers 60

Un profil séparé de 15 secondes, après le dernier passage et à caméra fixe,
contient 4 850 échantillons. Les périodes pondérées placent encore 51,5 %
des cycles utilisateur du fil avant dans `WaitForPosition`, dont 40,2 %
dans les piles passant par `WaitForEntries`. La mise au repos a été évitée,
mais l'exécution des commandes précédentes reste attendue. Cette attente
ne disparaît pas parce que ses arguments sont petits et viennent du CPU.

Sur le fil arrière, `BindHostStageBuffers` figure dans 21,2 % des cycles
échantillonnés et `SynchronizeBuffer` dans 16,1 %. Ces piles se recouvrent :
les parts ne s'additionnent pas. Les bibliothèques exactes du conteneur
améliorent la résolution des symboles, mais une partie de libc et du code
traduit à la volée reste inconnue. Ce sont des cycles CPU, sans mesure
physique du GPU et sans comparaison de vitesse pendant le profilage.

Les prochaines expériences ont maintenant trois cibles précises :

1. Compter les écritures susceptibles de toucher chaque plage d'arguments
   **avant** leur exécution sur le fil arrière. Une première écriture encore
   dans la file ne doit pas être manquée. Une dépendance précise pourrait
   permettre d'attendre seulement ces écritures ; les dessins, les copies,
   les calculs, les écritures CPU et les changements d'adressage doivent
   rester couverts, avec retour prudent pour un cas inconnu.
2. Dans `SynchronizeBuffer` et la liaison des tampons, comparer les octets
   réellement modifiés aux octets transférés, compter les plages répétées
   et la raison des invalidations. Les chemins rapides existent déjà :
   chercher pourquoi ils ne s'appliquent pas avant d'ajouter un autre cache.
3. Ajouter des horodatages GPU sur des images représentatives pour séparer
   calcul, dessin, copies et attente. La baisse de résolution n'a pas
   accéléré Kokiri, mais les coûts GPU indépendants du nombre de pixels
   restent possibles. Un échantillon de cycles CPU ne tranche pas ce point.

Dans cette dernière série limitée, 22,51 images/s représentent encore
44,42 ms par image, contre 16,67 ms à 60. Il reste environ 27,75 ms à retirer,
soit un débit à multiplier par 2,67. Les paliers de 30 puis 45 restent à
obtenir et à vérifier en jouant. Les omissions de `NO_MESH`, les premières
visites de zones et la chaîne navigateur restent dans les critères finaux.


## Troisième prototype : recherches mémoire et commandes GPU

Ce prototype repart du même code amont, en mode 0, sans les deux changements
d'attente précédents. Le correctif `spikes/switch2-room/amont/buffer-clean-and-gpu-timing.patch`
et ses instructions dans le fichier voisin `.md` restent séparés de
l'installation normale.

### Ce que la sonde des tampons établit

Quatre fenêtres complètes couvrent 40,11 secondes de caméra. Elles comptent
environ 139 000 demandes de synchronisation par seconde et 74,43 Mio/s
réellement transférés. Les tailles des plages demandées ne sont pas le trafic
mémoire : le même grand tampon peut être demandé des milliers de fois.
Les sommets et les indices ne transfèrent rien dans ces fenêtres ; le stockage
ne transfère rien dans 99,76 % des demandes, les paramètres dans 94,16 %.
Les banques de constantes forcées expliquent 62,84 Mio/s.

La comparaison partielle des données regarde une copie sur seize, au plus
ses 4 096 premiers octets, avec 16 Mio d'historique. Environ 6,25 % des octets
comparables des paramètres diffèrent de leur précédent échantillon. Ce nombre
ne décrit pas toutes les banques, ne couvre pas leurs octets restants et ne
prouve pas qu'on puisse réutiliser une copie complète.

Le correctif maintient un bit par mot de suivi de 64 pages, huit octets par
gestionnaire de quatre Mio. Il permet de sauter un parcours seulement si
aucune page n'est modifiée par le CPU et aucune surveillance ne doit être
réarmée. Les écritures retardées restent couvertes. Dans le diagnostic activé,
63,68 % des parcours de gestionnaires liés au stockage sont évités, mais
seulement 8,03 % pour les sommets et 0,57 % pour les indices : une page voisine
modifiée suffit à conserver le parcours prudent. Ces parcours de gestionnaires
ne sont pas les appels de synchronisation, qui peuvent en visiter plusieurs.
Le maintien du résumé coûte aussi du CPU ; seules les mesures sans sonde
permettent d'évaluer son gain net.

Chaque suite du moteur compte 241 tests réussis et quatre tests réseau ignorés
faute d'interface dans le conteneur isolé. Cinq réintroductions ciblées de
défauts font échouer les tests. Les contrôles mémoire de la conversion des
horodatages passent, sans couvrir le reste du moteur.

### Ce que les horodatages GPU disent et ne disent pas

Six demandes produisent chacune 3 008 à 3 136 intervalles complets, sans perte.
Les horodatages viennent de la file graphique réelle, avec une période de
10 ns et 64 bits valides. Les copies de tampons ont une union d'intervalles
de 0,73 à 0,95 ms ; les dessins de 20,65 à 22,80 ms et les calculs de
9,54 à 11,64 ms. Ces unions sont calculées séparément et peuvent encore se
recouvrir entre catégories. Elles ne doivent pas être additionnées.

Les points placés au début et à la fin du pipeline donnent des durées
approximatives. La capture couvre les commandes enregistrées entre deux
passages de fin d'image, avec plusieurs soumissions possibles. Son enveloppe
atteint 90,22 à 101,34 ms, alors que l'union de ses intervalles couvre
34,14 à 35,80 ms. Les trous peuvent contenir des attentes, la préparation CPU
ou des opérations non mesurées. Plusieurs milliers de requêtes ajoutées au
GPU peuvent aussi perturber la charge. Aucun de ces nombres n'est présenté
comme le coût matériel exclusif d'une image normale.

Le prochain relevé doit donc poser quelques bornes par image et par grande
passe, associer les calculs longs à leur programme, puis alterner son
activation pour chiffrer son coût. La petite place des copies dans cette sonde
ne supprime pas leur coût de préparation CPU. La baisse de résolution et le
profil CPU antérieurs ne suffisent toujours pas à déclarer le matériel hors
de cause.


### Comparaison du troisième prototype

| Condition | Deux passages | Présentations retenues | Fenêtres complètes | Cadence regroupée |
|---|---|---|---|---|
| Amont intact compilé localement | 22,42 ; 22,32 | 2 400 | 107,29 s | 22,37 images/s |
| Résumé activé, sondes désactivées | 21,45 ; 21,23 | 2 400 | 112,48 s | 21,34 images/s |

Les quatre phases alternent et durent chacune environ 91,5 secondes, après
les mêmes rotations de préparation. Les états privés partent de 3 641 fichiers
identiques, dont 3 613 fichiers de cache. La sauvegarde de départ est la même.
Les compilateurs, tests, profileurs et CI sont absents des phases mesurées.
Les bornes viennent du temps observé et du démarrage du conteneur ; seules
les fenêtres natives de 600 présentations entièrement incluses sont gardées.
Les captures avant et après montrent Link et le monde. Les bibliothèques et
options de compilation sont identiques entre les deux programmes locaux ;
ce n'est pas une comparaison contre le paquet installé.

Le résultat regroupé est **−4,61 %**, défavorable dans les deux tours.
Le fil CPU nommé `GPU`, chargé de la préparation graphique en mode 0,
reste vers 85 à 86 % d'un processeur logique. Il ne s'agit pas d'une mesure
d'occupation physique de la carte. Le témoin a une image de plus de 100 ms,
le prototype six, sur des couvertures légèrement différentes ; le maximum
est toutefois plus haut dans le témoin, 173,11 contre 107,01 ms. Ces courtes
phases ne décrivent pas tous les gels d'une partie. Les températures relevées
vont de 83,25 à 94,50 °C, sans comparaison contrôlée du refroidissement.
Les quatre sorties sont normales, en 2,60 à 2,81 secondes.

Le prototype complet est donc écarté comme optimisation à installer.
Ce résultat ne prouve pas que toute recherche de plage propre soit inutile :
le maintien du résumé coûte du travail, sa granularité garde beaucoup de
parcours, et les branchements des sondes désactivées restent compilés.
Une version sans ces branchements demanderait une autre compilation et une
nouvelle alternance pour attribuer le recul à l'une de ces causes.
Le rapport numérique `spikes/switch2-room/buffers-2026-11-08.json`
conserve les durées, les tests et les limites.

La marche au sol, l'écriture manuelle et la reprise au même endroit après
arrêt complet passent avec le prototype. Huit secondes contiennent du son
dans les deux canaux, sans contrôle de synchronisation précise. Aucun
changement de zone n'est validé ici. Le jeu privé et ses quatre manettes
sont retirés, la boîte noire est relancée ; les huit fichiers de progression
présents après la vraie partie de l'utilisateur restent identiques. Le moteur
et sa configuration installés sont conservés. La porte locale complète,
l'audit et la construction stricte de la documentation sont les contrôles
locaux de cette reprise ; aucun nouveau résultat de CI distante n'est annoncé.

### Prochaine itération pour viser 30, puis 45, puis 60

| Chantier | Modification concrète à préparer | Preuve exigée avant de la retenir |
|---|---|---|
| Éviter les liaisons et recherches répétées | Conserver une version de chaque plage liée ; ne réexaminer une liaison que si une écriture CPU ou GPU, une écriture retardée ou un changement d'adressage peut l'avoir touchée | Les tests doivent rendre une ancienne version inutilisable après chacun de ces événements ; le parcours original reste le recours pour un cas inconnu. Comparer le coût total, y compris le maintien des versions, contre l'amont intact |
| Réduire les envois de paramètres forcés | Identifier pourquoi une banque complète redevient modifiée et suivre les sous-plages réellement réécrites, avant d'ajouter une comparaison de contenu | Compteurs avant/après des invalidations et des octets copiés, mêmes dessins et mêmes données dans les cas CPU et GPU. L'échantillon partiel ne peut pas décider la réutilisation |
| Identifier le programme GPU qui coûte | Capturer quelques bornes par grande passe et un identifiant de programme pour les calculs longs ; vérifier le coût de cette capture par alternance | Disposer de durées peu perturbées avant de modifier un programme, une copie ou une synchronisation. Une union de milliers d'horodatages détaillés ne remplace pas cette preuve |
| Remplacer une dépendance trop large | Marquer les écritures susceptibles de toucher les arguments dès leur mise en file, puis attendre leur version précise plutôt que tout le travail antérieur | Couvrir dessins encore dans la file, copies, calculs, écritures CPU et alias mémoire. Le second prototype attend encore des commandes consommées et ne résout pas ce point |
| Traiter les gels de déplacement | Rejouer un trajet réel avec caches privés froids puis chauds, relever créations de programmes graphiques, chargements et transferts près de chaque gel | Attribuer le gel à une opération observée avant d'asynchroniser ou de précharger. Le conteneur NUP brut n'exclut pas une décompression à l'intérieur des fichiers du jeu |

Chaque chantier doit enlever une durée mesurée sur le chemin qui limite
réellement l'image. Les coûts CPU et GPU peuvent se recouvrir : économiser
une milliseconde sur une opération non limitante ne garantit pas une
milliseconde de moins par image. Un moteur à environ 22 images/s doit encore
passer d'environ 45 ms à 16,67 ms ; une petite optimisation de recherche ne
suffit pas à couvrir cet écart.

Le premier palier reste une partie à 30 images calculées/s avec déplacements,
puis 45 et enfin 60 selon les critères du début de ce plan. Corriger le chemin
de maillage qui retire des objets reste une condition parallèle : une cadence
obtenue en omettant une partie du monde ne valide pas le résultat final.
La température et les fréquences restent relevées ; le modèle de refroidisseur
est inconnu et aucune causalité thermique n'est encore démontrée. Aucun gain
ne peut être promis avant ces essais.


## Sonde GPU par lots, du 8 au 9 novembre

Le nouveau prototype repart de l'amont intact, sans les trois optimisations
précédentes. Il chronomètre les deux tampons de chaque soumission existante,
celui des transferts et celui de l'exécution principale. Il n'ajoute pas de
soumission ou d'attente forcée par image. Un programme de calcul invité est
chronométré à la fois ; ses identifiants permettent de revenir au code concerné.
Une capture est prise tous les soixante passages de fin d'image par défaut.

### Coût de l'activation

| Condition | Deux passages | Présentations retenues | Fenêtres complètes | Cadence regroupée |
|---|---|---|---|---|
| Même exécutable, sonde coupée | 22,06 ; 22,67 | 2 400 | 107,34 s | 22,36 images/s |
| Même exécutable, sonde activée | 22,43 ; 21,10 | 2 400 | 110,36 s | 21,75 images/s |

Les quatre phases alternées durent environ 91,5 secondes et utilisent le même
passage de caméra. Les deux états privés commencent avec 3 641 fichiers
identiques, dont 3 613 fichiers de cache. Les captures avant et après montrent
Link et le monde. Les bornes et la sélection des fenêtres natives suivent le
protocole précédent ; les compilateurs, profileurs, tests et CI sont absents.
Le témoin coupé contient encore les branchements et la recherche d'identifiant
compilés. Cette comparaison mesure l'activation, pas tout le coût du code ajouté
face à l'amont intact.

L'écart regroupé est **−2,74 %**, mais son signe diffère entre les deux tours.
Les sept images de plus de 100 ms apparaissent dans le dernier passage activé,
avec un maximum de 187,24 ms. Aucune n'apparaît dans les trois autres passages.
Ce petit nombre de phases ne permet pas d'attribuer chaque gel à la sonde.
Il interdit en revanche de la présenter comme transparente. Les quatre sorties
sont normales. Les capteurs CPU vont de 81,50 à 94,00 °C ; la cause de la
variation de cadence n'est pas isolée par ces températures.

### Où le temps apparaît

Les 64 captures complètes comprises dans les phases activées utilisent 610 à
646 requêtes chacune. La première sonde en plaçait environ 6 000 par capture,
dans une autre série ; cette différence de nombre n'est pas un gain de FPS.

| Mesure dans les captures instrumentées | Médiane |
|---|---|
| Intervalles des tampons de transferts | 0,80 ms |
| Intervalles des tampons d'exécution principale | 24,87 ms |
| Union des intervalles de soumission | 25,68 ms |
| Enveloppe entre premier et dernier point | 42,37 ms |
| Temps dans l'enveloppe hors des intervalles mesurés | 16,26 ms |
| Segments de soumission rencontrés | 155 |

Les médianes ne décrivent pas toutes la même image et ne se soustraient pas
pour reconstruire une chronologie unique. Les bornes du pipeline sont
approximatives, les catégories peuvent se recouvrir et l'enveloppe contient
potentiellement des attentes, des trous de préparation CPU et des images encore
en vol. L'union n'est pas un compteur exclusif d'occupation physique du GPU.
L'exécution principale contient dessins, calculs invités ou internes, barrières
et copies. Les octets et recherches CPU autour d'une copie ne sont pas mesurés
par la seule durée du tampon de transferts.

Ce relevé ne désigne donc pas les transferts seuls comme premier chantier.
Il ne permet pas non plus de déduire un budget de dessin en retirant les
calculs, ni de déclarer le matériel seul responsable. Le fil CPU nommé `GPU`
reste vers 84 à 85 % d'un processeur logique ; ce nom ne mesure pas l'activité
de la carte et son temps CPU peut contenir des attentes actives.

### Couverture des programmes et contrôle ciblé

Un balayage séparé à caméra fixe, une capture tous les six passages de fin
d'image après déclenchement manuel, dure 40,46 secondes. Ses 128 captures
observent 77 programmes et n'en chronomètrent que 73. Avec les phases précédentes,
76 programmes sont mesurés parmi 78 observés. Une rotation par indice dans
une liste changeante n'est pas une preuve de couverture.

Le programme natif `4d9a7a9cfd503656`, absent des mesures mais présent dans
164 captures, est donc ciblé explicitement. La vue au sol reprise depuis la
sauvegarde ne le contient pas : le contrôle refuse ce passage au lieu de
publier un coût nul. Le retour au balcon d'origine fournit sept mesures
réelles, avec **0,039 ms de médiane** et **0,064 ms au maximum**. Il ne change
pas le classement observé. Il reste un programme rare non chronométré,
`7dac7489218d3b6e`, rencontré dans trois captures.

Le plus long programme invité effectivement mesuré est `6f9367bd41dc0b58`,
empreinte compilée `04ece671c38fa5e3`, autour de **1,97 ms** dans les deux
échantillons des phases de caméra et 1,99 ms dans le balayage. Sa fonction
n'est pas identifiée dans le catalogue amont. Les fenêtres autour d'un programme
peuvent contenir des dépendances sur des travaux précédents ; ces durées ne
prouvent pas un coût exclusif du programme. Les programmes internes du moteur
ne sont pas identifiés par cette liste. La fréquence plus forte du balayage
n'a pas reçu la comparaison de coût du réglage une sur soixante.

### Prochaine modification à préparer

La piste concrète est maintenant la préparation et la synchronisation des
nombreux petits lots, avec la liaison répétée des ressources déjà signalée
par le profil CPU. Étudier leur regroupement et les dépendances trop larges
avant de modifier un programme invité dont la fenêtre ne dépasse ici que
quelques millisecondes. Un regroupement doit conserver les écritures GPU,
les attentes de lecture CPU, la présentation, les téléchargements et le vidage
à la fermeture. Supprimer simplement une soumission ou une barrière ne serait
pas une optimisation correcte.

Cette sonde donne une orientation, sans fournir à elle seule le correctif
pour 60 images/s. Ses valeurs restent instrumentées et le monde garde les
omissions de `NO_MESH`. Les paliers de 30, 45 et 60 restent à valider dans une
partie réelle, avec le monde complet. Aucune nouvelle optimisation de cadence
n'est installée à l'issue de ce relevé.

Les deux suites du moteur final passent chacune 241 tests, avec quatre tests
réseau ignorés dans le conteneur isolé. Les quatre défauts réintroduits sont
détectés. La marche au sol, le signal stéréo, la sauvegarde et sa reprise avec
empreinte inchangée passent avec le dernier exécutable. Aucun changement de
zone ni synchronisation son/image précise n'est validé. Les conteneurs et
manettes privés sont retirés, la boîte noire est relancée et les huit fichiers
de progression normaux restent identiques, ainsi que la configuration installée.
Le rapport est `spikes/switch2-room/coarse-gpu-2026-11-08.json` ; le correctif
et ses instructions sont sous `spikes/switch2-room/amont/coarse-gpu-timing.*`.


## Objectif du 9 novembre : 30 images/s régulières

Souhib demande de poursuivre toutes les pistes raisonnables jusqu'à une partie
à 30 images/s régulières, ou jusqu'à un blocage démontré. Les films et la
moyenne seule ne suffisent pas. Il faut contrôler les déplacements, les
changements de zone et les gels, sans accélérer le jeu ni créer des images
intermédiaires. Les essais conservent pour l'instant les omissions connues du
mode `NO_MESH=1` ; celles-ci restent une limite visuelle de la salle actuelle.

La version officielle Eglantine 0.1.0-rc3 du 8 novembre est épinglée à
`78743f30c251f66bd77e6eea6c28d8632d642d6f`. Les empreintes des paquets standard et
optimisé sont vérifiées contre la publication officielle. Quatre passages
alternés de caméra dans Kokiri donnent 22,50 images/s pour le moteur installé
et 23,68 pour le nouveau paquet optimisé, soit +5,26 % observés. Un intervalle
dépasse 100 ms avec rc3. Un démarrage du témoin quitte avec le code 134 et
`VK_ERROR_OUT_OF_DEVICE_MEMORY` avant le jeu ; il est conservé et exclu, puis
le passage est refait. Il n'y a pas de redémarrage du GPU ni de mise à mort
par la limite mémoire Docker dans ce lancement. Le rapport est
`spikes/switch2-room/rc3-2026-11-09.json`. Aucun résultat ne prouve 30 images/s.

Le prototype suivant limite son regroupement aux copies des listes, dans le
mode 0 explicitement demandé, sur le seul fil propriétaire de l'ordonnanceur.
Les fences restent immédiates. Une lecture CPU soumet d'abord ses copies encore
en attente ; le retour d'une liste les soumet aussi, même sans dessin. Il faut
vérifier ces invariants par des tests qui échouent avec leurs défauts
réintroduits, prouver l'activation dans le vrai moteur, puis comparer en
alternance deux constructions locales identiques hors du correctif.

Les deux constructions locales utilisent GCC 13.3, `-O3`, les mêmes options
et la même bibliothèque SDL 3.4.14. Son téléchargement d'empreinte automatique
répondait 504 ; l'interface de publication officielle a fourni cette empreinte
et les deux constructions ont réutilisé la même archive déjà extraite. Les
unités Vulkan modifiées sont réellement recompilées et les deux marqueurs
montrent une copie différée puis sa soumission en retour de liste.

Les 242 tests du moteur passent dans les configurations 0 et 8 000 µs ; quatre
tests réseau restent ignorés sans réseau. Les cinq défauts réintroduits sont
détectés. Quatre passages alternés donnent 21,14 images/s pour le témoin local
et 22,05 pour le prototype, soit +4,33 % observés. Le premier témoin comporte
vingt intervalles de plus de 100 ms et les caches évoluent séparément ; le gain
en régime chaud reste à confirmer. Les fenêtres retenues du dernier passage
sont entièrement après une courte préparation de caches identifiée dans le
rapport. Link descend l'échelle et marche au sol. Les quatre arrêts sont
normaux. Aucun changement de zone, sauvegarde ou son n'est validé pour ce
prototype, et il n'atteint pas 30 images/s. Il n'est pas installé. Le rapport
est `spikes/switch2-room/copy-batch-2026-11-09.json` et le correctif est
`spikes/switch2-room/amont/single-list-copy-batch.patch`.

La série suivante garde le même paquet officiel rc3 optimisé et compare les
images de conteneur avec Mesa 25.2.8 et Mesa 26.2.6. La seconde modifie aussi
libdrm et ses dépendances privées ; aucun résultat ne sera attribué à une
correction individuelle. Le filtre de journal est maintenant écrit dans la
catégorie réellement lue, `Miscellaneous`, pour les deux variantes. Les caches
initiaux sont deux copies identiques du cache chaud de rc3. Les notes officielles
de Mesa signalent des corrections, sans fournir de mesure de ce jeu. Aucun
paquet graphique de l'hôte n'est remplacé.



La comparaison du pilote est terminée : 23,86 images/s avec Mesa 25.2.8,
23,50 avec 26.2.6, soit environ −1,5 % observés. Ce petit écart ne démontre
pas une régression causale ; il ne fournit pas le gain recherché. Le même
exécutable est réellement chargé dans les quatre processus et les empreintes
des pilotes diffèrent comme prévu. Le rapport est
`spikes/switch2-room/mesa-2026-11-09.json`. Le pilote récent reste privé.

Une consultation supplémentaire trouve trois paquets plus récents que nos
premiers essais : Lichii 125, Superbuild v31 et Orchid 0.9.1. Les deux premiers
partent de `cbb512ee` et changent notamment les parcours de cache des textures.
Leurs trois paquets optimisés sont vérifiés et extraits. Ils n'ont pas encore
de mesure de jeu acceptée ici. Il faut les essayer sur les sauvegardes privées
avant d'investir dans une refonte locale plus large. Le correctif 874 est bien
présent dans le code de Superbuild v31 malgré une note contradictoire, mais
son gain publié sur un autre système ne sera pas transposé à ce serveur.


Superbuild v31 atteint ensuite la scène de jeu avec `NO_MESH=1` et Mesa 26.2.6 :
21,16 images/s au premier passage en mode 0, 23,33 au passage suivant en mode 2.
Ce ne sont pas des phases alternées et le cache s'enrichit ; aucune différence
causale du mode n'est revendiquée. Link descend l'échelle et marche au sol dans
les deux essais, les deux arrêts sont normaux. Aucun palier de 30 images/s,
changement de zone, sauvegarde reprise ni son n'est validé pour cette version.
Lichii 125 atteint à son tour la scène en mode 2, sa mesure est en cours.
`spikes/switch2-room/upstream-2026-11-09.json` conserve les premiers résultats.


Le premier relevé de Lichii 125 termine à 22,82 images/s, avec marche et arrêt
normal. Orchid 0.9.1 conserve un monde incorrect malgré les cœurs et la carte :
111 rejets de programmes graphiques sont relevés et aucun FPS jouable n'est
accepté. Le rapport des versions récentes est mis à jour. Un essai du profil
portable de rc3, avec 1920 × 1080 réellement demandé par le jeu contre
2560 × 1440 au témoin docké, donne 23,04 images/s, avec marche et arrêt normal.
Ces essais ne sont pas des comparaisons alternées entre toutes ces variantes
et n'atteignent pas 30 images/s. Le rapport du portable est
`spikes/switch2-room/handheld-2026-11-09.json`. La série suivante prépare quatre
phases alternées de placement du fil graphique sur un cœur CPU distinct,
dans le même processus et sans changer le placement des autres applications.


Le placement CPU est écarté après quatre phases alternées dans un même processus :
23,32 images/s au placement initial contre 20,22 avec le fil graphique sur le
processeur logique 0 et les autres exclus de ses deux voisins SMT. Les masques
réels sont vérifiés au début et à la fin des phases ; les huit images montrent
Link et le monde. Le placement initial est restauré avant l'arrêt, normal.
Ce test précis ne juge pas toutes les politiques d'affinité. Le rapport est
`spikes/switch2-room/affinity-2026-11-09.json`. La configuration de production
et les huit progressions normales restent identiques au début de cette reprise.

Le chantier suivant repart de rc3 sans le prototype de copies et prépare une
construction avec Clang 23, le profil PGO officiel, LTO et la cible Zen 2 du
Ryzen 5 3600. Les outils de compilation sont privés et aucune mesure de cette
construction n'existe encore. Les tests de moteur et les vérifications de
code effectivement recompilé précéderont ses mesures en jeu. Aucun réglage
n'atteint encore 30 images/s régulières.

La construction Zen 2 avec PGO et ThinLTO est ensuite terminée : 239 tests
passent, quatre tests réseau sont ignorés sans réseau. Le premier essai donne
23,07 images/s sur l'ensemble retenu, puis environ 24,41 dans ses fenêtres
après les à-coups initiaux. La marche et l'arrêt normal passent. Ce contrôle
isolé ne prouve pas un gain causal de compilateur. Deux relevés CPU séparés
terminent sans perte ni expiration des cartes mémoire. Ils repèrent des copies
coûteuses, mais l'appelant principal reste inconnu même avec une pile plus
profonde. Le rapport est `spikes/switch2-room/cpu-profile-2026-11-09.json`.
Le prochain contrôle alterne les modes automatique et performance du pilote
GPU, avec le même plafond de puissance et une restauration automatique.

Ce contrôle termine à 22,82 images/s en automatique et 23,87 en performance,
sans palier de 30. Le premier couple est presque égal, le second passage
automatique recule ; une seule fenêtre complète par phase est retenue.
La fermeture demandée quitte avec le code 139, sans cause identifiée. Le mode
automatique et la boîte noire sont rétablis. Le rapport est
`spikes/switch2-room/dpm-2026-11-09.json`. Le profilage rattache ensuite une
part des copies aux envois des tampons vers le GPU. Un prototype privé réutilise
leur stock en mémoire système, avec le même mécanisme de retrait selon le
dernier travail GPU ; son résultat n'est pas encore mesuré.

Le premier prototype de transfert via le stock de tampons en mémoire système
donne ensuite 22,47 images/s, avec marche et arrêt normal. Il confirme les
deux types de mémoire réellement alloués, mais change aussi le nombre de
tampons distincts ; ce contrôle isolé ne juge donc pas le placement seul.
Le rapport est `spikes/switch2-room/host-upload-pool-2026-11-09.json`.
Un second prototype ajoute un anneau indépendant et corrige un défaut de
réservation reproduit sans GPU : un tour refusé pouvait laisser le curseur
au début d'une région encore occupée, puis y accepter la demande suivante.
Le test échoue avant correction, passe après et échoue si le défaut est
réintroduit dans le fichier réellement utilisé par le moteur. Aucun effet
sur les saccades ni gain de FPS n'est encore revendiqué pour ce correctif.

Les 242 tests passent dans les deux configurations, quatre tests réseau restent
ignorés. Les quatre passages alternés du nouvel anneau donnent ensuite 22,14
images/s en mémoire système contre 23,29 pour le chemin habituel. Les fenêtres
initiales lentes restent incluses, le cache privé évolue. Les captures montrent
le monde, Link et la marche ; les quatre arrêts sont normaux. Cette variante
est écartée pour les performances. Le correctif du curseur est commun aux deux
variantes ; son effet sur la cadence n'est pas mesuré ici. Le rapport est
`spikes/switch2-room/host-ring-2026-11-09.json`. La prochaine sonde comptera les
transferts de données identiques, sans supprimer de copie pendant le diagnostic.

La sonde observe ensuite 46 410 transferts de 64 à 128 Kio, soit environ 3 Gio,
tous identiques à leur précédent instantané source. Ils représentent 80,74 %
des octets de tous les transferts de la période retenue. Les intervalles de
compteurs restent entièrement inclus dans les mouvements observés, avec bornes
de temps et de démarrage du processus. Cela ne prouve pas que la destination
GPU est inchangée. Le rapport est `spikes/switch2-room/upload-payload-2026-11-09.json`.
Les 244 tests passent et trois mutations sont détectées. Le relevé activé et
le contrôle désactivé repris se ferment normalement dans Kokiri. Le premier
contrôle désactivé, sorti 134 au chargement avec une erreur de mémoire Vulkan,
reste exclu et conservé. La suite vise seulement l'invalidation artificielle
qui force le réenvoi des banques natives chaque image : comparer les pages,
conserver le réenvoi si elles changent et garder le suivi ordinaire des écritures.

Le premier prototype donne ensuite 22,36 images/s activé et 23,87 désactivé,
sur deux passages successifs du même exécutable. Cette tendance ne constitue
pas une comparaison alternée. Les deux arrêts sont normaux, Link marche au
sol ; aucun gain n'est installé. La sonde suivante retient 384 instantanés de
compteurs entièrement compris dans 30,63 secondes de mouvements observés :
98 048 décisions, aucun réenvoi évité, 573 vidages complets dont 571 causés par
des effacements GPU. La protection sur les pages déjà écrites par le GPU ne
bloque aucun cas. Ce diagnostic explique une perte de réutilisation ; il ne
mesure pas une cadence normale ni ne prouve que les effacements sont disjoints.

La variante suivante invalide seulement les pages recouvertes par une écriture
ou un remplacement de tampon. L'ancien vidage global échoue au test d'une
écriture sans rapport ; les limites incluses et exclues, les bords de pages,
la taille nulle et le débordement d'adresse ont leurs contre-exemples.
Les 248 tests passent dans les deux configurations, quatre sont ignorés sans
réseau. La compilation du fichier qui instancie le code est vérifiée. La mesure
en jeu attend une CI en cours, avec activation réelle de la conservation des
banques exigée avant d'accepter les FPS. Si le premier essai justifie de
continuer, quatre passages alterneront cette option dans le même exécutable.
Une éventuelle amélioration devra encore passer la recherche de clignotements,
les changements de zone, le son et la sauvegarde puis reprise avant installation.

La variante ciblée évite ensuite 75 118 invalidations forcées sur 98 816
décisions, soit 76,02 %, pendant un relevé séparé de 30,65 secondes. Ce
compteur ne mesure pas les octets physiques transférés. Les quatre passages
alternés, diagnostic désactivé, donnent 24,10, 22,15, 24,35 et 22,98 images/s.
Le cumul vaut 24,23 activé contre 22,48 désactivé, soit +7,79 % observés,
sur 99,06 contre 133,48 secondes de fenêtres complètes. Quinze intervalles
dépassent 100 ms dans le premier témoin ; aucun dans les autres passages.
Le contrôle secondaire choisi après les résultats, limité aux fenêtres
commençant au moins trente secondes après le début de la caméra, donne
24,50 contre 23,46, soit +4,41 %. Il ne remplace pas le résultat principal.
Les quatre marches et arrêts sont normaux. Un chargement sorti 134 et une
phase reprise pendant laquelle démarre une nouvelle CI sont conservés comme
exclus. La variante reste privée et ne remplit pas l'objectif de 30 images/s.
Le rapport est `spikes/switch2-room/native-bank-2026-11-09.json`.

Le stock compare une source avant son envoi. La correspondance avec les
octets effectivement envoyés sous écritures concurrentes reste à prouver,
indépendamment des tests d'intersection et de la garde GPU. Ne pas installer
ce prototype sur la seule base des FPS. La prochaine piste examine le
regroupement des soumissions déjà présent dans le mode parallèle du moteur,
avec ses garanties de soumission avant lecture et de vidage avant repos.

Deux passages successifs en mode 2 donnent ensuite 23,51 images/s avec le
délai de 8 ms et 22,01 avec les 500 microsecondes par défaut. Les dernières
fenêtres approchent 25 dans les deux cas. Le marqueur journalise une vraie
soumission différée avec le délai demandé. Ce contrôle de sélection n'est pas
une comparaison alternée ; les deux marches et arrêts sont normaux. Un
premier témoin reste noir avant toute activation observée et demeure exclu.
Aucun changement de délai n'est installé. Le rapport est
`spikes/switch2-room/fence-window-2026-11-09.json`.

### Recherche et portage demandés après 11 heures le 9 novembre

La priorité passe à la nouvelle base Lichii `986a2b684`, douze commits après
la base `cbb512ee` de build 125. La première compilation privée garde le C++
amont et les mêmes Clang 23, profil PGO et ThinLTO. Conserver les binaires
et sources précédents. Ne porter que les correctifs encore nécessaires après
lecture des nouveaux chemins. La publication quotidienne Eglantine du même
jour pointe toujours sur `78743f30c` : sa date ne suffit pas à justifier un
changement de base. Orchid 0.9.2 ne prouve pas encore la correction du rendu
Zelda. Les optimisations de sommeil du fil d'horloge visent surtout Windows.

| Source vérifiée | Méthode utile | Application à vérifier ici |
| --- | --- | --- |
| [Lichii #949](https://github.com/zortos293/Lichii/commit/a4f62873277556960b5edc4c000f8ad482e5fac6) | Attentes de sémaphores ciblées, petits uniformes conservés, descripteurs rejoués | Vérifier les trois diagnostics de comparaison avant les FPS ; leurs variantes `VERIFY` coûtent du travail et ne sont pas des témoins chronométriques purs |
| [Ryubing Buffer](https://git.ryujinx.app/projects/Ryubing/src/commit/a61a42681119bf15fe8f3297677ae48bda83e70f/src/Ryujinx.Graphics.Gpu/Memory/Buffer.cs) | Générations et suivi des plages modifiées | Éviter les parcours répétés sans perdre une écriture CPU ou écraser une version GPU plus récente |
| [Dolphin VKStreamBuffer](https://github.com/dolphin-emu/dolphin/blob/41799046d68b2e5ea7cfde91f122320a472b7a61/Source/Core/VideoBackends/Vulkan/VKStreamBuffer.cpp) | Réservation après contrôle de place libérée et barrières suivies | Porter le correctif de curseur seul sur Lichii, avec refus répété d'une région occupée et reprise après achèvement |
| [PCSX2 GSDeviceVK](https://github.com/PCSX2/pcsx2/blob/8253ca6ca3508347b09bae31112be734214127b6/pcsx2/GS/Renderers/Vulkan/GSDeviceVK.cpp) | Commandes et ressources gardées jusqu'à leur achèvement ; reprise de lot sur pression d'allocation | Compter les véritables soumissions et leurs dépendances avant de modifier leur regroupement ; les segments de notre sonde ne sont pas ce compteur |

La lecture de Lichii révèle que ses banques natives utilisent déjà un envoi
direct limité aux octets utiles. Les keeps récents concernent seulement les
petits uniformes, au plus 4 Kio, et ne remplacent pas notre expérience sur
64 Kio. La comparaison doit repartir d'une mesure amont avant d'y transporter
les instantanés. Le défaut de curseur de réservation subsiste.

Un test isolé reproduit une divergence synthétique entre le raccourci
d'acquire et la valeur miroir qu'emploie le chemin de référence. Cette preuve
ne démontre pas que Zelda la déclenche. La lecture du miroir et les écritures
miroir encore en file doivent se composer correctement ; le cas concurrent
reste à examiner. La compilation amont reste figée et séparée des propositions
de correction. Les compteurs de vérification devront être réellement exercés,
avec leurs nombres de cas vérifiés et de désaccords, avant d'accepter un gain.

La référence compilée passe ensuite 1 086 tests, quatre sont ignorés sans
réseau. Le premier contrôle en mode 0 n'exerce aucun des nouveaux chemins
delta : `NoteResolvedDraw` exige GPUBack. Le mode 1 les exerce, sans macros
sur le front et donc sans acquire accéléré. Dans une fenêtre complète en
mouvement, le vérificateur trouve 592 différences d'octets sur 334 475
uniformes ; les 120 832 comparaisons de descripteurs concordent. Le mode 2
reste hors de cette qualification. Un vérificateur qui signale un acquire
incorrect ne corrige pas pour autant la décision de son appelant.

Le port conserve seulement deux corrections de fiabilité sur cette base :
la réservation du curseur et la comparaison des octets avant reprise d'un
petit uniforme. Le vrai test du cache échoue avec l'amont sur une écriture
invitée non notifiée dans une page déjà modifiée, puis passe après correction
et échoue avec la validation retirée. Les 18 cas ciblés passent 80 303
assertions ; la construction complète passe 1 091 tests, quatre sont ignorés.
Le contrôle en jeu exerce 338 432 reprises dans le code corrigé et
118 784 comparaisons de descripteurs sans différence. Il s'appuie sur le code
reconstruit et les tests d'octets, sans prétendre fournir un oracle indépendant
des données GPU pour chaque reprise. `UBO_KEEP_VERIFY` force le chemin de
référence : il reste inchangé et ne sert pas de faux compteur zéro après fix.

Les deux essais sans sondes donnent 20,42 images/s en mode 1 puis 19,93 en
mode 0, avec déplacement et arrêt normaux. Leur couverture est inégale ;
ils ne forment pas une comparaison alternée. Aucun remplacement n'est retenu
pour atteindre 30 images/s. Le fichier
`spikes/switch2-room/amont/lichii-986a2b-correctness.md`
et `spikes/switch2-room/upstream-refresh-2026-11-09.json` gardent les preuves.
La suite doit comparer les changements précis des forks et les attentes
mesurées, avant un nouveau port de synchronisation. Une date récente et des
tests unitaires verts ne suffisent pas à établir un gain en jeu.

### Port ciblé des publications constantes, à partir de 12:50

La [proposition Lichii #874](https://github.com/zortos293/Lichii/pull/874),
tête `6a5434e7`, distingue les rapports de valeur constante des vrais
compteurs GPU. Seuls les premiers, avec les modes de clôtures et de précision
admissibles, publient sans attendre le GPU. Elle reste absente de `986a2b684`.
Le port conserve les miroirs de #979 et traite les trois sorties de libération.
Le test du vrai cache et du vrai gestionnaire de clôtures reproduit d'abord
l'attente sur une mémoire mappée. Après le diff exact, neuf tests passent
571 assertions ; cinq mutations compilées échouent pour les raisons attendues.
Cela ne prouve encore ni un gain de cadence ni toutes les courses concurrentes.

Construire ce candidat séparément, avec les mêmes options que le témoin
corrigé `41d8fbfc`, puis vérifier l'activation effective d'une publication.
Retirer les sondes pour les FPS. Si le premier essai est utile, comparer les
deux binaires en quatre phases alternées, avec la même progression privée
et des caches préparés avant la série. Garder le mode 1 : ce correctif ne
qualifie pas le raccourci d'acquire du mode 2.

La construction complète passe 1 100 tests, quatre sont ignorés sans réseau.
Le callback éligible est observé dans le binaire réellement exécuté, puis
le marqueur et les sondes sont désactivés. Les quatre phases alternées
donnent 21,32, 20,21, 20,62 puis 19,93 images/s. Les mêmes 3 504 fichiers de
cache et de données privées sont restaurés avant chaque phase, puis le même
point Kokiri. Les fenêtres complètes totalisent 21,08 images/s corrigé contre
20,07 témoin, soit +5,05 % observés. La couverture reste inégale : 85,38
contre 119,586 secondes. Aucune image retenue ne dépasse 100 ms. Les images
avant et après, les déplacements et les arrêts sont vérifiés ; aucune
transition de zone ni qualification sonore n'est revendiquée. Ce petit gain
ne suffit pas pour 30 images/s et le moteur installé est conservé. Rapport :
`spikes/switch2-room/payload-release-2026-11-09.json`.

La vérification des dépôts à 12:47 relève ensuite
[le commit Lichii #1028](https://github.com/zortos293/Lichii/commit/0b83798bf6e7e2440568b7cf69646ae45d681b11),
publié à 12:05. Ses lectures asynchrones et copies anticipées visent une
attente pertinente pour Zelda, mais modifient 26 fichiers et les chemins
de durée de vie des rapports. Examiner leur composition avant de porter
#874 sur cette base. Un changement de révision ne doit pas se glisser entre
deux conditions d'une mesure. Eglantine reste inchangé à cette vérification.

### Qualification de la composition avec les lectures anticipées

La composition de #874 avec `0b83798bf` doit exclure aussi `is_synced` de
l'inscription des rapports différés. Le vrai test reliant les caches de
requêtes et de tampons au gestionnaire de clôtures reproduit une lecture
finale de 73 au lieu de 5 avec le port naïf. Après adaptation, 68 cas passent
et quatre mutants compilés échouent. La suite complète passe 1 140 tests,
quatre sont ignorés sans réseau. La preuve porte sur cette composition
déterministe et non sur toutes les courses du backend Vulkan.

Le diagnostic de 91,87 secondes compare 102 313 téléchargements et
204 800 descripteurs, sans désaccord ni octet attendu manquant. Les 22 986
octets réécrits exclus ne sont pas déclarés comparés. Les 677 517 reprises
d'uniformes prouvent l'exercice de la correction, sans oracle indépendant
supplémentaire. Une première qualification reste refusée parce que le filtre
de journal masquait le compteur de descripteurs ; la reprise corrige le
filtre, sans modifier le binaire. Les captures et arrêts sont vérifiés.

Après un essai de sélection à 25,06 images/s, les quatre phases appariées
alternent 24,85/19,46/23,22/19,81 images/s. Elles restaurent les mêmes
3 511 fichiers privés et la même progression avant chaque départ. Le total
des fenêtres complètes donne 24,17 contre 19,69, soit +22,74 % observés ;
les couvertures diffèrent, 124,11 contre 91,3998 secondes. Aucun gel retenu
ne dépasse 100 ms et les marches et arrêts sont normaux. Les sondes sont
absentes et aucune interférence connue n'est observée dans les échantillons.

Une capture présente un bonnet de Link dressé et étiré. Une ancienne image
a déjà une forme longue orientée autrement ; les poses ne sont pas appariées
et aucune cause ni régression n'est attribuée. Garder ce point ouvert, avec
la fidélité du monde sous `NO_MESH=1`, les zones, le son et les sauvegardes.
Le gain ne démontre pas 30 images/s et aucun moteur n'est installé. Le
rapport est `spikes/switch2-room/readback-2026-11-09.json` et les patches
sont décrits dans `spikes/switch2-room/amont/lichii-0b83798-readback-composed.md`.
Le prochain profil doit porter sur ce nouveau binaire sans les sondes GPU : l'ancien
profil ne décrit plus ses attentes ni son coût CPU restant.

Ce nouveau profil couvre ensuite tous les fils pendant 24,46 secondes,
avec 12 419 échantillons sans perte signalée. Les six cœurs invités prennent
environ 66,5 % des cycles, GPUBack 18,4 %, l'avant 8,6 % et le travailleur
Vulkan 4,6 %. Analyser les piles, le code invité et les passages par le
noyau avant de choisir une modification ; une part de cycles ne constitue
ni un temps d'attente ni une preuve du chemin critique. Les données brutes
restent privées. Rapport : `spikes/switch2-room/readback-cpu-profile-2026-11-09.json`.

La revue trouve 75,26 % des cycles sans chaîne d'appels exploitable, dont
89,83 % sur GPUBack ; les fonctions feuille du CLI sont identifiées, mais
pas tous leurs appelants. Une capture avec davantage d'octets de pile et
les symboles exacts doit réduire cette incertitude avant un nouveau patch.
Ne pas transformer des instructions inconnues de libc en coût de `memcpy`.

Le chemin `PhysicalCore::Idle` est néanmoins confirmé. Le réglage existant
de son attente active compare ensuite 0/100/0/100 microsecondes, même
exécutable et mêmes caches privés restaurés. La valeur mise en cache et
son initialisation sont lues avant chaque phase, puis le débogueur est
détaché. Les quatre passages donnent 25,82/25,02/25,65/24,57 images/s,
soit 25,74 contre 24,79 au total, +3,81 % observés. Chaque condition couvre
3 600 présentations, en 139,8684 contre 145,1916 secondes. Les marches et
arrêts sont normaux, sans gel retenu au-delà de 100 ms. Les compteurs des
six cœurs invités diminuent, sans désigner à eux seuls le chemin critique.
Le bonnet allongé apparaît dans les deux conditions. Zéro reste un réglage
du laboratoire ; aucune installation ni 30 images/s ne sont démontrés.
Rapport : `spikes/switch2-room/idle-spin-2026-11-09.json`.

Une seconde capture à 65 528 octets de pile garde 3 577 échantillons sur
GPU, GPUBack et VulkanWorker, pendant 24,45 secondes. Elle perd un bloc de
données. Les chaînes de GPUBack et GPU restent largement manquantes ;
augmenter la pile ne suffit pas à les attribuer. Ce relevé ne fournit ni
distribution complète ni mesure de cadence. Les images sont lues et l'arrêt
est normal ; le rapport CPU conserve cette limite.

La mise à jour amont [`0ab7736`](https://github.com/zortos293/Lichii/commit/0ab7736df9dba2b396d2c7a26bd26fbb9b7b0dc0)
ajoute le cache de shaders V2, après les diagnostics par image de
[`111d0c6`](https://github.com/zortos293/Lichii/commit/111d0c6ef559f3f1aebff6158b4cefd5afe34e26).
Une copie séparée conserve les mêmes correctifs locaux et le même compilateur.
Les nouvelles suites de tests des tâches de compilation et de traduction
s'ajoutent à la qualification. L'essai doit distinguer migration initiale,
cache peuplé puis redémarré, et exploration d'une nouvelle zone. L'amont lit
les anciens formats 54, 53 et 52 ; les premiers enregistrements de programmes
sont produits après la migration. Les files de compilation peuvent aussi
concurrencer le jeu lors des ratés de cache. Aucun gain de cette mise à jour
n'est encore mesuré, et la version installée est conservée.

Cette version passe ensuite ses tests et le diagnostic de migration.
Le premier redémarrage chaud reste noir après 125 secondes. Retirer seulement
le fichier binaire du pilote permet un passage à 25,99 images/s avec marche
au sol et arrêt normal. Ce seul essai ne prouve ni gain causal ni corruption
de ce fichier. Le cache V2 reste hors du candidat de référence ; le rapport
est `spikes/switch2-room/cache-v2-2026-11-09.json`.

L'événement CPU non précis conserve 1 801 échantillons sans perte et confirme
son attribut zéro dans le fichier enregistré. Les chaînes restent cependant
incomplètes. Les règles de l'exécutable exact récupèrent 283 premiers retours
ciblés ; le contrôle décalé de huit octets n'en valide aucun. Parmi eux,
les 115 échantillons de `WaitFor` viennent de `DmaPusher::Step` et de son
attente `WaitForWriters`. Leur part de 24,31 % des cycles du fil GPU concerne
ce profil à attente inactive de 100 microsecondes, sans prédire un gain de FPS.

La révision [`1a5e995`](https://github.com/zortos293/Lichii/commit/1a5e995a38679e0f4f7e320f9ec6a5a2f4e4ef1e),
fusionnée à 16 h 03, change précisément cette attente pour ne retenir que
les écrivains antérieurs à la dernière synchronisation hôte. Elle déplace
aussi les macros lisant la mémoire vers le fil arrière. Le port sélectif
sur `0b83798` corrigé conserve le mode 1 et exclut le cache V2. La construction
passe 1 145 tests, quatre tests réseau restant ignorés. Le contrôle de
sélection de position passe huit cas ; ancien helper et deux mutants échouent
sur les assertions attendues. Ce contrôle remplace l'attente par un enregistreur,
donc les tests avec le vrai fil et le diagnostic en jeu restent distincts.
Le diagnostic réel vérifie ensuite 101 614 téléchargements et 208 896
descripteurs sans divergence ni octet GPU attendu manquant. Les 32 259 octets
réécrits exclus restent séparés ; les reprises d'uniformes ne sont pas un
oracle indépendant. Les trois images sont lues et l'arrêt est normal.
La comparaison restaure le même état privé avant quatre phases alternées,
avec attente inactive à zéro et toutes les sondes absentes. Les résultats
donnent 26,94/26,26/26,97/26,12 images/s, soit 26,96 contre 26,19 au total,
+2,93 % observés. Chaque condition couvre 3 600 présentations, en 133,5558
contre 137,4636 secondes. Les marches et arrêts sont normaux ; les durées
de préparation diffèrent et le gain ne s'étend pas à toute une partie.
Les 30 images/s constantes restent non atteintes, et aucune nouvelle version
n'est installée. Rapport : `spikes/switch2-room/macro-back-2026-11-09.json`.

Le port précis [#1059](https://github.com/zortos293/Lichii/pull/1059) compare
ensuite les petits tampons contigus en place, en conservant notre garde
de reprise. La copie conservée alimente le tampon après allocation ; le test
qui fait écrire le jeu pendant cette allocation et son mutant vérifient
cet ordre. Les 60 tests ciblés et 1 148 tests complets passent. Le diagnostic
réel vérifie 97 774 téléchargements et 210 944 descripteurs sans divergence ;
les deux chemins sont effectivement observés, avec arrêt normal.
Les quatre phases donnent 26,60/26,65/27,25/26,94 images/s, soit 26,92
contre 26,80 au total, +0,47 % observés sur 3 600 présentations par condition.
Les couples évoluent en sens opposés et aucun gain utile répété n'est retenu.
Le coût du marqueur compilé mais désactivé reste non mesuré. #1056 reste
la référence ; les 30 images/s constantes restent non atteintes. Rapport :
`spikes/switch2-room/uniform-span-2026-11-09.json`.

Le contrôle suivant prépare le mode 2 avec une politique privée `Reference`.
Elle conserve le drainage du fil arrière et la lecture du miroir à chaque
acquisition et reprise, au lieu d'autoriser les décisions rapides connues
incorrectes. Les tests intégrés font échouer l'ancien code lorsque le mot
brut vaut 100 mais son miroir 5 ; ils vérifient aussi qu'une commande consommée
ne publie pas un compteur dont le travail hôte reste inachevé. Les deux cas
passent 107 assertions, l'ancien code et quatre mutations échouent sur les
assertions attendues, et les 86 cas de régression sous `Reference` passent.
Le matériel hôte reste simulé. La prochaine porte impose une construction
fraîche puis des contrôles positifs de lectures, descripteurs et registres
avant de comparer les modes 2 et 1 avec cette même politique. Aucun gain ni
30 images/s ne sont encore établis pour cette variante.

Le diagnostic réel refuse ensuite la qualification : 111 405 téléchargements
et 230 400 descripteurs sont vérifiés sans divergence, mais seize écarts
de mémoire miroir des registres apparaissent au chargement. Ce compteur
d'avertissements est plafonné ; le résumé ordinaire à zéro ne les inclut pas
et ne prouve pas leur disparition. L'arrêt est normal et aucune comparaison
de FPS n'est acceptée. La suite doit reproduire ces écarts, contrôler le
diagnostic lui-même et conserver un total du miroir même après le plafond
des avertissements. Rapport : `spikes/switch2-room/reference-acquire-2026-11-09.json`.

Le test ciblé reproduit une erreur du vérificateur : le miroir attendu
ignorait les écritures encore dans la file du moteur, puis la resynchronisation
pouvait remettre une ancienne valeur sur le premier fil. Le correctif projette
ces écritures sans les consommer et ajoute les totaux séparés non plafonnés.
Ses cinq mutations sont détectées ; 1 149 tests, 87 régressions et le test
séparé du journal passent. La preuve ne s'étend pas à tous les avertissements
observés. La reconstruction et le diagnostic réel doivent donc encore montrer
des contrôles positifs et les trois totaux à zéro avant toute mesure de FPS.
Cette porte passe ensuite : 117 940 téléchargements, 239 616 descripteurs,
17 472 contrôles dans la phase et les trois totaux à zéro dans les 346 résumés
depuis le chargement, avec arrêt normal. La comparaison alterne les modes
2 et 1 sur le même binaire, `Reference` actif dans les deux, sondes absentes.
Ses quatre phases donnent 29,84/26,18/29,76/26,32 images/s, soit 29,80
contre 26,24 au total et +13,57 % observés. Les deux couples vont dans le
même sens. La couverture diffère, 4 800 présentations en 161,088 secondes
contre 3 000 en 114,3456 secondes, et les durées de préparation varient.
Les marches, les arrêts et les vingt-quatre images sont vérifiés ; les
relevés ne montrent aucune CI, compilation ou profilage pendant les phases.
Le maximum du mode 2 reste 66,34 ms : ce n'est pas 30 images/s constantes.
Le candidat reste une base isolée, avec `NO_MESH=1` et les qualifications
de son, de zones et de sauvegarde reprise encore manquantes.
Un relevé séparé, sans vérificateur, garde huit fenêtres complètes par fil :
le fil arrière occupe 841,27 ms de CPU par seconde ; la préparation des
tampons couvre 183,78 ms de temps écoulé. Les compteurs sont des stages,
pas des copies, et les fils se recouvrent. Le relevé reste instrumenté,
sans conversion directe en gain de FPS. La valve naïve est écartée après
lecture des deux appels d'acquisition et des écritures CPU non notifiées.
La suite réévalue #1059 sur la base corrigée en mode 2 : c'est une autre
condition que son ancien essai sans gain utile en mode 1. Rapport :
`spikes/switch2-room/reference-cost-2026-11-09.json`.

La variante #1059 combinée passe 1 152 tests et le diagnostic réel du
mode 2 : 111 689 téléchargements, 247 808 descripteurs et 17 984 contrôles
de registres sans divergence, avec les deux chemins réellement observés
et un arrêt normal. La comparaison suivante alterne le port et la base
corrigée, tous deux en mode 2 avec `Reference`, sans sondes. Aucun gain
n'était encore retenu à ce stade :
`spikes/switch2-room/uniform-span-mode2-2026-11-09.json`.

Les quatre phases donnent ensuite 30,63/29,71/30,65/30,38 images/s,
soit 30,64 contre 30,04 au total, +1,99 % observés. Les deux couples
vont dans le même sens, avec préparations variables et couverture inégale
de 3 600 contre 4 800 présentations. Trois préparations sont exclues
avant mesure. Les vingt-quatre images, marches et arrêts sont vérifiés.
Le maximum reste 55,38 ms : moyenne supérieure à 30 ne signifie pas
30 images/s constantes. Le port devient la base isolée, sans installation.
La prochaine mesure vise les percentiles et les dépassements du budget
d'une image à 30 FPS, puis les déplacements et les changements de zone.
Le compteur historique a un biais commun reproduit d'environ 0,17 %
(600 intervalles divisés par 599) ; sa correction ne sera pas présentée
comme un gain de calcul. FPS Unlock et Max Resolution sont réellement
appliqués ; aucune génération d'images n'est active. La vitesse observable
de toute la logique et la fidélité sans `NO_MESH=1` restent à qualifier.
Rapport : `spikes/switch2-room/front-shadow-verify-2026-11-09.json`.

La vérification amont de 18 h 07 conserve séparément FSR 3.1 pour Zelda et
le nouveau cumul de couches de textures. FSR change le rendu et les transitions
vers le chemin natif restent à qualifier ; l'activation du nouveau cumul
de textures n'est pas démontrée à Kokiri. Aucun gain local n'est retenu.
Rapport : `spikes/switch2-room/upstream-refresh-1807-2026-11-09.json`.

La revue primaire de 20 h 21 vérifie Lichii `cb5c5c7c` et Superbuild v37.
Le port privé de la proposition [#1095](https://github.com/zortos293/Lichii/pull/1095)
est préparé : il réduit les appels lors des écritures de registres, un coût
présent dans le profil local. L'équivalence, l'activation réelle et une
comparaison alternée restent nécessaires ; aucun gain n'est encore retenu.
La [#1094](https://github.com/zortos293/Lichii/pull/1094) reste en revue :
sa seconde partie retire une attente sous une hypothèse sur les commandes
du jeu, sans inclure le diagnostic qui la contrôlait. Un port séparé de son
suivi par mots doit préserver les écritures et les reprises de lecture.
Le FSR 4 officiel est désormais lié au pilote AMD Windows ; il ne constitue
pas un port Linux utilisable ici. Les règles de réutilisation après clôture
de Dolphin et PCSX2, ainsi que les plages modifiées de Ryubing, guident
la revue sans prouver une accélération locale. Rapport :
`spikes/switch2-room/upstream-refresh-2021-2026-11-09.json`.

La sonde de régularité passe ensuite la construction et le diagnostic
réel, avec les 1 157 tests et les régressions. Sur quatre fenêtres entières
de caméra, 728 des 2 400 intervalles dépassent 33,333333 ms, soit 30,33 %,
maximum 58,10 ms. Les percentiles 99 par fenêtre vont de 47,13 à 54,45 ms.
Les bornes partagent une horloge monotone vérifiée. La clôture, la composition
et le régulateur de ce service ont des durées faibles ; cela ne mesure pas
toutes les attentes GPU. La suite garde le port #1095 comme candidat de
coût CPU et doit aussi relever un trajet au sol assez long pour contenir
des fenêtres complètes, puis une vraie transition de zone. La marche courte
déjà contrôlée n'est pas cette preuve. Rapport :
`spikes/switch2-room/present-pacing-2026-11-09.json`.

Le chemin mesh par calcul GPU des ports #569 et #841 rétablit ensuite
visiblement des fleurs et du feuillage, avec des groupes réellement dessinés
et sans nouveau message noyau GPU/reset pendant ce contrôle. `NO_MESH`
est absent. Le parcours prolongé reste refusé : il dérive vers un obstacle
puis une échelle. Ses mesures sont celles d'une phase mixte instrumentée,
pas un gain de cadence ou une longue marche libre. La prochaine trajectoire
doit prouver deux cycles réversibles avant sa prolongation. Le rendu complet,
les zones, le son et la reprise restent à qualifier :
`spikes/switch2-room/mesh-fallback-2026-11-09.json`.

La qualification #1095 doit aussi laisser le profilage GPU absent :
le constructeur désactive la répartition rapide quand celui-ci est actif.
Le coût historique de 208 ms/s de méthodes provient donc du chemin lent
instrumenté. Il ne chiffre pas l'économie possible du nouveau port dans
une partie sans profilage. Le diagnostic conserve les contrôles mémoire
indépendants et exige l'activation réelle de la branche testée.

Cette porte passe ensuite en jeu sur le binaire complet #1095 :
103 003 téléchargements, 205 824 descripteurs et 14 784 contrôles de
registres sans divergence, avec maillages dessinés et nouvelle branche
active. Les sondes liées au profileur restent indisponibles, pas validées
à zéro. La comparaison doit maintenant alterner port/témoin/port/témoin
sur les mêmes caches chauds de maillage, avec toutes les sondes absentes.
Elle utilisera le compteur corrigé dans les deux versions et ne sera
pas assimilée aux anciennes phases avec `NO_MESH=1`. Rapport :
`spikes/switch2-room/state-write-2026-11-09.json`.

La comparaison #1095 se termine à 29,806 contre 29,519 images/s,
soit +0,97 % observé. Les deux couples ne se répètent pas : +1,97 %
puis -0,06 %. Le port n'est pas retenu comme accélération prouvée.
Les douze images et quatre arrêts sont normaux ; les maxima de 55,53
et 66,63 ms restent trop élevés pour conclure à 30 FPS constants.
Une phase perturbée par une nouvelle CI est exclue. Le garde interroge
maintenant les files des quatre dépôts enregistrés par les cinq runners
locaux, puis surveille toujours les processus pendant la mesure.
La prochaine variante teste la résolution dynamique du jeu en désactivant
uniquement Max Resolution. Elle doit préserver FPS Unlock et démontrer
les dimensions ou la zone réellement dessinée, puis sa qualité visuelle.

Les deux contrôles suivants établissent cette réduction sur trois images
échantillonnées par variante : mêmes programmes 3D, cible, profondeur,
projection et rectangles de dessin à 2 560 × 1 440 avec Max Resolution,
1 920 × 1 080 sans lui. Certaines sorties restent en 1440p. Ce compromis
visuel a un effet réel sur les pixels dessinés, mais aucune vitesse n'est
déduite des traces. Les quatre passages suivants alterneront désactivé,
activé, désactivé, activé avec un état identique dont les caches incluent
les deux variantes. Le compteur d'intervalles sera actif dans les quatre
passages ; les autres sondes seront absentes. Il faut comparer les images
hors budget et les quantiles par fenêtre, sans moyenner leurs quantiles.
Le parcours libre, les zones, le son et la reprise restent à qualifier.
Rapport : `spikes/switch2-room/max-resolution-2026-11-09.json`.

La comparaison de résolution se termine sans gain stable retenu :
30,090 contre 29,507 présentations/s, couples +3,79 % puis -0,33 %.
Les dépassements du budget de 33,333333 ms restent à 32,24 % contre
33,50 %, avec des maxima à 76,32 et 61,36 ms. Les quatre arrêts sont
normaux ; ce sont des passages de caméra instrumentés, pas une validation
de marche, de vitesse du jeu ou de transport navigateur. La prochaine
option « No sharpening » doit être contrôlée séparément avec Max Resolution
actif, car sa copie exige des dimensions d'entrée et de sortie identiques.
Le marqueur doit annoncer une copie réussie ; une copie refusée ou une
image inattendue n'est pas une activation. Le lourd calcul intermédiaire
reste conservé tant que ses effets ne sont pas prouvés supprimables.

Le premier contrôle NoSharpening active une copie réussie en 1440p,
avec deux fenêtres à 32,16 présentations/s et 21,75 % d'intervalles hors
budget. C'est un diagnostic isolé, à comparer ensuite en alternance avec
les mêmes journaux et caches. La revue du fork BC-250 ne justifie pas
un port immédiat : sa barrière réduite ignore des producteurs possibles,
et notre relevé actuel ne contient aucun dessin de maillage vide. Les
rapports sont `spikes/switch2-room/no-sharpening-2026-11-09.json` et
`spikes/switch2-room/bc250-review-2026-11-09.json`.

La comparaison NoSharpening donne ensuite 32,056 contre 29,730, avec
+4,44 % puis +11,34 % par couple. Le gain de débit observé est conservé
comme piste privée, avec qualité à qualifier. Les dépassements du budget
restent à 23,21 % et un intervalle dépasse 100 ms : le plafond de présentation
à 30 doit maintenant être contrôlé sans toucher à la fréquence de l'événement
vblank à 60, à la vitesse de 100 %, au mot de présentation ou aux horloges.
Le code dort dans le fil invité du service de présentation ; cela ne prouve
pas à lui seul la vitesse normale de tous les mouvements et du son.
Cette prochaine expérience teste la régularité, pas un nouveau gain de calcul.

Le plafond à 30 s'active effectivement, avec vblank60, vitesse100 et mot
natif inchangés. Il donne 29,956 présentations/s, mais des p99 de fenêtre
entre 44,22 et 47,62 ms, maximum56,94ms. Ce contrôle isolé ne qualifie
pas une cadence constante. Son taux strict hors budget augmente autour
de la cible33,333ms ; les quantiles empêchent de le confondre avec de seuls
retards minuscules. La prochaine sonde relève les délais de réveil du fil
de temporisation et du service de présentation, sans activer le profilage
GPU qui modifierait la branche Maxwell. Ne pas essayer une valeur2 pour
FRAMES_AHEAD : le parseur de cette base la lirait comme0, pas deux images.
Rapport : `spikes/switch2-room/present-30-2026-11-09.json`.

HostTiming donne ensuite des réveils globaux à p99≤340µs et maximum2,924ms,
alors que les présentations restent à p99 44,53–46,14ms. Ces mesures ne
qualifient pas la reprise du fil invité après le minuteur. La trace DKB
reste refusée ici car elle ajoute des timestampsGPU et des lectures indirectes.
La prochaine instrumentation doit cibler le service et les retours Vulkan,
sans confondre un retour de `vkQueuePresentKHR` avec un balayage physique
ou une image au contenu distinct. Une option native de cadence à30 existe
aussi côté présentateur Vulkan ; son effet n'est pas encore mesuré.
La nouvelle #1143 sur les pointeurs après éviction reste à adapter séparément,
sans importer le cache v2 et sans gain FPS promis. Rapports :
`spikes/switch2-room/host-timing-2026-11-09.json` et
`spikes/switch2-room/upstream-refresh-2318-2026-11-09.json`.

La conception de ces deux sondes est ensuite revue et l'implémentation autorisée
sur une nouvelle copie privée. Leurs tests doivent couvrir les retours Vulkan
acceptés, refusés et les recréations, la première fenêtre de601retours puis les
suivantes de600, et l'ordre horodatage après retour. Une compilation complète
et l'activation réelle précéderont toute mesure. Ce sont des diagnostics,
sans changement du rythme ou des dépendances GPU :
`spikes/switch2-room/service-wsi-probe-2026-11-09.json`.

Le delta diagnostic est ensuite figé sur sept fichiers, avec quatre tests
CPU et treize mutations détectées. La première construction complète révèle
une collision avec la macroX11 Success, corrigée par un nom distinct et un
test qui conserve la macro. Les preuves sont régénérées ; la construction
et l'activation GPU restent à qualifier. Patch :
`spikes/switch2-room/amont/lichii-service-wsi-on-pacing.patch`.

La construction complète des sondes se termine ensuite normalement, CLI
`d4480279…854fe4`,1161tests réussis/4ignorés,87régressions et les contrôles
séparés verts. Les objets sont frais et le build est antérieur aux tests.
Le garde du pilote refuse désormais un build absent, incomplet, rouge ou
antérieur au gel des sources. Le premier essai GPU des sondes reste requis ;
ces contrôles CPU ne mesurent aucune cadence de jeu.

Le premier contrôle réel d448 prouve ensuite les deux activations, avec
30,0012 intervalles/s au service et29,9999 retours/s côté Vulkan. Les p99
restent toutefois45–47ms. Les82observations de sommeil positif donnent
0,016–0,574ms de dépassement, sans qualifier tous les réveils. Le contrôle
suivant, commencé le10novembre, active seulement frame_pacing_mode1,
le plafond existant côté présentateur Vulkan. Horloges, qualité, plafond
VI2 et sondes restent identiques. Rapport :
`spikes/switch2-room/service-wsi-runtime-2026-11-09.json`.

Le premier contrôle FramePacing1 du10novembre donne29,9869retoursVulkan/s,
p95 33,47–33,50ms etp99 33,62–36,41ms. La cadenceVI2 reste moins régulière.
C'est une tendance sur un diagnostic, sans gain de calcul ni preuve d'affichage
physique. La confirmation utilise quatre passages entièrement nouveaux1/0/1/0,
sans recycler les diagnostics préliminaires, avec seules différences de mode
et de son indicateur de valeur par défaut. Les métadonnées de fils seront
lues avant toute mesure, sans setters ni lecture d'allocateurGPU. Rapport :
`spikes/switch2-room/host-pacing-2026-11-10.json`.

La confirmation se termine ensuite sur quatre phases nouvelles, à état initial
restauré : cadence native 30, automatique, cadence native 30, automatique.
Chaque phase fournit 1 800 intervalles Vulkan complets, soit environ une minute
retenue sur 91 secondes de caméra. Leurs p99 de fenêtre sont de 33,58 à
36,30 ms avec le réglage et de 46,06 à 48,00 ms sans lui. L'effet se répète
dans les deux couples. Les maxima sont 43,52 et 43,17 ms avec le réglage,
contre 61,33 et 50,16 ms en automatique. Aucun intervalle retenu ne dépasse
100 ms. Nous ne calculons pas un percentile global à partir des percentiles
des fenêtres. Les moyennes restent voisines de 30 dans les quatre phases.

Les demandes VI2 restent moins régulières. Le réglage est donc conservé
pour les prochains essais privés, sans affirmer que le jeu calcule plus vite
ou que les images arrivent ainsi au navigateur. Les douze images ont été lues,
les soixante contrôles locaux ne signalent pas d'interférence et les quatre
arrêts sont normaux. Les masques CPU lus avant la première phase n'établissent
ni une résidence réelle ni un cœur exclusif ; aucune priorité n'est changée.
La configuration et les huit progressions habituelles restent identiques.
Rapport : `spikes/switch2-room/host-pacing-confirmation-2026-11-10.json`.

La prochaine qualification doit réellement quitter le point de départ au sol,
observer les lieux traversés, vérifier la vitesse du jeu et le son, puis
enregistrer et reprendre une progression privée. Une session assez longue
pour dépasser le seuil d'éviction des pipelines nécessite aussi de traiter
séparément le correctif amont #1143. Il conserve la classification des pointeurs
lorsqu'un pipeline évincé est traduit de nouveau ; aucun gain de FPS n'est
promis. Son port ciblé doit préserver la référence actuelle et éviter d'importer
le cache V2 qui a déjà échoué au redémarrage chaud.

Le port ciblé de #1143 est ensuite figé sur sept fichiers d'une nouvelle
copie. L'ancien producteur échoue après compilation ; cinq cas passent
85 assertions avec le port, et cinq mutations sont détectées. Les corps
réels d'éviction et de recherche sont exercés avec des remplaçants explicites
pour le pilote, sans prétendre reproduire une corruption d'image sur GPU.
La limite de 8 192 historiques et les anciens enregistrements disque déjà
incomplets restent des limites. La construction complète est en cours ;
aucun jeu n'est encore lancé sur ce nouveau binaire. Rapport :
`spikes/switch2-room/eviction-pointer-retention-2026-11-10.json`.

La construction complète passe ensuite : client `65defb74…`, 1 164 tests
réussis, quatre ignorés sans réseau, suites de régression séparées vertes.
Les 1 418 objets internes sont frais et le code natif confirme les chemins
de conservation. La qualification fonctionnelle peut commencer après un
contrôle frais de la machine. Chaque session garde une limite de 600 secondes,
préparation comprise, avec demande d'arrêt avant 510 secondes. Cette borne
laisse une marge pour l'arrêt normal ; elle n'atteste ni la visite d'un lieu
ni une éviction réelle, qui doivent être observées séparément.

Les trois sessions fonctionnelles suivantes confirment une sauvegarde manuelle
et son chargement explicite après arrêt, avec descente au sol et visite d'un
intérieur puis retour extérieur. Aucune nouvelle zone nommée ni fenêtre
complète de marche soutenue n'est validée : les commandes de déplacement
durent au plus six secondes. Un pilote dédié doit maintenant réserver
90 secondes au mouvement depuis le point sauvegardé après Saria.
Les 237 puis 171 évictions observées n'incluent aucun avertissement de pointeur
conservé ; elles ne démontrent pas une corruption corrigée dans la partie.
Rapport : `spikes/switch2-room/functional-qualification-2026-11-10.json`.

La revue séparée de Fritchii v5.5 trouve des pistes de préparation du cache
et de bornage des écritures de textures, sans gain local mesuré. Son mécanisme
de synchronisation à l'écran nécessite une source de fréquence encore propre
à Windows. Son compteur de fin de travail graphique sert à la réutilisation
des textures et dépend d'autres changements absents de notre base. Aucun port
ni rebase complet n'est retenu sur cette seule lecture :
`spikes/switch2-room/fritchii-review-2026-11-10.json`.

Le passage dédié de marche se termine ensuite : 90,002 secondes de petites
traversées latérales, avec vérifications visuelles avant, au milieu et après.
Les fenêtres Vulkan entièrement comprises dans cette phase couvrent
60,00003 secondes à 30,00 retours/s. Les p99 de fenêtre sont 34,218,
33,479 et 33,883 ms ; le maximum est 34,576 ms, sans intervalle au-delà
de 100 ms. La fenêtre qui recouvre l'unique capture intermédiaire est
conservée et signalée. Les deux autres couvrent 40 secondes, maximum
34,513 ms. Les fenêtres VI2 couvrent séparément 80 secondes, avec un
maximum de 48,90 ms. Aucun percentile global n'est reconstitué.

L'essai utilise le point manuel après Saria et les caches hérités des visites,
sans restauration du point initial de la comparaison caméra. Il ne prouve
donc ni un gain causal sur cette série, ni une longue traversée, ni le débit
de contenus distincts affichés. La suite qualifie les cinématiques et le son
par appariement avec leurs références privées, puis la salle navigateur
isolée. Aucun autre correctif de vitesse n'est choisi avant ces contrôles.
Rapport : `spikes/switch2-room/continuous-walk-2026-11-10.json`.

Le contrôle cinéma suivant conserve la configuration et emploie une copie
de données distincte. Douze paires audio/image acceptées couvrent 90,053 s
de temps réel, pour les positions 53 à 143 s de la source vidéo. Le son
et l'image progressent à environ une seconde de source par seconde réelle ;
les bornes conservatrices incluent 1 et excluent 0,5. L'écart son/image
de 0,067 à 0,151 s reste inférieur à l'incertitude conservée de 0,5 s.
Les sept rejets et l'image initiale non appariée restent explicites. Ce
contrôle ne prouve ni 60 contenus distincts, ni la fin du film, ni la vitesse
du monde 3D ou la synchronisation du navigateur.

Le passage à la salle doit maintenant reproduire le profil complet. Son
adaptateur impose encore split0 et NO_MESH1 ; changer seulement le chemin
du moteur invaliderait la qualification. Un nouveau paquet privé de lancement
doit préserver les manettes et les chemins de sauvegarde, refuser un binaire
inattendu et vérifier les réglages effectifs avant l'essai navigateur.
Rapport : `spikes/switch2-room/cinema-qualification-2026-11-10.json`.

Le premier lancement de salle isolée échoue avant le moteur : le Python
choisi par l'image ne trouve pas `evdev`, nécessaire au helper des manettes.
Les 120 secondes d'attente de la page ne donnent aucun résultat de jeu.
La prochaine porte est le lancement réel de ce helper avec quatre manettes
jetables et les permissions de production, dans une image dérivée qui garde
le client et le pilote graphique qualifiés. La première tentative et son
nettoyage restent dans
`spikes/switch2-room/browser-attempt-01-2026-11-10.json`.

La troisième tentative navigateur termine ensuite 90 secondes de commandes
continues et ferme normalement. Les quatre fenêtres Vulkan complètes donnent
29,8117 retours/s sur 80,505 secondes, avec un intervalle de 113,149 ms
dans la première. Les trois suivantes gardent un p99 entre 33,883 et
34,357 ms ; cette amélioration de régularité dans la fin du passage ne
supprime pas le premier à-coup. La mesure du service du jeu donne
29,8235/s et un maximum de 120,747 ms dans ses fenêtres propres.

Le son reçu et programmé progresse sans nouvelle coupure comptée ; les
commandes navigateur, le joueur, le spectateur et les arrêts sont vérifiés.
Deux clients Chromium décodent sur le serveur et occupent environ 1,67 cœur.
Ce coût ne prouve pas la cause du grand intervalle. Aucune comparaison
alternée ne l'isole. La capture du milieu recouvre la deuxième fenêtre,
et toutes les fenêtres restent retenues. Le profil reste privé ; la suite
doit explorer un décor différent et ses chargements avant une adoption.
Rapport : `spikes/switch2-room/browser-attempt-03-2026-11-10.json`.

L'intégration par titre passe ensuite dans une salle isolée qui utilise le
paquet copié pour installation : 90 secondes de commandes et 141 réglages
validés avant/après. Les trois fenêtres Vulkan complètes couvrent 61,422 s
à 29,3054 retours/s, maximum 65,824 ms, sans intervalle au-delà de 100 ms.
La différence avec le passage précédent n'est pas une comparaison causale.
Le profil est activé pour Zelda seul après sauvegarde des deux NAND et
vérification des huit progressions. Les autres titres conservent le moteur
global, sans redémarrage des salles. La cible reste 30 ; sa constance et
les chargements de toute la carte restent à résoudre. Preuves :
`spikes/switch2-room/browser-attempt-05-2026-11-10.json` et
`spikes/switch2-room/title-profile-installation-2026-11-10.json`.

La piste suivante cible les premières visites par préparation des programmes.
Le chemin complet Fritchii utilise des recettes absentes de cette base et
saute RADV par défaut. Son portage entier n'est pas retenu. La commande
existante `--build-warm` du client qualifié extrait en revanche 4 794
enregistrements de calcul dans un conteneur sans GPU. Le fichier v54 passe
une lecture structurelle complète, mais les 17 456 erreurs de membres et
18 conversions ignorées restent des limites de couverture. Aucune baisse
de saccades n'en est déduite. Le prochain essai privé doit compter les
pipelines effectivement compilés sur RADV, leurs échecs et leur réutilisation,
avant toute comparaison de cadence. L'option du profil installé reste à zéro.
Rapports : `spikes/switch2-room/precompile-review-2026-11-10.json` et
`spikes/switch2-room/warm-compute-preparation-2026-11-10.json`.

Le contrôle Vulkan privé suivant termine en 144,7 secondes, après suspension
de l'observateur automatique : 5 461 travaux réussis, un échec et aucun non
atteint. Les 783 graphiques et 4 679 calculs planifiés donnent une borne
d'au moins 4 678 calculs réussis. Le client ferme normalement et le cache
écrit passe de 17,04 à 128,28 Mo. Le marqueur reste présent malgré l'échec.
Un second démarrage doit maintenant vérifier lecture et reconnaissance,
avec mêmes dates, pilote et binaire. Le bénéfice en jeu devra ensuite être
comparé en phases alternées, avec précache désactivé des deux côtés pour
isoler le cache préparé. Le profil installé reste identique. Rapport :
`spikes/switch2-room/warm-gpu-attempt-03-2026-11-10.json`.

Le second démarrage termine normalement en 15,35 secondes : marqueur reconnu,
aucun calcul replanifié, un travail graphique tenté puis échoué. Le cache
Vulkan est lu au bon chemin, sans rejet observé ; les dates et empreintes
de la source sont préservées. Cela ne mesure pas les succès internes RADV.
La prochaine comparaison alterne caches d'origine et préparé, avec le
précache désactivé dans les deux cas, sur le même passage observable.
Rapport : `spikes/switch2-room/warm-gpu-reuse-01-2026-11-10.json`.
