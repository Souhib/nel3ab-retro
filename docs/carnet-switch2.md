# La Switch 2, de bout en bout

Cette partie du carnet rassemble le travail fait pour la Switch 2, du 7 au
21 novembre 2026. Souhib l'a demandée le 21 novembre, avant la suppression du
laboratoire, pour qu'on puisse reprendre ce chantier plus tard. Elle ne remplace pas le récit jour
par jour du [carnet](carnet-de-bord.md) (lignes 16898 à 24947), le
[plan Zelda](plan-60fps-switch2-2026-11-08.md) ni
l'[étude du 7 novembre](etude-switch2-2026-11-07.md). Chaque section renvoie
aux lignes qui portent les chiffres complets. Les numéros de ligne sont ceux
du 21 novembre.

Le laboratoire occupait environ 184 Go sous `~/.local/share/nel3ab/nx2-lab`
et 89 Go sous `~/.local/state/nel3ab/test-switch2-*`. Ces dossiers sont
supprimés le 21 novembre. Leurs preuves textuelles sont archivées (section 5).

Quelques mots reviennent partout.

- Le jeu étudié est Zelda Ocarina of Time, édition Switch 2 : base
  `0400486024DEC000`, mise à jour `131072`. Kokiri est la forêt où commence la
  partie. Saria est un personnage de ce village ; la plupart des mesures se
  font devant elle.
- Un émulateur fait tourner le jeu sur le serveur ; on l'appelle aussi le
  moteur. Tous les moteurs essayés lancent un programme nommé `eden-cli`, du
  nom du projet Eden dont ils dérivent.
- FPS (*frames per second*) veut dire images par seconde. Seules comptent les
  images calculées par le jeu, pas les images dupliquées ou générées.
- Un gel est une image qui reste affichée bien plus longtemps que les autres.
  Le seuil habituel est 100 ms.
- Le serveur lgf a un processeur (CPU) Ryzen 5 3600 à six cœurs et douze fils,
  64 Gio de mémoire et une carte graphique (GPU) Radeon RX 6650 XT de 8 Gio.
  Le moteur dessine avec Vulkan, l'interface de programmation des cartes
  graphiques. Le pilote est RADV, le pilote Vulkan libre des cartes AMD, livré
  par Mesa (étude, l. 532 à 537).

## 1. Où en est la Switch 2 le 21 novembre

### Ce qui est installé et fonctionne

- La console est décrite dans `consoles/consoles.json` sous le code
  `switch2`. Elle prend un joueur et des spectateurs, accepte les fichiers
  `.nup` et porte les drapeaux `experimental` et `playable`. Elle partage le
  groupe de verrou de la Switch : une salle Switch et une salle Switch 2 ne
  tournent jamais ensemble, car les deux moteurs ne tiennent pas ensemble sur
  la carte graphique (champ `why.lock`).
- Un seul jeu est inscrit : Zelda, dans `~/roms/switch2`, avec sa fiche
  `The Legend of Zelda Ocarina of Time.nup.nel3ab.json`. Un NUP (*NX Package*)
  regroupe le jeu et sa mise à jour en un fichier que le moteur lit
  directement. Mario Tennis Fever n'est pas inscrit. Son NUP, qui n'existait
  que dans le laboratoire, a été rangé le 21 novembre hors des salles, dans
  `~/roms/hors-salle/switch2/`, avec sa fiche. L'archive d'origine
  `Mario-Tennis-Fever-Switch-2.rar` est aussi dans le dossier personnel.
- L'adaptateur `docker/switch2-room.py` lance le moteur dans un conteneur
  Docker. Il reprend l'affichage, la capture et l'arrêt de la salle Switch
  (`docker/switch-room.py`). Sa configuration privée est
  `~/.config/nel3ab/switch2.json`, désignée par `NEL3AB_SWITCH2_CONFIG`
  (`deploy/nel3ab-worker@.service`, l. 95).
- Cette configuration nomme deux moteurs. Le triplet global (image Docker,
  moteur, révision) reste Eglantine `216d3e2943` dans l'image
  `nel3ab/switch-prototype:2026-09-08-recovery`. Il servirait tout autre titre
  Switch 2. La table `engines_by_title` donne à Zelda seul le moteur Lichii
  `65defb74` : révision `lichii-65def-30-target-20261110`, image
  `nel3ab/lichii-browser-evdev:2026-11-10`. Cette sélection est active depuis
  le 10 novembre à 04:21 UTC.
- `65defb74` est le début de l'empreinte SHA-256 de l'exécutable ELF, le
  format des programmes sous Linux. Ce n'est pas un commit.
- Le paquet Zelda lance d'abord un petit programme Python (`usr/bin/eden-cli`),
  puis le vrai exécutable (`usr/libexec/eden-cli`). Ce lanceur refuse un
  exécutable ou une politique dont l'empreinte diffère. Il retire toutes les
  variables `EDEN_NX2_*` posées par l'adaptateur, dont `EDEN_NX2_NO_MESH=1` et
  `EDEN_NX2_SPLIT=0`. Il applique ensuite le profil figé de
  `qualified-policy.json`.
- Ce profil plafonne le jeu à 30 images par seconde (`fps_limit=30`), avec le
  plafond tenu côté présentation Vulkan (`frame_pacing_mode=1`). Il répartit
  le traitement graphique sur deux fils (`EDEN_NX2_SPLIT=2`). Il garde la
  politique d'attente prudente du laboratoire
  (`EDEN_NX2_REFERENCE_ACQUIRE=1`). Il dessine les maillages par un programme
  de calcul (`EDEN_NX2_FORCE_MESH_FALLBACK=1`) au lieu de les omettre. Il coupe
  le filtre de netteté (`oot_anti_aliasing=1`, l'option « No sharpening »).
  Il garde les fils graphiques épinglés (`pin_gpu_threads=true`).
- Chaque titre et chaque emplacement ont leur NAND sous
  `~/.local/state/nel3ab/switch2/<titre>/<emplacement>/`. La NAND est la
  mémoire persistante de la console émulée. L'adaptateur la copie dans
  `backups/` après la sortie du moteur. Depuis le 10 novembre, « reprendre »
  et « partie neuve » visent l'emplacement personnel du compte qui lance. Ils
  s'appellent « ma sauvegarde » et « nouvelle partie » depuis le 22 novembre.
  Depuis le 21 novembre, la copie chiffrée horaire vers le NAS (restic)
  couvre aussi la Switch 2.
- La boîte noire reconnaît `eden-cli` depuis le 7 novembre, sous le rôle
  `switch2`. Depuis le 14 novembre, elle juge une chute de Zelda sous
  27 images par seconde, soit 0,9 fois son plafond. Elle ne garde plus son
  profileur roulant sur ce moteur.

Sources : étude, l. 767 à 795 ; ADR, « Switch 2 experimental adapter »
(l. 1255) et « Per-title Switch 2 engine selection » (l. 1455) ;
`spikes/switch2-room/README.md`, l. 130 à 190 ; carnet, l. 20100 à 20159,
24174 à 24226 et 24926 à 24947.

### Ouvrir une salle Switch 2

1. Dans le salon, ouvrir une salle et choisir Zelda dans la console
   « Switch 2 ». La fiche du jeu garde la mention expérimentale.
2. Celui qui lance reçoit la seule manette, la place 1. Les autres pages
   regardent. Une demande de seconde manette est refusée.
3. Choisir « ma sauvegarde » ou « nouvelle partie » (noms du 22 novembre
   2026 ; avant : « reprendre » et « partie neuve »). Seul à jouer, ce choix
   lance le jeu sans panneau de préparation. Zelda n'a pas d'option « tout
   débloqué » : aucun import complet n'a été qualifié (carnet, l. 20338
   à 20358).
