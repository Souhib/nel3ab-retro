# Carnet de bord — le projet expliqué

Ce document s'adresse à un humain, pas à un agent. Il raconte **ce qu'on
construit, pourquoi, ce qui a résisté, et ce qu'on a choisi** — en expliquant les
termes au passage. Les autres documents sont des documents de travail :

| Document | Pour quoi |
|---|---|
| `adr/0001-architecture.md` | les décisions, en une ligne chacune, avec leur raison |
| `m1-`, `m2-`, `m3-working-plan.md` | l'état d'avancement, les mesures brutes |
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
   │          │                    │       ↓ image      ↓ son      │
   │  vidéo   │ ◄─── H.264 ─────── │  GPU : conversion + encodage  │
   │  son     │ ◄─── PCM ───────── │                               │
   └──────────┘                    └───────────────────────────────┘
```

Au moment où ces lignes sont écrites, ça marche : image, son, quatre manettes,
sur le réseau privé. Ce qui manque est écrit en clair au chapitre 10, et le plus
gros trou est qu'**il n'y a aucune authentification**.

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

### 5.13 Vulkan : la décision inverse, et pourquoi ce n'est pas une contradiction

Il reste un maillon : importer l'image de Dolphin dans Vulkan, lancer le shader,
écrire dans la surface de l'encodeur. Il faut donc appeler Vulkan depuis Rust — et
la question se repose : un shim C, comme pour ffmpeg, ou une liaison directe ?

**Réponse opposée à celle de D7, et c'est justement l'intérêt.**

Le shim existe pour une raison précise : les structures de ffmpeg changent de
disposition entre versions majeures, donc mesurer leurs positions serait faux
après une mise à jour système. **Cette raison ne se transporte pas à Vulkan.**
Vulkan est une API conçue pour être liée : elle s'étend par des chaînes de
pointeurs (`pNext`) au lieu de faire grossir ses structures, et son ABI est
stable par spécification. Le danger que le shim contient n'existe pas ici.

`ash` est la liaison Rust standard, pré-générée (donc pas de bindgen), et charge
`libvulkan` à l'exécution.

Mais l'argument décisif n'est pas la liaison — c'est **où étaient les bugs**. Les
deux courses déjà corrigées portaient sur le *moment* où une image est sûre à
toucher, pas sur la façon d'appeler Vulkan. Cette logique-là est de
l'orchestration : quelle case, à qui le tour, quand soumettre. Un shim
déplacerait précisément la partie risquée dans le seul langage qui ne peut pas la
vérifier.

Ce que ça coûte : l'exception `unsafe` du projet couvre maintenant trois modules
au lieu d'un. La règle est **amendée**, pas contournée — et ajouter un quatrième
module exigera désormais sa propre décision écrite.

> **Leçon** : deux situations qui se ressemblent ne méritent pas forcément la même
> réponse. Ce qui compte, c'est de savoir **quelle raison** a produit la première
> réponse, et de vérifier si elle s'applique encore.

### 5.14 La chaîne tourne, prouvée sur les octets

Tout est en Rust maintenant, sauf Dolphin à l'entrée :

1. libavcodec alloue la surface NV12 (D5 : l'encodeur alloue en premier)
2. Vulkan l'importe en **deux images inscriptibles**
3. le shader écrit du BT.709 dedans, sans copie
4. l'encodeur la lit et sort du H.264

Le test qui compte ne regarde ni un code de retour ni une propriété : il écrit un
motif connu, puis **relit les octets** de la luminance et les compare à une
référence transcrite depuis la norme — écrite séparément, car une référence qui
partagerait les constantes du shader ne prouverait que « le code est égal à
lui-même ».

**Pire écart : 1** sur 307 200 échantillons. Et les deux erreurs classiques sont
bien attrapées : BT.601 au lieu de BT.709 donne 28, plage complète au lieu de
limitée donne 20.

### 5.15 Dolphin à l'entrée, et ce qui reste non prouvé

L'image de l'émulateur s'importe maintenant comme source du shader. Le test ne
simule pas Dolphin : il fabrique un **vrai dma-buf** côté Vulkan, décrit par un
vrai descripteur, et le remet dans l'état exact où le patch laisse ses cases —
`GENERAL`, relâchée vers la « famille étrangère ».

> **Famille de files étrangère** : Vulkan veut savoir quand une mémoire passe à
> un composant qu'il ne connaît pas (ici le moteur vidéo, ou l'autre processus).
> On la « relâche » puis on la « réacquiert », faute de quoi les deux côtés ne
> s'accordent plus sur qui possède quoi.

Erreur attrapée par ce test : mapper `ABGR8888` (nommage DRM) sur
`B8G8R8A8` (nommage Vulkan). Les deux décrivent les mêmes octets **par les bouts
opposés**, et les confondre inverse le rouge et le bleu — écart de 31.

**Ce qui n'est pas prouvé, et il faut le dire.** Supprimer la barrière
d'acquisition laisse tous les tests verts sur ce pilote. C'est normal : la spec
dit que le contenu *peut* devenir indéfini, pas qu'il le *sera*. Seule la couche
de validation de Vulkan peut trancher.

Je l'ai installée. **Elle fait planter le pilote** : lier une image à une mémoire
dma-buf importée segfaute dans `libvulkan_radeon.so`, appelé à travers la couche.
La même séquence tourne proprement sans elle — la faute n'est donc pas dans notre
chaîne, et la couche installée a deux ans de retard sur Mesa.

Elle est donc passée en optionnelle (`NEL3AB_VULKAN_VALIDATION=1`), et les
barrières d'échange de propriété restent **relues, pas prouvées**. C'est plus
faible que tout le reste de ce crate, et c'est écrit noir sur blanc dans le code.

### 5.16 M2 est fini, et regardé

La chaîne complète tourne contre un vrai Dolphin et une vraie ROM :

```
anneau : 3 cases, 640x480, modifier 0x0200000018601b03, pitch 2560
900 frames en 15,0 s (60,2 fps), l'émulateur en a produit 900 sur le même temps
CPU du worker : 0,260 s = 0,017 cœur (0,289 ms par image)
ffprobe : 640,480,yuv420p
```

**Zéro image perdue** sur 900, et le tuilage est bien celui d'AMD — ce qu'aucun
dma-buf fabriqué à la main ne pouvait couvrir.

Et la latence, mesurée cette fois sur de **vraies** images (le tableau de D7
avait été pris sur des surfaces vides, donc un plancher) :

| étape | p50 | p99 | max |
|---|---|---|---|
| conversion RGBA→NV12 | 0,13 ms | 0,18 ms | 0,64 ms |
| encodage H.264 | 1,14 ms | 1,46 ms | 4,19 ms |

Une image qui porte vraiment quelque chose coûte **14 % de plus** qu'une image
vide. Sur les 16,7 ms dont on dispose à 60 Hz, le GPU en prend 1,3.

Le chiffre que M2 existait pour produire : **0,017 cœur contre 0,57** pour
l'ancienne recopie vers le CPU. Facteur 33. Nuance à garder : les 0,57
mesuraient le coût de la sortie d'images *dans Dolphin*, les 0,017 mesurent le
coût dans notre worker — deux processus différents. La comparaison porte sur « ce
que coûte au CPU le fait de faire sortir les images », pas sur un même compteur.

Et surtout : la frame décodée a été **regardée**. La boîte de dialogue de Melee,
aux bonnes couleurs. C'est la fin de la promesse faite au début du jalon.

### 5.17 Trois assertions fausses avant la bonne

Ce test a échoué deux fois pour de mauvaises raisons, et c'est instructif :

1. **« le plus petit paquet doit être gros »** → 35 octets, échec. Correct :
   Melee est sur un écran **statique**, et une image inter qui ne change pas
   *doit* peser presque rien. J'avais mesuré la compressibilité de l'écran.
2. **« la première image doit être grosse »** → 322 octets, échec. Correct aussi :
   les premières images de Dolphin sont **noires**, la console démarre encore.
3. **« la plus grosse des 120 doit être grosse »** → 9536 octets. Celle-là dit
   quelque chose : une vraie image a bien traversé la chaîne.

> **Leçon** : une assertion sur une taille compressée mesure le *contenu*, pas le
> code. Le tuilage, lui, n'est attrapé que par une comparaison de ce que Vulkan
> dit de l'image contre ce que le producteur a annoncé — une image mal rangée
> compresse **plus mal**, donc plus gros, et passerait tous les seuils.

---

## 6. Milestone 3 — le navigateur, le son, et la salle

M2 s'arrête quand l'image sort du serveur. M3 commence quand elle arrive
**chez quelqu'un** : un navigateur qui décode, une manette qui répond, une
salle où l'on est plusieurs, et du son. C'est le milestone le plus long du
projet, et de loin celui qui a produit le plus d'erreurs instructives — parce
que c'est le premier où un humain regarde le résultat et dit « ça saccade ».

### 6.1 M3 commence — et sa première question est déjà tranchée

M3 doit faire arriver le flux dans un navigateur et remonter les manettes. Une
seule décision commande tout le reste :

> **WebRTC, ou nos octets sur un transport simple décodés par WebCodecs ?**

> **WebRTC** est la réponse standard pour la vidéo à faible latence. Il donne
> gratuitement la récupération de pertes, le contrôle de congestion et la
> traversée de NAT — contre une négociation lourde (SDP, ICE, DTLS, SRTP) et un
> **tampon de gigue dont le navigateur décide la profondeur**, pas nous.
>
> **WebCodecs** est l'interface qui donne au JavaScript l'accès direct au
> décodeur matériel du navigateur — le même que WebRTC aurait utilisé, sans le
> protocole autour.

L'argument habituel pour WebRTC — pertes réseau et NAT — ne décrit pas notre
situation : auto-hébergé, LAN ou Tailscale, entre gens que l'hôte connaît. Mais
« notre réseau est bon » reste une hypothèse, et ce projet ne croit pas les
hypothèses sur parole. Donc : mesure.

**Expérience 1, faite le 2026-08-11 : le navigateur décode nos octets tels
quels.** 120 unités d'accès sur 120, en Annex B brut — aucun ré-emballage. La
boîte de dialogue de Melee s'affiche. L'option B est vivante.

Deux précautions notées avec le résultat : le « p50 178 ms » qu'affiche la page
n'est **pas** une latence, c'est un débit (tout le fichier est soumis d'un coup,
chaque image attend derrière les précédentes) ; et l'expérience utilise un
fichier enregistré, donc rien n'est interactif — la manette est l'autre moitié
de M3.

### 6.2 Le décodeur avait raison

Premier essai : `EncodingError: The given encoding is not supported`. Ni le
navigateur ni le flux — **ma page**. Elle ne coupait une nouvelle image que
lorsqu'un NAL « non-tranche » suivait une tranche, donc les 118 images inter
consécutives partaient en **un seul bloc de 118 images**.

> **Leçon** : un composant qui répond « non supporté » a en général raison sur sa
> propre entrée. Corriger depuis la mesure (ce flux n'a aucun délimiteur, et
> exactement autant de tranches que d'images), pas depuis le raisonnement.

### 6.3 On joue dans un navigateur

Le worker relie enfin les quatre morceaux : image de l'émulateur → conversion →
encodage → WebSocket, et la manette qui redescend dans les tuyaux de Dolphin.

**Deux WebSockets séparées**, une pour la vidéo et une pour la manette. Ce n'est
pas du rangement : une WebSocket est du TCP, donc sur une seule connexion une
image de 10 ko en cours de retransmission passe **devant** chaque trame de
manette de 13 octets qui la suit. Deux connexions ne partagent pas de file.

> Ça ne rend pas l'entrée *non fiable*, ce qu'elle voudrait vraiment — une entrée
> retransmise est déjà périmée. Il faudrait des datagrammes WebTransport. C'est
> la moitié du remède qui ne coûte rien.

Et les images sont **abandonnées, jamais mises en file**. Empiler de la vidéo
pour un client à la traîne transforme un problème de débit en problème de
latence *et le cache* : le joueur verrait un flux fluide d'images de plus en plus
vieilles.

### 6.4 La preuve, et le témoin qui manquait

Premier essai : deux passages, l'un en tapant des touches, l'autre non. Les deux
montraient le jeu **passé** son dialogue d'ouverture. Ça ressemblait à une
preuve. Ça n'en était pas : le second passage héritait de l'état que le premier
avait changé — même émulateur.

Refait avec un Dolphin neuf par bras, même durée :

| | images | à l'écran |
|---|---|---|
| aucune touche | 1141 | le dialogue, immobile |
| avec touches | 1119 | dialogue écarté, l'intro joue |

M1 avait mesuré que ce dialogue ne bouge jamais seul — 7037 images identiques —
donc un écran qui l'a dépassé **est** la preuve, à condition de partir du même
endroit.

> **Leçon** : un témoin qui partage un état avec le bras testé n'est pas un
> témoin. C'est la même erreur que les trois tests verts de M2, dans un décor
> différent.

### 6.5 Un navigateur sans humain

lgf n'a pas d'écran. Pour juger la moitié navigateur, j'y fais tourner un
**navigateur sans interface** (Puppeteer) contre `localhost` — ce qui règle au
passage le « contexte sécurisé » que WebCodecs exige et que `http://` sur une IP
de réseau local n'offre pas.

Il rapporte ce que la page dit d'elle-même, échantillonne le canvas, et laisse
une **capture d'écran à regarder**. C'est le contrôle qui manquait à chaque
affirmation creuse de ce projet.

Ce qu'il ne mesure pas : `localhost` n'est pas un réseau. Les 0,6 ms
d'arrivée-à-l'écran sont sans transit par construction — un plancher pour la
moitié navigateur, et rien du tout sur le Wi-Fi.

### 6.6 La manette, enfin chiffrée — et le chiffre accuse

Le plan de M3 appelait la manette « la moitié qui décide si ça répond », et elle
n'avait aucun chiffre. Le worker mesure maintenant combien de temps la plomberie
fait attendre une entrée avant qu'elle puisse apparaître à l'image :

```
entrées appliquées 1041 | entrée→image  p50 15,55 ms   p95 15,74 ms
```

Une trame pleine. Et c'est sa **régularité** qui est le diagnostic : le worker
vide sa file d'entrées en haut de sa boucle, laquelle est verrouillée sur la
notification d'image. L'écriture tombe donc toujours à la même phase — et cette
phase est visiblement juste *après* le moment où Dolphin lit son tuyau. On paie
une trame entière là où la moyenne devrait être d'une demi-trame.

> **Leçon** : une mesure trop régulière est une information. Un délai qui varie
> raconte du hasard ; un délai constant raconte une **phase**, donc un ordre
> d'opérations qu'on peut changer.

Le remède : ne plus écrire au rythme des images, mais **quand l'entrée arrive**,
pour que l'état le plus frais soit déjà là quand Dolphin regarde.

**Fait, et mesuré :**

| | avant | après |
|---|---|---|
| entrée→image p50 | 15,55 ms | **5,18 ms** |
| entrée→image p95 | 15,74 ms | 15,58 ms |

La médiane a fondu ; le p95 n'a pas bougé, et c'est **normal** — le pire cas
reste « l'entrée arrive juste après la frontière de trame ». C'est exactement le
passage d'un délai *constant* à un délai *uniforme* : on ne peut pas faire mieux
sans que Dolphin lise son tuyau plus souvent, ce qui ne dépend pas de nous.

Trois pièces pour ça : `Pipes` passe derrière un partage et l'émulateur expose un
`PadWriter` qu'un second fil peut tenir ; le transport gagne une **attente
bloquante** (variable de condition) au lieu d'un sondage — elle ne coûte rien
quand personne n'appuie, ce qui est la plupart du temps ; et le worker fait
tourner l'entrée sur son propre fil.

> Un verrou empoisonné y devient une **erreur typée**, pas une panique : règle 6,
> et c'est précisément le moment qui compte — le fil d'un joueur qui tombe ne
> doit pas emporter la partie.

Et une précision qui compte : ce nombre est la part de **la plomberie** seule.
La logique du jeu ajoute ses propres trames par-dessus, et celles-là lui
appartiennent.

---

### 6.7 Le saccadement — et où il n'était pas

Premier retour de jeu réel depuis un Mac, via Tailscale : « ça marche, mais c'est
un peu saccadé ». Plutôt que de deviner, j'ai instrumenté la boucle pour dire
**où passe le temps de l'image la plus lente** de chaque fenêtre de 10 s.

Le résultat a envoyé chercher ailleurs :

```
+600 images | pire frame 24,3 ms = attente 23,3 + shader 0,14 + encode 0,85
```

Le pipeline tient exactement 60 images/seconde, le shader coûte 0,14 ms et
l'encodage 0,85 ms. **Notre boucle est oisive 15 ms sur 16,7.** Le serveur ne
jetait aucune image non plus. Ce n'était pas là.

Ce que les journaux ont trouvé à la place : **807 avertissements « file d'entrée
pleine »**. Le navigateur envoie l'état de la manette à chaque rafraîchissement —
120 fois par seconde sur un écran qui va à cette vitesse — pour un émulateur qui
le lit 60 fois. On transmettait tout. Maintenant seul **le plus récent par
joueur** part : une manette est un *niveau*, pas un *front*.

> Ce que ça abandonne, dit plutôt que caché : un appui qui commence et finit
> entre deux lectures disparaît. Il n'était pas non plus observable sur la
> console d'origine, pour la même raison.

### 6.8 Deux vrais défauts, trouvés par la mesure

**La page peignait à l'arrivée.** Elle dessinait dans le callback du décodeur,
donc l'image apparaissait quand le *décodage* finissait, pas quand l'écran se
rafraîchit. Sur un réseau réel les arrivées sont irrégulières, et peindre à
l'arrivée transforme cette irrégularité en tremblement visible. Elle garde
maintenant la dernière image et la peint sur le rafraîchissement.

**Rejoindre coûtait jusqu'à une seconde de noir.** Un décodeur ne peut rien faire
avant une image-clé, et il y en a une par seconde. L'encodeur en produit
désormais une **à la demande** quand quelqu'un ouvre la page. Mesuré : le plus
grand écart entre deux images passe de **557 ms à 19 ms**.

### 6.9 Et finalement : c'est l'émulateur qui s'arrête

Les chiffres d'une vraie partie ont tranché, et pas dans la direction attendue.
Côté serveur, sur les fenêtres où un client jouait :

```
+600 images | +0 jetées | pire attente    17 ms
+423 images | +0 jetées | pire attente  2671 ms
+455 images | +0 jetées | pire attente  2478 ms
+600 images | +0 jetées | pire attente    17 ms
```

**Zéro image jetée**, partout. Le réseau ne perd rien, notre file non plus. Les
fenêtres dégradées sont toutes des *attentes* : Dolphin cesse de produire pendant
jusqu'à **2,7 secondes**. Le navigateur rapportait un écart maximal de 2207 ms —
c'est le même événement, vu de l'autre bout.

La cause probable est la **compilation de shaders** : Dolphin fabrique un
programme spécialisé la première fois qu'il rencontre un matériau, et arrête tout
pendant ce temps. Les *ubershaders asynchrones* dessinent avec un programme
générique en attendant. Activés — les décrochages se concentrent désormais au
démarrage au lieu de revenir, mais **ce n'est pas encore concluant** et c'est dit
comme tel.

> **Leçon** : « c'est saccadé » a trois suspects — le réseau, le pipeline,
> l'affichage. Instrumenter *où passe le temps de l'image la plus lente* les a
> éliminés tous les trois en une mesure, et a désigné le seul qu'on n'avait pas
> écrit soi-même.

### 6.10 Le gel définitif : un client bloqué figeait le serveur

Le vrai défaut n'était pas le saccadement mais un **gel dont on ne revenait
pas**. Le journal l'a nommé : « the browser stopped watching ». La connexion
vidéo s'était fermée, et la page n'avait **aucune reconnexion** — elle restait
sur sa dernière image, ce qui ressemble à un gel bien plus qu'à une déconnexion.

Derrière, pire : le fil qui écrit la vidéo écrivait **sans délai d'expiration**,
et il détient le verrou de la file pendant toute sa vie. Un client dont la
connexion se coince bloque donc ce fil pour toujours — et le suivant, celui qui
recharge la page, attend un verrou qui ne sera jamais rendu. Un client malade
tuait le serveur pour tout le monde.

Trois corrections, chacune pour sa propre raison :

- une **échéance d'écriture** de 2 s. La valeur importe peu ; ce qui compte,
  c'est qu'elle soit finie ;
- `try_lock` au lieu de `lock` : un fil qui attendrait ici attendrait sur la
  *socket d'un autre*, exactement le couplage qui transformait un client bloqué
  en serveur mort ;
- la **reconnexion automatique** côté page, et comme le serveur envoie une
  image-clé à qui arrive, reprendre c'est une image tout de suite.

Vérifié en coupant le worker en pleine session : `connection up (2 drops)`, et
l'image est revenue seule.

> **Leçon** : un composant qui attend sans échéance sur quelque chose qu'il ne
> contrôle pas finit par bloquer ce qui n'a rien demandé. Et une panne qui
> *ressemble* à un gel sera diagnostiquée comme une lenteur — c'est le journal
> qui a dit le vrai mot.

### 6.11 Les images perdues n'étaient pas du retard, c'étaient des images

Ton écran est à 60 Hz et le flux à 60 images/s. Sans relation de phase entre les
deux, il arrive régulièrement que **deux images tombent dans le même
rafraîchissement et aucune dans le suivant**. La page ne gardait que la plus
récente : la première du couple était donc **jetée sans jamais être vue**, et
l'intervalle vide **répétait** l'image précédente.

Cinq à six images de jeu sur soixante, perdues chaque seconde. Ce n'est pas du
retard, ce sont des instants du jeu que personne ne verra — et manette en main,
c'est exactement ce que « un chouïa saccadé » veut dire.

Remplacé par une **file** présentée une image par rafraîchissement. Une image de
marge suffit à absorber un retard d'un rafraîchissement, parce qu'il y en a une
derrière pour couvrir le trou. La gigue devient de la **latence** au lieu de
devenir des images manquantes — et la latence, elle, est visible et chiffrée sur
la page.

> La profondeur s'adapte : zéro sur une boucle locale (où un tampon fixe serait
> 16,7 ms de perte sèche), une à deux sur du Wi-Fi. Mesuré après : l'écart entre
> images arrivées et images peintes passe de **5-6/s à 0,6/s**.

### 6.12 Deux fois la mauvaise règle : « un seul spectateur »

Le fil vidéo servait **un seul** client, derrière un verrou. Première règle :
refuser le nouveau venu. Conséquence : recharger la page te verrouillait dehors,
précisément au moment où l'on recharge.

Deuxième règle : le plus récent gagne. Conséquence bien pire, et mesurée — deux
pages avec reconnexion automatique se chassent l'une l'autre en boucle,
**vingt coupures en vingt-quatre secondes**.

La règle était fausse à la racine. Une salle a **jusqu'à quatre joueurs**, et
chacun a besoin de l'image : la forme correcte est une **diffusion**, pas un
verrou. Chaque spectateur a sa propre file ; celui qui décroche perd ses images
et celles de personne d'autre.

> **Leçon** : quand une règle échoue deux fois de suites différentes, ce n'est
> pas la règle qu'il faut ajuster — c'est qu'elle répond à la mauvaise question.

### 6.13 Une file là où il fallait un état

La manette arrivait dans une file de 64. Elle débordait : **1073 avertissements
en cinq minutes**, du bruit qui aurait masqué une vraie panne.

Or une manette est un *niveau*. Seul le plus récent état d'un port peut être
appliqué, donc tout ce qui attend derrière est du travail déjà périmé.
Remplacé par **une case par port** : écrire remplace. Ça ne peut pas déborder,
ça ne peut pas vieillir, et il n'y a aucune politique à choisir sur quoi jeter.

### 6.14 Une métrique qui se lit mal est une métrique fausse

La page annonçait « 72,5 % des rafraîchissements n'ont rien de neuf ». Alarmant,
et presque vide de sens : sur un écran à **120 Hz**, un flux parfait à 60 images
par seconde laisse **la moitié** des rafraîchissements sans rien, par
construction. La phrase honnête était « 33 images peintes sur 60 envoyées ».

Elle affiche maintenant des **débits** — envoyé, arrivé, peint, rafraîchi — parce
qu'un nombre qu'on ne peut pas lire sans connaître la fréquence de l'écran est un
nombre qui sera mal lu.

### 6.15 Ce qui reste, et son prix

En boucle locale, 8 % des rafraîchissements n'ont rien de neuf à montrer. Ce
n'est pas le réseau : c'est **60 images par seconde envoyées vers un écran à
60 Hz sans relation de phase** — certains rafraîchissements reçoivent deux
images et en jettent une, d'autres n'en reçoivent aucune et répètent.

Le remède est un petit tampon de lissage : retenir une image et présenter à
cadence régulière. Il coûte exactement ce qu'il retient — 16,7 ms de latence en
plus. C'est le service que WebRTC rend gratuitement, et la contrepartie que le
plan de M3 avait annoncée. À trancher sur une mesure prise depuis un vrai
client, pas ici.

### 6.16 Le crash : ce n'était pas nous

« Dolphin freeze et relance le jeu » n'était pas du saccadement : c'était un
**plantage**, toutes les trois à quatre minutes. Le service ayant
`Restart=always`, systemd relançait tout et le jeu repartait de zéro.

Ce qu'on a établi, dans l'ordre :

**1. Le noyau nomme le coupable.** Chaque plantage laisse la même trace :
`segfault at 40 ... in libvulkan_radeon.so`, toujours au **même décalage**
(0xBA23E) dans la bibliothèque. `at 40` = déréférencement d'un pointeur nul.
C'est le pilote Vulkan qui tombe, sur le fil qui soumet le travail au GPU.

**2. Ce n'est pas notre code.** Un Dolphin témoin, même image, avec l'export
d'images **entièrement inerte** (la variable d'environnement absente), plante
exactement pareil — worker arrêté, aucune ambiguïté d'attribution.

**3. Ni le mode de threads.** Passé en double cœur, le crash se déplace du fil
« CPU-GPU » au fil « Video » et reste identique. Renommé, pas corrigé.

**4. Ni les ubershaders** (le premier crash précède leur activation), **ni une
divergence de version Mesa** (25.2.8 des deux côtés, vérifié), **ni les lectures
de l'EFB** (désactivées : pente inchangée).

**5. Dolphin dit lui-même ce qui échoue :**

```
CreateDescriptorPool:187  vkCreateDescriptorPool failed: VK_ERROR_OUT_OF_DEVICE_MEMORY
```

**6. Et le noyau dit ce qui fuit.** La VRAM reste plate à 310 Mo, mais le
**GTT** — la mémoire système mappée pour le GPU — monte **linéairement de
12,5 Mo/s** jusqu'à ~3 Go, puis tout s'écroule. En listant les objets alloués :

```
3 276 800 octets, GTT CPU_ACCESS_REQUIRED : 349 -> 692 objets en 90 s
```

Environ **quatre tampons de 3,1 Mo par seconde, jamais libérés**. Rien d'autre ne
prolifère. Ce sont des tampons *accessibles au CPU* — la signature d'un tampon de
transfert, pas d'une texture.

> **La conclusion** : une fuite mémoire GPU dans le moteur Vulkan de Dolphin
> épuise la mémoire en quatre minutes ; l'allocation qui échoue en premier est un
> pool de descripteurs ; l'échec n'est pas vérifié, et le pointeur nul fait
> tomber le pilote.

### 6.17 Ce que les objets sont, et ce qu'ils ne sont pas

En instrumentant Dolphin (l'arbre source est dans `dolphin-dev`, la
reconstruction prend quinze secondes) pour journaliser **chaque** allocation de
tampon avec sa taille : **zéro** allocation de 3 276 800 octets. Les tampons de
flux sont créés une fois au démarrage ; les tampons de transfert font 1 351 680
octets, soit 640×528×4 — la taille de l'image.

Donc ces objets ne viennent pas des tampons de Dolphin. Or ce sont des tampons
**accessibles au CPU**, et l'allocation qui échoue est un *pool de
descripteurs* — un pool est exactement ça. Confirmé par une expérience qui a
échoué dans la bonne direction : en modifiant Dolphin pour ne **plus jamais
détruire** ses pools, le nombre d'objets de 3,1 Mo est passé de 183 à 1163 en
soixante secondes. Ce sont bien les pools.

### 6.18 Les deux jeux, et ce que ça écarte

Mario Kart Double Dash fuit aussi — ce n'est donc pas propre à Melee, c'est le
moteur Vulkan. Mais son profil est plus parlant :

```
t+30s   GTT=448 Mo   pools=22     (menus)
t+120s  GTT=483 Mo   pools=94
t+180s  GTT=3112 Mo  pools=929    (en piste)
t+300s  GTT=629 Mo   pools=85     (libérés !)
```

**Les pools finissent par être libérés.** Ce n'est donc pas une fuite au sens
strict : c'est une croissance pilotée par la complexité de la scène, dont le pic
dépasse la mémoire disponible avant que le nettoyage n'arrive. Melee, avec son
écran d'attente qui boucle, atteint ce pic en quatre minutes et demie ; Mario
Kart survit plus longtemps parce que ses menus n'allouent presque rien.

### 6.19 La contrainte matérielle sous tout ça : le Resizable BAR

Une question restait sans réponse : **pourquoi une allocation échoue-t-elle à
3 Go alors que le noyau annonce 32 Go de GTT ?** En demandant à Vulkan ses tas
de mémoire plutôt qu'au noyau :

```
heap 0 :  7936 Mo  DEVICE_LOCAL        (la VRAM)
heap 1 : 32094 Mo  hôte                (la mémoire système)
heap 2 :   256 Mo  DEVICE_LOCAL        (la fenêtre visible par le CPU)
```

> **BAR** (*Base Address Register*) : la fenêtre par laquelle le processeur voit
> la mémoire de la carte graphique. Historiquement 256 Mo, quelle que soit la
> taille de la carte. Le **Resizable BAR** permet de l'ouvrir sur toute la VRAM.

Le heap 2 est la seule mémoire à la fois **rapide pour le GPU** et **écrivable
par le CPU** — exactement ce qu'un pool de descripteurs demande. Et il est
**saturé en permanence** : mesuré à 253/256 Mo dès la trentième seconde, 255/256
ensuite, jamais moins. Les pools débordent donc en mémoire système, s'y
accumulent, et finissent par faire échouer une allocation.

`lspci` confirme la marge disponible :

```
BAR 0: current size: 256MB, supported: 256MB 512MB 1GB 2GB 4GB 8GB
```

La carte sait faire 8 Go ; elle tourne à 256 Mo parce que le firmware ne l'a pas
activé. **À dire honnêtement** : que la fenêtre soit pleine explique le
débordement, pas le crash — elle est déjà pleine pendant les quatre minutes qui
se passent bien. C'est une hypothèse à tester, pas une démonstration. Mais c'est
la seule qui se règle par un réglage plutôt que par un correctif amont, et le
noyau expose de quoi la tester sans redémarrer.

### 6.20 Le redimensionnement à chaud : tenté, refusé, et la raison est nette

Le noyau 6.8 expose `/sys/bus/pci/devices/…/resource0_resize`, donc la fenêtre se
redimensionne en théorie sans redémarrer. Tenté, avec le pilote détaché :

```
8 Go   → No space left on device
4 Go   → No space left on device
2 Go   → No space left on device
1 Go   → No space left on device
512 Mo → No space left on device
```

Même **doubler** est refusé. La raison se lit dans `/proc/iomem` : la BAR est à
l'adresse `0xd0000000`, soit **3,5 Go — sous la barre des 4 Go** — et il n'existe
aucune fenêtre PCI au-dessus. Le firmware a tout placé dans l'espace d'adressage
32 bits et n'a rien réservé au-delà, donc le noyau n'a **nulle part** où mettre
une fenêtre plus grande.

C'est la signature de **« Above 4G Decoding » désactivé**. Le réglage BIOS n'est
pas une préférence : c'est ce qui crée l'espace d'adressage sans lequel le
redimensionnement est impossible, à chaud comme au démarrage.

Vérifié une dernière fois du côté des fenêtres que le firmware déclare :

```
000a0000-000dffff : PCI Bus   (hérité)
d0000000-fec2ffff : PCI Bus   (3,5 Go → 4,26 Go)
fee00000-ffffffff : PCI Bus
```

**Aucune fenêtre au-dessus de 4 Go.** Cela écarte aussi le paramètre noyau
`pci=realloc`, qui réattribue dans l'espace existant : il n'y a rien à
réattribuer. Le seul contournement logiciel restant serait `pci=nocrs`, qui fait
ignorer au noyau la description du firmware et reconstruire les fenêtres
lui-même — un coup de poker sur une machine sans écran, et à réserver.

Et la machine est une **ASUS ROG STRIX B550-A**, carte grand public : **pas
d'IPMI**, donc pas d'accès BIOS à distance. Un serveur destiné à tourner sans
écran gagnerait un boîtier KVM sur IP ; c'est un outil, pas un luxe.

La carte a survécu aux six cycles détacher/rattacher : 59 tests GPU au vert
après coup.

### 6.21 Le correctif : ne pas réparer la fuite, survivre à sa fin

Trois tentatives pour arrêter la croissance ont échoué. La quatrième idée était
différente : **ne pas empêcher la panne d'arriver, l'empêcher d'être mortelle.**

En suivant la chaîne jusqu'au bout dans le code de Dolphin :

1. `vkCreateDescriptorPool` échoue — plus de mémoire ;
2. `AllocateDescriptorSet` renvoie donc `VK_NULL_HANDLE` ;
3. l'appelant écrit ce handle nul **directement** dans un `VkWriteDescriptorSet`,
   sans le vérifier ;
4. `vkUpdateDescriptorSets` déréférence ce nul → **segfault à l'offset 0x40**.

C'est exactement notre trace noyau. Le correctif tient en une idée : vérifier
chacune des six allocations, et faire remonter le refus jusqu'à `Bind()` — qui
renvoie déjà un booléen que l'appelant sait traiter. Le dessin est sauté.

