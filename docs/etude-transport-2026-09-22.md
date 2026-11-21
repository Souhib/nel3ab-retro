# Transport temps réel : ce que font les outils de jeu en nuage, étude du 22 septembre 2026

Le 22 septembre au soir, trois joueurs sur Mario Power Tennis. Deux d'entre eux
n'ont **aucune** image jetée en vingt minutes. Le troisième, Hyde, en jette 433,
voit sa file se vider 433 fois, et son image se fige une fois pendant **8,9
secondes**. La machine, elle, ne bronche pas : Dolphin tient 57 % d'un cœur, le
GPU 4 à 7 %, et les trois pages annoncent 60 images par seconde.

Cette étude répond à la question posée ce soir-là : **comment font les autres, et
qu'est-ce qui vaut la peine d'être emprunté ?** Elle compare notre code à celui
des outils ouverts du même métier, et classe les emprunts par ce qu'ils coûtent
ici.

Elle ne traite pas de la diffusion façon Twitch, qui est un autre métier : un
émetteur, des millions de spectateurs passifs, deux à vingt secondes de latence,
des segments HTTP mis en cache par un réseau de distribution. Rien de tout cela
ne s'applique à quatre personnes qui jouent ensemble.

## Ce que notre chaîne fait aujourd'hui

Tout ce qui suit est lu dans le code, avec ses constantes, et mesuré en service
le 22 septembre.

### L'encodage

`core/crates/encoder/csrc/nel3ab_encode.c` ouvre un `h264_vaapi` avec :

| Réglage | Valeur | Conséquence |
|---|---|---|
| `rc_mode` | `CQP` | Qualité constante : **le débit suit la scène** |
| `qp` | 26 | |
| `max_b_frames` | 0 | Aucune image B, donc aucun retard de réordonnancement |
| `gop_size` | `fps * 10` | Une image clé **toutes les dix secondes**, plus celles demandées |
| `async_depth` | 1 | Une image en vol, pour la latence |

Deux flux sont encodés, jamais plus : le plein et le réduit, ce dernier à la
moitié de chaque dimension (`Encoder::half_size`). Mesuré ce soir : **12 Mbit/s**
en 1280x896, **3,1 Mbit/s** en 640x448.

### Le transport

`core/crates/transport/src/browser/` sert tout en **WebSocket sur TCP** :

- une file par spectateur de **deux images** (`OUTGOING_DEPTH = 2`), soit environ
  33 ms de marge à 60 images par seconde ;
- un fil d'écriture par spectateur, écriture **bloquante** avec un délai de 2 s
  (`WRITE_TIMEOUT`), tampon d'écriture plafonné à 4 Mio ;
- une image = huit octets d'horodatage de capture, puis les octets Annex-B tels
  que l'encodeur les a produits ;
- un signe de vie toutes les 500 ms (`KEEP_ALIVE`), spectateur oublié après 15 s ;
- le son sur sa propre socket, les manettes sur une troisième.

### Ce qui arrive quand un spectateur ne suit pas

C'est le cœur du sujet, et c'est écrit dans `stream.rs` :

1. sa file de deux images déborde ; l'image est **jetée pour lui seul**, les
   autres ne sont pas touchés ;
2. une image jetée casse la chaîne : tout ce qui suit référence ce qu'il n'a pas.
   Le worker cesse donc de lui envoyer quoi que ce soit (`resyncing`) et
   **demande aussitôt une image clé** ;
3. cette clé pèse cinq à six fois une image ordinaire (62 Kio contre 9), donc
   elle déborde de préférence la file d'un spectateur déjà lent, et le cycle
   recommence.

Le journal du worker du 22 septembre montre le cycle en clair : à 23:25:07,
« ce spectateur ne suit pas », 420 images manquées, en attente de clé ; dix
secondes plus tard, 179 de plus.

Deux bornes encadrent ce mécanisme, et elles ont chacune leur raison mesurée :

- **`KEY_FRAME_EVERY = 500 ms`** : une demande de clé n'est honorée que deux fois
  par seconde, parce qu'un seul client envoyant l'octet toutes les deux
  millisecondes a fait passer l'image moyenne de 40,3 à 56,3 Kio **pour tout le
  monde** ;
