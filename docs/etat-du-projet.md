# État du projet au 9 septembre 2026

Ce point de reprise décrit le travail des 6 au 9 septembre, à la suite de
l'audit du 5 septembre. Il indique où retrouver les décisions, les expériences
et leurs limites. Le [carnet](carnet-de-bord.md#11-septembre-ce-que-le-mois-a-appris)
conserve leur déroulement ; l'[ADR](adr/0001-architecture.md) conserve les règles
qui en résultent. Les anciens plans M1 à M3 sont des archives de conception.

**La salle habituelle propose maintenant GameCube, Wii et Switch.** Dolphin
reste le moteur GameCube/Wii. Ryubing, en version amont `475615f` depuis le
10 septembre, avec les correctifs locaux de `spikes/switch-room/amont/`, exécute
la Switch. Le salon, les places, le chef, les profils et
le transport vers les navigateurs sont communs. Il existe toujours une seule
salle administrée par le projet, avec au plus quatre places de jeu.

## Ce que l'historique Git contient

La lecture du dépôt le 9 septembre retrouve `16eebcb`, du 5 septembre, comme
dernier commit. Les changements de cette conversation sont encore dans l'arbre
de travail, avec des fichiers modifiés et de nouveaux fichiers non suivis.
Certains ont déjà été déployés sur la machine, comme le raconte le carnet.
Un fichier non commité n'est donc pas nécessairement un prototype non utilisé.

Lire les commits seuls manquerait le nouveau protocole de places, la préparation,
les clips sonores et l'intégration Switch. Ce suivi croise les commits, les
sources présentes, les comptes rendus d'essais et les retours de Souhib. Aucun
commit ni envoi vers GitHub n'est créé par cette mise à jour documentaire.

## Ce qui fonctionne et où le retrouver

| Sujet | État au 9 septembre | Raisonnement et preuves |
|---|---|---|
| Audit initial | Relecture indépendante, corrections ciblées et questions encore ouvertes. Aucun total « tout corrigé » n'est revendiqué. | [Audit du 6 septembre](audit-2026-09-06.md), avec ses étapes datées. |
| Noms et places | Le worker donne un reçu à chaque attribution. Le salon associe un nom seulement au reçu confirmé. Une réponse manquante conserve la dernière lecture complète ; elle ne signifie pas que les quatre prises sont libres. | ADR D16 ; carnet, « Des joueurs rangés parmi les spectateurs ». Départs, retours, annonces anciennes et changement de processus exercés. |
| Chef et spectateurs | Couronne, liste des spectateurs et état d'attribution en attente distincts. Reprendre le rôle ou une manette demande une action explicite, une possibilité de réponse et une confirmation. | ADR D19 ; carnet, « Un chef connecté qui n'est plus devant son écran ». Le délai seul ne transfère rien. |
| Préparation du jeu | Avant Wii ou Switch, chaque place prépare son appareil et confirme. Le lanceur confirme ensuite pour tous. GameCube conserve son seul appareil et son lancement direct. | ADR D17 et intégration Switch ; configurations Wii mixtes jouées avec Dolphin dans une salle isolée. |
| Touches et manettes | Dessins physiques reconnus, clavier vers commande émulée, flèches assignables au stick, apprentissage visible et entrées neutres pendant les réglages. Les correspondances sont ouvertes sur une colonne ; le diagnostic brut reste fermé. | [Note du configurateur](ecran-manettes.md), essais de capture, profils et trois styles de menu. |
| Profils | Charger et enregistrer une configuration personnelle, conserver les modifications en attente quand le salon tombe. Dolphin permet aussi de proposer un profil pour un jeu ; les profils Switch se chargent manuellement. Un chargement ne valide jamais « prêt » à la place du joueur. | Note du configurateur ; ADR « Media and personal game profiles » et « Switch room integration ». |
| Branchement et diagnostic | Messages de branchement qui disparaissent après cinq secondes. Diagnostic du lecteur, trajet Tailscale observé quand disponible, signalement confirmé par le salon. | Carnet des 6 et 7 septembre. Le trajet réseau est un indice ; il ne désigne pas automatiquement la cause d'une saccade. |
| Fermer le jeu | Le chef peut fermer la partie et laisser le catalogue ouvert. Redémarrer une salle volontairement vide ne relance pas le dernier jeu. | ADR D18 ; essai réel de fermeture, arrivée d'un spectateur et lancement suivant. |
| Arrêt et reprise Dolphin | Arrêt coopératif, réveil avant fermeture, nettoyage de son propre orphelin avant le contrôle du tuyau audio, silence éveillé borné. | ADR D20 ; arrêt éveillé/en pause, producteur muet et conteneur orphelin reproduits dans une salle séparée. |
| Vidéo et son | Premier décodeur muet surveillé, capacité du demi-format relue, recadrage H.264 compatible avec le demi-format Wii, estimation son/image fondée sur les horaires complets. | Carnet du 7 septembre ; tests de décodeur, conversion GPU et décodage des bords. L'estimation n'est pas une mesure physique chez le joueur. |
| Clips | Vidéo et son sont conservés ensemble ; l'export MP4 encode une piste AAC. Le test décode un signal stéréo connu et refuse les variantes muettes. | Carnet, « Le clip avait une image et aucun son » ; `just clip-audio-test`. |
| Accès des amis | `nel3ab.app` sur TCP 443 et la porte de secours `.ts.net:8443` sont admis par le salon. L'autorisation Tailscale manquante pour 443 a été diagnostiquée ; Souhib confirme ensuite l'accès des amis. | Carnet du 6 septembre ; exemple d'autorisation dans `deploy/tailscale-nel3ab.grant.json`. Le domaine ne rend pas la salle publique. |
| Switch | Manette Pro par place, préparation et profils personnels, plein/demi-format, capture récupérable, son et clips, sauvegardes distinctes par titre. Une livraison de vibration refusée laisse les quatre manettes répondre. | [Utilisation et sauvegardes Switch](switch-room.md), [étude et mesures](etude-switch-2026-09-07.md), carnet des 8 et 9 septembre. |

La connexion au réseau privé reste nécessaire. L'identité vient de Tailscale,
par le proxy ou sa consultation locale ; le worker ne reçoit pas un compte
utilisateur signé. Il autorise les commandes selon les places et le rôle
annoncé par le salon. L'administrateur qui publie la référence de touches et le
chef qui choisit la partie sont deux rôles distincts.

## Jeux Switch effectivement essayés

| Jeu | Vérifié | Limite |
|---|---|---|
| Mario Tennis Aces, 3.1.0 | Double commandé par quatre pages, reprise de progression, lancement des deux emplacements, clip sonore. Sauvegarde communautaire chargée avec niveau 99 et courts d'aventure accessibles. Souhib confirme que le message auparavant bloqué peut être fermé après le correctif de vibration. | Toutes les tenues et tous les défis n'ont pas été inspectés. Les premiers essais d'import avaient involontairement chargé 1.0.0 avant le raccordement de la mise à jour. |
| Looney Tunes: Wacky World of Sports, 0.1.0.27382 | Base et mise à jour fournies, jaquette Nintendo, choix des équipes et personnages par quatre pages, déplacements en basket, clip stéréo de 30,166 s. | Les quatre sports n'ont pas tous été joués. Aucune sauvegarde Switch complète vérifiable trouvée. Les deux emplacements commencent sans progression, même celui nommé « débloquée ». |

Les inscriptions et les données de console restent privées, hors du dépôt.
Une mise à jour NSP seule n'est pas un jeu lançable. Le mode Classique de
Looney Tunes est celui essayé ; les mouvements ne sont pas transmis.

## Pistes écartées, remplacées ou non démontrées

| Piste | Ce qui a changé la décision | Portée de la conclusion |
|---|---|---|
| Utiliser `xerpi/dolphin-switch` pour les jeux Switch | Ce dépôt fait tourner Dolphin sur une Switch. Il continue d'émuler GameCube/Wii. | Écarté pour la fonction demandée, après lecture du dépôt ; aucun essai sur console prétendu. |
| Retenir Eden dès le premier prototype | Eden 0.2.1 quitte avec le code 139 sur le programme de test, y compris sans mémoire rapide. Ryubing fait tourner ce programme. | Choix de Ryubing pour poursuivre. Aucune preuve qu'Eden serait plus lent sur Mario Tennis. |
| Ajouter Citron Neo en même temps | Aucune fonction d'intégration identifiée ne justifie un troisième adaptateur avant de mesurer les deux premiers. | Différé ; aucun benchmark de Citron annoncé. |
| Garder `SoftwarePageTable` parce que `HostMapped` plantait | Le conteneur remplissait sa limite de mémoire partagée de 512 Mio. Le même mode démarre avec un plafond de 8 Gio. | `HostMapped` est retenu après correction de notre quota, pas après changement de langage. |
| Capturer avec Xvfb | Le premier essai retombait sur un rendu logiciel. Cage, puis Sway, ont permis l'affichage privé avec le GPU. | Concerne ce montage mesuré ; ce n'est pas une conclusion sur tous les serveurs X. |
| Lire les paquets vidéo en attendant le suivant | Cette attente ajoutait du retard et perdait l'instant de capture. Le capturateur transmet maintenant un paquet terminé avec l'horloge du compositeur. | Gain mesuré avec une source artificielle jusqu'à Chrome local ; pas une mesure appui-écran distant. |
| Laisser le son ancien se vider naturellement | Une file SDL de plus de 1,7 s ne revenait pas au présent. Les échantillons anciens sont maintenant retirés au-delà de la borne décrite dans l'étude. | Un trou après blocage est préféré à un retard durable. Les échantillons d'une file saine sont conservés. |
| Conclure sur les mesures prises avec plusieurs captures oubliées | Arrêter `docker exec` ne terminait pas son enfant dans Docker. Jusqu'à quatre producteurs mélangeaient leurs sorties. | Séries invalidées. Arrêt des vrais processus, verrou de session, puis nouvelles mesures. |
| Garder le filtre vidéo `fps` pour annoncer 60 Hz | À corrections égales, le filtre réintroduit donne 65,45 ms médianes, contre 41,19 ms sans lui, sur 60 changements de couleur par variante. | Filtre retiré ; cadence nominale annoncée sans dupliquer les images. Ces chiffres ne sont pas la latence de Mario Tennis. |
| Passer à Ryubing amont `475615f` (26 août 2026) | Sur Looney Tunes, dans une sonde, cadence, délai de l'appui à l'image et charge processeur sont égaux à ceux de la version épinglée : 218 ms contre 217 ms médianes à l'écran de titre, 118 contre 110 ms au curseur du menu (série épinglée refusée par un témoin), 276 % contre 277 %. Deux correctifs portés sur SDL3 sont rangés dans `spikes/switch-room/amont/`. | Même vitesse, mais le son SDL3 de l'amont se coupait : 277 silences de 5 ms en 20 s sur le programme de test, 0 sur la version épinglée. Notre correctif rend à chaque session sa période, et le son revient intact. Mario Tennis charge sa sauvegarde niveau 99. Installée dans la salle le 10 septembre. Le même soir, un son en retard croissant a été trouvé en lançant la salle (le rappel SDL3 remettait une période même quand rien ne manquait), corrigé et réinstallé (`ryubing-1.3.3-475615f-c`). L'ancien moteur reste à côté pour revenir en arrière. |
| Réécrire l'émulateur C# en Rust | Aucun port comparable ni mesure n'a été réalisé. Les gains observés viennent des files audio, de la capture, de l'affichage et de la mémoire partagée. | D1 reste applicable. Le langage seul ne permet pas de promettre un gain. |
| Choisir Mario Kart 8 Wii U contre Deluxe Switch sur un chiffre de vitesse | Aucun essai comparatif de ces deux jeux et de leurs moteurs n'a été effectué sur lgf dans cette conversation. | Question encore ouverte ; aucun moteur Wii U intégré. |
| Déclarer Zen corrigé après désactivation du compositeur natif | Souhib a essayé ce réglage et le gel gris persiste. Son rapport décrit une fermeture anormale du canal graphique. | Le défaut Windows reste ouvert. YouTube et Twitch sans panne ne valident pas le chemin WebCodecs/canvas de nel3ab. |

L'[étude Switch](etude-switch-2026-09-07.md) conserve les versions, conditions,
sources et résultats des comparaisons. Une option non essayée reste distincte
d'une option réfutée par une expérience.

## Ce qui reste ouvert

| Sujet | Prochaine preuve utile |
|---|---|
| Gel de Zen sous Windows | Refaire une séance sur le poste concerné, avec heure du gel et diagnostic graphique. Les essais de pilote et d'accélération proposés n'ont pas de résultat confirmé dans le suivi. |
| Demi-format à 5 Mbit/s | Le banc Wii du 7 septembre reçoit encore environ 9,66 Mbit/s sans plafond sur sa scène. Mesurer un contrôle de débit propre au réduit, sans changer le plein. WebRTC n'a pas été comparé au transport actuel. |
| Latence et endurance Switch | `just switch-reaction` mesure l'appui jusqu'à la première image changée sur `/video`, contre des témoins sans appui. Le 10 septembre sur Looney Tunes : 110 à 118 ms médianes au curseur du menu principal selon la version, qui répond aussi vite que le jeu le peut ; la série de la version épinglée est refusée par un de ses témoins. L'écran de titre donne 218 ms, fondu compris, mais son animation fait refuser la série. Le programme de test donne 67 à 70 ms, découpés le 10 septembre (`spikes/switch-room/latence/`) : notre chaîne en prend environ 15 (entrée 0,4, lecture 1,6, compositeur 8,5, transit 4,2), le programme et l'émulation 54. Sway à 120 Hz retire l'attente du compositeur (57 ms au total) et régularise les images ; la salle y est réglée depuis le 10 septembre (`refresh_hz`). Garder l'image affichée jusqu'à la suivante, comme une console, retire une image de plus : 64,5 à 39,9 ms sur le programme de test, 16,7 ms sur Mario Tennis ; la salle l'a depuis le 10 septembre (`hold_front_buffer`). Il manque le réseau et le navigateur du joueur, une partie prolongée avec quatre appareils distants, et un marqueur à l'instant où le jeu remet son image. Le worker rapporte `input_to_frame` pour la Switch depuis son redémarrage du 10 septembre. |
| Émulation Switch figée | Distinguer une session bloquée d'une image volontairement immobile quand le compositeur continue de produire. La reprise de capture ne résout pas ce cas. La sieste automatique de Dolphin n'a pas d'équivalent validé ici. |
| Manettes des places vides | Depuis le 10 septembre, seules les places occupées ont une manette branchée côté émulateur (`ryubing-seats.patch`, fichier `seats` écrit par le worker) : Mario Tennis accepte le simple à deux. La grâce de 5 s avant de débrancher une place vide est choisie, pas mesurée ; mesurer le temps qu'une page rechargée met à reprendre sa place. |
| Commandes Switch supplémentaires | Joy-Con séparés, gyroscope, Home, Capture et fidélité HD Rumble restent hors du périmètre vérifié. Le programme de test et la lecture des périphériques ne prouvent pas chaque action de chaque jeu. |
| Sauvegardes et exploitation | Copie hors machine avec restauration exercée ; import générique par titre ; arrêt pendant une écriture. Les copies locales actuelles ne protègent pas d'une perte du disque. |
| Déploiement reproductible | Le service exécute encore `core/target/release/nel3ab-worker`. Un build release peut devenir le prochain binaire servi. Séparer le binaire installé, les builds et les versions de l'adaptateur. |
| Ancien audit | Suivre les constats restants sans reprendre les anciens nombres comme un état courant. Les patches Dolphin, la surveillance mémoire, le fichier LICENSE et certaines corrections de messages restent à traiter ou à revalider. |
| Test GPU intermittent | Le 9 septembre, un test de conversion dma-buf a échoué pendant l'essai de deux jeux, puis passé seul et dans la porte complète sans changement de code. La cause n'est pas démontrée ; ne pas élargir son seuil. |

## Reprendre et vérifier

Commencer par l'ADR, puis la note propre au domaine. Pour les touches, lire
`ecran-manettes.md` avant de changer les dessins. Pour la Switch, lire
`switch-room.md` avant de lancer les anciens scripts du laboratoire : une partie
de `spikes/switch-room` sert désormais à la salle installée.

| Changement | Vérification à rejouer |
|---|---|
| Documentation | `just docs`, qui construit aussi le répertoire servi sous `/docs`. |
| Code commun | `just` : qualité Rust/Python/page, GPU, clip audio, sauvegardes et capture Switch. |
| Contrat HTTP généré | `just contract-check` après préparation de l'index correspondant ; voir la réserve ci-dessous. |
| Configurateur et préparation | `just browser-configuration`, `just browser-preparation` et `just preparation-test '/chemin/Mario Kart Wii.rvz'`, avec les prérequis des pilotes. |
| Cycle de vie Dolphin | `just resilience-test '/chemin/Mario Kart Wii.rvz'`. |
| Commandes Switch | `just switch-controls-test` : quatre périphériques jetables, y compris retour de vibration refusé. |
| Passage entre consoles | `NEL3AB_TEST_SWITCH_CONFIG=~/.config/nel3ab/switch.json just switch-room-test '/chemin/Mario Tennis Aces.xci'`. |
| Catalogue | `just catalogue-test`, avec Mario Tennis et Looney Tunes inscrits localement ; aucun jeu lancé. |
| Dépendances | `just audit`. La CI exécute séparément ses jobs qualité, dépendances Rust et documentation. |

La dernière porte complète locale du 9 septembre passe, après l'échec GPU décrit
plus haut. Le catalogue dans les trois menus et la documentation stricte passent
également. Ce n'est pas une CI distante : aucun nouveau commit n'a été envoyé.
Les comptes d'essais historiques restent datés dans le carnet.

Le contrôle du client généré compare ses sorties à l'index Git. Pendant ce
travail non commité, les vérifications ont utilisé un index temporaire contenant
les schémas et le client de l'arbre courant. Leur régénération devait rester
identique ; l'index habituel n'a pas été modifié. Cette condition accompagne le
résultat, elle ne transforme pas le dépôt en arbre propre.

Les résultats synthétiques conservés sous `bench/results` et
`spikes/switch-room/results` peuvent être repris avec le dépôt. Les captures et
journaux sous `/tmp/nel3ab-*` sont des pièces temporaires et peuvent disparaître.
Le carnet garde donc les observations et leurs limites sans dépendre uniquement
de ces chemins. Le répertoire local de travail doit être conservé tant que ses
changements n'ont pas été enregistrés dans l'historique.
