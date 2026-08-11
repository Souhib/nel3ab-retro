# Carnet de bord — le projet expliqué

Ce document s'adresse à un humain, pas à un agent. Il raconte **ce qu'on
construit, pourquoi, ce qui a résisté, et ce qu'on a choisi** — en expliquant les
termes au passage. Les autres documents sont des documents de travail :

| Document | Pour quoi |
|---|---|
| `adr/0001-architecture.md` | les décisions, en une ligne chacune, avec leur raison |
| `m1-working-plan.md`, `m2-working-plan.md` | l'état d'avancement, les mesures brutes |
| **ce document** | l'histoire, le raisonnement, le vocabulaire |

---

## 1. Ce qu'on construit

Des **salles de jeu rétro auto-hébergées**. Une personne ouvre un navigateur,
rejoint une salle, et joue à un jeu GameCube avec jusqu'à trois amis. Tout tourne
sur **notre** serveur : l'émulation, le rendu 3D, l'encodage vidéo. Le navigateur
ne fait que recevoir une vidéo et renvoyer les touches.

C'est du **cloud gaming**, mais chez soi. Le serveur s'appelle `lgf` et porte une
carte graphique AMD Radeon RX 6650 XT.

```
   Navigateur                      Serveur (lgf)
   ┌──────────┐                    ┌───────────────────────────────┐
   │ manette  │ ──── touches ────► │  Dolphin (émulateur GameCube) │
   │          │                    │            ↓ image            │
   │  vidéo   │ ◄─── H.264 ─────── │  GPU : conversion + encodage  │
   └──────────┘                    └───────────────────────────────┘
```

La difficulté n'est pas de faire marcher ça. C'est de le faire marcher **vite**.
Chaque milliseconde entre l'appui sur un bouton et le pixel affiché se sent
manette en main.

---

## 2. Le vocabulaire, avant de commencer

Les termes reviennent partout. Un glossaire complet est à la fin ; voici les
douze indispensables.

**GPU** — la carte graphique. Elle a sa propre mémoire (VRAM), séparée de la
mémoire du processeur (RAM).

**CPU** — le processeur central. Faire voyager une image du GPU vers le CPU et
retour est l'opération la plus chère du projet ; toute l'architecture existe pour
l'éviter.

**Émulateur** — un programme qui fait semblant d'être une console. Dolphin
imite une GameCube : il lit le jeu original et exécute son code.

**Headless** — « sans tête », c'est-à-dire sans fenêtre à l'écran. Dolphin tourne
en headless sur le serveur : il calcule les images mais n'affiche rien. Cela crée
un problème inattendu, détaillé plus bas.

**Codec / H.264** — un format de compression vidéo. Une image brute en 1080p pèse
~3 Mo ; compressée en H.264, quelques dizaines de kilo-octets. Impossible de
diffuser sans.

**Encodeur matériel** — une puce **dédiée** à la compression vidéo, à côté du
GPU. Elle fait le travail sans consommer ni CPU ni puissance de rendu. C'est
elle qu'on veut utiliser.

**VAAPI** (*Video Acceleration API*) — l'interface Linux pour parler à cette puce.
`libva` en est la bibliothèque.

**Vulkan** — l'interface moderne pour parler au GPU (rendu 3D et calcul). Dolphin
rend ses images avec.

**dma-buf** — un mécanisme du noyau Linux pour **partager un bloc de mémoire GPU
entre deux programmes sans le copier**. C'est la pièce centrale : Dolphin alloue
une image, en passe le « ticket » (un descripteur de fichier) à notre worker, et
les deux regardent la même mémoire.

**Zero-copy** — « sans copie ». L'objectif : l'image ne bouge jamais. Elle est
écrite une fois en VRAM et lue sur place par l'encodeur.

**NV12** — un format d'image. Au lieu de stocker rouge/vert/bleu par pixel
(RGBA), on stocke la **luminance** en pleine résolution et la **couleur** en
quart de résolution — l'œil humain voit mal les détails de couleur. Les encodeurs
vidéo ne mangent que ça.

**Shader** — un petit programme qui s'exécute sur le GPU, en parallèle sur des
milliers de pixels à la fois. On en utilise un pour convertir RGBA → NV12.

---

## 3. Le problème central : la copie

L'approche naïve, qu'on trouve dans tous les tutoriels :