- **la page demande aussi au plus une clé par demi-seconde** (`video.ts`).

D'où un fait structurel : **une clé sert tout le monde, donc la réparation d'un
seul spectateur est payée par les autres.** C'est la conséquence directe du choix
« un encodage partagé » ; les outils de la famille Moonlight n'ont pas ce
problème parce qu'ils encodent par session.

### Côté page

`front/src/media/video.ts` tient une file d'affichage dont la profondeur suit la
gigue mesurée, plus une marge qui grandit quand l'image manque et se rend quand
tout va bien, le tout borné (`SLACK_CEILING`) parce qu'une mesure du 16 août a
montré qu'un tampon qui suit un lien trop étroit ajoute une seconde et demie de
retard sans rattraper une image. Le décodeur est refusé au-delà de dix images en
attente (`MAX_BACKLOG`).

C'est la moitié cliente de ce que font les autres, et elle est déjà là.

### Le son

PCM brut, 48 kHz, stéréo, seize bits : **1,5 Mbit/s par personne, quel que soit
le format vidéo choisi**. C'est la décision D10, qui écrivait elle-même sa
condition de réouverture : « quelqu'un jouant sur une liaison où 1,5 Mbit/s est
une part matérielle du disponible ». Ce soir, chez Hyde en format réduit, le son
représente **un tiers** de son trafic.

## Ce que la chaîne pèse vraiment, mesuré pendant la partie

Le worker journalise déjà la taille de chaque image et son débit. Relevé le
23 septembre à 00:04, pendant le jeu, et comparé au même instant à ce qui passe
sur le réseau :

| Grandeur | Valeur |
|---|---|
| Débit encodé (flux plein) | 3,3 Mbit/s à cet instant, **0,7 à 12 Mbit/s selon la scène** |
| Taille d'image, médiane | 6,4 Kio |
| Taille d'image, p95 | 26 Kio |
| Taille d'image, p99 | 33 Kio |
| Taille d'image, maximum | 39 Kio, et jusqu'à 60 Kio une minute plus tôt |
| Reçu par un spectateur en plein | 4,8 Mbit/s |
| Reçu par Hyde, en réduit | 2,0 Mbit/s |
| **Son, pour chacun** | **1,6 Mbit/s, toujours** |

Trois faits en sortent, et ce sont eux qui commandent les emprunts possibles.

**Le débit varie d'un facteur dix-sept.** C'est la signature de la qualité
constante : une scène calme coûte 0,7 Mbit/s, un échange chargé 12. Le pic arrive
précisément quand ça bouge, c'est-à-dire quand la liaison souffre déjà.

**Une image peut peser dix fois la médiane.** 6,4 Kio au milieu, 60 Kio au pire.
À 60 images par seconde, une image de 60 Kio est une pointe instantanée de
29 Mbit/s. La file d'un spectateur fait deux images : une seule pointe la remplit.

**Le son ne diminue jamais.** Chez Hyde en format réduit, il pèse 44 % de son
trafic. Réduire encore la vidéo sans toucher au son revient à pousser un plancher.

## Ce que l'encodeur de cette machine sait faire

Vérifié le 22 septembre avec `ffmpeg -h encoder=h264_vaapi` :

| Levier | Disponible | Remarque |
|---|---|---|
| `max_frame_size` | **oui** | Plafonne une image en octets : de quoi empêcher la clé géante |
| `rc_mode` CBR, VBR, QVBR, ICQ, AVBR | **oui** | Le débit cible existe, nous utilisons CQP |
| `idr_interval`, `b_depth`, `quality` | oui | |
| Rafraîchissement progressif (intra-refresh) | **non** | Absent de cet encodeur : l'idée tombe ici |
| Couches temporelles déclarées (SVC) | **non** | Non exposé par `h264_vaapi` |

Deux des idées empruntées aux autres meurent donc sur cette ligne, et c'est utile
de le savoir avant de les proposer.

## Ce que font Moonlight et Sunshine, sources en main

