# Switch : expériences et programmes de la salle

Ryubing exécute notre programme Switch et Mario Tennis Aces sur la Radeon. Les navigateurs
reçoivent son image, son son et ses vibrations par les bibliothèques de nel3ab.
Depuis le 9 septembre, `docker/switch-room.py` utilise aussi les programmes de
capture, de manettes et de supervision de ce dossier pour la salle normale.
**Ce dossier n'est plus entièrement jetable.** Le pont et sa page restent des
outils d'essai ; l'adaptateur de la salle utilise le transport commun du worker.
Lire le [guide actuel](../../docs/switch-room.md) avant de lancer les anciennes
recettes de laboratoire. Les étapes datées ci-dessous restent les preuves de
construction, pas une instruction pour remplacer les processus de la salle.

Les résultats sont dans [results/2026-09-07.json](results/2026-09-07.json).
Le lancement du jeu commercial est relevé séparément dans
[results/2026-09-07-mario-tennis.json](results/2026-09-07-mario-tennis.json).
Le match à quatre, la mise à jour et la reprise de sauvegarde du 8 septembre
sont dans [results/2026-09-08-integration.json](results/2026-09-08-integration.json).
L'[étude](../../docs/etude-switch-2026-09-07.md) compare chaque fonction utilisée
avec Dolphin et les travaux nécessaires pour conserver cette fonction.

## Ce qui a tourné le 7 septembre

- Ryubing 1.3.3, Vulkan sur RX 6650 XT, Mesa 25.2.8, avec Cage en affichage
  Wayland sans écran. Le mode mémoire `SoftwarePageTable` est nécessaire dans
  l'essai ; le mode par défaut a produit une violation d'accès.
- Un programme Switch écrit ici, compilé avec libnx et devkitA64. Quatre zones
  montrent les quatre manettes. Un compteur d'images permet de vérifier que
  l'émulation avance. Un compteur conservé sur la carte SD virtuelle prouve la
  conservation de cet état entre les lancements. Deux sons distincts identifient
  les canaux gauche et droit. Aucun jeu commercial n'entre dans cette preuve.
- Quatre appareils uinput, chacun avec ses boutons, ses deux sticks, sa croix,
  ses gâchettes et son retour de vibration. Les commandes supplémentaires
  Switch sont vérifiées directement contre les pixels du programme.
- Deux captures avec encodage H.264 matériel, 1280×720 et 640×360. wf-recorder
  annonce l'emploi de DMA-BUF ; aucun profil ne prouve encore l'absence de copie
  vers la mémoire du processeur sur toute la chaîne.
- Le vrai `BrowserServer`, `Session`, `VideoStream`, `SoundStream`, `InputStream`
  et le multiplexeur de clips du projet. Quatre contextes Chrome prennent
  quatre places, chaque appui ne modifie que la zone correspondante, et une
  vibration arrive à l'API du navigateur concerné. Cette API est simulée dans
  Chrome : le test ne prouve pas qu'une manette physique a vibré.
- Une place rendue en passant spectateur est reprise par une nouvelle page.
  Le plein format et le demi-format sont décodés. Le clip de 30,22 secondes
  porte du H.264 et du son stéréo 48 kHz. Le décodeur retrouve 440 Hz à gauche
  et 880 Hz à droite ; les variantes muette et sans piste audio sont refusées.

Le compteur du programme a avancé de 306 images en environ 5,09 secondes. Ce
programme dessine des rectangles. Ce chiffre ne prédit pas la cadence de Mario
Tennis, ni celle d'un jeu à quatre joueurs.

## Reproduire

Prérequis : Linux, Docker, l'image Dolphin locale, `/dev/uinput`, une Radeon
accessible par `/dev/dri/renderD128`, Rust, Node et les dépendances déjà installées
du frontend et de `spikes/m3-browser-drive`. Les programmes, jeux et données
restent dans `SWITCH_LAB`, par défaut `/tmp/nel3ab-switch-lab`.

Depuis la racine du dépôt :