1. Dolphin rend l'image en VRAM
2. on la **recopie** vers la RAM du CPU
3. on la convertit en NV12 sur le CPU
4. on la **recopie** vers la VRAM pour l'encodeur

Deux allers-retours à travers le bus PCIe, plus une conversion CPU, **soixante
fois par seconde**. C'est mesuré dans ce projet : le seul fait de faire sortir les
images vers le CPU coûtait **0,57 cœur de processeur** en continu, et ajoutait de
la latence.

L'architecture de ce projet supprime ces quatre étapes. L'image reste en VRAM du
début à la fin.

---

## 4. Milestone 1 — faire entrer les touches

**Objectif** : qu'un appui sur un bouton dans le navigateur fasse réagir le jeu.

### Comment on parle à Dolphin

Dolphin sait lire les manettes depuis un **pipe nommé** (*named pipe*) : un
fichier spécial dans lequel on écrit du texte, et que Dolphin lit comme s'il
s'agissait d'une manette. Le protocole est du texte ASCII :

```
PRESS A            ← bouton A enfoncé
RELEASE A          ← bouton A relâché
SET MAIN 0.5 0.5   ← joystick au centre
SET L 0.8          ← gâchette gauche à 80 %
```

C'est simple et ça se teste sans GPU, ce qui est précieux.

### Le piège des gâchettes

`SET MAIN x y` prend les valeurs **brutes**. `SET L v` non : Dolphin applique
lui-même `(v/2)+0.5` derrière. Deux commandes de la même famille, deux
conventions. Trouvé en lisant le code source de Dolphin, pas la documentation.

### Comment on l'a rendu sûr

Le crate Rust `emulator` sépare trois choses :

- **`wire.rs`** — la grammaire ASCII, pure, sans aucune entrée/sortie. Testable
  intégralement sans processus ni GPU.
- **`pipe.rs`** — l'écriture dans les pipes, non bloquante.
- **`process.rs`** — le lancement et l'arrêt de Dolphin.

Cette séparation est une règle du projet (« l'orchestration seulement dans le
binaire ») : tout comportement vit dans une bibliothèque testable, jamais dans le
programme principal.

Un détail typé plutôt que vérifié : **`PlayerSlot` ne peut pas contenir `0`**. Le
type lui-même l'interdit, donc aucun appelant ne peut passer un mauvais numéro de
joueur et aucun test n'a besoin de le prouver. C'est la forme la plus forte de
« la règle vit dans la machine ».

**Résultat** : 47 tests, et un test d'intégration qui lance un vrai Dolphin,
envoie des touches, et vérifie que le jeu réagit.

---

## 5. Milestone 2 — faire sortir les images

C'est le gros morceau, et celui qui a produit toutes les surprises.

### 5.1 Trois options, et pourquoi deux sont mortes

**Option A — la capture d'écran classique.** Dolphin affiche dans une fenêtre, on
capture la fenêtre. Refusée : cela impose un serveur graphique et une copie.

**Option B — Dolphin rend vers une surface Wayland qu'on intercepte.** Tuée en
deux minutes par l'expérience : la version headless de Dolphin (`nogui`) n'a
**aucun** support de plateforme Wayland. L'option ne pouvait pas exister. Deux
minutes de test ont économisé des jours de conception.

**Option C — patcher Dolphin pour qu'il exporte l'image en dma-buf.** Retenue.
C'est plus de travail, mais c'est la seule qui atteint le zero-copy.

> **Leçon générale, appliquée plusieurs fois depuis** : quand une option peut être
> tuée par une expérience courte, faire l'expérience avant de concevoir.

### 5.2 Le patch Dolphin

~640 lignes ajoutées à Dolphin, figées sur un commit précis
(`216ffb45`) pour que le build soit reproductible. Le patch fait trois choses :

1. alloue **trois images** exportables (un *anneau*, voir plus bas),
2. les exporte en dma-buf et envoie les descripteurs à notre worker via une socket,
3. prévient le worker quand une image est prête.

Trois choses ne se lisaient pas dans le code source et ont dû être découvertes :

- **Dolphin n'active presque aucune extension Vulkan.** Il fallait en ajouter
  cinq. Elles sont déclarées **optionnelles** : si le pilote ne les a pas,
  l'export se désactive au lieu d'empêcher Dolphin de démarrer.