Lu le 22 septembre dans `moonlight-stream/moonlight-common-c` et
`LizardByte/Sunshine`, avec leurs constantes.

**Le découpage.** Une image devient N fragments de taille FIXE: 1392 octets de
charge utile par défaut, plus 16 d'en-tête RTP, soit 1408; 32 octets d'en-tête
applicatif devant chacun; le dernier fragment est complété par des zéros. La
taille est toujours un multiple de 16, parce que leur correction d'erreur
travaille par blocs de 16 octets. Un client distant en IPv4 descend même à 1024
octets utiles, par prudence sur le chemin.

**La correction d'erreur (FEC).** Reed-Solomon sur GF(256), **20 % de redondance
par défaut**, avec un plancher de deux fragments de parité, ce qui peut faire
monter le taux à 200 % sur une image minuscule. Au plus quatre blocs par image;
au-delà, la correction est purement désactivée pour cette image, avec un message
« image encodée anormalement grande ». Le client reconstruit dès qu'il a N
fragments quelconques.

**Le son.** Opus, 48 kHz, **96 kbit/s en stéréo**, mode faible latence, trames de
5 ms, en débit constant. Et **50 % de redondance**: quatre paquets de données,
deux de parité. Ce qui reste perdu est dissimulé par Opus lui-même. Total avec
redondance: environ 144 kbit/s, contre **1 500 chez nous**.

**Les entrées.** Même hôte ENet que le contrôle, mais 48 canaux logiques et une
fiabilité choisie PAR TYPE: souris, clavier et manettes en fiable, tactile et
capteurs en non fiable. Aucun blocage de tête de file entre périphériques. Les
mouvements sont accumulés et envoyés au plus toutes les millisecondes.

**Les images clés.** GOP infini: aucune image clé périodique, uniquement à la
demande. Quand c'est possible, ils évitent même l'IDR par une **invalidation de
références**: le client dit « ces images-là sont perdues », l'encodeur cesse de
s'y référer sans produire de clé. Seul NVENC l'implémente; le chemin FFmpeg, qui
est le nôtre, retombe sur une IDR. Le rafraîchissement progressif est câblé des
deux côtés mais **dormant**: son défaut est zéro et le client de référence ne le
demande jamais.

**Le rythme d'affichage.** Le client garde **une image d'avance** en régime
normal, trois s'il a récemment manqué, et jette les PLUS ANCIENNES au-delà. La
file de décodage fait quinze images; si elle déborde, elle est purgée entièrement
et une image clé est demandée.

**Et la surprise: aucun contrôle de congestion, des deux côtés.** Le débit est
figé au début de la session, à partir d'une valeur réglée par la personne, puis
plus jamais touché. Leur propre commentaire l'explique: l'adaptation dynamique
« rebondissait entre le minimum et le maximum sans jamais se stabiliser », donc
elle a été abandonnée au profit d'une valeur verrouillée. Ce qui reste est une
mise en forme du trafic à l'émission (environ 71 paquets par milliseconde) et un
simple avertissement à l'écran au-delà de 15 % d'images perdues sur trois
secondes.

Autrement dit: **la famille Moonlight ne résout pas le problème de Hyde par de
l'adaptation, mais par de la redondance et par un transport qui ne bloque pas.**

## Notre chaîne en face de la leur

| | nel3ab | Moonlight / Sunshine |
|---|---|---|
| Transport image | WebSocket sur **TCP** | RTP sur **UDP** |
| Perte d'un paquet | tout ce qui suit attend | reconstruit par FEC |
| Redondance vidéo | **aucune** | 20 % |
| Redondance audio | aucune | **50 %** |
| Son | PCM brut, **1,5 Mbit/s** | Opus, **96 kbit/s** |
| Débit | qualité constante, varie d'un facteur 17 | verrouillé au début de session |
| Contrôle de congestion | aucun | **aucun non plus** |
| Image clé | à la demande, ≤ 2/s, **partagée par tous** | à la demande, GOP infini, **par session** |
| Éviter l'IDR après une perte | non | invalidation de références (NVENC seul) |
| File côté serveur | 2 images par spectateur | pas de file serveur: on émet, le réseau trie |
| File côté client | profondeur suivant la gigue, bornée | 1 à 3 images, jette les plus anciennes |
| Entrées | WebSocket dédiée, TCP, fiable | ENet, 48 canaux, fiabilité par type |

