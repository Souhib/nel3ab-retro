# Plan d'exécution : liaisons faibles, gels et mesure, 23 septembre 2026

Ce plan range en étapes tout ce que les soirées du 13 au 22 septembre ont appris :
la boîte noire, les gels de l'émulateur, le GPU débridé qui fabriquait des gels,
les joueurs à liaison faible, et [l'étude du transport](etude-transport-2026-09-22.md)
qui compare notre code à celui de Moonlight, Sunshine et des navigateurs.

Il ne décrit pas ce qui marche déjà. Il décrit l'ordre dans lequel attaquer ce qui
ne marche pas, ce que chaque étape doit prouver pour être déclarée finie, et ce qui
la bloque.

## La règle qui vaut pour chaque étape

Rien ici n'est mesuré. Chaque étape commence donc par une ligne de base et se
termine par une comparaison, selon la méthode que ce dépôt s'est donnée à ses
dépens :

- **une mesure en direct s'alterne** : quatre phases de trois minutes, A B A B.
  Le 16 septembre, deux comparaisons successives ont donné deux conclusions
  fausses dans la même soirée ;
- **on ne mesure pas une machine en la chargeant** : pas de profileur ni de
  `perf report` pendant une phase ;
- **un essai rouge d'abord, et son jumeau** : chaque garde nouvelle échoue quand
  on remet le défaut, et un joueur sur une bonne liaison ne doit rien voir changer ;
- **une entrée au carnet dans le même changement**, et une entrée d'ADR dès qu'une
  décision existante est rouverte (D7, D9, D10, D14 sont concernées plus bas).

Les chiffres visés ci-dessous sont des cibles pour décider, pas des promesses.

## Ce qui est déjà acquis, et qu'il ne faut pas refaire

| Acquis | Où |
|---|---|
| La boîte noire relève la machine toutes les 2 s en partie, sept jours gardés | ADR D21 |
| Un gel d'une seconde déclenche une capture, avec le profil des secondes d'AVANT | carnet du 16 et du 17 septembre |
| Chaque page relève l'écart entre images reçues, sa manette, son onglet, son appareil | carnet du 14 septembre |
| La page repropose le format réduit quand une liaison s'effondre | carnet du 17 septembre |
| Débrider le GPU fabrique des gels : écarté, mesuré en alternance | carnet du 16 septembre |
| Le noyau 7.0 ne laisse plus dériver l'allocateur de mémoire vidéo | carnet du 14 septembre |

## Phase 0 : remettre la mesure d'aplomb

Rien d'autre ne se mesure honnêtement tant que ces cinq points ne sont pas faits.
Tout se fait hors partie, sauf la ligne de base.

**0.1 Redémarrer le salon, et empêcher que ça se reproduise.** Le salon en service
date du 14 septembre et ignore l'événement « qualité » ajouté le 16 : les
propositions de format réduit partent dans le vide depuis une semaine, sans aucun
signal. Le redémarrer règle ce cas. Le garder réglé demande une garde : étendre
`deploy-check` pour signaler un service **démarré avant le dernier commit qui
touche son code**. C'est le même défaut que l'unité fantôme du 16 septembre, vu
de l'autre côté : `deploy-check` compare aujourd'hui des fichiers, pas ce qui
tourne.
*Fini quand* : la garde rougit sur le salon actuel, verdit après redémarrage, et
une ligne « qualité » apparaît au journal à la première proposition.

*Fait le 23 septembre*, sauf la dernière ligne. Le salon avait déjà été relancé
le matin même par les mises à jour automatiques. `deploy-check` compare
maintenant l'heure de démarrage de chaque service actif à la plus récente
modification du code qu'il exécute. La garde a rougi deux fois, une fois en
avançant l'heure d'un fichier et une fois sur le vrai code de 0.2, puis a verdi
après redémarrage. La ligne « qualité » attend une vraie proposition, donc une
soirée.

**0.2 Dire si c'est la salle ou une page qui gèle.** Le 22 septembre à 23:25, la
boîte noire a pris une capture complète, profil compris, pour un gel de 8,9 s…
qui ne concernait que Hyde : les deux autres pages étaient à 19 et 29 ms au même
instant. Le déclencheur doit porter une **portée** : « salle » quand au moins deux
pages gèlent dans la même fenêtre, « page » sinon. Une capture de page n'a pas
besoin du profil de l'émulateur.
*Fini quand* : l'essai rejoue les relevés réels de 23:25 et rend « page » ; son
jumeau, deux pages gelées à la même seconde, rend « salle ».

*Fait le 23 septembre.* Une page seule qui gèle reste « salle », puisque rien ne
dit que la salle allait bien. Chaque portée a sa pause, et une chute de salle
fait taire les gels de page. Une capture de page garde journaux, pages et
compte d'allocations, sans profil de l'émulateur ni tampon roulant.

**0.3 Un banc de liaison dégradée.** `slowlink.mjs` plafonne le débit mais ne
perd rien et ne fait pas de gigue, alors que le cas de Hyde est justement de la
perte. Une recette `just banc-liaison <Mbit/s> <perte %> <gigue ms>` combine
`throttle.mjs` et `tc netem`, et sort les chiffres qui comptent : chaînes cassées
et images manquées (journal du worker), pire écart reçu, gigue, trous de son.
*Fini quand* : falsifié dans les deux sens. Zéro perte donne zéro chaîne cassée,
1 % de perte en donne.

*Fait le 23 septembre, avec un critère corrigé.* 1 % de perte SANS délai ne
casse rien: sur un aller-retour proche de zéro, TCP répare une perte avant que
la file du worker ne se remplisse (pire écart 238 ms, aucune chaîne cassée). La
falsification tient avec un aller-retour réaliste, en alternant: 20 ms de gigue
seule donnent zéro chaîne cassée, 20 ms et 1 % de perte en donnent deux, puis
cinq et trois avant que la fenêtre ne soit bornée (voir le carnet).

**0.4 La ligne de base.** Trois profils, relevés avec le code d'aujourd'hui, qui
serviront de référence à toutes les phases :

| Profil | Débit | Perte | Gigue | Qui il représente |
|---|---|---|---|---|
| Local | libre | 0 % | 0 ms | Souhib, Tomy |
| « Hyde » | 6 Mbit/s | 1 % | 20 ms | un Wi-Fi qui perd |
| Étroit | 3 Mbit/s | 0,5 % | 10 ms | une liaison juste |

*Relevée le 23 septembre* sur Mario Power Tennis, salle vide, écran de
démonstration. Une minute par profil, après vingt secondes de chauffe.

| Profil | Images/s | Pire écart | Chaînes cassées | Images manquées |
|---|---|---|---|---|
| Local (début, fin) | 59,9 ; 59,9 | 48 ms ; 29 ms | 0 ; 0 | 0 ; 0 |
| « Hyde » | 19,4 | 720 ms | 4 | 2128 |
| Étroit | 22,5 | 569 ms | 3 | 2111 |

**C'est une tendance, pas une référence.** Le débit du flux suit l'écran de
démonstration, de 0,8 Mbit/s sur le menu à 25 Mbit/s pendant l'échange. Une
partie réelle de Hyde tenait 6,4 Kio par image en médiane; la démonstration en
tient 63 Kio. Les deux profils étroits sont donc surtout un débit trop faible
pour ce contenu. Pendant « Hyde », la page est passée d'elle-même au format
réduit (640x448), ce qui change encore la comparaison. Une référence utilisable
demande un contenu stable: une scène rejouée, ou une partie réelle mesurée en
alternance.

**0.5 Finir de vérifier ce qui a été posé le 17 septembre.** L'écart entre images
côté capture n'a pas encore été vu en service : il faut une salle relancée. Et
`backend_threading: On`, posé dans les treize sauvegardes Switch, attend sa mesure
alternée. Celle-ci demande un redémarrage du jeu par phase : quatre lancements.
*Corrigé le 27 novembre 2026* : `backend_threading: On` n'a jamais été actif,
car Ryubing sans fenêtre ne lit pas Config.json. Auto vaut On sur Vulkan : il
n'y a rien à mesurer entre ces deux valeurs (ADR D52).

*En attente d'une soirée* : les deux points demandent une vraie partie.

## Avant de commiter le micro : dix défauts relevés en revue

Le micro est en cours d'écriture et n'est pas commité. Une revue du 23 septembre y
relève dix défauts, **lus dans le code et non exécutés**. Les trois premiers ont
été revérifiés à la main. Ils se corrigent avant tout commit du micro, et avant
l'étape 2.2.

**Corrigés le 23 septembre**, chacun avec un essai vu rouge en remettant le
défaut. Le détail est dans le carnet, « Le micro relu avant son commit ». Reste
non prouvé: un clip réel à deux micros.

| # | Défaut | Ce qu'on entendrait | Où |
|---|---|---|---|
| 1 | Chaque morceau de voix est daté à son ARRIVÉE. Le navigateur les envoie par rafales de 85 ms, ils reçoivent presque la même date, et le rendu les écrase | Environ 20 ms de voix sur 85 : une voix hachée, aux trois quarts absente | `stream.rs`, `mic_thread` ; `clip.rs`, `render` |
| 2 | Tous les micros partagent une seule file, recopiée au lieu d'être additionnée | À deux micros ouverts, une seule voix à chaque instant | `clip.rs` |
| 3 | La page ne rouvre jamais la socket du micro | Après le premier changement de jeu, plus aucune voix, pendant que le bouton dit « micro ouvert » | `mic.ts` |
| 4 | Un `stop()` pendant la demande de permission est écrasé quand elle aboutit | Le micro capture encore après qu'on a quitté la salle, voyant d'enregistrement allumé | `mic.ts` |
| 5 | Une page disparue sans fermer sa socket garde son fil et son badge pour toujours | Un badge de micro fantôme sur un siège | `stream.rs`, comparé à `input_thread` qui, lui, abandonne après `GONE_AFTER` |
| 6 | Un contexte audio forcé à 48 kHz échoue dans Firefox sur un casque à 44,1 kHz, et le contexte n'est jamais fermé | « micro refusé » alors que la permission est accordée | `mic.ts` |
| 7 | Le siège du badge est fixé à l'ouverture et ne suit pas un changement de siège ; les réclamations sont devinables | Badge sur le mauvais siège, ou allumé par une autre page | `stream.rs` |
| 8 | Un seul bit par siège : la fin d'une ancienne socket efface le bit d'une nouvelle | Micro ouvert, badge barré | `stream.rs` |
| 9 | La documentation de `now()` promet une datation à une image près, ce qui ignore les 85 ms de tampon et le transit | La voix arrive 150 à 250 ms après ce qu'elle commente, et le commentaire dit le contraire | `clip.rs` |
| 10 | Tirets cadratins dans les commentaires et le carnet du micro | Convention de prose | `mic.ts`, `clip.rs`, `stream.rs`, carnet |

**Pourquoi l'essai actuel ne pouvait rien voir.** L'essai Rust de bout en bout
donne à chaque morceau une date parfaite, espacée exactement de 10 ms. Les défauts
1 et 2 n'existent que quand les dates arrivent groupées. L'essai rouge d'abord doit
donc rejouer une vraie rafale : huit morceaux à la même date, puis deux sièges
entrelacés.

**Ce que la correction a en commun avec la phase 2.** Les défauts 1, 6 et 9 ont la
même racine : un `ScriptProcessor` à grand tampon et une date prise à l'arrivée.
La direction qui les règle ensemble est celle de l'étape 2.2 : un `AudioWorklet`
qui livre des morceaux courts, chacun **daté à la capture** sur l'horloge partagée,
puis encodés en Opus. Un rendu par siège, additionné avec saturation, règle le
défaut 2.

## Phase 1 : des réglages, sans changer de protocole

Quatre changements indépendants, chacun mesurable en une soirée sur le banc. Ils
visent le profil « Hyde » sans rien coûter au profil « Local ».

**1.1 Plafonner la taille d'une image.** `max_frame_size` existe dans notre
encodeur. Une image va aujourd'hui de 6,4 Kio (médiane) à 60 Kio, pour une file de
deux images par spectateur. Le plafond s'ajoute au shim et devient un réglage du
worker.
*Cible* : la moitié des chaînes cassées en moins sur le profil « Hyde ».
*Coût à vérifier* : une image plus molle dans les scènes chargées, à juger sur
captures d'écran, pas seulement sur chiffres.

*Écartée le 23 septembre, par une expérience d'une minute.* Le pilote annonce
bien `max_frame_size`, mais FFmpeg le refuse en qualité constante : « Max frame
size is invalid in CQP rate control mode ». Le plafond demanderait un mode à
débit cible, que la mesure du 16 août a écarté (voir 1.3). La clé encodée huit
crans plus grossière reste le seul plafond possible sans rouvrir D7.

**1.2 Une file par spectateur qui s'adapte.** `OUTGOING_DEPTH = 2` est la même
pour tout le monde. La page, elle, adapte déjà sa marge : elle grandit quand
l'image manque, se rend quand tout va bien, et reste bornée. La file du worker
doit faire pareil, par spectateur : grandir après une chaîne cassée, jusqu'à six
ou huit images, et redescendre après une période calme.
*Cible* : un hoquet de 100 ms n'est plus un gel d'une seconde.
*Jumeau* : le spectateur local garde une file de deux et aucune latence ajoutée.

*Codée le 23 septembre, puis tenue à deux par la mesure.* La politique existe
et est éprouvée (`stream::Depth` : deux au départ, doublée à chaque image
refusée, une place rendue par vingt secondes calmes), mais `MAX_DEPTH` vaut deux
en service. Deux mesures se sont contredites :

- sur l'écran de démonstration d'un jeu, dont le débit changeait d'une minute à
  l'autre, une file jusqu'à huit semblait manquer moitié moins d'images (deux
  paires seulement) ;