**Mesuré :** la mémoire plafonne à 3,2 Go au lieu de faire tomber le pilote, et
l'émulateur tournait encore à **huit minutes** au lieu de mourir à quatre. Puis,
image reconstruite et worker relancé : **zéro redémarrage en sept minutes**, là
où c'en était un toutes les quatre minutes trente. Et l'image a été regardée —
un match à quatre, couleurs justes, HUD complet, aucun artefact visible.

> **Ce que ça ne fait pas** : la fuite est toujours là, et l'émulateur tourne
> désormais en permanence à 3,2 Go de mémoire GPU saturée. Des dessins *sont*
> sautés une fois ce plafond atteint ; on n'en voit pas les effets, ce qui ne
> veut pas dire qu'il n'y en a jamais. Le réglage BIOS reste la vraie réponse à
> la cause, celui-ci répond au symptôme mortel.

> **Leçon** : quand trois tentatives d'empêcher une panne échouent, la question
> suivante n'est pas « comment l'empêcher » mais « pourquoi est-elle fatale ».
> Perdre une image vaut mieux que perdre la partie.

### 6.22 Deux erreurs de raisonnement à garder

**Deux correctifs écrits, deux échecs, gardés écrits.** J'ai d'abord trouvé un
vrai bug de croissance sans borne (`m_descriptor_set_count` s'incrémente à chaque
débordement, ne décroît jamais) : corrigé, reconstruit, **fuite inchangée**.
Puis j'ai essayé de réinitialiser les pools au lieu de les recréer : **six fois
pire**. Aucun des deux n'est livré. Une divergence d'avec l'amont se paie, et
elle ne se paie que contre une mesure.

Le premier essai venait d'une erreur de lecture : **le message d'erreur nomme la
victime, pas le coupable.** Le pool était la première allocation à échouer.

**Un compteur qui peut décroître n'est pas un repère.** Pour détecter les
plantages je comptais les lignes de `dmesg` — un **tampon circulaire**. Le compte
est passé de 69 à 68, ma boucle d'attente n'a jamais déclenché, et j'ai failli
conclure d'une mesure cassée. Repère temporel depuis.

### 6.23 Le vrai correctif : ouvrir la fenêtre, sans passer par le firmware

Le BIOS avait bien « Above 4G Decoding » et « Resizable BAR » activés — vérifié —
et **ça n'a rien changé** : la BAR restait à 256 Mo et `/proc/iomem` ne montrait
toujours aucune fenêtre PCI au-dessus de 4 Go. Le firmware annonce une chose et
en applique une autre.

Mais le noyau écrit lui-même la solution à chaque démarrage :

```
PCI: Using host bridge windows from ACPI; if necessary, use "pci=nocrs" and report a bug
```

`pci=nocrs` lui fait **ignorer la description du firmware** et reconstruire les
fenêtres depuis le matériel. Au démarrage suivant :

```
root bus resource [mem 0x00000000-0x7ffffffffff]      ← 8 To d'espace
```

Et le redimensionnement, refusé cinq fois en `ENOSPC`, passe du premier coup :

```
8192 Mo : ACCEPTÉ
Region 0: Memory at 1200000000 (64-bit, prefetchable) [size=8G]
```

L'adresse `0x1200000000` est au-dessus de 4 Go — exactement l'espace que le
firmware refusait de céder.

### 6.24 Ce que ça change, mesuré sur la même charge

| | avant | après |
|---|---|---|
| VRAM visible par le CPU | 256 Mo / 8176 | **8176 Mo / 8176** |
| GTT (mémoire système) | +12,5 Mo/s jusqu'à 3 Go | **205 Mo, plat** |
| échecs d'allocation | plusieurs par session | **zéro** |
| pire attente d'image | jusqu'à 2700 ms | **16,8 ms** |
| plantages | un toutes les 4 min 30 | **aucun** |

Les pools de descripteurs vivent désormais dans la VRAM, là où ils doivent être,
au lieu de déborder en mémoire système et de s'y accumuler. **Les décrochages de
plusieurs secondes ont disparu avec eux** — ils étaient le symptôme du même
débordement.

Le tout est rendu permanent par deux pièces dans `deploy/` : les paramètres
noyau, et un service qui redimensionne la fenêtre **avant que quoi que ce soit ne
touche au GPU** — à ce moment du démarrage amdgpu n'est pas encore chargé, donc
il n'y a rien à détacher. Vérifié après un redémarrage complet, sans
intervention.

> **Leçon** : un réglage de firmware qui *dit* être actif n'est pas une preuve
> qu'il l'est. `/proc/iomem` l'était. Et quand un composant écrit dans ses
> journaux le nom du contournement, ça vaut la peine de le lire.

### 6.25 Le gel qui restait : une socket vivante qui se tait

Après le correctif de la fenêtre, plus de plantage — mais un **gel** au bout d'un
moment, sans redémarrage. Le journal, pris pendant que ça gelait :

```
21:06:16  a browser is watching
21:06:45  the viewer's connection gave up : Broken pipe
21:06:45  the browser stopped watching
```

Le serveur, lui, allait très bien : 600 images par 10 s, zéro jetée. Et deux
sockets TCP restaient **établies**, celles du proxy TLS.

Le mécanisme est là : le côté serveur s'est fermé sur une écriture cassée, le
proxy a gardé la socket ouverte côté navigateur, et **la page n'a jamais appris
la fermeture**. Sa reconnexion automatique attend un événement `onclose` qui
n'arrive pas. Elle reste sur sa dernière image, pour toujours.

> **Une socket vivante qui se tait ressemble exactement à une socket qui
> marche.** Se reconnecter sur la fermeture ne suffit donc pas : il faut
> surveiller le **silence**.

Deux secondes sans le moindre octet — cent vingt images, très au-delà de tout
hoquet — et la page ferme elle-même pour repartir par le même chemin qu'une
fermeture propre. Une seule voie de retour plutôt que deux.

Vérifié en figeant le worker cinq secondes avec `SIGSTOP`, ce qui laisse les
sockets vivantes et coupe les images : `silence recoveries 1`, connexion
rétablie, image revenue.

### 6.26 Et le test a trouvé ce que le raisonnement n'avait pas

Première version : je mettais à jour le témoin de vie **après** le bloc qui
ignore les images tant qu'aucune image-clé n'est arrivée. Pendant cette seconde
d'attente, la socket paraissait muette — le chien de garde la fermait, la
reconnexion attendait à nouveau une image-clé, et ainsi de suite. Un **blocage
en boucle** que j'avais écrit en croyant faire l'inverse.

Le signe de vie, c'est **des octets qui arrivent**, pas des images qui décodent.

### 6.27 Le gel d'après : le décodeur meurt, la socket va très bien

Le chien de garde a réglé son cas — et il restait un gel. Cette fois j'ai pu
regarder pendant qu'il durait, et **tout allait bien** :

| Ce que je voyais | Ce que ça prouvait |
|---|---|
| 600 images par 10 s, `jetées = 0` | le serveur encode et écrit |
| les deux sockets `ESTABLISHED`, aucun « tuyau cassé » | les octets partent bien |
| `inputs_received` +117 par seconde | **la page tourne encore** : c'est elle qui envoie les manettes, sur le rythme de l'écran |
| aucune reconnexion au journal | le chien de garde ne voyait rien d'anormal |

Par élimination il ne restait qu'un endroit : **le décodeur du navigateur**. Les
octets arrivaient, et rien n'en sortait.

Et c'est précisément ce que mon chien de garde ne pouvait pas voir. Sa règle est
« des octets arrivent, donc tout va bien » — la correction du blocage en boucle,
qui était juste. Elle est aveugle à un décodeur mort derrière une socket vivante.

> Deux pannes, deux signes de vie. **La socket parle-t-elle encore ?** et **le
> décodeur répond-il encore ?** Aucun des deux ne répond pour l'autre.

Le mécanisme exact : un `VideoDecoder` qui échoue **reste là**. Mon code se
contentait d'afficher l'erreur, l'objet restait en place, et chaque image
suivante déclenchait `Cannot call 'decode' on a closed codec` — pour toujours.

Trois corrections :

1. **une erreur de décodeur détruit le décodeur** au lieu de l'afficher ; le
   prochain point de reprise en reconstruit un, à une seconde au plus ;
2. **un second chien de garde** : des octets frais mais rien qui sorte depuis
   deux secondes, on reconstruit — sans toucher à la socket, qui n'est pas la
   pièce cassée ;
3. **l'horodatage des images envoyées au décodeur** venait d'un compteur de ce
   qui en **sortait**. Quand la sortie ralentit, les images qui **entrent**
   reçoivent toutes le même horodatage — nourrir un décodeur qui bégaie avec des
   horodatages identiques est la meilleure façon d'aggraver son bégaiement. Il
   utilise maintenant l'instant de capture envoyé par le serveur.

### 6.28 Le test qui casse le décodeur exprès

Deux façons de mourir, et il fallait les deux :

- **la bruyante** — `close()`, et chaque décodage lève une exception. C'est
  exactement l'état observé.
- **la silencieuse** — le décodeur avale les images et n'en rend aucune. Aucun
  gestionnaire d'erreur ne peut la voir ; seul le chien de garde le peut.

Un test qui n'aurait cassé que la bruyante aurait laissé le chien de garde
**non prouvé** : la correction n° 1 suffit à le faire passer au vert.

Vérifié dans les deux sens, comme toujours ici. Avec le chien de garde désarmé,
la mort silencieuse donne **+1 image peinte en six secondes** — le gel. Armé :
**+71**, une seconde pleine de jeu. C'est `just browser-recovery`.

### 6.29 Des chiffres qu'on ne peut pas copier ne servent à personne

Le panneau de statistiques se réécrit deux fois par seconde. Or **réécrire le
nœud efface la sélection** : surligner un nombre pour me l'envoyer était
impossible, la sélection disparaissait avant le second clic.

Deux réponses. L'affichage **se fige tant qu'une sélection est vivante dedans**
— un compteur en pause pendant qu'on le lit vaut mieux qu'un compteur que
personne ne peut citer — et un bouton copie tout d'un clic, puisque la raison
d'être de ces chiffres est d'être envoyés.

Et le test a attrapé bien plus que ce qu'il visait : mon `const hint` s'appelait
d'abord `held`, nom déjà pris par l'ensemble des touches enfoncées. Un module
qui déclare deux fois le même nom **ne s'exécute pas du tout**. Côté serveur
c'était invisible — les images partaient très bien vers une page morte ; le
panneau affichait encore « connecting… », onze caractères, et c'est cette
longueur absurde qui a trahi la panne.

> Une page qui est morte au chargement ressemble à une page qui attend encore.
> Le seul témoin fiable est ce qu'elle **dit**, pas ce qu'on lui envoie.

### 6.30 La vraie cause : Dolphin se taisait quand l'image ne changeait pas

Les deux chiens de garde étaient justes, et le gel revenait. Cette fois j'ai
regardé **en amont**, du côté du serveur, et le journal avait déjà la réponse
sous les yeux : `slowest_waiting_ms`, le temps que le worker passe à attendre une
image de l'émulateur.

| | avant |
|---|---|
| médiane | 16,5 ms — une image, normal |
| p90 | **396 ms** |
| pire | **1 385 ms** |
| fenêtres de 10 s contenant un trou > 300 ms | **18 sur 108** |

Et surtout : les trous tombaient **au même numéro d'image à chaque lancement**
(6 489 puis 6 495 ; 9 377 puis 9 383 ; 15 358 puis 15 364). Ni le réseau, ni la
charge, ni la chaleur : quelque chose de **déterministe**, lié à l'endroit où le
jeu se trouve.

J'ai échantillonné les 28 fils de Dolphin toutes les 20 ms pendant trois minutes,
et aligné sur l'instant exact des trous — le worker les nomme maintenant dans le
journal, précisément pour ça. Résultat : **personne n'attendait**. Pas d'attente
GPU, pas de lecture disque, rien. Le fil CPU-GPU travaillait ou dormait dans son
limiteur de vitesse. Dolphin allait très bien : il ne **présentait** simplement
pas d'image.

Le code de Dolphin le dit en une ligne (`VideoCommon/Present.cpp`) :

```cpp
if (!is_duplicate || !g_ActiveConfig.bSkipPresentingDuplicateXFBs)
{
  Present(&present_info);
  ProcessFrameDumping(ticks);   // ← notre export vit ici
}
```

`SkipDuplicateXFBs` vaut **vrai par défaut**. Quand le jeu réaffiche exactement
la même image — un menu, un chargement, une pause — Dolphin saute la
présentation, et notre crochet d'export avec elle. **Le flux se taisait parce que
l'image ne changeait pas.**

> Pour une console, sauter une image identique est une économie. Pour un flux
> c'est une catastrophe : le spectateur ne peut pas distinguer une image fixe
> d'un lien mort.

Et le pire : au-delà de deux secondes de silence, **mon propre chien de garde
coupait la connexion et se reconnectait** — les « deux ou trois images en
boucle ». Le correctif client était juste et il transformait un silence légitime
en rupture. Un mesuré à 2,1 s ; le seuil est à 2 s.

Un réglage suffit : `Graphics.Hacks.SkipDuplicateXFBs = False`.

| | avant | après |
|---|---|---|
| médiane | 16,5 ms | 16,3 ms |
| p90 | 396 ms | **19,7 ms** |
| pire | 1 385 ms | **46,7 ms** |
| trous > 300 ms | 18 / 108 fenêtres | **0 / 72** |

Douze minutes, jusqu'à l'image 79 204 — bien au-delà de tous les points où ils
tombaient. Ça coûte de réencoder une image identique, c'est-à-dire quelques
octets sur une image P.

**La leçon, et elle est plus grande que ce bogue :** j'ai passé des heures dans
le navigateur parce que c'est là que le symptôme se voyait. Ce que le serveur
mesurait déjà — l'attente d'une image — nommait la cause depuis le début. Quand
le symptôme est au bout de la chaîne, **la première question est ce que dit le
début de la chaîne**, pas ce que fait la fin.

### 6.31 Et pour que ça ne puisse plus recommencer : la cadence est la nôtre

Le réglage retire *cette* cause-là, il ne retire pas la classe. Quand un jeu
**efface l'écran** — un chargement, une transition — Dolphin ne présente rien du
tout, et le crochet ne part pas davantage. Deux secondes ainsi et la page
recommencerait à couper la connexion.

La correction de fond tient en une phrase : **la cadence du flux est celle du
serveur, pas celle de l'émulateur.** Une demi-seconde sans rien à envoyer et le
serveur dit quand même quelque chose — un message **vide**, que la page compte
comme un signe de vie et dont elle ne décode rien.

Vide plutôt qu'un en-tête sans image derrière : un lecteur doit le traiter à part
dans les deux cas, et une longueur nulle ne peut pas être confondue avec une
image.

Deux tests, dans les deux sens, comme toujours :

- **le positif** — aucun image envoyée, le spectateur doit recevoir un signe de
  vie. Sans le correctif : il attend, puis échoue.
- **le jumeau négatif** — un flux sans trou ne doit porter **aucun** signe de
  vie. Sans lui, en envoyer un à chaque passage aurait fait passer le premier
  test et doublé silencieusement le débit de messages. Vérifié en le cassant
  exprès : `message 0 was a keep-alive, in a stream that never paused`.

### 6.32 Quatre joueurs : c'est le serveur qui distribue les places

Le chemin d'entrée du worker savait déjà écrire dans n'importe quel port, et le
protocole a toujours eu quatre places. Il manquait la seule chose qui compte
quand il y a plus d'une personne : **qui joue quel personnage**.

C'est au serveur de le décider — lui seul sait qui d'autre est dans la salle — et
il le dit en un octet dès que la socket s'ouvre : le numéro du port, ou zéro si
la salle est pleine. La page n'envoie rien tant qu'elle ne le sait pas.

Et le port du joueur est **réécrit à l'arrivée** : la manette d'un navigateur est
tamponnée avec la place qui lui a été donnée, quoi que la trame prétende. Un
contrôle qui refuse une place volée est un contrôle qu'on peut oublier
d'écrire ; écraser la valeur, non.

La taille de la salle est fixée au démarrage — Dolphin lit à son lancement quels
ports ont une manette. Elle vaut **un** par défaut, et c'est un choix : un port
non servi avec une manette fantôme **change ce que le jeu fait** (un titre à
quatre peut ouvrir quatre écrans partagés pour un seul joueur). `NEL3AB_PLAYERS=4`
dans le service, et la salle est pour les copains.

### 6.33 Le journal a dénoncé un bogue que je ne cherchais pas

En vérifiant quatre navigateurs dans une salle, les manettes se déconnectaient
**toutes les 5,2 secondes**. Régulier au dixième près — donc pas un hasard, un
délai.

`classify()` pose une échéance de cinq secondes sur la socket pour borner la
lecture de l'en-tête HTTP. Cette échéance **reste sur la socket**. Le fil vidéo
l'efface ; le fil des manettes ne l'effaçait pas. Donc la lecture de la trame
suivante en héritait, et **un joueur qui n'appuyait sur rien pendant cinq
secondes était traité comme un joueur parti**.

Avant les places, ça se voyait à peine : la page se reconnectait. Depuis, la
conséquence est visible — le siège retournait à la salle et le joueur revenait
avec un autre personnage.

> Un réglage posé sur une socket **survit à la fonction qui l'a posé**. Chaque
> route doit dire ce qu'elle veut, plutôt qu'hériter de ce qu'une autre voulait.

Le silence sur une manette est l'état normal d'une manette. Ce qui termine une
session, c'est une socket qui se ferme.

Le test coûte six secondes de vrai temps, parce que ce qu'on observe **est** un
délai et qu'il n'y a pas moyen d'observer un délai sans l'attendre. Cassé
exprès : *« the quiet player's port was given away »*.

### 6.34 Quatre fois plus de pixels pour une milliseconde

Le flux sortait en **640×480** — la résolution native de la GameCube — étiré sur
un écran 27 pouces. Dolphin sait rendre plus grand ; restait à savoir ce que la
chaîne en pense. Trois sessions d'une minute, un navigateur en train de regarder,
même jeu :

| rendu | taille | encodage médian | pire | débit | images reçues |
|---|---|---|---|---|---|
| ×1 | 640×480 | 0,98 ms | 1,98 ms | 2,0 Mbit/s | 59,9 /s |
| **×2** | **1280×960** | **1,96 ms** | **3,41 ms** | **5,5 Mbit/s** | **59,9 /s** |
| ×3 | 1920×1440 | 6,62 ms | 7,04 ms | 10,3 Mbit/s | 54,3 /s |

Quatre fois plus de pixels pour **une milliseconde et trois mégabits**, sans
toucher au rythme. Rien dans ×1 ne méritait d'être gardé : c'est le nouveau
défaut.

Deux choses honnêtes à côté de ces chiffres :

- **La conversion ne bouge pas** (0,22 ms à toutes les résolutions). J'avais
  écrit ici que la mesure n'englobait peut-être que l'envoi du travail au GPU et
  pas sa fin. **C'était faux**, et il a suffi de relire `convert` pour le voir :
  elle appelle `wait_for_fences` juste après la soumission. Le chiffre attend
  bien le GPU. Une réserve inventée coûte autant qu'un chiffre inventé.
- **×3 tient côté serveur** — 7 ms sur un budget de 16,7 ms, rien de jeté — et
  **n'a pas tenu côté navigateur** sur cette machine : la latence de bout en bout
  p95 est passée de 28 ms à **5,7 secondes**. Un client qui ne décode pas à temps
  est un gel, quelle que soit la santé du serveur. ×3 reste disponible
  (`NEL3AB_INTERNAL_RES=3`) et n'est pas le défaut.

Le worker dit maintenant ce que le flux coûte à un lien (`megabits_per_second`),
parce que « la machine suit-elle ? » et « le réseau peut-il porter ça ? » sont
deux questions différentes avec deux réponses différentes.

### 6.35 Le vrai gel, enfin : la page nourrissait un décodeur que personne ne vidait

Tous mes essais passaient par `localhost:8100`. Le sien passe par le proxy TLS de
Tailscale, sur un Mac. J'ai fini par ouvrir **sa** page depuis son propre Chrome,
et le gel était là du premier coup :

```
requestAnimationFrame : 0 tick en 2 secondes
images peintes        : 4        (en trois minutes)
file du décodeur      : 1564 morceaux
retard du flux        : 23 secondes, et qui montait
```

Quatre images peintes. « Les mêmes 2 ou 3 images en boucle », au chiffre près.

Un onglet qui n'est pas celui de devant **ne reçoit aucun rafraîchissement** :
`requestAnimationFrame` est suspendu. Mais la socket, elle, continue de livrer
soixante images par seconde, et la page continuait de les donner au décodeur. Le
décodeur, lui, n'avançait plus au même rythme. La file montait sans limite, le
retard aussi — et **revenir sur l'onglet ne pouvait rien rattraper**, puisqu'on
le nourrissait plus vite qu'il ne pourra jamais avaler.

> Le décodeur existe pour alimenter l'écran. Quand l'écran cesse de demander,
> continuer à le nourrir n'est pas du travail gaspillé : c'est ce qui rend le
> retour impossible.

Le signal n'est pas `document.hidden` mais **le battement du rafraîchissement
lui-même** : rien peint depuis 250 ms, on ne décode plus. Ça couvre aussi une
fenêtre masquée par une autre, une boucle bridée, et tout ce qui arrête un
rafraîchissement pour des raisons qui lui appartiennent. Ce qui suit un trou
étant indécodable, on reprend au prochain point de reprise — une seconde au plus.

Et le pire est que **mes deux chiens de garde du décodeur aggravaient tout** :
ils voyaient des octets arriver et rien en sortir, concluaient à un décodeur mort
et coupaient la connexion, toutes les trois secondes, derrière un onglet caché.
Du code écrit pour rattraper une panne, qui empêchait le rattrapage. Ils se
taisent maintenant quand personne ne peint — et la comparaison qui décide est
entre **ce qu'on a donné** et **ce qui est sorti**, jamais contre l'horloge : on
ne peut donc plus confondre « arrêté exprès » avec « en panne ».

### 6.36 Le test ne pouvait pas échouer sur cette machine

Premier essai : je vérifiais que la file du décodeur restait petite. Vert avec le
correctif… et **vert sans lui**. Le décodeur de cette machine est assez rapide
pour absorber, même caché, du travail dont personne ne voulait : aucune file, donc
rien à observer.

L'invariant à vérifier n'était pas le symptôme mais la règle : **ce que personne
ne peint n'est pas décodé.** Là, les deux sens sont nets — sans le correctif,
**1861 images décodées pour personne** en trente secondes ; avec, **15**.

`just browser-background` ouvre un second onglet pour pousser le premier au fond,
comme le ferait quelqu'un.

Vérifié enfin sur le Mac lui-même, page corrigée, onglet caché : `shown 0`,
`file 0`, aucune reconnexion, aucun redémarrage de décodeur. Ce qui reste non
mesuré chez lui, et il faut le dire : le rendu **visible** en 1280×960 à 60
images par seconde. Une fenêtre visible, ça ne se pilote pas à distance.

### 6.37 Le gel qui n'en était pas un : une salle pleine de fantômes

Les chiffres envoyés depuis son Mac étaient **sains** : 59,9 images reçues, 53,1
peintes, file du décodeur à zéro, aucune reprise. Un flux qui peint cinquante-
trois images par seconde ne peut pas paraître figé — sauf si les images sont
identiques. Sauf que le débit disait le contraire : **20,5 Mbit/s**, et une image
immobile s'encode en presque rien.

Une seule ligne de ses chiffres disait la vérité : **`pad frames 0`**. Sa page
n'envoyait aucune manette. Elle n'en avait pas.

Le journal du serveur, lui, hurlait : *« a browser asked for a controller in a
full room »*, deux fois par seconde. Ce qu'il regardait n'était pas un gel :
c'était **la démo de Melee**, qu'il ne pouvait pas interrompre faute de manette.

Deux fautes à moi, et les deux le verrouillaient dehors :

1. **La salle avait une place.** Je l'avais fixée à un par prudence — un port
   servi sans joueur peut changer ce que le jeu fait. Prudence mal placée : une
   manette fantôme, c'est un jeu qui se comporte bizarrement ; une salle pleine,
   c'est un jeu auquel personne ne joue. Quatre par défaut, maintenant.
2. **Une socket morte gardait sa place pour toujours.** Deux heures plus tôt
   j'avais retiré l'échéance de lecture qui éjectait un joueur silencieux — et
   j'avais créé l'inverse : le proxy TLS garde ouverte la socket d'un navigateur
   **parti**, plus rien ne la ferme, la place n'est jamais rendue.

### 6.38 Silencieux n'est pas parti — et il faut poser la question

Les deux réponses simples sont fausses. Une échéance de lecture prend un joueur
qui n'appuie sur rien pour un joueur parti. Pas d'échéance du tout prend une
socket vide pour un joueur assis.

**Un ping tranche, parce qu'il pose la seule question qui compte.** Toutes les
cinq secondes sans nouvelles, le serveur demande ; quinze secondes sans réponse
et la place retourne à la salle.

Ce qui rend ça juste, c'est que **la pile réseau du navigateur répond au ping
sans réveiller la page**. Un onglet en arrière-plan reste donc assis — exactement
ce qu'il faut quand on meurt tôt dans une partie et qu'on va voir ailleurs — et
un onglet fermé rend sa place immédiatement, parce que sa socket se ferme.

Cette hypothèse-là ne se raisonne pas, elle se mesure, et tout le dessin en
dépend : `just browser-seats` met un vrai onglet au fond vingt-cinq secondes,
puis en ferme un.

```
en arrière-plan 25 s → "tu es le joueur 2", 0 manette déclarée partie
onglet fermé         → le port 2 rendu aussitôt
```

Les trois cas sont tenus par des tests : le joueur silencieux garde sa place, le
fantôme rend la sienne au bout de quinze secondes, l'onglet fermé la rend tout de
suite.

### 6.39 La vraie cause de tout : c'était nous depuis le début

Il faut lire cette section en sachant la fin : **le plantage de Dolphin que nous
avons passé des heures à instrumenter, le « bogue de pool de descripteurs » que
je m'apprêtais à remonter en amont, et le gel des images en boucle, sont un seul
et même défaut — et il est dans notre patch.**

#### Le symptôme qui a résisté à quatre correctifs

Les chiffres du joueur étaient parfaits : 59,9 images reçues par seconde, 53,1
peintes, file du décodeur à zéro, aucune reprise. Et l'écran montrait les mêmes
images en boucle. J'ai corrigé quatre choses réelles dans le navigateur —
socket morte, décodeur mort, onglet caché, places de manette — et le symptôme
n'a pas bougé d'un pouce, parce qu'**aucune n'était la cause**.

#### L'instrument qui mentait

Premier essai de mesure : compter les images visuellement distinctes en lisant
le canevas soixante fois par seconde. Réponse : « 4 images distinctes par
seconde ». Fausse. Lire cinq mégaoctets de pixels soixante fois par seconde
**étouffait la page qu'on mesurait**.

> Un instrument qui consomme la ressource qu'il mesure ne mesure plus rien.

#### La mesure qui a tranché

Lire les **octets bruts sur le fil**, sans aucun décodeur, sans canevas :

```
400 unités d'accès lues
  distinctes : 60
  identiques à  60 unités d'écart : 100,0 %
  identiques à 120 unités d'écart : 100,0 %
  identiques à   1, 2, 3, 30      :   0,0 %
```

Le serveur envoyait **une boucle parfaite d'une seconde**. Le navigateur était
innocent, et il l'avait toujours été. Confirmation immédiate : 749 trames de
manette, boutons compris — aucune réaction. Le jeu émulé était figé.

#### La mémoire

| | VRAM | GTT | objets GPU |
|---|---|---|---|
| session figée | **8175 Mo** (carte pleine) | 5882 Mo | **86 808** |
| session neuve | 248 Mo | 203 Mo | quelques centaines |

Notre worker, dans la même mesure : 29 objets, 43 Mo. Tout était chez Dolphin.

#### L'expérience qui accuse

Dolphin **seul**, sans notre crochet, même jeu, même résolution : la VRAM monte
à 3281 Mo en cinq minutes puis reste **parfaitement plate** pendant sept minutes.

Dolphin **avec notre crochet** : +446 Mo en six minutes, par marches de 64 Mo, et
ça continue. Classe par classe : **975 objets de 3,125 Mo en cinq minutes, soit
609 Mo par minute.** Les 8 Go de la carte sont pleins en un quart d'heure.

#### Le mécanisme, dans leur code et dans le nôtre

Notre crochet appelait, à chaque image :

```cpp
static_cast<VKGfx*>(g_gfx.get())->ExecuteCommandBuffer(false, true);
```

Or `ExecuteCommandBuffer` fait deux choses qu'il faut lire ensemble :

```cpp
g_command_buffer_mgr->SubmitCommandBuffer(submit_off_thread, wait_for_completion);
StateTracker::GetInstance()->InvalidateCachedState();
```

- il soumet **sans** le troisième paramètre, `advance_to_next_frame` ;
- et il invalide l'état, donc tous les descripteurs seront **réalloués**.

Et côté Dolphin, la remise à zéro des pools n'a lieu que dans
`if (advance_to_next_frame)`. Notre soumission consommait donc un second jeu
complet de descripteurs par image **sans jamais déclencher la remise à zéro**.
Quand un pool déborde :

```cpp
VkDescriptorPool descriptor_pool = CreateDescriptorPool(DESCRIPTOR_SETS_PER_POOL);
m_descriptor_set_count += DESCRIPTOR_SETS_PER_POOL;   // ne redescend jamais
```

**Un cliquet.** Chaque débordement agrandit définitivement tous les pools
suivants. Dolphin seul déborde rarement : mémoire plate. Nous le faisions
déborder soixante fois par seconde.

Le correctif tient en trois lignes : faire de notre soumission une **vraie fin de
trame**, pour que les pools soient remis à zéro au lieu d'être multipliés.

#### Après le correctif

Même mesure, même jeu, même durée :

| | avant | après |
|---|---|---|
| croissance en 5 min | **+3240 Mo** | **+195 Mo** |
| pools de 3,1 Mo créés | 975 | **0** |
| flux : unités distinctes sur 300 | **60** | **300** |
| flux : identiques à 60 d'écart | **100 %** | **0 %** |

La classe qui fuyait a disparu, et la boucle avec elle. Ce qui reste — quelques
blocs de 64 Mo, ~34 Mo/min — est le remplissage normal du cache de textures :
c'est exactement ce que fait Dolphin seul, qui se stabilise à 3281 Mo. **Ce
plateau-là, je ne l'ai pas encore observé sur la version corrigée** ; à dix-sept
minutes la session était à 765 Mo et montait encore. À surveiller, et à dire
plutôt qu'à supposer.

#### Ce que ça remet en cause, et c'est le plus important

Toute la chaîne d'incidents de ce projet redevient une seule histoire :

| ce qu'on croyait | ce que c'était |
|---|---|
| « Dolphin épuise ses pools de descripteurs, c'est un bogue amont » | **notre soumission** faisait déborder les pools |
| le plantage, réglé par le patch 0002 « survivre à l'épuisement » | on a transformé un plantage en **gel silencieux** |
| le gel réglé par le Resizable BAR (GTT plate à 205 Mo) | on avait seulement **agrandi le réservoir** ; le cliquet continuait de tourner |
| « ça saccade, c'est le réseau / le décodeur / l'onglet » | la mémoire GPU se remplissait, le jeu s'arrêtait de progresser |

Trois « correctifs » successifs ont traité des symptômes d'un défaut que nous
avions introduit, et le dernier — le BAR — a rendu la panne **plus lente et donc
plus difficile à voir** : au lieu de planter en dix minutes, la session mourait
en une heure.

> **Quand on ajoute du code dans le moteur de quelqu'un d'autre, la première
> hypothèse pour toute anomalie de ce moteur doit être la nôtre.** J'ai fait
> l'inverse pendant des jours : j'ai instrumenté, mesuré et accusé Dolphin avec
> des preuves qui étaient toutes vraies et dont la cause était notre ligne.

Et la leçon de mesure, qui vaut pour la suite : **tous nos compteurs étaient au
vert pendant que le produit était inutilisable**. Images produites, images
jetées, latence, débit : tous justes, tous inutiles, parce qu'aucun ne répondait
à la seule question qui compte — *est-ce que l'image change ?* Le débit le
disait pourtant, à qui savait le lire : 20,5 Mbit/s **figés à la deuxième
décimale**, ce qui n'arrive jamais dans une vraie partie.

### 6.40 Une page ouverte n'est pas un joueur

L'image ne gelait plus, et plus rien ne répondait aux touches. Le tuyau était
bon : j'ai écrit `PRESS START` directement dedans et le jeu est passé de la démo
au menu « REGULAR CLASSIC ». Dolphin lisait, le jeu répondait.

Sa page, elle, affichait « la partie est complète ». Une **autre** page — un
onglet resté ouvert sur une seconde machine — tenait l'unique manette, et
envoyait **94 trames par seconde** sans que personne n'y touche : une page ouverte
émet l'état neutre à chaque rafraîchissement, qu'on joue ou non.

> « Quelqu'un tient ce port » ne dit rien sur « quelqu'un joue ». Dans une salle à
> une place, la première page ouverte confisquait la manette pour toujours.

Trois règles, et il fallait les trois :

- **le bouton** — seule une personne peut déloger une autre page. Le faire
  automatiquement ferait s'échanger la manette entre deux pages ouvertes sans
  fin ; c'est exactement comme ça que la règle « le dernier arrivé gagne » avait
  échoué sur la vidéo ;
- **la page délogée est prévenue** — un octet zéro, et elle cesse de croire
  qu'elle pilote ;
- **et elle redemande poliment**, toutes les trois secondes. Demander sans
  insister ne prend rien à personne : une page dont la salle était pleine
  récupère la manette d'elle-même dès qu'on ferme l'autre.

La place est désormais un **numéro de réclamation**, pas un drapeau : le tenant
compare le sien à celui inscrit dans la case et se retire quand ils diffèrent.
Un drapeau booléen n'aurait pas su distinguer « je tiens encore » de « on m'a
remplacé », et la page remplacée aurait rendu la place de sa remplaçante en
partant.