```sh
python3 spikes/switch-room/download.py
docker build -t nel3ab/switch-prototype:2026-09-08 spikes/switch-room
docker build -f spikes/switch-room/Dockerfile.capture \
  -t nel3ab/switch-prototype:2026-09-08-recovery spikes/switch-room
# Requires the .NET 9 SDK; set DOTNET to its path if it is installed privately.
spikes/switch-room/build-ryubing.sh
spikes/switch-room/guest/build.sh
spikes/switch-room/start-pads.sh
spikes/switch-room/launch.sh ryubing
bash spikes/switch-room/bridge/build-page.sh
cargo build --manifest-path spikes/switch-room/bridge/Cargo.toml
spikes/switch-room/bridge/target/debug/nel3ab-switch-prototype /tmp/nel3ab-switch-lab/pads
```

La dernière commande reste ouverte. Elle lie un port éphémère sur la boucle
locale et écrit son URL dans `pads/bridge.json`. Dans un autre terminal :

```sh
spikes/switch-room/capture-service.sh
```

Laisser la capture remplir trente secondes de vidéo avant de vérifier le clip.
Dans un troisième terminal :

```sh
node spikes/switch-room/check-browser.mjs
python3 spikes/switch-room/check-guest.py
docker exec nel3ab-switch-ryubing-lab python3 /probe/check-steady.py
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/spikes/switch-room:/probe:ro" \
  -v /tmp/nel3ab-switch-lab:/lab:ro \
  nel3ab/switch-prototype:2026-09-07 \
  python3 /probe/check-clip.py /lab/browser-clip.mp4
```

Ne pas lancer les deux pilotes d'entrée simultanément. L'un tient ses commandes
par les navigateurs, l'autre par le socket de test. `check-guest.py` exige au
moins deux lancements du programme dans le même dossier pour vérifier son
compteur de sauvegarde. Les noms des conteneurs sont fixes et les scripts
refusent de remplacer un conteneur existant. Pour recommencer le programme,
arrêter le service `nel3ab-switch-capture`, puis arrêter et retirer uniquement
`nel3ab-switch-ryubing-lab`, et relancer la
commande `launch.sh ryubing`. Le dossier de données est conservé.

Le helper des manettes a besoin de `/dev/uinput`. Il voit les noms des appareils
dans `/sys` et `/dev/input`, mais la liste de périphériques autorisés par Docker
ne lui permet pas d'ouvrir les manettes physiques. Les quatre appareils qu'il
crée sont attribués à l'utilisateur ; seuls ceux-là sont ensuite transmis à
l'émulateur. Il faut recréer le conteneur de l'émulateur après avoir recréé ces
appareils. La disponibilité du socket est attendue avant son lancement, car les
numéros des appareils n'existent pas encore au retour de `docker run -d`.
Le pilote `check-steady.py` lit les événements du noyau : une commande répétée
avec A toujours tenu ne doit créer aucun nouvel appui ou relâchement. La vraie
libération doit au contraire apparaître. Ce test a d'abord échoué contre la
version qui remettait la manette au neutre avant chaque nouvel état.

## Essayer un jeu

`launch.sh ryubing /chemin/jeu.xci` monte le jeu en lecture seule. Les `.nro`
sont copiés dans le dossier de test : le chargeur homebrew de Ryubing 1.3.3
les ouvre en lecture-écriture et masque l'erreur d'un montage en lecture seule.
Les clés et le firmware de la console doivent être installés dans le dossier
privé de l'émulateur. Ce dépôt ne les fournit pas et ne les télécharge pas.

Les deux archives déposées par Souhib ont été extraites en sélectionnant
uniquement les fichiers de jeu. Le premier NSP porte une mise à jour de type
`Patch`, version 786432. Le second fichier est le XCI du jeu de base, dont
l'en-tête `HEAD` est reconnu. Le premier lancement échouait au déchiffrement.
Le fichier `prod.keys` fourni ensuite a été installé uniquement dans
`$SWITCH_LAB/ryubing-lab/data/system/prod.keys`, avec le mode 0600. Ses valeurs
ne sont ni affichées ni enregistrées dans le dépôt. `title.keys` n'a pas été
nécessaire pour cet essai de cartouche et reste dans l'archive.