- sur un clip rejoué, les mêmes images à chaque passage, 3 Mbit/s, 1 % de perte,
  20 ms de gigue, ordre équilibré A B B A : file de deux, 0, 0, 0, 1, 0 et 1
  chaîne cassée ; file jusqu'à huit, 2, 3, 2 et 6.

Quand la liaison ne suit pas durablement, une file plus longue retarde la
chaîne cassée sans l'éviter. La file visait les hoquets courts, et le banc ne
sait pas encore en produire : à rouvrir avec une mesure qui en contient.

*Le vrai réservoir de latence est ailleurs.* Avec une file de deux, la page ne
recevait que 35 images sur 50 sans qu'aucune soit jetée : le retard s'entassait
dans les tampons TCP entre le worker et la page. En service, le tampon d'envoi
du proxy vers le joueur joue ce rôle. C'est une piste à part entière, pas un
réglage de la file du worker.

**1.3 Débit cible ou qualité constante.** Une EXPÉRIENCE d'abord, pas un
changement : comparer CQP à QVBR ou VBR sur le banc. Le débit varie aujourd'hui
d'un facteur dix-sept selon la scène. Mais un flux partagé fait payer la décision
à tout le monde : elle se tranche dans un amendement de D7, pas dans un réglage.

*Déjà fait le 16 août 2026, et l'étude l'avait manqué.* Le commentaire du shim
(`csrc/nel3ab_encode.c`, au-dessus de `i_quant_offset`) garde la mesure : QVBR
divisait le débit et la qualité par deux et rendait une pointe PIRE (120 805
octets), CBR à 12 Mbit/s plafonnait la pointe mais redistribuait les bits sur
toutes les images. Le seul plafond retenu est la clé encodée huit crans plus
grossière. L'étape ne se refait pas sans raison nouvelle.

