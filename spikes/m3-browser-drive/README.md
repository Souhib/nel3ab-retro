# Driving the browser half without a human

The worker's page can only be judged in a browser, and lgf has none. This runs a
real one **on the server**, headless, against `localhost` — which also sidesteps
the secure-context problem: WebCodecs needs one, and `http://` on a LAN IP is not
one, while `http://localhost` is.

```sh
npm install puppeteer          # Chrome for Testing; ~180 MB, downloaded once
node drive.mjs http://localhost:8100/ 20
NO_INPUT=1 SHOT=control.png node drive.mjs http://localhost:8100/ 20
```

It reports what the page says about itself, samples the canvas for distinct
colours, and leaves a screenshot to **look at** — which is the check every hollow
claim in this project turned out to be missing.

## The control matters more than the run

The first comparison here was wrong in a way worth remembering. Two runs against
the **same** worker: one pressing keys, one not. Both showed the game past its
opening dialog, which looked like proof that input worked — and proved nothing,
because the second run inherited the emulator state the first had changed.

Redone with a fresh Dolphin per arm, same duration:

| | frames | what was on screen |
|---|---|---|
| no keys | 1141 | the memory-card dialog, unmoved |
| keys | 1119 | dialog dismissed, the intro playing |

M1 measured that this dialog never changes on its own — 7037 byte-identical
frames — so a screen that has moved past it *is* the evidence, provided the run
started from the same place.

## What it does not measure

`localhost` is not a network. The arrival-to-glass figures the page prints
(p50 0.6 ms, p95 2.4 ms on this loop) are transit-free by construction. A number
from here is a floor for the browser half, and says nothing about Wi-Fi.

`node_modules/` is not committed; nothing in the worker depends on this.

## Deux pilotes qui sont partis dans les tests unitaires

`padmap.mjs` et `lesson.mjs` conduisaient un vrai Chrome contre un vrai worker
pour vérifier deux choses **pures**: la correspondance entre un bouton de manette
et un bit du protocole, et la machine à états qui apprend une manette inconnue.

Depuis que la boucle média est en modules TypeScript, ces deux-là sont
`front/src/media/pad.test.ts` et `front/src/media/lesson.test.ts`. Ils font les
mêmes assertions, tournent en quelques millisecondes au lieu de vingt secondes,
ne demandent ni GPU ni session, et surtout ne demandent plus à la page d'ouvrir
une porte de test dont eux seuls se servaient.

Ce n'est pas une règle générale contre les pilotes de navigateur: ce qui reste
ici vérifie des choses qu'aucun test unitaire ne peut voir, comme un décodeur qui
meurt, un onglet qu'on met en arrière-plan, ou deux pages qui se disputent une
manette.

## Franchir l'écran de salle

La page demande un prénom, puis montre la salle avant d'y entrer. Chaque pilote
passe donc par `open.mjs`: `seedName` écrit le prénom là où la page le range,
`enterRoom` clique le bouton. Le clic plutôt qu'un drapeau caché: un chemin
d'essai qui contourne l'écran ne prouve rien de l'écran.

## Touches et manettes

`just browser-configuration` vérifie le configurateur isolé. Démarrer Vite sur
le port 5202 dans `front/` avant de le lancer. Le pilote ouvre
`/bindings-preview.html`, remplace seulement la manette physique, et exerce les
vrais composants et la vraie boucle d'entrée. Aucune socket de jeu ni écriture
vers le salon n'est ouverte. Les captures vont dans `/tmp/nel3ab-configuration`.

Il vérifie une réassignation, les deux lectures du schéma, un axe du clavier,
les profils nommés, l'apprentissage sur téléphone et son annulation. Les aperçus
`?shell=wii` et `?shell=switch` vérifient aussi le défilement de quatorze réglages
et leurs libellés, sans construire la boucle d'entrée. Il complète
`bindings.mjs`, qui exige une salle et vérifie aussi la survie au rechargement.
Le pilote isolé ne prouve ni le pilote USB ni la réception par Dolphin.

`just browser-preparation` ouvre `bindings-preview.html?preparation=1` sur Vite
(port 5202). Le pilote vérifie la sauvegarde, le chargement après relecture et
la suppression d'un profil, deux états « prêt », puis le défilement sur téléphone.
Le faux lancement ne construit aucune connexion de jeu. Les vrais échanges
entre joueurs et le port de contrôle sont vérifiés dans les tests Socket.IO et
Rust, sur des ports éphémères. Ces preuves ne remplacent pas une partie dans
Dolphin avec plusieurs types de manette.

`just preparation-test '/chemin/Mario Kart Wii.rvz'` lance `preparation-room.mjs`
sur une salle complète temporaire. Il construit le binaire de développement,
démarre son propre salon et Dolphin, puis ouvre des navigateurs sous trois
identités de test. Il vérifie les noms lors du passage en spectateur, la couronne,
les profils personnels relus sur un autre navigateur, la confirmation collective
et les places après le redémarrage. Le disque doit être disponible en lecture ;
les sauvegardes, le conteneur, le proxy et les ports appartiennent à l'essai.
Le pilote ferme ses processus et conserve ses traces dans le dossier temporaire
annoncé. Aucune adresse de salle existante ne peut lui être passée.

