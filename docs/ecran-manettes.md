# L'écran des deux manettes

Note de reprise pour l'écran des deux manettes, dans le panneau « Touches et
manettes ». Elle dit ce qui n'est pas lisible dans les fichiers, et ce qui casse
quand on l'ignore.

**Périmètre au 24 novembre 2026.** Un seul écran règle les touches : le
panneau de `front/src/manettes/`, pour la trame Dolphin (GameCube, Wii) et pour
la trame Pro (Switch, Xbox 360). Les anciens dialogues (`Bindings.tsx`,
`SwitchBindings.tsx`) sont retirés ce jour-là ; la préparation à plusieurs est
un bloc de la colonne (`Preparation.tsx`, chantier menus) et n'est plus ici.
La section suivante dit ce qui existe ; l'invariant vient ensuite, puis
l'histoire datée, gardée telle qu'elle a été écrite. L'[état du
projet](etat-du-projet.md) relie les parcours.

## Ce qui existe, au 24 novembre 2026

- **Un panneau, une entrée.** `ouvrirReglage(onglet)` (`manettes/entree.ts`)
  ouvre le panneau ou change d'onglet ; `HoteReglage` le monte. La salle
  l'appelle par `ouvrirLesTouches` d'`App.tsx`, qui ferme le menu (et la
  feuille, tenue en main). Cinq chemins y mènent : le rang « Touches et
  manettes » en tête de la colonne, juste sous Signaler (`RangReglage`,
  `lib/colonne.ts`) ; l'entrée du même nom de la feuille « La salle » à
  mi-hauteur, quand sa rangée tient (`lib/feuille.ts`) ; « Changer » de la vue
  des touches ; « Toutes les touches » au bout du panneau de commande, au
  bureau ; la rubrique Manettes du menu.
- **Sa place, jamais sur l'image.** Au bureau, il prend la place des rangs de
  la colonne, élargie (`largeurPanneau`, K24) ; en fenêtre étroite, la colonne
  est sous l'image. Tenu en main, le cadre lui donne un rectangle à lui
  (`Geometrie.reglage`, `reglageTenu` de `lib/cadre.ts`) : sous l'image tenu
  droit, du bas de l'image au bas de la zone sûre (l'image ne rapetisse que
  pour lui laisser `REGLAGE_TENU.hauteurMin`, 280 px) ; à droite en travers,
  42 % de la largeur entre 300 et 520 px, l'image posée dans le reste. La
  salle le monte dans `#reglageTenu`. Un seul panneau à la fois : la colonne
  ne le monte que quand le cadre ne lui donne pas de place. La page
  « manette seule », qui recevait la même place sous la barre, est retirée
  depuis le 27 novembre 2026 (ADR D47). Les fins de la
  salle et des manettes avaient écrit cette règle chacune avec ses nombres
  (240 px et 380 px côté manettes) ; l'intégration du 25 novembre 2026 garde
  celle de la salle, qui possède `lib/cadre.ts` (ADR D42, addendum).
- **La manette à l'écran n'est pas montée** pendant le réglage
  (`couchesDeLaSalle`) : elle enverrait au jeu ce qu'on essaie. Tenu droit, sa
  place revient au panneau.
- **Ton étiquette** (D7 du plan manettes) : sous « Ta manette », le numéro de
  ta place à son encre et le ruban d'`Etiquette` (chantier personnes), tes
  initiales sous l'effet « initiales » (`TonEtiquette.tsx`). La salle donne ton
  nom aux deux trames (`etiquette`). Rien pour qui regarde, rien sous le dessin
  de ce que le jeu reçoit, rien dans un dessin.