**1.4 Basculer tout seul vers le format réduit.** La page propose déjà, et
repropose en cas d'effondrement. Le 22 septembre, Hyde a basculé à la main quatre
minutes après les premiers symptômes. Proposer la première fois, puis basculer
seul en cas d'effondrement franc, avec une ligne au journal.
*Dépend de* 0.1 : sans salon à jour, on ne saurait pas si ça sert.

*À trancher, pas à coder.* `Struggling` (`front/src/lib/vitals.ts`) dit
explicitement qu'elle « ne bascule pas toute seule » parce que « le format se
choisit ». Basculer seul revient sur ce choix. Les événements « qualité » ne sont
enregistrés que depuis le 23 septembre : quelques soirées diront combien de
propositions sont acceptées avant de décider.

## Phase 2 : le son, dans les deux sens

Le son est le plancher de toute liaison faible, et nous le payons deux fois.

| Sens | Aujourd'hui | Avec Opus | Chez Moonlight |
|---|---|---|---|
| Descendant, par personne | 1,5 Mbit/s en PCM stéréo | environ 0,1 Mbit/s | 96 kbit/s, plus 50 % de redondance |
| Montant (micro), par personne | 768 kbit/s en PCM mono | environ 0,03 Mbit/s | sans objet |

Vérifié le 23 septembre dans les données de compatibilité : Firefox décode l'Opus
depuis la version 130 et l'encode depuis la 130. Tous les joueurs du 22 étaient en
Firefox 156.