4. Le moteur met 14 à 15 secondes à donner sa première image (carnet,
   l. 24049).

Pour ajouter un autre jeu Switch 2, il faut poser son NUP dans
`~/roms/switch2` avec une fiche `<jeu>.nup.nel3ab.json` écrite à la main
(modèle dans `spikes/switch2-room/README.md`, l. 173 à 183). L'import par la
page classe un NUP « à confirmer » (carnet, l. 25875). Ce jeu recevrait le
moteur global Eglantine, avec ses objets omis, tant que `engines_by_title` ne
lui donne pas un autre moteur.

Vérification isolée, sans toucher la salle installée :
`NEL3AB_TEST_SWITCH2_CONFIG=... just switch2-room-test '/chemin/zelda.nup'`.
Chaque passage crée un dossier jetable `~/.local/state/nel3ab/test-switch2-*`.
`just switch-saves-test` exerce les fichiers de l'adaptateur et le lecteur de
mesures.

### Ses limites mesurées

- Le plafond est 30, pas 40. Dans les salles isolées du 10 novembre, avec
  navigateur, le moteur rend 29,31 à 29,81 retours de présentation Vulkan par
  seconde. Un retour de présentation est une image remise à l'affichage,
  comptée à l'appel Vulkan. Le p99 de fenêtre, la durée sous laquelle restent
  99 % des intervalles, va de 33,9 à 48,4 ms. Un passage contient un
  intervalle de 113 ms (carnet, l. 20047 à 20142).
- Un pipeline est le programme complet que la carte exécute pour un type de
  dessin ; le pilote le compile la première fois qu'il sert. À la première
  visite d'un lieu, cette compilation gèle l'image de 0,3 à 0,56 s (carnet,
  l. 23585 à 23655).
- Après cinq minutes sans bouger, le retour coûte une seconde qui perd 320 à
  390 ms (carnet, l. 23864 à 23869).
- Le moteur installé passe parfois dans un « état coûteux ». Son fil GPUBack
  y coûte 4 % de plus, et la cadence tombe à 29,4 à 29,6 si la boîte noire
  profile. La cause n'est pas désignée (carnet, l. 24053 à 24059 et 24310
  à 24371).
- Un transcodage Jellyfin qui incruste des sous-titres image (PGS) fait tomber
  le jeu à 13 images par seconde (carnet, l. 23515 à 23537). Souhib ne veut
  pas qu'on touche à Jellyfin.
- Un seul joueur. C'est une limite de notre adaptateur, pas de la console.
- Le dessin des maillages par calcul fait revenir fleurs et feuillage. La
  fidélité du monde entier n'est pas qualifiée (plan, l. 2629 à 2637).
- Aucun changement de zone avec écran de chargement n'a été mesuré.

### Ce que « expérimental » veut dire ici

Souhib a décidé le 21 novembre de garder la Switch 2 dans les salles, marquée
expérimentale (carnet, l. 24907). Le manifeste porte `experimental: true` et
sa raison. On peut jouer à Zelda près de 30 images par seconde, avec des gels
possibles. Rien ne garantit une partie entière sans défaut. Aucun travail sur
le moteur n'est en cours ni prévu (plan, section « Mis de côté le
20 novembre », l. 8 à 16).

## 2. Chronologie

### 7 novembre : premier démarrage, choix d'Eglantine

- Souhib demande d'essayer quatre versions publiées, puis d'intégrer celle qui
  permet une partie satisfaisante. Les quatre sont des AppImage, un format qui
  range un programme Linux et ses bibliothèques en un seul fichier : Lichii 95,
  Lichii 93, Eglantine du 7 novembre et Superbuild v11. Chacune est identifiée
  par son empreinte SHA-256.
- Eglantine passe les films d'introduction. À la première scène 3D, il perd
  la carte (`VK_ERROR_DEVICE_LOST`), et le noyau redémarre le GPU à
  14:00:16 UTC. Le conteneur protège les fichiers, pas la carte graphique.
- Contournement : `EDEN_NX2_NO_MESH=1` saute les dessins faits par mesh
  shaders, des programmes qui construisent la géométrie sur la carte. Des
  objets manquent à l'image.
- Deux tours alternés de 90 s de caméra partent de la même sauvegarde, sur le
  balcon de la maison de Link. Résultats : Lichii 95 à 13,56 puis 19,56 (un
  autre projet chargeait la machine au premier tour), Lichii 93 à 19,9,
  Eglantine à 22,0 et 22,1, Superbuild à 17,9 et 18,1, avec des aplats bleus.
- Pour le film d'introduction, la position du son est retrouvée dans le
  fichier sonore original. Les trois autres moteurs finissent avec environ
  36 s d'avance du son. Eglantine reste dans l'incertitude de 0,5 s.
- Eglantine `216d3e2943` est retenu et installé le jour même. Le catalogue
  reçoit Zelda dans « Switch 2, expérimental », avec un seul joueur.
- Le raccordement découvre trois défauts. L'actualisation du salon rendait
  les manettes occupées au mode solo. Le registre recalculait les ports
  installés pour un salon privé. Le moteur écrivait ailleurs si le dossier de
  sauvegarde n'existait pas encore. Chacun est corrigé avec un essai rouge
  d'abord.

Sources : carnet, l. 16898 à 17014 ; étude, l. 532 à 795 ; ADR, l. 1255
à 1290 ; `results-2026-11-07.json`, `audio-2026-11-07.json`,
`saves-2026-11-07.json`.

### 7 novembre au soir : premier retour de partie, Mario Tennis Fever

- Souhib trouve les films presque corrects, puis des saccades au chargement de
  la carte. Son journal contient une image de 3,6 s. La capture reste récente :
  le gel naît dans le moteur, avant le transport.
- La boîte noire ne connaissait pas `eden-cli`. Elle croyait le serveur au
  repos et lisait l'allocateur de mémoire graphique pendant la partie. En
  septembre, ces lectures avaient déjà causé des pauses. Corrigé avec essai
  rouge et jumeau négatif.
- Mario Tennis Fever (`0400D4201C6EA000`, mise à jour `327680`) atteint un
  match libre et son résultat, à 44,43 images par seconde. Mario et sa raquette
  disparaissent par moments. Le moteur sort deux fois avec le code 139, un
  accès mémoire invalide dans son fil GPU, avec et sans `NO_MESH`. Le jeu
  n'est pas inscrit.
- Couper la synchronisation réactive donne 22,54, 22,47, 22,66 et 22,57 :
  aucun gain. Le mode portable donne 22,74, sur un seul passage.
- Les 372 587 fichiers du NUP Zelda sont stockés sans compression. Cela écarte
  une décompression au niveau du NUP, pas à l'intérieur des fichiers.

Sources : carnet, l. 17016 à 17100 ; étude, l. 797 à 941 ;
`fever-2026-11-07.json`, `zelda-flushing-2026-11-07.json`.

### 8 novembre : paquets publiés, profil du moteur, trois prototypes

- Le paquet PGO d'Eglantine sort du même commit. PGO (*Profile-Guided
  Optimization*) veut dire compilation guidée par des profils d'exécution. Il
  passe de 22,68 à 23,96 (+5,7 %). Une fermeture sort en 139, et le plantage
  ne se reproduit pas. Le paquet standard reste installé.
- Lichii 117, standard et PGO, reste sur un écran uniforme avant le menu,
  cinq fois sur cinq, avec `NO_MESH`. Un sixième lancement est invalidé : le
  lecteur de configuration exige `default=false` à côté de chaque valeur.