Deux enseignements tombent de ce tableau, et ils sont contre-intuitifs.

**Le contrôle de congestion n'est pas ce qui nous sépare d'eux.** Ils n'en ont
pas non plus. Ce qui nous sépare est plus simple: un transport qui ne bloque pas,
et de la redondance.

**Notre file de deux images est un choix de transport fiable.** Eux n'ont pas de
file par spectateur du tout: ils émettent, et ce qui se perd est reconstruit ou
oublié. Notre file existe parce que TCP nous oblige à décider quoi faire quand
l'autre bout ne draine plus.

## Une contrainte qu'il faut poser avant de choisir

Les lignes d'arrivée du salon portent l'appareil de chacun depuis le 14 septembre.
Elles disent que **les joueurs de cette soirée sont tous sur Firefox 156 sous
Windows**, pas sur Chrome, et sur des machines confortables (16 à 32 cœurs,
1920x1080 ou 2560x1440).

Ce n'est pas un détail: la moitié des emprunts possibles passent par une API du
navigateur, et leur disponibilité n'est pas la même partout. Tout ce qui suit doit
donc être vérifié dans Firefox, sur la machine d'un joueur, avant d'être décidé.
La page utilise déjà WebCodecs pour l'image et cela fonctionne chez eux, ce qui
est un bon signe pour la famille d'API, mais pas une preuve pour chaque membre.

## De quoi on dispose pour mesurer un emprunt

Rien de ce qui suit n'aura besoin d'attendre qu'un joueur fragile revienne.

`spikes/m3-browser-drive/slowlink.mjs` ouvre une vraie page dans un Chrome sans
écran derrière un lien étranglé, et compte ce que la page a REÇU contre ce
qu'elle a peint, plus les famines. L'étranglement vient d'un proxy maison
(`throttle.mjs`) et non de l'outil de Chrome, qui ne touche pas les WebSockets.
Son en-tête dit lui-même ses deux limites: le débit d'un flux dépend de la
scène, donc le plafond doit être choisi sur ce que le worker journalise à cet
instant, et un Chrome sans écran qui peine tombe à 15 Hz, ce qui rend « peintes »
inutilisable ; la ligne « écran » est là pour s'en apercevoir.

Il faut y ajouter deux choses que ce pilote ne fait pas, et qui sont exactement
le cas de Hyde: **de la perte** et **de la gigue**, pas seulement un débit
plafonné. `tc netem` sur l'interface du conteneur de test suffit à les produire,
avec la même réserve qu'ailleurs: une mesure sur une machine qui dérive
s'alterne.

## Les emprunts qui ne demandent pas de changer de transport

Chacun est donné avec ce qu'il vise, son effet attendu sur les chiffres de ce
soir, son coût, et l'expérience qui le validerait. Aucun n'est mesuré à ce jour.

### 1. Plafonner la taille d'une image

`max_frame_size` existe dans notre encodeur. Aujourd'hui une image va de 6,4 Kio
(médiane) à 60 Kio (maximum), et la file d'un spectateur fait deux images: une
seule pointe la remplit.

**Effet attendu:** en plafonnant vers 20 Kio, l'encodeur étale le coût d'une
scène chargée sur plusieurs images au lieu d'une seule. Les pointes de 29 Mbit/s
instantanés disparaissent. C'est la version « locale » de ce que Sunshine obtient
en fragmentant en paquets de 1408 octets.

**Coût:** l'image d'une scène chargée devient un peu plus molle pendant une ou
deux images. Rien côté page, rien côté protocole.

**Expérience:** `slowlink.mjs` à 6 Mbit/s, dix minutes, en alternant plafond et
pas de plafond toutes les trois minutes. Ce qu'on regarde: les chaînes cassées
(`breaks`) et les images manquées (`starved`) du journal du worker, pas la
cadence, qui ne bougera pas.

