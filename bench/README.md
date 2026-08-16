# Bancs d'essai

`just bench <étiquette>` mesure la chaîne **telle qu'elle est livrée** : le worker
en `--release` sous systemd, le vrai conteneur Dolphin, le vrai GPU, un vrai
Chrome sans écran en spectateur. Rien n'est simulé — ce qui veut aussi dire que
rien n'est discret : **un passage redémarre la session**, donc il ne se lance pas
pendant que quelqu'un joue.

Un passage dure environ trois minutes : 45 s de chauffe, pour que la compilation
des shaders et l'horaire d'affichage se soient posés, puis 90 s mesurées. Le
résultat brut part dans `results/`, horodaté et étiqueté.

## Ce qu'un passage mesure

| | |
|---|---|
| serveur | attente d'une image, conversion, encodage — **p50/p95/p99 et le nombre d'images**, jamais un maximum seul |
| réseau | débit médian et sa plage sur les fenêtres de dix secondes |
| entrée | manette→image p50 et p95 |
| client | images peintes, décodées, marge d'affichage, reprises |
| coût | CPU du worker et de Dolphin **sur la fenêtre mesurée**, VRAM, GTT |
| contexte | SHA git et état modifié, machine, noyau, image Dolphin, taille du binaire, réglages du service |

## Le plancher de bruit, mesuré

Deux passages consécutifs sur le même code (`c5c4365`, 13 août 2026) :

| métrique | écart entre les deux passages |
|---|---|
| débit médian | 0,1 % |
| attente p50 | 0,3 % |
| Dolphin %CPU | 0,2 % |
| conversion p50 | 0,4 % |
| encodage p95 | 1,1 % |
| encodage p50 | 1,6 % |
| worker %CPU | 7,9 % |
| **manette→image p50** | **48 %** |

Donc : une amélioration de l'encodage sous **2 %** ne se distingue pas du bruit,
et `manette→image` **ne peut pas servir de comparaison** en l'état — c'est un
calage de phase entre deux horloges à 60 Hz, stable pendant des minutes et
différent d'un passage à l'autre.

## Le piège qui a invalidé les trois premiers passages

`manette→image` semblait bouger de 48 % entre deux passages du même code, et j'en
ai tiré une conclusion. Fausse : la page du banc **n'avait aucune manette** — la
place était tenue par un autre navigateur — et le chiffre comparé était donc
celui d'un tiers non contrôlé. Zéro trame envoyée, trois passages durant.

> Un générateur de charge se **vérifie**, il ne se suppose pas.

Le harnais prend maintenant la manette au démarrage, compte les trames qu'il
envoie, et **refuse d'afficher un chiffre d'entrée** s'il n'en a envoyé aucune.

## Comparer deux versions

Alterner les passages plutôt que de faire toute la référence puis tout le
candidat : la machine dérive (thermique, cache, jeu qui avance). `base-1`,
`cand-1`, `base-2`, `cand-2`, et on compare les médianes en annonçant le seuil
**avant** de regarder.

## Le banc ne pilote pas le jeu

Un passage mesure la chaîne pendant que l'émulateur affiche **ce qu'il affiche**.
Le banc prend la manette, mais il ne joue pas: il envoie l'état neutre. Si la
salle est restée sur un écran-titre fixe, l'encodeur a une tâche facile et le
débit s'effondre.

Mesuré le 16 août 2026: un passage sur l'écran-titre de Mario Kart donne
**0,40 Mbit/s** et **0,7 Kio par image**, contre 16 à 19 Mbit/s et environ 22 Kio
sur les passages d'août. L'encodage y paraît 13 % moins cher, ce qui est
au-dessus du plancher de bruit de 1,6 % et ne veut pourtant rien dire du code.

Donc: **comparer deux passages dont le débit diffère d'un ordre de grandeur, ce
n'est pas comparer du code, c'est comparer des écrans.** Le banc le dit lui-même
quand il tombe sous 3 Mbit/s. Les chiffres du client (images peintes, marge,
reprises) et ceux de l'entrée restent comparables, eux, parce qu'ils ne dépendent
pas de ce qu'il y a à l'écran.

C'est aussi pourquoi les comparaisons A/B de ce dossier sont **entrelacées**
(base, cand, base, cand): deux passages voisins dans le temps ont plus de chances
d'avoir vu la même chose.
