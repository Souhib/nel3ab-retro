# Salle Switch 2 expérimentale

Les résultats et leurs limites sont dans
[l'étude du 7 novembre](../../docs/etude-switch2-2026-11-07.md).
`releases.json` identifie les quatre paquets essayés. Les jeux, les caches et
les sauvegardes de laboratoire restent hors du dépôt.

`submission-gpu-65def-2026-11-10.json` et
[`amont/submission-gpu-65def-2026-11-10.md`](amont/submission-gpu-65def-2026-11-10.md)
décrivent une sonde des soumissions portée sur les sources exactes du moteur
installé. La construction privée et les contrôles CPU passent ; le lancement
réel est refusé par un client GPU extérieur avant tout jeu. Ce candidat
n'est pas installé. Aucun temps GPU réel ni gain de cadence n'est encore validé.

`local-media-work-2026-11-10.json` conserve la séparation partielle de la
lecture locale. Les deux pages reçoivent chacune vidéo et son dans les deux
conditions ; la variante ne décode pas l'image et ne joue pas le son du jeu.
Les commandes restent envoyées par la vraie page et les producteurs gardent
leurs identités. Le spectateur n'ouvre aucune socket de commandes. Un geste
dans la salle réveille le son du témoin ; l'entrée seule ne le prouve pas.
Les images comprimées sont conservées pendant les phases, puis décodées
après leur arrêt. Le lecteur vérifie le nombre d'images et l'absence de
réordonnancement avant de choisir la dernière image du groupe.
Deux passages de 90 secondes terminent, mais le troisième est arrêté avant
mesure par un client GPU extérieur. La caméra diffère aussi entre les deux
passages. Aucun gain de cadence ni verdict matériel n'est retenu.
Les 28,79 retours Vulkan/s et le maximum de 97,28 ms du passage léger ne
qualifient pas 30 régulières. Aucun réglage de performance n'est installé.

La série des contraintes CPU du 10 novembre termine quatre phases sans client GPU
extérieur relevé. Libérer les contraintes CPU donne −17,06 %, puis −8,20 %
sur ce parcours ; le placement installé est conservé. Les 30 régulières restent
non atteintes. Les fenêtres complètes et leurs limites figurent dans
`cpu-affinity-guarded-2026-11-10.json`. Le contrôle local complet `just` passe.

Point de reprise du 10 novembre : la comparaison des contraintes CPU est
retirée après découverte de transcodages Jellyfin sur le même GPU pendant
les quatre phases. Les comptes restent dans
`cpu-affinity-comparison-2026-11-10.json`, avec leur correction explicite.
`external-gpu-interference-2026-11-10.json` donne le chevauchement des horaires
et les limites. Aucun verdict matériel ni gain CPU n'en est déduit.

Avant une comparaison, puis pendant sa surveillance privée :

```sh
sudo -n python3 spikes/switch2-room/gpu_clients.py
sudo -n python3 spikes/switch2-room/gpu_clients.py --room /chemin/prive/A1/active-room.json
```

Le code de sortie vaut zéro seulement sans client GPU extérieur, trois si un
client extérieur est présent, et deux si l'observation échoue. L'option
`--room` accepte uniquement les identités du pilote privé vivant, de ses
descendants et de ses conteneurs. Le contrôle périodique lit les métadonnées
des descripteurs et l'identité PCI dans sysfs. `--details` demande aussi les
compteurs du pilote ; réserver cette option aux diagnostics séparés, car son
coût en partie n'est pas qualifié. Les descripteurs partagés ne doivent pas
multiplier leurs compteurs. Une lecture périodique ne prouve pas l'absence
de travaux très courts entre deux observations.

Ce refus conservateur sert aux comparaisons isolées. Un descripteur ouvert
ne mesure pas l'activité du GPU et ne prouve pas une saturation. Jellyfin
peut rester démarré pour jouer ou vérifier le fonctionnement ; un diagnostic
sous charge partagée doit être présenté comme tel. Le 10 novembre à
18 h 55 UTC, aucun client GPU ni FFmpeg n'est retrouvé alors que Jellyfin
tourne encore. Hors jeu, les 21 relevés espacés d'une seconde donnent zéro
pour l'activité GPU et mémoire. Ce relevé ne quantifie pas l'effet d'un
transcodage et ne qualifie pas une comparaison de cadence.

Premières mesures du 10 novembre : les constructions Lichii et leurs réglages
sont essayés en privé. NoSharpening améliore le débit sur les passages alternés,
puis le plafond natif Vulkan à 30 régularise les intervalles de présentation
sur quatre nouvelles phases de caméra. Le trajet au sol, les zones, la vitesse,
le son et la sauvegarde/reprise restent à qualifier ensemble. Le
[plan courant](../../docs/plan-60fps-switch2-2026-11-08.md) et
`host-pacing-confirmation-2026-11-10.json` donnent les preuves et les limites.
La sauvegarde manuelle et sa reprise passent ensuite sur la copie privée.
Un passage de 90 secondes en petits déplacements continus donne environ
30 retours Vulkan/s sur 60 secondes de fenêtres retenues, maximum 34,58 ms,
sans intervalle au-delà de 100 ms. Les limites et la capture intermédiaire
sont détaillées dans `continuous-walk-2026-11-10.json`. Le son, les
cinématiques et la chaîne navigateur restent à qualifier sur cette candidate.
Le moteur habituel n'est pas remplacé.

Le contrôle cinéma passe ensuite sur une portion de 90 secondes appariées :
vitesse source compatible avec le temps réel, sans décalage observé au-delà
de l'incertitude de 0,5 seconde. Les rejets et la portée limitée restent dans
`cinema-qualification-2026-11-10.json`. La qualification du navigateur doit
encore reproduire le profil complet, car les valeurs imposées par l'adaptateur
habituel diffèrent de celles de ces essais.

La première salle privée échoue avant le lancement du moteur : `evdev`
manque dans le Python utilisé par le helper des manettes. Aucun résultat
de cadence ou de son n'en est déduit. Le rapport et les limites du nettoyage
sont dans `browser-attempt-01-2026-11-10.json`. Le contrôle des quatre
manettes dans une image privée dérivée précède tout nouvel essai.

Ce préalable passe ensuite. La deuxième salle atteint Kokiri par le navigateur
avec joueur, spectateur, son reçu et déplacements courts observés. Le pilote
externe des mouvements quitte avec le code 143 sans rapport de fin ; aucune
mesure de 90 secondes ni cadence navigateur n'est acceptée. La salle ferme
normalement, sans modification des sauvegardes habituelles. Preuve bornée :
`browser-attempt-02-2026-11-10.json`.

La troisième salle termine ensuite les 90 secondes : 29,81 retours Vulkan/s
sur 80,51 secondes de fenêtres complètes, avec un maximum de 113,15 ms.
Le joueur, le spectateur, les commandes, le son reçu et l'arrêt passent.
La première fenêtre lente reste incluse ; 30 constantes ne sont pas atteintes.
Les deux clients Chromium décodent localement et ajoutent leur propre charge.
Les changements de décor restent à examiner avant adoption. Rapport :
`browser-attempt-03-2026-11-10.json`.

Installation du 10 novembre : Zelda sélectionne maintenant le candidat
`65defb74` par `engines_by_title`. Le vrai routage passe dans une salle
isolée, avant et après 90 secondes de commandes navigateur : 29,31 retours
Vulkan/s sur 61,42 secondes de fenêtres complètes, maximum 65,82 ms.
Les NAND des deux emplacements et l'ancienne configuration sont conservées ;
les huit progressions restent identiques. Le triplet global reste celui
d'Eglantine pour les autres titres. Aucun redémarrage de salle n'est demandé.
Ce profil vise 30, sans promettre une cadence constante ni les chargements
de toute la carte. Preuves : `browser-attempt-05-2026-11-10.json` et
`title-profile-installation-2026-11-10.json`.

Le test complet des quatre manettes et des vibrations passe aussi avec
l'identifiant réel de cette image, via `NEL3AB_TEST_SWITCH_IMAGE` et
`just switch-controls-test`. Le rapport
`qualified-image-controls-2026-11-10.json` garde les identifiants Docker
observés et la preuve du nettoyage. Ce test du helper ne porte pas la
capacité de Zelda au-delà d'un joueur.

## Configuration privée

L'adaptateur `docker/switch2-room.py` utilise le même affichage Wayland, la même
capture et le même arrêt que `docker/switch-room.py`. Il monte une seule des
quatre manettes privées. Le worker annonce une capacité de un et refuse une
deuxième attribution. La génération d'images intermédiaires est désactivée.

Le fichier donné par `NEL3AB_SWITCH2_CONFIG` contient par exemple :

```json
{
  "image": "nel3ab/switch-prototype:2026-09-08-recovery",
  "engine": "/chemin/prive/eglantine-216d3e2/squashfs-root",
  "revision": "eglantine-216d3e2",
  "state": "/chemin/prive/sauvegardes-switch2",
  "refresh_hz": 120
}
```

`engine` est l'AppImage extraite, avec `usr/bin/eden-cli`. La révision identifie
aussi le cache. Changer de moteur ne doit pas lui donner les pipelines d'un
autre moteur. Le conteneur reçoit le jeu et l'émulateur en lecture seule,
sans réseau. Ses bibliothèques sont exposées seulement au processus de jeu.

Depuis le 10 novembre, `engines_by_title` peut sélectionner un triplet
`image`, `engine`, `revision` pour un titre exact. Tous les trois sont requis ;
les autres clés sont refusées. Le stockage, les manettes et `refresh_hz`
restent ceux de la salle. Un titre absent conserve le triplet global.
Une table malformée fait échouer le lancement avant la création des manettes.
Cela permet de qualifier le candidat Zelda sans changer le moteur de Mario
Tennis. Retirer l'entrée restaure le choix du moteur précédent, mais une
sauvegarde NAND antérieure reste nécessaire pour garantir le retour de l'état
du jeu. La compatibilité de ses écritures entre versions n'est pas supposée.

Chaque titre et chaque emplacement possèdent une NAND distincte dans
`state/<titre>/<emplacement>/home/.local/share/eden/nand`. La NAND est la mémoire
persistante émulée. L'adaptateur garde le verrou de l'emplacement pendant toute
la partie. Il attend la fin du processus avant de copier une sauvegarde dans
`backups/`. Les outils de sauvegarde Ryubing ne s'appliquent pas à ce format.
Une archive après une sortie anormale reste une copie de cet état anormal,
pas une preuve de sauvegarde correcte. `exit.json` et `lifecycle.json` gardent
le résultat de l'arrêt.

Un NUP entre dans le catalogue uniquement avec son inscription explicite
`<jeu>.nup.nel3ab.json`, après vérification du titre et de sa mise à jour :

```json
{
  "console": "switch2",
  "name": "The Legend of Zelda: Ocarina of Time",
  "title": "0400486024dec000",
  "maker": "Nintendo"
}
```

Le premier contournement `EDEN_NX2_NO_MESH=1` évitait le chemin qui avait
redémarré le GPU, en supprimant aussi des objets. Le profil Zelda installé
utilise maintenant `EDEN_NX2_FORCE_MESH_FALLBACK=1`, sans `NO_MESH`, pour dessiner
les maillages par calcul. L'entrée du menu et la fiche du jeu conservent leur
caractère expérimental ; les premiers comptes sans maillages ne qualifient
pas ce profil.

## Vérification isolée

Avec Docker, le GPU, `/dev/uinput` et une configuration privée :

```sh
NEL3AB_TEST_SWITCH2_CONFIG=/chemin/config-test.json \
  just switch2-room-test '/chemin/zelda.nup'
```

La recette construit d'abord le worker. Le pilote vérifie l'empreinte de la
page servie, le catalogue, une place de joueur, un spectateur et le refus d'un
deuxième joueur. Il utilise ses propres ports, fichiers d'identité, verrou,
proxy et dossiers de sauvegarde. Il vérifie aussi l'absence de conteneurs
restants après l'arrêt.

`NEL3AB_TEST_SWITCH2_CHECKPOINT` peut désigner une copie de NAND de test.
`NEL3AB_TEST_SWITCH2_CACHE` peut désigner un cache privé à copier. Les sources
ne sont pas montées en écriture dans la salle de test. `NEL3AB_TEST_HOLD=1`
laisse la salle ouverte pour observer le jeu, pendant trente minutes au maximum.
Créer le fichier `finish` dans le dossier annoncé termine cette observation.
Une capture visible et un compte de présentations ne prouvent pas seuls qu'un
bouton porte le bon nom dans le jeu. Cette observation reste nécessaire.

Après une modification des commandes, lancer aussi `just switch-controls-test`.
La porte `just` inclut les essais de fichiers de cet adaptateur et ceux du
lecteur de mesures.

## Cadence des présentations du jeu

`measure.py` lit les fenêtres de 600 présentations du moteur de jeu. Il refuse
un journal sans ces compteurs et un intervalle sans fenêtre complète. La scène
doit être vérifiée séparément à l'écran. Par exemple :

```sh
python3 spikes/switch2-room/measure.py /chemin/console.log --start 100 --end 190
```

Les bornes sont celles du journal du moteur. Le résultat précise la durée
effectivement couverte, le nombre d'images, le plus grand intervalle et le
nombre d'intervalles supérieurs à 100 ms. Les valeurs de cadence sont des
moyennes par fenêtre. Elles ne permettent pas de calculer un percentile des
images individuelles. La cadence de Sway, de la capture ou du navigateur
n'est pas utilisée pour les remplacer.
Une demande de présentation ne prouve pas que son contenu est nouveau.
Les sondes ajoutées dans le laboratoire en novembre datent aussi les retours
acceptés de Vulkan, sans les confondre avec l'instant d'affichage physique.

Les phases enregistrées dans `results-2026-11-07.json` alternent deux fois
95, 93, Eglantine et Superbuild. Une compilation et un profileur ne doivent pas
accompagner la mesure. La charge d'un autre projet au premier tour est une
limite explicitée dans l'étude.

`audio-2026-11-07.json` conserve les correspondances son/image acceptées et
refusées. `saves-2026-11-07.json` conserve les quatre écritures puis reprises
de sauvegarde manuelle et les huit arrêts complets associés. Ce dernier
parcours est fonctionnel ; ses durées ne classent pas les moteurs.

La reprise du soir ajoute `zelda-session-2026-11-07.json` pour la partie
utilisateur, `zelda-flushing-2026-11-07.json` pour les quatre phases alternées
et `zelda-handheld-2026-11-07.json` pour l'exploration du mode portable.
`fever-2026-11-07.json` garde le match Tennis Fever et les deux plantages,
avec et sans suppression des dessins de maillage. Ce jeu n'est pas inscrit
dans le catalogue installé.