**2.1 Le son descendant en Opus.** Côté worker, un encodeur Opus par une crate
qui expose une API sûre : le code `unsafe` reste chez elle, aucun module de plus
chez nous, donc la règle 2 n'est pas en jeu. Côté page, un `AudioDecoder`, et la
programmation des morceaux sur l'horloge du matériel reste celle d'aujourd'hui.
Opus dissimule lui-même un morceau perdu, ce que notre PCM ne sait pas faire.
*Une voie à peser* : le `libavcodec` du système embarque déjà l'encodeur
`libopus` (vérifié le 23 septembre, `ffmpeg -encoders`). Passer par le shim
`encoder::av`, déjà un module `unsafe` autorisé, n'ajoute ni dépendance ni module.
Une crate Rust demanderait `libopus-dev` ici et sur l'exécutant de CI.
*Mesuré sur le banc le 23 septembre* : à 3 Mbit/s, 1 % de perte et 20 ms, le son
PCM divise par deux les images reçues (18 à 27 par seconde contre 38 à 42 sans
son) et cause toutes les chaînes cassées (2 à 5 par minute contre 0). Reste la
mesure d'une vraie soirée : la sourdine ferme maintenant la socket du son.
*Décision* : amendement de D10, rédigé le 23 septembre comme
[proposition](adr/proposition-d10-opus.md), en attente d'acceptation. Sa condition de réouverture est remplie, mesurée
le 22 septembre : le son pesait 44 % du trafic de Hyde en format réduit.
*Fini quand* : le son descendant tombe sous 0,15 Mbit/s, les trous de son
n'augmentent pas sur le banc, le décalage image-son mesuré ne bouge pas, et le coût
processeur de l'encodage est relevé.