- **Dolphin charge ses propres pointeurs de fonctions Vulkan**, et sa table ne
  contient pas celle dont on avait besoin. Récupérée à la main dans le nouveau
  fichier, pour ne toucher qu'un fichier au lieu de deux.
- **Docker donne 64 Mo de `/dev/shm` par défaut.** Dolphin en veut plus, et
  meurt d'un `SIGBUS` — sans écrire une seule ligne de log. Un plantage
  totalement muet, résolu par `--shm-size=2g`.

### 5.3 Le piège le plus instructif du projet

Le premier test de bout en bout est passé. Image capturée, convertie en PNG,
**regardée** : on y voyait la boîte de dialogue de Melee. Prouvé.

Sauf que ce test tournait avec le **dumper d'images de Dolphin activé** — la
fonction de debug qui recopie chaque frame vers le CPU. Relancé sans, le
consommateur lisait une image **entièrement noire**, à chaque fois.

L'export dépendait de cette recopie pour faire *avancer* le GPU. En Vulkan,
**enregistrer** une commande ne l'**exécute** pas ; il faut soumettre le tampon de
commandes. En mode fenêtré, l'affichage de l'image le déclenche. En headless, il
n'y a pas d'affichage — donc rien ne le déclenchait, sauf la recopie CPU qu'on
cherchait justement à supprimer.

Ça marchait, et uniquement tant que c'était inutile.

Ce qui rend le cas marquant : **tout avait l'air correct**. Chaque appel Vulkan
renvoyait succès, l'image était créée, la mémoire exportée, le descripteur livré,
600 frames annoncées, aucune erreur nulle part — et aucun pixel n'avait bougé.

> « Ça compile » et « ça livre » ne sont pas des affirmations liées. Et « c'est
> passé une fois » non plus.

### 5.4 Les deux courses (*race conditions*)

Une **race condition** est un bug où deux acteurs se marchent dessus parce que
rien ne garantit l'ordre entre eux. Il y en avait deux :

**Course n°1 — Dolphin réécrit une image que le worker est en train de lire.**
Réglée par un **anneau de trois images** (*ring buffer*) avec **libération
explicite** : une case n'est réutilisée que quand le worker l'a rendue. Si aucune
case n'est libre, la frame est *abandonnée* — un choix assumé : mieux vaut sauter
une image que d'en afficher une déchirée.

**Course n°2 — le worker lit avant que le GPU ait fini d'écrire.** Réglée en
demandant explicitement à Dolphin d'attendre la fin du travail GPU avant de
prévenir le worker.

**Ce que l'attente coûte, mesuré** : à la vitesse cible, **rien** — 59,91 images
par seconde contre les 59,94 de la norme NTSC, pas une frame perdue. Sans
limite de vitesse, on passe de 2665 à 2130 images/s, soit ~20 % de marge
consommée, ce qui laisse encore ×35 le temps réel.

### 5.5 Un test qui passe avec le bug remis : deux fois

Le test de l'anneau comparait les **pixels** de l'image tenue. Il passait même en
retirant la protection — parce que Melee affichait un écran statique et que
Dolphin réécrivait la case avec une image identique.

Réécrit pour affirmer **l'invariant du protocole** au lieu des pixels : « une case
prêtée n'est jamais réannoncée ». Avec le bug : 0 frame sur les autres cases, 25
sur celle qui était tenue. Sans : 25 et 0.

C'était la **deuxième** fois dans ce projet qu'un test se lisait correctement et
ne prouvait rien. Les deux ont été attrapés uniquement en **remettant le bug**.

D'où une règle devenue centrale : **un test doit pouvoir échouer pour la bonne
raison**, et on le vérifie en réintroduisant le bug, pas en réfléchissant.

### 5.6 L'ordre d'allocation : la décision D5

Voici le point le plus subtil de l'architecture, et il tient à une particularité
du matériel AMD.

**DCC** (*Delta Colour Compression*) est une compression que le GPU applique aux
images pour économiser de la bande passante. Elle est transparente pour le rendu
3D… mais **l'encodeur vidéo ne sait pas la lire** sur les cartes antérieures à
RDNA4. Notre RX 6650 XT est du RDNA2.

Or l'ordre d'allocation détermine qui choisit le format :

