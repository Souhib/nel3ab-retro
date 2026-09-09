# L'écran des deux manettes

Note de reprise pour l'écran `touches → les deux manettes`. Elle dit ce qui n'est
pas lisible dans les fichiers, et ce qui casse quand on l'ignore.

**Périmètre au 9 septembre 2026.** L'invariant ci-dessous concerne Dolphin.
La Switch possède une trame et un configurateur distincts, décrits à la fin de
cette note. L'[état du projet](etat-du-projet.md) relie les deux parcours.

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

## Le configurateur du 6 septembre 2026

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

## Apprendre sans agir dans le jeu

La leçon expose la commande attendue, l'étape et l'attente de relâchement.
`Bindings` la garde visible dans le dialogue et `PadMapView` éclaire la pièce
attendue. Sur téléphone, la consigne précède les dessins pendant l'apprentissage.

Le bouton de configuration ouvre d'abord une consigne de repos. Annuler ne
remplace pas le profil précédent. Un bouton ne peut pas valider une question
qui demande un stick. Une assignation de stick conserve son axe, son signe et
son repos, comme la leçon complète.

La boucle envoie un état neutre pendant la capture et la leçon. Elle attend aussi
le relâchement du dernier appui avant de rendre la main au jeu ou au menu.
Débrancher la manette annule la configuration, et Échap annule avant de fermer
le dialogue. Les profils JSON sont validés avant d'être lus par la boucle.

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

| Fichier | Responsabilité |
|---|---|
| `front/src/lib/padmap.ts` | Plans en données, Wiimote seule et choix de famille |
| `front/src/lib/wiring.ts` | Lecture brute, repères verticaux et `paintWiring` |
| `front/src/components/PadMap.tsx` | Tracés, libellés, sélection et balisage animé |
| `front/src/components/Wiring.tsx` | Assemblage et abonnement à l'animation |
| `front/src/components/Bindings.tsx` | Dialogue, capture, profils et portée des actions |
| `front/src/media/lesson.ts` | Capture, étapes, repos et collecte des ports du modèle |
| `front/src/media/profile.ts` | Validation des profils chargés |
| `front/src/lib/bindings.ts` | Semis, copie en attente et envois au service |

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

Démarrer Vite sur le port 5202 dans `front/`, puis lancer
`just browser-configuration`. Le pilote ouvre le configurateur réel sur une
manette simulée, sans socket de jeu ni écriture au salon. Il teste les gestes
et photographie ordinateur, téléphone et apprentissage.

`just banc-visuel` monte également les vrais composants et vérifie son lot de
contrastes. Il doit sortir en erreur si un texte ou un trait échoue.
Sa mesure historique compare les traits au fond de l'aperçu ; elle n'équivaut
pas à une vérification de chaque fond coloré d'une pièce.

`just browser-contraste` et `just browser-bindings` ciblent le worker vivant :
ils ne voient pas les changements avant un déploiement. Un résultat contre
l'ancienne page ne peut pas valider celle de l'arbre de travail.

## Préparation et profils personnels

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

`just browser-preparation` teste ce parcours sans salle. Les tests Python font
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
`configuration-ui.mjs` et `preparation-ui.mjs` vérifient l'ordre, les deux états
initiaux et la possibilité de refermer les correspondances, sur le vrai dialogue.

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

## Accompagner le branchement, 6 septembre 2026

Les messages de branchement et de débranchement disparaissent après cinq secondes.
Leur fermeture manuelle reste possible. La disparition du message ne change pas
la manette choisie et ne ferme pas un configurateur ouvert volontairement.
Le diagnostic de connexion indique séparément la vidéo, l'entrée et le salon :
une image encore visible ne prouve pas que la place est toujours attribuée.