### 2. Lisser le débit au lieu de fixer la qualité

Nous sommes en qualité constante: le débit varie d'un facteur dix-sept selon la
scène, et la pointe arrive exactement quand la liaison souffre. Les modes CBR,
VBR et QVBR sont disponibles dans le même encodeur.

**Effet attendu:** un plafond de débit rend le flux prévisible pour la liaison la
plus faible. Sunshine fait la même chose autrement: il verrouille un débit et
réserve 20 % pour sa redondance.

**Coût:** la qualité baisse dans les scènes chargées, **pour tout le monde**,
puisque le flux est partagé. C'est le vrai prix, et il se discute.

**Expérience:** même protocole, en comparant à qualité subjective égale, donc en
capturant des images des deux côtés, pas seulement des chiffres.

### 3. Une file par spectateur qui s'adapte, comme la page le fait déjà

Notre file de deux images est la même pour le joueur local à 0,4 ms d'aller-retour
et pour celui qui est à 9 ms avec de la perte. La page, elle, fait déjà
exactement ce qu'il faut: sa marge d'affichage grandit quand l'image manque et se
rend quand tout va bien, le tout borné.

**Effet attendu:** une file qui passe à six ou huit images pour un spectateur qui
vient de casser sa chaîne absorbe un hoquet de cent millisecondes au lieu de le
transformer en gel d'une seconde. En régime normal la file reste vide, donc la
latence ne bouge pas pour les autres.

**Coût:** jusqu'à cent millisecondes de retard supplémentaire **pour ce
spectateur-là seulement**, et uniquement pendant un hoquet.

**Expérience:** `slowlink.mjs` plus `tc netem` avec 1 % de perte et 20 ms de
gigue, en alternant profondeur 2 et profondeur 8.

### 4. Basculer tout seul vers le format réduit

Le mécanisme existe déjà à moitié: la page propose après deux mauvaises fenêtres,
et depuis le 17 septembre elle revient à la charge si la liaison s'effondre. Ce
soir, Hyde a basculé à la main quatre minutes après le premier symptôme, et il a
gagné d'un coup: files vides de 43 à 0-5 par fenêtre.

**Effet attendu:** supprimer ces quatre minutes.

**Coût:** une bascule non demandée. À encadrer: la première fois on propose,
et on ne bascule seul qu'en cas d'effondrement franc.

**Réserve mesurée ce soir:** aucune ligne « qualité » n'a été écrite, parce que
le salon en service date du 14 septembre et ignore cet événement. Avant de
mesurer quoi que ce soit sur ce point, il faut le redémarrer.

## Ce qu'un navigateur permet vraiment, vérifié le 22 septembre

Relevé dans les données de compatibilité de MDN et dans les spécifications
elles-mêmes.

| Capacité | Chrome | Firefox | Safari |
|---|---|---|---|
| WebTransport (QUIC) | 97 | **114** | 26.4 |
| Datagrammes non fiables | 97 | 114 | 26.4 |
| Échéance sortante (`outgoingMaxAge`) | oui | oui | oui |
| Décodage Opus (`AudioDecoder`) | 94 | **130** | 26 |

Vos joueurs sont en Firefox 156 : **ils ont les deux.**

**WebRTC en émission est fermé à notre architecture aujourd'hui, mais la porte
n'est pas murée : elle est en chantier.** La spécification des transformations de
trames encodées interdit à un script de créer une trame (« *A processor cannot
create frames, or move frames between streams* »), et le constructeur normatif
exige une trame existante en entrée. Notre H.264 déjà encodé ne peut donc pas
entrer dans une connexion WebRTC : il faudrait le réencoder DANS le navigateur,
ce qui détruirait exactement ce que D7 a gagné.