Avec les clés, le jeu de base charge en version 1.0.0, puis réclame la police
système `FontStandard`. L'installateur de Ryubing reconnaît le firmware 4.1.0
dans le XCI et l'installe dans le dossier privé du prototype. Pour reproduire
cette installation, arrêter d'abord le moteur puis ouvrir son interface avec
le même `--root-data-dir` et `--install-firmware /chemin/jeu.xci` ; confirmer
la version reconnue avant de relancer le moteur. L'installateur utilise Xvfb
pour son interface ; le jeu utilise le GPU avec Sway depuis le correctif de
fermeture décrit ci-dessous.

L'écran titre et les scènes d'introduction sont visibles depuis Chrome, et
les commandes du navigateur font avancer les dialogues. Quatre pages reçoivent
le jeu, dont une en demi-format. Un clip de 30,23 secondes a été exporté et
son audio AAC stéréo 48 kHz décodé : les deux canaux contiennent un signal.
Ce relevé du 7 septembre ne validait pas encore le match ni la mise à jour.

Le 8 septembre, le NSP fourni a été appliqué : le moteur et le titre affichent
**3.1.0**, pas 3.1.1. Un match en double a été lancé et commandé par les quatre
pages ; des services, déplacements et points sont observés. Le clip de cette
exécution dure 30,55 secondes avec audio stéréo. Quitter l'aventure écrit un
`save7.dat` de 31 232 octets. Après redémarrage, le menu puis l'aventure
reprennent sans rejouer l'introduction. Un arrêt pendant l'écriture n'est pas
couvert. Cette première version quittait avec le code 139 ; le second passage
ci-dessous corrige le mode mémoire et travaille la fermeture sans interface.

La mise à jour est copiée dans le dossier privé monté sous `/run-data`. Le
fichier `data/games/0100bde00862a000/updates.json` de cet essai contient :

```json
{
  "selected": "/run-data/updates/mario-tennis-v786432.nsp",
  "paths": ["/run-data/updates/mario-tennis-v786432.nsp"]
}
```

Ces propriétés sont en minuscules. Les écrire `Selected` et `Paths` laisse le
jeu en 1.0.0 sans erreur : vérifier aussi le journal `Application Loaded` et
l'écran titre. Les fichiers du jeu, de sa mise à jour et du système restent
hors du dépôt. Cette procédure manuelle ne constitue pas un importeur de jeux.

`launch.sh eden` prépare un deuxième prototype avec la version 0.2.1. Dans cet
essai, l'AppImage impose X11 ; Cage fournit Xwayland. Deux demandes de fichiers
de clés apparaissent au premier lancement. Le programme de test échoue ensuite
avec le code 139, y compris après désactivation des options fastmem. Ce résultat
ne suffit pas à déclarer Eden incompatible avec Mario Tennis ou avec le serveur.
Ce chemin conserve Cage et Xwayland ; le correctif de fermeture ne porte que
sur Ryubing et ne prouve rien pour Eden.

## Inspecter un jeu depuis le navigateur

Avec le pont et la capture ouverts, lancer `node spikes/switch-room/drive.mjs`.
Il accepte une commande JSON par ligne et écrit ses captures dans `SWITCH_LAB` :

```json
{"action":"press","buttons":[6,7],"ms":300}
{"action":"press","buttons":[0],"ms":150}
{"action":"join"}
{"action":"press","player":2,"buttons":[13],"ms":150}
{"action":"axis","player":2,"axes":[-1,0,0,0]}
{"action":"shot","name":"joueur-2","ms":1000}
{"action":"axis","player":2,"axes":[0,0,0,0]}
{"action":"stats","name":"releve"}
{"action":"clip"}
{"action":"quit"}
```

Les indices des boutons sont ceux de la Gamepad API standard : 0 pour le
bouton du bas, 9 pour Start, 12 à 15 pour la croix. Le pont existant traduit
ensuite les commandes canoniques GameCube ; ce ne sont pas encore des indices
Switch. `join` ajoute un contexte de navigateur, jusqu'aux quatre places du
transport. Les appuis répétés par `count` sont séparés par un relâchement de
120 ms. Ce pilote sert à inspecter les pixels, pas à déclarer automatiquement
qu'un match fonctionne. Ne pas l'exécuter en même temps que les autres pilotes
qui prennent les places.