**2.2 Le micro en Opus.** Même raisonnement dans l'autre sens, par un
`AudioEncoder` dans la page et un décodage côté worker, puisque les clips
enregistrent la voix. La voie montante est souvent la plus faible d'une connexion
domestique : 768 kbit/s de voix brute y pèsent plus lourd que sur la descente.
*Dépend de* la revue du micro (section plus bas) : les défauts relevés se
corrigent avant de changer son format.

## Phase 3 : un transport qui ne bloque pas

C'est la suite de D9, qui nommait elle-même sa condition de réouverture : « si ceci
quitte un jour le tailnet ». Hyde est un joueur hors du réseau local, avec de la
perte : la condition est remplie.

**3.0 D'abord une décision, pas du code : l'identité sans proxy.** D14 repose sur
un fait mesuré : tout passe par `tailscale serve`, qui écrit l'identité dans chaque
requête, et nos services n'écoutent que sur 127.0.0.1. Or ni `tailscale serve` ni
Caddy ne relaient WebTransport. Un transport UDP direct casse donc cette garantie.
Deux pistes à peser dans une entrée d'ADR :

- demander l'identité d'un pair UDP à Tailscale lui-même, par son `whois` local
  sur l'adresse du pair : l'identité reste celle de Tailscale, comme aujourd'hui ;
- un ticket court, signé par le salon et remis par la socket déjà authentifiée,
  que le worker vérifie à l'ouverture.

Il faut aussi y trancher le certificat, le port UDP ouvert sur le tailnet, et le
repli.

**3.1 Les manettes en datagrammes.** Le plus petit morceau, et celui que D9
désigne déjà comme provisoire. Datagrammes non fiables avec `outgoingMaxAge`
d'environ une image : une entrée trop vieille est jetée, pas renvoyée. Deux
pièges silencieux à tester explicitement : exiger `requireUnreliable`, sinon le
repli HTTP/2 rend tout fiable et on revient à TCP sans le savoir ; et vérifier
`maxDatagramSize` après l'établissement, parce qu'un datagramme trop grand
disparaît sans erreur. La WebSocket reste en repli.
*Fini quand* : `input_to_frame` et `switch-reaction` ne se dégradent pas en local,
et s'améliorent sur le profil « Hyde ».
*Précisé le 27 novembre 2026* : pour la Switch, le worker de la branche
`integration/switch1` ne rapporte plus `input_to_frame` mais
`pad_change_to_frame`, dans la ligne « salle externe ». Ce chiffre ne part que
d'un changement de manette. Dolphin garde `input_to_frame`, qui part de la
dernière trame reçue. Aucun des deux n'est un temps de réaction : la
réaction se mesure de l'appui à l'image changée, avec `switch-reaction` ou le
programme de test.