- **Les deux trames.** `Dolphin.tsx` pose `Wiring` (l'invariant ci-dessous),
  `Pro.tsx` peint ses deux dessins par `paintPro`. Les onglets Manette,
  Clavier et Profils sont les mêmes ; les mots vivent dans `REGLAGE`
  (`lib/mots.ts`).

| Fichier | Ce qu'il porte |
|---|---|
| `front/src/manettes/entree.ts`, `HoteReglage.tsx` | L'ouverture, l'onglet, l'ouvreur et le focus rendu |
| `front/src/manettes/RangReglage.tsx` | Le rang « Touches et manettes » de la colonne |
| `front/src/manettes/ToutesLesTouches.tsx` | « Toutes les touches », au bout du panneau de commande |
| `front/src/manettes/reglage/Reglage.tsx`, `Onglets.tsx` | Le panneau, sa tête, ses onglets, Échap |
| `front/src/manettes/reglage/Dolphin.tsx`, `Pro.tsx` | Les deux trames : dessins, correspondances, clavier, profils |
| `front/src/manettes/reglage/PasAPas.tsx` | Le pas à pas, la table des correspondances, les avis |
| `front/src/manettes/reglage/TonEtiquette.tsx` | Ton étiquette sous « Ta manette » |
| `front/src/manettes/reglage/marques.ts`, `tenues.ts`, `zones.ts`, `inscriptions.ts` | Ce qui se pose hors de React sur les dessins |
| `front/src/manettes/reglage/reglage.css` | Le panneau, ses marques, sa place tenue en main |
| `front/src/components/PadMap.tsx`, `padmap.css` | Le dessin commun, aplats, appui à la couleur de la place |
| `front/src/components/Wiring.tsx`, `Bench.tsx`, `KeyboardWiring.tsx` | Les deux manettes Dolphin, le banc, le clavier |
| `front/src/lib/padmap.ts`, `wiring.ts`, `bench.ts` | Les plans, la lecture brute, `paintWiring`, `paintPro`, `paintBench` |
| `front/src/media/lesson.ts`, `input.ts`, `switch.ts`, `pad.ts` | La capture, le pas à pas, les deux trames, l'activité envoyée |
| `front/src/lib/cadre.ts` (`Geometrie.reglage`) | La place du panneau tenu en main (fichier de la salle) |
| `front/bindings-preview.html` | L'aperçu sans salle : le panneau (`?reglage`, `&pro=x360`, `&onglet=`), la préparation (`?preparation`) |
| `spikes/m3-browser-drive/reglage.mjs` | La preuve dans un vrai navigateur (`just reglage-navigateur`) |

**Les preuves.** `just reglage-navigateur` sur le banc des parcours : place au
bureau et tenu en main (`place`, `place-tenu`), le rang (`rang`), l'entrée de
la feuille (`feuille-reglage`), l'étiquette (`etiquette`), les entrées et le
focus, l'activité de la trame Pro, les zones de clic, la vignette d'un
changement, les nombres, les marques, le focus du pas à pas et le pas à pas.
`just reglage-navigateur-rouge` les fait rougir sur les pages de 9fb659e,
bc72ba9, e62f583, 842e4c9, 9b1c8e8, 928bd03 et 672dcb6. `just salle-telephone` mesure
le panneau seul au téléphone (`bindings-preview.html?reglage`) ; `just
banc-visuel` et `just padmap-visuel` les dessins et leurs contrastes. Les
pilotes qui visent une vraie salle (`bindings.mjs`, `banc.mjs`,
`contraste.mjs`, `debordement.mjs`, `capture-salle.mjs`) ne sont lancés par
aucun chantier (K40).

## L'invariant, et tout en découle

**Pour Dolphin, la page envoie toujours la même trame** : douze boutons, deux sticks, deux
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
que les **dessiner**. Si l'un change, l'autre suit, jamais l'inverse. Il n'y a
pas d'essai qui relie les deux: c'est un trou connu, et le premier endroit à
regarder quand une touche s'allume au mauvais endroit.

## Les deux côtés ne lisent pas la même chose, exprès

| côté | source | ce que ça montre |
|---|---|---|
| gauche | `readPad` (`media/pad.ts`) | ce que le **jeu** reçoit, après correspondance |
| droite | `heldOn` (`lib/wiring.ts`) | ce qu'on **appuie**, sans rien traduire |

Le schéma de gauche s'intitule « Ce que le jeu reçoit » depuis le 22 novembre
2026. Il disait « Après correspondance », un mot d'atelier que l'audit des
textes a relevé (`lib/mots.ts` le refuse maintenant). Seul le titre a changé:
les deux côtés lisent toujours deux choses différentes.

L'écart entre les deux est toute l'information: une pièce allumée à droite et pas
à gauche dit que la correspondance manque. **Si les deux lisaient la même chose,
l'écran n'apprendrait rien.** Ne pas « simplifier » en faisant passer la droite
par `readPad`.

La vue « Ta manette » de la colonne (`lib/verification.ts`, 23 novembre 2026)
est un troisième lecteur, du côté gauche : elle presse chaque bouton d'une
manette simulée et passe la lecture à `readPad`, ou à `readSwitch` avec le
profil de la salle Switch ou Xbox 360. Elle ne tient aucune table ; si
`readPad` change, elle change avec lui.

## Le piège du repos

Un adaptateur GameCube rapporte une gâchette **au repos à 0,6**, donc le
navigateur la déclare `pressed` en permanence. Sans précaution, le schéma
s'allume tout seul, sur l'écran même censé rassurer sur ce que la salle voit.

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
schémas penchaient en sens contraires pour la même poussée, visible seulement
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
boucle: elles vivent dans `components/padmap.css` et la section manettes de
`regie.css` (dans `index.css` jusqu'au 23 novembre 2026), la boucle ne change
qu'un attribut.

## L'histoire, datée

Les sections qui suivent sont gardées telles qu'elles ont été écrites. Quand
une décision a été remplacée, une ligne le dit et renvoie à ce qui la
remplace ; « Ce qui existe » en tête de cette note fait foi.

## Le configurateur du 6 septembre 2026

*Le dialogue décrit ici est retiré le 24 novembre 2026 ; ses trois sections
sont les onglets du panneau.*

L'écran porte désormais le même titre depuis le menu jusqu'au dialogue :
« Touches et manettes ». Trois sections séparent la manette physique, les touches
du clavier et les profils nommés. Le sélecteur de modèle n'existe qu'en un endroit.
Toutes les manettes branchées continuent de jouer sur la place de cette page.
Choisir un modèle ici désigne ce qu'on configure, pas un autre joueur.

La matière et la couleur reviennent dans les dessins à la demande du propriétaire.
La version en traits du 2 septembre avait privilégié le diagnostic au détriment
de la reconnaissance et de l'aspect des manettes. La nouvelle version garde les
indices et les deux lectures, avec des coques modelées, des boutons identifiables
et une couronne de sélection. Les symboles PlayStation restent des chemins
vectoriels : aucune police supplémentaire n'est nécessaire.

Cette décision concerne le menu. Aucun de ces dessins n'entre dans la peinture
du jeu. Le coût est celui de quelques tracés et styles dans la page embarquée.
Le budget de poids de `front/stamp.mjs` reste inchangé.

La famille choisit une coque physique seulement si `mapping === "standard"`.
Depuis le 21 novembre 2026, cela vaut aussi pour la famille Nintendo, qui a
la manette Pro.
Un nom de PlayStation envoyé par un adaptateur ne garantit pas ses indices.
Sans cette garantie, le dessin générique porte les indices bruts et le diagnostic
reste accessible. La note disait déjà que la coque changeait par famille, mais
le code avait gardé une coque unique : ce changement rend enfin cette phrase
vraie, avec la condition de disposition standard.

Les ports d'un même adaptateur partagent les réglages. `modelSnapshot` rassemble
leurs entrées pour la capture et pour l'écran. Auparavant le troisième port
répondait à la leçon tout en laissant les schémas éteints, qui ne lisaient que le
premier. Le diagnostic du modèle n'est pas un instrument permettant de distinguer
deux mains appuyant simultanément sur deux ports du même adaptateur.

## Les dessins relevés du 21 novembre 2026

Les manettes sont maintenant relevées sur des photos vues de dessus et rendues
en volume par `PadMapView`. Le carnet raconte pourquoi et comment (entrée
« 21 novembre : des manettes qui ressemblent aux vraies ») ; les outils de
relevé sont dans `spikes/manettes-relevees/`. Ce qui n'est pas lisible dans le
code :

- **Un plan ne déclare que des formes et des couleurs de matière.** Le volume
  (dégradés, reflet, bords assombris, logements, reflets bombés, ombre) est le
  même pour toutes, dans le composant. Une manette nouvelle ne touche pas au
  composant. **Remplacé le 23 novembre 2026** : plus de volume, des aplats
  (section « Les aplats et le pas à pas » plus bas).
- **Trois sortes de pièces sortent de la coque, et seulement elles.** Une
  gâchette `under` est dessinée derrière et doit en dépasser ; une pièce
  `hangs` (le vibrato) est posée dessus et doit à la fois la toucher et en
  dépasser ; une branche `flush` (croix, barre de grattage) n'a pas de
  logement à elle. `padmap-qc.mjs` vérifie les trois dans un vrai navigateur.
- **La couleur d'appui est déclarée par manette** (`--pad-lit`, son encre et
  son anneau). Par défaut, c'est une couleur d'objet fixe sur `[data-padmap]`
  (#7c6ce0, anneau #e8e8ee, encre #08080a), qui ne suit pas le thème de la
  page. Le 22 novembre 2026, le repli sur le signal de la régie faisait tomber
  une touche appuyée à 2,06:1 sur la Wiimote de nuit et à 1,57:1 sur la
  manette standard de jour. La GameCube violette a la sienne, avec un anneau
  sombre, parce qu'aucune teinte ne tranchait à la fois sur son violet et sur
  sa croix grise. **Remplacé le 24 novembre 2026** : sans place, le violet
  commun est #8b7cf0 et la GameCube prend un vert foncé avec l'anneau clair
  (section « Les couleurs nommées et l'appui à deux seuils » plus bas).
- **Le contour fin de la coque suit l'ambiance.** C'est lui qui sépare une
  manette noire d'une carte sombre, ou une manette blanche d'une carte claire.
- **Ce qui n'est plus mesuré** : le bord d'une touche noire sur une coque
  noire, qui est ce que montre la vraie manette. Ce qui l'est, à 3:1 : la
  silhouette contre la page, et chaque touche appuyée contre son logement ou
  la coque (`just banc-visuel`).
- **La manette Pro sert deux fois.** `SWITCH_PRO` parle en boutons Switch pour
  le configurateur de la salle Switch ; `SWITCH_PRO_PAD` parle en indices pour
  une manette Nintendo tenue en main, en disposition standard seulement.
- **La manette standard reprend la forme de la Xbox**, grise, sans lettres ni
  marque : c'est la disposition que la norme du navigateur décrit.

## Apprendre sans agir dans le jeu

La leçon expose la commande attendue, l'étape et l'attente de relâchement.
`Bindings` la gardait visible dans le dialogue (le pas à pas du panneau,
`PasAPas.tsx`, depuis le 23 novembre 2026) et `PadMapView` éclaire la pièce
attendue. Sur téléphone, la consigne précède les dessins pendant l'apprentissage.

Le bouton de configuration ouvre d'abord une consigne de repos. Annuler ne
remplace pas le profil précédent. Un bouton ne peut pas valider une question
qui demande un stick. Une assignation de stick conserve son axe, son signe et
son repos, comme la leçon complète.

La boucle envoie un état neutre pendant la capture et la leçon. Elle attend aussi
le relâchement du dernier appui avant de rendre la main au jeu ou au menu.
Débrancher la manette annule une réassignation ; depuis le 23 novembre 2026, il
suspend un pas à pas au lieu de l'annuler (voir la section de cette date).
Échap annule avant de fermer le dialogue. Les profils JSON sont validés avant d'être lus par la boucle.

## Portée des réglages

| Réglage | Portée |
|---|---|
| Correspondances de manette | Modèle physique, dans les réglages de la personne |
| Profil clavier nommé | Disposition indépendante du type de manette émulée |
| Référence publiée | Copie proposée par la salle, modifiée localement par une copie personnelle |
| Lecture des dessins | Aperçu local, sans relance ni commande envoyée au worker |
| Appareil présenté au jeu | Choix par place, publié par le worker ; préparation collective avant un lancement Wii |
| Extension Nunchuk, guitare ou aucune | Place de cette page, conservée pour le jeu et publiée aux nouveaux arrivants |

Une erreur d'envoi ne défait pas le réglage local. La copie non confirmée est
rangée sous l'identité de la personne et retentée à la prochaine arrivée.
Les envois d'un même onglet sont ordonnés. Deux appareils gardent la règle du
dernier envoi reçu, sans fusion des suppressions. Cette copie ne remplace pas
une sauvegarde des fichiers du serveur.

Le choix de dessin hors préparation reste un aperçu. Le worker publie son
appareil réel à la connexion ; la préparation prévisualise le choix qui sera
branché après confirmation. Ce choix est figé dans le dessin pendant la
préparation, pour ne pas faire tester un appareil différent de celui confirmé.

## Les fichiers et les preuves

*Table du 22 novembre 2026. `SwitchBindings.tsx`, `Bindings.tsx` et
`FeuilleDuBas.tsx` n'existent plus : la table à jour est dans « Ce qui
existe ».*

| Fichier | Responsabilité |
|---|---|
| `front/src/lib/padmap.ts` | Plans relevés sur photos, Wiimote seule, manette Pro et choix de famille |
| `front/src/lib/wiring.ts` | Lecture brute, repères verticaux et `paintWiring` |
| `front/src/components/PadMap.tsx` | Dessin commun à toutes les manettes (aplats depuis le 23 novembre 2026), libellés, sélection, place et balisage animé |
| `front/src/components/padmap.css` | Matières, contour, appui à la couleur de la place |
| `front/src/media/activite.ts` | Ce que la trame envoyée presse, pour la vue des touches |
| `front/src/components/SwitchBindings.tsx` | Configurateur Switch ; il dessine la manette Pro avec `PadMapView` |
| `spikes/manettes-relevees/` | Outils et mesures des relevés sur photos |
| `front/src/components/Wiring.tsx` | Assemblage et abonnement à l'animation |
| `front/src/components/Bindings.tsx` | Dialogue, capture, profils et portée des actions |
| `front/src/media/lesson.ts` | Capture, étapes, repos et collecte des ports du modèle |
| `front/src/media/profile.ts` | Validation des profils chargés |
| `front/src/lib/bindings.ts` | Semis, copie en attente et envois au service |
| `front/src/lib/faces.ts` | Faces des manettes tactiles, place des touches à l'écran, nom d'un appareil par salle |
| `front/src/components/TouchPad.tsx` | Pavé tactile commun (`Pave`), manette Dolphin |
| `front/src/components/SwitchTouchPad.tsx` | Manette Pro tactile, nommée selon la console |
| `spikes/m3-browser-drive/manette-garde.mjs` | Garde navigateur de la manette tactile (`just manette-garde`) |
| `front/src/lib/feuille.ts`, `components/FeuilleDuBas.tsx` | Le « ••• » et la feuille du bas : les gestes de page d'un téléphone |
| `spikes/m3-browser-drive/salle-telephone.mjs` | Garde navigateur de la salle au doigt : feuille, tiroir, zones sûres (`just salle-telephone`) |

Les essais géométriques vérifient que les centres ne sont pas avalés par une
autre pièce et que les pièces restent dans leur enveloppe déclarée. Cette
vérification ne calcule pas la silhouette courbe exacte. Les captures restent
nécessaires pour la lisibilité et pour un bouton qui dépasse une courbe.

`PadMap.test.tsx` rend les vrais composants puis appelle `paintWiring`. Il
vérifie la différence entre indices et commandes, le sens des sticks, le
retour au repos après débranchement et le troisième port d'un adaptateur.
Les noms d'attributs font donc partie du test, pas seulement des commentaires.

`configuration.test.ts` conduit la vraie boucle d'entrée sur des horloges et
une socket simulées. `bindings.test.ts` éprouve le stockage et les réponses
réseau désordonnées. `profile.test.ts` a les jumeaux des formats acceptés.

## Vérifier à l'écran

`just browser-configuration` ouvrait le configurateur réel sur une manette
simulée, dans l'aperçu. Il est retiré avec l'ancien dialogue le 24 novembre
2026 ; `just reglage-navigateur` prouve le panneau (« Ce qui existe »).

`just banc-visuel` monte également les vrais composants et vérifie son lot de
contrastes. Il doit sortir en erreur si un texte ou un trait échoue. Depuis le
21 novembre 2026, il mesure la silhouette de chaque manette contre la page et
chaque touche appuyée contre son logement ou la coque, et non plus le bord des
touches au repos. Depuis le 22 novembre 2026, il le fait sous un système
sombre puis sous un système clair, puisque la page suit ce réglage, et il
vérifie que les valeurs du banc gardent leur largeur quand leurs chiffres
changent. Il sert l'aperçu avec `vite.planche.config.ts`, sans relais vers
les salles, ou contre un Vite sans relais déjà lancé dont on lui passe
l'adresse.

`just padmap-visuel` monte toutes les manettes dans l'aperçu (le vrai
composant) et vérifie leur géométrie dans un navigateur. Pour regarder une
seule manette de près, touches tenues : Vite sur 5297 dans `front/`, puis
`node padmap-carte.mjs <id> <sortie> "?sim"` dans `spikes/m3-browser-drive`.

`just browser-contraste` et `just browser-bindings` ciblent le worker vivant :
ils ne voient pas les changements avant un déploiement. Un résultat contre
l'ancienne page ne peut pas valider celle de l'arbre de travail.

## Préparation et profils personnels

*Le 24 novembre 2026, la préparation devient un bloc de la colonne pour
toutes les consoles (chantier menus), et le dialogue part ; « Mes profils
complets » reste dans l'onglet Profils du panneau.*

`Preparation.tsx` est inséré dans le même dialogue, dans la zone défilante. Le
salon garde les choix et l'état « prêt » ; la page garde ses correspondances.
La personne peut charger, enregistrer, mettre à jour ou supprimer un profil
complet dans « Mes profils enregistrés ». L’onglet « Profils » du configurateur regroupe les profils complets et les
dispositions de clavier seules.

`lib/setups.ts` valide et range le profil complet avec les autres réglages
personnels. Un chargement n'écrit ni sur une autre place ni dans une référence
publiée. La limite de taille porte sur l'ensemble envoyé au service. Un échec
réseau laisse la copie en attente de synchronisation, comme les touches.

Le même appui continue d'alimenter les dessins et le diagnostic. La commande
choisie affiche aussi son action dans le jeu si la fiche la connaît. Cette
indication vient d'un manuel, pas d'une lecture de la mémoire du jeu. Elle ne
prouve pas que Dolphin a reçu l'appui ; seule une séance de jeu peut prouver
l'enchaînement complet.

`just browser-preparation` testait ce parcours sans salle (retiré le
24 novembre 2026 ; `just parcours-navigateur` prouve le bloc). Les tests Python font
participer deux vrais clients et un spectateur à une préparation, en utilisant
un port TCP jetable pour le faux worker. Les tests Rust vérifient séparément
les attributions, le refus d'un ancien choix et les fichiers Dolphin par port.

`just preparation-test '/chemin/Mario Kart Wii.rvz'` lance une salle complète
temporaire, avec le binaire de développement. Elle utilise ses propres ports,
son conteneur et ses sauvegardes. Les profils passent par le vrai service et
sont relus depuis un second navigateur sous la même identité. Le pilote vérifie
aussi les noms après passage en spectateur, les confirmations, le lancement
mixte et la reconnexion. Les images du jeu et les traces restent dans le dossier
temporaire annoncé. Ce test ne remplace pas la vérification des gestes dans
chaque jeu ni un essai avec un adaptateur physique.

## Le clavier vers la manette, 6 septembre 2026

L'onglet Clavier montre maintenant la même manette de sortie que l'onglet
Manette. À droite, les touches assignées s'allument à partir des événements du
clavier. À gauche, `readKeys` traduit ces événements avec le profil actif, puis
`paintReading` éclaire et incline les pièces. C'est exactement la traduction de
la boucle d'entrée. Les indices physiques d'une manette ne sont pas employés
pour simuler un clavier.

Le test ne lit les appuis que dans la zone « Tester le clavier » qui possède le
focus. Sortir de cette zone, changer de profil ou perdre le focus de la fenêtre
efface les appuis. Tab et Échap gardent leur fonction de navigation. Les champs
et les boutons d'assignation restent utilisables. Aucun événement du test
n'est envoyé au jeu ; le dialogue suspend toujours les commandes de la partie.
L'animation du dessin vit dans un module ordinaire, sans rendu React par appui.

Les quatre directions du stick apparaissent en premier dans le tableau. Gauche
et bas sont des commandes distinctes de droite et haut. La croix directionnelle
reste distincte du stick. Pour Mario Kart Wii avec Nunchuk, c'est le stick qui
dirige ; affecter une flèche à la croix ne peut pas le remplacer. La colonne
« Dans le jeu » réutilise la fiche du jeu lorsqu'elle existe.

Le sélecteur de lecture et la mention « en salle » sont réservés aux jeux Wii.
Un jeu GameCube montre directement la manette GameCube. Pendant la préparation
d'un jeu Wii, la mention est « ton choix » : le jeu n'a pas encore démarré avec
cet appareil. Passer de l'aperçu Manette à l'onglet Clavier rétablit l'appareil
réel de sa place, pour que le dessin et les actions du jeu parlent du même choix.
Le pilote Chromium vérifie l'absence du sélecteur en GameCube, sa présence en
Wii et ce retour depuis un aperçu différent.

## Lire les correspondances avant le diagnostic, 6 septembre 2026

« Toutes les correspondances » apparaît désormais avant « Diagnostic des boutons
et des axes ». Le premier est ouvert à l'arrivée et peut être refermé. Le second
reste fermé. `Bindings.tsx` porte les deux sections sous le dessin et l'éditeur ;
`Wiring.tsx` conserve les deux manettes et leur animation. Le banc brut conserve
sa propre lecture, aucun rendu React n'est ajouté à chaque appui.

La préparation collective utilise ce même panneau. Les pilotes
`configuration-ui.mjs` et `preparation-ui.mjs` vérifiaient l'ordre, les deux états
initiaux et la possibilité de refermer les correspondances, sur le vrai dialogue ;
ils sont retirés avec lui le 24 novembre 2026.

Depuis le 6 septembre au soir, les correspondances occupent **une seule colonne**,
également pendant la préparation. Il s'agit de l'ordre de lecture des commandes ;
les deux dessins restent côte à côte quand la largeur le permet.

## Profils complets par jeu, 7 septembre 2026

Pour Dolphin, `SetupProfiles` est commun à la préparation collective et aux touches pendant
la partie, dans l’onglet « Profils ». Il conserve le type émulé, la disposition physique et les commandes
clavier. Une préférence personnelle propose un profil pour un jeu ; elle ne le
charge pas automatiquement et ne valide jamais « Je suis prêt ». Pendant une
partie, le chargement refuse un type différent de l'appareil actuel. Le changement
d'appareil continue de passer par la préparation collective.

`GameCard` expose la même fiche dans le sélecteur de sauvegarde, la préparation
et les touches. Dans le configurateur, le nombre de joueurs et les appareils
restent visibles ; les explications et les sources se déplient à la demande,
pour laisser la place aux dessins. Les boutons de lancement restent pilotables dans les trois
coques. Un nombre de joueurs inconnu ou des gestes non pris en charge sont dits
explicitement ; une fiche ne s'applique pas par ressemblance de titre.

## Le parcours Switch, 9 septembre 2026

*`SwitchBindings.tsx` est retiré le 24 novembre 2026 : la trame Pro se règle
dans le panneau (`manettes/reglage/Pro.tsx`), la préparation Pro dans le bloc
`Preparation`.*

`SwitchBindings.tsx` permet de tester la lecture physique, de modifier les touches
et de charger, enregistrer, importer ou exporter un profil personnel. Le même
écran sert pendant une partie et avant le lancement collectif. L'appareil présenté
au jeu est une manette Pro par place ; la préparation porte donc sur les
correspondances, sans proposer les extensions de Dolphin.

La trame Switch fait quinze octets : marque, version, place, seize boutons et
quatre axes signés. Elle ne réinterprète pas les treize octets de Dolphin.
`media/switch.ts` définit cette traduction et ses profils ; la boucle de
`SwitchInput` l'utilise pour transmettre les commandes. Pendant la configuration,
les dessins continuent de lire les appuis et le jeu reçoit un état neutre.
Fermer le dialogue avec une touche ne doit pas envoyer cette même touche au jeu.
La console préparée peut être différente de celle encore en cours : le dialogue
doit alors suivre le jeu à lancer.

Les profils nommés sont synchronisés dans le dossier personnel, avec conservation
locale des écritures en attente. Leur chargement reste manuel. La préférence
« proposer ce profil pour ce jeu », décrite pour Dolphin ci-dessus, **n'existe
pas encore pour les profils Switch**. Charger un profil ne confirme pas non plus
la préparation à la place du joueur.

`just switch-controls-test` vérifie la traduction et quatre périphériques Linux
temporaires, y compris un retour de vibration refusé. Le parcours entre consoles
se rejoue avec `just switch-room-test`, décrit dans la [note Switch](switch-room.md).
Un bouton lu sur le périphérique Linux ne prouve pas son action dans chaque jeu.

## La manette tactile et ses faces, 22 novembre 2026

Cette section parle de la manette dessinée **sur l'écran de jeu** d'un
téléphone, pas des dessins du configurateur. Les deux partagent désormais leurs
noms et la place des quatre boutons.

**Ce qui était faux.** L'audit mobile du 22 novembre a tapé au centre de R sur
un iPhone tenu droit : la manette a disparu, parce que « cacher » était posé
sur R. Taper Z faisait pareil, et taper L appuyait sur START. En paysage, le
haut de Y tombait sur « cacher ». La rangée « menu, son, masquer » de la
manette Switch, posée à `bottom: 140px`, mordait sur L, ZL et le clic du stick.
Dans une salle Xbox 360, cette manette écrivait ZL, ZR, + et −, rangeait B à
gauche de A, et sa croix était une grille où « gauche » se trouvait à droite
de « haut ».

**Une face par console.** `front/src/lib/faces.ts` décrit chaque manette
tactile : quelles touches, sous quels noms, dans quel ordre. La GameCube et la
Wii partagent la face Dolphin. La Switch et la Switch 2 ont la manette Pro. La
Xbox 360 écrit LB, LT, RB, RT, Back et Start, et range A en bas. Ce qui n'est
pas lisible dans le code :

- **Les noms d'une salle Pro viennent de `switch-labels.ts`**, la table que lit
  le configurateur (`SwitchBindings`). L'inscription d'une touche est le début
  de son nom, avant « · » (`inscription`) : « LB · bouton d'épaule gauche »
  s'inscrit LB. Seuls les clics de stick ont une inscription à eux (L3 et R3,
  LS et RS), parce que leur nom est une phrase. Un essai vérifie chaque
  inscription contre son nom, un autre qu'aucune ne dépasse cinq caractères.
  Le choix de la table par console reste écrit une seconde fois dans
  `SwitchBindings` (`xbox ? xboxLabels : switchLabels`) ; il peut lire
  `faceOf(console)` à la place.
- **Le losange des quatre boutons est lu sur le dessin** (`diamondOf`, sur
  `XBOX_360` et `SWITCH_PRO`), pas recopié. Un essai retourne le dessin de
  gauche à droite et vérifie que le losange se retourne aussi.
- **La place d'une manette dans la salle est lue dans sa pose**
  (`encombrement`, depuis le 23 novembre 2026) : le cadre (`lib/cadre`)
  demande à `placePad` la hauteur de la boîte tenue droite et la largeur de
  chaque grappe en travers. Ajouter une touche à une face change donc la
  place de la manette, sans rien recopier ; `cadre.test.ts` pose la vraie
  manette dans la boîte du cadre et vérifie qu'aucune pièce ne touche
  l'image.
- **Une salle Wii garde les noms de la GameCube.** Elle présente un appareil
  par place, et le pavé ne le connaît pas. Nommer ses touches comme une Wiimote
  mentirait à qui joue avec la manette GameCube.
- **Un essai exige une face pour chaque console du manifeste**, et son jumeau
  refuse une console inconnue, même un nom comme `toString`.
- **Le nom d'un appareil.** La fiche d'un jeu le nomme selon la salle
  (`deviceLabel`) : « manette Pro » pour un jeu Switch, « manette Xbox 360 »
  pour un jeu Xbox. `padLabel`, qui ne connaît pas la salle, nomme le code 4
  « manette Pro » (`PRO_PAD`) et dit « appareil N inconnu » pour un code que
  personne ne présente. Une première version disait « appareil 4 inconnu », et
  la préparation d'un jeu Switch l'affichait pour chaque joueur prêt. Depuis
  le 22 novembre 2026, les deux panneaux de préparation (`Preparation` et
  `SwitchBindings`) lisent `lib/lancement.ts`, qui passe la console à
  `deviceLabel` : une salle Xbox 360 dit « manette Xbox 360 · prêt », et
  l'en-tête nomme la console du jeu préparé (« Avant de jouer · GameCube »)
  au lieu de « Wii » ou « Switch · manette Pro » écrits en dur. Pendant une
  préparation, `App` passe aussi à `Bindings` la console du jeu préparé, et
  plus « wii » : une préparation GameCube n'affiche plus le sélecteur de
  lecture des jeux Wii.
- **`SwitchTouchPad` exige `console` et `bar`**, même `undefined` pour la
  console. Une salle Xbox 360 ne parle Xbox que par cette prop : oubliée dans
  `App`, elle retomberait en silence sur les noms Switch. Elle ne compile plus.

**La place des touches est un calcul pur.** `placePad` rend une pose : un
rectangle par pièce, et `degraded`, qui dit en mots ce que la pose n'a pas su
tenir (`null` quand tout tient). `TouchPad` et `SwitchTouchPad` posent ces
rectangles par le même composant `Pave`, qui écrit `data-degradee` sur sa boîte
quand la pose est dégradée. La feuille `components/manette-tactile.css` ne dit
que l'aspect.

- Chaque côté est une pile : des rangées en haut (gâchettes, puis −, + et
  clics des sticks), deux groupes en bas (le plus utilisé sous le pouce). Un
  groupe qui tient dans sa bande noire s'y range ; sinon il se colle au bord de
  l'écran.
- Quand la hauteur manque (568 sur 260, un petit téléphone en travers avec les
  barres du navigateur), les rangées d'un côté passent sur une seule ligne.
  Quand la largeur manque, les palettes deviennent rondes (280 px, l'écran
  extérieur d'un Galaxy Fold), puis les sticks rétrécissent jusqu'à 80 px (sous
  276 px de large).
- **Les gestes de page vont d'abord dans les bandes noires**, là où il reste
  une place à 16 px de toute touche. Les trois vont ensemble si une place les
  tient ; sinon ils se partagent les deux bandes. Sur un iPhone de 844 sur 390
  avec une image 4:3, « son » se range entre L et la croix, « menu » et
  « cacher » entre START et les boutons. Sans bande assez large, ils vont en
  haut au milieu, puis sous les rangées, puis en bas. **Remplacé le même
  jour** : il ne reste qu'un geste, « ••• » (voir la section suivante). La
  règle de place est la même, pour un seul.

La première version posait les gestes en haut au milieu de l'image même quand
les bandes étaient libres. Le contrôle « rien ne mord sur l'image » du pilote
`touch.mjs` serait devenu rouge, et taper le centre de l'avis de fermeture de
la salle ouvrait le menu du jeu.

Les mesures et leurs raisons sont écrites dans `SIZES` et `unitsFor` : 44 px au
moins pour une cible, 16 px entre un geste de page et une touche (l'audit en
demande 12), 4 px de marge dans une bande (les quatre boutons de la GameCube
font 148 px et la bande d'un iPhone de 812 sur 375 en fait 156), 72 px pour un
geste (« CACHER » mesure 60,1 px), 4 px entre deux gestes (deux tiennent côte à
côte dans cette bande de 156 px).

**Au-dessus et en dessous.** La boîte du pavé est en `z-index: 29`, sous les
calques de la salle à 30 qui viennent avant elle : l'avis de fermeture et le
message de branchement. Un avis qui dit que la salle ferme passe avant la
manette ; il naît de l'inactivité, donc personne ne joue quand il s'affiche.
Le menu (50) reste au-dessus, l'avis de format réduit (20) dessous.

**Lisible dans les sept thèmes.** Les lettres en couleur d'une Xbox reposent
sur un fond sombre fixe : sur le fond clair du thème instrument clair, A
tombait à 1,05:1 et Y à 1,22:1. Les gestes de page ont le panneau du thème
pour fond, opaque : `--faint` y tient 4,5:1 dans chaque thème, mais pas sur un
panneau clair rendu transparent au-dessus du noir (2,3:1 mesuré).

**La croix est un seul bloc.** Quatre boutons de 28 px laissaient le doigt
tomber entre deux branches. Le bloc se lit à l'angle du doigt (`crossFrom`) :
chaque direction couvre 120 degrés, les diagonales sont les 30 degrés où deux
directions se recouvrent, et le centre est mort. Un doigt peut glisser d'une
direction à l'autre sans lever. Ses quatre flèches sont du dessin
(`aria-hidden`) ; le groupe se nomme « croix directionnelle ».

**Les preuves.**

- `faces.test.ts` balaie 1 267 tailles d'écran (de 260 px de petit côté à
  1 440, jusqu'à 2,8 pour 1), quatre formats d'image et trois faces, soit
  15 204 poses, plus cinquante tailles d'écrans réels avec et sans les barres
  du navigateur. Rien ne se recouvre, rien ne sort de l'écran, aucune cible
  sous 44 px, aucun geste à moins de 12 px d'une touche, et aucune pose ne se
  dit dégradée. Une pose fautive fabriquée exprès (« cacher » sur R) doit être
  nommée, et une boîte de 240 sur 240 doit donner une pose dégradée.
- `just manette-garde` lance `spikes/m3-browser-drive/manette-garde.mjs`. Vite
  sert les vrais composants sans relais vers une salle. À sept tailles et dans
  quatre salles, la garde vérifie que le centre et un point à 3 px de chaque
  bord de chaque touche la reçoivent (`elementFromPoint`), qu'un vrai appui de
  doigt arrive au pavé sous son nom sans déclencher de geste, qu'aucun geste de
  page n'est à moins de 12 px d'une touche, qu'aucune inscription ne sort de sa
  touche, qu'avec une bande de 130 px rien ne mord sur l'image, gestes compris,
  et que l'avis de fermeture, copié avec la classe lue dans `App.tsx`, reçoit
  son centre et ses bords. Dans les sept thèmes, chaque inscription doit tenir
  4,5:1 sur le noir de la bande. Trois jumeaux négatifs ouvrent la garde.
- Sur les pavés d'avant le 22 novembre, la garde échoue dans les 28 cas. Sur la
  première version de cette branche, elle échoue dans 24 cas (gestes sur
  l'image, avis recouvert, lettres Xbox et gestes illisibles en thème clair).

**Ce qui n'est pas prouvé.** La garde monte le pavé seul, dans la même boîte
que la salle, avec la même largeur de bande que `App`, plus une copie de l'avis
de fermeture. Les autres calques (message de branchement, menu, colonne) n'y
sont pas. Le message de branchement, à z-30, couvre maintenant L ou ZL pendant
ses cinq secondes. Rien n'a été essayé sur un vrai téléphone. Les zones sûres
valaient zéro tant que la page n'avait pas `viewport-fit=cover` ; elle l'a
depuis le 22 novembre (commit a4d4595, 11 h 08 UTC), et `salle-telephone.mjs` les simule
(`Emulation.setSafeAreaInsetsOverride`), sans encoche réelle. Le pilote de salle
`touch.mjs` n'a pas été relancé : il demande une salle vivante ; la garde rejoue
sa règle « rien sur l'image » sur le banc. Sur une image très claire, les
touches translucides perdent du contraste : 2,79:1 au pire pour le A de la
GameCube sur du blanc, 3,67:1 pour le B d'une Xbox (non exigé). Sur le noir,
le plus juste est le geste « son » : 4,50:1 dans le thème par défaut, le seuil
même que `--faint` vise sur le panneau. Les touches de
44 px couvrent plus d'image qu'avant sur une tablette tenue en travers, où il
n'y a pas de bande noire (68 080 px² contre 52 098 pour la GameCube en 1024 sur
768). Sur un téléphone en 16:9, les bandes font 76 à 84 px : aucun stick n'y
tient, et les groupes se collent au bord.

## Un seul geste de page, et la feuille du bas, 22 novembre 2026

Le même jour (commit a4d4595, 11 h 08 UTC), les trois gestes de page de la manette (son, menu, cacher) sont
devenus **un seul « ••• »**, qui ouvre la feuille du bas
(`components/FeuilleDuBas.tsx`, contenu décidé par `lib/feuille.ts`). Elle porte
le son, le menu du jeu, la salle (le tiroir de la colonne), cacher ou montrer
la manette, le plein écran ou l'écran d'accueil, et le signalement.

Ce qui n'est pas lisible dans le code :

- **`GESTES` vaut `["feuille"]`**, et `GESTE_W` 56 px. `placePad` sait toujours
  en placer plusieurs : le compte vient de ce tableau. Un retour de « son » ou
  « cacher » parmi les touches remettrait une cible de page sous les pouces ;
  `TouchPad.test.tsx` refuse les trois anciens identifiants.
- **Le son coupé se voit sur le « ••• »** des deux manettes : bordure en
  alerte, pastille, et « Son coupé. » au début de son nom accessible
  (`nomDuPlus`). `App` passe enfin `soundOff` à `SwitchTouchPad` : en salle
  Xbox 360, rien ne le disait (audit M10). L'écoute qui relance le son
  (`media/reveil-son.ts`) reste posée après le premier succès : un appel ou
  une autre application coupe le contexte sur iOS, et le geste suivant le
  relance. Ce dernier point est déduit du code et de la documentation, pas
  vérifié sur un iPhone.
- **La manette n'est pas montée sous la feuille ni sous le tiroir.** Son
  démontage relâche ce qu'un doigt tenait encore. Sans manette à l'écran (une
  souris, une vraie manette), un « ••• » seul se pose en haut à droite, dans
  les zones sûres. Ce qui est monté se décide en un seul endroit,
  `couchesDeLaSalle` (`lib/disposition.ts`) : un tiroir n'existe qu'en mode
  compact, et sur un grand écran, « La salle » déplie la colonne
  (`ouvrirLaSalle`). Avant la relecture, une manette « toujours » sur un grand
  écran disparaissait sous un tiroir qui ne s'ouvrait jamais.
- **Un clic de souris sur le « ••• » ne prend pas le focus**
  (`onMouseDown` qui l'empêche). Le focus pris faisait monter l'avis « le jeu
  ne reçoit plus tes touches » sous le pointeur, entre l'appui et le relâché,
  et le clic tombait sur l'avis : sur un grand écran, la manette « toujours »
  pose son « ••• » en haut au milieu, là où vit cet avis. À la fermeture de la
  feuille ou du tiroir, le focus revient au jeu, ou au « ••• » quand il était
  tombé sur le document (`focusApresFermeture`).
- **Une page « manette seule » ne voile pas sa manette pendant un
  chargement** (`voileSurImage`) : sans image, rien ne peint, et l'écran de
  chargement attendait sans fin. Son chargement s'efface quand la salle
  annonce le jeu demandé (`suiteDuChargement`, `lib/booting.ts`). Retiré
  avec le mode le 27 novembre 2026 (ADR D47).
- **`manette-garde.mjs` attend un geste de page, et non trois**, et deux
  inscriptions de moins par thème. Rejouée sur le code d'avant, elle y trouve
  trois gestes et le dit.
- **La salle entière est gardée ailleurs** : `just salle-telephone`
  (`spikes/m3-browser-drive/salle-telephone.mjs`) monte la vraie page avec une
  fausse session média et vérifie, à six tailles et avec les zones sûres d'un
  iPhone simulées, que le « ••• » ouvre la feuille, que la feuille ouvre le
  tiroir, et que chaque fonction de la colonne s'y joint au doigt. Depuis la
  relecture du même jour, elle mesure aussi TOUTES les cibles du tiroir à
  44 px, le bouton qui le referme une fois défilé jusqu'en bas, le focus rendu
  à la fermeture, la manette « toujours » sur un grand écran, Ctrl sous le
  menu, un chargement annoncé par un faux salon (une page « manette seule »
  jusqu'au 27 novembre 2026), la demande de place sous le « ••• », le configurateur Pro en
  paysage, et la page construite servie avec la politique du worker. Chaque
  nouveau cas a été vu rouge sur fbb3bcc.

## Accompagner le branchement, 6 septembre 2026

Les messages de branchement et de débranchement disparaissent après cinq secondes.
Leur fermeture manuelle reste possible. La disparition du message ne change pas
la manette choisie et ne ferme pas un configurateur ouvert volontairement.
Le diagnostic de connexion indique séparément la vidéo, l'entrée et le salon :
une image encore visible ne prouve pas que la place est toujours attribuée.

## Les aplats et le pas à pas, 23 novembre 2026

Premier passage du chantier manettes (thème rétro). Le récit est au carnet,
entrée « 23 novembre, la nuit encore : les manettes, premier passage », et
la décision à l'ADR D42. Ce qui n'est pas lisible dans le code :

- **Le dessin n'a plus de volume.** Une matière est un aplat lu dans la
  section « chantier manettes » de `regie.css` ; la coque prend le milieu
  exact de son ancien dégradé. Seul le contour de la coque suit le thème.
  Un essai refuse un dégradé, un motif ou un filtre dans le dessin rendu.
- **L'appui prend la couleur de la place** (`place` de `PadMapView`,
  `data-place`). L'aplat est la teinte de joueur de l'autre clarté que les
  touches ; l'anneau est un blanc ou un noir d'objet de l'autre clarté que
  la coque. L'anneau dans l'autre teinte du même joueur ne suffisait pas sur
  la Wiimote et la manette standard. Une gâchette dessinée derrière la coque
  se voit sur la page : son anneau prend l'encre du thème. Sans place, un
  aplat d'objet, jamais une couleur de joueur. `lib/manettes-couleurs.test.ts`
  lit les feuilles telles qu'elles partent ; `just banc-visuel` mesure chaque
  place dans les deux thèmes.
- **Une commande passée garde son réglage d'avant**, sauf si une réponse a
  pris son entrée : une entrée fait une seule chose. Une leçon où tout est
  passé n'écrit rien. Avant ce jour, passer une commande l'effaçait.
- **Le repos de la leçon vaut pour le dessin.** `heldOn` reçoit le neutre pris
  au clic (`InputState.neutre`) pour les indices que le profil ignore. Sans
  lui, une gâchette d'adaptateur au repos restait allumée pendant la leçon.
- **Débrancher suspend le pas à pas** (`InputState.suspendu`). Rien n'est
  écrit ; seule la même manette reprend (`reprendreLecon`), avec un repos
  pris au clic.
- **Les deux trames partagent la machine d'étapes** (`Pas`). Le pas à pas
  Pro fait vingt étapes et non vingt-quatre : un `SwitchDevice` garde un axe
  signé par axe de stick.
- **Les marques suivent des événements, pas l'instantané** (`surReglage`,
  `surLecon`). L'instantané React se lit deux fois par seconde ; un abonné
  qui lève ne casse pas la boucle.
- **L'activité de la trame est celle qui est partie** (`InputState.activite`) :
  un menu ou un réglage envoie du neutre, et rien ne s'allume alors.

## Les couleurs nommées et l'appui à deux seuils, 24 novembre 2026

Cinquième passage du chantier manettes. Récit au carnet, entrée « 24 novembre,
avant l'aube : les manettes, cinquième passage » ; décision à l'ADR D42. Ce qui
n'est pas lisible dans le code :

- **Un plan nomme une couleur, il ne l'écrit pas.** `tint` et `ink` sont du
  type `Couleur` (`var(--manette-<nom>)`) ; une valeur en dur ne compile pas.
  Les valeurs vivent dans la section « chantier manettes » de `regie.css`, et
  la copie du salon se régénère avec `N3_REGIE_ECRIRE=1` sur `regie.test.ts`.
  La vue tactile lit aussi `ink` pour la couleur des lettres Xbox.
- **L'appui a deux seuils de 3:1, et une seule mesure les tient.** Contre la
  touche elle-même (sa teinte, sinon le capuchon), et contre ce qui l'entoure
  (son logement ou la coque ; la base de la croix pour une pièce affleurante ;
  la page pour une gâchette derrière la coque). `banc-visuel.mjs` ne mesure
  que le second, l'ancien essai que le premier sur la touche commune : chacun
  laissait passer ce que l'autre refuse. `lib/manettes-couleurs.test.ts`
  mesure les deux, pour chaque pièce, sans place et aux quatre places, dans
  les deux thèmes, comme `padmap.css` dessine (pas d'anneau sur une pièce
  affleurante ; l'encre du thème pour une gâchette derrière la coque, sauf
  `--pad-lit-ring-dessous`). La planche refait le calcul dans Chrome.
- **`appui: "clair"`** marque une touche de teinte moyenne ou sombre entourée
  de sombre : le A de la GameCube, le viseur et les arcs de la Wiimote. Elle
  prend la teinte claire de la place et l'anneau sombre, et le viseur garde
  son anneau bien qu'il affleure. Une nouvelle manette avec une touche de ce
  genre doit la marquer : l'essai le dira sinon.
- **Les renvois gardent un trait visible** de 4 unités entre la pièce (ou la
  coque qui la porte) et leur mot, et leur mot tient dans le repère
  (`padmap.test.ts`, « les renvois »).
- **La planche des manettes** (`padmap-preview.html`, `just padmap-visuel`)
  montre ce que le jeu reçoit et ta manette, à 480, 170 et 120 px, avec les
  inscriptions lisibles et masquées et l'appui le plus faible dans le thème
  affiché. `padmap-qc.mjs` refait chaque mesure ; son jumeau
  `--mutant-contraste` doit échouer sur la Xbox seule. Ses tailles sont
  marquées `data-format` : `data-taille` appartient aux textes des dessins.

## La vignette d'un changement, 24 novembre 2026

Sixième passage du chantier manettes. Récit au carnet, entrée « 24 novembre,
avant l'aube encore : les manettes, sixième passage » ; décision à l'ADR D42.
Ce qui n'est pas lisible dans le code :

- **La vignette ne double jamais un dessin visible.** `useHorsDeVue`
  (`manettes/reglage/Vignette.tsx`) observe la pièce encadrée du dessin de
  gauche ; la ligne en cours ne porte la vignette que tant que cette pièce
  n'est pas entière à l'écran. Sans `IntersectionObserver`, rien n'est monté.
  Le constat porte le nom de sa pièce : celui d'une pièce d'avant ne vaut
  pas pour la suivante.
- **La pièce se cherche par égalité exacte**, pas par sélecteur : la
  GameCube a un stick `x` et un bouton `X`, et jsdom ne distingue pas la
  casse dans `[data-part="X"]`. `marques.ts` et `tenues.ts` gardent le
  sélecteur, juste dans Chrome.
- **`PadMapView recadrer`** rend le `svg` seul, caché au lecteur d'écran,
  avec un `viewBox` carré autour de la pièce. Il garde `data-padmap` pour
  ses couleurs : un essai ou un pilote qui cherche `[data-padmap]` doit se
  limiter à `.n3-dessins`. La feuille coupe la vignette à sa boîte
  (`overflow: hidden`) : les dessins laissent déborder leur tracé.
- **En trame Pro, un sens de stick encadre son stick** : le dessin reçoit
  `pieceDe(lx+)`, soit `LS`, comme les marques du pas à pas.
- **L'aperçu `bindings-preview.html?reglage`** monte le panneau seul
  (`&pro=x360`, `&onglet=clavier`), avec les zones sûres que la colonne
  garde dans la salle ; `salle-telephone.mjs` le mesure au téléphone.

## Le banc qui se peint lui-même, 24 novembre 2026 (matin)

Récit au carnet, entrée « 24 novembre, au matin : les nombres de la manette
ne bougeaient pas » ; décision à l'ADR D42. Ce qui n'est pas lisible dans le
code :

- **Le banc n'est pas peint par les dessins.** `paintWiring` et `paintPro`
  peignent la racine des deux dessins ; `Bench` vit à côté, dans
  `.n3-nombres`. Il a sa propre boucle (`lire`, `paintBench`) et ne peint
  que si son `<details>` est ouvert. Jusqu'au 24 novembre 2026, il comptait
  sur `paintWiring` et affichait 0.00 partout, dans l'ancien dialogue aussi.
- **La jauge d'un bouton part du repos appris** (`restsOf`, la même table que
  `heldOn`), et le trait `.n3-repos` le marque. La jauge d'un axe reste la
  valeur absolue : le cadran montre déjà la position brute.
- **L'horodatage est un afficheur** écrit par `textContent` à chaque image,
  sans rouler, avec `font-mono` : `banc-visuel.mjs` refuse une valeur qui
  change de largeur avec ses chiffres.
- **La preuve** : `nombres.test.tsx` (jsdom, vraie boucle), l'étape `nombres`
  de `reglage.mjs` dans la page construite, rouge sur 842e4c9.

## La relecture du 24 novembre 2026 (midi)

Récit au carnet, entrée « 24 novembre, à midi : la relecture des manettes,
quatre constats » ; décision à l'ADR D42. Ce qui n'est pas lisible dans le
code :

- **La boucle émet « recu » et l'« etape » suivante dans le même appel.**
  `marques.ts` tient donc deux séquences : l'étape suivante coupe celle de
  l'étape d'avant, jamais la réponse qui vient de la clore. Remettre
  `reponse.couper()` dans la branche « etape » efface les coins avant toute
  peinture, et `marques.test.tsx` (vraie `InputStream`, vraie `SwitchInput`)
  tombe. Un essai qui émet « recu » seul ne prouve rien ici.
- **Un axe n'est pas une pièce.** `a1-` désigne le stick `a0` du dessin de
  droite (`stickDe`), cherché dans le dernier `svg[data-padmap]` de la
  racine : sur la trame Pro, les deux dessins nomment leurs sticks `a0`.
- **Le focus du pas à pas** passe par `PasAPas.tsx` : l'invite le pose sur
  « Commencer » et s'annule seule par Échap, une étape le pose sur son titre,
  et `useFocusRendu` rend un focus perdu à `#reprendreLecon`,
  `#reglerPassee` ou `#learnPad`, dans cet ordre. Il ne reprend jamais un
  focus posé hors du panneau. `Reglage.tsx` lit l'état occupé au moment de
  la touche (`occupeDe`) : la trame Pro change sans rendre le panneau.
- **Les phrases** du panneau et de `media/switch.ts` vivent dans `REGLAGE`
  (`lib/mots.ts`, dont `REGLAGE.pro` pour les avis de la trame Pro) ;
  `mots.test.ts` refuse une phrase écrite sous `manettes/` ou dans
  `media/switch.ts`. Les phrases de `Wiring.tsx`, `KeyboardWiring.tsx`,
  `Bench.tsx`, `media/pad.ts` et `media/input.ts` viennent de `main` et
  restent hors de cette règle.
- **Tenu en main, le panneau couvre encore l'image.** Il attend un
  emplacement de `lib/cadre.ts` (chantier salle) ; `place-tenu` le mesure,
  hors de la porte. *Remplacé le 24 novembre 2026 au soir :
  `Geometrie.reglage`, et `place-tenu` est dans la porte.*
- **La preuve dans le navigateur** : les étapes `marques` (relevé à chaque
  image) et `focus-pas` (clavier seul) de `reglage.mjs`, rouges sur 9b1c8e8.

## Le panneau « Touches et manettes », 23 novembre 2026 (tard)

Le panneau « Touches et manettes » vit dans `front/src/manettes/`. Depuis le
quatrième passage, `App.tsx` le monte en vue de la colonne (`HoteReglage`) ;
les dialogues `Bindings` et `SwitchBindings` n'hébergent plus que la
préparation à plusieurs, jusqu'à ce que le chantier des menus la sorte
(c'est fait, et les dialogues sont retirés le 24 novembre 2026). Ce
qu'il faut savoir avant d'y toucher :

- **Le chemin d'ouverture.** Le menu, « Changer » de la vue des touches et
  « Toutes les touches » (`ToutesLesTouches`, au bout du panneau de
  commande) passent par `ouvrirLesTouches` d'`App.tsx`, qui ferme le menu
  modal puis appelle `ouvrirReglage`. Tenu en main, la colonne vit dans la
  feuille agrandie, qui couvre l'image : la place sous l'image et à droite
  en travers attend la géométrie du cadre (chantier salle). *Remplacé le
  24 novembre 2026 au soir : voir « Ce qui existe ».*
- **La largeur.** Au bureau, le cadre reçoit `largeurPanneau` et la colonne
  prend la largeur du cadre tant que le panneau est ouvert. Retirer l'un ou
  l'autre fait échouer l'étape `place` de `reglage.mjs`.
- **La preuve dans le navigateur** : `just reglage-navigateur` (place,
  entrées et focus, activité de la trame Pro, zones de clic, vignette d'un
  changement, nombres, marques d'une réponse, focus du pas à pas, pas à pas
  sur une manette simulée) et `just reglage-navigateur-rouge` sur les pages
  de 9fb659e, bc72ba9, e62f583, 842e4c9 et 9b1c8e8.
- **Les zones de clic.** À la souris, `PadMap.tsx` pose un disque
  invisible `.n3-zone` dans chaque pièce cliquable ; `tenirInscriptions`
  lui donne son rayon à chaque changement de taille (`zones.ts` : 24 px
  visés, jamais sur une voisine). Au doigt, `Wiring` ne passe pas
  `onSelect` : aucune pièce n'est un bouton.

- **L'invariant tient.** Le panneau pose `Wiring` tel quel pour Dolphin : la
  gauche lit `readPad`, la droite `heldOn`. Pour la trame Pro, `paintPro`
  (`lib/wiring.ts`) peint la gauche depuis la trame envoyée et la droite
  depuis les indices bruts, chacune dans sa racine : les deux dessins
  nomment leurs sticks `a0` et `a2`, et une racine commune mélangerait leurs
  inclinaisons.
- **Une entrée.** `ouvrirReglage(onglet)` (`manettes/entree.ts`) ouvre le
  panneau ou change d'onglet ; l'ouvreur retenu au premier clic reprend le
  focus à la fermeture, sinon le repli donné par la salle.
- **Les marques sont hors de React.** `manettes/reglage/marques.ts` s'abonne
  à `surReglage` et `surLecon` et ne change que `data-marque` sur les pièces
  déjà dessinées. La gauche porte les commandes (A, x, LS), la droite les
  indices (b0, b10) : leurs noms de pièce ne se croisent pas. Les sticks,
  eux, se nomment `a0` et `a2` des deux côtés sur la trame Pro (voir la
  relecture du 24 novembre).
- **Le plancher de 9 px** des inscriptions (`inscriptions.ts`) lit
  `data-taille` et `data-piece`, que `PadMap.tsx` pose sur ses textes.
  Retirer ces attributs rend le plancher muet sans rien casser d'autre ;
  `inscriptions.test.tsx` le vérifie sur le vrai dessin.
- **Les coins, la flèche et la liaison** (troisième passage). Chaque pièce
  porte `.n3-coins` et `.n3-fleche`, cachés par `padmap.css` ; la feuille
  les montre sous `data-selected`, `data-attendue` et `data-marque`. La
  ligne de liaison est un calque `.n3-liaison` posé par `marques.ts` dans la
  racine `.n3-dessins`, au-dessus des deux `svg`.
- **La peinture n'écrit que ce qui change.** `paintWiring` et `paintPro`
  passent par `poser` : `tenues.ts` observe `data-lit` sur le dessin de
  gauche, et une écriture identique à chaque image le réveillerait autant.
  Remettre une écriture inconditionnelle fait échouer
  `wiring-pro.test.tsx`.
- **Les pièces ne sont plus dans la tabulation** (`tabIndex` -1) : la table
  « Toutes les correspondances » est le chemin du clavier. Un clic de souris
  sur une pièce choisit encore sa ligne.

## La fin du chantier, 24 novembre 2026 (soir)

Récit au carnet, entrée « 24 novembre, le soir : la fin des manettes » ;
décision à l'ADR D42 et D35. Ce qui n'est pas lisible dans le code :

- **Le cadre décide la place tenue en main, App la monte.** `Entree.reglage`
  fait poser `Geometrie.reglage` à `portrait` et `paysage`. `useGeometrie` liste le champ dans ses dépendances :
  sans lui, le rectangle resterait celui du calcul d'avant. Le panneau, la
  bande, la manette et l'étiquette de la bande sont absents de cette
  géométrie ; la barre reste, avec « La salle ».
- **L'entrée de la feuille compte ses rangées.** Trois rangées de deux
  entrées tiennent dans `FEUILLE_MI_MIN` ; une rangée de plus coûte 80 px
  (`RANGEE_MI`), mesurés à 390 × 844 et non déduits d'un `min-height`. Ajouter une entrée à la feuille déplace ce calcul : la
  feuille ne défile jamais (`salle-telephone`).
- **Le rang vient juste sous Signaler**, qui reste premier (K25). À 1280×720
  avec une image 4:3, les places sont au pied de la colonne et les rangs
  passent sous le pied collé : le rang se rejoint en faisant défiler. Un clic
  de pilote passe par `toucher` (le centre de ce qui reçoit le point), sinon
  il tomberait sur « Plus bas ».
- **Les classes mortes ont un garde.** `classes.test.ts` lit `index.css`,
  `padmap.css` et `reglage.css` ; il a nommé les 38 classes que les anciens
  dialogues laissaient dans `index.css`.