## Mesurer la cadence de l'émulateur

`SWITCH_PROFILE=1 spikes/switch-room/launch.sh ryubing /chemin/jeu.xci` active
MangoHud dans le processus de l'émulateur. Le CSV est écrit dans
`$SWITCH_LAB/ryubing-lab/performance`. La capture conserve sa cadence propre ;
son nombre d'images ne mesure pas la vitesse du jeu. Choisir une fenêtre après
avoir observé ce que le jeu affiche, puis résumer les secondes de la colonne
`elapsed` avec `measure-render.py`. La fenêtre du match conservée dans le dépôt
se relit ainsi :

```sh
python3 spikes/switch-room/measure-render.py \
  spikes/switch-room/results/2026-09-08-mario-tennis-render.csv \
  --start 1072 --end 1132
```

Elle donne 38,07 images/s médianes sur 599 relevés, environ une minute. Le
cinquième percentile porte sur des relevés toutes les 100 ms, pas sur chaque
image ; il ne représente pas un « 1 % low ». Le démarrage n'entre pas dans
cette fenêtre. Un intervalle vide ou une valeur invalide font échouer la
commande, au lieu de rendre une mesure vide qui semblerait réussie.

Le défaut est maintenant `HostMapped` avec un plafond `/dev/shm` de 8 Gio.
L'ancien plafond de 512 Mio était rempli avant le plantage ; le même jeu
démarre avec 8 Gio et utilise 3,56 Gio dès le titre. `SWITCH_SHM_SIZE=512m`
avec le binaire amont permet de reproduire ce défaut dans le laboratoire.
`SWITCH_MEMORY_MODE=SoftwarePageTable` reste disponible pour comparer les coûts.
La nouvelle minute à quatre donne 52,41 images/s ; retirer ensemble navigateurs
et captures donne 60,08 sur trente secondes. Les limites de cette comparaison
et les mesures sont dans `results/2026-09-08-fast-stop.json`.

## Tester depuis son appareil

Adresse temporaire, accessible par Tailscale :
**https://lgf.tail3bd01c.ts.net:8445/**. Ce port dessert seulement le prototype.
La salle habituelle conserve ses adresses et processus. Un compte partagé doit
avoir le droit d'atteindre TCP 8445 ; la règle TCP 443 du domaine principal ne
l'accorde pas à elle seule. Aucun accès public par Funnel n'est configuré.

Cliquer sur Jouer, puis sur un bouton de la manette pour la faire reconnaître.
Les deux gâchettes, ou Q + E au clavier, passent l'écran titre. Les touches
sont celles du profil par défaut de nel3ab : flèches, X/C/S/D, Entrée.
Le tableau de la page indique leur correspondance. Choisir Free Play puis
Single-Console Play et le nombre de joueurs. Le bouton Regarder rend sa place ;
Quitter coupe cette page. Les noms, profils et préparation collective de la
salle principale ne sont pas encore raccordés.

Pour fermer le moteur du prototype :

```sh
systemctl --user stop nel3ab-switch-capture
spikes/switch-room/stop.sh
systemctl --user stop nel3ab-switch-bridge
sudo tailscale serve --https=8445 off
```

La fermeture normale a été vérifiée depuis le titre et l'aventure, avec des
sorties 0 en 3,50 et 1,45 seconde. L'essai instrumenté avec `SWITCH_PROFILE=1`
rend encore 139 à la fermeture : cette option reste réservée au banc et n'est
pas activée pour jouer. Ce défaut est conservé dans le relevé, pas masqué.

Le superviseur donne le vrai code de sortie dans `ryubing-lab/lifecycle.json`.
Une fermeture forcée ne compte pas comme un succès. Il ne faut pas reconstruire
le binaire utilisé par une session en cours ; `build-ryubing.sh` le refuse.
Le correctif local vise seulement Linux, le mode sans interface et Vulkan.
La fenêtre système demandant de reconfigurer les manettes est ignorée par
l'option amont dédiée : nos quatre appareils virtuels restent branchés et le
nombre de participants se choisit dans le jeu. Sans cette option, l'aventure
attend une intervention dans une fenêtre de bureau inaccessible.

