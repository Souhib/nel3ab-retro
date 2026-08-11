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
