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

### Des chiffres qu'on ne peut pas copier ne servent à personne

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

### La vraie cause : Dolphin se taisait quand l'image ne changeait pas

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

### Et pour que ça ne puisse plus recommencer : la cadence est la nôtre

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

### Quatre joueurs : c'est le serveur qui distribue les places

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

### Le journal a dénoncé un bogue que je ne cherchais pas

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

### Quatre fois plus de pixels pour une milliseconde

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

### Le vrai gel, enfin : la page nourrissait un décodeur que personne ne vidait

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

### Le test ne pouvait pas échouer sur cette machine

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

### Le gel qui n'en était pas un : une salle pleine de fantômes

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

### Silencieux n'est pas parti — et il faut poser la question

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

### La vraie cause de tout : c'était nous depuis le début

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

### Une page ouverte n'est pas un joueur

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

### Cadence : l'image doit durer ce que l'émulateur lui a donné

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

### Le nom qui a mordu trois fois

`held` est l'ensemble des touches enfoncées. J'ai appelé une deuxième variable
`held` — un module qui déclare deux fois le même nom **ne s'exécute pas du tout**,
et la page ressemble alors à une page qui attend. Renommée, sauf que la renommée
n'a corrigé que la première moitié du fichier : la ligne de statistiques appelait
encore `percentile(held, …)`, un `Set` n'a pas de `.length`, et la mesure
affichait **0** en toute confiance.

> Une valeur fausse qui a l'air plausible coûte plus cher qu'une erreur.

### La manette n'était câblée qu'à moitié

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

### Une vraie manette GameCube : la page l'apprend au lieu de la deviner

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

### Le relâchement répondait à la question suivante

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

### La marge d'affichage se paie à la manette

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

### Mesurer d'abord : l'attente du GPU ne coûtait rien

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

### Deux structures relues, dont une qui mentait

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

### Une image-clé par seconde pour personne, et deux bogues au passage

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