- La branche Eglantine `nx2-experimental`, commit `eab2c2246d`, gagne 4,1 % en
  PGO. Elle n'est pas installée.
- Orchid 0.9.0 joue deux matchs complets de Tennis Fever à 45,5 images par
  seconde, avec des glyphes incomplets. Sur Zelda, il laisse le monde noir ou
  flou et refuse des programmes graphiques.
- Souhib accepte qu'on modifie un émulateur. Dans le profil d'Eglantine, le
  fil « GPU », qui prépare les commandes pour la carte, occupe 94 % d'un cœur.
  Les modes de répartition 0, 1 et 2 donnent 20,64, 20,61 et 20,72 : aucun
  gain.
- Trois prototypes du code source d'Eglantine `216d3e2943` sont essayés. Une
  attente par notification coûte 2,65 % de cadence, mais fait tomber le fil
  avant de 80 à 37 % d'un cœur. Une lecture des arguments MME sans vidange
  complète gagne 1,70 %. MME (*Macro Method Expander*) désigne les petits
  programmes de la console qui produisent des commandes graphiques. Un résumé
  des pages propres perd 4,61 %. Aucun n'est installé.
- Diviser la résolution par deux change la cadence de −0,23 % : aucun gain.
- Une sonde GPU par lots coûte 2,74 % quand elle est active. Elle donne
  24,87 ms d'exécution médiane par capture.
- Le plan vers 60 est écrit. Une image coûte 48,44 ms, et 60 images par
  seconde en demandent 16,67.

Sources : carnet, l. 17102 à 17888 ; étude, l. 1 à 530 et 944 à 1013 ; plan,
l. 1307 à 2057 ; `pgo-`, `experimental-`, `orchid-zelda-`, `split-`, `drain-`,
`mme-snapshot-`, `buffers-` et `coarse-gpu-2026-11-08.json`.

### 9 novembre : viser 30 régulières, passer à Lichii

- Souhib fixe l'objectif : 30 images par seconde régulières, sans accélérer
  le jeu ni générer d'images.
- Eglantine 0.1.0-rc3, commit `78743f30c`, gagne 5,26 %. Sur cette base, le
  regroupement des copies de listes gagne 4,33 %. Mesa 26.2.6 perd 1,5 %.
  Placer le fil graphique seul sur un cœur donne 20,22 contre 23,32 : écarté.
- La même base est compilée avec Clang 23, le PGO, LTO et la cible Zen 2. LTO
  (*Link-Time Optimization*) veut dire optimisation à l'édition de liens. Le
  résultat est 23,07, puis 24,41, sans alternance. Le mode performance du
  pilote gagne environ 4,6 %, mais la fermeture sort en 139.
- Un anneau d'envoi en mémoire système donne 22,14 contre 23,29 : écarté.
  Conserver les banques de constantes gagne 7,79 % ; la piste reste privée.
- Lichii 125, Superbuild v31 et Orchid 0.9.1 sont essayés. Orchid 0.9.1
  refuse 111 programmes graphiques.
