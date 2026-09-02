# L'écran des deux manettes

Note de reprise pour l'écran `touches → les deux manettes`. Elle dit ce qui n'est
pas lisible dans les fichiers, et ce qui casse quand on l'ignore.

## L'invariant, et tout en découle

**La page envoie toujours la même trame**: douze boutons, deux sticks, deux
gâchettes. Une manette GameCube, une Wiimote et une guitare n'en sont pas trois
variantes, ce sont trois **lectures** de cette trame, décidées par le fichier de
correspondances que le worker écrit à Dolphin.

Conséquence pratique: les trois plans de manette **partagent leurs clés**. `A`
reste `A`, seules la place et l'étiquette changent. C'est ce qui permet de tenir
un bouton, de basculer entre les trois, et de voir ce qu'il devient dans chacune
sans qu'aucune assignation ne bouge.

Un plan qui introduirait une clé à lui ne s'allumerait jamais. Un essai le refuse.

## Où vit la vérité

Les correspondances sont **décidées** dans `core/crates/emulator/src/config.rs`
(`wiimote_ini`, `guitar_binds`). Les plans de `front/src/lib/padmap.ts` ne font
que les **dessiner**. Si l'un change, l'autre suit — jamais l'inverse. Il n'y a
pas d'essai qui relie les deux: c'est un trou connu, et le premier endroit à
regarder quand une touche s'allume au mauvais endroit.

## Les deux côtés ne lisent pas la même chose, exprès

| côté | source | ce que ça montre |
|---|---|---|
| gauche | `readPad` (`media/pad.ts`) | ce que le **jeu** reçoit, après correspondance |
| droite | `heldOn` (`lib/wiring.ts`) | ce qu'on **appuie**, sans rien traduire |

L'écart entre les deux est toute l'information: une pièce allumée à droite et pas
à gauche dit que la correspondance manque. **Si les deux lisaient la même chose,
l'écran n'apprendrait rien.** Ne pas « simplifier » en faisant passer la droite
par `readPad`.

## Le piège du repos

Un adaptateur GameCube rapporte une gâchette **au repos à 0,6**, donc le
navigateur la déclare `pressed` en permanence. Sans précaution, le schéma
s'allume tout seul — sur l'écran même censé rassurer sur ce que la salle voit.

`heldOn` fait donc deux choses:

1. quand le profil connaît le repos d'un bouton, c'est la **course** qui décide,
   pas le drapeau `pressed`;
2. cette course est ramenée à **son** échelle (`(valeur − repos) / (1 − repos)`),
   exactement comme `pad.travel` le fait pour la boucle d'entrée. Deux échelles
   différentes donneraient un schéma qui s'allume à un autre moment que le jeu.

Les deux moitiés ont chacune leur essai. Les retirer rend l'écran faux sans rien
casser d'autre.

## Le banc d'essai, et pourquoi il double le schéma

Le schéma de droite répond à « est-ce que ça marche ». Il ne répond pas à
« pourquoi ça marche mal »: un stick qui dérive de 0,03, une gâchette qui repose
à 0,6, un bouton qui plafonne à 0,98. Ces pannes-là sont des **nombres**, et un
schéma les arrondit toutes à allumé ou éteint.

Le banc (`components/Bench.tsx`) montre donc ce que le navigateur annonce, sans
rien traduire: une jauge par bouton, un cadran par paire d'axes, et
l'horodatage, le seul chiffre qui dise si la manette parle encore.

Deux choses à ne pas défaire:

- **Le plan vient du nombre d'axes annoncés**, pas d'un gabarit à deux sticks
  (`lib/bench.ts`, `bench()`). Un compte impair n'est pas une erreur: c'est une
  pédale, un curseur, un adaptateur. Le dernier axe est montré seul, sans
  cadran. L'arrondir en bas ferait disparaître un axe sans rien dire, ce qui est
  la classe de panne que ce projet a déjà eue avec un adaptateur GameCube.
- **Le remplissage vit dans la bibliothèque** (`paintBench`), pas dans le
  composant. Les marques `data-gauge` et `data-scope` sont un contrat entre
  celui qui les pose et celui qui écrit dedans; tant que les deux moitiés
  vivaient dans deux fichiers, rien ne pouvait le vérifier. Il est maintenant
  épinglé par des essais jsdom qui posent le balisage et lisent ce qui a été
  écrit.