Lancer `python3 -m unittest discover -s spikes/switch-room -p test_supervise.py`
pour la fermeture avec un processus qui écrit avant de sortir, celui qui refuse
et un plantage. `SWITCH_TEST_URL=https://lgf.tail3bd01c.ts.net:8445 node
spikes/switch-room/check-test-page.mjs` vérifie la page par le proxy, y compris
l'expiration du message de branchement. Ces essais ne manipulent pas la salle
Dolphin. La reconstruction .NET et les bibliothèques récupérées restent privées
au laboratoire ; seuls les correctifs et leurs instructions sont dans le dépôt.

## Son et latence : correctifs du 8 septembre

Le premier essai de Souhib a révélé plusieurs secondes de retard sonore.
L'instrumentation retrouve 1 725 ms dans la file SDL de l'émulateur, avant même
PulseAudio et le transport. `ryubing-audio-queue.patch` abandonne le son ancien
quand la file dépasse 50 ms, en gardant les 15 ms les plus récentes ou au moins
un appel du périphérique audio. Le coût assumé est un trou après un blocage,
pour retrouver le présent. Une file saine garde exactement ses échantillons.
Les buffers rendus au jeu avancent aussi quand leurs échantillons sont retirés.
`build-ryubing.sh` applique ce troisième correctif au commit déjà fixé.

Le rattrapage ne s'applique qu'aux sessions du renderer. Le 9 septembre, Looney
Tunes avait un son déchiré, fluide à l'image : ce jeu passe par AudioOut, le
chemin où le jeu tient lui-même sa file, jusqu'à quatre buffers de 1 024 frames
soit 85 ms, et ne fournit le suivant qu'après avoir vu le précédent consommé.
Cette file n'est pas un retard, c'est une lecture cadencée. La jeter faisait
produire au jeu la suite trop tôt, à chaque appel : la sonde a compté 239 s
jetées en 80 s de jeu. Une session AudioOut est celle ouverte avec un
gestionnaire de mémoire ; le renderer n'en passe jamais. Vérifié avant et après
sur le vrai jeu : 313 discontinuités toutes alignées sur 1 024 frames, puis
aucun alignement et zéro jeté, file stable à 85,33 ms. `test-audio.sh` tient les
deux cas : le jeu invité garde ses buffers, le renderer jette toujours.