- **Si Vulkan alloue en premier**, il peut choisir un format avec DCC activé — et
  VAAPI refusera l'image. Impasse.
- **Si VAAPI alloue en premier**, il choisit forcément un format que l'encodeur
  sait lire (donc sans DCC), et Vulkan sait s'y adapter.

D'où **D5** : on alloue la surface **côté encodeur d'abord**, on l'exporte, et on
laisse un shader écrire du NV12 directement dedans. L'image est légale pour
l'encodeur **par construction**. C'est la topologie qu'utilise Sunshine, un
projet de cloud gaming existant — d'où son surnom interne.

Le format est identifié par un **modifier**, un nombre de 64 bits qui décrit
l'agencement mémoire. Le nôtre est `0x0200000018601b03`, et son **bit 13 vaut 0**
— c'est le bit DCC. Ce nombre est vérifié par un test.

### 5.7 Ne jamais demander à `vaDeriveImage`

Piège coûteux. Pour vérifier le contenu d'une surface, `libva` offre deux
chemins. `vaDeriveImage` réussit et décrit un agencement **linéaire** pour une
surface qui est en réalité **tuilée** (rangée en blocs, pas en lignes). Le premier
essai de vérification a donc annoncé **99,6 % de l'image fausse** — alors que
l'image était juste.

`vaCreateImage` + `vaGetImage` demandent au pilote de « dé-tuiler » lui-même,
c'est-à-dire de donner sa vue autoritaire.

> **Leçon** : quand le pilote est l'autorité, demander au pilote. Ne pas déduire.

### 5.8 La conversion couleur

Un shader de calcul écrit du NV12 **sur place** dans la surface exportée. Résultat
mesuré : **0 échantillon en dehors de ±1** par rapport à une référence calculée à
part, en double précision, écrite indépendamment.

Écrire la référence séparément est délibéré : une référence qui partagerait le
code du shader ne prouverait rien d'autre que « le code est égal à lui-même ».

Deux erreurs classiques sont attrapées par ce test : utiliser les coefficients
**BT.601** (norme de la vidéo standard) au lieu de **BT.709** (norme HD), et
confondre plage **complète** (0–255) et plage **limitée** (16–235, l'héritage de
la télévision analogique).

Détail non négociable, mesuré : sur ce matériel, une image NV12 **combinée** n'est
pas inscriptible par un shader. Il faut l'exporter en **deux plans séparés**
(luminance, puis couleur). Ce n'est pas un choix de style.

### 5.9 L'encodeur qu'on a écrit, puis jeté

Étape suivante : encoder. Premier réflexe — écrire l'encodeur H.264 nous-mêmes
contre `libva`, pour contrôler exactement le moment où chaque image est soumise
au matériel.

**FFI** (*Foreign Function Interface*) désigne l'appel de code C depuis Rust.
C'est le seul endroit du projet où `unsafe` est autorisé, et il l'est sous
conditions : chaque bloc porte un commentaire `// SAFETY:` justifiant pourquoi
l'appel est correct.

Pour les structures C qu'il faut redéclarer côté Rust, la technique employée est
la **mesure** : un petit programme C affiche la taille et la position réelle de
chaque champ, et Rust les affirme **à la compilation**. Une structure mal
déclarée fait donc **échouer le build** au lieu de renvoyer des données
plausibles mais fausses.

Ça a payé immédiatement : `VACodedBufferSegment` avait été déclarée à 32 octets au
lieu de 48 (un champ de remplissage oublié). **Attrapée par l'assertion de
compilation**, jamais à l'exécution.

Ça a aussi débusqué un champ de bits `reference_pic_flag` large de **2 bits, pas
1** — invisible autrement que par un programme de sondage qui met chaque champ à
1 et affiche le mot entier.

L'encodeur a atteint : configuration, contexte, les trois tampons de paramètres,
et des en-têtes SPS/PPS/slice **identiques octet pour octet** à ceux de ffmpeg.
Puis le pilote AMD plante (`segfault`) dans `vaEndPicture`. Quatre différences
avec la séquence d'appels de ffmpeg ont été trouvées et corrigées ; aucune n'était
la cause.