Deux pièges attrapés par les tests au passage :

- ma sortie de boucle sur éviction **oubliait de prévenir** la page délogée
  quand elle était inactive : elle partait par la porte du délai d'attente. Le
  test l'a vu comme une connexion fermée sans explication ;
- le premier message qu'un client Rust lit n'est pas l'éviction mais **le
  ping** — un navigateur, lui, ne montre jamais les trames de contrôle à la
  page. Le test comptait le mauvais message.

### 6.41 Cadence : l'image doit durer ce que l'émulateur lui a donné

Plus aucune saccade, et pourtant « pas fluide à 100 % » sur un écran **240 Hz**.
La cause n'est pas un manque d'images : c'est que la page peignait **dès qu'une
image était disponible**. Chaque image restait donc affichée trois, quatre ou
cinq rafraîchissements selon le hasard de son arrivée. Sur 240 Hz, une source à
60 images par seconde devrait en durer **exactement quatre**, toujours.

Chaque image porte l'instant où l'émulateur l'a produite. Elle est désormais due
à **son propre horodatage**, plus un décalage fixe posé une fois — et la page dit
combien de rafraîchissements chaque image a duré, avec ses p05 et p95, pour que
la régularité soit lisible plutôt que ressentie.

Trois versions fausses avant la bonne, et chacune enseigne quelque chose :

1. **Faire avancer une échéance de l'écart entre les images MONTRÉES.** Or cet
   écart ment dès qu'une image est jetée : une seule perte doublait l'intervalle,
   ce qui verrouillait la cadence à la moitié, ce qui faisait grossir la file, ce
   qui en jetait davantage. *Un horodatage ne se déduit pas de ses voisins.*
2. **Ancrer sans marge** — « la première est due à l'instant où on la montre ».
   Toute image arrivant une milliseconde en retard était alors déjà en retard :
   491 jetées en quatorze secondes, 27 images peintes par seconde sur 60. *Le
   tampon existe précisément pour être la marge autour de laquelle l'horaire est
   écrit.*
3. **Laisser la file à `target + 1`.** Elle jetait la plus ancienne pour faire de
   la place, donc la tête était toujours une image dont l'heure n'était pas
   venue : **zéro image peinte**, 897 jetées, et tous les autres compteurs au
   vert. *La file est une soupape de sécurité ; c'est l'horaire qui règle la
   cadence.*

Vérifié à 60 Hz : `1 1 1` rafraîchissement, zéro famine, zéro jetée. À 76 Hz —
le maximum que ce Chrome sans écran accepte — l'alternance `1 1 2` est celle
qu'impose l'arithmétique, pas un défaut. **Le 240 Hz ne se simule pas ici** : le
verdict viendra de la ligne `picture held` sur l'écran du joueur, qui doit lire 4
avec p05 et p95 à 4.

Coût honnête : le décalage inclut une image de marge, soit **+16,7 ms** de
latence par rapport à « montrer dès que possible ».

### 6.42 Le nom qui a mordu trois fois

`held` est l'ensemble des touches enfoncées. J'ai appelé une deuxième variable
`held` — un module qui déclare deux fois le même nom **ne s'exécute pas du tout**,
et la page ressemble alors à une page qui attend. Renommée, sauf que la renommée
n'a corrigé que la première moitié du fichier : la ligne de statistiques appelait
encore `percentile(held, …)`, un `Set` n'a pas de `.length`, et la mesure
affichait **0** en toute confiance.

> Une valeur fausse qui a l'air plausible coûte plus cher qu'une erreur.

### 6.43 La manette n'était câblée qu'à moitié

Sept boutons sur seize, et pas les bons. Ce qui manquait : **la croix
directionnelle** (aucune), **le stick C** (les deux octets partaient à zéro), les
**gâchettes analogiques** (seul le clavier les remplissait) — et `Z` était sur la
gâchette gauche, là où aucune main de joueur GameCube ne va le chercher.

La disposition « standard » du W3C est ce que le navigateur rapporte pour toute
manette de forme Xbox ou PlayStation :

```
0 A · 1 B · 2 X · 3 Y     les quatre boutons de face, aux mêmes places
4 LB → L cliqué           un bumper est une pression franche, pas un dosage
5 RB → Z                  là où le pouce trouve Z sur une vraie manette
6 LT · 7 RT → L, R        analogiques, et qui CLIQUENT en fin de course
9 Start · 12..15 croix
axes 0,1 stick principal · 2,3 stick C
```

Le test nourrit une manette **synthétique**, bouton par bouton, et compare aux
bits que le protocole définit — parce qu'un câblage est faux précisément sur le
bouton auquel personne n'a pensé. Cassé exprès en remettant l'ancien : cinq
défauts nommés d'un coup, dont les quatre directions.

Et parce que « les boutons sont mal mis » est insoluble sans savoir **ce que la
manette a rapporté**, la page affiche maintenant son identifiant, sa disposition,
et ce qu'elle voit appuyé en direct. Une vraie manette GameCube sur adaptateur
se présente en disposition *inconnue* : ses indices ne sont pas ceux-là, et il
faudra un profil à part — que ce relevé permettra d'écrire en une fois au lieu de
le deviner.

### 6.44 Une vraie manette GameCube : la page l'apprend au lieu de la deviner

Sur adaptateur officiel, une manette GameCube annonce une **disposition
inconnue** : ses boutons sont à des index qui n'appartiennent qu'à elle, et ses
gâchettes ne sont pas des boutons mais des **axes**. Le prochain adaptateur aura
d'autres index encore.

Deux réponses possibles : une table d'adaptateurs — fausse pour celui que
personne n'a testé — ou **demander**. La page demande : elle réclame chaque
bouton l'un après l'autre et retient **ce qui a bougé**, sans savoir ni avoir à
savoir s'il s'agit d'un bouton ou d'un axe.

Trois détails font que ça marche pour de vrai :

- **le plus grand mouvement gagne.** Une gâchette GameCube bouge son axe *et*
  clique un bouton ; c'est l'axe qu'il faut garder, sinon on perd le dosage ;
- **la position de repos est enregistrée.** Un axe de gâchette repose à −1 et va
  à +1 : sans le repos, la mi-course se lit 0 au lieu de 128. Le test le casse
  exprès et l'attrape ;
- **on demande « à droite » et « en haut »**, donc le sens que le joueur vient de
  pousser EST le sens positif. Un axe inversé se règle sans qu'on ait à savoir
  qu'il l'était.

Le profil est retenu par machine et par manette, et l'apprentissage fonctionne
même sans manette attribuée — quelqu'un dont la salle est pleine doit pouvoir
régler son matériel plutôt que d'attendre. Les pressions qui répondent aux
questions ne partent jamais vers le jeu.

### 6.45 Le relâchement répondait à la question suivante

Premier essai de l'apprentissage, trouvé par le joueur en trois secondes : un
appui sur A faisait passer le compteur de **1 à 3**.

La cause tient en une ligne : je reprenais l'échantillon de repos **après chaque
réponse**, et je le prenais pendant que le bouton était encore enfoncé. Comme la
détection compare une distance **en valeur absolue** au repos, lâcher le bouton
s'éloignait exactement autant que l'avoir appuyé — et répondait donc à la
question d'après.

> Un repos mesuré pendant qu'on appuie n'est pas un repos.

L'échantillon neutre est maintenant pris **une seule fois**, au début, et la
question suivante n'est posée qu'une fois la manette revenue à ce neutre — la
page affiche « relâche… » entre deux questions.

Le test nourrit une manette synthétique **image par image** : appui, maintien,
relâchement, puis le bouton suivant. C'est un test de **séquence**, parce que le
défaut est une séquence — aucun instantané ne l'aurait montré. Cassé exprès :
cinq étapes sautées sur cinq.

### 6.46 La marge d'affichage se paie à la manette

« Je sens un peu de latence que je n'avais pas avant » — et il avait raison, le
coupable était l'horaire d'affichage de la veille. Je l'avais écrit dans le
commit (« coût honnête : +16,7 ms »), mais le vrai défaut n'était pas la marge :
c'était qu'elle **ne redescendait jamais**.

Pire : l'ancrage était pris sur la **toute première image**, c'est-à-dire
l'image-clé — la plus grosse et la plus lente du flux. Tout le reste de la
session héritait de sa malchance. Mesuré : **50,9 ms** de retenue.

La marge est maintenant **asservie** :

- l'horaire vise « le plus rapide que ce tuyau ait fait, plus la marge », le
  minimum étant relevé en continu sur les quatre dernières secondes ;
- il s'en approche de **5 ms toutes les deux secondes** — un cinquième de
  rafraîchissement, invisible — donc une mauvaise première image est effacée en
  une demi-minute au lieu de durer toute la partie ;
- la marge **grandit de 8 ms d'un coup** quand l'image manque deux fois en deux
  secondes, et se rogne de 2 ms par fenêtre calme. On paie ce que le réseau du
  moment exige, et rien de plus.

| | avant | après (90 s) |
|---|---|---|
| retenue p50 | **50,9 ms** | **4,1 ms** |
| marge | 16,7 ms figés | 3 ms, ajustée |
| cadence | 1 1 1 | 1 1 1 |
| images peintes | 59,8 /s | 59,9 /s |

Une précision que le chiffre brut ne dit pas : par le proxy Tailscale, la
« retenue » remonte à 38 ms — et **ce n'est pas de la latence ajoutée**. Les
images arrivent par rafales ; celles qui arrivent en avance attendent leur tour,
mais l'âge de l'image à l'écran reste « le plus rapide observé + la marge ». La
ligne s'appelle donc **lissage des rafales**, et la latence ajoutée est la marge
seule. Un compteur mal nommé aurait fait chercher un défaut là où il n'y en a
pas.

### 6.47 Mesurer d'abord : l'attente du GPU ne coûtait rien

Notre crochet bloque le fil d'émulation de Dolphin à chaque image, le temps que
le GPU finisse d'écrire. Le commentaire du patch le dit depuis le début : « c'est
un point de synchronisation par image, mesurez avant de le remplacer ». Le
remplacer voulait dire exporter un verrou vers le worker, un chantier de plusieurs
jours.

Premier contrôle, le moins cher : le même jeu, sans notre crochet.

```
avec export  : dolphin 46,0 %CPU · GPU médian 4 %
sans export  : dolphin 19,5 %CPU · GPU médian 0 %
```

Vingt-six points d'écart. J'ai failli m'arrêter là et lancer le chantier.

Le contrôle était faux, et sa propre mesure le disait : **GPU médian 0 %**. Un
émulateur qui rend vraiment un jeu ne laisse pas le GPU à zéro. Le Dolphin isolé
était arrêté sur un écran, pas en train de jouer, et je comparais un jeu en cours
à une image fixe.

L'expérience juste ne change qu'une chose : la même image, le même worker, la
même scène, mais sans l'attente.

```
avec attente : dolphin 49,6 à 53,6 %CPU · 59,91 img/s · 0 jetée
sans attente : dolphin 51,9   %CPU · 59,92 img/s · 0 jetée
```

Rien. Ce qui est évident après coup : **attendre un verrou ne consomme pas de
CPU**, ça bloque un fil. Et le fil bloqué garde quand même ses 60 images par
seconde, donc l'attente ne coûte pas non plus du rythme. Elle ne coûte que de la
marge, dont il reste beaucoup.

Le chantier n'a pas lieu d'être. Une mesure de vingt minutes a évité plusieurs
jours de travail pour un gain nul.

> Un contrôle qui donne un écart énorme mérite plus de méfiance qu'un contrôle
> qui n'en donne aucun. Le premier réflexe doit être : *qu'est-ce qui, dans mon
> montage, pourrait fabriquer cet écart tout seul ?*

### 6.48 Deux structures relues, dont une qui mentait

La skill `choose-data-structures` demande de partir des opérations réelles, pas
des habitudes. Deux trouvailles, et la plus grave n'est pas celle qui coûte du
temps machine.

**La page appariait les images décodées par position.** Un tableau, `push` au
décodage, `shift` à la sortie. Le jour où le décodeur ne rend pas une image, ou
en rend une de plus, tout l'appariement est décalé d'un cran **pour le reste de
la session** : la latence mesurée porte sur la mauvaise image, et surtout
l'horodatage qui pilote l'horaire d'affichage aussi. Or l'image décodée **porte
déjà sa clé** : `timestamp` est l'instant de capture qu'on a mis sur le morceau.
Un `Map` indexé par cette clé ne peut pas se décaler, et une entrée manquante
coûte une mesure de latence au lieu de corrompre tout ce qui suit. Le tableau
disparaît, et avec lui sa croissance sans borne.

**La diffusion copiait ce que son commentaire disait partager.** La ligne
promettait « une seule mise en trame, partagée : quatre spectateurs ne doivent
pas coûter quatre copies » — et le fil qui sert chaque spectateur appelait
`(*message).clone()` sur un `Arc<Vec<u8>>`, ce qui copie toute l'image. Quatre
spectateurs coûtaient bien quatre copies. Le type `Bytes` est de toute façon ce
que la socket attend, et le cloner n'est qu'un compteur de références. L'image
est copiée une fois, à la mise en trame.

Au passage, `Packet` possédait son unité d'accès, donc le worker la copiait pour
construire le paquet puis la mise en trame la recopiait. Elle est empruntée
maintenant : le tampon de l'encodeur reste valide jusqu'à l'encodage suivant, et
`send` a fini de copier avant de rendre la main.

**Ce que ça vaut, honnêtement :** trois copies par image deviennent une. À 50 Ko
et 60 images par seconde, c'est 6 Mo/s de mémoire en moins pour un spectateur.
Sur une machine qui copie à une dizaine de gigaoctets par seconde, **c'est sous
le plancher de bruit du banc** — mesuré à 4,5 % contre 4,3 % de CPU worker, soit
rien de discernable. Ce n'est donc pas une optimisation, et je ne la présente pas
comme telle : c'est un commentaire qui redevient vrai, et une diffusion dont le
coût par spectateur ne dépend plus de la taille de l'image.

Le test qui la fige compare des **pointeurs**, pas des octets : une version qui
mettrait en trame une fois par spectateur enverrait exactement les mêmes octets
et passerait.

### 6.49 Une image-clé par seconde pour personne, et deux bogues au passage

Le flux portait une image-clé toutes les secondes. Mesuré : l'image médiane pèse
8,2 Kio et la plus grosse 53,7 Kio, donc une fois par seconde une image six fois
plus lourde que ses voisines doit passer dans la même fenêtre de 16,7 ms. Sur un
lien à 20 Mbit/s, cette image seule prend 22 ms à transmettre.

Personne n'en avait besoin. Rien ne se perd en route, le flux passe sur TCP ; un
spectateur qui arrive en reçoit une, forcée pour lui.

Le premier essai, dix secondes entre deux images-clés, a cassé deux tests. Les
deux échecs valaient mieux que le changement.

**Le fil vidéo ne lisait jamais sa socket.** Il n'écrivait. Quand une page ferme
sa socket, elle envoie une trame de fermeture et attend la réponse ; personne ne
lisait, donc personne ne répondait, donc `onclose` n'arrivait jamais. **Tous les
chemins de secours qui finissent par « fermer et se reconnecter » étaient morts**,
depuis toujours — invisible parce que rien n'en dépendait tant qu'une image-clé
arrivait chaque seconde. Le fil lit maintenant, brièvement, entre deux envois.

Et la page ne doit pas faire confiance à `close()` pour aboutir : après une
seconde sans fermeture, elle abandonne la socket et en ouvre une autre.

**Une page qui a besoin d'une image-clé doit pouvoir la demander.** Un octet sur
la socket vidéo, que le fil lit maintenant de toute façon. Premier essai raté et
instructif : je demandais l'image au **début** du trou, elle arrivait pendant que
l'onglet était encore caché, et elle partait à la poubelle avec le reste. Il faut
demander quand la peinture **reprend**.

Résultat, quatre passages alternés :

| | référence (1 s) | candidat (10 s) |
|---|---|---|
| image p99 | 77,8 et 78,0 Kio | **61,4 et 57,5** |
| image max | 114,4 et 107,9 | **101,4 et 90,6** |
| débit médian | 16,84 et 16,40 Mbit/s | 17,40 et 16,50 |
| images/s | 59,93 et 59,92 | 59,93 et 59,93 |

La queue baisse de 24 % et les deux bras ne se recouvrent pas. **Le débit moyen,
lui, ne bouge pas de façon mesurable** : la scène varie plus entre deux passages
que l'effet cherché. Inconclusif, et dit comme tel.

Le gain n'est donc pas « moins de données » mais « plus de bosse toutes les
secondes ». Et la reprise est devenue plus rapide, pas plus lente : une page qui
demande obtient son image dans la trame suivante, là où elle attendait jusqu'à
une seconde.

### 6.50 Le son, par un tuyau

Il n'y avait pas de son du tout : la configuration disait « aucune sortie audio »,
parce qu'il n'y a ni carte son ni serveur de son dans le conteneur.

Le détour évident serait d'ajouter un serveur de son, ou de patcher Dolphin comme
on l'a fait pour l'image. Ni l'un ni l'autre : **ALSA sait écrire dans un
fichier**. Son greffon `file` prend les échantillons et les pose où on lui dit, et
`HOME` dans le conteneur est déjà le dossier monté — donc un `.asoundrc` posé là
est lu sans toucher à l'image ni au script de lancement.

**Le lecteur est l'horloge, et c'est le point qui compte.** L'esclave `null` ne
cadence rien : le fil audio de Dolphin tire du mixeur aussi vite que le
périphérique accepte, et un périphérique sans horloge accepte tout. Première
mesure : **8,7 Mo/s, quarante-cinq fois le temps réel**, en grande partie du
remplissage que le mixeur invente pour ses propres trous. Ce qui rend le flux
temps réel, c'est notre lecteur qui prend 48 000 trames par seconde et pas une de
plus. Le tuyau se remplit, le fil audio de Dolphin attend, exactement comme
devant une carte son.

Et j'ai perdu une demi-heure sur un débit annoncé au double, en accusant ALSA :
je lisais 1920 trames toutes les 20 ms, or 1920 trames à 48 kHz font **40 ms**.
Mon lecteur allait deux fois trop vite. Le test qui fige cette arithmétique est
le premier du module.

> Quand la mesure et la théorie divergent d'un facteur exactement rond, le
> suspect numéro un est l'instrument.

Le reste suit l'image : une route `/sound`, une liste d'auditeurs distincte de
celle des spectateurs, la même mise en trame — l'instant de capture, puis les
octets — et le même rejet plutôt que file d'attente pour qui prend du retard.

Le son voyage en **PCM brut**, 48 kHz, deux canaux, 16 bits : 1,5 Mbit/s contre
seize pour l'image. Un codec ferait mieux, et ce serait la première chose à
mesurer le jour où quelqu'un joue sur un lien mince. Ça n'en vaut pas la peine
aujourd'hui, et un décodeur de plus dans la page est un décodeur de plus qui peut
mourir.

La page **programme** les morceaux au lieu de les jouer à l'arrivée : chacun est
placé à la suite du précédent sur l'horloge du matériel audio. Même raisonnement
que pour l'image, avec une horloge moins chère. Un réglage de volume, retenu
d'une visite à l'autre, applique sa pente en dix millisecondes — un changement de
gain instantané s'entend comme un clic.

Vérifié : 998 morceaux en 20 s, **188 Kio/s pour 187,5 attendus**, amplitude
jusqu'à 19 766 sur 32 767, et la page joue 600 morceaux en douze secondes sans
une coupure. `just browser-sound`.

### 6.51 Le son en retard sur l'image : 68 ms, puis 47

Le joueur l'a entendu avant que je le mesure, et l'a estimé « peut-être 0,5 ms ».
À 0,5 ms personne n'entend rien — mais les deux flux portent **le même
horodatage serveur**, donc l'écart se calcule au lieu de se deviner.

Première mesure : **68 ms, le son en retard**. Décomposé, ce qui est tout
l'intérêt d'avoir un seul horodatage :

| | |
|---|---|
| trajet, son contre image | **−3 ms** — le son arrive même un peu plus tôt |
| avance de programmation | **40 ms** — la mienne, choisie au doigt mouillé |
| sortie audio du matériel | **32 ms** — hors de portée |

Deux termes sur trois étaient à moi. L'avance passe de 40 à 20 ms et ne
grandit plus que si le son casse vraiment, un morceau à la fois, puis redescend
d'une milliseconde par fenêtre calme — la même mécanique que la marge de l'image.
Et les morceaux passent de 20 à 10 ms : un morceau n'est envoyé qu'une fois
plein, donc sa longueur est un plancher sous le retard.

**47 ms** désormais, dont 32 de matériel. Le reste ne se rattrape pas en jouant
plus tôt, puisqu'il faudrait avoir le son plus tôt.

Il reste un choix, et c'en est un vrai : caler l'image sur le son voudrait dire
**retarder l'image** de ces 47 ms, ce qui se sent à la manette. Par défaut
l'image reste en avance ; une case à cocher propose l'autre échange à qui
regarde plutôt qu'il ne joue.

### 6.52 Un test qui comptait des morceaux

`playback` vérifiait que la page joue « 50 morceaux par seconde ». Le jour où les
morceaux sont passés à 10 ms, il est tombé — alors que le comportement qu'il
prétendait vérifier n'avait pas bougé d'un cheveu.

> Un test qui compte les unités d'une implémentation casse quand
> l'implémentation change, et se tait quand le comportement change.

Il compte maintenant des **secondes de son jouées contre des secondes
d'horloge** : 12,00 pour 12,00. Ça survit à la taille des morceaux, et ça
attraperait en plus une fréquence d'échantillonnage fausse, ce que le compte de
morceaux ne voyait pas.

### 6.53 Ce qui reste du décalage n'est pas à nous

Chez le joueur : **66 ms — trajet −2, avance 20, sortie 48**. La décomposition
répond à elle seule à la question « peut-on faire mieux » : les trois quarts sont
la latence de sortie de son matériel audio, que la page apprend par
`outputLatency` et sur laquelle elle n'a aucune prise.

Deux réglages restaient de notre côté. Le plancher de l'avance descend de 20 à
**10 ms**, et il ne remonte que si le son casse pour de bon. Et le contexte audio
demande désormais **le plus petit tampon que la plateforme accepte**, avec un
nombre plutôt que le mot « interactif ».

Un choix a été écarté au passage, et il mérite d'être noté parce qu'il paraissait
gratuit : prendre la fréquence du périphérique plutôt que d'imposer 48 kHz a fait
tomber le total à 45 ms ici. Sauf que ça déplace le rééchantillonnage **dans
chaque morceau** — cent frontières de rééchantillonneur par seconde — et je ne
peux pas juger d'ici si ça grésille. La fréquence du périphérique est donc prise
**quand elle est déjà la nôtre**, c'est-à-dire quand elle ne coûte rien, et
l'ancien comportement est gardé sinon.

> Une mesure qui s'améliore n'est pas une preuve que rien ne s'est dégradé
> ailleurs. Ici l'ailleurs était inaudible depuis cette machine, donc non
> vérifiable, donc non pris.

Sauf qu'un choix qu'une machine ne peut pas trancher, une **oreille** le peut. La
page propose donc les deux, avec une case à cocher, le changement se faisant à
chaud et sans coupure : 48,0 kHz imposés d'un côté, la fréquence de la carte son
de l'autre, et la ligne d'écart qui se met à jour sous les yeux. Le réglage est
retenu d'une visite à l'autre.

C'est la bonne forme pour ce genre de question. Plutôt que de choisir à la place
du joueur sur la foi d'un chiffre mesuré ailleurs, on lui donne les deux et le
chiffre.

### 6.54 Une commande qui obéit en vingt secondes est une commande morte

« Caler l'image sur le son ne change rien », et il avait raison de le croire :
l'alignement passait par le pilote qui déplace l'horaire d'affichage de **5 ms
toutes les deux secondes**. Pour cinquante millisecondes, il lui fallait vingt
secondes. On coche, rien ne bouge, on décoche.

Cette lenteur est juste pour ce à quoi elle sert — suivre un réseau sans que
personne ne voie l'image bouger. Elle est fausse pour répondre à un clic.

> Une commande doit obéir à la vitesse de la personne, pas à celle du phénomène
> qu'elle règle.

Le décalage s'applique d'un coup maintenant : l'image se fige une fois, de la
durée exacte demandée. `just browser-lipsync` vérifie les deux sens en une
seconde et demie.

Le test a échoué à sa première version, sur une tolérance de 5 ms entre l'aller
et le retour. Les deux ne peuvent pas être égaux : le pilote continue de corriger
pendant la mesure. Exiger l'égalité, c'était exiger que le reste de la page
s'arrête.

L'autre case n'est pas cassée, elle est **sans objet** : laisser la carte son
choisir sa fréquence ne change rien sur une carte qui tourne déjà à 48 kHz, ce
qui est le cas de la plupart et ce que la ligne « son » indique. L'étiquette le
dit désormais, au lieu de promettre ce qu'elle ne peut pas tenir.

### 6.55 Ce que le décalage restant est vraiment

Chez le joueur : **48 ms de sortie dont 10 du navigateur**, parfois 56, jamais
autre chose, et **identique en HDMI et au casque filaire**. Deux valeurs
discrètes indépendantes du périphérique : ce n'est donc pas la carte son, c'est
le mélangeur du système et le tampon que Chrome négocie avec lui.

Ce qui répond à la question posée : un Dolphin lancé directement sur cette
machine paierait la part système, pas celle du navigateur, et pourrait demander
un tampon plus court. Mais la comparaison trompe dans l'autre sens — **sur un
Dolphin local, l'image est en retard aussi**, d'une à trois trames de
synchronisation verticale. Les deux chemins sont longs, donc ils se ressemblent,
donc personne ne remarque rien.

Chez nous l'image est présentée dès qu'elle peut l'être, avec 3 ms de marge. Le
décalage qu'on entend n'est pas du son en retard : **c'est de l'image en avance**.

### 6.56 Audit complet : trois façons d'abîmer la salle sans authentification

Revue de tout ce qui a été écrit, avec les skills sécurité, qualité de test,
banc d'essai et structures de données, et avec context7 pour ce que les
bibliothèques font vraiment par défaut. Essais locaux, brefs, non destructifs.

**Une connexion muette bloquait tout le monde.** Classer une connexion veut dire
la lire, et lire peut attendre. Ça se passait sur le fil qui accepte : une
socket ouverte sans un octet tenait la salle cinq secondes, et **trois d'entre
elles ont retardé une page de 15,7 secondes**, mesuré. Ouvrir des sockets ne
coûte rien, et les navigateurs le font déjà par accident avec leurs connexions
spéculatives. Chaque connexion part maintenant sur son fil avant d'être classée.

Ce qui déplace le problème plutôt que de l'ouvrir : un fil par connexion est
aussi quelque chose qu'un inconnu peut réclamer. Plafond à soixante-quatre en
vol ; quatre joueurs en tiennent douze.

**Un octet valait une image-clé, sans limite.** Une image-clé pèse cinq à six
fois une image ordinaire et part vers tous les spectateurs. Un client envoyant
cet octet toutes les deux millisecondes a fait passer l'image moyenne de 40,3 à
56,3 Kio **pour tout le monde** — et c'était sur une scène chargée, où le rapport
est au plus bas. Une demande est honorée au plus toutes les 500 ms.

**Les défauts de tungstenite, jamais touchés.** 64 Mio par message, 16 Mio par
trame, un tampon de lecture de 128 Kio alloué pour chaque connexion, et aucun
plafond sur le tampon d'écriture. Le plus gros message qu'une page nous envoie
fait treize octets. Les sockets sont configurées : 4 Kio en entrée, 4 Mio de
tampon d'écriture au maximum.

Ce que la revue **n'a pas** trouvé, et qui vaut d'être dit : aucune panique
possible hors tests (le lint du dépôt le garantit et la vérification le
confirme), aucune structure à croissance non bornée, aucune alerte de
dépendance.

Et ce qui reste, accepté plutôt que corrigé : **rien n'authentifie personne**.
Quiconque atteint le tailnet peut regarder, écouter et prendre la manette. C'est
le M4, et c'est de loin le plus gros risque du système. `ufw` refuse les entrées
par défaut, vérifié, donc l'exposition est le tailnet et non le réseau local.

### 6.57 Les chiffres sous l'image obligeaient à défiler

Le panneau de mesures s'écrivait sous la vidéo. Sur un écran d'ordinateur
portable, il fallait donc défiler pour lire la latence — c'est-à-dire quitter des
yeux le jeu pour lire les chiffres qui décrivent le jeu. Signalé par le joueur,
pas par un test.

Il est passé à droite, en colonne. Le point qui vaut d'être noté est ailleurs :
**« sans défilement » ne veut rien dire sans une largeur.** Le test énumère donc
quatre tailles de fenêtre réelles, dont celle du portable qui a soulevé le
problème, et vérifie pour chacune que le panneau est bien à droite de l'image et
que son bas tient dans la fenêtre.

> Une exigence d'affichage qui ne nomme pas ses dimensions n'est pas vérifiable.

---

### 6.58 Quatre joueurs, et la façade de la console

La salle passe à quatre places. Le câblage existait et était testé depuis
plusieurs jours ; ce qui manquait était de **voir** la salle.

Une page ne savait que son propre port. Elle ne pouvait donc pas distinguer une
prise libre d'une prise occupée par quelqu'un d'autre, et « prendre la manette »
ne pouvait viser que le port 1. Deux ajouts au protocole, six octets en tout :

```
octet 0   combien de ports cette salle sert
octet 1   lequel est le tien, 0 si aucun
2 à 5     occupé ou libre, un octet par port
```

Le message part à la connexion **et chaque fois que la salle change**. Remarqué
plutôt que diffusé : le fil d'entrée se réveille déjà à chaque trame de manette,
soixante fois par seconde pour qui joue, et sur son ping sinon. Aucun canal,
aucune diffusion, et une page qui dessine quatre prises les voit se remplir.

Et `/input?take=3` demande **ce port-là**, occupé ou non. Deux joueurs qui
veulent être P1 et P3 ne peuvent pas y arriver en arrivant dans le bon ordre.

#### Le dessin

Quatre prises de manette GameCube : une ouverture deux fois plus large que haute,
plate en bas, bombée en haut, avec le bloc de broches dedans et le numéro
dessous. Trois états qui se distinguent d'un coup d'œil : **vide** montre ses
broches dans un trou noir, **occupée** est bouchée par une fiche grise qui les
cache, **la tienne** est la même fiche dans la couleur du joueur avec tout le
bandeau allumé.

Rien n'est coloré sur la vraie console — les quatre prises sont du même plastique
noir — mais tous les jeux qui ont posé la question « lequel es-tu » ont répondu
en rouge, bleu, jaune, vert. C'est ce qu'un joueur reconnaît, donc c'est ce qui
est dessiné.

Cliquer une prise s'y branche. Ce sont des `<button>`, pas des images : ce qui se
clique doit s'atteindre au clavier aussi.

#### Ce que les essais ont refusé de tester

Deux essais de bout en bout ne peuvent pas jouer leur scénario quand quelqu'un
occupe déjà la salle — ils vérifient que N navigateurs obtiennent N ports **dans
l'ordre d'arrivée**, ce qui demande une salle vide. Ils annoncent maintenant
« RIEN TESTÉ » au lieu d'échouer.

> Un test qui échoue pour une raison qui n'est pas un défaut apprend à celui qui
> le lit à ignorer ses échecs.

Un troisième s'est mis à pendre indéfiniment : il lisait la socket en attendant
une mise à jour, et quand j'ai désactivé la mise à jour exprès pour vérifier
qu'il pouvait échouer, il a avalé des pings pour l'éternité. Un test qui pend ne
dit rien du tout. Il a maintenant une échéance.

### 6.59 Prendre une prise à quelqu'un, et ce que ça lui fait

Le vol de prise est voulu — sinon un fantôme garde un port pour toujours. Ce qui
arrivait **à l'autre joueur** ne l'était pas.

Sa page se voyait retirer le port, puis, trois secondes plus tard, reprenait
poliment le premier port libre. Il se retrouvait à piloter un autre personnage
sans que rien ne le lui dise. Le joueur l'a vu avant moi.

La cause : une page refusée et une page **délogée** suivaient le même chemin.
Elles ne se ressemblent pourtant pas. Une page refusée n'a jamais rien eu et a
raison de redemander poliment ; une page délogée avait un port, on le lui a pris,
et se rebrancher ailleurs de sa propre initiative est la dernière chose qu'elle
doive faire.

> Deux situations qui se ressemblent dans le code ne se ressemblent pas pour la
> personne devant l'écran. C'est elle qui décide s'il s'agit du même cas.

La page délogée s'arrête donc, le dit en rouge, et attend un clic. Et prendre une
prise occupée demande **deux clics** : le premier arme la prise, qui affiche
« PRENDRE ? » en orange pendant quatre secondes. Interrompre la partie de
quelqu'un mérite d'être délibéré.

Le test qui fige tout ça n'exige pas une salle vide, seulement **un port libre** :
il prend le port qu'on lui donne, quel qu'il soit, et vole celui-là. La première
version demandait le port 1 et refusait de tourner pendant qu'on jouait à côté.

### 6.60 Quelle langue pour la suite, et la question mal posée

Fin de M3, la question arrive : le serveur qui gérera les comptes et les salles,
en Python avec FastAPI, ou en Go, ou tout en Rust ? Avec la vraie raison derrière,
qui est honnête : « je suis plus à l'aise en Python, mais si c'est plus rapide
ailleurs, autant le faire ailleurs. »

**La question mélange deux choses qui portent le même nom.** Il y a deux sortes
de WebSocket dans ce système, et elles n'ont rien en commun sauf le mot.

| | ce qu'elle transporte | son rythme | ce qui se passe si elle rate |
|---|---|---|---|
| celle du worker | des images encodées, l'état de la manette | 60 fois par seconde, chaque milliseconde compte | l'image saute, le jeu répond en retard |
| celle du salon | qui vient d'arriver, quelles salles existent | quelques fois par minute | on voit la liste une seconde plus tard |