**3.2 L'image, une image par flux.** Des flux QUIC indépendants : la
retransmission d'une image ne retarde plus la suivante, l'ordre reste garanti à
l'intérieur d'une image, une image trop vieille s'abandonne en vol, et `sendOrder`
laisse une image récente doubler une vieille. Pas de datagrammes bruts pour
l'image : à 1 % de perte, plus d'un tiers des images clés seraient détruites.
*Cible* : le gel de plusieurs secondes disparaît sur le profil « Hyde ».

**3.3 Le son et le micro en datagrammes**, une fois en Opus : un morceau de 10 ms
tient dans un datagramme, et Opus dissimule ce qui manque.

## Piste parallèle : les gels de l'émulateur Switch

Indépendante des liaisons, et en attente de données plutôt que de code.

- Au prochain vrai gel, lire `avant.perf.data` : c'est la première fois que la
  cause elle-même sera enregistrée.
- Mesurer `backend_threading: On` en alternance (0.5). *Sans objet depuis le
  27 novembre 2026* : On et Auto donnent le même fil de rendu sur Vulkan, et
  Config.json n'était pas lu.
- Mesurer l'épinglage de cœurs (`cpuset`, éteint par défaut) de la même façon.

## Plus tard, et seulement sous condition

| Idée | Condition pour l'ouvrir |
|---|---|
| Couches temporelles : 30 images/s à qui décroche, depuis un seul encodage | Les phases 1 à 3 laissent un écart mesuré. Demande un encodage par libva direct, donc un quatrième module `unsafe` et une entrée d'ADR |
| Voie hybride : émission RTP et décodage WebCodecs depuis une transformation de réception WebRTC | La phase 3 déçoit sur la perte |
| `createEncodedSource` de Chrome | Il sort de son drapeau, et Firefox donne un signal |
| Gigue et qualité mesurées à la manière de Valve | Utile dès la phase 0 si l'écart d'arrivée ne suffit pas à distinguer le réseau de la source |

## Ordre, dépendances et taille

| Étape | Dépend de | Taille | Quand |
|---|---|---|---|
| 0.1 Salon et garde de version | rien | petite | hors partie |
| 0.2 Portée du déclencheur | rien | petite | hors partie |
| 0.3 Banc de liaison | rien | moyenne | hors partie |
| 0.4 Ligne de base | 0.3 | petite | hors partie |
| 0.5 Vérifications du 17 septembre | une partie Switch | petite | pendant une partie |
| 1.1 Plafond d'image | 0.4 | petite | banc |
| 1.2 File adaptative | 0.4 | moyenne | banc |
| 1.3 Débit cible | 0.4 | petite, puis ADR | banc |
| 1.4 Bascule automatique | 0.1 | petite | banc puis partie |
| 2.1 Son en Opus | 0.4 | moyenne, ADR D10 | banc |
| Défauts du micro | rien | moyenne | hors partie, avant tout commit du micro |
| 2.2 Micro en Opus | défauts du micro, 2.1 | moyenne | banc |
| 3.0 Identité sans proxy | rien | décision | ADR |
| 3.1 Manettes en datagrammes | 3.0 | moyenne | banc puis partie |
| 3.2 Image par flux | 3.1 | grande, ADR D9 | banc puis partie |
| 3.3 Son en datagrammes | 2.1, 3.1 | moyenne | banc |

Les tailles sont des ordres de grandeur, pas des durées : petite tient dans une
soirée, moyenne dans deux ou trois, grande demande de découper.

## Ce que ce plan ne promet pas

- Aucun gain n'est mesuré : chaque cible ci-dessus attend sa ligne de base et sa
  comparaison alternée.
- La phase 3 repose sur des propriétés de QUIC et des spécifications, pas sur une
  mesure sur cette machine.
- Le coût processeur d'Opus, dans les deux sens, n'est pas relevé.
- Tout ce qui touche au navigateur a été vérifié dans des données de compatibilité,
  pas sur la machine d'un joueur.