Chrome prototype cependant, derrière un drapeau expérimental, précisément l'API
qu'il faudrait : `createEncodedSource` rend un puits qui **accepte des trames
encodées** et renvoie en retour le débit alloué et les demandes d'image clé. Sa
propre fiche cite le cas d'usage : « *This custom encoder could be a WebCodecs
encoder, a WASM encoder or any other kind supplied by the application.* » C'est
littéralement « notre encodeur, leur contrôle de congestion ». Statut : proposé,
un seul moteur, aucun signal de Firefox ni de Safari, aucune spécification. Rien
de livrable, mais c'est la chose à surveiller.

Le seul levier d'affichage qu'offre WebRTC aujourd'hui, `jitterBufferTarget`, est
décrit par sa propre spécification comme une **cible** que l'agent peut ignorer,
plafonnée à 4 secondes, et qui s'aligne sur le plus grand des deux récepteurs
quand l'image et le son sont synchronisés. Notre file « une image par
rafraîchissement » n'y est pas reproductible.

**En revanche, la réception est une voie que je n'avais pas vue.** Dans le code de
libwebrtc, une transformation de réception s'exécute **avant** le tampon de gigue
du navigateur. Une page qui décoderait elle-même avec WebCodecs depuis cette
transformation court-circuiterait donc ce tampon **tout en gardant** NACK, les
retransmissions, la FEC, les retours de congestion et le contrôle de débit. Ce
serait exactement la propriété que D9 défend, sans renoncer à ce que WebRTC donne
gratuitement. Le prix d'entrée est lourd (un émetteur serveur qui parle RTP,
SRTP, DTLS et ICE, là où il suffit aujourd'hui d'une WebSocket), et le gain réel
n'est pas mesuré. À noter pour le jour où l'étape 4 ne suffira pas.

**La bibliothèque de Valve est hors jeu**, et pour une raison de plus que prévu :
non seulement aucun navigateur ne peut s'y connecter, mais sa version publique
n'a **ni contrôle de congestion** (le débit est verrouillé à 256 Kio/s par
défaut, minimum égal au maximum), **ni FEC**, **ni échéance par message** : le
bloc qui devrait jeter un message trop vieux est vide, avec un `FIXME`. Sa
documentation promet pourtant les trois. C'est exactement le genre de piège que
la règle 4 de ce dépôt vise.

## Les emprunts qui demandent un vrai changement

### 5. Compresser le son en Opus

C'est le gain le plus grand pour le moindre risque, et la condition de
réouverture écrite dans D10 est remplie.

**Effet attendu, chiffré :** 1,5 Mbit/s deviennent 96 kbit/s. Même en copiant la
redondance de Moonlight (50 %, quatre paquets de données pour deux de parité),
on reste à environ 144 kbit/s, soit **dix fois moins qu'aujourd'hui**. Chez Hyde
en format réduit, son trafic total passerait de 3,6 à environ 2,1 Mbit/s sans
toucher à l'image.

**Coût :** un encodeur Opus côté worker, et un `AudioDecoder` côté page. D10
refusait « une deuxième copie de la machinerie de surveillance d'un décodeur ».
L'argument s'est affaibli : c'est la même famille d'API que la vidéo, la page
l'utilise déjà, et Opus dissimule lui-même les trous, ce que notre PCM ne sait
pas faire.

**Expérience :** mesurer d'abord le coût processeur de l'encodage Opus sur la
machine, puis comparer les trous de son d'une page derrière `slowlink.mjs` avec
et sans compression.

### 6. Changer de transport pour WebTransport

C'est la suite naturelle de D9, qui nommait elle-même la condition : « si ceci
quitte un jour le tailnet, D9 est la première décision à rouvrir ».

**Ce que ça règle, précisément.** Sur TCP, une perte bloque **tout ce qui suit**,
y compris les images qui n'ont rien à voir avec le paquet perdu : c'est le gel de
neuf secondes de Hyde. QUIC transporte plusieurs flux **indépendants** sur une
seule connexion. Une image par flux donne trois propriétés que TCP ne peut pas
donner :

1. la retransmission de l'image N **ne retarde pas** l'image N+1 ;
2. l'ordre est garanti *à l'intérieur* d'une image, donc pas besoin d'écrire une
   FEC pour la vidéo ;
3. une image devenue trop vieille peut être **abandonnée en vol**, ce qui libère
   la liaison au lieu de la saturer.