La première est déjà en Rust et n'en bougera pas : c'est là que vivent le GPU,
l'encodeur et les 3,3 ms entre une touche et l'image. La seconde attend un
humain qui clique. **Une salle à quatre joueurs génère peut-être vingt messages
de salon par partie.** Un langage dix fois plus rapide sur vingt messages, c'est
dix fois plus rapide sur rien.

Donc : FastAPI, et sans culpabilité. Le raisonnement en une phrase — le langage
du chemin critique se choisit sur la latence, celui du reste se choisit sur la
vitesse à laquelle on écrit du code juste. C'est déjà ce que dit D2 ; la question
a simplement montré que D2 ne le disait pas assez clairement, alors il a été
précisé.

**Go est écarté, et pour une raison qui n'est pas la performance.** Il ferait un
troisième langage à installer, à tester et à déployer, en échange d'un gain qui
ne se mesurerait pas à ce débit. Deux langages avec une frontière nette valent
mieux que trois avec une frontière floue.

**Ce qui les relie :** le serveur Python ne parle jamais au worker pendant une
partie. Il signe un jeton, le navigateur le présente au worker, le worker le
vérifie. Aucune image, aucun appui de bouton ne traverse Python. C'est aussi ce
qui bouche le trou d'authentification, ce qui fait de M4 deux choses en une.

---

### 6.61 Le carnet devient un site, et le mode strict trouve deux liens morts

Ce document fait 2800 lignes. Sur GitHub, c'est une page sans fin, sans table des
matières et sans recherche — la mauvaise forme pour un texte dont tout l'intérêt
est qu'on puisse retrouver le passage qu'on cherche.

Il est maintenant construit par **Zensical**, le générateur de site de l'équipe
de Material for MkDocs, et servi sur le réseau privé. Trois choix méritent d'être
écrits :

**Une seule copie.** Le site est bâti depuis `docs/`, les fichiers que le dépôt
tient déjà. Il n'existe nulle part une seconde version d'un document qui pourrait
être à jour d'un côté et périmée de l'autre. `site/` est ignoré par git pour la
même raison.

**Servi depuis le tailnet, pas depuis internet.** `tailscale serve` partage à
l'intérieur du réseau privé ; `tailscale funnel` aurait publié sur internet. Ce
document nomme des machines internes et dit en clair que le serveur de jeu n'a
aucune authentification. Il reste donc là où le lecteur a déjà été invité. Le
port est 8444 parce que 8443 est le jeu.

**Le mode strict est la raison d'être de la recette**, pas un ornement. Il fait
échouer la construction sur un lien ou une ancre qui ne mène nulle part. Il en a
trouvé deux à son premier passage, dans une page écrite le même après-midi : les
accents disparaissent des ancres générées, donc `#9-où-on-en-est` n'existe pas,
c'est `#9-ou-on-en-est`. Personne ne l'aurait vu avant qu'un lecteur ne clique.

> Renommer une section est une chose normale à faire. Ce qui ne l'est pas, c'est
> que tous les liens vers elle meurent en silence.

C'est pourquoi `just docs` est maintenant une étape de CI. Elle ne demande ni GPU
ni Rust et prend quelques secondes : la prose est vérifiée comme le code, et la
règle qui dit que le carnet fait partie du travail cesse d'être une promesse pour
devenir une porte.

**Au passage, une échéance qui n'attendait pas.** La pipeline avertissait que
trois actions tournent encore sur Node 20. GitHub le retire de ses machines le
**16 septembre 2026**, sans échappatoire : ces trois-là auraient cessé de
fonctionner, dont le scan de secrets. Les trois sont montées de version, et
chacune ne change que son moteur. Une seule chose mérite d'être retenue :
`setup-uv` ne publie plus de tag majeur flottant depuis sa v8, donc il est
épinglé à une version exacte là où les autres suivent leur majeure. Écrire
`@v10` en croyant faire propre pointerait vers rien du tout.

---

### 6.62 Audit du cœur avant M4 : trois choses qui ne marchaient pas

Avant d'ouvrir le chantier des comptes et des salles, une relecture complète des
12 900 lignes de Rust, des dépendances et de l'outillage. Trois défauts réels, et
aucun n'était visible depuis les tests.

#### Le worker ne pouvait pas s'arrêter

Les deux threads de fond, la manette et le son, sortaient de leur boucle sur
`Arc::strong_count(&server) == 1`, c'est-à-dire « je suis le dernier à tenir le
serveur ». La fin de partie lâche la référence principale, le compte tombe à…
**deux**, parce que les deux threads en tiennent chacun une. Chacun attend donc
que l'autre parte, et aucun ne part. Le `join` qui suit ne revient jamais, et
`session.shutdown()` n'est jamais atteint : le processus reste en vie avec
Dolphin derrière lui, et systemd, qui voit un processus vivant, ne redémarre
rien. **La salle meurt sans que rien ne la relève.**

Le plus instructif est la datation. L'idiome était **juste le jour où il a été
écrit** : le thread manette était alors le seul détenteur supplémentaire, le
compte tombait bien à un. C'est l'ajout du son, deux semaines plus tard, qui l'a
rendu insatisfiable — sans toucher à cette ligne, sans qu'aucun test change de
couleur.

> Une condition qui compte « combien sommes-nous » ne peut pas exprimer « nous
> avons fini ». Elle donne la bonne réponse tant qu'il n'y en a qu'un, et se tait
> le jour où il y en a deux.

Vérifié par exécution avant d'être affirmé : un programme de vingt lignes
reproduisant la forme se fait tuer par le `timeout`, code 124. Le correctif est
un drapeau partagé, et le test qui le fige **rend compte par un canal avec une
échéance plutôt que par un `join`** — parce qu'un `join` sur un thread qui ne
sort jamais n'échoue pas, il pend, et un test qui pend ne dit rien. Avec
l'ancienne condition remise, il échoue en deux secondes.

#### `just miri` ne pouvait rien trouver, et ne tournait pas

La recette visait `nel3ab-protocol`. Ce crate porte `#![forbid(unsafe_code)]` :
il n'y a, par construction, aucun comportement indéfini à nous y trouver. Les 94
blocs `unsafe` du projet vivent tous dans `nel3ab-encoder`.

Et elle était **rouge** de toute façon : proptest appelle `getcwd` pour ranger
ses graines d'échec, ce que l'isolation de Miri refuse. Le nightly n'était même
pas installé sur la machine, ce qui date assez bien la dernière exécution.

Pointée sur le bon crate, avec l'isolation coupée et les tests à socket Unix
écartés — Miri n'implémente que AF_INET et AF_INET6 — elle exécute 25 tests en
trois secondes : l'écrivain de flux H.264 et les analyseurs de protocole,
c'est-à-dire exactement l'arithmétique de pointeurs et de tranches où une erreur
serait la nôtre. Tous verts.

> Une vérification qui ne peut rien trouver et qui ne tourne pas est pire que
> pas de vérification : elle occupe la place de celle qui aurait servi.

#### N'importe quel site web peut regarder la partie

Le plus sérieux, et il n'est pas encore corrigé. Le serveur n'examine pas
l'en-tête **Origin** de la poignée de main WebSocket. Or une WebSocket n'est pas
soumise à la politique de même origine : une page ouverte dans un autre onglet
peut ouvrir une connexion vers notre salle et **lire ce qu'elle renvoie**.

Démontré sur la machine, en une poignée de main brute annonçant une origine
étrangère :

```
réponse du serveur : HTTP/1.1 101 Switching Protocols
octets de vidéo reçus depuis cette origine : 32768
```

Ce qui compte ici est que **ça contourne exactement la protection sur laquelle le
projet s'appuie**. Le tailnet empêche un inconnu de se connecter lui-même ; il
n'empêche pas la page d'un inconnu d'utiliser le navigateur du joueur, qui, lui,
est sur le tailnet. Un site visité pendant une partie peut voir l'écran et, avec
`/input?take=N`, prendre une manette.

Le pare-feu ajoute une seconde porte que la documentation ne mentionnait pas :
la règle `ALLOW IN from 192.168.1.0/24` ouvre **tout le réseau local**, et le
worker écoute sur `0.0.0.0`. Le téléphone d'un invité sur le Wi-Fi atteint la
salle sans rien traverser.

#### Ce que le proxy donne déjà, et que personne n'utilisait

En mesurant ce que Tailscale transmet réellement au worker, une surprise utile :

```
Host: lgf.tail3bd01c.ts.net:8445
Origin: https://lgf.tail3bd01c.ts.net:8445
Tailscale-User-Login: souhib.t@hotmail.fr
Tailscale-User-Name: Souhib Trabelsi
```

Le proxy **authentifie déjà le pair et nous dit qui il est**. L'identité que M4
doit construire est en partie posée là, gratuitement — à une condition stricte :
un en-tête n'est digne de confiance que si l'on est sûr qu'il vient du proxy. Le
worker écoutant sur `0.0.0.0`, n'importe qui sur le réseau peut aujourd'hui le
contacter directement et écrire cet en-tête lui-même. **Écouter sur `127.0.0.1`
est donc ce qui transforme cette ligne en preuve**, et ferme du même coup la
porte du réseau local. Le coût est nul : sans TLS, le navigateur refuse déjà
l'accès à la manette, donc personne ne joue par le port direct.

---

### 6.63 Ce que le proxy coûte vraiment, et la porte refermée

L'audit laissait une question ouverte : fallait-il retirer Tailscale, soupçonné
d'ajouter de la latence, ou au contraire tout faire passer par lui ? La règle du
projet dit de mesurer, et la mesure a une jolie propriété ici : **les deux
sockets reçoivent la même image, depuis le même appel, avec le même
horodatage**. Comparer l'instant d'arrivée de l'image N sur les deux chemins est
donc un appariement, pas une comparaison de deux distributions : toute la
variance image à image disparaît, et ce qui reste est le chemin.

Plancher de bruit d'abord, deux connexions directes l'une contre l'autre :
**0,014 ms** de médiane, 0,055 au p99. Tout ce qui dépasse est un vrai signal.

| direct contre proxy | p50 | p95 | p99 |
|---|---|---|---|
| dans un sens | +0,098 ms | +0,183 ms | +0,227 ms |
| inversé | −0,082 ms | −0,037 ms | −0,011 ms |

Même grandeur, signe opposé : **le proxy coûte un dixième de milliseconde par
image**, soit 0,6 % d'une période de trame. Inversé pour écarter un biais
d'ordre, et il n'y en a pas.

L'autre moitié du chemin est le tunnel jusqu'au poste du joueur. `tailscale
ping` répond sans ambiguïté : les deux machines de jeu joignent le serveur **en
direct par le réseau local**, pas par un relais. Le PC en Ethernet répond sous la
milliseconde, cinq fois de suite. Le Mac répond en 7 ms — à comparer aux **5 à
64 ms, moyenne 14,7**, que met un simple ping ICMP vers la même machine : c'est
le Wi-Fi qui domine d'un ordre de grandeur, pas le chiffrement.

> Retirer Tailscale n'aurait rien fait gagner et aurait coûté le TLS. Or sans
> TLS le navigateur refuse l'API Gamepad : il n'y aurait plus de manette du tout.

Donc tout passe par le proxy, et le worker n'écoute plus que sur `127.0.0.1`.
Ce qui ferme d'un coup les trois portes que l'audit avait trouvées, et en ouvre
une pour M4 :

- le site tiers ne peut plus rien : la poignée de main compare `Origin` à `Host`,
  et une origine étrangère n'obtient plus de route du tout. Vérifié en rejouant
  l'attaque à l'identique — connexion fermée sans réponse en local, 502 par le
  proxy — et vérifié aussi sur `/input`, donc la manette ne se vole pas non plus ;
- le réseau local n'atteint plus le port direct ;
- et `Tailscale-User-Login` devient une **preuve** au lieu d'un en-tête que
  n'importe qui pouvait écrire, puisque seul le proxy peut désormais parler au
  worker.

La règle se configure toute seule plutôt que par une liste d'origines
autorisées : la page est servie par ce même serveur, donc son origine est
l'adresse d'où elle a été chargée. Une liste serait un endroit de plus à mettre à
jour, et l'oubli donnerait une salle où personne ne peut entrer.

Deux tests plutôt qu'un, et le second est le plus important : le premier prouve
que la fonction décide juste, **le second qu'elle est branchée**. Le premier
passerait très bien si plus personne ne l'appelait — c'est exactement la forme du
test qui ne peut pas échouer, et elle a failli être écrite ici.

---

### 6.64 Le son avait 341 ms de retard que rien ne mesurait

La question posée était simple : peut-on faire mieux sur l'audio ? La réponse
tenait dans un endroit où personne n'avait regardé, parce qu'aucun instrument ne
pointait dessus.

#### Le raisonnement qui a mené là

La configuration ALSA envoie le son de Dolphin dans un tuyau, avec un esclave
`null` : rien ne cadence l'écriture. Ce qui rend le flux temps réel, c'est que le
lecteur prend dix millisecondes toutes les dix millisecondes, le tuyau se remplit,
et Dolphin **attend**. C'était écrit et c'était juste.

Ce qui n'avait pas été tiré, c'est la conséquence. Un tuyau Linux fait 64 Kio par
défaut. À 48 kHz en stéréo 16 bits, ça fait **341 ms de son**. Le tuyau est plein
en permanence, donc chaque échantillon qu'on lit a l'âge du tuyau.

Vérifié sur la machine en marche, sans rien toucher : le fil écrivain de Dolphin
était dans `pipe_write` à chaque échantillon pris.

```
tid 1023143 : pipe_write   <-- bloqué, donc le tuyau est plein
capacité par défaut : 65536 octets = 341 ms de son
```

> **Et aucune de nos mesures ne pouvait le voir.** Un morceau est horodaté quand
> *nous* le lisons. Tout le retard se passe en amont de notre propre horloge,
> donc l'instrument mesurait fidèlement la moitié du chemin en ignorant l'autre.
> Le chapitre « Où on en est » annonçait 47 ms en toute bonne foi.

C'est le piège le plus utile de cette série : **un instrument placé après le
défaut ne mesure pas zéro, il mesure autre chose, et il a l'air en bonne santé.**

#### La correction évidente, et pourquoi elle était fausse

Premier réflexe : vider le tuyau à chaque tour et ne garder qu'un coussin. Écrit,
testé, mis en service — et démenti par la mesure en quatre minutes.

Le compteur de son jeté est monté à **80 secondes d'audio par 10 secondes
d'horloge**, ce qui dit que Dolphin produit huit fois trop vite dès qu'on cesse
de le freiner. Et le son est devenu discontinu :

| | saut à l'intérieur d'un morceau | saut à la jointure | jointures cassées |
|---|---|---|---|
| avec le vidage | 362 | **3232** | 141 / 299 |
| sans | 288 | 292 | 0 / 299 |

Autrement dit : le blocage n'était pas un effet de bord du montage, **c'était
l'horloge**. Le retirer rend la main à un émulateur qui n'a aucune raison de
tenir le rythme, et on ne joue plus qu'un huitième de ce qu'il produit.

> Avant de supprimer un blocage, demander ce qu'il retenait. Ici il retenait le
> temps.

#### Ce qui marche : garder le mécanisme, réduire le récipient

Le tuyau passe de 64 Kio à **8 Kio**, soit 42 ms. Une ligne, `F_SETPIPE_SZ`, à
l'ouverture — avant que quiconque écrive, seul moment où le noyau accepte de
rétrécir un tuyau. Le lecteur ne change pas, donc la contre-pression reste, donc
la cadence reste.

Mesuré après : son continu (292 contre 288, zéro jointure cassée), **zéro
famine**, et le tuyau ne peut plus retenir plus de 42 ms quoi qu'il arrive.

Pourquoi 8 Kio et pas 4, qui donnerait 21 ms : le tuyau est aussi ce qui absorbe
un hoquet de l'émulateur, et 42 ms couvre quatre tours de lecteur là où 21 n'en
couvre que deux. Le compteur de famine est ce qui autoriserait à descendre, et il
faudrait une observation plus longue que quarante secondes pour le dire.

**Ce qui reste honnête à dire** : je ne peux pas mesurer d'ici ce que l'oreille
entend. Ce que je peux affirmer est que le tuyau était plein à 341 ms et qu'il
est désormais borné à 42, sans rien perdre du signal. Le reste du chemin — dix
millisecondes de remplissage de morceau, dix d'avance côté page, et les 48 de
sortie système chez le joueur — est inchangé, et c'est là que se trouverait le
prochain gain, plus petit d'un ordre de grandeur.

---

### 6.65 On demandait nous-mêmes dix millisecondes de tampon au navigateur

Le tuyau réglé, il restait « un léger décalage ». Cette fois le budget a été
établi poste par poste avant de toucher à quoi que ce soit, avec un banc qui
interroge la page elle-même — parce que la sortie audio du navigateur, seul le
navigateur peut la dire.

| poste | ms | à qui |
|---|---|---|
| tuyau côté serveur | 42 | à nous, à son plancher |
| morceau attendu avant envoi | 10 | à nous |
| avance de la page | 10 | à nous |
| sortie du navigateur | 32 | pas à nous… |

Sauf que si. La page construisait son contexte audio avec
`new AudioContext({ latencyHint: 0.01 })`. Un `latencyHint` numérique est une
demande **en secondes**, et Chrome l'écoute de très près : on demandait dix
millisecondes, il rendait exactement dix millisecondes de `baseLatency` — et
trente-deux de sortie totale.

En demandant **zéro**, c'est-à-dire « aussi bas que tu peux » :

| | écart son/image | sortie navigateur | coupures / 90 s |
|---|---|---|---|
| `latencyHint: 0.01` | 30 ms | 32,0 (dont 10 à la page) | 1 sur 8989 |
| `latencyHint: 0` | **7 ms** | **8,0 (dont 2,7)** | 1 sur 8987 |

**Vingt-trois millisecondes, pour un caractère.** Et la crainte qui justifiait le
0,01 — un tampon plus court grésillerait — ne survit pas à la mesure : le même
taux de coupures, une sur presque neuf mille morceaux, dans les deux cas. Chrome
ramène de toute façon la demande à ce que la machine sait faire, donc un poste
qui ne peut pas descendre reçoit simplement ce qu'il peut.

> Un réglage prudent se vérifie comme le reste. Celui-ci coûtait plus cher que ce
> qu'il achetait, et il aurait suffi de comparer une fois pour le voir.

#### Deux pistes ouvertes puis refermées, dans le même passage

**Contraindre les périodes d'ALSA depuis notre configuration.** L'idée était
bonne : si Dolphin écrivait par plus petits morceaux, le tuyau pourrait
rétrécir. Donner au greffon `file` un esclave avec `period_size` et
`buffer_size` explicites a fait refuser le périphérique entier — 4005 morceaux
inventés, pas un seul audible. Annulé en quatre minutes.

**Descendre le tuyau à une page (21 ms).** 2891 morceaux affamés en deux minutes
et le son de nouveau discontinu. Huit kilo-octets est donc un plancher
**empirique**, et le carnet le dit ainsi : le source de Dolphin annonce des
écritures de 256 trames, qui tiendraient quatre fois dans une page, donc
l'explication évidente est fausse et la vraie n'est pas établie.

#### Où en est le budget

De 341 + 10 + 10 + 32 ≈ 390 ms au départ à **42 + 10 + 10 + 8 ≈ 70 ms**. L'écart
son/image que la page affiche est passé de 31 à 7 ms sur la machine de test.

Ce qui reste, par ordre de taille : le tuyau (42 ms, plancher empirique, et la
seule voie plus bas serait un vrai périphérique ALSA virtuel via `snd-aloop`),
le morceau (10 ms, divisible par deux au prix du double de messages), et l'avance
de la page (10 ms, qui demanderait un `AudioWorklet` à tampon circulaire pour
descendre vers 3).

---

### 6.66 La case n'était pas cassée, on lui donnait un faux chiffre

Le décalage s'entendait encore. Avant d'aller chercher des millisecondes
ailleurs, une question : **la page sait-elle seulement de combien elle est en
retard ?**

Non. Le tuyau est plein 57 fois sur 60 échantillons, donc il ajoute ses 42 ms à
tout ce qui en sort — et le morceau est horodaté quand nous le **lisons**. Le
son se déclarait donc plus frais qu'il n'était, de tout le contenu du tuyau.

Ce n'était pas qu'une inexactitude de tableau de bord. La page propose de
retarder l'image pour la caler sur le son, et elle calcule ce retard **à partir
de cet horodatage** : elle compensait sept millisecondes là où il en fallait
cinquante-quatre. La case avait l'air inerte parce qu'on lui donnait le mauvais
nombre, pas parce qu'elle ne marchait pas.

Le worker date maintenant chaque morceau de la profondeur du tuyau. Ça ne rend
rien plus rapide ; ça rend le chiffre vrai, et un chiffre vrai est ce dont la
compensation avait besoin pour valoir la peine d'être cochée.

| | avant | après |
|---|---|---|
| écart annoncé par la page | 7 ms | **54 ms** (le vrai) |
| retard appliqué par la case | 7 ms | **52,9 ms** |

> Un instrument qui se trompe ne se contente pas d'informer mal. Tout ce qui
> décide à partir de lui se trompe aussi, en silence, et on accuse le mauvais
> composant.

Le joueur a donc un vrai choix, ce qu'il n'avait pas : case décochée, la manette
est aussi vive que possible et le son suit l'image de cinquante millisecondes ;
case cochée, les deux sont alignés et la manette paie ces cinquante
millisecondes. Aucun des deux n'est meilleur dans l'absolu, et c'est exactement
pour ça que c'est une case et pas une constante.

#### Le morceau de 5 ms, essayé et refusé

Diviser le morceau par deux devait retirer cinq millisecondes. Mesuré sur 90 s :
l'écart est **monté** de 7 à 14 ms, pour deux fois plus de messages — 200 par
seconde au lieu de 100. Une amélioration théorique que la mesure contredit n'est
pas une amélioration, et le doublement du trafic se paie, lui, à coup sûr.
Annulé.

---

### 6.67 Une avance qui ne redescendait qu'à moitié

Le chiffre affiché sur le PC Windows est monté à 99 ms après le correctif
précédent. Il fallait d'abord séparer deux choses : **le son a-t-il empiré, ou le
chiffre a-t-il cessé de mentir ?** L'horodatage daté de la profondeur du tuyau
ajoute exactement 42,7 ms à l'affichage sans retarder quoi que ce soit, donc 99
aujourd'hui décrit la même réalité que 56 la veille.

Mais en cherchant ce qui pouvait, lui, avoir vraiment augmenté, un défaut de
régulation est apparu.

L'avance de la page monte de **10 ms à chaque coupure** et ne redescendait que
d'**1 ms toutes les deux secondes**. Une seule coupure coûte donc vingt secondes
de récupération. Sur un lien qui hoquette plus souvent que ça — un Wi-Fi, un
réseau chargé — l'avance **monte jusqu'à son plafond de 120 ms et y reste**,
ajoutant tout ça à la distance entre le son et l'image pour le reste de la
partie.

> Une commande qui ne monte que sur un mauvais lien ne suit pas le lien : elle se
> souvient de son pire moment.

Elle redescend maintenant d'un dixième de l'excès par fenêtre. Depuis le plafond,
ça converge en une minute au lieu de quatre, et ça ralentit en approchant du
plancher, donc une avance déjà correcte ne bouge presque pas. Le millimètre de
plancher est gardé comme pas minimal, sinon la décroissance s'arrêterait juste
au-dessus.

Mesuré sur 90 s d'un lien propre, où le défaut ne se voit pas : avance au
plancher de 10 ms, **une coupure sur 8989 morceaux**, exactement comme avant. La
correction ne coûte rien là où elle ne sert pas.

---

### 6.68 Ce que la machine du joueur dit, et le sondage qui s'est mordu la queue

La ligne renvoyée depuis le PC Windows tranche presque tout :

```
écart son/image  98 ms (trajet 40 · avance 10 · sortie 48 dont 10 du navigateur)
```

- **avance 10** : au plancher. Le cliquet corrigé juste avant n'était donc pas
  son problème, et il valait mieux le savoir que de le supposer.
- **trajet 40** : notre tuyau, cohérent avec les 32 à 35 mesurés en local.
- **sortie 48, dont 10 pour le navigateur** : Windows.

C'est ce « dont 10 » qui gênait. Sur Linux, avec la même page, la part du
navigateur est de **2,7 ms**. Dix pile, c'est exactement ce que rendait l'ancien
réglage `latencyHint: 0.01`. Deux explications, indiscernables depuis ici : ou
Windows plafonne à dix millisecondes, ou la page chargée est encore l'ancienne.

Le panneau affiche donc désormais **ce qui a été demandé à côté de ce qui a été
accordé** — « sortie 48 dont 10 du navigateur, demandé 0 ». Un instrument qui
lève une ambiguïté vaut mieux qu'un aller-retour de plus.

**Réponse du joueur : « demandé 0 ».** La page est donc bien la nouvelle, et
Windows rend dix millisecondes quand on lui en demande zéro. C'est son plancher.
Sur la même page, Linux en rend 2,7 — ce qui ferme la question plutôt que de la
laisser ouverte : la part navigateur n'est pas récupérable sur cette machine, et
il n'y a pas de réglage à chercher.

#### Le sondage automatique, essayé et retiré en un quart d'heure

L'idée semblait juste : plutôt que de supposer depuis Linux ce que Windows sait
faire, que la page **mesure elle-même**. Quatre contextes audio jetables, un par
valeur candidate, chacun démarré le temps de rendre quelque chose — la latence
n'est lisible qu'à ce moment — et on garde le meilleur.

Résultat mesuré tout de suite :

| | écart | avance | coupures |
|---|---|---|---|
| sans sondage | 50 ms | 10 ms | 1 sur 5989 |
| avec sondage | **167 ms** | **120 ms** (plafond) | **288 sur 7877** |

Créer et détruire quatre contextes juste avant d'en ouvrir un vrai perturbe la
sortie audio pour la suite de la session. **Le sondage abîmait exactement ce
qu'il venait mesurer** — le même piège que l'échantillonneur de M3 qui affamait
la page dont il comptait les images, et il aura fallu le refaire pour le
reconnaître.

> Un instrument qui touche à ce qu'il mesure doit être suspecté avant d'être cru,
> même quand c'est nous qui l'écrivons et que l'idée nous plaît.

#### Où s'arrête ce qui est à nous

Sur les 98 ms du joueur : **40 sont à nous** et tiennent au tuyau, 10 sont au
plancher, 48 appartiennent à la pile audio de Windows — qui alterne d'ailleurs
entre 48 et 56, ce qui fait osciller le total entre 98 et 107 et n'a jamais
dépendu de nous.

Le seul levier restant est donc `snd-aloop`, pour les 40. Tout le reste est
mesuré et au plancher.

---

### 6.69 snd-aloop, chiffré avant d'être entrepris

Restait un seul levier sur les 40 ms qui nous appartiennent : remplacer le tuyau
par un vrai périphérique ALSA virtuel, `snd-aloop`, qui a une horloge. Plutôt que
d'y passer une demi-journée pour voir, l'expérience a été faite **à côté de la
salle qui tourne**, en une heure, sans rien migrer.

La méthode tient en une idée : le chiffre qui décide est le tampon que Dolphin
**obtient**, parce qu'il écrit jusqu'à le remplir puis attend — donc le tampon
est la latence, exactement comme le tuyau. Or on n'a pas besoin de Dolphin pour
le connaître : il suffit de rejouer sa négociation. `AlsaSoundStream.cpp` fait
huit appels dans un ordre précis avec deux constantes ; les mêmes huit appels,
pilotés depuis Python par `ctypes` sur la `libasound` de la machine, donnent la
réponse sans compiler quoi que ce soit ni lancer un second émulateur.

| montage | tampon accordé à Dolphin | |
|---|---|---|
| le tuyau, aujourd'hui | 2048 trames | **42,7 ms** |
| bouclage tel quel | 8192 trames | **170,7 ms** |
| bouclage + `dmix` contraint | 1024 trames | **21,3 ms** |

**Le résultat par défaut est quatre fois pire que ce qu'on a.** Et la raison est
instructive : un vrai périphérique accorde à Dolphin exactement ce qu'il demande,
et il demande 8192 trames. Le tuyau, lui, ne négocie rien — il **force** un
tampon plus petit en étant petit. Ce qui passait pour un bricolage se révèle être
la seule chose qui contraignait l'émulateur.

> Un montage propre n'est pas automatiquement meilleur qu'un bricolage. Celui-ci
> imposait une limite que le montage propre laisse choisir à l'autre bout.

Contraint par `dmix`, en revanche, le bouclage descend à 21,3 ms, soit **21 ms de
moins qu'aujourd'hui**. La contrainte passe par `dmix` et pas autrement :
`period_size` n'est pas un champ accepté dans la définition d'esclave d'un
greffon `plug`, ce qui explique enfin proprement l'échec du même essai sur le
greffon `file` quelques heures plus tôt — ce n'était pas le greffon, c'était le
champ.

#### Ce que la migration coûterait, maintenant qu'on sait ce qu'elle rapporte

Vingt et une millisecondes sur les 98 du joueur, contre : un module noyau chargé
au démarrage, `/dev/snd` exposé dans le conteneur, le worker et le conteneur
ajoutés au groupe `audio` — l'expérience a dû tourner en root pour cette raison —
une couche `dmix` dans la configuration, et notre lecteur réécrit sur `alsa-lib`,
donc une dépendance de plus et des modes de panne de plus. Sans compter que rien
de tout ça n'est encore prouvé de bout en bout : la négociation dit ce que le
tampon vaut, pas si le son sort proprement à travers une horloge en jiffies.

La machine a été remise dans l'état où elle était, module retiré, salle jamais
interrompue. La décision appartient à qui la maintiendra.

---

### 6.70 Choisir son jeu depuis la page

Trois jeux sur la machine, et un seul moyen d'en changer : éditer un fichier
systemd. La page liste maintenant la bibliothèque et laisse un joueur en choisir
un autre.

#### Redémarrer plutôt que recharger, et pourquoi c'est le bon choix

Dolphin reçoit son disque en argument de démarrage. Il n'existe aucun moyen de
lui en donner un autre en cours de route, donc changer de jeu veut dire **un
nouvel émulateur** — et avec lui un nouvel anneau d'images, un nouveau
descripteur, un nouvel encodeur.

Reconstruire tout ça en place aurait créé un second chemin de démarrage à côté du
vrai, testé par personne. Le worker écrit donc son choix et **s'arrête** ;
systemd le relance en deux secondes sur le nouveau jeu, et la page se reconnecte
d'elle-même parce qu'elle sait déjà survivre à un redémarrage.

Ce qui vaut d'être noté : **cette fonctionnalité était impossible il y a deux
jours**. Le worker ne pouvait pas s'arrêter — les deux threads s'attendaient
mutuellement (6.62). Un défaut corrigé pour lui-même a rendu possible une
fonctionnalité qui n'était pas dans le tableau.

#### Une position sur le fil, un nom sur le disque

Le navigateur demande un jeu par sa **position** dans la liste, jamais par un
chemin. Une position ne peut désigner que ce que le worker a lui-même trouvé,
donc aucun client ne peut réclamer `../../etc/shadow` quelle que soit la façon
dont il l'écrit. L'état invalide est inexprimable plutôt que vérifié.

Mais le choix est **retenu par nom**, parce qu'une position n'est stable que tant
que le répertoire l'est : déposer un jeu de plus ferait redémarrer sur un autre
sans rien dire. Nom pour se souvenir, position pour transmettre, et aucun des
deux ne fait le travail de l'autre.

#### Deux clics, et ce qu'un test aurait laissé passer

Changer de jeu arrête la partie de tout le monde. Le premier clic arme donc et
affiche « QUITTER LA PARTIE ? », le second envoie — la même forme que prendre la
manette de quelqu'un, pour la même raison.

L'essai de bout en bout vérifie **la séquence, pas le résultat** :

```
après un clic : classe "game arming", jeu courant 2   <- rien n'a bougé
après confirmation : melee-ntsc -> Mario Kart Double Dash
```

Un test qui aurait seulement constaté « le jeu a changé » passerait tout aussi
bien sur une page qui bascule au premier clic. Or c'est exactement le premier
clic qui doit ne rien faire.

#### Ce que la commande a coûté au protocole

Elle voyage sur la socket de la manette, distinguée par sa **longueur** : treize
octets est une manette, deux est une commande. Sans mode, sans en-tête, sans
état — une trame de manette fait toujours exactement treize octets, jamais
presque.

Conséquence gratuite et bienvenue : **seul quelqu'un qui tient une manette peut
changer le jeu**, puisque la socket d'entrée n'existe qu'après avoir obtenu un
port. Ce que la salle joue appartient à ceux qui y jouent, et rien n'a eu à être
écrit pour que ce soit vrai.

Le type `Command` n'est délibérément pas `#[non_exhaustive]`, contrairement aux
erreurs du même fichier. Cet attribut achète une compatibilité de source pour des
crates extérieurs au workspace, et il n'y en a aucun. Ce qu'il coûterait est ce
qui vaut d'être gardé : ajouter une commande doit faire échouer la compilation
partout où l'on traite des commandes, plutôt que tomber dans un fourre-tout qui
l'ignore en silence. Le compilateur l'a d'ailleurs prouvé dans l'heure, en
refusant un `match` sur les routes qui ne connaissait pas encore `/roms`.

---

## 7. Milestone 4 — le salon, et la page qui le montre

Jusqu'ici, une salle était un worker lancé par systemd et une page HTML de
2 400 lignes compilée dans son binaire. Ça marche, et ça a permis de mesurer
tout ce qui précède. Mais il n'y avait ni nom, ni salon, ni rien qui sache dire
qui est assis où.

Ce chapitre raconte l'ajout de deux morceaux : un **plan de contrôle** en
FastAPI, et une page réécrite en React. Et surtout la règle qui les sépare, qui
est la seule décision d'architecture réelle de ce milestone.

### 7.1 La règle : le plan de contrôle ne touche jamais une image

