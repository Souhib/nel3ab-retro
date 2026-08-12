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

## 5bis. M3 commence — et sa première question est déjà tranchée

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

### Le décodeur avait raison

Premier essai : `EncodingError: The given encoding is not supported`. Ni le
navigateur ni le flux — **ma page**. Elle ne coupait une nouvelle image que
lorsqu'un NAL « non-tranche » suivait une tranche, donc les 118 images inter
consécutives partaient en **un seul bloc de 118 images**.

> **Leçon** : un composant qui répond « non supporté » a en général raison sur sa
> propre entrée. Corriger depuis la mesure (ce flux n'a aucun délimiteur, et
> exactement autant de tranches que d'images), pas depuis le raisonnement.

### 5ter. On joue dans un navigateur

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

### La preuve, et le témoin qui manquait

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

### Un navigateur sans humain

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

### 5quater. Le saccadement — et où il n'était pas

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

### Deux vrais défauts, trouvés par la mesure

**La page peignait à l'arrivée.** Elle dessinait dans le callback du décodeur,
donc l'image apparaissait quand le *décodage* finissait, pas quand l'écran se
rafraîchit. Sur un réseau réel les arrivées sont irrégulières, et peindre à
l'arrivée transforme cette irrégularité en tremblement visible. Elle garde
maintenant la dernière image et la peint sur le rafraîchissement.

**Rejoindre coûtait jusqu'à une seconde de noir.** Un décodeur ne peut rien faire
avant une image-clé, et il y en a une par seconde. L'encodeur en produit
désormais une **à la demande** quand quelqu'un ouvre la page. Mesuré : le plus
grand écart entre deux images passe de **557 ms à 19 ms**.

### Et finalement : c'est l'émulateur qui s'arrête

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

### Le gel définitif : un client bloqué figeait le serveur

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

### Les images perdues n'étaient pas du retard, c'étaient des images

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

### Deux fois la mauvaise règle : « un seul spectateur »

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

### Une file là où il fallait un état

La manette arrivait dans une file de 64. Elle débordait : **1073 avertissements
en cinq minutes**, du bruit qui aurait masqué une vraie panne.

Or une manette est un *niveau*. Seul le plus récent état d'un port peut être
appliqué, donc tout ce qui attend derrière est du travail déjà périmé.
Remplacé par **une case par port** : écrire remplace. Ça ne peut pas déborder,
ça ne peut pas vieillir, et il n'y a aucune politique à choisir sur quoi jeter.

### Une métrique qui se lit mal est une métrique fausse

La page annonçait « 72,5 % des rafraîchissements n'ont rien de neuf ». Alarmant,
et presque vide de sens : sur un écran à **120 Hz**, un flux parfait à 60 images
par seconde laisse **la moitié** des rafraîchissements sans rien, par
construction. La phrase honnête était « 33 images peintes sur 60 envoyées ».

Elle affiche maintenant des **débits** — envoyé, arrivé, peint, rafraîchi — parce
qu'un nombre qu'on ne peut pas lire sans connaître la fréquence de l'écran est un
nombre qui sera mal lu.

### Ce qui reste, et son prix

En boucle locale, 8 % des rafraîchissements n'ont rien de neuf à montrer. Ce
n'est pas le réseau : c'est **60 images par seconde envoyées vers un écran à
60 Hz sans relation de phase** — certains rafraîchissements reçoivent deux
images et en jettent une, d'autres n'en reçoivent aucune et répètent.

Le remède est un petit tampon de lissage : retenir une image et présenter à
cadence régulière. Il coûte exactement ce qu'il retient — 16,7 ms de latence en
plus. C'est le service que WebRTC rend gratuitement, et la contrepartie que le
plan de M3 avait annoncée. À trancher sur une mesure prise depuis un vrai
client, pas ici.

### 5quinquies. Le crash : ce n'était pas nous

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

### Ce que les objets sont, et ce qu'ils ne sont pas

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

### Les deux jeux, et ce que ça écarte

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

### La contrainte matérielle sous tout ça : le Resizable BAR

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

### Le redimensionnement à chaud : tenté, refusé, et la raison est nette

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

### Le correctif : ne pas réparer la fuite, survivre à sa fin

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

### Le vrai correctif : ouvrir la fenêtre, sans passer par le firmware

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

### Ce que ça change, mesuré sur la même charge

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

### Le gel qui restait : une socket vivante qui se tait

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

### Et le test a trouvé ce que le raisonnement n'avait pas

Première version : je mettais à jour le témoin de vie **après** le bloc qui
ignore les images tant qu'aucune image-clé n'est arrivée. Pendant cette seconde
d'attente, la socket paraissait muette — le chien de garde la fermait, la
reconnexion attendait à nouveau une image-clé, et ainsi de suite. Un **blocage
en boucle** que j'avais écrit en croyant faire l'inverse.

Le signe de vie, c'est **des octets qui arrivent**, pas des images qui décodent.

### Le gel d'après : le décodeur meurt, la socket va très bien

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

### Le test qui casse le décodeur exprès

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

### Deux erreurs de raisonnement à garder

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

### 5sexies. La manette, enfin chiffrée — et le chiffre accuse

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

## 6. Les pièges qui ont coûté du temps, et ce qu'ils ont appris

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
| **D8** | Vulkan lié directement avec `ash`, sans shim | La raison du shim (l'ABI instable de ffmpeg) n'existe pas pour Vulkan, et la logique risquée doit rester en Rust |

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

**ash** — la bibliothèque de liaison Rust ↔ Vulkan. Pré-générée, donc sans outil
de génération à la compilation.

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