À quoi s'ajoutent un contrôle de congestion hérité de QUIC, que ni nous ni
Moonlight n'avons, et `sendOrder`, qui laisse une image récente doubler une
vieille.

**Pour les manettes, les datagrammes avec `outgoingMaxAge`** font exactement ce
que D9 décrivait comme souhaitable : une entrée retransmise est déjà périmée,
donc elle doit être jetée plutôt que renvoyée.

**Ce qu'il ne faut PAS faire :** envoyer la vidéo en datagrammes bruts. Un
datagramme utile fait environ 1 100 octets, donc une image clé en demande une
cinquantaine, et sans FEC **un lien à 1 % de perte en détruirait plus d'un tiers**.
C'est le calcul qui justifie de garder des flux fiables pour l'image.

**Deux pièges silencieux, à connaître avant d'écrire une ligne.**

- **Le repli HTTP/2 supprime la non-fiabilité.** WebTransport sait retomber sur
  HTTP/2, et là « *does not support unreliable delivery, as HTTP/2 retransmits
  any lost data* » : les datagrammes redeviennent fiables et ordonnés, c'est-à-dire
  le transport qu'on cherchait justement à quitter, sans que rien ne le dise.
  Il faut donc exiger `requireUnreliable` et traiter le repli comme un échec.
- **Un datagramme trop grand disparaît sans bruit.** L'algorithme de la spec dit
  que si la taille dépasse `maxDatagramSize`, l'écriture rend simplement une
  promesse résolue. Pas d'exception, pas d'erreur. Il faut lire `maxDatagramSize`
  APRÈS l'établissement et vérifier soi-même avant d'écrire.

**Coût :** côté worker, un serveur QUIC (`quinn` et `web-transport-quinn` sont à
jour) et un certificat que Caddy sait déjà fournir. Côté page, la boucle de
lecture change de forme mais **le reste ne bouge pas** : on continue de recevoir
des unités d'accès entières et de décider nous-mêmes quand les soumettre au
décodeur, ce qui est la propriété que D9 protégeait.

**Expérience :** le pilote `limited-link-test.mjs` existe déjà pour prouver qu'une
socket s'est vraiment fermée ; il faudra son équivalent pour prouver qu'un flux
abandonné libère bien la liaison. Puis `slowlink.mjs` plus `tc netem` à 1 % de
perte, en alternant les deux transports.

### 7. Les couches temporelles, et pourquoi elles coûtent plus cher qu'elles n'en ont l'air

L'idée : encoder à 60 images par seconde en marquant une image sur deux comme
non-référence, puis n'envoyer que les images de référence à qui décroche. Un seul
encodage, deux cadences.

C'est faisable en H.264 pur, sans SVC, et Chromium le fait sur VA-API avec trois
mécanismes seulement : `nal_ref_idc = 0` sur les images jetables, un `frame_num`
qui n'avance pas sur celles-ci, et une modification de liste de référence. Nos
propres écritures de SPS sont déjà compatibles (`pic_order_cnt_type = 0`, aucun
trou de `frame_num` autorisé et aucun produit).

**Mais aucune couche FFmpeg ne l'expose** : ni `h264_vaapi`, ni `nvenc`, ni
`libx264`. Il faudrait encoder par libva directement, donc **un quatrième module
`unsafe` dans `encoder`**, ce que la règle 2 de ce dépôt interdit sans une entrée
d'ADR qui pèse la décision.

**L'alternative honnête** est celle que vous avez déjà employée pour la
résolution : un deuxième encodage. Le GPU est à 4-7 %, il y a la place.

### 8. Ce qu'on emprunte pour MESURER, et qui ne coûte presque rien

La bibliothèque de Valve ne nous servira pas de transport, mais sa façon de
mesurer est directement transposable à la boîte noire :

- **la gigue** ne se mesure que sur deux paquets arrivés dans l'ordre, comme la
  différence entre l'écart d'arrivée et l'écart d'émission, ce qui demande que
  l'émetteur écrive sur le fil le temps écoulé depuis son paquet précédent ;