Un « plan de contrôle » (*control plane*), c'est le service qui sait **qui est
là, quel jeu tourne, qui tient quelle manette**. Par opposition au **plan de
données** (*data plane*), qui transporte l'image, le son et les manettes.

Ici les deux sont deux processus distincts, et la frontière est nette :

| | qui répond | ce qu'il sait |
|---|---|---|
| image, son, manettes | le worker, en Rust | quelle place est **vraiment** tenue |
| bibliothèque, changement de jeu | le worker | quels jeux existent sur ce disque |
| nom du salon, noms des joueurs | le plan de contrôle, en Python | comment s'appelle celui qui tient la place 2 |

Le worker reste l'autorité sur l'occupation des places, parce que c'est lui qui
applique les boutons : il ne peut pas se tromper sur qui il écoute. Le plan de
contrôle ne connaît que les **noms**, c'est-à-dire exactement ce qu'aucune
socket binaire ne transporte.

La conséquence se vérifie et elle est le but : **arrêter le plan de contrôle
n'interrompt pas une partie**. La page garde son image, son son et sa manette,
et perd seulement les noms à côté des places. C'est écrit dans le code de la
page comme un repli explicite : si `/api/room` ne répond pas, elle interroge le
worker seul et affiche « occupée » au lieu d'un prénom.

### 7.2 Pas d'authentification, et le dire

Le projet est pour jouer entre gens qui se connaissent, sur un réseau privé. Il
n'y a donc **ni compte, ni mot de passe** : la page demande un prénom, le garde
dans le navigateur, et c'est tout. Ce prénom existe pour qu'une place puisse dire
« Souhib » plutôt que « joueur 2 ».

Ce n'est pas de la sécurité et ce n'est pas présenté comme telle. Le trou du
chapitre 10 reste entier : quiconque atteint le tailnet peut regarder, écouter et
prendre une manette. Un prénom qu'on choisit soi-même n'y change rien, et un
formulaire de connexion qui n'authentifie rien serait pire que pas de formulaire,
puisqu'il *aurait l'air* de protéger.

### 7.3 Ce qui a été repris de LaTabdhir et de Majlisna

Deux services du même auteur, déjà en production, ont servi de patron plutôt que
d'inventer des conventions pour un troisième :

- **le découpage** `routes / controllers / schemas` : une route ne contient
  aucune logique, elle appelle un contrôleur ; un schéma Pydantic décrit ce qui
  passe sur le fil. C'est la transposition exacte de la règle « pas de logique
  dans les routes » que le côté Rust écrit « pas de comportement dans le
  binaire » ;
- **une fabrique d'application** (`create_app`) plutôt qu'un objet global : un
  test peut en construire une avec ses propres réglages et son propre worker, et
  rien ne se connecte au moment de l'import ;
- **`uv` et `poe`** pour les tâches, avec `ruff`, `ty` et `pytest` derrière un
  seul `poe check`, exactement comme `just check` de ce côté-ci ;
- **socket.io** pour le salon, repris de Majlisna. Reconnexion, salles et
  diffusion sont tout le travail à cet endroit et ne valent pas d'être réécrits.
  Une différence assumée : Majlisna branche un gestionnaire Redis pour partager
  l'état entre plusieurs processus. Il y a **un** processus ici, et faire tourner
  un Redis pour un salon qui tient dans un dictionnaire serait ajouter une pièce
  à maintenir sans rien servir.

Le client TypeScript, lui, applique D6 sans changement : FastAPI écrit le
document OpenAPI depuis son propre code (`poe openapi`), et Hey API le traduit en
types. Renommer un champ côté Python fait donc échouer `tsc` côté navigateur, au
lieu d'arriver en `undefined` dans une page où plus rien ne vérifie.

Détail qui vaut sa ligne : par défaut, FastAPI nomme ses opérations d'après
l'URL, ce qui donnait `readRoomApiRoomGet` dans le client généré. Une fonction
nommée d'après un chemin change de nom quand le chemin bouge. Une ligne
(`generate_unique_id_function`) les nomme d'après la fonction Python, et
`readRoom` traverse la frontière intact.

### 7.4 React, sans mettre React sur le chemin de l'image

La demande était une page React, TypeScript et Tailwind, avec une réserve
explicite : *« si tu penses que ça va rajouter de la latence, on reste comme
ça »*. La réserve est juste. Une image arrive soixante fois par seconde, et un
rendu React entre son arrivée et l'écran, soixante fois par seconde, coûterait
exactement ce que quatre chapitres précédents ont passé à gagner.

Donc la boucle média **n'est pas dans React**. Elle est sortie de la page en
modules TypeScript ordinaires — `video.ts`, `sound.ts`, `input.ts`, `clock.ts` —
qui possèdent le canevas, décodent, ordonnancent et peignent sur
`requestAnimationFrame`, sans jamais provoquer un rendu. React ne touche cette
boucle qu'à deux moments : il lui donne le canevas au montage, il le reprend au
démontage.

Les chiffres, eux, remontent par une autre route : la session reconstruit un
**instantané** deux fois par seconde, et React s'y abonne avec
`useSyncExternalStore`. Deux fois par seconde, c'est la vitesse à laquelle un
humain lit un nombre, pas celle à laquelle il change.

Mesuré, sur une minute, pendant que le worker tournait normalement :

| | page React |
|---|---|
| images arrivées | 3 597 en 60,0 s, soit 59,9/s |
| images peintes | 3 597, soit **toutes** |
| tenue médiane à l'écran | 1 rafraîchissement (écran 60 Hz) |
| marge d'affichage | 3,0 ms |
| file d'attente du décodeur | 0 |
| reprises du décodeur, sockets muettes | 0 |

Ce que ce tableau prouve et ce qu'il ne prouve pas : il montre que **rien n'est
perdu ni retardé côté navigateur**. Il ne dit rien du serveur. La recette
`just browser-watch` existe pour ça : c'est un spectateur de plus, il ne touche à
rien, donc il peut tourner pendant que quelqu'un joue.

Le banc complet, lui, redémarre la session, et il a fini par tourner le 16 août
sur une salle libre. Chaque chiffre est comparé à **l'étendue des quatorze
passages** d'avant la page React, plutôt qu'à un seul, parce qu'un seul passage
ne dit pas ce qui varie tout seul :

| | avant React (14 passages) | avec React |
|---|---|---|
| attente d'une image p50 | 14,62 à 14,69 ms | **14,69** |
| conversion couleur p50 | 0,16 à 0,18 ms | **0,17** |
| encodage p50 | 1,79 à 1,86 ms | **1,78** |
| encodage p95 | 1,96 à 2,09 ms | **1,97** |
| entrée → image p50 | 3,06 à 10,94 ms | **3,08** |
| entrée → image p95 | 11,31 à 16,03 ms | **11,69** |
| images peintes | 5387 à 5392 | **5390** |
| images décodées | 5391 à 5394 | **5393** |
| marge d'affichage | 3 ms | **3** |
| reprises du décodeur | 0 | **0** |
| worker %CPU | 3,8 à 5,0 | **3,7** |

Tout tombe dans l'étendue d'avant. Les deux valeurs qui passent d'un cheveu sous
le minimum historique, l'encodage p50 (0,6 %) et le CPU du worker (2,6 %), sont
loin sous leurs planchers de bruit respectifs, 1,6 % et 7,9 %. **Donc : aucun
changement mesurable, ni côté navigateur ni côté serveur.** Ce n'est pas une
amélioration et il ne faut pas la lire comme telle.

### 7.5 Une page compilée dans le binaire, et la marque qui dit d'où elle vient

Le worker sert sa page avec `include_str!`, c'est-à-dire qu'elle est **dans**
l'exécutable. C'était vrai du HTML écrit à la main, et ça reste vrai du HTML
produit par Vite : un greffon (`vite-plugin-singlefile`) replie le script et les
styles dans un seul fichier, écrit directement dans l'arborescence du worker.

Le marché : `cargo build` n'a jamais besoin de node, au prix d'un artefact
committé. Et un artefact committé a exactement un mode de panne — quelqu'un
change `front/src`, ne reconstruit pas, et livre un binaire avec la page
d'hier.

La première tentative de garde-fou était la plus évidente : reconstruire et
comparer le fichier. **Elle échoue sur des sources inchangées.** Le minificateur
ne choisit pas les mêmes noms courts d'une exécution à l'autre — mesuré ici,
trois lignes sur un fichier de 350 Ko, à chaque fois une variable locale
renommée. Un contrôle rouge sans raison est un contrôle qu'on apprend à ignorer,
et ce carnet a déjà une entrée sur ce qu'il en coûte.

La marque (`front/stamp.mjs`) hache donc les **entrées** — chaque source, le
verrou de dépendances, la configuration de construction — et y ajoute le haché
de la page telle que cette construction-là l'a produite. Les deux comparaisons
sont déterministes : une source modifiée sans reconstruction est rouge, un
artefact remis en arrière tout seul est rouge, et deux constructions des mêmes
sources sont vertes.

### 7.6 Le bogue que le portage a introduit, et le test qui manquait

En transcrivant la boucle d'entrée, j'ai lu le message de place du worker comme
**un octet**. Il en fait six : `[nombre de manettes, la mienne, occupée×4]`.

Rien n'a échoué. La page se chargeait, l'image arrivait, le son marchait — et
aucune manette n'apparaissait jamais. Le code refusait poliment un message dont
la longueur ne collait pas, exactement comme il devait, et se taisait. Il a fallu
un vrai navigateur contre un vrai worker pour le voir, et une trace des sockets
pour comprendre.

La leçon est la même que celle de plusieurs entrées du chapitre suivant : **la
forme d'un message est précisément ce qu'un test unitaire peut fixer**. La
lecture est donc devenue une fonction pure, `readRoomMessage`, avec ses jumeaux
négatifs : un message trop court est refusé, un message trop long aussi, une
salle de zéro ou de cinq manettes aussi, et une place au-delà de ce que la salle
annonce aussi. Remettre la lecture d'un seul octet fait échouer le premier.

### 7.7 Ce que l'interface montre, et pourquoi elle ressemble à ça

Une consigne, tenue littéralement : *« l'image doit rester le produit »*.

L'image prend donc toute la hauteur de la fenêtre, et **la page ne défile
jamais**. Tout le reste tient dans une colonne fixe à droite qui défile en
elle-même, ce qui répond à la remarque qui l'a déclenchée : les chiffres
s'écrivaient sous l'image, et il fallait quitter le jeu des yeux pour les lire.
L'essai `just browser-layout` le vérifie à quatre largeurs, dont un portable de
1 280 points.

Le reste du parti pris tient en trois choses. Pas de dégradé, pas de verre, pas
de halo : ces effets attirent l'œil, et il y a déjà une image de jeu à l'écran
pour ça. Les nombres sont en chasse fixe et alignés à droite, avec
`font-variant-numeric: tabular-nums`, pour qu'un chiffre qui change ne déplace
pas ceux d'à côté — un instrument qui gigote est un instrument qu'on cesse de
lire. Et une seule couleur d'accent, l'indigo de la console qu'on émule.

Les mesures sont affichées en permanence, pas repliées derrière un bouton. Elles
sont ce qui a expliqué quatre blocages différents ; un panneau qu'il faut penser
à ouvrir est un panneau fermé le jour où il sert.

### 7.8 Ce que les essais de navigateur ont dû apprendre

Vingt et un scripts pilotent un vrai Chrome contre une vraie salle. Deux choses
ont changé pour eux, et les deux les rendent plus solides :

- **ils ne lisent plus le texte de la page.** Plusieurs cherchaient
  « écart son/image » dans les statistiques affichées. Un essai qui dépend d'une
  formulation casse quand on reformule, sans qu'aucun comportement n'ait bougé.
  Ils passent maintenant par l'interface de test de la page, qui rend des nombres
  ;
- **ils disent leur nom avant d'ouvrir.** La page demande un prénom, donc chaque
  pilote l'écrit là où la page le range, avant que le script de la page ne
  s'exécute. Un module partagé (`open.mjs`) le fait pour tous les vingt et un :
  quinze copies de « taper le nom, valider » seraient quinze endroits à corriger
  le jour où le formulaire change.

Une troisième correction est du même genre. L'ancienne page était un seul script,
donc son interface de test existait dès que le fichier était analysé. La nouvelle
est un module, et cette interface apparaît quand React se monte, quelques
millisecondes plus tard. Un pilote qui regardait dans cet intervalle plantait sur
`undefined` et annonçait un échec qui n'était qu'une course. La page installe
maintenant une interface qui répond zéro avant que la session n'existe : le
pilote attend, ce que chacun d'eux sait déjà faire.

### 7.9 Une porte de plus, et deux fichiers qui traînaient

`just check` fait maintenant tourner, en plus du Rust et du Python, les types,
les lints et les tests de la page, puis vérifie sa marque. Quatre gardes
au lieu de deux, dans une seule commande, qui reste exactement ce que la CI
exécute.

Et un ménage qui n'a rien de glorieux mais qui appartient au journal : des
fichiers `.pyc` et un fichier de couverture avaient été committés avec le plan de
contrôle. Ils sont retirés du suivi et ignorés. La règle qui les a laissés entrer
était l'absence de règle.

### 7.10 Un écran de salle, et pourquoi il n'y en a qu'une

Le premier jet allait du prénom au jeu sans rien entre les deux, ce qui posait la
bonne question: où est la salle ?

La réponse honnête est qu'il y en a **une**, parce qu'il y a un émulateur, sur un
GPU, sur une machine. En faire une liste d'un élément serait une page pour un
clic. Ce que l'écran apporte n'est donc pas le choix, c'est de voir la salle
avant d'y entrer: quel jeu tourne, qui est déjà là, s'il reste une manette. On
peut ainsi arriver dans une salle pleine en le sachant, au lieu de le découvrir
en cliquant.

Il apporte une seconde chose, moins visible: **rien ne démarre avant le clic**.
Ni décodeur, ni socket vidéo, ni manette. Une image décodée derrière un écran que
personne ne regarde coûte à la machine sur laquelle un autre est en train de
jouer.

Plusieurs salles, en revanche, ne sont pas un écran mais une infrastructure: un
worker par salle, un plan de contrôle qui démarre des processus (une décision de
sécurité, même sur un réseau privé), un routage par préfixe puisque tout doit
rester sur une seule origine, et une mesure qui n'existe pas encore. On sait
qu'une salle coûte un demi-cœur et 4 % de GPU; personne n'a jamais lancé deux
salles à la fois, et la mémoire de la carte ne se divise pas aussi proprement que
les cœurs.

### 7.11 Le pilote qui a rattrapé ce que le portage avait cassé

En rejouant les essais de navigateur contre la nouvelle page, `steal.mjs` a
échoué, et sa sortie disait exactement ce qui n'allait pas:

```
après deux clics : page 2 tient 2, page 1 prévenue: true
page 1 six secondes plus tard : "3"
FAIL — la page délogée s'est rebranchée toute seule
```

C'est mot pour mot le défaut que ce fichier existe pour attraper, et que le
joueur avait trouvé lui-même en M3: sa page s'était fait prendre sa manette,
avait ramassé la prise libre suivante trois secondes plus tard, et il avait
continué à conduire **un autre personnage** sans que rien à l'écran ne le dise.

Mon portage l'avait réintroduit sans y penser: la reconnexion polie, celle qui
permet à une page arrivée dans une salle pleine de récupérer une manette dès
qu'il en reste une, ne distinguait pas les deux situations. Une page qui n'a
jamais eu de place peut redemander éternellement, ça n'enlève rien à personne.
Une page **délogée** doit s'arrêter, parce que seule une personne sait quel
personnage elle voulait être.

Deux autres choses avaient disparu dans le portage et sont revenues avec:

- **le choix du port.** La nouvelle page n'avait qu'un bouton « prendre la
  manette », qui demandait toujours le port 1. Dans une salle pleine, cela veut
  dire que c'est toujours le même joueur qu'on éjecte, quel que soit celui qu'on
  visait. Les prises sont redevenues les boutons, chacune la sienne;
- **les deux clics.** Prendre la place de quelqu'un arme d'abord et n'agit qu'au
  second clic, comme changer de jeu. Rejoindre une place libre, en revanche, agit
  du premier coup: ça n'enlève rien à personne. La différence n'est pas une
  question de symétrie, c'est que l'un des deux gestes se voit sur l'écran d'un
  autre.

La leçon est celle qu'on aimerait ne pas réapprendre: **un portage est une
réécriture**. Les tests d'une page ne survivent pas parce qu'ils existent, ils
survivent parce qu'on les relance.

### 7.12 Deux pilotes qui sont devenus des tests unitaires

`padmap.mjs` conduisait un Chrome sans écran contre un worker et un GPU pour
vérifier qu'un index de bouton donne le bon bit du protocole. `lesson.mjs` en
faisait autant pour la machine à états qui apprend une manette inconnue.

Les deux vérifient des **fonctions pures**. Depuis que la boucle média est en
modules, ils sont `pad.test.ts` et `lesson.test.ts`: les mêmes assertions, en
quelques millisecondes au lieu de vingt secondes, sans GPU ni session. Ils ont en
prime supprimé trois portes de test que la page n'ouvrait que pour eux.

Ce n'est pas une règle contre les pilotes de navigateur. Ce qui reste vérifie ce
qu'aucun test unitaire ne voit: un décodeur qui meurt, un onglet passé en
arrière-plan, deux pages qui se disputent une manette.

Un détail attrapé au passage, et qui est du JavaScript plutôt que de la manette:
un axe inversé rend `-0`, que `Object.is` distingue de `0`. L'octet envoyé est le
même. L'assertion a donc été écrite en `toBeCloseTo`, parce qu'un test qui
échouerait là-dessus décrirait le langage et pas le sujet.

### 7.13 La CI testait un tiers du dépôt, sous un commentaire disant le contraire

Le fichier de CI lançait `just fmt-check`, `just lint`, `just test`, un par un,
sous ce commentaire: « les MÊMES recettes qu'en local, la pipeline ne peut pas
diverger ». Cette phrase était fausse depuis le jour où `just check` a grossi. Le
plan de contrôle en Python et la totalité de la page n'étaient couverts par rien.

Le correctif est structurel plutôt qu'attentif: la CI appelle **`just check`**,
une seule étape. Une recette ajoutée à la porte ne peut plus être oubliée là-bas,
parce qu'il n'y a plus de liste où l'oublier. Le prix est un affichage moins fin
en cas d'échec, ce qui se lit très bien dans le journal du run.

Deux découvertes de la même famille, le même jour:

- **une configuration de lint que personne ne lisait.** J'avais écrit
  `front/oxlint.json` avec les catégories `correctness` et `suspicious` en
  erreur. oxlint ne lit que `.oxlintrc.json`. Ces règles n'ont jamais tourné.
  Trouvé en lisant `oxlint --help`, qui annonce son défaut, pas en relisant le
  code. Une configuration qu'on croit active et qui ne l'est pas est pire que pas
  de configuration: elle fait croire qu'un filet existe. En les activant pour de
  vrai, une règle obsolète a sauté (`react-in-jsx-scope`, que la transformation
  JSX moderne rend caduque) et la raison est écrite à côté;
- **un formateur en `npx oxfmt@latest`** dans une vérification bloquante. Une
  version flottante dans une porte, c'est une pipeline qui devient rouge le jour
  où l'outil change d'avis, sans qu'on ait rien touché. Épinglé en dépendance.

Et une porte en plus: `just contract-check` régénère le document OpenAPI depuis
FastAPI, puis le client TypeScript depuis ce document, et échoue si l'un des deux
a dérivé. Vérifiée en rouge d'abord, en ajoutant un champ à un schéma. Elle peut
comparer octet par octet, contrairement à la page: un vidage JSON et un
générateur de code rendent les mêmes octets pour la même entrée, un minificateur
non.

### 7.14 Le prénom hors des URL, et le nombre de manettes ramené à une source

Deux incohérences dans ce qui venait d'être livré, trouvées en relisant plutôt
qu'en cassant.

`POST /api/room/seats/{port}?player=Souhib` faisait voyager le prénom **dans
l'URL**, donc dans tous les journaux entre un navigateur et ici. Le salon
socket.io, lui, le passe dans son champ `auth` précisément pour éviter ça, et le
commentaire qui l'explique est dans le fichier d'à côté. Passé en corps de
requête: ce n'est pas un secret, mais un prénom reste une personne.

Le nombre de manettes existait en trois exemplaires: le service du worker, le
service du plan de contrôle, et la page. Un seul sait: **le worker**, puisque
c'est lui qui dit à Dolphin quels ports tiennent une manette au démarrage. Il le
publie maintenant dans `/roms`, le plan de contrôle le lit, et son fichier de
service ne porte plus de second réglage qui devait être d'accord avec le premier
sans que rien ne l'y oblige.

### 7.15 Un ami qui ne pouvait pas entrer, et où la réponse était écrite

Un ami invité sur le tailnet, avec la machine `lgf` partagée, ouvrait l'adresse
de la salle et voyait charger indéfiniment. Pas une erreur, pas un refus: une
page qui tourne.

La tentation était de suspecter le partage, le certificat, ou une limite de
`tailscale serve` envers les utilisateurs externes. La documentation dit
l'inverse pour ce dernier point: un utilisateur avec qui on a partagé une machine
atteint bien un service servi par `serve`.

La réponse était dans le **filtre de paquets** que `tailscaled` applique
lui-même, lisible sur la machine sans passer par la console d'administration:

```
tailscale debug netmap   →   PacketFilter
```

Trois règles. Les appareils du propriétaire: tous les ports. Les appareils des
deux utilisateurs invités: **8444, et une poignée de ports en 47xxx et 48xxx**.
Le port de la salle, **8443, n'y est pas**. Un SYN qui n'est pas autorisé est
jeté sans réponse, et un SYN jeté sans réponse est exactement une page qui charge
pour toujours.

Les invités avaient donc accès au site de documentation (8444) et à des ports de
Sunshine, mais pas à la salle. Les ports 48100 et 48200 de la règle ressemblent
d'ailleurs beaucoup à une frappe pour 8100 et 8200, c'est-à-dire à l'intention
d'ouvrir la salle, écrite à côté.

Deux leçons. La première: **un symptôme « ça charge » nomme la couche**. Un refus
serait un port fermé, une erreur de certificat serait TLS, une erreur DNS serait
le nom. Le silence, c'est un paquet jeté. La seconde: le filtre effectif est
lisible sur la machine, ce qui vaut mieux que relire la politique d'accès en
espérant l'interpréter comme le fait le programme.

Ce que ça ouvre est aussi ce que le chapitre 10 annonce: donner 8443 à quelqu'un,
c'est lui donner la salle entière. Regarder, écouter, prendre une manette, et
**changer le jeu**, ce qui arrête la partie de tout le monde. Il n'y a rien
d'autre entre lui et ça qu'une ligne de politique d'accès.
### 7.16 Un thème clair, et pourquoi l'écran reste noir

La page était sombre parce que l'image est le produit et qu'un cadre sombre ne
lui dispute pas l'oeil. Un thème clair a été demandé, et il ne change pas ce
raisonnement: il le déplace.

Ce qui devient blanc est le **cadre**: la colonne d'instruments, les panneaux,
les bordures. Ce qui reste noir est la **zone d'écran**, y compris les bandes qui
entourent une image 4:3 dans une fenêtre large. Des bandes blanches autour d'une
image de jeu tirent l'oeil vers les bords; des bandes noires disparaissent, comme
sur n'importe quel lecteur vidéo. Le résultat est un panneau d'instrument clair
autour d'un écran noir, ce qui est aussi à quoi ressemble un vrai appareil.

Trois états et non deux: clair, sombre, et « comme le système ». Le troisième
existe parce qu'un site qui impose son thème se regarde à 2 h du matin en
plissant les yeux, et qu'un site qui suit le système sans laisser en sortir ne se
montre pas à quelqu'un dont la machine est réglée autrement. Le défaut est clair,
puisque c'est ce qui a été demandé.

Techniquement, la partie qui vaut d'être notée est `@theme inline`. Tailwind 4
fige normalement la valeur d'un jeton au moment de la construction: une classe
`bg-panel` porte alors la couleur du thème compilé, et changer un attribut sur
`<html>` ne fait rien. `inline` lui fait écrire `var(--panel)` à la place, et les
deux thèmes ne sont plus que deux jeux de variables CSS ordinaires.

Le thème est posé sur `<html>` **avant** que React se monte, dans `main.tsx`.
Sinon la page s'affiche dans l'autre couleur le temps du premier rendu, ce qui se
voit et ressemble à un défaut.

### 7.17 L'antisèche et le configurateur

Deux demandes qui n'en font qu'une: voir ce que fait chaque touche, et pouvoir la
changer, sur n'importe quelle manette. Un seul écran répond aux deux, parce que
lire « A ↔ ✕ » en se disant « non, moi je veux ▢ » et devoir aller chercher le
réglage ailleurs fait perdre du temps deux fois. Ici la ligne qu'on lit est le
bouton sur lequel on clique.

#### Nommer un bouton demande de séparer ce qu'on sait de ce qu'on suppose

Le navigateur ne donne qu'une chaîne de caractères et une position dans un
tableau. « Le bouton 2 » ne veut rien dire pour quelqu'un qui tient une
DualSense: chez lui c'est le carré. Mais deviner « carré » demande de croire un
identifiant USB, qui est du texte libre écrit par un fabricant.

Alors les deux sont affichés, et dans cet ordre: **« ▢ (gauche) »**. La position
est garantie par la norme W3C, qui fixe que l'index 2 est le bouton de GAUCHE du
losange de droite, quelle que soit la marque. La lettre, elle, vient de
l'identifiant `Vendor: 054c Product: 0ce6`, et peut être fausse sur une copie. Si
la supposition rate, la position reste vraie et la personne trouve quand même son
bouton.

Sur une disposition **inconnue**, en revanche, il n'y a rien à supposer: les
index appartiennent au matériel. La page dit « bouton 7 » et rien d'autre.
Inventer « ✕ » là serait exactement le mensonge que ce découpage évite.

#### Personnaliser une manette qui n'avait pas de profil

Une manette Xbox ou PlayStation n'avait aucun profil: `readPad` appliquait une
table figée, et il n'y avait littéralement rien à modifier. Le premier clic sur
« réassigner » matérialise donc cette table en profil, et le reste se modifie
comme celui d'une manette apprise.

L'invariant qui rend l'opération sans danger est vérifié par un test: **lire la
même manette avec le profil matérialisé et sans profil doit donner exactement le
même résultat**, sur les boutons, les gâchettes à mi-course, les sticks et la
zone morte. Sans lui, une case oubliée dans la matérialisation ne se verrait
qu'à la manette, sur le bouton auquel personne ne pense.

Ce que ça coûte est dit à côté du code: à partir du moment où quelqu'un
personnalise, sa copie ne suit plus les corrections de la table. C'est le prix
d'une préférence enregistrée, et il vaut mieux que l'inverse, où une mise à jour
du navigateur déplacerait les boutons de quelqu'un sans prévenir.

#### Ce qu'on appuie pour configurer ne doit pas arriver au jeu

Réassigner « A » consiste à appuyer sur A. Si la manette continue d'atteindre
l'émulateur pendant ce temps, configurer sa manette revient à jouer au hasard
dans la partie de tout le monde.

Pendant une capture, la page envoie donc un état **neutre**, et continue de
l'envoyer plutôt que de se taire: se taire laisserait le dernier appui tenu dans
l'émulateur. L'essai de navigateur le vérifie en comptant les trames envoyées
pendant la capture.

### 7.18 Quatre détails qui auraient chacun coûté une soirée

**Une commande, deux boutons.** Sur une manette standard, le L de la GameCube
répond à la tranche L1 *et* à la gâchette L2: la première donne le clic, la
seconde la course analogique. C'est voulu depuis M3. La première version de
l'antisèche n'en montrait qu'une, ce qui aurait envoyé la moitié des gens appuyer
sur la mauvaise. Ce sont deux tests qui l'ont dit, en refusant d'être d'accord
entre eux.

**`KeyboardEvent.code` nomme des positions, pas des lettres.** Le code décrit
l'emplacement physique, nommé d'après un clavier américain: sur un azerty, la
touche marquée « A » rend `KeyQ`. Afficher « Q » à quelqu'un qui vient d'appuyer
sur A ressemble exactement à un configurateur qui s'est trompé. La page demande
donc au navigateur ce qui est **imprimé** sur la touche
(`navigator.keyboard.getLayoutMap()`), et retombe sur la position là où l'API
n'existe pas. Utiliser `code` reste le bon choix pour JOUER: la même touche
physique marche sur les deux claviers.

**Un bouton qui met une demi-seconde à répondre a l'air cassé.** React lit un
instantané deux fois par seconde, ce qui est la bonne cadence pour lire des
mesures et la mauvaise pour répondre à un clic: on cliquait « réassigner » et
l'écran ne le montrait qu'après. Corrigé en reconstruisant l'instantané tout de
suite après une action de la personne, sans toucher à la cadence de lecture. Une
copie locale dans le composant aurait donné le même effet et une deuxième source
de vérité.

La moitié du correctif manquait, et c'est l'essai de navigateur qui l'a dit, en
échouant une fois sur deux. Le clic est une action de la personne, donc facile à
suivre. Mais la **fin** d'une capture arrive dans la boucle d'entrée, pas dans
React: la touche était enregistrée et l'écran continuait à dire « appuie sur une
touche » jusqu'au tour suivant. La boucle prévient maintenant qu'elle a fini,
au lieu que l'écran l'apprenne par une horloge. Un essai qui échoue une fois sur
deux est un essai qui a raison une fois sur deux.

**Zéro n'était pas zéro.** Multiplier `0` par `-1` rend `-0` en JavaScript, que
`Object.is` distingue de `0`. L'octet envoyé est le même, donc le jeu n'a jamais
rien vu. Mais ça faisait échouer la comparaison entre deux façons de lire la même
manette, c'est-à-dire précisément le test qui rend la personnalisation sûre. La
distinction est retirée à la source plutôt que contournée dans le test: un test
qui s'accommode d'une bizarrerie décrit le langage et pas le sujet.
### 7.19 Six jeux PAL, et 35 ms de latence qu'ils ont révélées

Six titres ajoutés à la bibliothèque, dont cinq en PAL. Un jeu PAL tourne à
50 Hz. La question posée était: est-ce que ça casse quelque chose ?

Oui, mais pas là où on le croyait.

#### Ce que les en-têtes disent

Lus avec `dolphin-tool header`, pas devinés d'après les noms de fichiers:

| jeu | identifiant | région |
|---|---|---|
| Mario Party 4, 5, 6, 7 | `GMPP01`, `GP5P01`, `GP6P01`, `GP7P01` | PAL |
| Mario Power Tennis | `GOMP01` | PAL |
| Super Mario Strikers | `G4QE01` | NTSC-U |
| Mario Kart Double Dash | `GM4E08` | NTSC-U |
| Super Smash Bros Melee | `GALE01` | **NTSC-U** |

La dernière ligne compte: une hypothèse circulait selon laquelle les saccades
déjà vues sur Melee venaient de sa région. La Melee de cette bibliothèque est la
NTSC, c'est celle qu'on avait gardée en supprimant l'autre. Et le journal du
worker sur deux jours ne connaît que Mario Kart et Melee: **aucun jeu PAL n'avait
jamais démarré ici**, donc aucune saccade observée ne pouvait venir de l'un.

#### Trois choses que l'encodeur ne fait pas

Le worker ouvre son encodeur avec `fps = 60`. Ce nombre ne fait que trois choses
dans le shim C: `time_base = 1/60`, `framerate = 60/1`, `gop_size = 600`. Aucune
image n'est dupliquée, aucune n'est jetée, et l'encodeur traite ce qui arrive. La
page, de son côté, **ignore la cadence annoncée dans le flux**: elle ordonnance
sur `captured_micros`, notre propre horodatage.

Une source à 50 Hz traverse donc la chaîne sans que ce 60 change quoi que ce
soit. Mesuré: 504 images par tranche de dix secondes au lieu de 600, zéro jetée,
attente d'une image passée de 14,7 à 18,0 ms — ce qui est exactement la période
de 20 ms moins le travail.

#### Et le correctif d'une ligne qui n'aurait rien fait

La proposition était `PAL60 = True` sous `[Core]` dans le `Dolphin.ini`. Lu dans
la source à notre commit épinglé:

```
SYSCONFSettings.cpp: const Info<bool> SYSCONF_PAL60{{System::SYSCONF, "IPL", "E60"}, true};
WiiPane.cpp:         m_pal60_mode_checkbox = ...          <- page des réglages Wii
Boot.cpp:            ... (system.IsWii() && Config::Get(Config::SYSCONF_PAL60))
BootManager.cpp:     if (system.IsWii() && ...
```

C'est un réglage **SYSCONF**, affiché dans les options Wii, et ses deux usages
sont gardés derrière `IsWii()`. Écrit dans `[Core]`, il n'est pas lu; et il ne
serait pas consulté pour un jeu GameCube même s'il l'était.

Côté GameCube, la cadence vient des registres que **le jeu** écrit
(`m_display_control_register.FMT`, `VideoInterface.cpp`). Dolphin n'expose aucune
bascule 50→60 pour ces disques: `FallbackRegion` ne sert qu'aux disques sans
région déclarée, et il n'existe rien qui touche la fréquence de trame. Les seuls
leviers sont l'option 60 Hz du jeu lui-même quand il en a une, ou un dump NTSC.

La leçon est celle qui revient: **un correctif proposé pour la mauvaise couche
ressemble à un correctif**. Il aurait été ajouté, rien ne se serait passé, et un
essai « le jeu a refusé le mode 60 Hz » aurait fourni une explication toute
faite.

#### Le vrai défaut, que seuls ces jeux pouvaient montrer

En lisant la boucle d'affichage avec 50 Hz en tête, une ligne saute aux yeux:

```js
if (this.queue.length === 0) {
  this.starved += 1;
  this.priming = true;
  this.offset = null;      // l'horaire d'affichage est jeté
  return;
}
```