`just seat-migration-test '/chemin/Mario Kart Wii.rvz'` ajoute une page réellement
antérieure aux reçus, lue dans Git au commit `16eebcb`. Il vérifie qu'une
reconnexion conserve son ancien code, que son nom reste en attente sans devenir
spectateur, puis qu'une actualisation rétablit son nom. Il redémarre ensuite le
seul salon temporaire : les noms doivent revenir sans changer les attributions
ni relancer Dolphin. Le parcours de préparation collective reste dans
`preparation-test` : son initiateur est choisi par l’ordre d’arrivée initial,
alors qu’un redémarrage du salon élit son chef selon l’ordre des reconnexions.

Il utilise le GPU. Le lot ordinaire de tests GPU ne doit pas tourner en même
temps si l'on veut interpréter ses mesures de durée. Le résultat automatique
prouve le parcours jusqu'aux images et à la configuration réelle de Dolphin.
L'identification des appareils dans l'écran multijoueur du jeu a aussi été
observée manuellement le 6 septembre, dans les deux sens GameCube/Wiimote.

Le pilote `clip.mjs` entre en spectateur et vérifie désormais les deux pistes du
MP4, leurs durées et le décodage du son. Il relève son niveau sans exiger qu'un
jeu silencieux fasse du bruit. `just clip-audio-test` vérifie séparément un signal
stéréo connu et son instant de début, sans ouvrir la salle.

`just idle-room-test '/chemin/Mario Kart Wii.rvz'` vérifie une fermeture réelle
par le chef spectateur, le retour aux menus pour tous, l'absence de Dolphin,
le repos après redémarrage et le lancement Wii collectif depuis le repos.
La salle est entièrement jetable, avec ses ports, son conteneur et ses sauvegardes.
Pour vérifier aussi le lancement GameCube, fournir
`NEL3AB_TEST_GC_ROM='/chemin/Super Smash Bros Melee.rvz'` à cette recette.
Le pilote ferme ensuite le jeu Wii et lance Melee depuis le repos, sans demander
une configuration Wii.
## Reprendre une place ou le rôle de chef

`just recovery-test '/chemin/Mario Kart Wii.rvz'` ouvre trois pages dans une
salle temporaire. Il vérifie le refus, le délai réel de vingt secondes suivi
d'une confirmation, la couronne, le nom après reprise et le refus d'une ancienne
attribution. Aucun redémarrage de la vraie salle. Les captures et journaux restent
dans le dossier temporaire annoncé par la commande.

## Reprises et sessions à quatre

Les deux premières recettes demandent Mario Kart Wii. Le banc réseau accepte
aussi un jeu GameCube, par exemple Melee, qui dispose du format réduit. Toutes
créent une salle temporaire.
Elles ne modifient ni les sauvegardes ni les services de la salle habituelle.

- `just resilience-test <rom>` : SIGTERM éveillé et en pause, producteur muet,
  refus d'un conteneur d'une autre session et récupération d'un orphelin.
- `just room-churn-test <rom>` : quatre joueurs, trois cycles de départs,
  passages en spectateur, coupures réseau, branchement et lancement Wii collectif.
- `just network-room-test <rom>` : deux flux pleins et un réduit, plafond réel
  avec `limited-link.mjs`. Le résultat inclut les octets délivrés et la scène.
  Le relais borne sa file et ralentit les lectures en amont ; le vieux
  `throttle.mjs` conserve une file JavaScript sans borne et ne mesure pas cette
  contre-pression. Aucun de ces pilotes ne reproduit à lui seul une course jouée
  ni les pertes du Wi-Fi d'un ami.

Pour rejoindre une course avant le banc réseau, lancer la recette avec
`NEL3AB_TEST_NETWORK_MANUAL=1`. Le pilote écrit l'adresse de son navigateur
dans `browser.json` et attend dix minutes au plus. Préparer le jeu dans ce
navigateur, activer le son sur chaque page, puis écrire dans `measure-ready`
la description exacte de la scène et des commandes. Cette description et les
captures avant et après chaque plafond accompagnent `network.json`. Un kart
contre un mur ne valide pas le débit d'une course en mouvement.
`NEL3AB_TEST_SEED_SAVES=/chemin/de/sauvegardes-de-test` copie des sauvegardes
existantes dans le dossier jetable avant le lancement ; ce dossier source
n'est jamais utilisé directement par Dolphin.


La Switch dans la salle principale se vérifie avec `just switch-room-test ROM`.
Le pilote `switch-room.mjs` prend `NEL3AB_TEST_SWITCH_CONFIG`, copie les données
système dans des emplacements de test et traverse GC, Wii et Switch avec quatre
navigateurs. Il vérifie les départs, la reconnexion, un spectateur réduit à
5 Mbit/s et le son du clip. `NEL3AB_TEST_SWITCH_SAVE` ajoute l'importation Tennis
isolée ; `NEL3AB_TEST_SWITCH_SECONDS` règle la durée finale (180 s par défaut).
Les services installés gardent leurs ports, identités et sauvegardes.

`just catalogue-test` vérifie seulement le catalogue : trois silhouettes de
console, jaquette Mario Tennis décodée dans les trois menus et éditeur présent.
Il utilise un worker temporaire au repos et la bibliothèque locale en lecture
seule. Aucun émulateur ni plan de contrôle installé ne participe à l'essai.