- **la qualité** se calcule par intervalles d'au moins 4,5 secondes, et **100 est
  réservé au parfait** : « on n'arrondit pas 99,7 % à 100 ».

Nos pages mesurent déjà l'écart d'arrivée depuis le 14 septembre ; il leur manque
la référence d'émission pour distinguer « le réseau est irrégulier » de « la
source a produit irrégulièrement ».

## Ce que cette étude écarte, et pourquoi

| Idée | Écartée parce que |
|---|---|
| WebRTC pour porter notre flux **en émission** | La spec interdit à un script de créer une trame encodée. Chrome prototype `createEncodedSource` derrière un drapeau ; à surveiller, pas à utiliser |
| Rafraîchissement progressif | Absent de `h264_vaapi` ; chez Sunshine il n'existe que pour NVENC et reste dormant |
| Invalidation de références au lieu d'une IDR | Seul NVENC l'implémente ; le chemin FFmpeg, qui est le nôtre, retombe sur une image clé |
| FEC sur notre transport actuel | Inutile sur TCP, qui retransmet déjà. La FEC ne paie qu'avec un transport qui perd |
| GameNetworkingSockets | Injoignable depuis un navigateur, et sans contrôle de congestion, ni FEC, ni échéance dans sa version publique |
| Échelle de qualités et segments façon Twitch | Autre métier : des secondes de latence, et une adaptation faite par le lecteur |
| Vidéo en datagrammes bruts | À 1 % de perte, plus d'un tiers des images clés détruites |

## Ordre proposé

Rien de tout ceci n'est mesuré. L'ordre suit le rapport entre ce qu'on apprend et
ce qu'on risque.

1. **Redémarrer le salon.** Sans ça, aucune proposition de format réduit n'est
   enregistrée et on mesure à l'aveugle. Coût : une coupure de quelques secondes,
   hors partie.
2. **Plafonner la taille d'une image** et **adapter la file par spectateur**.
   Deux réglages, aucun changement de protocole, mesurables en une soirée avec
   `slowlink.mjs` et `tc netem`.
3. **Opus.** Le plus grand gain pour les liaisons faibles, et le seul qui abaisse
   le plancher. Vérifié disponible chez vos joueurs.
4. **WebTransport**, d'abord pour les manettes (c'est le bout le plus petit et
   D9 le désigne déjà comme provisoire), puis pour l'image si la mesure de
   l'étape 2 montre que les réglages ne suffisent pas. En exigeant
   `requireUnreliable`, sans quoi on retombe sur TCP en silence.
5. **Si même cela ne suffit pas**, la voie hybride : émission RTP côté worker et
   décodage WebCodecs depuis une transformation de réception, qui garde le
   contrôle de l'affichage tout en héritant de la reprise sur perte de WebRTC.
   Gros chantier, gain non mesuré.
6. **Couches temporelles** en dernier, et seulement derrière une entrée d'ADR.

## Ce qui n'est pas prouvé

- Aucun des sept emprunts n'a été mesuré ici : cette étude lit du code et pose
  des expériences, elle ne conclut pas à leur place.
- Le gain de WebTransport est déduit des propriétés de QUIC, pas mesuré sur cette
  machine. Il faudra le montrer avec la même méthode alternée qu'ailleurs.
- La FEC vidéo de Chrome est offerte (`red` et `ulpfec` toujours proposés,
  `flexfec-03` reçu mais annoncé en émission seulement derrière un essai de
  terrain), mais le code prouve l'OFFRE, pas l'activation réelle, qui dépend de la
  perte estimée. Non établi sur un SDP réel.
- Du côté navigateur, trois points restent à vérifier avant d'en dépendre : la
  taille de datagramme réellement annoncée après connexion, le sort de
  `serverCertificateHashes` dans Firefox (le bug est rouvert), et l'effet de
  laisser vide le puits d'une transformation de réception.
- Le coût processeur d'un encodage Opus sur cette machine n'est pas mesuré.
- Les sources lues sont celles de septembre 2026 ; Moonlight, Sunshine et les
  navigateurs bougent.