Soixante tics d'affichage par seconde pour cinquante images: une dizaine de fois
par seconde, il n'y a rien de neuf à montrer. Ce n'est pas une panne, c'est de
l'arithmétique. La page comptait pourtant une famine à chaque fois, jetait son
horaire, et faisait grossir sa marge de 8 ms par fenêtre vers son plafond de 60.

Mesuré sur Mario Party 4, `just browser-watch`:

| | avant | après |
|---|---|---|
| marge d'affichage | **38 ms** (et ça montait) | **3 ms** |
| images arrivées / peintes | 3000 / 3000 | 2999 / 2999 |
| reprises du décodeur | 0 | 0 |

Trente-cinq millisecondes de latence, ajoutées pour compenser un problème qui
n'existait pas. Sur un jeu 60 Hz, la marge reste à 3 ms comme avant, et les
essais de reprise passent sur les deux cadences.

Le correctif compare le temps écoulé depuis la **dernière arrivée** à la période
propre de la source, mesurée sur ses écarts d'arrivée plutôt que déduite de la
région du disque. En dessous d'une période et demie, l'écart s'explique par la
cadence de la source; au-dessus, quelque chose s'est arrêté. La longueur de la
file, elle, ne disait rien d'autre que « l'écran est plus rapide que le jeu ».

#### Ce qui reste, et qu'aucun code ne réglera

Cinquante images par seconde ne se répartissent pas également sur un écran à
60 Hz: une image sur cinq est tenue deux rafraîchissements. Ça se voit dans un
panoramique et c'est arithmétique. Sur un écran à 240 Hz le motif est 5,5,5,5,4,
beaucoup moins visible. Un jeu PAL restera donc légèrement moins fluide qu'un
NTSC sur un écran 60 Hz, et la seule vraie réponse est un dump NTSC ou l'option
60 Hz du jeu.
### 7.20 Les noms des jeux, sept ambiances, et une identité déjà là

Trois choses sans rapport, sauf qu'elles arrivent le même jour.

#### Le nom du jeu, sans le catalogue

Une collection de dumps écrit `Mario Party 4 (Europe) (En,Fr,De,Es,It) (Rev 2)`.
Personne ne veut lire ça sur un menu. La tentation est d'enlever toutes les
parenthèses, et c'est un piège: un des jeux de cette bibliothèque s'appelle
`Mario Kart Double Dash (Retro Track Grand Prix)`, où la parenthèse EST le nom du
hack et la seule chose qui le distingue du jeu d'origine.

La règle ne retire donc que des formes **connues**: une région ou une liste de
régions, une révision (`Rev 2`, `Rev A`), et une liste d'au moins deux codes de
langue. Un seul `(En)` ressemble trop à un mot pour être retiré. Tout le reste
survit, et un test le vérifie sur les quatre titres où la parenthèse compte.

Ce que ça oblige à changer ailleurs: le jeu choisi était mémorisé **par son nom
affiché**. Il l'est maintenant par son **nom de fichier**, parce que les règles
de nettoyage ont le droit de s'améliorer et qu'une salle ne doit pas oublier ce
qu'elle jouait parce qu'un titre a perdu une parenthèse.

#### Sept ambiances, parce qu'une ambiance ne coûte que des variables

La page était en deux thèmes. Elle en a sept, et l'ajout tient en une soixantaine
de lignes de CSS: chaque thème est un jeu de onze variables, et rien d'autre.

La règle qui les gouverne tous: un thème change des **couleurs** et une famille
de caractères. Il ne change ni la disposition, ni ce qui est affiché, ni quoi que
ce soit par-dessus l'image. La zone d'écran reste noire dans les sept, bandes
comprises. C'est ce qui rend le choix sans risque: aucune ambiance ne peut
toucher la boucle d'affichage.

Deux d'entre elles passent le cadre entier en chasse fixe (`phosphore`, `ambre`,
`game boy`), ce qui est la vraie différence entre « un site sombre » et « un
terminal »: c'est la lettre qui fait l'époque, pas le fond.

#### Le compte qu'on n'a pas besoin d'écrire

La question posée était: comment gérer l'inscription et la connexion ? La réponse
tenait dans un en-tête, et elle a été mesurée plutôt que supposée, en branchant
un serveur qui répond avec ce qu'il reçoit:

```
Tailscale-User-Login: souhib.t@hotmail.fr
Tailscale-User-Name: Souhib Trabelsi
```

Le proxy Tailscale ajoute lui-même l'identité **authentifiée** du pair, à partir
de la connexion WireGuard. Un navigateur ne peut pas la falsifier: elle n'est pas
envoyée par le client, elle est écrite par le proxy. Et elle n'est une preuve que
parce que les deux services écoutent sur `127.0.0.1`, donc que le proxy est le
seul chemin — c'est la raison pour laquelle ce choix avait été fait, et il se
paie ici.

Il n'y a donc **ni inscription ni connexion à écrire**. Il y a un en-tête à lire.
Ce qui se débloque avec: un propriétaire de salle qui n'est pas qu'une convention
d'affichage, et des préférences rattachées à quelqu'un plutôt qu'à un navigateur.
### 7.21 L'identité, sans inscription ni mot de passe

Le chapitre précédent finissait sur une mesure: le proxy Tailscale écrit déjà
l'identité authentifiée du pair. Elle est maintenant lue.

#### Trois propriétés, mesurées avant d'écrire une ligne

Tout le montage repose dessus, donc aucune n'a été supposée.

**Le proxy écrase ce que le client envoie.** Une requête portant
`Tailscale-User-Login: attaquant@example.com` est arrivée au service avec
`souhib.t@hotmail.fr`, une seule fois. Ce n'est donc pas une déclaration du
navigateur, c'est une constatation du réseau.

**L'en-tête est là sur la montée en grade d'une WebSocket aussi.** Vérifié avec
un serveur qui accepte la poignée de main et imprime ce qu'il a reçu. C'est ce
qui évite un jeton à faire circuler entre une route HTTP et une socket, donc une
pièce de moins à se faire voler.

**Les deux services n'écoutent que sur la boucle locale.** C'est ce qui
transforme le premier point en garantie: un service joignable autrement
accepterait l'en-tête de n'importe qui. Cette liaison avait été choisie en M3
pour cette raison exacte, avec le commentaire qui l'explique dans `main.rs`; elle
se paie ici.

#### Ce qui appartient à qui

L'**adresse** vient du proxy et n'est pas modifiable. Le **pseudo** appartient à
la personne: elle le choisit, elle en change quand elle veut, et il est rangé
côté serveur sous cette adresse. C'est tout l'intérêt d'avoir une identité: le
pseudo suit quelqu'un d'un navigateur à l'autre, ce qu'un `localStorage` ne fera
jamais.

Deux durées de vie, donc deux rangements, et c'est délibéré. Une **place** meurt
avec le processus, parce que personne n'est encore assis dans une salle qui vient
de redémarrer: elle reste en mémoire. Un **pseudo** doit survivre à un
redémarrage du service et de la machine: il est écrit dans un fichier, écrit
puis renommé pour qu'un JSON à moitié écrit n'existe jamais.

#### La limite qui existait à deux endroits

Le contrôleur coupait un pseudo trop long à vingt-quatre caractères, et le schéma
Pydantic en refusait un de vingt-cinq. Deux limites à garder d'accord, et le test
l'a dit tout de suite: il attendait un nom coupé et a reçu un 422.

La longueur est restée dans le **schéma**, qui est le contrat et qui est publié
dans le document OpenAPI que la page lit. Le contrôleur ne garde que ce que le
schéma ne peut pas voir: un nom fait d'espaces n'est pas un nom.

#### Deux défauts que les essais ont trouvés

**La présence recalculait les noms.** La liste des présents rendait
`souhib.t` au lieu de `Souhib`, et une chaîne vide pour quelqu'un sans identité.
Elle recalculait le pseudo à partir de l'adresse seule, en perdant le nom que le
fournisseur d'identité affiche, et n'avait rien à recalculer pour un anonyme. Le
nom résolu à la connexion est maintenant gardé avec la présence.

**Un essai qui cherchait en minuscules.** « la salle liste ses présents » a
échoué sur une page qui affichait exactement `1 DANS LA SALLE`: l'étiquette est
en majuscules par le style, et `innerText` rend le texte **transformé**, pas la
source. L'assertion avait tort, pas la page. C'est la troisième fois de ce carnet
qu'un essai accuse à tort, et la troisième fois que la sortie de l'essai contient
déjà la réponse.
### 7.22 Le propriétaire, le repli, et un salon qui tombait avec le worker

Quatre choses posées sur l'identité du chapitre précédent, et un défaut trouvé en
les posant.

**L'ambiance sombre devient le défaut**, sur `:root` nu autant que sur son
attribut: c'est cette règle-là qui peint la page avant que le script ait tourné,
et un défaut clair y faisait clignoter du blanc le temps du premier rendu.

**Le propriétaire est le premier arrivé encore présent.** Pas un titre à
réclamer: personne ne veut cliquer sur « prendre la salle » avant de jouer, et
une salle qui se remplit a toujours un premier. Quand il part, ça passe au
suivant tout seul. Il faut une identité pour décider: sans proxy devant, tout le
monde est anonyme, personne n'est propriétaire, et la salle retombe sur sa règle
d'avant où tenir une manette suffit. Refuser tout là serait une salle où plus
personne ne peut rien.

**Ce que ça enferme, et ce que ça n'enferme pas.** La page n'offre le changement
de jeu qu'au propriétaire, et le service dit qui c'est. Mais la commande voyage
toujours sur la socket de manette du worker, et le worker, lui, ne connaît pas
l'identité: il vérifie seulement qu'on tient une manette. Quelqu'un avec une
console de développeur peut donc encore envoyer l'octet. Le fermer pour de bon
demande que le worker apprenne quelle place appartient au propriétaire, par un
canal que le proxy ne relaie pas. Ce n'est pas fait, et c'est écrit ici plutôt
que sous-entendu.

**Le repli** cache la colonne et rend toute la largeur à l'image, avec `F` pour
aller et venir. C'est le geste utile à quatre autour d'un écran; le plein écran
du navigateur est à côté et fait la moitié restante. Le repli est gardé, le plein
écran non: on ne met personne en plein écran au chargement sans qu'il l'ait
demandé.

**Le choix de la manette** n'apparaît que s'il y a un choix. Par POSITION et non
par identifiant, parce que deux manettes identiques rendent le même identifiant
et que c'est exactement le cas où il faut pouvoir choisir. Le profil, lui, reste
rangé par identifiant: c'est le matériel qu'on a configuré, pas la prise USB dans
laquelle il était.

**Les quatre prises sont dessinées.** Une silhouette de manette GameCube se
reconnaît avant d'être lue, et la rangée de quatre ressemble alors à la façade de
la console. Tracée avec `currentColor` et rien d'autre, donc les sept ambiances
la portent sans qu'aucune ait à la connaître.

#### Le défaut: le salon appelait le worker à chaque événement

Le journal du service s'est mis à cracher des traces. La diffusion du salon passe
par `describe()`, qui interroge le worker pour connaître la bibliothèque — donc
une requête HTTP au worker à **chaque** connexion, chaque départ, chaque
changement de pseudo.

Ça ne se voyait pas jusqu'ici. Mais **changer de jeu redémarre le worker**, et
toutes les pages se reconnectent pendant ce redémarrage: chaque connexion
échouait, la salle ne disait plus qui était là, et le journal se remplissait pour
un service qui revenait cinq secondes plus tard.

Le contrôleur garde maintenant la dernière bibliothèque obtenue et s'en sert
quand le worker ne répond pas. Avec son jumeau négatif: une salle qui n'a
**jamais** su quels jeux elle a n'est pas une salle qui a perdu le contact, donc
là l'erreur reste une erreur.

#### Et un essai qui accusait à tort, encore

« quand tout le monde part, la salle n'a plus de propriétaire » a échoué pendant
trente secondes. La salle n'était pas vide: quelqu'un jouait dans un autre onglet.
L'essai demande maintenant une salle vide et s'abstient sinon, comme les cinq
autres qui ont appris la même leçon avant lui.
### 7.23 Le propriétaire pour de vrai, et un menu qui prend tout l'écran

Le chapitre précédent laissait une phrase gênante: la page n'offrait le
changement de jeu qu'au propriétaire, mais le worker ne connaissait pas
l'identité et obéissait à qui tenait une manette. Une console de développeur
suffisait. C'est fermé.

#### Un deuxième port, et pourquoi il en fallait un

Le proxy envoie `/` au worker: **tout chemin que le worker sert est joignable
depuis un navigateur**. Une route `/owner` sur le serveur de pages aurait laissé
n'importe qui se déclarer propriétaire, ce qui est exactement la règle qu'on
essayait de poser.

Le worker écoute donc sur un second port, que le proxy ne relaie pas du tout.
Seul un processus de la machine peut l'atteindre, et c'est une propriété de la
liaison plutôt que d'un fichier de configuration ailleurs: retirer une ligne du
proxy ne peut pas l'ouvrir par accident.

Le protocole tient en une ligne, `owner <place>\n`, où `0` veut dire personne.
Un seul message existe; une bibliothèque de plus pour l'écrire serait une
dépendance à tenir à jour pour deux mots.

La règle est vérifiée dans `obey`, à côté de l'ordre, et pas dans la page.
L'essai est rouge d'abord, et il fallait qu'il le soit ici plus qu'ailleurs: le
pilote de navigateur ne pouvait pas l'attraper, puisqu'une page qui n'offre pas
le bouton n'envoie pas l'octet. C'est précisément la console de développeur qu'on
ferme, donc c'est un test de transport qui devait le dire.

Aucun propriétaire déclaré veut dire aucune règle: la salle retombe sur ce
qu'elle faisait avant, où tenir une manette suffit. C'est le cas d'une salle sans
plan de contrôle, et refuser tout là ferait une salle bloquée par un service qui
n'est peut-être pas installé.

#### Une place appartient à une SESSION, pas à un nom

« J'avais quitté la salle et je voyais encore Souhib. » La présence dédoublonne
par identité, donc un autre appareil de la même personne suffisait à la garder
dans la liste. Correct, et illisible.

Mais en regardant, un vrai défaut est apparu dans le modèle: les places étaient
rangées **par nom**. Deux conséquences que personne n'avait vues. Fermer un
onglet libérait la manette que la même personne tenait sur son autre machine. Et
deux appareils d'une même personne se confondaient en une seule ligne, donc la
salle affichait une place pour deux.

Les places sont maintenant rangées par session. La route HTTP qui permettait de
réserver une place est partie avec: elle ne pouvait pas dire QUELLE session
réservait, elle doublonnait le chemin de la socket, et la page ne s'en servait
pas.

#### Les prises redeviennent des prises

J'avais remplacé les quatre prises dessinées par la silhouette d'une manette. Ce
n'était pas ce qui était demandé et c'était moins bon: ce qu'on reconnaît sur
l'avant d'une console, ce sont les quatre **ouvertures**, chacune avec la couleur
de son joueur. Le dessin d'origine est revenu, avec ses trois états: libre montre
ses broches dans un trou noir, occupée est bouchée par une fiche grise, tienne
est la même fiche dans la couleur du joueur avec le contour allumé.

Les quatre couleurs ne suivent pas le thème, et c'est délibéré. Rien dans le
matériel n'est coloré, les prises sont toutes du même plastique noir; mais tous
les jeux qui ont demandé « lequel es-tu ? » ont répondu en rouge, bleu, jaune,
vert. Les faire changer avec l'ambiance reviendrait à repeindre le joueur 1.

#### Un menu, et pas un panneau de plus à droite

La colonne de droite est un appareil de mesure: faite pour être lue pendant qu'on
joue, en petit et sans bouger. Choisir un jeu n'est pas ça. On lâche la partie, on
regarde une liste, on décide. C'est un moment à part et il prend tout l'écran.

Échap l'ouvre, Échap le referme, haut/bas/entrée le parcourent, parce que
quelqu'un qui tient une manette n'a pas forcément une souris à portée. Trois
rayons: les jeux, la salle, les réglages. Les réglages sont le **même** bloc que
dans la colonne, pas une copie: deux copies auraient fini par diverger, et c'est
le genre d'écart qu'on ne voit qu'en montrant l'écran à quelqu'un.

#### Un chargement qui dit où il en est

Changer de jeu arrête l'émulateur, redémarre le worker et fait se reconnecter
toutes les pages. Une dizaine de secondes pendant lesquelles il ne se passait
rien sauf une petite ligne dans la colonne.

L'écran de chargement montre ce que la page SAIT: le nom du jeu demandé et
l'étape où elle en est, en trois temps. Pas de barre qui avance toute seule:
aucun des deux services ne dit où il en est, et une barre inventée est un
mensonge poli. Il se retire une trentaine d'images après la reprise, pas à la
première: la toute première est parfois une image-clé du jeu précédent restée
dans le décodeur, et disparaître dessus ferait clignoter l'ancien jeu.

#### Ce qu'on ne peut plus faire, et ce qui reste à faire

Une manette tenue par quelqu'un **présent dans la salle** ne se prend plus d'un
clic: le bouton est éteint et dit pourquoi. Une place tenue par un fantôme, elle,
se reprend toujours en deux clics, parce que c'est le cas où il faut bien que
quelqu'un puisse s'asseoir.

Ce qui manque est la demande d'échange: pouvoir dire « tu me la passes ? » et
laisser l'autre accepter. C'est deux pages à mettre d'accord à travers le salon,
et ce n'est pas fait.
### 7.24 Un XMB, et une manette qui se demande

#### La forme du menu de la PS3, et ce qu'on en reprend

Ce qui fait un XMB tient en une idée: une **croix**. Une rangée horizontale de
rayons, et sous le rayon choisi une colonne verticale d'entrées. Le point où les
deux se croisent ne bouge jamais; c'est le contenu qui glisse dessous. Gauche et
droite changent de rayon, haut et bas changent d'entrée, et à chaque fois c'est
le monde qui se déplace et pas le curseur.

C'est ça qui se reproduit, et c'est fait. Les icônes, non: celles de Sony ne sont
pas à nous, et les recopier de mémoire donnerait des approximations qui auraient
l'air de vouloir tromper. Ce sont des formes géométriques, dans le même esprit.

**La règle du projet est enfreinte ici, exprès.** Pas de dégradé, pas d'effet:
c'est écrit partout ailleurs, parce que ça tire l'oeil hors de l'image du jeu.
Sur cet écran il n'y a pas d'image, on a quitté la partie pour venir lire une
liste. La raison de la règle ne s'applique pas, donc la règle non plus. Le
dégradé et l'onde viennent quand même de la couleur du thème, pour que les sept
ambiances restent vraies: l'onde est verte en phosphore et crème en famicom.

Un détail qui a demandé une correction après coup: l'onde passait à travers le
titre de l'entrée choisie. Sur la console elle traverse tout, mais la console n'a
pas à faire lire des noms de fichiers de quarante caractères. Elle est descendue.

#### « Tu me la passes ? »

Prendre la manette de quelqu'un est le seul geste de cette page qui se voit sur
l'écran d'un autre. Il ne se fait plus d'un clic: on demande, et l'autre répond.

Trois gestes différents, et ils ne se ressemblent pas. Une prise **libre**: on
s'y branche tout de suite. Une prise tenue par **quelqu'un qui est là**: on lui
demande. Une prise tenue par un **fantôme** — la salle ne connaît personne
dessus: on la reprend en deux clics, parce qu'il n'y a personne à qui demander et
qu'il faut bien pouvoir s'asseoir.

Le demandeur n'envoie qu'un **numéro de port**. Le serveur sait qui tient quoi;
lui faire envoyer l'identifiant de socket de l'autre apprendrait à une page
comment en adresser une autre, et il n'y a aucune raison qu'elle sache ça.

La moitié qui n'était pas évidente est le **silence**. En acceptant, le porteur
libère sa place — et sa reconnexion polie, celle qui existe pour récupérer une
manette dès qu'il en reste une, la reprenait une demi-seconde plus tard. Celui à
qui on venait de dire oui la trouvait occupée. Il faut donc que la page qui cède
se taise volontairement quelques secondes.

#### Deux défauts, dont un que j'avais annoncé corrigé

**Une édition qui n'avait rien édité.** Le commit précédent affirmait que la
règle « on ne vole pas la manette de quelqu'un de présent » était appliquée dans
la colonne. Elle ne l'était que dans le menu, qui a ensuite été supprimé: le
remplacement de texte dans `Seats.tsx` n'avait trouvé aucune cible et n'avait
rien dit. C'est le même piège que ce carnet enregistre depuis M2, à la ligne
« une édition qui ne s'applique pas », et il a fallu qu'un pilote clique sur une
prise occupée pour le voir. Les éditions de ce genre portent maintenant une
assertion, et le message de commit était faux.

**Une variable lue avant d'exister.** Les rayons du menu sont construits à partir
de qui décide et de qui tient quoi, et je les avais écrits au-dessus de ces
calculs. Un tableau littéral s'évalue tout de suite: `Cannot access 'A' before
initialization`, et la salle ne s'ouvrait plus du tout. Attrapé en trente
secondes parce que le pilote a échoué sur `#screen` absent, ce qui est
exactement ce qu'un pilote doit faire.

#### Et un piège d'instrument, encore

Le pilote de l'échange expirait sur `waitForSelector` et sur `page.click`. La
page n'était pas bloquée: ces deux appels installent un observateur ou font
défiler l'élément dans la vue, c'est-à-dire plusieurs allers-retours au
navigateur, et **deux pages qui décodent chacune soixante images par seconde**
sur cette machine suffisent à les faire expirer. Cliquer depuis la page
(`element.click()`) est un seul aller-retour et mesure la même chose.

C'est la troisième fois que l'outil de mesure est le problème, et la troisième
fois que le symptôme accusait le sujet.
### 7.25 Trois consoles, une manette qui conduit, et dix secondes pour répondre

#### Le menu devient un choix, pas une forme imposée

Trois façons de se conduire, à choisir dans le menu lui-même. La **croix** du
XMB, une rangée et une colonne qui se croisent en un point fixe. La **grille**,
une page de tuiles carrées et une barre de rayons en bas. La **rangée**, une file
de grandes tuiles dont celle qu'on pointe grandit et sort du rang.

Ce sont trois dessins, mais **une seule mécanique**: un rayon, une entrée dedans,
six ordres possibles. Écrite une fois (`shell.ts`), sinon la croix et la grille
auraient fini par ne plus être d'accord sur ce que « bas » veut dire. Ce qui
reste propre à chaque forme est la géométrie, et ça tient dans un nombre: combien
d'entrées par ligne. Dans une colonne, bas avance d'une entrée; dans une grille,
d'une ligne entière.

La forme du menu est un réglage **séparé du thème**: l'un change des couleurs,
l'autre change la façon de se déplacer. Un XMB en Game Boy est donc possible, et
c'est très bien.

#### La manette conduit le menu

C'est ce que fait une console: on appuie sur un bouton, le jeu continue de
tourner, et le pouce parle au menu. Tant qu'un menu est ouvert, la page envoie un
état **neutre** au jeu, sinon celui qui navigue ferait sauter son personnage à
chaque ligne descendue.

La partie qui demandait de la réflexion est la cadence. La boucle lit la manette
toutes les quatre millisecondes: sans mémoire, une seule poussée traverserait la
liste entière. La cadence est donc celle d'une console — le premier cran part
tout de suite, puis un temps de garde de 400 ms, puis une répétition toutes les
110 ms tant que la direction est tenue.

Ça vit dans un module pur qui reçoit l'instant plutôt que de lire une horloge, ce
qui rend les trois temps vérifiables sans attendre une seconde par assertion.
Huit tests, dont le jumeau négatif qui compte: un stick qui traîne à 0,3 n'est
pas un ordre, sinon une manette usée ferait défiler la liste toute seule.

#### Dix secondes pour répondre, et le service les compte aussi

Une demande de manette sans réponse s'éteint au bout de dix secondes. Le compte à
rebours est affiché, mais surtout **le service applique la même limite**: sans
ça, un « oui » tapé cinq minutes plus tard téléporterait une manette au milieu
d'une partie, et celui qui avait demandé aurait oublié la question depuis
longtemps.

Le délai est publié dans le contrat OpenAPI plutôt que recopié dans la page.
Deux nombres à garder d'accord finissent toujours par ne plus l'être, et ce
carnet en a déjà deux exemples.

Le temps compté est **monotone** et pas l'heure: régler l'horloge de la machine
ne doit pas faire expirer ou ressusciter une demande.

#### Les prises reprennent leurs couleurs

Une prise occupée est bouchée par une fiche **de la couleur de son port**, à moi
ou pas. Le port 2 est bleu pour tout le monde, parce que c'est la couleur du
port et pas celle du propriétaire: sur un écran de Melee, le joueur 2 est bleu
pour les quatre personnes du canapé.

Ce qui distingue la mienne est le mot dessous, « TOI ». Le contour allumé qu'il y
avait avant disait la même chose une deuxième fois, et en grisant les trois
autres il les rendait toutes identiques.

#### La colonne se partage en deux, et les réglages s'en vont

**Salle**: qui joue, avec la pastille de sa couleur, qui regarde, et le son.
**Détails**: les mesures. Elles ont expliqué quatre blocages différents et
restent à un clic, mais les avoir en permanence sous les yeux faisait une colonne
que personne ne lit.

Les réglages, le thème et les touches ont quitté la colonne pour le menu. Une
colonne qui porte à la fois l'état de la salle et sept boutons de réglage ne
porte bien ni l'un ni l'autre.

Et l'écran des touches s'ouvre **par-dessus le menu** au lieu de le fermer: on ne
renvoie plus personne dans la partie pour changer une touche. Le menu reste
affiché derrière et cesse d'écouter, sinon réassigner une flèche ferait aussi
défiler la liste dessous.
### 7.26 Un clavier compté deux fois, et quatre menus qui portent le nom de leur console

#### Deux chemins pour une touche

« Dans le menu, flèche droite saute deux fois. » C'était une addition, pas une
sensibilité mal réglée.

Le menu écoute `keydown` lui-même, et la boucle d'entrée lisait AUSSI le clavier
pour conduire le menu à la manette. Une flèche partait donc deux fois: une par le
gestionnaire du menu, une par la boucle qui voyait la flèche comme une poussée de
stick. Le clavier appartient maintenant au menu, et la boucle ne lit que la
manette.

Le détail qui rend ce défaut instructif: il n'existait **que sans manette
branchée**. La boucle lit `pad ? manette : clavier`, donc dès qu'une manette est
là le clavier n'était pas lu et rien ne doublait. Et l'essai de navigation
utilisait une manette simulée: il passait à côté en donnant l'air de vérifier. Il
a fallu une **deuxième page, sans manette**, pour le reproduire.

L'assertion qui compte n'est pas « ça bouge » mais « ça bouge d'exactement un
cran ». Une addition ne se voit qu'en comptant.

Corollaire trouvé au passage: le clavier n'était branché que sur une des trois
formes de menu. Les deux autres ne se conduisaient qu'à la manette, et personne
ne l'avait remarqué parce que personne ne les avait ouvertes au clavier. Il vit
maintenant dans la mécanique partagée, donc les quatre l'ont.

#### Un réglage qui ne se réglait pas

Dans la forme en rangée, gauche et droite parcourent la file. Pousser à droite
sur « menu » changeait donc de page au lieu de changer de menu, et le réglage
avait l'air cassé.

La cause est que « régler une valeur » était accroché à un axe, et que cet axe
n'est pas le même selon la forme. Une entrée qui porte une valeur se règle
maintenant aussi en la **choisissant**: « A » est partout, quelle que soit la
géométrie. Les indices disent « A pour changer » plutôt que de nommer un axe qui
dépend de l'écran.

#### Les menus prennent le nom de leur console

Ils s'appelaient « croix », « grille » et « rangée », ce qui décrivait la forme et
ratait l'intention: le but était de retrouver le menu d'une console, pas une
abstraction. Ils s'appellent donc **PlayStation 3**, **Xbox 360**, **Wii** et
**Switch**, et une quatrième est arrivée avec: les **lames** du tableau de bord de
la 360, des panneaux de couleur empilés dont un seul est ouvert.

Conséquence qui vaut d'être écrite: **un menu ne suit plus le thème**. Chacun
porte les couleurs de sa console — le blanc et le bleu de la Wii, le vert de la
360, le gris et le rouge de la Switch. Un tableau de bord de Xbox en vert Game
Boy ne serait plus un tableau de bord de Xbox. Le thème habille la salle; le menu
est un costume, et les deux se choisissent séparément.

### 7.27 Les trois menus étaient plats, et un mur de tuiles grises ne se lit pas

« C'est pas représentatif, c'est très moche. Le menu PS3 est très bien mais tous
les autres peuvent être tellement mieux. »

Le constat était juste, et la cause tenait en une phrase: j'avais copié la
**disposition** de chaque console et rien d'autre. Une console se reconnaît
pourtant à trois choses, et la disposition est la moins visible des trois.

#### Ce qui manquait

**La matière.** Le tableau de bord de la 360 n'est pas vert plat: c'est un
dégradé sombre avec un vernis en haut de chaque lame. Une chaîne de Wii n'est pas
une case dans une grille: c'est un carré blanc posé sur une table claire, avec
une ombre courte dessous. Sans l'ombre, il n'y a pas d'objet, juste un tableau.

**Le mouvement.** La barre blanche de la 360 glisse d'une ligne à l'autre, la
chaîne pointée de la Wii grossit, la tuile de la Switch respire. C'est la moitié
de ce qu'on reconnaît, et je n'en avais rien mis.

**La lecture.** Le vrai défaut était ailleurs, et c'est celui qui compte: sur la
Switch, huit tuiles grises identiques. Sur ces écrans-là, une console montre la
**jaquette** du jeu, et on ne relit pas les titres, on reconnaît une place. Sans
image, la file entière était illisible et il fallait lire huit lignes de texte
pour retrouver Melee.

#### Une jaquette qu'on fabrique

Les vraies jaquettes ne sont pas à nous, et les chercher en ligne mettrait une
requête réseau sur un menu. On en fabrique donc une à partir du nom: une teinte
tirée d'un mélange stable du titre, un dégradé, et les initiales des mots qui
portent le sens (`front/src/lib/cover.ts`).

Deux propriétés font tout le travail, et les tests les tiennent séparément:

- **stable** — le même nom donne toujours la même couleur, sinon la mémoire de
  l'endroit est détruite à chaque ouverture;
- **étalée** — « Mario Party 4 », « 5 » et « 6 » doivent tomber sur trois teintes
  éloignées. C'est le jumeau négatif du premier test, et il est indispensable:
  une fonction qui rendrait la même couleur à tout le monde passerait le test de
  stabilité sans broncher.

D'où le mélange FNV-1a sur le nom entier plutôt qu'un tri par première lettre:
notre bibliothèque est faite de titres qui ne diffèrent que par leur dernier
caractère, ce qui est exactement le cas défavorable.

Les initiales écartent les petits mots (« the », « of », « de »), parce que
« Super Smash Bros Melee » et « Super Mario Strikers » commenceraient tous les
deux par S. Et un nom qui ne contient que des mots écartés rend `?` plutôt que
rien: une tuile vide se lit comme une panne d'affichage.

#### La règle des effets, et pourquoi elle ne s'applique pas ici

Ce projet interdit les dégradés et les animations. La raison est écrite: ils
tirent l'oeil hors de l'image du jeu. Sur un menu il n'y a pas d'image — on a
quitté la partie pour venir lire une liste — donc la raison ne s'applique pas, et
la règle non plus. C'est la même exception que le fond du XMB, étendue aux trois
autres.

Deux garde-fous quand même. Seuls `transform` et `opacity` sont animés, les deux
propriétés que le compositeur traite sans repasser par la mise en page, donc rien
de tout ça ne peut voler du temps à la boucle d'images. Et un bloc
`prefers-reduced-motion` coupe l'ensemble pour qui a demandé à son système
d'arrêter de bouger.

### 7.28 La jaquette était déjà sur le disque

« J'aime pas les carrés. Pour les menus qui affichent des carrés avec les
initiales des titres, je préférerais que tu récupères des metadata du jeu et que
tu les affiches, avec pourquoi pas une image du jeu. »

L'entrée précédente fabriquait une couleur et deux lettres à partir du nom, faute
d'image. C'était une réponse à la question « comment distinguer huit cases
identiques » et pas à la question « qu'est-ce que ces cases devraient montrer ».
La bonne réponse était sur la machine depuis le début.

#### `opening.bnr`

Chaque disque GameCube contient un fichier de ce nom: une image de 96 par 32
dessinée par l'éditeur, et à côté le nom long du jeu, le studio et une phrase de
présentation. C'est exactement ce qu'un menu veut afficher, écrit par les gens
qui ont fait le jeu.

L'autre option était une base de couvertures en ligne, et elle perd sur tous les
points: il faut le réseau depuis une machine qui n'est que sur le tailnet, il
faut qu'un tiers reste debout, et les images ne sont pas à nous. Mais l'argument
qui a tranché est plus petit et plus concret. La bibliothèque contient `GM4E08`,
un hack appelé *Retro Track Grand Prix*. Aucune base ne le connaît. Son disque,
lui, porte sa propre bannière et sa propre phrase, parce que ceux qui l'ont fait
les ont écrites:

> Mario Kart: Double Dash - Retro Track Grand Prix — Portable Productions —
> « Race on over 30 New Courses In The Ultimate Double Dash Experience! »

En prime, un disque PAL contient six langues. On lit le bloc français, donc les
Mario Party se présentent en français sans que nous ayons traduit quoi que ce
soit.

#### Sortir le fichier d'un RVZ

Sept des huit fichiers sont des RVZ: un conteneur compressé dont il faut
décompresser les blocs avant même de voir le système de fichiers du disque.
Réécrire ça était hors de question, et ce n'était pas nécessaire: l'image Docker
que le projet construit déjà contient `dolphin-tool`, qui sait le faire.

    dolphin-tool extract -i jeu.rvz -o dossier -s opening.bnr