La jauge montre une **course**, donc une distance au repos: un axe à -0,9 est
aussi loin de zéro qu'un axe à 0,9, et le signe se lit sur le chiffre. Sans la
valeur absolue, la moitié des axes auraient une jauge vide à fond de course.

## Le piège du vertical

Les deux côtés s'inclinent à partir de nombres qui se ressemblent et n'ont pas
le même sens. Ce que le jeu reçoit compte le vertical vers le **haut**
(`readPad` nie déjà l'axe du navigateur, et c'est ce qui part sur le fil); le
navigateur compte vers le **bas**, comme SVG. Passés tels quels, les deux
schémas penchaient en sens contraires pour la même poussée — visible seulement
à l'écran, le jeu allait bien.

Une paire de nombres ne dit pas de quel repère elle vient. `upward` et
`downward` construisent le `Tilt` en **nommant** ce repère, et un essai vérifie
que les deux schémas penchent du même côté pour une seule poussée. Ne pas
revenir à une paire nue.

## La boucle d'affichage est hors de React

L'instantané de la page se lit **deux fois par seconde** (règle 8 de `CLAUDE.md`).
Voir sa touche s'allumer une demi-seconde après l'avoir appuyée ne rassure sur
rien. Un effet de `Wiring.tsx` pose donc `data-lit` sur des pièces déjà
dessinées, à la cadence de l'écran, et la feuille de style fait le reste. React
n'est jamais rendu pendant ce temps.

Ne pas remplacer par un état React. Ne pas faire dépendre les couleurs de la
boucle: elles vivent dans `index.css`, la boucle ne change qu'un attribut.

## Des coques reconnaissables, en trait fin

Chaque plan dessine la coque de la vraie manette: la GameCube à ses deux
poignées inégales, la Wiimote et son Nunchuk reliés par leur câble, la guitare
avec son manche et son corps. Le dessin industriel d'une vraie manette appartient
à quelqu'un et n'est pas reproduit: ce sont des silhouettes génériques.

Le dessin est **du trait, et rien dedans**, et ce n'est pas un goût. Une pièce au
repos est un contour, une pièce enfoncée est un aplat. Rien d'autre ne change
dans l'image, donc le changement se voit du coin de l'oeil — la seule question
qu'on pose à ce schéma.

Le dessin était modelé avant: dégradés, capots bombés, ombre portée, pastilles
colorées par touche. Trois choses sont parties avec, chacune pour sa raison.

- **Les couleurs d'identification.** Elles disaient « le vert d'un A se
  reconnaît avant qu'on ait lu son étiquette », ce qui est vrai. L'étiquette est
  aussi juste là, dans la pièce, et dit la même chose: deux codes pour une
  information, dont un qui se disputait l'accent avec la pièce enfoncée. Perte
  assumée, pas oubli. `TINTS` reste dans les données, plus personne ne l'applique.
- **Le halo d'accent.** Il faisait voir le changement par-dessus des pastilles
  déjà colorées. Sur des contours vides il ne fait plus que baver sur les
  voisines: passer de creux à plein est déjà le changement le plus visible
  qu'une forme puisse faire.
- **Les dégradés et l'ombre.** Ils mettaient du volume entre l'oeil et
  « laquelle bouge ». `flat` n'a donc plus d'effet sur le remplissage.

Le trait porte maintenant tout le dessin, ce qui **change son exigence de
contraste**. Mesuré le 2026-09-02: `--rule-bright`, qui servait de liseré autour
d'une pièce remplie, ne donne que **1,40:1 à 2,37:1** selon le thème, quand un
élément d'interface non textuel en demande 3:1. Il n'avait jamais été mesuré
parce qu'il ne portait rien; devenu le dessin, il était invisible. La coque porte
`--faint` (4,50:1 au pire), les pièces `--muted` (5,38:1 au pire) — les pièces
plus fortes que la coque, parce que ce qu'on regarde est la pièce.

La leçon générale: **quand un élément décoratif devient porteur, son exigence
change et rien ne le signale.**

Il n'y a qu'un seul rendu, et c'est voulu: le vectoriel est le seul qui marche
hors-ligne, dans le budget de poids, et que la boucle 60 images/seconde peut
éclairer telle quelle.

## Un banc d'essai, pas une image

Ce que le banc d'essai de manette en ligne (hardwaretester) fait et que ce
schéma fait aussi : **les sticks bougent**. Le capot d'un stick vit dans son
propre groupe (`data-stick` porte sa source : `x`/`cx` côté émulation, `a0`/`a2`
côté physique) et la boucle d'affichage le translate chaque image du côté où on
pousse ; la garde, elle, ne bouge pas.