**Mais le plantage n'est pas la vraie raison de l'abandon.** La vraie raison est
ce qui manquait encore même en supposant le plantage résolu : notre encodeur était
**tout-intra** (chaque image compressée seule, sans référence aux précédentes) et
**sans contrôle de débit**. Inutilisable pour un flux de jeu. Le finir demandait
la gestion des références, un **DPB** (le tampon d'images de référence) et un
contrôleur de débit — des centaines de lignes au même profil de risque que celles
déjà écrites, où une erreur *a l'air* juste et renvoie succès.

C'est **D1 qui revient** : « on n'écrit pas d'émulateur ». Un encodeur H.264
conforme est un objet du même genre.

### 5.10 Ce qu'on a gardé de ce travail

Le module `encoder::h264` — l'écrivain de flux binaire — **reste**. Il est épinglé
contre les octets réels de ffmpeg et il a un usage concret devant lui : ffmpeg
déclare dans son en-tête `max_num_reorder_frames=1`, là où un flux à faible
latence veut zéro. Réécrire cet en-tête à la volée est exactement ce à quoi ce
module sert.

### 5.11 libavcodec, et pourquoi un shim C

**Décision D7** : libavcodec (la bibliothèque de ffmpeg) fait l'encodage.

Avant de l'écrire, une question pouvait tout annuler : **la surface allouée par
libavcodec est-elle encore la nôtre à écrire ?** Si non, D5 s'effondre. Vérifié
par expérience :

```
surface du pool de libavcodec : 0x00000004
exportée : modifier 0x0200000018601b03, 2 plans, DCC=0
```

Identique à ce qu'on obtenait en allouant nous-mêmes. D5 est intact.

Restait à appeler libavcodec depuis Rust. Ici, la technique de mesure des offsets
**ne convient pas** : `AVCodecContext` a des centaines de champs dont la
disposition change entre versions majeures de ffmpeg, et une mise à jour système
suffirait à rendre nos offsets faux — silencieusement.

D'où le choix d'un **shim** : une petite couche C, à nous, qui expose une API
réduite et stable. La question d'ABI est ainsi résolue **en C, par le
compilateur, contre les vrais en-têtes**. Rust ne parle qu'à un fichier qu'on
possède.

> **ABI** (*Application Binary Interface*) : la disposition exacte des données en
> mémoire. Deux programmes qui n'en ont pas la même idée s'échangent des octets
> qui n'ont pas le même sens — sans erreur, juste des valeurs absurdes.

Il restait une chose à pouvoir se tromper : est-ce que Rust a disposé nos deux
structures **exactement** comme le compilateur C ? Le shim expose donc une
fonction qui rapporte ses propres tailles et positions, et un test compare
**chaque champ** — pas seulement la taille, car deux erreurs qui se compensent
laisseraient la taille juste et toutes les valeurs fausses. Ce test **ne demande
pas de GPU** : une divergence est un défaut du code, pas de la machine.

### 5.12 Ce que la file d'attente de libavcodec coûte

C'est la seule chose que D7 concédait : on ne contrôle plus le moment exact de
soumission. La décision disait explicitement de le **mesurer** plutôt que de lui
faire confiance. Mesuré le 2026-08-11, 240 images après 60 de chauffe :

| Résolution | p50 | p95 | p99 | images retenues |
|---|---|---|---|---|
| 640×480 | 1,00 ms | 1,13 ms | 1,45 ms | **0** |
| 1920×1088 | 2,65 ms | 3,05 ms | 4,98 ms | **0** |

*(p50 = la moitié des images sont plus rapides ; p99 = 99 % le sont.)*

**Zéro image retenue** est le chiffre qui tranche : la file n'ajoute aucune image
de latence, seulement son temps d'encodage — 2,65 ms sur un budget de 16,7 ms par
image à 60 Hz. La concession est payée.

Nuance honnête, écrite à côté du tableau : ces surfaces n'ont rien écrit dedans,
donc elles se compressent à rien. C'est un **plancher**, pas le régime réel. À
re-mesurer quand le shader écrira de vraies images.

---

## 6. Les pièges qui ont coûté du temps, et ce qu'ils ont appris

| Le piège | Ce qui s'est passé | La leçon |
|---|---|---|
| `/dev/shm` à 64 Mo | Dolphin meurt en `SIGBUS`, **aucun log** | Un plantage muet dans Docker : regarder les limites du conteneur avant le code |
| Le dumper d'images | Le test passait grâce à la chose qu'on supprimait | Rejouer un test en enlevant tout ce qui n'est pas censé compter |
| `vaDeriveImage` | 99,6 % de l'image annoncée fausse, à tort | Quand le pilote est l'autorité, demander au pilote |
| `docker exec` sans `-i` | Le script reçoit EOF, ne fait rien, **et rapporte un succès** | Vérifier l'effet, pas le code de retour |
| Deux tests verts avec le bug remis | Ils lisaient la bonne chose au mauvais endroit | Vérifier en réintroduisant le bug, jamais en raisonnant |
| Poussé avec `just check` rouge | Vu l'échec, poussé quand même | Corrigé dans un commit dont le message le dit |
| Divergence local / CI | La CI ajoutait `-D warnings`, pas le `justfile` | `just check` doit être *exactement* ce que la CI fait |
| Binaires compilés commités | Des exécutables dans le dépôt | Supprimés et ignorés |
| `pkill -f <motif>` | Le motif correspondait à sa propre ligne de commande, tuant le shell | — |
| Symboles de debug | Le dépôt propose Mesa 24.0.5, la machine a la 25.2.8 | Abandonné plutôt que d'insister ; source apt retirée après |

---

## 7. Les décisions, en résumé

| | Décision | En clair |
|---|---|---|
| **D1** | On n'écrit pas d'émulateur | On intègre Dolphin. La règle générale : ne pas réécrire un objet de cette taille |
| **D2** | Rust pour le worker | Pas de plantage possible dans une partie en cours ; la couche au-dessus reste en Python/TypeScript |
| **D3** | Les manettes sont normalisées **dans le navigateur** | Le serveur reçoit une forme unique quel que soit le matériel du joueur |
| **D4** | L'attribution des places est un état serveur | Deux joueurs ne peuvent pas revendiquer la même place |
| **D5** | Topologie « Sunshine » : allouer côté encodeur **d'abord** | Évite le refus DCC et supprime une passe de conversion |
| **D6** | Client TypeScript généré | Pas de types recopiés à la main entre serveur et navigateur |
| **D7** | libavcodec encode | Application de D1 : un encodeur H.264 conforme n'est pas à écrire |

---

## 8. Où on en est

**Fait et prouvé sur la machine :**

- l'entrée : les touches arrivent dans un Dolphin headless, le jeu réagit
- la sortie : l'image sort de Dolphin **sans aucune copie CPU**, et a été regardée
- les deux courses sont fermées, et le coût de l'attente est mesuré
- D5 vérifié octet par octet : Vulkan écrit, l'encodeur relit **0 octet faux**
- le shader RGBA→NV12 : **0 échantillon hors de ±1**
- l'encodeur libavcodec est piloté depuis Rust, et sa latence est mesurée

**Ce qui reste dans M2 :** câbler la chaîne complète — image Dolphin → import
Vulkan → shader → encodeur → H.264 — et **regarder le résultat décodé**. Chaque
morceau est prouvé séparément ; c'est la première fois qu'ils tourneraient
ensemble.

Puis mesurer la chaîne réelle contre le **0,57 cœur** que coûtait l'ancienne
recopie. C'est le chiffre que M2 existe pour battre.

**Après M2** : M3, le réseau (faire arriver le flux dans le navigateur), puis M4,
l'interface.

---

## 9. Glossaire complet

**ABI** — *Application Binary Interface*. La disposition exacte des données en
mémoire. Un désaccord d'ABI ne produit pas d'erreur, seulement des valeurs
absurdes.

**ADR** — *Architecture Decision Record*. Un document qui fige une décision **et
sa raison**, pour qu'on ne la re-débatte pas six mois plus tard.

**Anneau / ring buffer** — un petit ensemble de cases réutilisées en boucle. Ici,
trois images : pendant que le worker en lit une, Dolphin écrit dans une autre.

**BT.601 / BT.709** — deux normes de conversion couleur. BT.601 pour la vidéo
standard, BT.709 pour la HD. Les confondre donne une image aux teintes décalées.

**Bitstream** — le flux d'octets qui constitue la vidéo compressée. Ses champs ne
sont pas alignés sur les octets, d'où un « écrivain de bits » dédié.

**CI** — *Continuous Integration*. Le service qui recompile et reteste
automatiquement à chaque envoi de code. Une tâche n'est pas finie tant qu'elle
n'est pas verte.

**Clippy** — l'analyseur de code de Rust. Configuré ici en mode strict : tout
avertissement est une erreur.

**DCC** — *Delta Colour Compression*. Compression interne AMD, invisible pour le
rendu 3D, **illisible par l'encodeur vidéo** avant RDNA4. Toute la décision D5
existe à cause d'elle.

**dma-buf** — mécanisme du noyau Linux pour partager de la mémoire GPU entre
processus sans copie.

**DPB** — *Decoded Picture Buffer*. Le tampon où un codec garde les images de
référence servant à compresser les suivantes.

**Exp-Golomb** — un codage de nombres à longueur variable utilisé par H.264 : les
petites valeurs prennent peu de bits.

**FFI** — *Foreign Function Interface*. Appeler du C depuis Rust. Seul endroit où
`unsafe` est toléré dans ce projet, et sous justification écrite.

**H.264** — le format de compression vidéo utilisé. Universellement décodé par les
navigateurs, et accéléré par le matériel.

**Headless** — sans fenêtre. Utile sur un serveur, mais supprime des événements
(comme l'affichage) sur lesquels du code pouvait compter sans le dire.

**IDR** — *Instantaneous Decoder Refresh*. Une image complète, décodable seule.
Un flux commence toujours par là.

**Intra / tout-intra** — une image compressée sans référence aux autres. Simple,
mais très coûteux en débit si toutes le sont.

**libva** — la bibliothèque C qui implémente VAAPI.

**Miri** — un interpréteur Rust qui détecte les comportements indéfinis. Il **ne
peut pas** exécuter de fonction C, donc il ne validera jamais un appel libva — il
sert sur l'arithmétique de pointeurs *autour* des appels, là où une erreur serait
la nôtre.

**Modifier** — nombre de 64 bits décrivant l'agencement mémoire exact d'une image
(tuilage, compression). Deux composants doivent s'accorder dessus pour partager
une image.

**Mutation testing** — technique qui modifie volontairement le code pour vérifier
qu'un test échoue. Un test qui survit à toutes les mutations ne teste rien.

**NAL unit** — l'unité de découpage d'un flux H.264. Chaque en-tête et chaque
tranche d'image en est une.

**NV12** — format d'image : luminance pleine résolution, couleur au quart. Ce que
mangent les encodeurs.

**Pipe nommé** — un fichier spécial servant de canal entre deux processus.

**Plan (*plane*)** — une des composantes séparées d'une image. NV12 en a deux :
luminance, et couleur entrelacée.

**RDNA2 / RDNA4** — générations d'architecture GPU AMD. La nôtre est RDNA2 ; la
limitation DCC de l'encodeur disparaît en RDNA4.

**Render node** — le fichier `/dev/dri/renderD128` par lequel on parle au GPU pour
du calcul, sans droits d'affichage.

**RGBA** — format d'image classique : rouge, vert, bleu, transparence, par pixel.

**Segfault** — plantage dû à un accès mémoire invalide.

**Shader de calcul** — programme GPU générique (pas seulement graphique),
travaillant sur des milliers d'éléments en parallèle.

**Shim** — fine couche d'adaptation entre deux interfaces. Ici, un fichier C entre
Rust et libavcodec.

**SIGBUS** — signal d'erreur d'accès mémoire. Dans notre cas, symptôme d'une
mémoire partagée trop petite.

**SPS / PPS** — *Sequence / Picture Parameter Set*. Les en-têtes H.264 qui
décrivent la taille, le format et les options du flux. Un décodeur en a besoin
avant la première image.

**Tuilage (*tiling*)** — rangement d'une image par blocs plutôt que par lignes,
pour la performance GPU. Invisible tant qu'on ne lit pas la mémoire directement.

**unsafe** — en Rust, le mot-clé qui lève les garanties du compilateur. Interdit
dans ce projet, sauf pour la FFI et avec justification écrite.

**VAAPI** — *Video Acceleration API*. L'interface Linux vers l'encodeur/décodeur
matériel.

**Vulkan** — interface bas niveau vers le GPU, pour le rendu et le calcul.

**VRAM** — la mémoire de la carte graphique.

**Zero-copy** — l'objectif : la donnée n'est jamais recopiée.

---

*Ce document est tenu à jour au fil du projet. Si une décision change, c'est ici
qu'on explique pourquoi — pas seulement dans l'ADR.*