0,44 s par disque, 3,7 s pour les huit. C'est mesuré le 2026-08-16, et c'est ce
qui autorise la lecture à être **synchrone au démarrage**: les jaquettes sont
mises en cache dans `~/.cache/nel3ab/banners`, hors du répertoire de session qui
est effacé au redémarrage. Le prix est donc payé une fois sur la machine, et pas
à chaque changement de jeu — ce qui compte, puisque changer de jeu redémarre le
worker. Un échec est mis en cache aussi, dans un fichier témoin vide: sans ça, un
disque sans bannière repaierait l'extraction complète à chaque démarrage, pour
toujours.

#### Trois pièges de format, dont deux produisent une image plausible

L'image est en RGB5A3. C'est un format où **deux encodages partagent un même
type**, et c'est le bit de poids fort qui choisit: à 1, cinq bits par couleur et
pas de transparence; à 0, quatre bits par couleur et trois d'alpha. Un décodeur
qui ne lirait que la première branche sortirait quand même une image. Sur nos
huit bannières, entre 1500 et 3072 pixels sur 3072 sont dans la seconde branche.
L'image aurait été fausse partout et jamais vide.

Les pixels **ne sont pas dans l'ordre de lecture**: ils arrivent par tuiles de
4 par 4. Recopier le flux tel quel dans une trame donne une image déchiquetée,
qui ressemble encore à une image. Un test qui vérifierait « on a écrit quelque
chose » passerait; celui qui est écrit épingle un pixel à une position connue —
le dix-septième du flux est le premier de la deuxième tuile, donc il va en x=4.

Le texte est en **Windows-1252**, pas en Latin-1. La différence se voit: Mario
Party 5 écrit `more mayhem\x85`, qui est un point de suspension dans l'un et un
caractère de contrôle dans l'autre.

Les valeurs pleines se convertissent par décalage et non par multiplication: 7
sur trois bits doit donner 255 et pas 252, sinon une image que l'artiste a
dessinée opaque arrive légèrement transparente et toutes les bannières flottent
sur un voile.

#### Ce qui prouve vraiment l'encodeur PNG

Les tests Rust vérifient la signature du fichier et les dimensions écrites dans
l'en-tête. C'est notre code contrôlé par notre code, et ça ne dit rien de la
somme de contrôle ni du flux compressé.

La preuve est donc dans un pilote de navigateur, `art.mjs`, qui lit
`img.naturalWidth`: c'est ce que le décodeur de Chrome a réussi à lire, et il
n'est pas de nous. Vérifié en échangeant largeur et hauteur dans l'appel à
l'encodeur, ce qui produit un PNG parfaitement valide de 32 par 96: le pilote est
passé de 8/8 à 0/8.

#### La forme, qui était la moitié de la demande

Une bannière fait 96 par 32, donc trois de large pour un de haut. C'est cette
proportion qui est reprise partout, et c'est elle qui fait disparaître les
carrés: les tuiles de la Switch sont des bandes, les chaînes de la Wii sont plus
larges que hautes, les listes de la 360 et de la PS3 portent une vignette.

Deux détails d'affichage ont chacun leur raison. `image-rendering: pixelated`,
parce qu'une image de 96 pixels agrandie deux ou trois fois est floue si on la
lisse et nette si on ne la lisse pas: sur un projet qui s'appelle rétro, un gros
pixel est un choix et un bord flou est un défaut. Et un fond noir derrière chaque
bannière, parce que la plupart ont un fond transparent — elles étaient faites
pour le menu de la console, qui était sombre — et qu'un logo blanc sur le tableau
clair de la Wii disparaîtrait.

#### Un défaut trouvé en écrivant le pilote

Changer de jeu demande deux pressions: la première arme, la seconde lance. La
première **ne se voyait nulle part**. Elle ressemblait donc à un clic qui n'avait
pas pris, ce qui pousse exactement à la deuxième pression que la confirmation
était censée faire réfléchir. L'entrée armée écrit maintenant « confirmer ? ».

C'est le pilote qui l'a révélé: il cherchait un signe observable et il n'y en
avait aucun.

Dans la foulée, `games.mjs` a appris à se taire quand il ne peut rien prouver. Il
échouait parce que la salle appartenait à quelqu'un d'autre — la règle du
propriétaire faisait son travail — et un rouge dû à une salle occupée apprend à
l'oeil à ignorer un fichier. Il dit maintenant qui possède la salle et sort sans
prétendre avoir testé.

### 7.29 Regarder sans jouer, et ce qu'on peut faire pour une connexion moyenne

Deux demandes le même jour: pouvoir rendre sa manette ou entrer directement en
spectateur, et améliorer le sort de quelqu'un dont la connexion est moyenne
**sans toucher à celle des autres**.

#### La manette qu'on rend

La page se reconnecte toute seule: une socket de manette qui se ferme est
rouverte une demi-seconde plus tard, et la place reprise. C'est voulu, ça répare
un réseau qui hoquette. Mais ça veut dire que « rendre sa manette » ne peut pas
être « fermer la socket »: ça durerait une demi-seconde.

Il y a donc un drapeau, et trois portes:

- **regarder** depuis l'écran d'accueil, ce qui ne prend jamais de place. Une
  porte séparée et non un réglage à changer après: une session construite en
  joueur prendrait une manette le temps d'un aller-retour, et l'aurait affiché à
  toute la salle;
- **rendre la manette** en cours de partie, l'image et le son continuent;
- **quitter la salle**, qui ramène à l'accueil.

Le pilote `spectator.mjs` attend 2,5 s avant de vérifier, soit plus longtemps que
la reconnexion polie. Vérifié en cassant les deux pièces porteuses: sans le
drapeau au démarrage, la page entrée par « regarder » prend une place; avec une
reprise programmée dans `watchOnly`, la place revient. Deux rouges, deux fois la
bonne raison.

Au passage, une leçon de méthode. La première pièce que j'ai cassée pour vérifier
était le garde dans le gestionnaire de fermeture, et le pilote est resté vert:
`watchOnly` change de génération avant de fermer, donc ce gestionnaire-là est
déjà périmé quand il s'exécute. Un test qui reste vert quand on casse quelque
chose ne dit pas que le test est mauvais: il dit qu'on a cassé la mauvaise pièce.

#### La capture qui explique tout

Un ami a envoyé la copie de son écran de détails, prise en jouant. Trois lignes
suffisent à lire la panne:

| Ce qu'il voyait | Valeur |
|---|---|
| Écarts d'arrivée | 25,8 / 67,2 ms p50/p95 |
| Latence ajoutée | 60 ms |
| Famines | 513 en 214 s |
| Arrivées contre peintes | 11313 contre 9063 |

Sa marge était **collée au plafond**, qui valait 60, et son p95 d'écarts valait
67. Un plafond en dessous de la gigue qu'il doit absorber ne peut rien absorber.
Et une image sur cinq arrivait, se décodait, puis était jetée sans être affichée:
du travail fait puis perdu, ce qui n'est plus la faute du réseau.

#### Trois défauts, tous du côté de la page

**Le plafond.** 60 ms avait été choisi quand toutes les liaisons d'essai étaient
bonnes. Il monte à 180, ce qui fait onze images. Un plafond reste, parce
qu'attendre répare une liaison IRRÉGULIÈRE et jamais une liaison ÉTROITE: si le
débit ne passe pas, la marge grandirait sans fin et n'achèterait que du retard.

**Le calage sur l'image la plus chanceuse.** L'horaire d'affichage était posé sur
`lags.fastest()`, le transit le plus rapide de la fenêtre. C'est parier que la
liaison est toujours à son meilleur, et jeter tout ce qui ne l'est pas. Il tient
maintenant compte de la **gigue**, l'écart entre le p95 des transits et le
minimum. La propriété qui compte est que ce nombre vaut zéro sur une bonne
liaison: rien ne change pour qui n'a pas de gigue, ce qui était la condition
posée.

**L'horaire jeté à chaque famine.** À chaque trou, la page remettait son horaire
à zéro, donc le recalculait au prochain dessin sur l'image la plus rapide. 513
fois. Chaque remise à zéro reposait l'horaire au plus optimiste, l'image suivante
était en retard, et ça recommençait. Une file vide ne dit pourtant rien sur le
lien entre l'heure du serveur et l'heure d'ici, qui est tout ce que ce nombre
signifie.

Et un quatrième, qui est le plus joli: la cadence de la source était mesurée sur
les **arrivées**. Une source à 60 Hz dont les images arrivent toutes les 26 ms
n'est pas une source à 39 Hz, mais la page le croyait, et trouvait donc normal un
trou qui ne l'était pas. Elle la lit maintenant sur les **instants de capture**,
qui décrivent le jeu et pas le réseau. Les deux se ressemblent sur une bonne
liaison et n'ont rien à voir sur une mauvaise, et les confondre était le bug.

#### Un lien lent, pour de vrai

Impossible de vérifier ça en raisonnant. L'étranglement réseau des outils de
Chrome ne sert à rien ici: **il ne touche pas les WebSockets**, vérifié en
plafonnant à 2 Mbit/s une page qui a continué à peindre 50 images par seconde. Or
tout ce que ce projet envoie est une WebSocket.

D'où `throttle.mjs`: un relais TCP qui recopie vers le worker à travers un seau à
jetons dont le débit oscille. En TCP brut et pas en HTTP, donc la montée en
WebSocket le traverse sans qu'il ait à la comprendre. Le débit oscille plutôt que
de retarder chaque morceau au hasard, parce qu'un flux TCP est une suite
d'octets et que retarder inégalement deux morceaux les remettrait dans le
désordre, ce qui n'arrive sur aucun vrai lien.

**Il a attrapé deux défauts que je venais d'introduire**, et c'est la meilleure
chose qu'on puisse dire d'un instrument:

1. en gardant l'horaire d'une famine à l'autre, un horaire posé sur les toutes
   premières images restait faux pour toujours: cinq millisecondes toutes les
   deux secondes mettent sept minutes à rattraper une seconde. Le pilote
   affichait 2398 images arrivées et **zéro peinte**. Un écart trop grand repose
   donc l'horaire d'un coup au lieu de le corriger doucement;
2. sur un lien saturé, les images ne sont pas irrégulières, elles s'entassent. Le
   p95 des transits suit alors la file d'attente et non la gigue — 1,6 s mesurée
   — et mon tampon l'aurait suivie. Le total est maintenant borné par le même
   plafond.

#### Ce que le serveur jetait au milieu d'une phrase

La mesure a ensuite désigné un coupable que je n'attendais pas là: **306 images
non décodables contre 192 décodées**. Deux tiers du travail perdu.

La file de sortie de chaque spectateur fait deux images, et une file pleine jette
l'image. C'est le bon choix — mettre en file d'attente convertit un problème de
débit en problème de latence et le cache. Mais une image jetée **au milieu d'un
groupe** casse tout ce qui suit: les suivantes référencent celle qui manque, et
le navigateur décode du bruit jusqu'à ce qu'il abandonne et redemande une clé.

Le worker sait qu'il vient de jeter, lui. Il se tait donc maintenant vis-à-vis de
ce spectateur-là jusqu'à la prochaine image-clé, qu'il demande dans la foulée. Un
gel court et une reprise propre remplacent une bouillie de blocs. Un spectateur
dont la file ne déborde jamais ne voit rien de tout ceci, ce qui est encore la
condition posée.

#### Ce qui n'est pas réparé, et pourquoi il faut le dire

Sur un lien **trop étroit**, rien de ce qui précède ne suffit. Mesuré: à
0,32 Mbit/s pour un flux qui en demande 0,37, la casse est continue et la page
passe son temps à attendre une clé. Là, le seul levier est un **débit plus
faible**, et c'est justement celui qui toucherait tout le monde: l'encodeur est
en quantiseur constant, sans plafond, et une même image sert tous les
spectateurs.

Les deux suites possibles, honnêtement:

- **plafonner les pointes.** Le flux mesuré sur lgf va de 5 à 24 Mbit/s selon la
  scène, avec des images jusqu'à 100 ko, soit 49 Mbit/s l'instant d'une image. Ce
  sont ces rafales qu'un lien moyen n'absorbe pas. Un plafond de débit placé
  au-dessus de la moyenne raboterait les pointes sans changer la qualité
  ordinaire. À mesurer avant d'y toucher;
- **encoder deux fois**, une version basse pour qui en a besoin. C'est la seule
  façon de vraiment ne rien changer pour les autres, et c'est un vrai chantier.

#### Et le rollback netcode, puisque la question est venue

Il ne s'applique pas, et ce n'est pas une question d'effort. Le rollback repose
sur une chose que nous n'avons pas: **chaque joueur fait tourner sa propre copie
du jeu**. Quand l'autre lague, ta machine continue en devinant son entrée, et
rembobine de quelques images quand la vraie arrive. Ça demande la simulation chez
tout le monde, un jeu déterministe, et une sauvegarde d'état restaurable soixante
fois par seconde.

Ici il y a **une seule** simulation, sur lgf, et le navigateur ne reçoit que de la
vidéo. Il n'a ni le jeu, ni Dolphin, ni un octet d'état: il n'y a rien à
rembobiner et rien avec quoi prédire. En mettre voudrait dire changer de projet
— tout le monde installe le jeu, on synchronise les entrées au lieu des pixels,
ce que fait Slippi pour Melee — alors que tout l'intérêt de celui-ci est qu'une
seule machine émule et que les autres ouvrent un onglet.

Le seul cousin du rollback qui existe en vidéo est la reprojection d'image côté
client, et elle ne marche que pour un mouvement de caméra en 3D avec la carte de
profondeur. Nous recevons une image finie: il n'y a rien à reprojeter.

### 7.30 La pointe de débit, c'était l'image-clé

Demande: plafonner les pointes de débit, et mesurer. Contrainte: ne rien changer
pour quelqu'un dont la connexion va bien.

#### Mesurer d'abord, sur du vrai contenu

Un encodeur ne se règle pas sur une mire. `capture.mjs` enregistre le flux tel
qu'il sort du worker, et `stir.mjs` fait bouger le jeu pour qu'il y ait quelque
chose à enregistrer. Deux clips: l'écran de titre de Mario Kart, et une course.

| clip | p50 | p95 | p99 | **max** | débit |
|---|---|---|---|---|---|
| écran de titre | 662 | 1 132 | 1 237 | **97 297** | 0,39 Mbit/s |
| course | 26 928 | 36 190 | 44 554 | **94 420** | 12,90 Mbit/s |

Le premier chiffre est celui qui change tout: sur l'écran fixe, la médiane fait
662 octets et la pointe 97 297. **Soixante-dix-huit fois le p99.** Et la pointe
vaut 95 ko dans les deux régimes, que le jeu bouge ou non.

C'est donc l'**image-clé**, et rien d'autre. Une image-clé se code entière, sans
référence, donc sa taille dépend du détail de la scène et pas de son mouvement.
Sur un lien à 10 Mbit/s, ces 95 ko mettent 78 ms à passer, soit près de cinq
temps d'image. La file de sortie du spectateur en fait deux (voir 7.29): elle
déborde, le flux casse. Cette pointe arrive même quand rien ne bouge.

#### Ce qui a été essayé, et ce que ça a donné

Ré-encodage des deux clips sur la même carte, un réglage à la fois:

| réglage | ordinaires p50 / p95 / p99 | clé moyenne | pointe | SSIM |
|---|---|---|---|---|
| actuel, CQP 26 | 23 666 / 32 053 / 38 414 | 71 048 | 91 739 | 0,99131 |
| clé + 4 | 23 755 / 32 187 / 38 405 | 51 168 | 65 334 | 0,99053 |
| **clé + 8** | **23 777 / 32 428 / 41 736** | **35 977** | **48 424** | **0,99025** |
| clé + 10 | 23 762 / 32 536 / 42 989 | 29 797 | 54 182 | — |
| clé + 12 | 23 779 / 32 490 / 44 332 | 25 336 | 59 070 | 0,99010 |

**Pourquoi huit, et pas plus.** Une clé plus grossière laisse plus de travail aux
images qui la suivent, donc celles-là grossissent. À +8 la clé cesse d'être la
plus grosse image du flux et la pointe est au plus bas; au-delà elle **remonte**,
portée par les images de rattrapage. Le réglage n'est pas choisi au jugé: c'est
le point où les deux courbes se croisent.

Le bilan à +8: la pointe passe de 91,7 ko à 48,4 ko, soit 47 % de moins et 50 %
sur l'écran fixe. Les images ordinaires ne bougent pas — un demi-pour-cent à la
médiane, un et demi au p95. Le débit moyen descend de 11,53 à 11,48 Mbit/s. La
qualité perd 0,11 % de SSIM, ce qui est très en dessous de ce qu'un oeil sépare.

Répliqué sur un second clip de course, contenu différent: images ordinaires
+0,35 % à la médiane, clé moyenne −48 %, débit −0,5 %. La conclusion tient.

#### Les vrais contrôles de débit, mesurés et écartés

C'était la solution attendue, et elle perd:

- **QVBR** (qualité 26, cible 12 Mbit/s, plafond 20) divise le débit par deux,
  donc la qualité avec, ET rend une pointe **pire** qu'aujourd'hui: 120 805
  octets contre 91 739. Le pilote radeonsi de cette carte ne fait pas ce que le
  mode annonce;
- **CBR à 12 Mbit/s** plafonne bien la pointe, à 45 466. Mais il redistribue les
  bits sur toutes les images: p95 de 32 053 à 29 114, p99 de 38 414 à 34 056.
  C'est précisément ce qu'on s'était interdit de toucher;
- **VBR 12/16 Mbit/s**: même objection, mêmes chiffres à peu près.

Le réglage retenu ne touche qu'une image toutes les dix secondes. C'est la seule
forme de plafond qui respecte la contrainte posée.

#### Vérifié en direct

Le worker rebâti, le même enregistrement refait sur la salle réelle:

| | avant | après |
|---|---|---|
| écran fixe, pointe | 97 297 | **50 158** |
| course, pointe | 94 420 | **57 570** |

Les médianes des deux courses live ne se comparent pas, et il faut le dire: deux
courses tirées au hasard ne montrent pas la même chose à l'écran, donc l'écart de
14 % entre leurs médianes est de la scène et pas du réglage. C'est l'expérience
hors ligne, à contenu identique, qui répond à cette question-là; la mesure en
direct ne confirme que la pointe, qui est ce qu'on visait.

#### Ce qui garde le réglage honnête

`capture.mjs` accepte `NEL3AB_PEAK_UNDER`: en dessous il passe, au-dessus il
échoue. Si un jour ffmpeg change d'avis sur `i_quant_offset` ou qu'un pilote
l'ignore, la pointe redouble en silence et cette ligne est ce qui s'en aperçoit.
Elle n'est pas dans `just check`, parce qu'elle a besoin d'une salle qui tourne
et d'un GPU: c'est une mesure de la même famille que `just gpu-test`.

#### Ce que ça ne règle pas

En course, le flux demande 12,9 Mbit/s de moyenne. Une connexion moyenne y est à
sa limite quelles que soient les pointes, et aucun réglage d'image-clé n'y peut
rien. Baisser cette moyenne veut dire baisser la qualité pour tout le monde, ou
encoder deux fois. Les deux restent ouvertes.

#### Un test qui échouait une fois sur vingt-cinq

`just check` est passé au rouge sur un test des jaquettes, puis au vert en le
rejouant. Un test intermittent est un défaut à part entière, parce qu'il apprend
à l'oeil à rejouer au lieu de lire. Mesuré plutôt que supposé: **un échec sur 25
exécutions en parallèle, zéro sur 15 en série**. Puis l'erreur elle-même, en
l'affichant au lieu de la deviner: `ETXTBSY`, « Text file busy ».

C'est une course connue sous Linux. Écrire un fichier exécutable puis le lancer
depuis un programme à plusieurs fils échoue parfois: un autre fil qui se duplique
pendant l'écriture hérite du descripteur ouvert en écriture, et l'exécution
refuse tant qu'il est ouvert. Les tests écrivaient chacun un faux `dolphin-tool`.

Deux d'entre eux n'avaient aucun besoin d'un script: « sort en disant oui sans
rien écrire » est `/bin/true`, et « sort en disant non » est `/bin/false`. Ceux-là
ne peuvent plus courir du tout. Le dernier a besoin d'un outil qui réussit, donc
d'un script, et il réessaie.

Mais le plus important est ce que la course a révélé dans le code lui-même. Un
échec à DÉMARRER l'outil écrivait le témoin « ce disque n'a pas de jaquette ». Un
Docker qui redémarre au mauvais moment condamnait donc un jeu à n'avoir plus
jamais d'image, jusqu'à ce que quelqu'un vide le cache à la main. Le témoin n'est
plus écrit que pour une vraie réponse: l'outil a tourné et a dit non, ou le
disque n'a effectivement pas de bannière.
---

## 8. Les pièges qui ont coûté du temps, et ce qu'ils ont appris

| Le piège | Ce qui s'est passé | La leçon |
|---|---|---|
| `/dev/shm` à 64 Mo | Dolphin meurt en `SIGBUS`, **aucun log** | Un plantage muet dans Docker : regarder les limites du conteneur avant le code |
| Le dumper d'images | Le test passait grâce à la chose qu'on supprimait | Rejouer un test en enlevant tout ce qui n'est pas censé compter |
| `vaDeriveImage` | 99,6 % de l'image annoncée fausse, à tort | Quand le pilote est l'autorité, demander au pilote |
| `docker exec` sans `-i` | Le script reçoit EOF, ne fait rien, **et rapporte un succès** | Vérifier l'effet, pas le code de retour |
| Deux tests verts avec le bug remis | Ils lisaient la bonne chose au mauvais endroit | Vérifier en réintroduisant le bug, jamais en raisonnant |
| Une édition qui ne s'applique pas | Un remplacement de texte ne trouve pas sa cible (le formateur était passé avant), ne dit rien, et le test suivant échoue pour une **autre** raison — qui masque le no-op | Le même piège que `docker exec` sans `-i`, sous une autre forme : vérifier l'effet, pas l'absence d'erreur |
| Une relecture ne prouve pas ce qu'on croit | Relire les pixels écrits pour vérifier le rangement mémoire : **ça passe même avec un rangement faux**, parce que l'écriture et la lecture traversent la même déclaration. Un mensonge cohérent avec lui-même est invisible à un aller-retour à travers lui | Vérifier une déclaration contre **l'autre partie**, pas contre soi-même. Ici : comparer ce qu'on a déclaré à ce que la surface est vraiment |
| **Troisième** test vert avec le bug remis | Déclarer un rangement *linéaire* pour une image tuilée : le pilote accepte, crée l'image, renvoie succès. Seuls les pixels auraient protesté, bien plus tard | Corrigé en **demandant à Vulkan** quel rangement l'image porte vraiment, au lieu de se fier à ce qu'on avait déclaré. Encore une fois : quand le pilote est l'autorité, l'interroger |
| Poussé avec `just check` rouge | Vu l'échec, poussé quand même | Corrigé dans un commit dont le message le dit |
| Divergence local / CI | La CI ajoutait `-D warnings`, pas le `justfile` | `just check` doit être *exactement* ce que la CI fait |
| La CI ne voit pas le GPU | En rendant le worker dépendant du GPU, Cargo a unifié les options et **lancé les tests GPU sur un runner qui n'en a pas**. Une option confondait deux choses : *compiler* le code GPU (il suffit d'en-têtes) et *l'exécuter* (il faut une carte) | Deux options séparées, et une porte **locale** obligatoire avant tout commit (`just`). Une pipeline verte ne dit rien de la moitié du projet qui compte le plus |
| Poussé rouge, trois fois | `just check` affiche ROUGE, on pousse quand même. La troisième fois, un ROUGE **fallacieux** plus tôt avait appris à l'œil à ignorer la sortie | Ne jamais mettre `just check` et `git push` dans la même commande. Un signal qu'on s'est appris à ignorer est pire que pas de signal |
| Le shim C casse la CI | La machine de CI n'a pas de GPU, ce qui allait très bien tant que l'analyse de code ne *compilait* rien. Le shim, lui, compile du vrai C et exige de vrais en-têtes | Une dépendance de compilation n'a pas les mêmes besoins qu'une dépendance d'exécution. Vert en local ne dit rien tant que la CI n'a pas la même matière |
| Binaires compilés commités | Des exécutables dans le dépôt | Supprimés et ignorés |
| `pkill -f <motif>` | Le motif correspondait à sa propre ligne de commande, tuant le shell | — |
| Symboles de debug | Le dépôt propose Mesa 24.0.5, la machine a la 25.2.8 | Abandonné plutôt que d'insister ; source apt retirée après |

Et ceux de M3, qui sont d'une autre nature : ce ne sont plus des pièges du
matériel, ce sont des **instruments qui mentent** et des **tests qui ne peuvent
pas échouer**.

| Le piège | Ce qui s'est passé | La leçon |
|---|---|---|
| L'instrument étouffait ce qu'il mesurait | Pour compter les images distinctes, la page lisait cinq mégaoctets de pixels soixante fois par seconde. Réponse : « quatre images par seconde ». Fausse : la mesure privait la page du temps de peindre | Un instrument qui consomme la ressource qu'il mesure ne mesure plus rien |
| Un facteur exactement rond | Le son arrivait « deux fois trop vite ». Je lisais 1920 trames toutes les 20 ms, or 1920 trames à 48 kHz font **40 ms** | Quand la mesure et la théorie diffèrent d'un facteur rond, le suspect est l'instrument, pas le système |
| Le générateur de charge ne générait rien | Trois passages de banc comparaient une latence d'entrée… d'un autre navigateur. Le banc avait envoyé **zéro** trame de manette | Un générateur de charge se vérifie, il ne se suppose pas |
| Un contrôle qui donne un écart énorme | Dolphin « sans notre crochet » consommait 26 points de CPU en moins. Le contrôle était faux, et sa propre mesure le disait : **GPU à 0 %**, donc le jeu ne rendait rien | Un écart énorme mérite plus de méfiance qu'un écart nul : qu'est-ce qui, dans le montage, pourrait le fabriquer tout seul ? |
| Un test qui ne pouvait pas échouer | Il surveillait la file du décodeur ; cette machine est trop rapide pour en accumuler une. Vert avec le correctif, vert sans | Vérifier l'invariant (« ce que personne ne peint n'est pas décodé »), pas le symptôme |
| Un test qui comptait des morceaux | « 50 morceaux par seconde » est tombé le jour où les morceaux ont fait 10 ms, sans qu'aucun comportement ne change | Compter des secondes de son contre des secondes d'horloge : ça survit à l'implémentation et attrape en plus une fréquence fausse |
| Un test qui pendait | En désactivant exprès la fonctionnalité gardée, le test a avalé des pings pour l'éternité au lieu d'échouer | Toute attente a une échéance. Un test qui pend ne dit rien |
| Un test qui échoue sans défaut | Deux essais exigeaient une salle vide et échouaient pendant qu'on jouait à côté | Ils annoncent « RIEN TESTÉ ». Un test qui échoue sans défaut apprend à ignorer ses échecs |
| Le même nom deux fois | `held` était déjà l'ensemble des touches enfoncées. Un module qui déclare deux fois le même nom **ne s'exécute pas du tout** — et la page ressemble alors à une page qui attend | La renommée n'a corrigé que la moitié du fichier : la ligne de statistiques appelait encore l'ancien nom, un `Set` n'a pas de `.length`, et la mesure affichait 0 en toute confiance |
| Le vrai coupable, c'était nous | Le « bogue de pool de descripteurs de Dolphin » que j'ai instrumenté pendant des jours venait de **notre** soumission par image. Deux correctifs précédents traitaient les symptômes, et le Resizable BAR n'avait fait que ralentir la panne | Quand on ajoute du code dans le moteur de quelqu'un d'autre, la première hypothèse pour toute anomalie de ce moteur doit être la nôtre |
| Un message lu à la mauvaise longueur | En portant la boucle d'entrée, j'ai lu le message de place comme **un** octet ; il en fait six. Rien n'a échoué : la page se chargeait, l'image arrivait, et aucune manette n'apparaissait jamais. Le code refusait poliment, exactement comme il devait, et se taisait | La forme d'un message est ce qu'un test unitaire fixe le mieux. Devenue une fonction pure avec ses jumeaux négatifs : trop court, trop long, salle impossible, place au-delà de la salle |
| Reconstruire pour comparer | Le garde-fou contre une page périmée reconstruisait le HTML et comparait. **Rouge sur des sources inchangées** : le minificateur renomme trois locales d'une exécution à l'autre | Marquer les entrées, pas la sortie d'une seconde construction. Un contrôle rouge sans raison est un contrôle qu'on apprend à ignorer, et ce tableau en a déjà la preuve deux lignes plus haut |
| Un pilote plus rapide que la page | L'ancienne page était un script, son interface de test existait dès l'analyse. La nouvelle est un module : elle apparaît quelques millisecondes plus tard, et un pilote qui regardait dans l'intervalle plantait | La page répond zéro avant d'exister. Un pilote qui reçoit un chiffre attend ; un pilote qui reçoit `undefined` invente un échec |
| La CI disait qu'elle faisait comme en local | Elle lançait trois recettes Rust une par une, sous un commentaire promettant « les mêmes qu'en local ». `just check` avait grossi de deux étapes depuis: le service Python et toute la page n'étaient couverts par rien | Appeler la porte elle-même, pas la liste de ce qu'elle contient. Une promesse tenue par attention se rompt le jour où on ajoute une ligne |
| Une configuration de lint jamais lue | `oxlint.json` portait les catégories en erreur; oxlint ne lit que `.oxlintrc.json`. Ces règles n'ont jamais tourné | Une configuration qu'on croit active fait croire qu'un filet existe. Vérifier où l'outil regarde, pas où on a écrit |
| Un portage qui défait un correctif | La page délogée se rebranchait toute seule sur la prise libre suivante: exactement le défaut trouvé par le joueur en M3, réintroduit en transcrivant la reconnexion polie sans distinguer « jamais eu de place » de « on me l'a prise » | Un portage est une réécriture. Les essais d'une page ne survivent pas parce qu'ils existent, mais parce qu'on les relance |
| Un SYN jeté ressemble à une panne | Un invité voyait la salle charger sans fin. Ni refus, ni erreur de certificat: le filtre de paquets du tailnet lui ouvrait 8444 et des ports en 48xxx, mais pas le 8443 de la salle | Le symptôme nomme la couche: un refus est un port fermé, un silence est un paquet jeté. Et le filtre effectif se lit sur la machine (`tailscale debug netmap`) plutôt que dans une politique qu'on interprète |
| Deux passages de banc qui comparaient des écrans | Le premier passage sur la nouvelle page donnait 0,40 Mbit/s là où les précédents en donnaient 16 à 19, et un encodage 13 % moins cher, au-dessus du plancher de bruit. La salle était restée sur un écran-titre **fixe** | Le banc prend la manette mais ne joue pas: il ne pilote pas la scène. Il annonce maintenant lui-même quand il est passé sous 3 Mbit/s, parce que comparer deux passages dont le débit diffère d'un ordre de grandeur compare des écrans et pas du code |
| Une commande, deux boutons | Sur une manette standard, le L de la GameCube répond à la tranche ET à la gâchette: le clic d'un côté, la course de l'autre. L'antisèche n'en montrait qu'une | Deux tests qui refusent d'être d'accord valent mieux qu'un seul qui se tait. Ce que le code fait vraiment se lit dans le code, pas dans le souvenir qu'on en a |
| `code` nomme une position, pas une lettre | `KeyboardEvent.code` décrit l'emplacement physique d'après un clavier américain: sur un azerty, la touche marquée A rend `KeyQ`. Afficher « Q » ressemble à un configurateur cassé | Demander au navigateur ce qui est IMPRIMÉ (`getLayoutMap`) pour l'affichage, et garder la position pour jouer. Les deux besoins sont différents et n'ont pas la même réponse |
| Un bouton qui répond une demi-seconde après | React lit un instantané deux fois par seconde: la bonne cadence pour lire des mesures, la mauvaise pour répondre à un clic | Reconstruire l'instantané après une action de la personne, plutôt que garder une copie locale dans le composant, qui aurait été une deuxième source de vérité |
| Zéro qui n'était pas zéro | `0 * -1` rend `-0`, que `Object.is` distingue de `0`. Le jeu n'a jamais rien vu, mais le test qui compare deux façons de lire la même manette échouait | Retirer la bizarrerie à la source plutôt que l'accommoder dans le test: un test qui s'en accommode décrit le langage et pas le sujet |
| Un correctif pour la mauvaise couche | `PAL60 = True` sous `[Core]` devait faire tourner les jeux PAL à 60 Hz. Dans ce Dolphin, `SYSCONF_PAL60` est un réglage **SYSCONF**, affiché dans les options Wii, et ses deux usages sont gardés derrière `IsWii()` | Un correctif proposé pour la mauvaise couche ressemble à un correctif: il aurait été ajouté, rien ne se serait passé, et un essai raté aurait fourni l'explication. Lire la source de la version épinglée coûte cinq minutes |
| Une source plus lente prise pour une panne | Un jeu PAL tourne à 50 Hz: sur 60 tics d'affichage par seconde, une dizaine ne trouvent rien de neuf. La page comptait une famine à chaque fois et ajoutait 35 ms de marge pour compenser | Comparer le temps depuis la dernière ARRIVÉE à la période de la source, pas la longueur de la file. Une file vide ne dit rien d'autre que « l'écran est plus rapide que le jeu » |
| Une région supposée d'après un nom de fichier | Les saccades de Melee ont été attribuées à une version PAL. Melee est `GALE01`, NTSC-U, et aucun jeu PAL n'avait jamais démarré sur ce worker | L'en-tête du disque le dit en une commande. Un nom de fichier est ce que quelqu'un a tapé |
| Enlever toutes les parenthèses | Nettoyer `(Europe) (En,Fr,De,Es,It) (Rev 2)` d'un nom de jeu, par une règle qui retire tout ce qui est entre parenthèses. Un des jeux de la bibliothèque s'appelle `Mario Kart Double Dash (Retro Track Grand Prix)`: la parenthèse est le nom du hack | Une règle de nettoyage se fait sur des formes CONNUES, pas sur une syntaxe. Et le jumeau négatif du test est le titre dont la parenthèse compte |
| `innerText` rend le texte transformé | Un essai cherchait « dans la salle » dans une page qui affichait `1 DANS LA SALLE`: l'étiquette est mise en majuscules par le style, et `innerText` rend le rendu, pas la source | Comparer sans tenir compte de la casse, ou lire l'attribut plutôt que le texte. Et se rappeler que la sortie de l'essai contenait déjà la réponse |
| Une limite écrite deux fois | Le contrôleur coupait un pseudo à 24 caractères, le schéma en refusait 25. Deux limites à garder d'accord pour la même règle | La longueur est le contrat, donc elle vit dans le schéma, qui la publie dans l'OpenAPI. Le contrôleur ne garde que ce que le schéma ne peut pas voir |
| Une diffusion qui interroge un service à chaque événement | Le salon appelait le worker pour décrire la salle à chaque connexion, départ et changement de pseudo. Invisible jusqu'au jour où changer de jeu redémarre le worker et où toutes les pages se reconnectent pendant ce redémarrage | Garder la dernière réponse et s'en servir quand la source ne répond pas, avec le jumeau négatif: n'avoir JAMAIS eu de réponse reste une erreur |
| Une place rangée par nom | Les manettes étaient retenues sous le nom de qui les tenait. Deux appareils d'une même personne portent le même nom: fermer un onglet libérait la manette de l'autre machine, et la salle affichait une place pour deux | Une ressource appartient à une SESSION, pas à une personne. Le nom sert à l'afficher, jamais à identifier |
| Une règle qui ne vit que dans l'interface | « Seul le propriétaire change le jeu » était appliqué par la page, et le worker obéissait à qui tenait une manette. Une console de développeur suffisait | Une règle se met là où l'ordre arrive. Et l'essai doit être au même endroit: un pilote de navigateur ne peut pas attraper ce qu'une page n'envoie jamais |
| Une édition qui n'a rien édité, et un commit qui l'affirmait | Un remplacement de texte n'a trouvé aucune cible dans `Seats.tsx`, n'a rien dit, et le message de commit annonçait la règle comme appliquée. Elle ne l'était que dans un composant supprimé depuis | Toute édition scriptée porte une assertion. Et ce qu'un message de commit affirme se vérifie dans le produit, pas dans l'intention |
| Un pilote qui expire sans que la page soit bloquée | `waitForSelector` et `page.click` font plusieurs allers-retours au navigateur; deux pages qui décodent 60 images par seconde suffisent à les faire expirer | Cliquer depuis la page en un seul appel. Troisième fois que l'instrument est le problème et que le symptôme accuse le sujet |
| Une touche comptée deux fois | Le menu écoutait `keydown` et la boucle d'entrée lisait aussi le clavier pour le conduire à la manette: une flèche avançait de deux crans. Et ça n'arrivait QUE sans manette branchée, donc l'essai à manette simulée passait à côté | Une entrée, un propriétaire. Et l'assertion utile n'est pas « ça bouge » mais « ça bouge d'exactement un cran »: une addition ne se voit qu'en comptant |
| Une jaquette fabriquée alors que la vraie était là | On dessinait une couleur et deux lettres par jeu, faute d'image. Chaque disque en contient une, avec le nom du studio et une phrase, depuis toujours | Avant d'inventer une donnée, chercher si l'objet la porte déjà. Un fichier de jeu est un système de fichiers, pas une boîte noire |
| Deux encodages sous un seul type | RGB5A3 choisit par le bit de poids fort entre cinq bits sans alpha et quatre bits avec. Ne lire qu'une branche donne une image complète et fausse | Quand un format a un aiguillage, tester les DEUX sorties. Un décodeur à demi juste ne produit pas de vide, il produit du plausible |
| Un plafond sous la gigue qu'il devait absorber | La marge d'affichage s'arrêtait à 60 ms; le p95 des écarts d'arrivée d'un ami en faisait 67. Sa page est restée collée au plafond en comptant 513 famines | Un seuil se règle sur la grandeur qu'il borne, pas sur ce qui suffisait aux machines d'essai |
| L'horaire recalé sur l'image la plus chanceuse | Le calage prenait le transit le plus rapide de la fenêtre, et repartait de là à chaque famine. Sur un lien irrégulier, chaque trou reposait l'horaire au plus optimiste et provoquait le suivant | Se caler sur le meilleur cas, c'est jeter tout ce qui n'est pas le meilleur cas |
| La cadence de la source lue sur les arrivées | Une source à 60 Hz livrée toutes les 26 ms était prise pour une source à 39 Hz, donc ses trous passaient pour normaux | Deux causes différentes ont besoin de deux mesures différentes. Les instants de capture décrivent le jeu, les arrivées décrivent le réseau |
| Une image jetée au milieu d'un groupe | La file pleine jetait l'image, les suivantes référençaient celle qui manquait, et le navigateur décodait du bruit: 306 non décodables contre 192 décodées | Dans un flux où les morceaux dépendent les uns des autres, se taire jusqu'au prochain point d'entrée vaut mieux que continuer à parler |
| Un plafond de débit qui plafonne tout | QVBR et CBR bornaient bien la pointe, mais en redistribuant les bits sur toutes les images — et QVBR rendait même la pointe pire. Le réglage retenu ne touche qu'une image toutes les dix secondes | Quand une contrainte dit « sans toucher au reste », le levier se cherche là où la pointe naît, pas là où le débit se règle |
| Un échec transitoire mis en cache | Ne pas réussir à LANCER l'outil d'extraction écrivait le même témoin que « ce disque n'a pas de jaquette ». Un Docker qui redémarre condamnait un jeu pour toujours | Un cache d'échec ne doit retenir que des réponses. « Je n'ai pas pu demander » n'en est pas une |
| L'étranglement réseau de Chrome | Il ne touche pas les WebSockets: 2 Mbit/s de plafond, et la page peignait toujours 50 images par seconde. Tout ce que ce projet envoie est une WebSocket | Un instrument se vérifie sur un cas où il DOIT bouger, avant de croire ce qu'il dit quand il ne bouge pas |
| Une confirmation invisible | La première pression armait le changement de jeu sans rien afficher, donc elle ressemblait à un clic manqué et appelait la seconde | Une confirmation qui ne se voit pas est une confirmation qui pousse au geste qu'elle voulait empêcher |
| Un mur de tuiles identiques | Les jeux s'affichaient en carrés gris tous pareils: rien ne plantait, mais il fallait relire huit titres pour retrouver le sien | Une liste d'objets a besoin d'un signe **par objet**. À défaut d'image, on en fabrique un — et le test qui compte n'est pas « la couleur est stable » mais « deux titres presque identiques tombent loin l'un de l'autre » |
| Un réglage accroché à un axe | « Régler une valeur » était gauche/droite, mais gauche/droite ne veut pas dire la même chose dans une colonne et dans une rangée: le réglage du menu changeait de page | Accrocher un réglage au geste qui existe partout, « choisir ». Et ne pas écrire dans l'indice le nom d'un axe qui dépend de l'écran |