`just padmap-visuel` coche « simuler une manette » sur la page d'aperçu et
photographie le résultat : quelques touches tenues, les deux sticks inclinés.

Deux conséquences :

- **Les symboles d'une PlayStation sont DESSINÉS et non écrits.** `✕`, `▢`, `○`,
  `△` ne sont dans aucune des polices de la page — un caractère absent rend un
  carré vide sans que rien ne le signale. Ils sont tracés dans
  `GLYPHS` (`front/src/lib/padmap.ts`) avec les mêmes règles de couleur que les
  étiquettes.
- **Le côté droit change de coque selon la manette branchée.** `Wiring.tsx`
  lit la famille annoncée (`families.ts`) : une PlayStation se dessine en
  DualShock, une Xbox en manette Xbox, et tout le reste garde la silhouette
  générique. Trois coques pour les MÊMES indices, ce qui est exactement le
  point de l'écran.

## Les fichiers

| fichier | ce qu'il possède |
|---|---|
| `front/src/lib/padmap.ts` | les quatre plans, en **données**: silhouette, enveloppe, pièces |
| `front/src/lib/wiring.ts` | ce qui est enfoncé sur la manette physique |
| `front/src/components/PadMap.tsx` | dessine n'importe quel plan |
| `front/src/components/Wiring.tsx` | les deux côtés, le sélecteur, la boucle |
| `front/src/components/Bindings.tsx` | l'onglet qui bascule tableau / schéma |

Les plans sont des **données et non du balisage**: quatre composants qui
dessineraient chacun le leur finiraient par diverger.

## Ce que les essais protègent

`padmap.test.ts` et `wiring.test.ts`, 27 essais. Les trois qui comptent:

- **aucun centre de pièce dans une autre pièce.** Pas « rien ne se touche »: les
  branches d'une croix se touchent, et le groupe A/B/X/Y d'une GameCube est serré
  exprès. Ce qui compte est de pouvoir viser.
- **chaque pièce se pose sur le boîtier.** Le repère est plus grand que la
  manette: une pièce peut tenir dedans et pendre à côté. Chaque plan déclare son
  enveloppe, parce qu'une guitare et une manette n'occupent pas la même zone.
- **les plans émulés ne parlent qu'en commandes de la trame**, le plan physique
  qu'en indices bruts. C'est la distinction entre les deux côtés, épinglée.

Aucun essai ne vérifie qu'un mot **tient** dans sa pastille: la largeur d'un mot
dépend de la police. Ça se voit sur capture, et c'est arrivé.

Le contraste des traits, lui, EST mesuré: `just banc-visuel` monte les VRAIS
composants et demande au navigateur la couleur calculée de chaque trait. Les
vrais exprès — `padmap-preview` redessine le SVG à la main, et un double finit
toujours par diverger de ce qu'il double.

## Ce qui n'est pas fait

- **L'assignation guidée depuis le schéma.** `lesson.ts` marche déjà en texte, et
  `PadMapView` accepte déjà `waiting` pour faire clignoter la pièce attendue. Il
  reste à brancher l'un sur l'autre.
- **Le clavier n'apparaît nulle part** dans cette vue. L'onglet
  « correspondances » le montre; le schéma non.
- **Le sélecteur de gauche ne fait que regarder.** Changer la manette que Dolphin
  présente est un réglage de la salle, qui redémarre la partie de tout le monde;
  il vit sous `réglages → manette des jeux Wii`, et pas ici.

## Vérifier

```
just check                          # types, lints, essais
just padmap-visuel                  # géométrie des plans + capture /tmp/padmap-visuel.png
just banc-visuel                    # le banc, regardé et son contraste mesuré
just browser-contraste              # le contraste réel des étiquettes, sur les trois coques
```

`just padmap-visuel` sert la page d'aperçu par Vite et demande au navigateur si
chaque pièce se pose sur LA coque de son plan — pas seulement dans le repère.
C'est ce qui attrape une pièce qui tient dans les bornes mais pend à côté du
boîtier, l'oeil mis à part.

`just browser-contraste` attrape les couleurs de pièces dont l'étiquette
deviendrait illisible. Attention à ce qu'il regarde: il tape le **worker en
vie**, donc la page compilée dans son binaire, et il ne voit pas un écran qui
n'a pas encore été déployé. Le croire est un piège que ce projet a déjà payé.
`just banc-visuel` passe par Vite et voit donc l'arbre de travail.