- À partir de 11 heures, la base devient Lichii `986a2b684`. Chaque port est
  compilé, testé, activé puis alterné :
  - #874 gagne 5,05 % ;
  - sa composition avec la lecture asynchrone `0b83798bf6` (#1028) gagne
    22,74 % ;
  - l'attente inactive à zéro gagne 3,81 % ;
  - #1056 (`1a5e995`), qui déplace des macros sur le fil arrière, gagne 2,93 % ;
  - la politique `Reference` en mode 2 gagne 13,57 % contre le mode 1 ;
  - #1059 en mode 2 gagne 1,99 %, à 30,64.
- #1095 gagne 0,97 % sans se répéter : non retenu. Couper Max Resolution ne
  donne pas de gain stable. « No sharpening » donne 32,06 contre 29,73
  (+7,8 %) et reste dans le profil.
- La sonde de régularité trouve 30,33 % d'intervalles au-delà de 33,3 ms. Le
  plafond à 30 donne 29,96, mais avec des p99 de 44 à 48 ms.
- Le chemin de maillage par calcul (#569 et #841) rend les fleurs et le
  feuillage, sans nouveau redémarrage de la carte.

Sources : carnet, l. 17889 à 19655 ; plan, l. 2059 à 2794 ;
`readback-`, `reference-cost-`, `front-shadow-verify-`, `no-sharpening-`,
`state-write-` et `mesh-fallback-2026-11-09.json`.

### 10 novembre : régularité, salle navigateur, installation

- Le plafond côté Vulkan (`frame_pacing_mode=1`) resserre les p99 de fenêtre
  à 33,58 à 36,30 ms, contre 46,06 à 48,00 en automatique, dans les deux
  couples.
- Le port #1143 garde les pointeurs après l'éviction d'un pipeline. Il donne
  l'exécutable `65defb74`, avec 1 164 tests natifs réussis.
- La qualification fonctionnelle passe trois contrôles : une sauvegarde et sa
  reprise, 90 s de marche à 30,00 images par seconde (p99 de 33,5 à 34,2 ms),
  et une cinématique dont le son reste dans l'incertitude de 0,5 s.
- Cinq salles navigateur privées suivent. La première échoue : `evdev` manque
  dans le Python de l'image. Dans la deuxième, le pilote d'entrées sort avec
  le code 143, sans rapport. La troisième termine à 29,81, avec un intervalle
  de 113 ms. La quatrième entre dans une maison. La cinquième passe par la
  vraie sélection par titre, à 29,31.
- L'adaptateur reçoit `engines_by_title`. Les NAND des deux emplacements sont
  copiées (22 fichiers). La configuration est ensuite remplacée à 04:21 UTC,
  pour Zelda seul.
- Le client sait préparer des programmes de calcul avant une visite
  (`--build-warm`). Le pilote réussit 5 461 travaux et en échoue un. Le gain
  en jeu n'a jamais été mesuré.

Sources : carnet, l. 19656 à 20313 ; plan, l. 2767 à 2944 ; ADR, l. 1455
à 1487 ; `host-pacing-confirmation-`, `eviction-pointer-retention-`,
`browser-attempt-01` à `-05` et `title-profile-installation-2026-11-10.json`.

### 10 novembre après l'installation : vrais freezes, objectif relevé à 40

- Pendant la partie de Souhib, la vitesse est satisfaisante. Les freezes sont
  fréquents en marche, dont un intervalle de 1,565 s.
- Les sauvegardes deviennent personnelles par compte. L'option « tout
  débloqué » exige désormais un reçu d'import.
- Le préchargement de tous les pipelines (`EDEN_NX2_PRELOAD_ALL_PIPELINES=1`)
  met 2 525 programmes en préparation. Le processus atteint 11,63 Gio de
  mémoire. Le gain n'est pas mesuré ce jour-là.
- Une série sur l'affinité CPU est retirée : Jellyfin utilisait la carte
  pendant ses quatre phases. Un contrôle des vrais clients de la carte
  (`spikes/switch2-room/gpu_clients.py`) précède désormais chaque essai. La
  série refaite montre que libérer les cœurs coûte 17,06 %, puis 8,20 %.
- Le soir, Souhib relève l'objectif à au moins 40 images par seconde
  constantes. Sans plafond, le moteur installé donne 29,37.
- D'autres pistes sont essayées sans gain. Une sonde de soumission est posée
  sur `65defb74` (binaire `be3c43fb`). Le regroupement 1245 et 1246 (binaire
  `d7df6092`) donne +2,43 %, puis −3,14 %. La revue du 1225 reproduit un défaut
  d'invalidation sur CPU, et le binaire n'est jamais lancé.

Sources : carnet, l. 20315 à 21649 ; plan, l. 927 à 1272.

### 11 novembre : des ports à 3 %, puis une pause

- Le port composé 1058 et 1244 (binaire `c686c1ff`) gagne 2,0 %, puis 3,1 %.
- Le profil montre que GPUBack passe 17,96 % de ses cycles dans des copies,
  dont 12 % dans `ReadBlockUnsafe`.
- Le placement mémoire des envois (binaire `13158042`) gagne 5,66 %, puis
  3,96 %. Il devient la référence privée.
- Trois ports ne donnent pas de gain répété : le 807 (`cfec5c81`, +3,00 % puis
  −1,99 %), la sonde d'horodatage (+1,29 % puis +0,34 %) et le 1095
  (`32d0a6fd`, −1,51 % puis +1,19 %). Le 1095 avait déjà été essayé le 9.
- Le 1329 (`17ebf0c6`) passe son contrôle fonctionnel. Un `ffmpeg` extérieur
  interrompt son premier témoin, et la comparaison n'est jamais faite.
- Une « partie neuve » lancée à 14 h 21 avait mis de côté la progression de
  Souhib. Ses quatorze fichiers sont remis avec son accord.
- Souhib demande une pause. La consigne de reprise est écrite en tête du plan.

Sources : carnet, l. 21650 à 23326 ; plan, l. 436 à 925 ;
`uploadhost-comparison-`, `cachepad807-comparison-`,
`statewrite1095-coldlog-comparison-`, `emptyflush1329-preparation-` et
`save-recovery-2026-11-11.json`.

### 12 novembre : audit indépendant et nouvel instrument

- Souhib confie la suite à un autre assistant, avec une consigne : ne rien
  croire sur parole. Dix-huit lecteurs relisent tout, sans lancer de jeu.
- Ils trouvent que la partie du 11 partageait la carte avec deux transcodages
  Jellyfin.
- Ils trouvent aussi que le banc à vue fixe ne pouvait pas voir les gels. Il
  comptait zéro intervalle de plus de 100 ms sur vingt phases ; les vraies
  parties en comptaient 64 et 68.
- Le fil GPUBack occupe 88,6 à 89,3 % d'un cœur. Sans réduire son travail, la
  cadence ne peut guère dépasser 31 images par seconde. Les ports à 3 %
  étaient donc sous le bruit de mesure.
- La carte est branchée sur l'emplacement du chipset, en PCIe 3.0 sur quatre
  lignes. La température interne du processeur (Tctl) vaut 86,8 °C en
  médiane pendant le jeu.
- Nouvel instrument : `nx2probe.py`. Il lance le moteur seul, vérifie la
  scène et mesure le coût de GPUBack par image. Son bruit en comparaison A/A
  (deux lancements identiques) est de 0,18 %. Deux relecteurs y trouvent dix
  défauts avant tout usage.
- La série 1 compte trois essais :
  - a-jellyfin : l'incrustation PGS coûte 57 % ; décoder et encoder par le
    matériel seul coûte 1 à 3 % ;
  - b-gels : la première compilation d'un pipeline est la cause des gels,
    prouvée par intervention ;
  - c-bornes : ralentir le seul cœur de GPUBack de 33 % coûte 19 à 20 % de
    débit. Tenir 40 demande 19 à 23 % de travail en moins sur ce fil. Aucun
    réglage de la machine n'y arrive.
- La machine n'était pas au repos : minuteries, mise à jour automatique,
  rafraîchissement de la bibliothèque Jellyfin.
- Souhib tranche : ne pas dégrader Jellyfin, laisser la carte où elle est,
  autoriser Lichii build 160.
- L'essai d-stabilite montre que le préchargement retire l'accroc du retour
  de pause. Il coûte 0,7 s au démarrage.

Sources : carnet, l. 23328 à 23855 ; plan, l. 344 à 434.

### 14 novembre : série 2 et décisions de Souhib

- La relecture de d-stabilite garde six affirmations sur dix.
- e-priorite : en priorité haute sur la carte, le jeu est perdu deux fois sur
  deux. Mettre le film en priorité basse remonte le jeu à 18,7.
- f-build160 : le binaire officiel n'a pas pu être lancé.
- g-marge : le profileur roulant de la boîte noire coûte 2,5 à 3 % à GPUBack.
  Un cœur réservé lui fait gagner 1,9 à 2,5 %. Le moteur montre deux états.
- h-mprotect : le surcoût est fait de 408 à 437 changements de protection de
  la mémoire par image.
- i-reactive : couper `use_reactive_flushing` coûte 2,4 %. Le réglage de la
  production est le bon.
- Souhib dit oui à la boîte noire, installée à 18:26 UTC. Il dit oui à une
  retouche du moteur et à la compilation de toute version. Il demande de ne
  pas toucher à Jellyfin.
- j-pages : laisser ouvertes les pages réécrites (binaire `9b70df2e`) gagne
  0,6 % avec une garde. Sans garde, la cadence tombe à 13 images par seconde.

Sources : carnet, l. 23857 à 24264 ; plan, l. 220 à 342.

### 17 et 18 novembre : redémarrage, rejet, veille, amont compilé

- L'agent de qualification s'est arrêté le 14 à 22:49 UTC. La machine
  redémare le 17 sur le noyau 7.0.0-43, au lieu de 7.0.0-38. Les chiffres
  d'avant ne se comparent plus directement.
- k-qualif : le candidat des pages coûte 0,8 % de plus. Un essai unitaire y
  montre un défaut de justesse. Il est écarté.
- l-etat-couteux : forcer les petits tampons uniformes par le cache donne
  21,5 images par seconde. Ce n'est donc pas l'état coûteux. Les binaires de
  diagnostic sont `ff4c88bd` et `0c11bbad`. La chasse ne rencontre pas l'état
  coûteux en onze lancements. Référence de l'état bas : 28,41 à 28,57 ms par
  image.
- La veille répond à la question d'écrire notre propre émulateur : non.
  L'amont a fusionné 447 demandes depuis le 11. La 1436 décrit et retire
  l'aller-retour de l'état coûteux. Nintendo a fait retirer plusieurs dépôts,
  dont Citron.
- Les dépôts Lichii et Eglantine sont copiés en entier sur la machine.
- m-amont341 : le build 341 et la tête `nx2` sont compilés avec la recette du
  moteur installé. Sans plafond, ils donnent 34,5 images par seconde contre
  31,3 (+10 %). GPUBack y coûte 27,1 ms par image ; il manque encore 8 à 14 %
  pour 40.
- NSP-Box est un outil Windows d'emballage, pas un émulateur.
- Le soir, sous le plafond de 30, les deux moteurs rendent 30,00. L'amont
  consomme 17 % de processeur en moins. À cache vide, il fait un intervalle de
  plus de 100 ms contre treize pour le moteur installé. Il ne détruit plus de
  programmes pendant une pause. Il montre pourtant trois gels de 430 à 456 ms.
  Le trajet vers la maison de Link échoue six fois sur six.

Sources : carnet, l. 24266 à 24653 ; plan, l. 92 à 218.

### Nuit du 18 au 19 novembre : les gels de l'amont

- Les gels sont propres à l'amont. Avec ses réglages par défaut, il gèle
  41 trajets sur 152. Le moteur installé gèle 0 trajet sur 12 dans la même
  alternance.
- Un gel a une signature unique. Le moteur recrée une série de cinq images de
  texture. La quatrième allocation dure 17 à 23 ms. 190 à 290 Mio partent dans
  la mémoire du PC. Le moteur attend ensuite la carte 0,45 à 0,51 s.
- La lecture « la carte est pleine » est réfutée. La cause désignée est la
  règle de rétention de l'amont : il garde les images récentes jusqu'à
  8 117 Mio, pour un budget de 8 146.
- Une marge de 1 024 Mio sous cette limite (binaire `de845859`) donne
  0 trajet gelé sur 72, contre 9 sur 64 pour le témoin. Par lancement, c'est
  0 sur 12 contre 4 sur 11, soit une probabilité de 0,037 au hasard.
- La fréquence du gel change selon la période : 27 %, 5 %, puis 44 % des
  trajets. La cause n'est pas trouvée.

Sources : carnet, l. 24655 à 24797 ; plan, l. 18 à 90.

### 20 et 21 novembre : mise de côté

- Le 20, Souhib demande de laisser le moteur Switch 2 de côté. Il avait
  demandé si 40 ou 60 étaient atteignables. Avis donné : 40 est plausible en
  suivant l'amont ou avec un processeur plus rapide par cœur ; 60 n'est pas
  réaliste sur cette machine.
- Le 21, il garde la Switch 2 en expérimental. L'adaptateur et les mesures
  Switch 2 entrent dans Git, dans deux des dix commits. La copie restic couvre
  l'emplacement « tout débloqué » de la Switch 2. Le manifeste
  `consoles/consoles.json` décrit la console. Le laboratoire est archivé, puis
  supprimé avec l'accord de Souhib.

Sources : carnet, l. 24799 à 24947 et 25268 à 25330 ;
`docs/etat-du-projet.md`, l. 63 à 99.

## 3. Les moteurs et les candidats

### 3.1 Paquets publiés

| Paquet | Révision | Essai | Résultat | Suite |
|---|---|---|---|---|
| Lichii 95 (étiquette `build-94`) | paquet `90be7d77…` | 7 nov. | 13,56 puis 19,56 img/s ; son en avance de 36 s | écarté |
| Lichii 93 | paquet `9c664d82…` | 7 nov. | 19,93 et 19,80 ; même avance du son | écarté |
| Eglantine du 7 novembre | commit `216d3e2943` | 7 nov. | 22,00 et 22,08 ; son dans l'incertitude | installé ; reste le moteur global |
| Superbuild v11 | paquet `0462dce5…` | 7 nov. | 17,89 et 18,13 ; aplats bleus | écarté |
| Eglantine PGO, même commit | paquet `8618540a…` | 8 nov. | +5,7 % ; une sortie 139 | non installé |
| Lichii 117 PGO et standard | commit `89440b29a9` | 8 nov. | écran uniforme avant le menu | écarté sur cette configuration |
| Eglantine `nx2-experimental` | commit `eab2c2246d` | 8 nov. | +4,1 % | non installé |
| Orchid 0.9.0 | commit `e420cf2bea` | 8 nov. | Tennis : deux matchs à 45,5 img/s ; Zelda : monde non dessiné | candidat pour Tennis, jamais intégré |
| Eglantine 0.1.0-rc3 | commit `78743f30c` | 9 nov. | +5,26 % | base des prototypes du 9 |
| Lichii 125, Superbuild v31 | base `cbb512ee` | 9 nov. | 22,82 ; 21,16 puis 23,33, sans alternance | sans suite |
| Orchid 0.9.1 | | 9 nov. | 111 programmes refusés, monde incorrect | écarté |
| Lichii build 160 | commit `2eb5f081c8` | 14 nov. | jamais lancé | lu seulement |
| Lichii build 341 | commit `9c9a1dfa56`, ELF `9e2d66b0` | 18 nov. | 34,5 contre 31,3 sans plafond ; gels de 0,46 à 0,61 s | n'entre pas en salle tel quel |
| Lichii, tête de `nx2` | commit `9cd2c9e014`, ELF `badcc1b4` | 18 nov. | se confond avec le build 341 | sans suite |

Fritchii 5.5 à 5.8.4, Superbuild v37 et v50, et Orchid 0.9.2 et 0.9.4 n'ont
été que lus. Les empreintes complètes des paquets sont dans
`spikes/switch2-room/releases.json` et dans l'étude, l. 549 à 560.

### 3.2 Ce qui compose le moteur installé pour Zelda

`65defb74` part du commit amont Lichii `0b83798bf6`. Le laboratoire y a
empilé des ports amont et ses propres retouches. Chaque gain a été mesuré sur
sa propre base, souvent avec instrumentation. Les gains ne s'additionnent pas.

| Étape | Origine | Effet mesuré | Rapport |
|---|---|---|---|
| Correctifs du curseur de réservation et de reprise des petits tampons uniformes | laboratoire | justesse | `upstream-refresh-2026-11-09.json` |
| #874 composé avec la lecture asynchrone `0b83798bf6` (#1028) | amont, adapté | +22,74 % | `readback-2026-11-09.json` |
| Attente inactive à zéro (`IDLE_SPIN_US=0`) | réglage | +3,81 % | `idle-spin-2026-11-09.json` |
| #1056 (`1a5e995`) : macros lisant la mémoire sur le fil arrière | amont | +2,93 % | `macro-back-2026-11-09.json` |
| Politique `Reference` en mode 2 | laboratoire | +13,57 % contre le mode 1 | `reference-cost-2026-11-09.json` |
| Correctif du vérificateur des registres miroirs | laboratoire | justesse | `front-shadow-verify-2026-11-09.json` |
| #1059 : petits tampons contigus | amont | +1,99 % en mode 2 | `uniform-span-mode2-2026-11-09.json` |
| « No sharpening », plafond 30, `frame_pacing_mode=1` | réglages | +7,8 % ; p99 de 33,6 à 36,3 ms | `no-sharpening-2026-11-09.json`, `host-pacing-confirmation-2026-11-10.json` |
| Compteurs de présentation du service et de Vulkan | laboratoire | diagnostic | `service-wsi-runtime-2026-11-09.json` |
| Maillage par calcul (#569, #841) | amont, activé par variable | rendu | `mesh-fallback-2026-11-09.json` |
| #1143 : pointeurs gardés après éviction | amont | justesse | `eviction-pointer-retention-2026-11-10.json` |

Les correctifs pas à pas sont dans `spikes/switch2-room/amont/`. Le correctif
complet de l'arbre installé est `sources/2026-11-14-pages_source-base.patch`
dans l'archive, à appliquer sur `0b83798bf6`.

### 3.3 Candidats du laboratoire

| Candidat (binaire) | Base | Idée | Résultat | Verdict |
|---|---|---|---|---|
| Attente par notification | Eglantine `216d3e2943` | dormir au lieu de boucler dans `GpuSplit::Drain` | −2,65 % ; CPU du fil avant de 80 à 37 % | écarté |
| Instantanés MME | Eglantine `216d3e2943` | lire les arguments sans vidange complète | +1,70 % | non retenu |
| Résumé des pages propres | Eglantine `216d3e2943` | sauter des parcours de mémoire | −4,61 % | écarté |
| Copies de listes regroupées | rc3 `78743f30c` | une soumission de moins | +4,33 % | non installé |
| Anneau d'envoi en mémoire système | rc3 | autre type de mémoire | 22,14 contre 23,29 | écarté |
| Banques de constantes conservées | rc3 | éviter un renvoi forcé | +7,79 % | privé, non installé |
| #1095 | Lichii, chaîne du 9 nov. | moins d'appels par écriture de registre | +0,97 %, non répété | non retenu |
| Cache de shaders V2 | Lichii `0ab7736` | nouveau format de cache | noir au redémarrage à chaud | exclu |
| 1245 et 1246 (`d7df6092`) | `0b83798bf6` | regrouper des copies | +2,43 % puis −3,14 % | non retenu |
| 1225 | `0b83798bf6` | préchauffer le JIT | défaut reproduit sur CPU | jamais lancé |
| 1058 et 1244 (`c686c1ff`) | `0b83798bf6` | lectures de mémoire invitée | +2,0 % puis +3,1 % | non retenu, loin de 40 |
| 1216 avec 974 | `0b83798bf6` | dessins réutilisés | préparé, jamais compilé | sans suite |
| Placement des envois (`13158042`) | `0b83798bf6` | mémoire hôte cachée et cohérente | +5,66 % puis +3,96 % | référence privée, deux états |
| 807 (`cfec5c81`) | `13158042` | alignement des champs | +3,00 % puis −1,99 % | écarté |
| 1095 séparé (`32d0a6fd`) | `13158042` | même idée, message isolé | −1,51 % puis +1,19 % | écarté |
| 1329 (`17ebf0c6`) | `13158042` | éviter un envoi inutile | fonctionnel seulement | jamais comparé |
| Pages laissées ouvertes (`9b70df2e`) | `65defb74` | moins de changements de protection | +0,6 % avec garde ; 13 img/s sans | écarté, défaut de justesse |
| Préchargement (réglage) | `65defb74` | tout construire au démarrage | retire l'accroc de pause ; 0,7 s au démarrage | candidat, jamais en salle |
| Priorité haute de la file Vulkan | `65defb74` | protéger le jeu de Jellyfin | jeu perdu deux fois sur deux | fermé |
| Cœur réservé | `65defb74` | écarter les autres fils | −1,9 à −2,5 % de coût | insuffisant |
| Build 341 avec marge (`de845859`) | `9c9a1dfa56` | marge de 1 024 Mio sous la limite de rétention | 0 trajet gelé sur 72 | dernier candidat, jamais en salle |

Sources : plan, l. 547 à 643 et 1574 à 2944 ; carnet, entrées citées en
section 2.

### 3.4 Ce qui n'a jamais été prouvé

- 40 images par seconde constantes, avec n'importe quel moteur. Le meilleur
  chiffre est 34,5, sans plafond, sur une vue fixe, moteur seul.
- Une mesure de l'amont ou de la marge dans une salle complète, avec worker,
  capture, encodage et navigateur.
- Une partie de plus d'une heure, un changement de zone avec écran de
  chargement, ou la mémoire après plusieurs lieux sous préchargement.
- La cause de l'état coûteux du moteur installé, et celle de la variation du
  gel de l'amont selon la période.
- Ce que fait le jeu dans les 3 % de passages où la politique de l'amont
  n'attend pas la carte.
- La cause des sorties 139 d'Eglantine (Tennis Fever, puis une fermeture PGO).
- La cause du redémarrage de la carte du 7 novembre, et un rendu complet sans
  `NO_MESH` sur le moteur global.
- Un gain de refroidissement : le processeur monte à 94 à 97 °C, et son
  refroidisseur n'a pas été contrôlé à la main.
- L'effet de l'emplacement PCIe : un essai de Souhib sur l'emplacement du
  processeur avait coupé le réseau, sans cause établie.

## 4. Pièges et leçons

Chaque ligne renvoie à la règle d'`AGENTS.md` qu'elle a produite ou
renforcée, citée par ses premiers mots.

| Date | Piège | Leçon | Règle |
|---|---|---|---|
| 7 nov. | La boîte noire ne connaissait pas `eden-cli` et lisait l'allocateur pendant le jeu | inscrire le vrai nom de processus de chaque nouveau moteur | « Register a new emulator's actual kernel process name » (règle 7) |
| 7 nov. | Un salon privé interrogeait les ports de la salle installée | remplacer le registre des salles avant que l'observateur démarre | « An isolated lobby must also replace the numbered-room registry » (règle 7) |
| 8 nov. | Des captures nommées `house` et `resumed-house` montraient « Kokiri Forest » | lire le lieu dans le jeu, pas le nom du fichier | « A screenshot name does not prove its scene » (règle 4) |
| 8 nov. | Le dernier message du journal avait 7 s de retard | borner une phase par l'horloge du conteneur | « The last log timestamp is not the current time » |
| 8 nov. | Des sources copiées avec leurs dates : Ninja a gardé d'anciens objets | prouver le code présent dans l'exécutable testé | « Prove that the tested executable contains the changed code » |
| 8 nov. | Une rotation par indice a laissé un programme fréquent sans mesure | compter les programmes vus et ceux mesurés | « Count which GPU programs were actually timed » |
| 8 et 9 nov. | Une configuration écrite n'était pas appliquée (`default=false`) | comparer les réglages effectifs | « Compare effective settings as well as raw configuration » |
| 9 nov. | `NO_MESH=0` restait actif | retirer une variable lue par sa seule présence | « A zero-valued environment flag may still be active » |
| 9 nov. | Zéro désaccord en mode 0 : la comparaison n'était jamais exercée | exiger des comptes positifs | « Zero disagreements require exercised comparisons » |
| 9 nov. | Les écarts des registres miroirs étaient plafonnés et absents du résumé | garder des totaux par classe, non plafonnés | « A diagnostic summary may omit another class of disagreement » |
| 9 nov. | 75,26 % des cycles sans chaîne d'appels | séparer feuille résolue et chaîne complète | « No lost samples does not prove complete call stacks » |
| 9 nov. | La macro X11 `Success` cassait la vraie compilation | garder la compilation complète de la plateforme | « CPU doubles do not prove platform-header compatibility » |
| 9 nov. | Une nouvelle CI est entrée dans une comparaison | vérifier les files de tous les dépôts des runners | « A worker gap does not prove an empty CI queue » |
| 10 nov. | Le pilote d'entrées sort en 143, sans rapport | journaliser les commandes au fil de l'eau | « The input driver needs its own evidence » |
| 10 nov. | `evdev` manquait dans le Python de l'image | exercer le vrai helper des manettes | « An image that runs the emulator may still fail its room adapter » (règle 7) |
| 10 nov. | `run-cli.sh` copié en mode 0664 | figer aussi les droits d'exécution | « Frozen launch artefacts also record executable permissions » (règle 7) |
| 10 nov. | La boîte noire profilait notre précache ; Jellyfin utilisait la carte | contrôler les vrais clients de la carte pendant l'essai | « Do not measure a machine while loading it » |
| 10 nov. | Un échec d'assertion n'a pas arrêté la ligne suivante | lier la garde et l'action | « Keep a guard and its dependent action in one checked transaction » |
| 10 nov. | Mêmes entrées, deux trajets : un bras dans la pièce, l'autre à la porte | observer chaque étape du trajet | « A screenshot name does not prove its scene » (dernier paragraphe) |
| 10 nov. | Le cache de pages d'instructions gardait une instruction ancienne | exercer l'entrelacement et l'invalidation | « Speculative compilation must preserve the instruction page cache too » |
| 11 nov. | Le 1095 refait comme une piste neuve | chercher le numéro et la tête dans le carnet | « A new merge is not necessarily a new experiment » |
| 11 nov. | `passed=true` écrit avant le dernier contrôle | publier le succès en dernier | « Publish success only after the last required check » |
| 11 nov. | Une copie du banc perd `policy.json`, puis vingt chemins | inventorier données et preuves historiques | « Relocating a bank must account for data and historical evidence too » |
| 11 nov. | Le préchauffage rendait la copie chronométrée facultative | changer les blocs après la validation | « A warm-up must not make the timed write optional » |
| 11 nov. | Un inventaire échoue 1,406 s après la fin de phase | borner un échec par toute son invocation | « Bound an observer failure by its whole invocation » |
| 11 nov. | Restaurer un module retirait une fonction utilisée par les essais | garder l'interface de l'essai | « A reintroduced bug must still let its regression test run » |
| 12 nov. | Le banc à vue fixe ne pouvait pas voir les gels | mesurer ce dont le joueur se plaint | « A test that cannot fail is worse than no test » (fin de la règle 4) |
| 12 nov. | Minuteries, mise à jour automatique, et la session pilote écrivait pendant un segment | relever la charge hors moteur de chaque segment | « Do not measure a machine while loading it » |
| 14 nov. | La priorité haute remet à zéro des anneaux de la carte | ne pas la refaire aux heures de jeu | plan, l. 339 à 342 |
| 14 nov. | Un agent s'est arrêté au milieu d'un passage | le délai de l'instrument remet la machine en état, pas l'agent | carnet, l. 24302 à 24308 |
| 18 nov. | Un horodatage lu pendant l'écriture : −0,01 img/s | rejeter un horodatage qui recule | à faire (plan, l. 213 à 215) |
| 18 nov. | Un pas de côté triplé fait pivoter Link | recalibrer un trajet à la vue, pas par calcul | plan, l. 204 à 208 |
| 19 nov. | Un témoin muet quatre heures ; une limite baissée en cours de lancement ; seule la seconde 54 comptée | relancer le bras qui montre le défaut ; vérifier un réglage sur tout le lancement | « A silent control proves nothing for the treated arm » |
| 19 nov. | « C'est la compilation » jugé sur deux périodes successives | alterner, même pour deux binaires | « A live measurement on a drifting machine ALTERNATES » |

Une dernière leçon ne figure pas dans `AGENTS.md`. Les agents d'essai ne
peuvent pas écrire leur fichier de rapport : ils rendent le texte, et la
session principale l'écrit (carnet, l. 23752 à 23756).

## 5. Reprendre

### D'abord

Lire l'entrée du carnet du 20 novembre (l. 24799). Demander ensuite à Souhib
si l'objectif de 40 images par seconde tient toujours (plan, l. 8 à 16). Rien
n'entre dans la salle sans sa décision.

### L'action exacte laissée par la consigne du 19 novembre

Plan, section « Prochaine action au 19 novembre », l. 73 à 90 :

1. Décision de Souhib : un essai en salle complète de l'amont avec la marge
   de 1 024 Mio.
2. Dans toute série sur ce gel, garder un témoin sans marge dans la même
   alternance, et compter avec la trace de saccades.
3. Vérifier la limite de rétention sur tout le lancement (lignes « Memory
   margins » du journal), pas seulement au démarrage.
4. Avant la salle : recalibrer à la vue le trajet vers la maison de Link, et
   qualifier les 3 % de passages anticipés sur un trajet et un changement de
   zone.
5. Facultatif : essayer 256 et 512 Mio. Signaler le constat au projet Lichii
   seulement sur décision de Souhib.
6. Restent les points 7 et 8 du 18 novembre (l. 213 à 218) : faire rejeter
   par `recalc.py` un horodatage qui recule, avec un jumeau négatif ; puis
   chercher les 8 à 14 % qui manquent. 72 % des attentes vidangent encore :
   c'est la première piste.

L'amont a avancé depuis le build 341 du 17 novembre. Avant de porter une
demande, chercher son numéro dans le carnet. Demandes déjà lues : 1436, 1441,
1471 (refusée par l'amont), 1518, 1944 (ouverte), 1953 et 2116 à 2161.

### Reconstruire

- Sources. L'archive contient les deux dépôts complets au 18 novembre
  (`miroirs/Lichii.bundle`, `miroirs/Eglantine.bundle`) et un correctif par
  arbre du laboratoire (`sources/*.patch`, avec `sources/index.tsv`). Pour
  rejouer un arbre : `git clone miroirs/Lichii.bundle`, `git checkout <HEAD>`,
  puis `git apply --binary sources/<nom>.patch`.
- Arbres utiles :
  - `source-base`, sur `0b83798bf6` : le moteur installé ;
  - `source-amont341` et `source-amontmarge`, sur `9c9a1dfa56` : le build 341
    et la marge ;
  - `source-amontnx2`, sur `9cd2c9e014` : la tête de `nx2` ;
  - les prototypes Eglantine du 8, sur `216d3e2943`, et ceux du 9, sur
    `78743f30c`.
- Dépôts en ligne : `github.com/zortos293/Lichii`. Eglantine est cité sous
  `github.com/Djihads80/Eglantine`, et sa copie a été prise sous
  `github.com/Eglantine-Community/Eglantine`. Ces dépôts peuvent disparaître.
- Recette de compilation. `2026-11-14-pages/build.py` compile l'ancienne base,
  et `build_amont.py` l'amont postérieur au renommage `LICHII_*`. Les deux
  sont dans l'archive, à leur chemin d'origine. Options : Clang 23,
  `-march=znver2`, ThinLTO, et le profil PGO `eglantine.profdata`. Ce profil
  est suivi dans l'historique des deux miroirs, donc il revient avec eux.
- Ces scripts utilisaient l'image Docker
  `nel3ab/eglantine-clang23-lto-build:2026-11-09`. Elle a été retirée le
  21 novembre avec les cinq autres images du laboratoire, et leurs Dockerfile
  n'ont pas été gardés : le filtre de l'archive ne prenait que des fichiers à
  extension. `recettes-docker.txt`, dans l'archive, reconstitue leurs étapes
  à partir du cache de construction de Docker : Ubuntu 24.04, Clang et LLVM 23
  d'apt.llvm.org, Mesa 26.2.6 du PPA kisak-mesa, CMake 3.31.10. L'ordre des
  étapes n'y est pas conservé.
- Les deux scripts montent le `.git` du dossier supprimé
  `nx2-lab/2026-11-09-30fps` : il faut changer ce chemin avant de s'en
  resservir. Les caches de compilation sont perdus : la première compilation
  repart de zéro.
- `sources/index.tsv` donne `github.com/Djihads80/Eglantine.git` comme origine
  des arbres Lichii du laboratoire. Ces arbres ont été clonés depuis ce dépôt,
  puis placés sur des commits Lichii, que les deux projets partagent. Pour
  reconstruire, partir du miroir qui contient le commit `HEAD` de l'arbre. Le
  21 novembre, les 35 correctifs se sont appliqués ainsi, sans échec, sur des
  copies restaurées depuis les deux miroirs de l'archive.
- Portage de l'instrumentation sur un arbre amont :
  `2026-11-18-amont/port_traces.py SOURCE source-base`. Il échoue si une ancre
  a bougé.
- Instrument : `2026-11-12-probe/nx2probe.py` (sha256 `3d353c49…`), avec
  `tests/selftest.py` (34 essais sans GPU) et `reference/engine-rewritten.ini`.
  Son moteur `reference` pointait vers une construction supprimée. Seuls
  `--engine installed` et un chemin d'ELF explicite restent utilisables. Son
  dossier `fixtures` n'est pas dans l'archive.
- Scripts de l'essai M, dans l'archive : `pass.py`, `serie.py`,
  `serie_tenue.py`, `tenue.py`, `images_recurrentes.py`, `seconde54.py` et
  `fisher.py`. Aussi : `l-etat-couteux/ubo.diff`, la chasse de l'essai L, et
  `k-qualif/scripts/recalc.py`.

### Les preuves du dépôt qui comptent le plus

Tout ce qui date du 12 au 19 novembre n'existe que dans l'archive : les
rapports `REPORT.md` des essais a à m, la veille et la carte des moteurs.
`spikes/switch2-room/` s'arrête au 11 novembre.

| Fichier | Pourquoi |
|---|---|
| `README.md` | configuration, fiche d'un NUP, vérification isolée |
| `releases.json`, `results-2026-11-07.json`, `audio-2026-11-07.json` | le choix du premier moteur |
| `fever-2026-11-07.json` | tout ce qui existe sur Tennis Fever avec Eglantine |
| `split-2026-11-08.json`, `drain-2026-11-08.json`, `coarse-gpu-2026-11-08.json` | premier profil et premières pistes fermées |
| `readback-2026-11-09.json`, `reference-cost-2026-11-09.json`, `front-shadow-verify-2026-11-09.json`, `no-sharpening-2026-11-09.json` | les gains retenus dans le moteur installé |
| `host-pacing-confirmation-2026-11-10.json`, `eviction-pointer-retention-2026-11-10.json` | le plafond Vulkan et le dernier port de `65defb74` |
| `browser-attempt-05-2026-11-10.json`, `title-profile-installation-2026-11-10.json` | le vrai routage par titre et l'installation, avec son retour arrière |
| `cpu-affinity-guarded-2026-11-10.json`, `external-gpu-interference-2026-11-10.json` | comment Jellyfin a faussé une série |
| `uploadhost-comparison-2026-11-11.json`, `emptyflush1329-preparation-2026-11-11.json` | la référence privée et le dernier banc |
| `save-recovery-2026-11-11.json` | la remise des sauvegardes de Souhib |
| `gpu_clients.py`, `measure.py`, `room.mjs` | les outils encore en service |
| `amont/*.patch` et leurs `.md` | les correctifs du laboratoire, pas à pas |

### Ce qui n'existe plus

- Tous les dossiers datés de la section 6 et les 408 salles jetables
  `test-switch2-*`.
- Les copies extraites des deux jeux du laboratoire, et ses copies de Zelda.
  La copie de Zelda du catalogue reste dans `~/roms/switch2`. Le NUP de Mario
  Tennis Fever est dans `~/roms/hors-salle/switch2/`.
- Six images Docker du laboratoire : les trois images de compilation
  Eglantine (`clang23-build`, `clang23-lto-build`, `drain-build`),
  `nx2-mesa2626-lab` et les deux `personal-mount-probe`. Restent les deux
  images dont la salle se sert : `switch-prototype:2026-09-08-recovery` et
  `lichii-browser-evdev:2026-11-10`.
- Les exécutables du laboratoire, dont la référence `13158042` et les
  candidats `17ebf0c6`, `9b70df2e` et `de845859`. Restent les moteurs
  installés sous `~/.local/share/nel3ab/switch2/engines/`.
- Les caches appris (shaders, pipelines, précaches) et les caches de
  compilation.
- Les passages bruts de l'instrument, environ 36 Go de journaux et de
  captures.
- Les 22 fichiers NAND copiés avant l'activation du 10 novembre : l'archive
  ne garde que leurs deux `emulator.ini`. Le dossier
  `2026-11-12-probe/fixtures` de l'instrument n'est pas dans l'archive non
  plus. Les sauvegardes actuelles sont
  écrites par `65defb74`. Revenir à Eglantine ne prouve pas qu'il les lira.
- Plus de 1 500 chemins cités par 76 rapports de `spikes/switch2-room/`.
  Ils ne se lisent plus que dans l'archive, qui garde le chemin absolu
  d'origine de chaque fichier.

### L'archive

Elle est dans `~/.local/share/nel3ab/archives/switch2-labo-2026-11/`
(1,6 Go). Son `LISEZMOI.txt` dit comment rejouer chaque pièce, et
`SHA256SUMS` porte l'empreinte de chacune. `preuves.tar.zst` contient
49 240 fichiers, comparés octet par octet au disque avant la suppression. Son
empreinte SHA-256 commence par `e0a637001d26c5d2`. Une copie chiffrée est sur
le NAS, dans le dépôt restic de l'abri, sous l'étiquette `switch2-labo`
(instantanés `77b44c6b` et `8cdba024`). L'entretien de la nuit n'efface que
les instantanés étiquetés `nel3ab` : ceux-ci restent.

L'archive reste privée. Elle contient des journaux, des configurations et des
copies de comptes qui ne se publient pas.

## 6. Les dossiers datés du laboratoire

Tailles relevées par `du` le 21 novembre, avant la suppression. Des liens
physiques partagent des fichiers entre dossiers, donc les tailles ne
s'additionnent pas exactement.

| Dossier | Taille | Ce qu'il servait à faire |
|---|---|---|
| `2026-11-07` | 57 Go | premier laboratoire : copies extraites de Zelda (24 Go) et de Tennis Fever (15 Go), les quatre paquets du 7, comparaison des moteurs, analyse son et image, sauvegardes de départ |
| `2026-11-07-followup` | 340 Mo | soir du 7 : matchs de Tennis Fever et leurs deux sorties 139, synchronisation réactive, mode portable, journaux de la partie de Souhib |
| `2026-11-08` | 1,9 Go | paquets PGO d'Eglantine, Lichii 117 standard et PGO, contrôles de reprise et de fermeture |
| `2026-11-08-next` | 1,7 Go | Eglantine `nx2-experimental`, Orchid 0.9.0 sur Tennis Fever, correction des bornes de journal |
| `2026-11-08-orchid-oot` | 176 Mo | Orchid sur Zelda (monde non dessiné) et contrôle par Eglantine |
| `2026-11-08-split` | 346 Mo | profil d'Eglantine et modes de répartition 0, 1 et 2 |
| `2026-11-08-drain` | 3,1 Go | premier correctif source (attente par notification), demi-résolution, image de compilation |
| `2026-11-08-macro` | 2,5 Go | second prototype : arguments des macros MME |
| `2026-11-08-buffers` | 3,2 Go | troisième prototype : pages propres et horodatages GPU détaillés |
| `2026-11-08-coarse` | 2,9 Go | sonde GPU par lots, du 8 au 9 |
| `2026-11-09-30fps` | 63 Go | laboratoire principal du 9 au 11 : rc3, Mesa, Clang 23, toutes les sources et constructions Lichii, salles navigateur (avec une copie du jeu), installation du profil Zelda, bancs « goal40 », revues amont, reprise des sauvegardes, `CURRENT-GOAL40.json` |
| `2026-11-12-probe` | 38 Go | instrument `nx2probe.py`, sa qualification, essais a à m et leurs passages bruts |
| `2026-11-14-pages` | 12 Go | fabrique de compilation et arbres `source-base`, `-pages`, `-qualif`, `-ubo`, `-amont341`, `-amontnx2`, `-amontmarge`, avec leurs constructions ; outil `jellyfin_actif.py` |
| `2026-11-18-amont` | 231 Mo et plus | copies complètes de Lichii et d'Eglantine, `port_traces.py`, différences du laboratoire contre `0b83798bf6` |
| `2026-11-18-veille` | 11 Mo | veille des projets (`VEILLE.md`), carte des moteurs du dépôt (`CARTE-MOTEURS.md`), sources brutes |

Hors de ce dossier, `~/.local/state/nel3ab/test-switch2-*` comptait
408 salles jetables créées par `spikes/switch2-room/room.mjs` : 6 le 7, 187 le
10 et 215 le 11 novembre. Les deux plus grosses pesaient 25 et 16 Go.