---

## 9. Les décisions, en résumé

| | Décision | En clair |
|---|---|---|
| **D1** | On n'écrit pas d'émulateur | On intègre Dolphin. La règle générale : ne pas réécrire un objet de cette taille |
| **D2** | Rust pour le worker | Pas de plantage possible dans une partie en cours ; la couche au-dessus reste en Python/TypeScript |
| **D3** | Les manettes sont normalisées **dans le navigateur** | Le serveur reçoit une forme unique quel que soit le matériel du joueur |
| **D4** | L'attribution des places est un état serveur | Deux joueurs ne peuvent pas revendiquer la même place |
| **D5** | Topologie « Sunshine » : allouer côté encodeur **d'abord** | Évite le refus DCC et supprime une passe de conversion |
| **D6** | Client TypeScript généré | Pas de types recopiés à la main entre serveur et navigateur |
| **D7** | libavcodec encode | Application de D1 : un encodeur H.264 conforme n'est pas à écrire |
| **D8** | Vulkan lié directement avec `ash`, sans shim | La raison du shim (l'ABI instable de ffmpeg) n'existe pas pour Vulkan, et la logique risquée doit rester en Rust |
| **D9** | Nos octets sur une socket simple, décodés par WebCodecs, plutôt que WebRTC | WebRTC donne gratuitement la reprise sur perte et le contrôle de congestion, contre une négociation lourde et la perte du contrôle de l'instant d'envoi. Sur un réseau privé entre gens qui se connaissent, le marché est mauvais. **Le jour où ça sort du tailnet, c'est la première décision à rouvrir** |
| **D10** | Le son voyage en PCM brut, sans codec | 1,5 Mbit/s contre seize pour l'image. Un codec ajouterait un décodeur de plus dans la page — et ce milestone a passé des jours sur les façons dont le **premier** peut mourir |
| **D11** | Les images-clés se demandent, elles ne se programment pas | Une image-clé pèse six fois une image ordinaire ; une par seconde pour personne, c'est une bosse par seconde sur le réseau. Le serveur en accorde au plus deux par seconde, quoi qu'on lui demande |
| **D12** | Le plan de contrôle ne touche jamais une image | Le worker sait qui tient une manette, le service Python sait comment il s'appelle. Arrêter le second n'interrompt pas une partie |
| **D13** | La page est un artefact committé, et marqué | `cargo build` n'a jamais besoin de node ; une marque sur les sources ET sur la page produite attrape celle qu'on a oublié de reconstruire |

---

## 10. Où on en est

**On y joue.** Depuis un navigateur, sur le réseau privé, avec le son, une
manette configurée et jusqu'à quatre joueurs. Ce qui suit est mesuré sur la
machine, pas estimé.

### La chaîne, de bout en bout

```
Dolphin ──image──► Vulkan (conversion) ──► encodeur matériel ──► navigateur
   ▲                                                                  │
   └────────────────────── manette ◄──────────────────────────────────┘
   └──son──► tuyau ALSA ──► worker ──────────────────────────────────►┘
```

| | mesuré | dans quelles conditions |
|---|---|---|
| images | 59,91 à 59,93 /s, **zéro jetée** | 90 s, un spectateur |
| conversion couleur | 0,13 ms p50, 0,18 au p95 | mesuré en M2, en 640×480 |
| encodage | 1,96 ms médian, 3,41 ms au pire | en 1280×960, jeu en mouvement |
| entrée → image | 5,18 ms p50, 15,58 au p95 | le p95 est une trame : c'est la frontière de trame, pas notre code |
| son | 188 Kio/s pour 187,5 attendus | 998 morceaux en 20 s |
| décalage son/image | **54 ms**, et la page peut le supprimer en retardant l'image | 390 ms au départ : le tuyau en cachait 341 (6.64), le navigateur en rendait 24 de trop (6.65), et le chiffre lui-même était faux (6.66) |
| débit | 5,5 Mbit/s sur une scène calme, 16 à 17 sur une scène chargée | 1280×960 |
| coût d'une salle | Dolphin 49,6 à 53,6 % d'un cœur, worker ~4,4 %, GPU médian 4 % | douze cœurs, une seule salle |

Deux réserves sur ce tableau. La conversion couleur n'a pas été remesurée depuis
le passage en 1280×960, donc la ligne est un plancher et pas la valeur du jour.
Et l'entrée→image se mesure sur la machine, pas chez le joueur : il faut y
ajouter le réseau et la sortie de son écran.

La ligne la plus intéressante pour la suite est la dernière : **le GPU est à
4 %**. Ce n'est donc pas lui qui limitera le nombre de salles, c'est le cœur que
Dolphin consomme. Douze cœurs divisés par un demi-cœur par salle laissent de la
place pour plusieurs parties simultanées — mais c'est une division, pas une
mesure : personne n'a encore lancé deux salles à la fois, et la mémoire de la
carte, elle, ne se divise pas aussi bien.

### Ce qui existe et qui n'existait pas au début de M3

- une page qui décode, ordonnance et peint sur l'horloge de la source ;
- quatre prises de manette dessinées, cliquables, qui montrent qui est où ;
- du son, avec un réglage de volume et le choix du compromis image/son ;
- une manette qui s'apprend toute seule, y compris une vraie GameCube sur
  adaptateur ;
- un banc d'essai reproductible, avec son plancher de bruit mesuré ;
- sept essais de navigateur et vingt-cinq tests de transport.

### Ce que M4 a ajouté

- un plan de contrôle en FastAPI, qui sait le nom du salon et celui des joueurs,
  et qu'on peut arrêter sans interrompre une partie ;
- un salon en socket.io : qui arrive, qui part, qui prend quelle place ;
- une page React, TypeScript et Tailwind, dont la boucle média reste hors de
  React et peint toujours toutes les images qui arrivent ;
- un client TypeScript engendré depuis le document OpenAPI de FastAPI ;
- un prénom, gardé dans le navigateur, et **rien d'autre en fait
  d'identification** ;
- un écran de salle avant d'entrer : le jeu en cours, qui est déjà là, ce qui
  reste de libre, et rien qui démarre avant le clic ;
- deux portes de plus dans `just check` : les types, les lints et les tests de la
  page avec la marque qui dit qu'elle a bien été reconstruite, et la fraîcheur du
  document OpenAPI et du client engendré ;
- une CI qui fait vraiment ce qu'elle annonce, c'est-à-dire `just check` ;
- une identité vérifiée sans inscription ni mot de passe, et un pseudo qui
  appartient à la personne plutôt qu'à son navigateur ;
- la liste de qui est dans la salle, spectateurs compris ;
- un thème clair, un thème sombre, et le choix de suivre le système ;
- une antisèche qui nomme les boutons dans le vocabulaire de la manette qu'on
  tient, et qui se modifie ligne par ligne, au clavier comme à la manette.

### Ce qui n'est pas fait, et qu'il faut dire

**Le service SAIT qui est là, mais ne s'en sert pas encore pour refuser quoi que
ce soit.** Depuis 7.21, chaque personne arrive avec une adresse que le proxy
garantit. Ce qui manque est l'étage au-dessus: personne ne vérifie encore cette
identité avant de laisser prendre une manette ou changer de jeu, et le worker,
lui, ne la connaît pas du tout. Quiconque atteint le tailnet peut donc encore
regarder, écouter, jouer et changer le jeu de tout le monde. La différence avec
avant est qu'on sait maintenant QUI, et qu'il y a de quoi construire la règle.

**Il y a un salon, mais pas de salons.** Le plan de contrôle décrit **la**
salle : celle que ce worker fait tourner. Créer une partie, en avoir deux, inviter
quelqu'un : rien de tout ça n'existe encore. Le contrôleur garde son état en
mémoire, ce qui est le bon choix tant qu'il y a une machine, un GPU et un
émulateur, et ce qui change le jour où il y en a deux.

**Une seule partie à la fois.** Le code ne l'interdit pas — chaque worker a son
port et son dossier — mais rien n'orchestre plusieurs salles.

**La mémoire GPU n'a pas été observée sur une longue partie** depuis le correctif
du cliquet. Elle montait encore doucement à dix-sept minutes, ce qui ressemble au
remplissage normal du cache de textures, et Dolphin seul se stabilise. À
surveiller plutôt qu'à supposer.

### La suite

Les comptes et le jeton signé qui les relie au worker, c'est-à-dire ce qui ferme
le trou d'authentification. Puis plusieurs salles, ce qui demandera de sortir
l'état du salon de la mémoire d'un processus.

Les deux dettes de mesure sont payées : le banc a tourné sur la nouvelle page et
ne trouve aucun écart (7.4), et les dix-neuf essais de navigateur sont passés,
dont trois qui ont d'abord trouvé de vraies régressions (7.11).

---

## 11. Glossaire complet

**ABI** — *Application Binary Interface*. La disposition exacte des données en
mémoire. Un désaccord d'ABI ne produit pas d'erreur, seulement des valeurs
absurdes.

**ADR** — *Architecture Decision Record*. Un document qui fige une décision **et
sa raison**, pour qu'on ne la re-débatte pas six mois plus tard.

**ALSA** — *Advanced Linux Sound Architecture*. La couche son du noyau Linux.
On lui a demandé d'écrire dans un fichier plutôt que dans une carte : le
greffon `file`, avec un esclave `null`, c'est-à-dire aucun matériel derrière.
Conséquence : rien ne cadence le flux, donc c'est au lecteur de le faire.

**Anneau / ring buffer** — un petit ensemble de cases réutilisées en boucle. Ici,
trois images : pendant que le worker en lit une, Dolphin écrit dans une autre.

**Annex B** — la façon de découper un flux H.264 en semant un marqueur `00 00
00 01` avant chaque morceau. C'est ce que le décodeur du navigateur attend
quand on lui donne des octets bruts.

**ASCII** — le jeu de caractères le plus simple : lettres non accentuées,
chiffres, ponctuation, un octet chacun. Utilisé ici pour les dessins de schémas
et les en-têtes de protocole.

**ash** — la bibliothèque de liaison Rust ↔ Vulkan. Pré-générée, donc sans outil
de génération à la compilation.

**Banc d'essai (*benchmark*)** — un programme qui rejoue toujours la même
charge pour comparer deux versions. Le nôtre chauffe 45 secondes, mesure 90
secondes, et garde ses mesures brutes. Il refuse d'afficher la latence de
manette s'il n'a pas lui-même pris une manette, parce qu'il a déjà mesuré trois
fois celle d'un autre navigateur.

**baseLatency / outputLatency** — deux mesures que le navigateur donne sur sa
sortie audio. `baseLatency` est ce qu'il s'accorde pour préparer le son,
quelques millisecondes. `outputLatency` ajoute ce que le système et la carte
prennent après lui. C'est le second qui explique nos 48 ms, et il n'est pas de
notre ressort.

**BIOS** — le programme du fabricant qui démarre la machine avant le système.
C'est lui qui décide de ce que le processeur voit de la carte graphique. Voir
Resizable BAR.

**Bitstream** — le flux d'octets qui constitue la vidéo compressée. Ses champs ne
sont pas alignés sur les octets, d'où un « écrivain de bits » dédié.

**BT.601 / BT.709** — deux normes de conversion couleur. BT.601 pour la vidéo
standard, BT.709 pour la HD. Les confondre donne une image aux teintes décalées.

**canvas** — la zone de dessin d'une page web. C'est là que les images décodées
sont peintes.

**Chemin critique** — la suite d'étapes qu'un appui de bouton traverse avant de
devenir une image à l'écran. Ce qui n'est pas dessus n'a pas besoin d'être
rapide, et c'est ce qui décide dans quel langage on écrit quoi.

**CI** — *Continuous Integration*. Le service qui recompile et reteste
automatiquement à chaque envoi de code. Une tâche n'est pas finie tant qu'elle
n'est pas verte.

**Clippy** — l'analyseur de code de Rust. Configuré ici en mode strict : tout
avertissement est une erreur.

**Cliquet** — un mécanisme qui ne tourne que dans un sens. Ici, Dolphin
agrandit son pool de descripteurs quand il en manque et ne le réduit jamais :
une fuite plutôt qu'un pic.

**Codec** — *codeur-décodeur*. Le couple d'algorithmes qui compresse d'un côté
et décompresse de l'autre. H.264 pour l'image ; aucun pour le son (D10).

**Conteneur / Docker** — un processus isolé du reste de la machine, avec ses
propres fichiers et son propre réseau, mais qui utilise le même noyau. Dolphin
tourne dedans, ce qui fige sa version et ses bibliothèques. À ne pas confondre
avec une machine virtuelle : il n'y a pas de second système.

**DCC** — *Delta Colour Compression*. Compression interne AMD, invisible pour le
rendu 3D, **illisible par l'encodeur vidéo** avant RDNA4. Toute la décision D5
existe à cause d'elle.

**Descripteur (de fichier)** — le numéro qu'un programme reçoit en échange d'un
fichier ouvert, d'une socket ou d'un tuyau. Il y en a un nombre fini par
processus, et Dolphin plante en silence quand il n'en reste plus.

**Descripteur (GPU) / pool de descripteurs** — côté Vulkan, un descripteur dit
à une commande à quoi elle a le droit de toucher : telle image, tel tampon. Le
pool est la réserve où on les prend. Aucun rapport avec le précédent, malgré le
nom.

**dma-buf** — mécanisme du noyau Linux pour partager de la mémoire GPU entre
processus sans copie.

**DPB** — *Decoded Picture Buffer*. Le tampon où un codec garde les images de
référence servant à compresser les suivantes.

**Exp-Golomb** — un codage de nombres à longueur variable utilisé par H.264 : les
petites valeurs prennent peu de bits.

**Filtre de paquets (tailnet)** — la liste, calculée par Tailscale à partir de
la politique d'accès, de qui a le droit de parler à cette machine et sur quel
port. Elle est appliquée par `tailscaled` sur la machine elle-même, et se lit
avec `tailscale debug netmap`. Un paquet non autorisé est **jeté sans réponse**,
ce qui se voit comme une page qui charge sans fin plutôt que comme un refus.

**FastAPI** — un cadre logiciel Python pour écrire des serveurs web. Prévu pour
M4, hors du chemin critique.

**FFI** — *Foreign Function Interface*. Appeler du C depuis Rust. Seul endroit où
`unsafe` est toléré dans ce projet, et sous justification écrite.

**ffmpeg** — la boîte à outils libre de manipulation vidéo. On n'utilise pas le
programme, mais sa bibliothèque `libavcodec`, qui parle à l'encodeur de la
carte.

**Gigue (*jitter*)** — l'irrégularité des instants d'arrivée. Le débit moyen
peut être parfait avec une gigue qui rend l'image saccadée : ce n'est pas la
quantité qui compte, c'est la régularité.

**GTT** — *Graphics Translation Table*. La mémoire système que le GPU peut lire
directement. Quand la VRAM est pleine, les allocations tombent ici : un
compteur GTT qui monte est le signe que la VRAM déborde.

**H.264** — le format de compression vidéo utilisé. Universellement décodé par les
navigateurs, et accéléré par le matériel.

**Headless** — sans fenêtre. Utile sur un serveur, mais supprime des événements
(comme l'affichage) sur lesquels du code pouvait compter sans le dire.

**IDR** — *Instantaneous Decoder Refresh*. Une image complète, décodable seule.
Un flux commence toujours par là.

**Image-clé** — une image complète, décodable sans les précédentes. Sans elle,
un client qui arrive n'a rien à afficher. C'est l'IDR de la norme, nommé en
français.

**Intra / tout-intra** — une image compressée sans référence aux autres. Simple,
mais très coûteux en débit si toutes le sont.

**JavaScript** — le langage qui s'exécute dans le navigateur. Toute la page —
décodage, ordonnancement, manette, son — est écrite dedans.

**Jeton signé** — une chaîne que le serveur des comptes fabrique et signe, que
le navigateur présente au worker, et que le worker vérifie sans avoir à
rappeler qui que ce soit. C'est ce qui reliera les deux moitiés du système en
M4.

**kHz** — kilohertz, milliers de fois par seconde. Le son est échantillonné à
48 kHz : 48 000 mesures par seconde et par oreille.

**Kio / Mio / Mbit/s** — kibioctet (1024 octets), mébioctet, mégabit par
seconde. Les octets pour ce qui est stocké, les bits pour ce qui circule. Un
débit de 16 Mbit/s fait 2 Mio/s.

**libva** — la bibliothèque C qui implémente VAAPI.

**Milestone** — une étape du projet, avec un objectif vérifiable. M1 : sortir
une image de Dolphin. M2 : l'encoder sur le GPU. M3 : la jouer dans un
navigateur, avec le son et à plusieurs.

**Minificateur** — l'outil qui réduit un programme JavaScript en renommant les
variables et en supprimant les espaces. Ses noms courts ne sont pas garantis
identiques d'une exécution à l'autre, ce qui interdit de comparer deux
constructions octet par octet (7.5).

**Miri** — un interpréteur Rust qui détecte les comportements indéfinis. Il **ne
peut pas** exécuter de fonction C, donc il ne validera jamais un appel libva — il
sert sur l'arithmétique de pointeurs *autour* des appels, là où une erreur serait
la nôtre.

**Mixeur** — la partie du système qui additionne les sons de plusieurs
programmes avant de les envoyer à une seule carte. Le nôtre est court-circuité
: Dolphin écrit dans un tuyau, personne ne mélange.

**Modifier** — nombre de 64 bits décrivant l'agencement mémoire exact d'une image
(tuilage, compression). Deux composants doivent s'accorder dessus pour partager
une image.

**Mutation testing** — technique qui modifie volontairement le code pour vérifier
qu'un test échoue. Un test qui survit à toutes les mutations ne teste rien.

**NAL unit** — l'unité de découpage d'un flux H.264. Chaque en-tête et chaque
tranche d'image en est une.

**NAT** — *Network Address Translation*. Le mécanisme par lequel une box
partage une seule adresse publique entre toutes les machines de la maison. Il
empêche deux machines de s'appeler directement, et c'est la moitié de ce que
WebRTC sert à contourner. Sur un tailnet, le problème ne se pose pas.

**NV12** — format d'image : luminance pleine résolution, couleur au quart. Ce que
mangent les encodeurs.

**p50 / p95 / p99** — les centiles. p50 est la médiane : la moitié des mesures
sont en dessous. p95, 95 % en dessous. p99, 99 %. On les préfère à la moyenne
parce qu'une moyenne noie les rares mesures très mauvaises, et ce sont
justement celles qu'on ressent.

**Pare-feu (ufw)** — le filtre qui décide quelles connexions entrantes la
machine accepte. `ufw` est l'outil qui le configure sur Ubuntu. Le nôtre refuse
tout en entrée par défaut.

**PCIe** — le bus qui relie la carte graphique au processeur. Toute donnée qui
passe de l'un à l'autre le traverse, et c'est bien pour cela qu'on évite de l'y
faire passer.

**PCM** — *Pulse Code Modulation*. Du son non compressé : une suite de mesures
d'amplitude. Le nôtre est en `s16le`, des entiers signés de 16 bits avec
l'octet de poids faible en premier, deux voies entrelacées, 48 000 fois par
seconde.

**Pipe nommé** — un fichier spécial servant de canal entre deux processus.

**Plan de contrôle / plan de données** — deux moitiés d'un système en réseau. Le
*plan de données* transporte la marchandise : ici l'image, le son et les
manettes, dans le worker en Rust. Le *plan de contrôle* décide et décrit : qui
est là, quel jeu tourne, comment s'appellent les joueurs. Les séparer permet
d'arrêter le second sans interrompre le premier, ce qui est vérifié ici plutôt
qu'espéré (D12).

**Plan (*plane*)** — une des composantes séparées d'une image. NV12 en a deux :
luminance, et couleur entrelacée.

**Plancher de bruit** — l'écart qu'on mesure entre deux exécutions strictement
identiques. Tout gain plus petit que lui est du bruit, pas un progrès. Le
déclarer avant de mesurer évite de fêter des victoires imaginaires.

**Port** — deux sens dans ce carnet. Un *port de manette* est une des quatre
prises de la GameCube, donc un joueur. Un *port réseau* est le numéro sur
lequel un serveur écoute, 8100 pour un worker.

**Pydantic** — la bibliothèque Python qui décrit une donnée par une classe et
la valide à l'entrée. FastAPI s'en sert pour refuser une requête mal formée
avant qu'aucun code à nous ne la voie, et pour écrire le document OpenAPI à
partir de ces mêmes classes.

**Proxy** — un serveur qui reçoit une connexion et la retransmet à un autre. Le
nôtre, fourni par Tailscale, ajoute le chiffrement TLS devant un worker qui
n'en fait pas.

**RDNA2 / RDNA4** — générations d'architecture GPU AMD. La nôtre est RDNA2 ; la
limitation DCC de l'encodeur disparaît en RDNA4.

**Rééchantillonnage** — convertir un son d'une fréquence vers une autre, par
exemple 48 000 mesures par seconde vers 44 100. Coûteux et jamais exact, d'où
l'option qui laisse la carte choisir sa fréquence pour l'éviter.

**Render node** — le fichier `/dev/dri/renderD128` par lequel on parle au GPU pour
du calcul, sans droits d'affichage.

**requestAnimationFrame** — la fonction par laquelle le navigateur annonce
qu'il va peindre et demande quoi afficher. Elle suit le rafraîchissement de
l'écran, donc elle ne s'accorde pas d'elle-même avec les soixante images par
seconde de la source.

**Resizable BAR** — un réglage du BIOS qui laisse le processeur voir toute la
VRAM au lieu d'une fenêtre de 256 Mio. Il a repoussé notre plantage sans le
corriger, ce qui dit l'essentiel sur ce qu'il faut penser d'un réglage qui «
améliore » un bogue.

**RGBA** — format d'image classique : rouge, vert, bleu, transparence, par pixel.

**ROM** — le fichier contenant un jeu. On teste avec deux titres, dont les
charges GPU sont volontairement différentes.

**Salon (*lobby*)** — la partie qui dit qui est là et qui tient quelle manette,
et qui prévient tout le monde quand ça change. Elle existe depuis M4, pour **la**
salle : créer une partie, en avoir deux, inviter quelqu'un, non. Une salle reste
un worker lancé par systemd.

**Segfault** — plantage dû à un accès mémoire invalide.

**Shader de calcul** — programme GPU générique (pas seulement graphique),
travaillant sur des milliers d'éléments en parallèle.

**Shim** — fine couche d'adaptation entre deux interfaces. Ici, un fichier C entre
Rust et libavcodec.

**SIGBUS** — signal d'erreur d'accès mémoire. Dans notre cas, symptôme d'une
mémoire partagée trop petite.

**Single-file (page en un fichier)** — une construction qui replie le script et
les styles à l'intérieur du HTML, au lieu de les servir à côté. Le worker n'a
donc qu'un fichier à porter dans son binaire, et le navigateur qu'une requête à
faire.

**Socket** — le bout de connexion réseau vu par un programme. On y lit et on y
écrit comme dans un fichier.

**socket.io** — une bibliothèque au-dessus des WebSockets qui ajoute ce qu'on
réécrit sinon à chaque fois : reconnexion automatique, salles, diffusion à tout
le monde d'un coup. Utilisée ici pour le salon, jamais pour l'image.

**SPS / PPS** — *Sequence / Picture Parameter Set*. Les en-têtes H.264 qui
décrivent la taille, le format et les options du flux. Un décodeur en a besoin
avant la première image.

**Stick** — le manche analogique d'une manette. Il rend deux nombres continus,
là où un bouton en rend un binaire. D'où la zone morte, qui ignore les petites
valeurs pour qu'une manette usée ne parte pas toute seule.

**systemd** — le programme qui lance et surveille les services au démarrage de
Linux. C'est lui qui tient le worker en vie.

**Tailscale / tailnet** — un réseau privé chiffré entre machines, monté par-
dessus internet. Le *tailnet* est l'ensemble des machines qui en font partie.
Rien n'y entre sans y avoir été invité, ce qui est aujourd'hui la seule chose
qui protège le projet.

**TCP** — le protocole qui garantit que les octets arrivent tous, et dans
l'ordre. Pratique, mais il retient les octets suivants tant qu'un manquant
n'est pas retransmis : pour de la vidéo en direct, l'attente coûte souvent plus
cher que la perte.

**TLS** — le chiffrement du web, le `s` de `https`. Sans lui, le navigateur
refuse l'accès à la manette. Ce seul refus a suffi à nous obliger à le mettre
en place.

**RGB5A3** — le format d'image des textures GameCube. Un pixel tient sur seize
bits, et le bit de poids fort choisit entre deux encodages: cinq bits par couleur
sans transparence, ou quatre bits par couleur plus trois de transparence.

**RVZ** — le format de disque compressé de Dolphin. Il range le disque par blocs
compressés, donc on ne peut pas y lire un fichier sans décompresser d'abord. Sept
des huit jeux de la salle sont dans ce format.

**Tuilage (bannière)** — voir *Tuilage*. Les pixels d'une bannière GameCube
arrivent par carrés de quatre sur quatre et non ligne par ligne.

**Trame (audio)** — un instant de son, une mesure par voie. En stéréo 16 bits,
une trame fait 4 octets ; à 48 kHz, 480 trames font 10 ms.

**Tuilage (*tiling*)** — rangement d'une image par blocs plutôt que par lignes,
pour la performance GPU. Invisible tant qu'on ne lit pas la mémoire directement.

**Tuyau** — voir *Pipe nommé*. Le mot français est utilisé partout dans ce
carnet.

**unsafe** — en Rust, le mot-clé qui lève les garanties du compilateur. Interdit
dans ce projet, sauf pour la FFI et avec justification écrite.

**VAAPI** — *Video Acceleration API*. L'interface Linux vers l'encodeur/décodeur
matériel.

**VRAM** — la mémoire de la carte graphique.

**Vulkan** — interface bas niveau vers le GPU, pour le rendu et le calcul.

**WebCodecs** — l'interface qui donne au JavaScript un accès direct au décodeur
matériel du navigateur, sans passer par une balise `<video>`. C'est elle qui
nous laisse décider quand chaque image est peinte.

**WebRTC** — l'ensemble de protocoles conçu pour la visioconférence : reprise
sur perte, contrôle de congestion, traversée de pare-feu. Puissant et lourd.
Écarté en D9, à rouvrir le jour où le projet sort du tailnet.

**WebSocket** — une connexion permanente à deux sens entre une page et un
serveur, ouverte par une requête HTTP puis maintenue. Nos trois canaux — image,
son, manette — en sont.

**WebTransport** — le successeur possible de WebSocket, bâti sur QUIC, capable
d'envoyer des messages sans en garantir l'ordre. Intéressant pour de la vidéo ;
pas encore essayé ici.

**Worker** — dans ce projet, le programme qui tient une salle : il parle à
Dolphin, encode, sert la page et gère les manettes. Un worker, une partie.

**XFB** — *External Frame Buffer*. Le tampon d'où la GameCube envoyait l'image
vers la télévision. Dolphin le reproduit, et c'est là qu'on prend la nôtre. Son
option « ignorer les XFB identiques » a été notre premier suspect pendant le
gel.

**Zero-copy** — l'objectif : la donnée n'est jamais recopiée.

---

*Ce document est tenu à jour au fil du projet. Si une décision change, c'est ici
qu'on explique pourquoi — pas seulement dans l'ADR.*