`wf-recorder-packets.patch` vise wf-recorder 0.4.1, commit
`d3c26b210f374060fb790602aa573b650363989a` du
[dépôt amont](https://github.com/ammen99/wf-recorder/tree/d3c26b210f374060fb790602aa573b650363989a).
`Dockerfile.capture` le construit en conservant la base du laboratoire. Une
variable privée active la sortie de paquets complets : huit octets pour
l'instant du compositeur en microsecondes, quatre pour la longueur, puis le
H.264. Les entiers sont écrits en petit-boutiste. Une capture ordinaire conserve
son multiplexeur et son origine temporelle. Un seul encodage est désormais
autorisé en vol. Le parseur vérifie longueur, horloge et fin de paquet.

Le changement de couleur d'une fenêtre du compositeur jusqu'au pixel lu dans
Chrome local prend environ 115 ms avant, puis 79 ms après. Cela mesure le chemin
d'affichage artificiel, pas un appui dans Mario Tennis, ni le réseau d'un ami.
Les relevés et leurs réserves sont dans
[results/2026-09-08-audio-latency.json](results/2026-09-08-audio-latency.json).

Les relances de capture ont aussi exposé un piège : le client `docker exec`
s'arrêtait, mais ses producteurs restaient dans le conteneur. Quatre captures
concurrentes ont invalidé une série de mesures en mélangeant image et son.
Le service a maintenant un `ExecStop` qui attend leur sortie réelle ; un verrou
exclusif refuse une seconde capture. Le conteneur a été recréé pour éliminer
les anciens processus qui ne connaissaient pas encore ce verrou.

```sh
spikes/switch-room/test-audio.sh
python3 -m unittest discover -s spikes/switch-room -p 'test_capture*.py'
```

Le test .NET utilise le vrai backend SDL avec un périphérique factice. Restaurer
le backend amont fait échouer la récupération du son récent ; les essais du
son sain, du seuil exact et du silence restent verts. Les deux tests du verrou
et les cinq tests des paquets ont aussi leurs variantes fautives vérifiées.
Les sorties de compilation restent ignorées. `DOTNET` permet de choisir le SDK.

Deux mesures sont volontaires et interrompent brièvement le prototype :

```sh
# Launch first with SWITCH_AUDIO_PROBE=1, then wait for one probe reading.
python3 spikes/switch-room/check-audio-recovery.py
# Briefly displays a coloured window over the game; sends no controller input.
node spikes/switch-room/measure-presentation.mjs \
  /tmp/nel3ab-switch-lab/presentation.json --check
```

Le premier arrête une seconde le seul serveur audio privé et le réveille même
si l'essai échoue. Il exige une nouvelle suppression d'au moins 500 ms, puis
une file revenue sous 50 ms. Le second rejette une médiane supérieure à 100 ms
sur cette machine : le chemin initial mesuré échoue, le correctif passe. Ce
seuil n'est pas une promesse pour un autre ordinateur. Ne pas lancer ces mesures
ensemble ou pendant une compilation et conserver une seule capture active.

## Réduire les attentes et produire le petit flux à la demande

Le passage suivant du 8 septembre traite trois points ensemble. La capture
utilise `-B 60` pour annoncer sa cadence nominale, sans le filtre `fps=60` qui
attend l'image suivante. Le changement ne retire ni les horodatages réels ni
les conversions de couleur. Le navigateur peut abandonner les images dont
l'heure d'affichage est dépassée lorsqu'une image plus récente est déjà due.
Il conserve celles qui sont encore en avance et la marge contre les arrivées
irrégulières. Cette correction vit dans le module média commun, avec deux
essais portant sur le vrai trajet socket, décodeur et dessin.

Le pont répond à une demande privée `D` sur son socket de capture. La trame
porte un instant nul et une longueur nulle ; la réponse est le nombre de
spectateurs du demi-format, sur huit octets en petit-boutiste, puis deux octets
indiquant respectivement une demande d'image-clé plein et demi-format. Ces demandes
sont consommées une fois. Ce nombre vient
du transport Rust. Le producteur l'interroge toutes les 100 ms, hors des
boucles d'image. Il démarre un seul petit encodeur au premier spectateur et
attend sa sortie après le dernier départ. Le plein format continue à remplir
les clips, et le son continue. Une nouvelle demande démarre un encodeur neuf
qui fournit sa propre image-clé.

`check-demand.mjs` vérifie les vrais processus, le décodage des deux formats,
la conservation de l'encodeur avec un spectateur restant, sa sortie après le
dernier départ et sa recréation au retour. Il exige qu'aucun autre spectateur
ne demande le petit format. Pour isoler ce test des amis, le pont peut être
lancé sur le port de boucle locale 8311, sans route Tailscale vers ce port :

```sh
SWITCH_TEST_URL=http://127.0.0.1:8311 node spikes/switch-room/check-demand.mjs
SWITCH_TEST_URL=http://127.0.0.1:8311 SWITCH_BENCH_SAMPLES=61 \
  node spikes/switch-room/measure-presentation.mjs \
  /tmp/nel3ab-switch-lab/three-latency/presentation.json
```

Ne jamais démarrer deux captures vers le même pont. La comparaison du filtre
arrête puis relance uniquement la capture, et remet le fichier testé même si
un essai échoue. Le moteur du jeu n'est pas redémarré. Les résultats sont dans
[results/2026-09-08-three-latency.json](results/2026-09-08-three-latency.json).

## Récupération de la capture, le 8 septembre

Le pont réutilise les demandes d'image-clé du transport Dolphin, avec sa borne
existante de 500 ms par flux. Le contrôle privé `D` transmet les deux drapeaux
à la capture, qui écrit dans `full.key` ou `half.key`. Le correctif de wf-recorder
consomme les demandes avant d'encoder une image intra, puis efface ce choix à
l'image suivante. Il ne redémarre ni l'encodeur ni le jeu pour produire cette clé.

Le pilote `check-keyframes.mjs` demande une clé juste après une clé périodique,
puis cherche une vraie image IDR dans les octets reçus. Sans le raccordement,
l'essai échoue. Avec lui, les deux premières réponses mesurées prennent 34,6 et
30,9 ms. Ce sont deux observations locales, pas une garantie de délai sur Internet.
Le pilote vérifie aussi l'absence de clé imposée à l'autre format et de répétition
sur les images suivantes.

Une panne d'encodeur relance seulement la capture via `Restart=on-failure`.
Le pont, les places, le moteur et ses sauvegardes restent en vie. Trois démarrages
par minute bornent une panne persistante ; un arrêt explicite ne relance rien.
Un producteur qui n'envoie plus de paquet complet avertit après trois secondes
et échoue après trente secondes, comme le worker Dolphin. Un enfant de capture
qui ne répond pas à l'arrêt est tué et attendu avant de libérer le verrou.
Cela ne s'applique jamais au processus de l'émulateur.

Les essais réels ont tué successivement les encodeurs plein et demi-format :
son et image repartent en 2,00 et 2,47 secondes, sans perte de place ni nouvelle
socket vidéo. Un encodeur suspendu, incapable de traiter son signal d'arrêt,
repart en 36,96 secondes, dont les trente secondes du délai de surveillance.
Suspendre le lecteur audio a d'abord bloqué l'arrêt malgré la surveillance :
sa lecture attendait encore un morceau complet. La lecture non bloquante, qui
reconstitue des morceaux stéréo de 1 920 octets, permet maintenant la même reprise
en 36,87 secondes. Les tuyaux réels et le navigateur prouvent ce cas séparément.
La page annonce l'interruption de l'image après trois secondes et retire ce message au
retour de l'image. Ce contrôle observe la production, pas le contenu : il ne
prouve pas qu'un jeu dont le compositeur répète l'image est encore vivant.

À lancer uniquement avec le pont sur `127.0.0.1:8311`, hors de la route des amis :

```sh
just switch-capture-test
node spikes/switch-room/check-keyframes.mjs
node spikes/switch-room/check-capture-recovery.mjs
node spikes/switch-room/check-capture-recovery.mjs --silent
node spikes/switch-room/check-capture-recovery.mjs --silent-audio
python3 spikes/switch-room/check-capture-limit.py
```

Le second pilote tue des processus de capture et le troisième les suspend.
Laisser une minute entre les campagnes, ou arrêter puis recréer l'unité de
capture, pour ne pas mélanger le plafond de redémarrages avec la panne testée.
`check-capture-limit.py` provoque trois échecs consécutifs, vérifie le refus du
quatrième démarrage et l'absence de producteurs orphelins, puis restaure une unité
explicitement demandée. La reconstruction utilise l'image `2026-09-08-recovery`. Lors de cette mise à
jour, seul son binaire de capture a été copié dans le conteneur déjà lancé,
après arrêt des producteurs, afin de garder la partie ouverte. Son empreinte
est comparée à celle de l'image ; l'ancien identifiant du conteneur ne suffit
plus à identifier ce binaire.

Le relevé de cette passe est
[results/2026-09-08-recovery.json](results/2026-09-08-recovery.json). Le dernier
essai HTTPS de quarante secondes affiche 57,35 images par seconde, sans panne
du décodeur ni interruption du son. Le clip réel de 30,05 secondes est décodé
en entier, avec deux canaux audio non muets et le même départ que la vidéo.
Ces vérifications ne remplacent pas une longue partie à quatre amis distants.

## Limites techniques à conserver visibles

Cette section décrit le laboratoire et sa page séparée. Leurs profils locaux
ne décrivent plus les profils synchronisés de la salle intégrée le 9 septembre.
Les limites de capture et de commandes restent applicables aux deux chemins.

Le pont reçoit maintenant son propre format Switch : seize boutons de jeu et
quatre axes, sans modifier la trame GameCube/Wii. Le navigateur conserve la
gestion des places et des reconnexions du projet. Le pont ne multiplie plus par
256 des axes qui étaient déjà codés sur seize bits.

« Jouer » ouvre la configuration avant de prendre une place. « Touches et
manettes » permet de la retrouver ensuite. Le clavier et la manette physique se
réassignent, avec un schéma actif et des profils nommés. Ceux-ci restent dans ce
navigateur ; exporter/importer permet un transfert entre appareils. Les essais
dans cet écran n'envoient aucun appui au jeu. Home, Capture et le gyroscope
restent absents du chemin invité et sont annoncés comme tels.

`just switch-controls-test` reconstruit la page puis le pont. Il teste quatre
navigateurs jusqu'à quatre manettes virtuelles jetables, sans ROM ni émulateur,
avec des noms distincts de ceux de la partie en cours. Il exige Docker,
`/dev/uinput` et l'image de capture citée plus haut. Les résultats et captures
restent dans le dossier temporaire imprimé par le pilote. Les tests Rust du
protocole et du transport et les tests TypeScript de normalisation font partie
de `just`. Le contrôle de mise en page couvre 390 × 844 et 1280 × 980.

Depuis le 8 septembre, le paquet vidéo porte l'instant monotone fourni par
le compositeur. Il part dès que l'encodeur le termine, sans attendre l'image
suivante. Cet instant reste postérieur au rendu du jeu : il ne remplace pas
l'export direct de Dolphin. Le son est encore daté à sa lecture, par morceaux
de dix millisecondes. Le groupe périodique d'images dure une seconde, mais les
demandes immédiates sont maintenant transmises à l'encodeur de chaque format.
Le plein format tourne encore sans spectateur pour conserver les clips ; le
demi-format s'arrête quand personne ne le demande. L'export direct et la mesure
des horloges de bout en bout restent à étudier ; la mise en service du 9 septembre
a conservé cette capture intermédiaire et ses limites mesurées.

Le compteur SD du premier essai ne validait pas les sauvegardes utilisateur de
Mario Tennis. Leur reprise après un arrêt normal a depuis été vérifiée ; une
coupure pendant une écriture reste à tester. Quitter le programme invité du
premier essai n'avait pas arrêté Ryubing dans les cinq secondes observées. La capture du
compositeur peut aussi continuer à produire une image figée après la fin d'un
jeu. Un superviseur doit observer le processus et la session émulée, pas
seulement la présence d'octets vidéo.

Les noms, le chef de salle, les profils personnels et la préparation collective
utilisent normalement le plan de contrôle. Celui-ci n'est pas branché sur ce
prototype. Les places vérifiées sont celles du transport Rust, sans noms.
Le catalogue, les mises à jour et les deux emplacements ont depuis rejoint la
salle via l'adaptateur. Les variantes de manette autres que Pro Controller
restent absentes. Le [guide Switch](../../docs/switch-room.md) donne les commandes
actuelles d'importation et de restauration.

## Provenance et arrêt

`download.py` fixe les versions et vérifie leurs empreintes. Le SDK est fixé par
le digest Docker de `guest/build.sh`. L'image d'essai réutilise l'image Dolphin
locale et les paquets Ubuntu disponibles au moment de la construction. Les
identifiants d'images mesurés sont consignés dans le résultat ; cette base locale
et les paquets apt ne constituent pas encore une construction reproductible sur
un autre serveur.

Arrêter la capture avec `systemctl --user stop nel3ab-switch-capture`, puis le
pont. Tuer le client `docker exec` seul ne termine pas son enfant dans Docker. Arrêter les conteneurs nommés
`nel3ab-switch-ryubing-lab`, `nel3ab-switch-eden-lab` et
`nel3ab-switch-pads-probe`. Ne retirer `pads/media.sock` et `pads/rumble.sock`
qu'après l'arrêt du pont qui les possède. Aucun script ne touche au conteneur
`nel3ab-dolphin`, aux ports du worker réel ou à ses sauvegardes.
