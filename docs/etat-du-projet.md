# État du projet au 23 novembre 2026

Ce point de reprise conserve le travail commencé en septembre et les
livraisons datées jusqu'au 10 novembre. Il indique où retrouver les décisions, les expériences
et leurs limites. Le [carnet](carnet-de-bord.md#11-septembre-ce-que-le-mois-a-appris)
conserve leur déroulement ; l'[ADR](adr/0001-architecture.md) conserve les règles
qui en résultent. Les anciens plans M1 à M3 sont des archives de conception.

**Au 23 novembre : le socle du thème rétro, sur une branche.** Le
propriétaire a choisi un thème de consoles 8 et 16 bits et de salle d'arcade
autour de la mire « HORS ANTENNE », le logo en pixels « relief en escalier »,
Pixelify Sans pour les titres, et les 46 effets de la page des effets derrière
un réglage à trois niveaux. Le socle est sur `chantier/retro-socle` (worktree
`~/nel3ab-chantiers/retro-socle`) : rien n'est dans `main`, rien n'est
installé, la branche n'est pas poussée. Il pose, sans déplacer aucun élément
d'écran :

- **Couleurs.** Les rôles de la régie gardent leurs noms et prennent les
  valeurs rétro, seize couleurs par thème comptées par l'essai, la mire en sept
  jetons (`front/src/regie.css`). Trois valeurs ajustées pour le contraste.
- **Police et logo.** Pixelify Sans variable, sous-ensemble français de
  10 020 octets (`control/.../polices/`, provenance à côté). Le logo remplace
  le mot « nel3ab » dans la colonne, l'avant-salle, l'ouverture, l'entrée du
  nom et les trois pages du salon ; l'icône d'onglet est le 3 aux couleurs de
  la mire (`front/src/lib/logo.ts`).
- **Effets.** Le moteur (`front/src/lib/effets.ts`, clé `nel3ab:effets`,
  classes `fx-<id>` posées avant la première image), la feuille commune
  (`front/src/effets.css`, classes `rt-…`), les outils (`front/src/retro/`) et
  la mascotte provisoire, une pièce en pixels, avec dix-neuf scènes abstraites
  (`front/src/mascotte/`). Le salon reçoit tout cela par `retro.py`.
- **Réglage.** « effets rétro » (sobre, conseillé, tout) et « sons de menu »
  dans le menu de la salle et au pied de l'accueil.
- **Encore là.** Bobine (`front/src/bobine/`, `routes/bobine/`), les trois
  tableaux de bord (XMB, Wii, Switch) et les dessins de manettes de la régie :
  les sept chantiers d'écran les remplaceront écran par écran.

- **Retouches demandées par les chantiers d'écran** (K14, K27 et K28 de leur
  partition). Le cycle de la mire fait un pas par seconde. Les jetons de
  l'écran de la borne (`--encre-ecran`, `--ecran-trame`, `--fronton-encre`),
  du panneau de commande (`--panneau`, `--panneau-filet`), des boutons START
  (`--start-encre`, `--start-eteint-*`) et de l'offre (`--offre`) sont dans
  `regie.css`, chaque paire mesurée avec son jumeau. Les couleurs d'objet des
  manettes forment la dernière section de `regie.css`, qui appartient au
  chantier des manettes. Quatre icônes partagées (chevron, curseurs, horloge,
  porte) sont dans `front/src/retro/icones.ts`.

Poids de la page de salle : 235 700 octets en brotli, 64 300 sous le budget.
Décision : [ADR](adr/0001-architecture.md) D37 et son amendement. Récit :
entrées « 23 novembre : le thème rétro, et ses effets derrière un réglage »
et « 23 novembre, l'après-midi : ce que les chantiers d'écran demandaient au
socle ». Non prouvé : aucun effet vu sur un vrai téléphone, et aucun effet ni
aucun des nouveaux jetons n'est encore posé dans un vrai écran.

**Au 23 novembre : le chantier « données », sur une branche.** Ce que le
salon publie de chaque salle, pour les écrans du thème rétro
(`chantier/retro-donnees`, worktree `~/nel3ab-chantiers/retro-donnees`, partie
du socle ; rien dans `main`, rien d'installé, rien de poussé). ADR D38.

- **Ouverture et temps de jeu.** `Salle.ouverte_depuis` dit depuis quand le
  salon a ouvert la salle (repère `ouverte-le`) ; l'ancienne valeur, qui
  repartait à chaque changement de jeu, est `Salle.jeu_depuis`. Le faux
  systemd des essais suit le vrai (`control/tests/faux_systeme.py`).
- **Dossier de salle.** Le salon y lit et écrit par `session_salle.py`, sans
  suivre de lien ni attendre sur un tube ; le marqueur `game-closed` aussi, et
  la bibliothèque `catalogue.json` depuis la relecture du 23 novembre, qui l'a
  trouvée lue par son chemin (ADR D38).
- **Fermeture et silence.** `Salle.fermee_depuis` et `Salle.fermee_pour`
  (inactivité, arrêt, panne), lus dans systemd ; `Salle.repond` sépare une
  salle allumée mais muette d'une salle sur son menu.
- **Jeu en cours et dernier jeu.** `Salle.console` et `Salle.cle` (K19) ;
  `Salle.dernier_jeu` et `Room.dernier_jeu`, lus dans `chosen-rom` ; une salle
  qui redémarre dit le jeu qui revient.
- **Qui est là.** `Salle.chef`, `Salle.sieges` et `Salle.regardent`, tirés de
  ce que le salon tient déjà, sans question de plus au worker.
- **Qui a lancé.** `Room.lancement` (lanceur et sauvegarde du jeu en cours),
  rien après un redémarrage du salon.
- **Messages de socket.** `menu` et `Person.au_menu` (D15) ; `plainte_quoi`
  et `reste_s` dans chaque refus de cadence (D20).
- **Sauvegardes.** `Emplacement.cle` (D19).
- **Ouvrir une salle précise, et sur un jeu (D17).** `POST /api/salles`
  accepte `{numero}`, et `{cle, sauvegarde}` (0 ou 2) : le salon pose l'ordre
  `ouvrir-sur`, que le worker suit et retire à son démarrage. Demande de
  reconstruire le worker ; un worker d'avant ouvre la salle sur son menu.
- **Jaquettes sans salle ouverte (D13, ADR D45).** Le worker écrit
  `art/<sha256 de la clé>.png` à côté de `catalogue.json` à chaque
  démarrage ; le salon les sert à `GET /api/catalogue/art/{cle}`. Demande de
  reconstruire le worker ; une salle les écrit à son prochain démarrage.
- **Image déposée par le propriétaire (ADR D45).** `PUT` et `DELETE
  /api/catalogue/art/{cle}`, pour l'administrateur : `<jeu>.nel3ab.png` à côté
  du jeu, prioritaire sur la bannière GameCube et Wii. Le bouton de la page de
  dépôt (`importer.html`) reste au chantier du salon.
- **Jalons du worker (lot 2, ADR D43).** `/roms` porte `depuis_ms`, `moteur`
  et `image_ms` ; le salon publie `Room.partie`. Demande de reconstruire le
  worker, sans salle ouverte, APRÈS le redémarrage du salon.
- **Durées de démarrage (D05).** `nel3ab_control/demarrages.py`,
  `NEL3AB_DEMARRAGES_FILE` (`~/.local/state/nel3ab/demarrages.jsonl`) ;
  `Game.demarrage` à partir de cinq démarrages réussis.
- **« Je reste » (D16).** Message `Reste` d'un octet sur la socket de
  manette ; la méthode `reste()` de `front/src/media/input.ts` reste à écrire
  après la fusion du chantier des manettes (K34).
- **Mise en service.** Le salon seulement (`deploy/salon-importable.sh` puis
  redémarrage), avant la page. La page actuelle lit `ouverte_depuis` et affiche
  maintenant la vraie ouverture ; une salle ouverte avant la mise en service
  n'a pas de repère et tait la ligne jusqu'à sa prochaine ouverture.

**Au 23 novembre, le soir : le chantier salle, premier passage.** Sur
`chantier/retro-salle` (worktree `~/nel3ab-chantiers/retro-salle`), parti du
socle ; rien dans `main`, rien d'installé, rien de poussé. Livré : la mise en
page pure de la salle (`front/src/lib/cadre.ts` : modes, neuf états,
panneau décidé sur la vraie pose, emplacements, lieu de la mascotte), l'arbitre
des scènes (`lib/scenes-salle.ts`), les rangs de la colonne
(`lib/colonne.ts`), la boucle d'attention de l'écran éteint
(`lib/attention.ts`), la phrase de latence de la manette seule
(`lib/manette-seule.ts`), la racine `[data-cadre]` et ses variables, la pile
des avis hors de l'image, la fin des boutons de coin d'une colonne repliée,
la poignée de colonne qui ne mord plus sur l'image. Preuve nouvelle : `just
cadre-navigateur` et son contrôle `just cadre-navigateur-rouge` (page de
03b21c0). Au bureau, deuxième passage : la colonne nouvelle (`Colonne.tsx`,
rangs nommés, « Autres réglages », « Plus bas », marge de défilement de
60 px), le coin et sa ligne des mesures (les onglets « essentiel » et
« mesures » sont partis), le panneau de commande sous l'image ou au pied de
la colonne, `Sidebar` retiré, un arbitre des scènes par salle. Preuves :
`cadre.mjs` `meuble-place`, `une-fois`, `un-plein` (rouges contre 0fef99e)
et `focus.mjs` `colonne-deborde`. Au repos, plus de menu d'office : l'écran
éteint dit « Pas encore de jeu. », donne le focus à « Choisir un jeu » à qui
choisit et nomme qui choisit aux autres, et la scène d'attente joue trois
fois au plus sur le plateau ; le spectateur lit « Prendre la place N »
(`cadre.mjs` `repos-sans-menu`, `repos-attention`, `parcours.mjs`
`spectateur-prendre`). Troisième passage : la vue « Tes touches au
clavier » ou « Ta manette », lue dans les tables du produit
(`lib/verification.ts`), dont les cases se cochent quand la commande part au
jeu (`focus.mjs` `touches-cochees`, `agrandir-ctrl`) ; les sticks et la
trame Pro attendent l'activité que le chantier manettes ajoutera à
l'instantané. Les effets du cadre : fronton, flancs de borne, crédit et
trame, dans les bandes et jamais sur l'image (`cadre.mjs` `fronton-bande`,
`credit-compte`, `tramage-hors-image`, `borne-bandes`) ; le temps de jeu
attend l'instant de lancement (D04). Quatrième passage : la salle tenue
en main. Au doigt, la barre (salle, jeu, « La salle »), l'écran, le panneau,
la bande et la manette tactile dans sa propre boîte, sous l'image tenue
droite ou en deux grappes en travers, à la taille que sa vraie pose demande
(`encombrement` dans `lib/faces`) ; la feuille du bas et le tiroir fondus en
une feuille « La salle » à deux hauteurs ; la colonne sous l'image d'une
fenêtre étroite à la souris ; la page « manette seule » (`ManetteSeule`).
Preuves : `salle-telephone` et `manette-garde` récrits (0 px² de touches sur
l'image), `cadre.mjs` `tenu-rien-sur-image` (rouge contre cf3bba1). Un
spectateur (qui a choisi de regarder) tenu en main n'a plus de manette, et
sa place à prendre est dans la bande. Mesure alternée des effets (`just cadre-mesure`, deux séries de
quatre phases de 60 s) : aucun coût répétable dans Chrome sans écran, sous
une charge étrangère, donc une tendance ; et, corrigé à la relecture, les
deux bras ne différaient que par la police du texte : le coût du fronton,
des flancs, de la trame et des calques du niveau « tout » n'est pas mesuré.
Cinquième passage : une vraie
manette n'a plus d'avis à l'écran. Le branchement est dit au lecteur
d'écran ; au téléphone, la bande dit quelle manette joue et à quelle place,
avec « Vérifier les boutons » et les commandes tactiles ; en automatique, la
manette efface les touches à l'écran, et le téléphone tenu droit conseille
de se tourner (`cadre.mjs` `manette-branchee`, rouge contre 03b21c0, et
`manette-vraie`). La feuille à mi-hauteur garde le clip, sauf en travers
(`feuille-clip`). L'ancre de l'annonce du socle est posée sur la ligne du
titre. `mascotte-hors-image` et `vit-figee-immobile` vérifient la mascotte
pendant ses scènes et un cadre immobile quand l'image s'arrête. Les captures
de nuit et de jour sont prises (`cadre.mjs --clair`). Reste : le temps de jeu
(D04), l'activité des sticks et de la trame Pro (K34), l'étiquette dans la
manette, l'amendement de D29 avec etats et la porte entière. Sixième
passage, après une relecture indépendante (neuf défauts, chacun vu rouge
d'abord) : la garde de l'image voit aussi les calques sans pointeur ; la
tête de la mascotte passe dans « La salle » quand la barre manque ; à la
souris, la manette « toujours » a sa place hors de l'image (`souris-toujours`,
l'image rapetisse pour qui l'a choisie) ; « Quitter la salle » part par la
transition « sortir-salle » et le ▶ du socle suit la colonne
(`sortir-salle`, `anneau`) ; la manette accepte le libellé de « La salle »
promis aux personnes ; `TempsDeJeu` garde une horloge stable ;
`manette-branchee` compte un geste absent comme une faute ; les pages de
référence de `cadre-navigateur-rouge` qui ne vivent que sur la branche sont
gardées dans `spikes/m3-browser-drive/rouges/`. Restent déclarés : pas de ▶
dans la feuille à mi-hauteur (pas de place à gauche d'une entrée) ; le menu
garde sa propre sortie, sans transition (chantier menus). Poids : 249 436
octets en brotli, 13 736 pour la salle, au-delà de son enveloppe de 12 000 :
les modules du socle pour les transitions et le ▶ (1 947 octets) entrent ici
dans la page pour la première fois, et le partage revient au chef de
chantier. Décision : [ADR](adr/0001-architecture.md) D39 (en
partie livrée), qui amende D28 et D35. Récits : « 23
novembre, le soir : le cadre de la salle, et rien sur l'image » et « 23
novembre, la nuit : la colonne du bureau et le panneau de commande » et
« 23 novembre, tard : une salle au repos n'ouvre plus rien » et « 23
novembre, encore : la vue des touches, lue dans le produit » et « 23
novembre, encore plus tard : la borne autour de l'image » et « 23 novembre,
la nuit encore : la salle tenue en main » et « 23 novembre, au bout de la
nuit : ce que coûtent les effets » et « 23 novembre, avant l'aube : une
vraie manette se dit dans la bande » et « 23 novembre, après la relecture :
neuf défauts du chantier salle ».


**Au 22 novembre, l'après-midi : la Xbox 360 n'est plus expérimentale.** À la
demande du propriétaire, après la partie de Sonic de douze minutes et demie
sans gel sous X11. Le champ `experimental` passe à faux dans
`consoles/consoles.json` et dans `Console::experimental()` : le menu dit
« Xbox 360 » sans mention, et le carnet de jeu reçoit `experimental: false`.
La note de la console dit ce que le joueur sent : « gâchettes tout ou rien,
à-coups possibles ». La Switch 2 reste expérimentale. Mode d'emploi :
[La Xbox 360 dans la salle](xbox360.md). Récit : entrée « 22 novembre : la
Xbox 360 devient une console ordinaire ». Le même jour, le propriétaire a
rejeté la direction visuelle de la régie : une nouvelle direction est à
l'étude, proposée avant toute mise en œuvre.

**Au 22 novembre : huit chantiers, en service depuis 14 h 36 UTC.**
Le propriétaire a demandé une analyse complète de l'interface, avec carte
blanche, et un gestionnaire de moteurs. Un audit sous six angles a rendu 113
constats, dont 10 critiques ; la carte des moteurs compte 94 points
d'intégration et 27 lacunes, et son plan a été relu de façon adverse avant
d'être exécuté. Huit chantiers en sont sortis, chacun fini par une relecture
adverse. Ils portent 71 commits sur `chantier/integration`. Rien n'est dans
`main`, rien n'est installé, et la CI distante n'a rien vu : la branche n'est
pas poussée. Récit : [carnet](carnet-de-bord.md), entrée « 22 novembre : une
analyse de toute l'interface, et un gestionnaire de moteurs » et les huit qui
la suivent ; décisions : [ADR](adr/0001-architecture.md), D26 à D36, et les
amendements du 22 novembre à D13 et D22.

- **Moteurs.** Le socle commun des salles externes (`moteurs/socle/`), une
  fiche par moteur et un canari Xbox 360 que rien ne lance encore
  (`docker/xbox360-room-socle.py`). Les trois salles lancent toujours leurs
  anciens scripts. Le test doré (`just salles-dore`) fige les commandes Docker
  de 50 scénarios, sous deux comptes et sur une copie, et entre dans `check`
  avec `moteurs-test`. `deploy-check` nomme un adaptateur remplacé par un ajout
  d'unité et charge son moteur avec l'interpréteur de l'unité (D27).
- **Salon.** La forme du titre de chaque console est écrite une fois par
  langage et tenue par des exemples communs : le catalogue garde le titre de
  Sonic, le carnet de jeu montre les sauvegardes Xbox 360, un second disque du
  même jeu est refusé. La boîte noire suit Xwayland. L'accueil ne se fait plus
  relire par les lecteurs d'écran toutes les cinq secondes.
- **Interface.** Une seule régie de couleurs et de polices pour la salle et le
  salon, en deux thèmes qui suivent le système (D26). La manette tactile placée
  par le calcul, une face par console (D28). Un seul état de liaison, qui dit
  l'image figée sur l'image (D29). Le clavier du jeu dans la zone de jeu, et des
  menus modaux dont le curseur est le focus (D30). Un lexique tenu par un essai,
  un lancement en un geste, une seule sortie et l'entrée dans l'adresse (D31 à
  D34). Sur un téléphone, la colonne en tiroir et un seul « ••• » qui ouvre une
  feuille du bas (D35).
- **Portes.** `just` lance maintenant aussi cinq preuves dans un vrai
  navigateur : `focus-navigateur`, `etats-navigateur`, `parcours-navigateur`,
  `salle-telephone` et `manette-garde`. Elles demandent Chrome et ffmpeg, et ne
  touchent aucune salle.

Preuves, sur cette machine le 22 novembre 2026 : `just check` sort 0 dans le
worktree d'intégration, et la marque de la page est vérifiée aussi sur une
copie propre du commit. Les cinq preuves du navigateur passent sur le dernier
commit. Les trois contrôles négatifs (`*-rouge`) ont échoué sur les défauts
nommés quand leur chantier les a lancés, et `salle-telephone` donne 24 cas
rouges sur l'arbre d'avant sa relecture. Aucun chantier ne rapporte `just`
complet sur la branche finale : `gpu-test` n'y a pas été rapporté, et
`deploy-check` complet demande sudo. Rien n'a été vu sur un vrai téléphone,
dans Safari ni avec un lecteur d'écran. En intégrant
la documentation, la boucle de contraste de `manette-garde` a été trouvée sur
les sept anciens noms de thème ; la vérification finale l'a corrigée (voir
plus bas).

**Après la vérification finale du 22 novembre.** Une dernière relecture de
0b0e7d7 a trouvé neuf défauts majeurs et une trentaine de mineurs ; les
corrections sont sur la même branche, chacune vue rouge d'abord. La plus
grave venait de main : l'hôte suivait les liens symboliques qu'un moteur
compromis pouvait laisser dans son emplacement, et écrivait ou copiait un
fichier de l'hôte à leur place. Il ne suit plus aucun lien (D36), et le worker
non plus pour `seats.tmp`. Une entrée directe venue d'un autre site repasse
par l'avant-salle (D33). Récit et ce qui n'est pas prouvé : entrée « 22
novembre : la vérification finale, et l'hôte qui suivait les liens du
conteneur ». Restent ouverts, décrits et non corrigés : la sonde de la page
interroge `/api/salles` toutes les 3 s pendant un gel, et cet appel peut
dépasser sa patience de 2,5 s ; une salle qui redémarre en boucle est dite
« redémarre » sans fin ; `deploy/salon-importable.sh` n'importe que
`nel3ab_control.app` (défaut de main) ; la page pèse 27 % de plus que sur
main en brotli, dont 27 139 octets de polices.

**Ce qui attend le propriétaire, dans cet ordre.** Les trois premiers pas sont
faits le 22 novembre : fusion à 14 h 31 UTC, salon et boîte noire redémarrés à
14 h 35, worker reconstruit à 14 h 36 sans salle ouverte.

1. Fusionner `chantier/integration` dans `main` par `git merge --ff-only`,
   quand aucune salle ne joue : le worker lit les scripts des salles dans
   l'arbre de production à chaque démarrage de salle.
2. Redémarrer le salon et la boîte noire par
   `sudo bash deploy/mettre-en-service.sh` (son étape 4). Les unités n'ont pas
   changé ; le script vérifie que le salon s'importe avant de le relancer,
   puis lance `just deploy-check`. Le salon AVANT le worker : la nouvelle page
   lance le jeu du chef en un geste, ce qu'un salon d'avant refuse. Dans
   l'ordre inverse, aucun jeu préparé ne partait pendant la fenêtre où la page
   était neuve et le salon ancien. La page sait maintenant confirmer puis
   relancer face à ce refus, mais l'ordre reste celui-ci. L'inverse, une
   ancienne page devant le nouveau salon, fonctionne.
3. Reconstruire le worker de production (`cargo build --release` dans
   `core/`, qui produit `core/target/release/nel3ab-worker`), quand aucune
   salle n'est ouverte. La page, sa politique de sécurité, la redirection
   d'une entrée venue d'un autre site et l'écriture sans lien de `seats` sont
   dans son binaire : chaque salle les prend à son prochain démarrage, donc à
   son prochain changement de jeu. Tant qu'il n'est pas reconstruit, les
   salles servent la page d'avant, et l'ancienne politique refuserait les
   polices de la nouvelle.
4. Valider en vraie partie : la salle écrite en Anybody, un lancement en un
   geste, Entrée sur un bouton de la colonne, un téléphone (tiroir, « ••• »,
   plein écran), le carnet de jeu d'un joueur Xbox 360, et `just boite-noire`
   sur une partie Xbox 360.
5. Brancher le canari Xbox 360 sur une salle choisie et y jouer une partie,
   selon [La Xbox 360 dans la salle](xbox360.md), « Le canari du socle ». Puis
   l'étape E2c, où l'enveloppe du socle remplace l'ancien script Xbox 360.
6. La suite du plan des moteurs : la Switch 2 (E3) attend l'accord du
   propriétaire, puis la Switch (E4a, E4b), la configuration partagée (E5,
   E6) et la forme du titre déclarée une fois (E8), avec la question de la
   casse.

**Au 21 novembre à midi : une adresse, des clés de dépôt, le laboratoire Switch 2 rangé.**
Tout est dans `main`. Quatre changements s'ajoutent à ceux de la nuit :

- `nel3ab.app` est la seule adresse. Les anciennes portes `.ts.net:8443` et
  `:8444` renvoient vers elle, chemin compris ; leur origine n'est plus admise
  à écrire au salon. Récit : entrée « 21 novembre : une seule adresse ».
- L'administrateur donne ou reprend, depuis la page `/importer`, le droit de
  déposer des jeux, parmi les comptes du tailnet et les personnes déjà venues.
  Mode d'emploi : [Déposer un jeu](importer.md). Récit : entrée « 21 novembre :
  donner la clé du quai depuis la page ».
- Les manettes du configurateur sont redessinées d'après des photos vues de
  dessus : GameCube, Wiimote et Nunchuk (de profil), guitare, DualSense, Xbox,
  manette Pro (salle Switch et manette Nintendo tenue en main), et une manette
  générique. Vérifiées sur l'aperçu et sur le configurateur servi par Vite ;
  le worker de production est reconstruit avec elles depuis 15 h 44 UTC, la
  prochaine salle ouverte les montre.
  Récit : entrée « 21 novembre : des manettes qui ressemblent aux vraies ».
- Le laboratoire Switch 2 (273 Go) est archivé puis supprimé ; tout ce qui a
  été fait pour la Switch 2 est raconté dans une partie à part du carnet,
  [La Switch 2, de bout en bout](carnet-switch2.md). Le NUP de Mario Tennis
  Fever est gardé hors des salles, dans `~/roms/hors-salle/switch2/`.

**Le salon et la boîte noire tournent le nouveau code depuis 12 h 26 UTC.**
Leur redémarrage a d'abord échoué cinquante secondes : l'environnement Python
que lance réellement le salon, posé par le projet Souverain, n'avait pas la
dépendance du matin (entrée « 21 novembre : le salon tombé cinquante
secondes, faute d'une dépendance »). Caddy et les anciennes portes ont été mis en
service à 12 h 48 UTC, mais les deux portes rendaient une page vide (entrée
« 21 novembre : une seule adresse », paragraphe « Le piège »). La correction
du Caddyfile est installée depuis 14 h 20 UTC : les deux vraies portes
`.ts.net` renvoient vers `nel3ab.app`, et `just deploy-check`, qui les essaie
par leur nom, passe. La mise en service se refait avec
`sudo bash deploy/mettre-en-service.sh`. Le script valide le Caddyfile avant
de copier quoi que ce soit, installe les unités, vérifie que le salon
s'importe avec l'interpréteur que systemd lancera, redémarre les trois
services, règle les anciennes portes, essaie les pages, puis lance
`just deploy-check`.
Le worker de production, lui, est déjà reconstruit depuis la nuit.

**Xbox 360 : jouable, un essai réussi sous X11 (expérimentale jusqu'au 22 novembre).** Depuis le
21 novembre au soir, une salle lance Xenia Edge sous le Sway de la salle
Switch, avec quatre profils écrits d'avance, les manettes virtuelles, le son et
des mesures (journal horodaté, captures toutes les 30 s, cadence relue par
`just xbox360-releve`). Sonic the Hedgehog est rangé dans `~/roms/xbox360`.
Mode d'emploi : [La Xbox 360 dans la salle](xbox360.md). Récit : entrée
« 21 novembre : la Xbox 360 devient jouable ». La mise en service
(`sudo bash deploy/mettre-en-service.sh`) installe la nouvelle unité des
salles et relance le salon ; elle a tourné à 20 h 36 UTC. Premier essai à
20 h 37 : profil, manette et son bons, mais image figée au bout de 40 secondes
alors que le jeu continuait, et barre de menus visible. Correction le soir
même : Xenia passe par X11 (Xwayland) et se met lui-même en plein écran.
Second essai à 21 h 00 : 12 minutes 30 sans gel, plein écran sans menus,
59 images par seconde côté jeu, sauvegarde écrite. Récit dans l'entrée
« 21 novembre au soir : l'image de Sonic se fige, le jeu continue ».
Depuis le 22 novembre, en service à 14 h 36 UTC : le
salon connaît la Xbox 360 (titre de 8 chiffres gardé au catalogue,
sauvegardes au carnet de jeu, second disque refusé), la boîte noire suit
Xwayland et lit l'affichage que la salle écrit, la manette tactile écrit LB,
LT, Back et Start avec A en bas, et un canari de la salle sur le socle des
moteurs attend d'être branché sur une salle choisie (ADR D27). Entrées
« 22 novembre : le salon apprend la Xbox 360 » et « 22 novembre : le socle
des moteurs, posé sans changer une seule salle ».

Les paragraphes ci-dessous disent « non installé » : ils datent d'avant la
fusion de la nuit.

**Au 21 novembre, sur une branche non installée : un carnet de jeu par personne.**
Le salon tient un journal des parties : un fichier par personne, jamais
balayé, qui note le début et la fin de chaque place tenue et chaque
lancement, avec qui a lancé et dans quelle sauvegarde. La page `/profil`,
servie par le salon et liée depuis l'accueil pour qui est identifié, montre
les jeux joués en étagère, le temps total, les sauvegardes à soi en cartes
mémoire, et les jeux joués chez quelqu'un d'autre sans sauvegarde à soi.
Quatre lectures privées l'alimentent (`/api/me/…`), 401 sans identité. La
scène de première arrivée de Bobine suit maintenant le journal, la même pour
toutes les pages. Rien n'a tourné dans une vraie salle, et les sauvegardes
Switch ne sont pas encore reliées à leur jeu. Récit : [carnet](carnet-de-bord.md),
entrée « 21 novembre : un carnet de jeu par personne » ; décision :
[ADR](adr/0001-architecture.md), D25.

**Au 21 novembre, sur une branche non installée : déposer un jeu depuis une page.**
La page `/importer` du salon reçoit des fichiers par morceaux reprenables,
reconnaît la console dans leurs octets, sans Docker, et range GameCube et Wii
sans jamais écraser un fichier. Un jeu Switch (NSP, XCI) est rangé avec sa fiche
quand le salon a la clé d'en-tête de la console (`NEL3AB_SWITCH_KEYS`) : son
identifiant de titre est lu dans l'en-tête NCA déchiffré, et les six jeux
Switch de la bibliothèque donnent les titres de leurs fiches. Les mises à jour
et contenus additionnels Switch, la Xbox 360 et les consoles rétro restent en
quarantaine avec la raison. Réservé à l'administrateur et aux adresses de
`NEL3AB_IMPORTEURS`. Rien n'est installé, et aucun envoi n'a traversé le vrai
réseau. Mode d'emploi : [Déposer un jeu](importer.md). Récit :
[carnet](carnet-de-bord.md), entrées « 21 novembre : déposer un jeu et le
laisser se ranger » et « 21 novembre : la Switch se range aussi ».

**Au 21 novembre, sur une branche non installée : un manifeste des consoles et une clé par jeu.**
`consoles/consoles.json` décrit chaque console et chaque moteur ; le salon,
la boîte noire et la page le lisent, et un essai compare le worker au
fichier (ADR D22). La Xbox 360 y est décrite, pas jouable. Chaque jeu du
catalogue porte une clé, son nom de fichier, et la page lance par elle, par
la préparation du salon comme par la socket de manette (D23). Le worker
écrit `catalogue.json` dans son répertoire de session à chaque démarrage, et
le salon le sert à `/api/catalogue` sans salle ouverte (D24). En mesurant la
ligne de contrôle, une coupe silencieuse du nom de qui lance a été trouvée et
corrigée. Rien n'a tourné dans une vraie salle. Récit : [carnet](carnet-de-bord.md),
entrée « 21 novembre : un seul fichier pour décrire les consoles ».

**Au 21 novembre : les sauvegardes ont une copie chiffrée hors de la machine.**
Chaque heure, `nel3ab-abri.timer` copie les sauvegardes, les pseudos et la
configuration vers le NAS avec restic. Une restauration réelle depuis le NAS
est identique à l'original. Le travail du 16 septembre au 20 novembre est
dans Git, en dix commits poussés. La Switch 2 reste dans la salle comme
console expérimentale. Mode d'emploi : [Copie des sauvegardes](abri.md).
Récit : [carnet](carnet-de-bord.md), entrée « 21 novembre ».

**Au 21 novembre : les portes du salon sont fermées dans le code, pas encore en service.**
Les quatre constats de l'audit sur le salon sont corrigés et commités, chacun
avec un essai rouge d'abord. Une écriture exige l'origine d'une page du salon.
Ouvrir une salle demande une identité, la fermer demande d'en être le chef ou
l'administrateur. Chaque salle décrit ses propres présents et garde son
propre chef. L'état public montre un repère opaque à la place de l'adresse de
chacun. Rien n'est installé : le salon en service n'a pas été redémarré. Reste
ouvert : un programme de la machine peut encore se présenter comme n'importe
qui, y compris l'administrateur. Récit : [carnet](carnet-de-bord.md), entrée
« 21 novembre : fermer les portes du salon » ; décisions :
[ADR](adr/0001-architecture.md), « Lobby doors, 2026-11-21 ».

**Au 20 novembre : le moteur Switch 2 est mis de côté, un audit fixe l'ordre des chantiers.**
À la demande de Souhib, le travail de performance sur le moteur Switch 2
s'arrête là où la reprise du 19 novembre le laisse. Rien n'est installé :
la salle garde Lichii `65defb74` plafonné à 30. Les demandes suivantes sont
une fabrique d'émulateurs, un import de jeux par glisser-déposer, une page
profil et une interface plus personnelle. Un audit en lecture seule, cinq
volets relus chacun par un vérificateur, les juge faisables. Il trouve
d'abord deux risques de perte : aucune copie des sauvegardes des joueurs
hors de la machine, et deux mois de travail installé hors de Git. Il relève
aussi des routes du salon qui écrivent sans vérifier l'identité ni
l'origine. Les trois nouveautés reposent sur un même socle, car un jeu n'a
pas d'identité stable : une position sur un octet dans une liste lue au
démarrage, et des sauvegardes rangées par nom de fichier. Ordre proposé, en
attente des décisions de Souhib : mettre à l'abri, fermer les portes, poser
le socle, puis l'import, le profil, l'interface et les consoles rétro.
Récit : [carnet](carnet-de-bord.md), entrée « 20 novembre ». Résultats
bruts et captures : `~/.local/share/nel3ab/audit-2026-11-20/`.

**Zelda au 19 novembre : l'amont gèle, une marge de rétention le corrige en laboratoire.**
Lire d'abord la
[reprise du 19 novembre](plan-60fps-switch2-2026-11-08.md#reprise-au-19-novembre-lamont-gele-une-marge-de-retention-le-corrige-en-laboratoire).
Rien n'est installé de nouveau : la salle garde Lichii `65defb74` plafonné
à 30. Les gels d'une demi-seconde relevés le 18 sont propres à l'amont : il
gèle 41 trajets sur 152 dans la nuit, le moteur installé aucun sur 12. Le
gel a une signature unique. Le moteur recrée une série d'images de texture,
une allocation de mémoire vidéo dure 17 à 23 ms au lieu de moins de 5,
environ 200 Mio partent dans la mémoire du PC, et le moteur attend la carte
une demi-seconde. L'amont remplit la carte à 30 Mio près à cause de sa
règle de rétention des images. Une retouche de laboratoire qui laisse
1 024 Mio sous cette limite donne 0 gel sur 72 trajets, contre 9 sur 64
pour le témoin du même binaire en alternance. Compté par lancement, l'écart
laisse 4 chances sur 100 au hasard : aucun contre-exemple, pas une preuve
au sens strict. La fréquence du gel change selon la période (5 à 44 % des
trajets) pour une cause non trouvée. Tout est mesuré moteur seul, sur un
trajet de Kokiri. La suite est un essai en salle complète de l'amont avec
la marge, sur décision de Souhib. L'objectif de 40 n'est pas atteint. Le
paragraphe suivant est l'état du 18, conservé.

**Zelda au 18 novembre : candidat moteur écarté, amont à rattraper.**
Lire aussi la
[reprise du 18 novembre](plan-60fps-switch2-2026-11-08.md#reprise-au-18-novembre-candidat-ecarte-amont-a-rattraper).
Rien n'est installé de nouveau. La retouche du moteur sur les protections de
mémoire ne gagne rien et a un défaut de justesse : elle est écartée. L'état
coûteux du moteur est mieux décrit, sa cause exacte reste à désigner. La
veille du 18 montre que Lichii a publié quatre versions et fusionné 447
demandes depuis le 11 novembre, dont plusieurs visent notre limite. L'essai M
du 18 au soir en donne la première mesure ici : le build 341, compilé avec
la recette du moteur installé, donne 34,5 images par seconde sans plafond
contre 31,3 pour le moteur installé, dans une vue fixe, moteur seul. Ce
n'est pas 40 : il manque 8 à 14 % de coût sur le fil GPUBack. Sous le
plafond de 30 de la salle, les deux moteurs rendent 30,00 images par
seconde dans cette vue ; l'amont y consomme 17 % de processeur en moins.
Sa tenue n'est connue que par un lancement par scénario : rien d'anormal à
chaud en dix minutes, moins d'accrocs à froid, mais trois gels isolés
d'une demi-seconde non expliqués. Le changement de zone n'est pas mesuré
et sa justesse n'est pas encore qualifiée ; rien n'est installé. Un avis
attend la réponse de Souhib : ne pas écrire d'émulateur, rattraper l'amont,
et faire plus tard une fabrique de consoles côté salle. Le paragraphe
suivant est l'état du 14, conservé.

**Zelda au 14 novembre : audit indépendant, nouvel instrument, deux séries d'essais relues.**
Lire d'abord la
[reprise du 14 novembre](plan-60fps-switch2-2026-11-08.md#reprise-au-14-novembre-deux-series-relues).
Rien n'est installé de nouveau : la salle propose toujours Lichii `65defb74`
plafonné à 30. Tout est mesuré moteur seul, jamais dans une salle complète.
La série 1 établit trois faits. Un transcodage Jellyfin qui incruste des
sous-titres PGS fait tomber le jeu de 30 à 13 images par seconde. Les gels de
0,3 à 0,56 seconde viennent de la première compilation d'un pipeline. Le
moteur est tenu par le fil GPUBack, et aucun réglage de la machine n'atteint
40 : il faut 19 à 23 % de coût en moins par image sur ce fil. La série 2
ajoute ceci. Le préchargement retire l'accroc du retour de pause, mais son
risque sur la mémoire n'est pas éprouvé. Donner au jeu une priorité haute sur
la carte le fait tomber : aucun remède côté moteur ne protège le jeu d'un
transcodage Jellyfin. Le profileur roulant de la boîte noire coûte 2,5 à 3 %
à GPUBack, et son seuil de chute donne de fausses alertes pour un jeu à 30.
Le moteur a un second état, 4 % plus coûteux, fait de changements de
protection de la mémoire. Lichii build 160 n'a pas pu être lancé. Le 14 au
soir, Souhib a tranché : la boîte noire est corrigée et installée (seuil lié
au plafond du jeu, plus de profileur roulant sur le moteur Switch 2) ; une
retouche du moteur sur ces protections est en cours dans un candidat privé ;
Jellyfin n'est pas touché. Les rapports et les verdicts des relecteurs sont
sous
`~/.local/share/nel3ab/nx2-lab/2026-11-12-probe/experiments/`.

**Reprise précédente, du 11 novembre, conservée comme historique : la
[consigne de reprise vers 40 images/s](plan-60fps-switch2-2026-11-08.md#reprise-au-11-novembre-apres-la-pause-et-la-restauration-des-sauvegardes).**
Elle donnait le prochain essai 1329, les versions installées et privées, les
pistes suivantes, les résultats à ne pas refaire et les chemins des preuves.
Les essais étaient alors en pause. Les sources figées du banc précédent sont intactes,
mais son inventaire de données protégées doit être revu après la vraie partie
et la restauration ; ne pas remettre la production à l'ancien état pour le faire passer.

**Sauvegardes Zelda remises le 11 novembre après l'essai de Souhib.**
Le lancement de 14 h 21 avait reçu « partie neuve ». Le worker avait conservé
les anciens fichiers dans l'historique avant de créer un dossier personnel
vide. Les quatorze fichiers archivés correspondent exactement à l'inventaire
protégé avant cet essai. Avec l'accord de Souhib, la partie est arrêtée
normalement et les fichiers, profil compris, sont remis dans son emplacement
actif. La partie d'essai est retirée de cet emplacement ; les autres comptes
restent identiques. La salle est laissée fermée et son choix retenu vaut
« reprendre ».

Le navigateur reproduit aussi un chemin qui masque cette option : une première
réponse sans identité reste mémorisée et l'ouverture du menu ne la relit pas.
Le menu redemande maintenant le compte quand il manque et attend sa réponse
avant de proposer un lancement. Cela ne démontre pas la cause de l'affichage
vu dans l'onglet de Souhib. Le test navigateur échoue avant la correction,
repasse après, échoue quand son appel est retiré puis repasse après remise
en place. `just` passe en 52,69 secondes, ainsi que les huit conditions des
menus, les 628 tests de la page et l'audit. Le binaire installé sert bien la
nouvelle page lors d'une ouverture sans jeu ; la salle est refermée et les
quatorze fichiers restaurés restent identiques. Ce contrôle ne lance pas
Zelda et ne démontre aucun gain de fluidité. Rapport :
`spikes/switch2-room/save-recovery-2026-11-11.json`.

**Essai 1095 du 11 novembre terminé : aucun gain répétable.**
Le nouvel essai 1095 au diagnostic séparé est
terminé, sans gain répétable. Il donne −1,51 % puis +1,19 % dans ses deux
paires. La base privée suivante garde `13158042`, sans 807 ni 1095, pour
qualifier le 1329. Les 40 images/s constantes restent non atteintes et aucun
plafond matériel n'est démontré. Rapport :
`spikes/switch2-room/statewrite1095-coldlog-comparison-2026-11-11.json`.

Le port 1329 est maintenant préparé sur cette base mémoire, avec trois fichiers
modifiés et les 5 221 fichiers d'origine préservés. Ses 90 contrôles de corps
réels extraits passent, dont dix-huit mutants réintroduits. Le binaire
`17ebf0c6` compile avec les mêmes commandes, profil et métadonnées que la
référence. Son garde natif tient compte des commandes et des effacements
différés ; les envois explicites restent inconditionnels et le message de
preuve est séparé. Les 37 cas natifs ciblés et les 1 254 cas de la suite complète
passent, avec les quatre mêmes cas réseau ignorés. Le nouveau banc passe ses
22 commandes et les trois vérifications de lanceur ; ses 280 entrées sont
figées avant le premier salon privé. Ce salon termine maintenant 90 secondes
normales. Le marqueur confirme un premier envoi inutile réellement évité ;
les images relues gardent le même emplacement devant Saria. L'arrêt est normal,
les douze identités de processus privées ont disparu et les 8 652 fichiers
protégés restent intacts. La comparaison alternée est figée sur 281 entrées.
Son premier témoin est interrompu après 10,06 secondes : un processus
`ffmpeg` extérieur ouvre la même carte graphique. Ce passage reste exclu,
avec ses 24 fichiers de sortie archivés ; les quatre passages complets restent
à faire depuis une graine propre. Le garde reste actif. Ce contrôle fonctionnel
ne mesure ni la fréquence des envois évités ni un gain FPS. Rapport :
`spikes/switch2-room/emptyflush1329-preparation-2026-11-11.json`.

**Essai 807 du 11 novembre terminé : aucun gain répétable.**
Les deux alignements amont sont vérifiés dans le moteur réel, puis comparés
au candidat mémoire `13158042`. Les quatre passages de 90 secondes terminent
avec leurs contrôles globaux propres, sans exception de fin de navigateur.

| Passage | Moteur | Retours de présentation par seconde |
|---|---|---:|
| A1 | candidat mémoire, témoin de cet essai | 30,191 |
| B1 | mêmes sources avec les alignements 807 | 31,096 |
| A2 | candidat mémoire | 31,220 |
| B2 | alignements 807 | 30,599 |

Le changement est de +3,00 % puis de −1,99 %. Les quinze fenêtres complètes
couvrent 292,69 secondes des 360,01 commandées. Les images lues avant, pendant
et après gardent le même checkpoint devant Saria. Les quantiles et les plus
longs intervalles ne s'améliorent pas uniformément. Le port 807 est écarté de
la prochaine base ; cette expérience ne démontre ni l'absence de faux partage
ailleurs ni un plafond matériel. Les services permanents restent présents,
et 9 minutes et 10 secondes séparent B1 d'A2.

Les 189 entrées figées, leurs permissions, les 8 652 fichiers protégés, le cache
installé et la graine privée sont préservés. Le moteur installé reste inchangé.
La suite qualifie le coût d'activation de la sonde d'horodatage des commandes
GPU sur le seul candidat mémoire `13158042`, en alternant sonde dormante et
armée. Ses intervalles ne seront pas présentés comme une occupation exclusive
de la carte. Les dix-sept contrôles CPU et les trois contrôles de lanceur dans
l'image réelle passent ; les quatre nouveaux passages sont maintenant terminés.
Les 40 constantes restent non atteintes. Rapports :
`spikes/switch2-room/cachepad807-functional-2026-11-11.json` et
`spikes/switch2-room/cachepad807-comparison-2026-11-11.json`.
Préparation : `spikes/switch2-room/submission-cost-preparation-2026-11-11.json`.

**Sonde GPU : 93 captures complètes, pas de ralentissement moyen observé.**
Le même exécutable donne 30,561 puis 30,954 retours de présentation par seconde
dans la première paire dormante/armée, et 30,263 puis 30,365 dans la seconde.
Les changements observés sont +1,29 % puis +0,34 %, sans gain du moteur ou preuve
de transparence générale. Quatorze fenêtres complètes couvrent 275,27 secondes
des 360,01 commandées. Les longs intervalles ne s'améliorent pas uniformément.

Les témoins ne produisent aucune capture. Les passages armés en produisent 47
et 46 entièrement dans leur phase, résultats GPU disponibles compris. Deux
captures hors fenêtre restent conservées et exclues. L'union des intervalles
mesurés a pour médiane 25,25 puis 25,31 ms, proche du budget de 25 ms nécessaire
à 40 FPS. Ces horodatages incluent des attentes ; ils ne donnent ni l'occupation
exclusive de la carte ni un plafond matériel. Ils ne justifient pas non plus
de désigner le CPU comme seule limite.

Les quatre contrôles globaux restent propres. Les réglages effectifs et
l'environnement natif sont identiques, les images gardent le checkpoint,
les 243 entrées figées et les fichiers installés sont préservés. La prochaine
modification est le port isolé du 1095 décrit ci-dessous. Rapport :
`spikes/switch2-room/submission-cost-comparison-2026-11-11.json`.

**Revue amont du 11 novembre à 10 h 21 UTC.**
Lichii avance de sept commits vers `babdb6bb`. Le
[1095 intégré](https://github.com/zortos293/Lichii/pull/1095) traite directement
les écritures de registres ordinaires et permet au compilateur de réunir les
petites fonctions appelées. Ce code est absent de notre candidat et vise un
appel observé dans le profil du fil arrière. C'est le prochain port à qualifier
après le coût de la sonde GPU, sans gain local encore mesuré.

**Correction de reprise : ce même head 1095 avait déjà été testé le 9 novembre**,
sans gain répétable (+1,97 % puis −0,06 %). Sa fusion du 11 novembre n'est pas
un nouvel algorithme. Ce résultat reste conservé dans
`spikes/switch2-room/state-write-2026-11-09.json`. Le nouvel essai porte uniquement
sur la base mémoire actuelle et l'isolation du diagnostic : l'ancien candidat
présente aussi une fonction de 1 599 octets et les mêmes appels supplémentaires.
Cela ne prouve pas la cause de son résultat FPS ni un futur gain.

Le port privé du 1095 est maintenant préparé sur une copie indépendante du
candidat mémoire. Quatre fichiers changent ; les 5 221 fichiers de base et les
vérificateurs locaux sont préservés. Les 46 exécutions des vrais corps extraits,
avec leurs dépendances simulées, passent dans l'image Clang native, ainsi que
le véritable en-tête du réglage de vérification. Elles ne remplacent pas les
tests sur les vraies classes. La compilation complète passe maintenant pour
`37a7fbc0`, ainsi que 40 exécutions ciblées et les 1 254 cas de la suite native,
avec les quatre cas réseau ignorés. Le premier build avait échoué à l'édition
des liens faute d'un cache ThinLTO accessible en écriture ; il est conservé et
la correction passe quatre liens réels distincts avant la nouvelle copie.

L'examen du code produit trouve ensuite une perturbation du diagnostic. Retirer
seulement le bloc du premier message réduit `CallMethod` de 1 551 à 270 octets
et rétablit son saut final vers le traitement des registres. Ce contrôle garde
les mêmes en-têtes, disposition mémoire, profil et commandes de compilation.
Il ne mesure aucun gain FPS. Une variante indépendante prépare la journalisation
dans une fonction séparée, avec la macro portable existante qui empêche son
intégration par le compilateur. Le marqueur réel, les images et la comparaison
alternée restent à vérifier sur le candidat finalement retenu. La variante
`32d0a6fd` confirme maintenant le message séparé dans son code natif : la
fonction principale mesure 349 octets et le diagnostic 115. Les 46 exécutions
de corps extraits passent de nouveau, puis les 40 exécutions ciblées et les
1 254 cas natifs complets, avec les quatre mêmes cas réseau ignorés.
Ces tailles ne prouvent aucun gain FPS. Le premier essai privé atteint le
checkpoint et émet réellement le marqueur, mais son lecteur refuse la fin
de couleur du journal avant toute phase chronométrée. L'arrêt est normal,
les fichiers protégés et les 276 entrées figées restent identiques. Cet essai
reste en échec ; une nouvelle copie du banc corrigera seulement le lecteur.
Cette copie passe ensuite les 31 contrôles du lecteur, les vingt commandes
du banc et les trois vérifications du lanceur. Son nouveau salon termine
90 secondes normales : marqueur réel, quatre images distinctes lues, deux
paires joueur/spectateur identiques, arrêt normal, fichiers protégés et
279 entrées figées préservés. La comparaison est ensuite figée sur 280 entrées.
Les quatre passages terminent leurs 90 secondes avec images lues et arrêts
propres. Ils donnent 30,938, 30,472, 30,512 et 30,874 retours de présentation
par seconde, soit −1,51 % puis +1,19 %. Les quinze fenêtres complètes couvrent
293,06 des 360,01 secondes commandées. Les réglages effectifs et l'environnement
natif sont identiques entre les quatre passages ; les fichiers protégés et les
graines restent intacts. Le port 1095 au message séparé est écarté de la prochaine
base. Ce résultat conserve aussi celui du 9 novembre et ne compare pas le coût
FPS des deux formes de diagnostic.
Rapport :
`spikes/switch2-room/statewrite1095-preparation-2026-11-11.json` et
`spikes/switch2-room/statewrite1095-coldlog-comparison-2026-11-11.json`.

Le [1336 ouvert](https://github.com/zortos293/Lichii/pull/1336) évite certaines
relectures CPU de listes écrites par le GPU. Sa partie dessin demande les
mesh shaders désactivés dans notre configuration ; sa partie calcul et ses
gardes demandent une revue plus complète. Le
[1333](https://github.com/zortos293/Lichii/pull/1333) répare une extension de
tampon absente de notre base. Eglantine garde `78743f30` et Fritchii reste à
la publication 5.8.4 déjà examinée. La revue utilise l'API directe de GitHub,
les vingt demandes récemment mises à jour par dépôt et des diffs sélectionnés ;
elle n'est pas exhaustive. Aucun moteur n'est remplacé. Rapport :
`spikes/switch2-room/upstream-refresh-1021-2026-11-11.json`.

**Nouvelle revue amont à 12 h 23 UTC.** Lichii passe à `be241479`.
Après l'essai 1095, la prochaine piste bornée est le
[1329 intégré](https://github.com/zortos293/Lichii/pull/1329), qui évite un
second envoi de commandes devenu inutile. Le chemin concerné existe dans
notre base, sans dépendance aux mesh shaders ; son volume réel et son gain
local restent inconnus. Le 1331 est aussi intégré, mais son placement des
réservations CPU ne désigne pas le verrou observé dans GPUBack. Le 1336 a
changé et demande encore des preuves sur ses chemins d'échec et la durée
de vie des mots conservés. La réponse sauvegardée pour le 1161 est incomplète.
Eglantine avance vers `6be10b5c`, avec un diff net vide après réversions.
Fritchii reste en 5.8.4. Aucun de ces nouveaux changements n'est porté ni
installé. Rapport : `spikes/switch2-room/upstream-refresh-1223-2026-11-11.json`.

**Profil du 11 novembre qui a guidé cet essai.**
Le candidat mémoire `13158042` termine un relevé de 25,02 secondes, sans perte
signalée : 11 956 échantillons retenus sur 12 874 bruts. Les bibliothèques exactes
résolvent 99,51 % des cycles échantillonnés de GPUBack et 99,64 % de VulkanWorker.
Dans GPUBack, `BackLoop` pèse 11,37 %, les copies mémoire 7,80 % et le verrou
5,41 %. Ce sont des adresses de fonctions, pas des piles d'appels ni une durée
gagnable. Les instructions du verrou montrent une attente active, sans identifier
l'objet ou son détenteur. Quatre images distinctes sont lues ; l'arrêt est normal
et les 203 entrées figées sont préservées.

Le pilote attend désormais l'arrêt de la phase, puis la fin de l'observateur,
puis la fermeture du navigateur. Huit essais avec un vrai Chrome passent,
dont les défauts réintroduits. Le relevé réel confirme cet ordre et termine
avec un garde propre. Rapports :
`spikes/switch2-room/uploadhost-leaf-profile-2026-11-11.json` et
`spikes/switch2-room/chrome-lifecycle-2026-11-11.json`.

L'expérience décrite en tête reprend les deux alignements du
[correctif amont 807](https://github.com/SerkiGohan/Eglantine-mkw60/commit/175ff00ffc0a83ae79651ccfd4c54713283ca8c2).
Les six vrais layouts Clang confirment la séparation des champs avant/arrière,
pour 128 octets de plus par instance, soit 9 344 contre 9 472. Les lignes de
cache de cette machine font 64 octets ; 128 est l'alignement proposé en amont.
Le candidat `cfec5c81` compile en 345,58 secondes. Ses 16 tests natifs ciblés
et sa suite de 1 258 cas passent, dont quatre cas réseau ignorés. La vérification
en jeu et la comparaison alternée sont terminées ; aucun gain local répétable
de ce candidat n'est établi. Rapport :
`spikes/switch2-room/cachepad807-preparation-2026-11-11.json`.

**Comparaison mémoire du 11 novembre : avance observée, 40 constantes non atteintes.**
Le candidat `13158042` termine ses deux passages à environ 30,5 à 30,7 retours
de présentation par seconde, contre 29,0 à 29,3 pour le témoin `c686c1ff`.

| Passage | Moteur | Retours de présentation par seconde |
|---|---|---:|
| A1 | témoin | 29,011 |
| B1 | mémoire hôte cachée et cohérente | 30,654 |
| A2 | témoin | 29,314 |
| B2 | mémoire hôte cachée et cohérente | 30,474 |

L'avance observée est de 5,66 % puis 3,96 %. Les treize fenêtres complètes
couvrent 261,92 secondes des 360,01 commandées. Ce sont des retours Vulkan sur
un checkpoint fixe, avec réception brute sans décodage local ; ils ne prouvent
pas des images uniques ni 40 FPS dans le navigateur. Les quantiles restent
par fenêtre : le p99 baisse dans la première paire, pas uniformément dans la
seconde. La charge CPU des services permanents n'est pas exclue.

A2 garde son contrôle global échoué : l'inventaire lit le navigateur privé
disparu, dans un scan commençant 1,406 seconde après la mesure. Ses fichiers
bruts restent inchangés. Un audit distinct, avec 19 contrôles CPU, qualifie
seulement sa fenêtre et ses 14 observations GPU propres. Les 14 contrôles du
consommateur limitent cette exception à A2. B2 termine avec son garde propre.
L'intervalle de 21 minutes et 10 secondes entre la fin d'A2 et le début de B2,
nécessaire à cet examen et au nouveau départ, limite aussi l'attribution causale.

Les deux usages d'envoi sont activés normalement dans B1 et B2, sans le détail
diagnostique. Les 8 652 fichiers protégés, le cache installé, la graine privée et
les 184 entrées figées restent identiques. Le moteur installé ne change pas.
Le profil du coût restant et l'arrêt du navigateur qui attend l'observateur
sont maintenant vérifiés, comme décrit ci-dessus. Aucun plafond matériel
n'est démontré. Rapports :
`spikes/switch2-room/uploadhost-comparison-2026-11-11.json` et
`spikes/switch2-room/uploadhost-postphase-review-2026-11-11.json`.

**Essai mémoire du 11 novembre : candidat compilé, gain en jeu encore à vérifier.**
L'outil séparé passe maintenant ses contrôles CPU et GPU avec les bibliothèques
exactes du relevé. La politique actuelle choisit le type mémoire 3, local au GPU,
visible et cohérent pour le CPU, sans cache CPU. La politique proposée choisit
le type 5, hôte, caché et cohérent. Les validations lisent quatre blocs de 64 Kio
par le GPU avant et après la boucle de copie.

Un défaut du premier contrôle est reproduit : retirer son seul `memcpy`
chronométré laisse encore le résultat vert, car le préchauffage a déjà écrit les
octets attendus. La correction change les quatre blocs source après la première
validation. Les vraies copies passent pour les deux politiques ; leur suppression
échoue maintenant au contrôle GPU après la boucle. Les compteurs des variantes
sans copie sont faux par construction et exclus de toute mesure.

| Passage | Placement demandé | Débit observé avec vidage, Gio/s |
|---|---|---:|
| A1 | politique actuelle | 1,792 |
| B1 | hôte caché et cohérent | 6,562 |
| A2 | politique actuelle | 1,794 |
| B2 | hôte caché et cohérent | 6,447 |

Chaque passage déclare 65 536 copies de 64 Kio, soit 4 Gio. L'avantage observé
est de 3,66 puis 3,59 dans les deux paires. Ce sont des tendances instrumentées,
pas un débit isolé de toute charge : les 28 conteneurs permanents restent en
place et leur silence CPU n'est pas établi. Aucun client GPU étranger n'est
observé, les files CI sont contrôlées et les identités et bibliothèques sont
vérifiées. L'outil emploie une API d'allocateur bornée à 1.3, différence explicite
avec le moteur courant, et ne reproduit pas son état d'allocation.

Ces résultats justifient un candidat privé pour les envois CPU sous RADV ; ils
ne donnent aucun gain FPS. Le port est préparé pour les deux usages d'envoi,
avec repli explicite si aucun type compatible n'existe. Ses 18 exécutions CPU
passent dans l'image de compilation native, dont les défauts réintroduits.
La compilation complète termine en 179,05 secondes dans un répertoire indépendant,
avec reconstruction de l'allocateur. Le test natif ciblé passe ; la suite complète
recense 1 258 cas, dont quatre ignorés sans réseau, sans échec. Le candidat
`13158042` reste privé. Son contrôle fonctionnel de 90 secondes termine maintenant
normalement : les deux usages allouent réellement le type 5, visible, caché,
cohérent et mappé en continu. Les images avant, pendant et après gardent le même
checkpoint devant Saria pour les deux rôles. Les 183 entrées figées et les
fichiers installés restent identiques ; l'observateur est rétabli.
La comparaison alternée décrite en tête suit cette qualification. Rapports :
`spikes/switch2-room/uploadhost-functional-2026-11-11.json` et
`spikes/switch2-room/uploadhost-preparation-2026-11-11.json`.
Le moteur installé reste inchangé ; les 40 constantes
ne sont pas atteintes. Rapport :
`spikes/switch2-room/upload-memory-probe-2026-11-11.json`.

**Troisième profil du 11 novembre : les envois de tampons dominent les lectures qualifiées.**
Le relevé suivant termine ses 25,02 secondes et résout les 320 échantillons
des deux cadres de lecture ciblés. Les retours ancestraux et les emplacements
sources compilés concordent : 319 viennent de `MappedUploadMemory`, l'envoi
de tampons vers Vulkan, et un de la préparation d'un petit paramètre graphique.
Dans 295 de ces 319 observations, le segment demandé fait 64 Kio. Ces poids
représentent 14,58 % des cycles échantillonnés de GPUBack dans ce relevé,
sans comparaison directe aux profils précédents. Les tailles observées ne
comptent ni les appels complets ni un volume total copié.

Le lecteur vérifie les cadres natifs, les registres conservés et les objets
`source_location` dans les cartes en lecture seule du véritable exécutable.
Leurs quatre champs sont comparés aux valeurs rendues par un programme C++
compilé avec la même chaîne d'outils. Les 30 méthodes de test, 13 contrôles de
cadre et 164 contextes CPU connus passent. Un calcul d'index répété sur plus
de 26 000 zones mémoire ralentit d'abord l'analyse hors ligne ; sa variante
conserve exactement les mêmes 26 297 zones stables et passe les neuf contrôles
de contexte. Les données brutes et les entrées figées ne changent pas.

Le prochain essai porte sur la mémoire de destination des envois. Le code peut
les diriger vers un tampon circulaire dont l'allocation préfère la mémoire du
GPU. Il ne prouve pas le type effectivement choisi par le jeu. Le petit outil
séparé décrit ci-dessus compare maintenant cette politique avec une mémoire
hôte cachée et cohérente ; le port moteur est préparé et reste à vérifier en jeu.
L'arrêt natif est normal, les fichiers installés et les 249 entrées figées sont
préservés, l'observateur est rétabli et toutes les images distinctes sont lues.
Les 40 constantes restent non atteintes, sans plafond matériel démontré.
Rapport : `spikes/switch2-room/goal40-upload-callers-2026-11-11.json`.

**Second profil du 11 novembre : deux sites de copie localisés.**
Un nouveau relevé de 25,02 secondes conserve 11 776 des 12 588 échantillons,
sans perte signalée. Pour 370 des 371 échantillons pris dans la routine de copie
qualifiée, le sommet de pile donne une adresse de retour résolue. Sur GPUBack,
257 reviennent de deux appels à `memcpy` dans `ReadBlockUnsafe`, qui lit des
blocs de mémoire invitée. Ces deux sites pèsent 12,00 % des cycles
échantillonnés de ce fil dans ce relevé. Les véritables instructions d'appel
sont vérifiées dans l'exécutable conservé. Cela ne donne ni les fonctions qui
demandent ces lectures, ni leurs tailles, ni un nombre total de copies.

La méthode conserve huit octets de pile avec les registres de position et
d'adresse du même échantillon. Elle accepte seulement 351 positions d'instruction
dont le code conserve le sommet de pile, sous les conditions d'un appel valide
et d'un emplacement de retour intact. Les 145 échantillons du petit programme
CPU retrouvent leur retour connu. Ce n'est pas un déroulement complet de pile.
Le relevé contient aussi 298 960 notifications de carte mémoire ; leur union
exacte en 44 plages évite un dépouillement quadratique. Un second calcul par
comptage des extrémités confirme cette union, sans retirer d'adresse du garde.
Cette instrumentation supplémentaire empêche de comparer directement ses poids
à ceux du premier profil.

Les captures avant, pendant et après gardent le même checkpoint devant Saria.
L'arrêt est normal, le profiler a disparu, l'observateur est rétabli et les
223 entrées figées restent identiques. Le moteur et les sauvegardes installés
sont préservés. Le troisième relevé décrit ci-dessus retrouve maintenant leurs
demandeurs. Aucun gain FPS ni plafond matériel n'est
déduit de ce diagnostic ; les 40 constantes restent non atteintes. Rapport :
`spikes/switch2-room/goal40-copy-returns-2026-11-11.json`.

Fritchii 5.8.4 est par ailleurs publiée à 02:20 UTC. Les neuf fichiers du
changement net depuis 5.8.3 portent sur l'interface et les réglages ; le changement
mémoire EXP47 ajouté entre-temps est annulé avant cette publication. Aucun
correctif de performances supplémentaire n'en est repris ici.

**Premier profil du 11 novembre : coût observé sans appelants.**
Un relevé de 25,02 secondes sur le candidat précédent, sans `GPU_PROFILE` ni
vérificateur de copies, retient 11 924 des 12 649 échantillons bruts. Les deux
lectures du fichier concordent et aucun échantillon perdu n'est signalé.
Les cartes mémoire et 205 fichiers exécutables sont conservés avant l'arrêt.
Les noms sont résolus avec les bibliothèques exactes et leurs identifiants de
compilation, en contrôlant les bornes des fonctions. Cette méthode résout
99,67 % des cycles échantillonnés de GPUBack, 93,86 % de GPU et 99,65 % de
VulkanWorker. Le code invité traduit à la volée reste largement sans nom.

Dans le fil arrière, 17,96 % des cycles retenus se trouvent dans les routines
de copie mémoire. Ce relevé sans pile d'appels ne donne pas leur origine.
Le second profil décrit ci-dessus localise maintenant deux sites dominants,
sans encore identifier leurs demandeurs. Les captures gardent le même checkpoint ;
l'arrêt est normal et les fichiers installés sont préservés. Ce diagnostic
ne mesure aucun gain FPS et ne démontre aucune limite matérielle. Rapport :
`spikes/switch2-room/goal40-current-profile-2026-11-11.json`.

**Port 1216 préparé, compilation native différée.**
La proposition 1216 est maintenant portée sur une copie vérifiée des 5 218
fichiers sources du candidat précédent. Ses quatorze exécutions CPU donnent les
résultats attendus, dont les défauts réintroduits. Les tests natifs ajoutés
restent non compilés et les contre-épreuves natives restent à préparer.
La proposition 974 incluse dans ce port rapporte elle-même davantage de dessins
réutilisés sans gain FPS mesurable sur ses trois vues de Zelda. Un profil du
coût actuel, sans désactiver le traitement rapide des commandes, devient donc
prioritaire avant compilation et comparaison ; son premier résultat est décrit
ci-dessus. Le patch préparé est conservé dans
`spikes/switch2-room/amont/fastdraw974-1216-2026-11-11.patch`.
Rapport : `spikes/switch2-room/fastdraw1216-preparation-2026-11-11.json`.

**Comparaison du 11 novembre terminée : faible avance observée, 40 constantes non atteintes.**
Le candidat composé 1058 et 1244 termine quatre phases alternées avec son témoin,
à résolution identique, plafonds 60 et vitesse normale. Les réglages sont les
mêmes ; seule l'identité de l'exécutable diffère dans la politique. Les deux
relevés supplémentaires du candidat et ses compteurs font partie de son coût.

| Passage | Version | Retours de présentation/s | Fenêtres complètes retenues |
|---|---|---:|---:|
| A1 | Témoin `be3c43fb` | 28,44 | 84,38 s |
| B1 | Candidat `c686c1ff` | 29,01 | 82,73 s |
| A2 | Témoin `be3c43fb` | 27,64 | 65,11 s |
| B2 | Candidat `c686c1ff` | 28,51 | 63,13 s |

Cela représente 295,35 secondes de fenêtres complètes sur 360,01 secondes
commandées. Le candidat est devant de 2,0 % puis 3,1 % dans ces deux paires.
Ce signe répété ne suffit pas à isoler une cause ; le p99 ne s'améliore pas
uniformément dans la première paire. Les captures gardent le même checkpoint
devant Saria, sans déplacement commandé. Les retours Vulkan ne comptent pas
des images invitées uniques ni l'affichage physique. Le décodage local reste
désactivé : ce diagnostic ne qualifie pas une partie au navigateur.
Les quatre arrêts sont normaux ; les 8 652 fichiers protégés, le cache installé
et le cache source privé sont préservés. Aucun moteur n'est installé. La
proposition Lichii 1216 reste préparée ; le diagnostic des lectures mémoire
décrit en tête guide maintenant le choix suivant. Aucune limite
matérielle n'est démontrée. Rapport :
`spikes/switch2-room/goal40-readtick-comparison-2026-11-11.json`.

**Reprise du 11 novembre : candidat compilé et tests natifs CPU réussis.**
Le contrôle fonctionnel réel du port 1058 et 1244 passe maintenant dans la
sixième préparation corrigée. Pendant ses 46,46 secondes, deux relevés internes
constatent 17 685 lectures servies par le nouveau chemin. Les huit résumés
cumulés du vérificateur ne signalent aucune divergence dans leurs copies
comparées ; le dernier compte 73 251 copies et 246 339 KiB, chargement inclus.
Ils excluent notamment les plages réécrites et ne donnent pas un total final.
La direction tenue puis les quatre manettes au repos sont lues dans le noyau
Linux, avant la fermeture de page. L'interruption demandée et l'arrêt natif sont
normaux ; les 8 652 fichiers installés restent identiques. Ce vérificateur ajoute
des copies synchrones et ne mesure aucun gain. La comparaison distincte décrite
ci-dessus le suit sans ce vérificateur. Rapport :
`spikes/switch2-room/readtick-functional-2026-11-11.json`.

Après la fin de la partie installée, les vingt unités CPU préparées donnent
les résultats attendus : deux positifs et dix-huit négatifs, puis les positifs
repassent. Le contrat des compteurs refuse ses huit mauvais cas. La compilation
complète du port 1058 et 1244 termine en 525,12 secondes, sans interférence.
Les six unités modifiées sont réellement reconstruites. Le nouvel exécutable
privé porte l'empreinte `c686c1ff`. Les quinze cas natifs ciblés passent, puis
la suite complète recense 1 257 cas, dont quatre ignorés sans réseau et aucun
échec, en 39,15 secondes. Ces tests n'ont pas accès au GPU. Ils ne prouvent ni
la fraîcheur des lectures Vulkan ni l'activation du nouveau chemin pendant
une partie. Le contrôle réel et la comparaison décrits ci-dessus les complètent.
Aucun moteur installé n'est remplacé.

**Revue amont du 11 novembre : Fritchii publie des préversions hors branche principale.**
Les listes de publications et de tags retrouvent 5.8 à 5.8.3, publiées entre
23 h 52 et 0 h 38 sur `oot-gather-fix`. Le point d'entrée qui cherche la dernière
version stable les omettait. La comparaison épinglée depuis 5.7 contient
19 commits et 73 fichiers. Elle apporte des pistes sur les copies de textures,
les traductions mémoire et les prédicats de rendu. L'option annoncée pour
raccourcir la compilation invitée est déjà présente dans les en-têtes de notre
base et ne justifie pas de nouveau port. Les deux dernières pistes demandent
encore une preuve de cohérence ; le mode de pages
réécrites peut explicitement retarder une écriture d'une image et reste écarté
sous cette forme. Aucun de ces changements n'est compilé ou installé ici.
Le candidat 1058 et 1244 a depuis passé le contrôle et la comparaison décrits
ci-dessus. Rapport de cette revue amont :
`spikes/switch2-room/upstream-2026-11-11.json`.

La lecture détaillée des prédicats ne retient pas leur port direct : le macro
observé passe déjà au fil graphique dans notre base et la clé de reconnaissance
ne suit pas tous les changements de programme. La proposition Lichii 1216 vise
plutôt des reconstructions d'état de dessin encore présentes ici. C'est une
piste suivante, sans gain local mesuré ; les anciens coûts instrumentés ne
constituent pas le budget disponible de notre version courante.

**Cinquième préparation : identités de configuration issues du paquet.**
Le quatrième constructeur refuse une empreinte devenue périmée avec son nouveau
chemin, avant worker ou émulateur. Le contrôle actuel lit chemin, empreinte, rôle
et révision depuis le même paquet sélectionné ; il précède la création de salle.
Dix-sept cas et les cinq amorçages ordinaires par les vrais seeds passent, ainsi
que les dix entrées du chargeur. Le nouveau départ revalide les 8 652 fichiers
installés identiques. La F1 réelle charge le checkpoint, puis son lecteur des
réglages conserve lui aussi une ancienne empreinte. Elle s'arrête avant la
phase, avec fermeture native normale, ressources privées disparues et fichiers
installés identiques. Une sixième préparation relie également ce lecteur au
paquet sélectionné et rejoue son corps complet sur les cinq configurations
actuelles. Ses cinquante cas complets, vingt contrôles du pilote, douze du
chargeur et cinq copies de départ passent. Deux départs réels restent exclus
avant phase : le reçu visuel écrit à la main omet d'abord le chemin de salle,
puis la place reconnectée n'est pas encore annoncée avec son nom par le salon.
Le premier reçu est corrigé ; l'attente du véritable état serveur passe onze
contrôles avec des réponses simulées explicites, dont les états transitoires
et les mauvais jeu, joueur et spectateur. Les deux arrêts sont normaux et leurs sorties sont archivées sans
déplacer les entrées figées. Le troisième départ passe le contrôle fonctionnel
décrit ci-dessus. Aucun résultat FPS n'est retenu.
Rapport : `spikes/switch2-room/readtick-config-identity-2026-11-11.json`.

**Lecteur kernel qualifié, entrée du chargeur corrigée avant une quatrième préparation.**
Le lecteur isolé passe quatorze contrôles réels, avec état tenu/repos et nettoyage.
Le troisième démarrage s'arrête pourtant avant commande : le début du chargeur
attend le nom de la préparation v2. Le test de ses appels commençait après ce
garde. La correction dérive le dossier du module réel et exerce cinq entrées
normales et cinq validations, avec défaut réintroduit et dossiers étrangers.
Les sources du lecteur restent identiques à la qualification réelle précédente.
L'arrêt natif v3 et le nettoyage sont normaux ; aucune cadence n'est retenue.
La nouvelle préparation attend son gel puis une F1 complète. Rapport :
`spikes/switch2-room/readtick-loader-entry-2026-11-11.json`.

**Deuxième essai réel : lectures exercées, preuve des manettes refusée.**
Les appels corrigés passent cette fois et le garde surveille la salle.
La scène préparée porte bien « Kokiri Forest ». Deux instantanés entièrement
internes constatent 17 152 actions de lecture servies par le nouveau chemin.
Les dix-sept résumés cumulés du vérificateur ne signalent aucune divergence ;
le dernier recense 173 756 copies et 580 073 KiB comparés, chargement inclus.
Ils ne donnent pas un total final après leur dernière émission.
La lecture de l'état des manettes échoue : le conteneur du helper voit les
fichiers mais n'a pas l'autorisation d'ouvrir ces périphériques. La direction
est envoyée mais son état tenu n'est pas prouvé. La phase finit à son terme,
incomplète, avec relâchements rapportés ; ce n'est pas l'interruption attendue.
L'arrêt natif et le nettoyage sont normaux, sans erreur GPU, avec les
8 652 fichiers protégés identiques. Aucun résultat de cadence n'est retenu.
Un lecteur séparé, limité aux quatre périphériques privés en lecture seule,
est qualifié sans jeu avant la troisième préparation. Rapport :
`spikes/switch2-room/readtick-runtime-partial-2026-11-11.json`.

**Premier lancement du candidat, arrêt avant la phase.** Le vrai exécutable
`c686c1ff` charge le checkpoint observé près de Saria. Ses 141 réglages et son
marqueur sont vérifiés ; son nouveau point de traitement sert des lectures
pendant le chargement. Deux erreurs du banc empêchent la suite : le négatif
d'affinité appelle un fichier absent et le pilote F1 démarre le garde de B1.
Les tests d'amorçage et de lecture précédents ne couvraient pas ces appels
ultérieurs. Aucune phase, entrée tenue ou comparaison ne démarre.
L'arrêt natif vaut zéro, sans fermeture forcée. Un audit manuel distinct
constate les onze PID observés disparus, aucun Chrome, émulateur, conteneur
ou pad restant, l'observateur actif et 8 652 fichiers installés identiques.
Les 4 882 fichiers de cache et checkpoint sources privés restent aussi identiques.
Le compte rendu normal manque parce que le garde n'a pas démarré.
La première préparation reste figée et incomplète ; une seconde doit vérifier
les vrais appels de ses auxiliaires et attendre le garde avant le worker.
Rapport : `spikes/switch2-room/readtick-runtime-bootstrap-2026-11-11.json`.

**Arrêt du banc corrigé sur CPU, à confirmer dans une vraie salle privée.**
Les seize cas de cycle de vie donnent treize succès et trois échecs volontaires.
Le garde attend désormais le contrôleur d'entrées avant de fermer sa page,
et l'audit suit seulement nos processus et manettes. Les doubles de clavier
ne prouvent pas les relâchements réels. Le correctif sera repris dans une
nouvelle préparation, sans modifier la série interrompue. Rapport :
`spikes/switch2-room/phase-stop-2026-11-11.json`.

**Objectif actualisé le 10 novembre au soir : au moins 40 images/s constantes.**
L'objectif demandé remplace les 30 régulières précédentes ; ces anciens essais
restent des observations historiques. Le profil installé limite volontairement
la présentation à 30 à deux endroits. Une nouvelle copie privée relève ces deux
limites à 60, sans changer l'horloge invitée à 60 Hz, la vitesse à 100 %, le
rendu, la sauvegarde ni le cache appris. Son contrôle exige aussi le mot natif
`0x1003c`, soit un intervalle invité de un à 60 Hz : une étiquette « FPS Unlock »
ne suffirait pas si le jeu demandait encore un intervalle de deux.
Le premier essai prévu dure 90 secondes sur la vue fixe observée de Kokiri,
avec les deux flux vidéo et sonores conservés mais sans décodage local.
Cette condition allégée sert au diagnostic et ne qualifie pas encore une partie
au navigateur. Les tests refusent les deux anciens plafonds, une vitesse à 133 %,
une horloge différente et le mot natif bridé. Aucun moteur n'est remplacé.

**Premier passage sans les plafonds à 30 terminé.** Le bon exécutable, les
141 réglages, le mot natif `0x1003c`, les limites à 60 et la vitesse à 100 % sont
vérifiés avant et après 90 secondes. Les trois fenêtres Vulkan complètes donnent
29,37 retours/s sur 61,30 secondes, avec p99 de 42,27 à 43,38 ms et maximum
52,12 ms. Aucun intervalle retenu ne dépasse 100 ms. Les captures avant, milieu
et après gardent la même vue de Kokiri et le même emplacement près de Saria.
L'arrêt natif est normal ; les 757 fichiers protégés et les deux caches sources
restent identiques. Cette observation unique, à lecture locale désactivée,
ne prouve ni gain causal ni limite matérielle. Les 40 constantes ne sont pas
atteintes. La suite examine la résolution interne à 0,5 contre 1, sans modifier
l'horloge ni la vitesse. Rapport :
`spikes/switch2-room/goal40-uncapped-2026-11-10.json`.

**Comparaison de résolution en reprise, sans résultat causal.** La première
réduction atteint réellement une cible GPU de 1 280 × 720, vérifiée par la
capture de la passe tonemappée et ses octets décompressés, après la mesure.
Deux passages réduits de séries incomplètes restent à 28,58 puis 28,42 retours/s.
Les témoins normaux s'arrêtent avant la mesure : un lecteur ouvre d'abord le
candidat commun, puis un autre garde la politique commune du cas réduit.
Le premier test ne couvrait que le choix du candidat et a manqué cette seconde
lecture. Les arrêts sont normaux et aucune comparaison n'est retenue.
Une troisième préparation vérifie tous les lecteurs par passage et retire
les fichiers natifs communs, pour que le premier cas ne masque plus cet oubli.
Rapport de reprise : `spikes/switch2-room/goal40-resolution-restart-2026-11-10.json`.

**État préparatoire du 10 novembre, remplacé par les tests ci-dessus.** Les propositions
Lichii 1058 et 1244 sont récupérées à des révisions précises. La seconde sert
les lectures du processeur invité à des points sûrs du fil GPU ; la première
libère correctement ses lecteurs pendant l'arrêt et constitue un prérequis.
La référence et son dossier de construction sont copiés indépendamment.
Le port des deux correctifs et leurs fixtures sont en cours, sans compilation
ni essai de ce nouveau candidat. Les tests de réveil, d'arrêt et de génération
sont conçus, sans gain annoncé. Rapport :
`spikes/switch2-room/readtick-preparation-2026-11-10.json`.

**La troisième série est interrompue par une partie installée.** Les lecteurs
corrigés passent cette fois sur les vrais processus A1 et B1, avec 141 réglages.
A1 termine normalement à 27,91 retours/s sur 64,50 secondes retenues, maximum
68,11 ms, et sa capture confirme la cible hôte de 1 280 × 720. Une autre salle
Zelda installée démarre pendant B1. Le garde la détecte vers la 69e seconde
et arrête l'essai privé. B1 est exclu ; A2 et B2 ne démarrent pas. Aucune
comparaison de résolution ni limite matérielle n'est retenue.
L'émulateur privé ferme normalement et tous les PID observés de notre essai
disparaissent. Le contrôleur d'entrées termine en échec après la fermeture de
sa page, sans neutralisation confirmée. Le superviseur a vérifié sa disparition
trop tôt : son fichier de nettoyage habituel manque. Un audit manuel distinct
prouve l'arrêt des processus et conteneurs privés ; il ne transforme pas cette
phase en succès. Les quatre manettes restantes appartiennent à la salle installée.
Rapport : `spikes/switch2-room/goal40-resolution-interrupted-2026-11-10.json`.

**État source du 10 novembre, remplacé par la compilation ci-dessus.** Les correctifs 1058 et
1244 sont composés sur huit fichiers, avec un accès de diagnostic qui lit des
compteurs cumulatifs sans opération GPU. Vingt unités CPU sont préparées mais
non exécutées. L'exécutable copié dans le dossier de construction reste celui
d'avant le port : aucun nouvel ELF n'est qualifié. La compilation, les fixtures
et un nouvel essai contrôlé attendent la disparition réelle de la partie en
cours. Le jeu installé et ses sauvegardes ne sont pas remplacés.
Rapport : `spikes/switch2-room/readtick-preparation-2026-11-10.json`.

**Sauvegardes installées le 10 novembre.** Pour les quatre consoles,
« partie neuve » crée la progression personnelle du compte et conserve la
précédente dans un historique. « Reprendre » la retrouve dans une autre salle.
Deux identités conservent des dossiers distincts, même avec le même pseudo.
« Tout débloqué » reste partagé et dépend d'un reçu d'import dont les fichiers
existent encore. Neuf imports connus reçoivent ce reçu ; Zelda n'en possède pas.
Trois sauvegardes personnelles sont migrées sans modifier leurs sources.
La progression Zelda de Souhib est récupérée dans son compte : utiliser
« reprendre » pour la continuer. La salle installée expose les vingt jeux et
les neuf imports attendus, sans lancer d'émulateur pendant ce contrôle.
Les preuves et limites sont dans
`spikes/switch2-room/saves-accounts-and-freezes-2026-11-10.json`.
Le retour de Souhib confirme une nette amélioration de la vitesse mais des
freezes persistants. Les journaux montrent des attentes de compilation ; leur
responsabilité complète reste à prouver.

**Sonde GPU préparée sur la base installée, le 10 novembre.** Une copie des
5 213 fichiers source de `65defb74` reçoit une sonde des soumissions existantes.
Le candidat privé `be3c43fb` passe la compilation complète et sa suite CPU :
1 255 cas recensés, quatre ignorés sans réseau. Les tests sur le vrai fichier
avec doubles CPU refusent quatre mutations de ses contrôles. Les images ne
reçoivent aucune attente explicite supplémentaire du GPU ; les horodatages
ont néanmoins un coût qui reste à qualifier. Le contrôle refuse le lancement
en présence d'un client GPU extérieur, avant le worker et le jeu. Aucun temps
GPU réel, gain de cadence ou arrêt natif de ce candidat n'est encore validé.
Il reste privé et n'est pas installé. Rapport et correctif :
`spikes/switch2-room/submission-gpu-65def-2026-11-10.json` et
`spikes/switch2-room/amont/submission-gpu-65def-2026-11-10.patch`.
Les essais sont arrêtés après trois reprises retrouvant ce blocage extérieur.
À 18 h 55 UTC, un nouveau contrôle ne trouve plus de client GPU ni de
processus FFmpeg, alors que Jellyfin reste démarré. Les 21 relevés espacés
d'une seconde donnent tous zéro pour l'activité GPU et mémoire, hors jeu.
Cette observation ne mesure pas la charge pendant un transcodage.
Le refus précédent était une règle conservatrice de comparaison, pas une
preuve de saturation. Jellyfin peut rester démarré pour jouer et pour les
contrôles fonctionnels. Les comparaisons de performance gardent leur exigence
d'absence de client GPU extérieur ; cela ne doit pas bloquer tout diagnostic
sous charge partagée, à condition d'en annoncer la limite. Aucun nouvel essai
du candidat, gain ni objectif atteint n'est déclaré à ce contrôle.


**Complément après 19 heures.** La reprise de la conversation retrouve l'essai
fonctionnel terminé : le bon binaire et ses 141 réglages sont vérifiés,
sept des neuf captures GPU sont entièrement dans les 15 secondes de phase,
et l'arrêt natif est normal. Les images reçues montrent Link près de Saria.
Ce résultat qualifie le fonctionnement, pas le coût de la sonde ni les 30
régulières. Rapport :
`spikes/switch2-room/submission-gpu-runtime-2026-11-10.json`.
Un premier témoin de 90 secondes termine normalement mais fait tourner
la caméra ; aucune comparaison de coût ne lui est attribuée. La calibration
suivante alterne quatre vues fixes. Son témoin conserve la sonde manuelle
chargée, sans demande d'enregistrement : seul le coût d'activation est comparé.


**Calibration terminée après la reprise.** Quatre phases fixes alternent la
sonde désarmée et active. Les quatorze fenêtres complètes couvrent
292,35 des 360,01 secondes. Leurs débits sont 28,92 / 28,51 / 28,54 / 28,98
retours Vulkan/s, avec des maxima de 49,28 à 55,88 ms. L'effet d'activation
change de signe : −1,40 %, puis +1,52 %. Son coût reste indiscernable de la
variation observée ; aucune transparence n'est certifiée. Les vues conservent
la même caméra. Les deux passages actifs donnent 87 captures entièrement
dans leurs phases ; trois autres sont exclues. Les témoins n'en produisent
aucune. L'union médiane de leurs intervalles vaut 22,25 puis 19,92 ms,
et leur enveloppe 38,63 puis 30,53 ms. Ce ne sont pas des budgets exclusifs
d'occupation GPU. Aucun client GPU extérieur n'est observé ; les quatre
arrêts sont normaux et les 757 fichiers protégés restent identiques.
Les 30 régulières restent non atteintes, même sur cette vue fixe.
La suite essaie en privé le réglage existant `FENCE_FLUSH_US=2000`, contre
500, pour examiner le regroupement des soumissions. Aucune attente de
synchronisation n'est retirée et aucun moteur n'est installé.
Rapport : `spikes/switch2-room/submission-gpu-calibration-2026-11-10.json`.


**Revue amont du soir et nouveau candidat privé.** Dix-neuf commits Lichii
supplémentaires sont examinés jusqu'à `879b616b`. Fritchii 5.7, Superbuild v50
et Orchid 0.9.4 sont aussi publiés ; leurs promesses ne valent pas mesure sur
notre Zelda. Les correctifs ciblés Lichii 1245 et 1246 sont repris dans une
copie indépendante : regroupement de copies sans dépendance et barrière
conservée dans la commande de calcul. Le binaire privé `d7df6092` compile,
avec 1 251 tests natifs réussis, quatre cas réseau ignorés et douze mutants
CPU détectés. Les copies sous Vulkan logiciel rendent les bons octets,
mais un témoin de barrière retirée n'est pas détecté : aucune qualification
complète de synchronisation n'est revendiquée. Un essai privé termine ensuite quinze secondes de déplacements avec les deux
regroupements sélectionnés et un arrêt normal. La comparaison alternée sur
vue fixe termine ensuite sans gain répété, horodatages GPU désarmés dans les
deux conditions. Le profil installé reste inchangé.
La préparation du code CPU de la proposition 1225 reçoit ensuite un port
source privé, mais ses tests de cohérence refusent sa qualification en jeu.
Aucun gain de ce candidat n'est mesuré ici. Rapport :
`spikes/switch2-room/upstream-evening-review-2026-11-10.json`.


**Comparaison terminée du nouveau regroupement.** Les quatre phases fixes
alternées de 90 secondes terminent normalement, avec la même sauvegarde,
le même cache, les 141 réglages et les marqueurs attendus. Les débits des
fenêtres retenues sont 28,34 / 29,03 / 28,88 / 27,97 retours Vulkan/s.
Activer les deux correctifs donne +2,43 %, puis −3,14 %. Aucun gain répété
n'est retenu. Les p99 de fenêtre restent entre 42,09 et 46,53 ms, avec des
maxima de 50,35 à 55,30 ms. Les quatorze fenêtres couvrent 294,29 des
360,01 secondes ; aucun intervalle retenu ne dépasse 100 ms. Cette couverture
partielle et cette vue fixe ne qualifient ni les nouveaux lieux ni les
déplacements. Le port reste privé et le moteur installé n'est pas remplacé.
Les 30 régulières restent non atteintes. Rapport :
`spikes/switch2-room/command-batching-comparison-2026-11-10.json`.

**Préparation CPU non qualifiée pour le jeu.** La proposition Lichii 1225 est
appliquée à une copie indépendante, sans compilation complète ni lancement.
Les corps exacts testés avec des doubles CPU reproduisent une invalidation
perdue du cache de page : une instruction ancienne revient après consommation
de l'invalidation JIT dans le double. Ce mécanisme est préexistant ; le
préchauffage ajoute des lecteurs spéculatifs. Aucun verrou commun n'est trouvé
dans les appelants examinés, et aucune occurrence dans Zelda n'est démontrée.
Un second cas reproduit un dépassement évitable du budget entre groupes de
64 blocs. Ses 64 ms pour une tranche de 2 ms viennent d'une horloge synthétique,
pas d'une mesure du serveur. Les deux originaux échouent, leurs jumeaux corrigés
passent et réintroduire les originaux fait échouer les tests à nouveau.
Ces jumeaux ne qualifient pas un correctif de production. Le candidat reste
privé, sans gain ni plafond matériel démontré. La cohérence du cache et les
tests du vrai compilateur sont requis avant un essai en jeu. Rapport :
`spikes/switch2-room/jit-warmup-review-2026-11-10.json`.


**Charge des lecteurs locaux, série incomplète du 10 novembre.** Une variante
privée garde deux flux vidéo, deux flux sonores et les commandes, mais ne
décode pas l'image et ne joue pas le son du jeu. Les processus de capture et
d'encodage gardent leurs identités. Deux passages de 90 secondes terminent
normalement : Chromium consomme environ 1,43 processeur logique avec lecture,
contre 0,56 sans lecture. Les fenêtres complètes donnent respectivement
25,51 et 28,79 retours Vulkan/s, avec des maxima de 86,86 et 97,28 ms.
Ces nombres ne qualifient aucun gain : la caméra diffère et les deux derniers
passages alternés manquent. Une tâche de CI diffère le troisième lancement,
puis un client GPU extérieur arrête sa préparation. Des clients Jellyfin
sont ensuite identifiés sur ce même GPU. Aucune mesure du troisième passage
n'est retenue et le quatrième ne démarre pas. Même sans lecture locale,
les 30 régulières restent non atteintes dans le passage observé. Le profil
installé et les sauvegardes restent inchangés. Rapport :
`spikes/switch2-room/local-media-work-2026-11-10.json`.

**Dernière comparaison complète surveillée du 10 novembre.** Après la fin des
transcodages, quatre phases neuves terminent normalement. Aucun client GPU
extérieur n'est relevé aux contrôles de lancement ni pendant les sessions.
Libérer les masques CPU donne cette fois −17,06 %, puis −8,20 % en retours
Vulkan/s, avec des maxima plus élevés dans les deux couples. Le placement
installé est conservé. Les débits sont 27,37 / 22,70 / 24,87 / 22,83 retours/s,
avec des p99 de fenêtre de 46,33 à 62,04 ms. Les dix fenêtres retenues couvrent
243,59 secondes sur les 360,01 secondes mesurées ; aucun intervalle n'y dépasse
100 ms. Cela ne couvre pas toute la partie. La caméra varie, la surveillance
est périodique et les deux décodeurs locaux ajoutent encore leur charge.
Les 30 régulières restent non atteintes, sans verdict matériel. Le contrôle
local complet `just` passe. Rapport :
`spikes/switch2-room/cpu-affinity-guarded-2026-11-10.json`.

**Correction du 10 novembre : la comparaison CPU précédente partageait le GPU avec Jellyfin.**
Les quatre phases de 90 secondes ont bien gardé le même moteur, les 141 réglages,
le cache et la sauvegarde. Leurs masques CPU étaient vérifiés. L'audit suivant
retrouve pourtant des transcodages Vulkan et VAAPI sur le même GPU pendant
les quatre phases, et dans leurs six fenêtres complètes retenues. Le contrôle
des compilateurs et émulateurs ne surveillait pas ce travail extérieur.
La conclusion comparative sur les contraintes CPU est donc retirée. Les
13,18 / 15,39 / 19,17 / 16,12 retours/s restent des observations sous charge
partagée, sans mesure du coût propre du ciblage de Saria ni verdict matériel.
Le profil installé reste conservé faute de qualification isolée.
Le nouveau contrôle refuse un lancement en présence d'un client GPU extérieur
et les pilotes privés le consultent aussi pendant la partie. Les tests
exercent les identités réutilisées, les clients de la salle et les refus de
lecture. Le vrai contrôle de lancement refuse le transcodage encore présent,
avant tout worker, navigateur ou émulateur. Il ne l'interrompt pas.
Les 30 régulières restent non atteintes. Preuves :
`spikes/switch2-room/external-gpu-interference-2026-11-10.json` et
`spikes/switch2-room/cpu-affinity-comparison-2026-11-10.json`.


**Comparaison des caches, quatre passages alternés du 10 novembre.** Le cache de la
partie terminée de Souhib et sa copie préchauffée ne donnent aucun avantage
répété : les couples font +2,32 %, puis −4,09 % en retours Vulkan/s. Les quatre
passages de déplacement donnent environ 28,3 à 29,5 retours/s, avec des p99 de
fenêtre de 40,02 à 50,50 ms. Les 30 régulières restent non atteintes. Aucun gel
supérieur à 100 ms n'est relevé dans les fenêtres complètes retenues ; leur
couverture partielle et le petit terrain déjà chargé ne répondent pas à tous
les freezes de la vraie partie. Aucun cache préchauffé n'est installé.
Le code distingue les objets de programmes conservés du cache temporaire du
pilote graphique. Le préchargement complet reste une piste privée à qualifier,
avec son coût mémoire et son effet sur les gels. Le diagnostic CPU et le
contrôle d'activation ci-dessous ne prouvent pas encore ce gain. Rapport :
`spikes/switch2-room/current-cache-comparison-2026-11-10.json`.

**Diagnostic CPU du 10 novembre sur le moteur installé.** Un relevé distinct
des comparaisons de cadence conserve 6 009 échantillons dans ses 24,12 secondes
observées. Le fil graphique avant passe environ 38,78 % de ses cycles
échantillonnés à attendre le fil arrière. Cela représente 4,39 % des cycles
de l'émulateur, sans donner un gain de vitesse réalisable en supprimant l'attente.
Le travail arrière se répartit entre plusieurs fonctions ; une partie de la
bibliothèque système reste inconnue. Les piles d'appels restent très incomplètes,
même sans perte d'échantillons. Un contrôle des enregistrements bruts valide
leur identité et leurs temps malgré un avertissement de métadonnées de `perf`.
Le serveur possède six cœurs physiques et douze processeurs logiques. Les deux
clients vidéo locaux du banc sont une charge supplémentaire à isoler avant
d'attribuer une limite au matériel. Le temps physique du GPU reste à mesurer
avec ce moteur exact. Aucun nouveau réglage de performance n'est installé.
Les trois nouveaux changements Lichii examinés concernent le son de l'ocarina,
des textures de copies endommagées et un dialogue de réglages Qt ; aucun ne
prouve une correction des freezes observés. Rapport et prochaines expériences :
`spikes/switch2-room/hot-cpu-profile-2026-11-10.json`.

**Revue amont actualisée le 10 novembre jusqu'à Lichii `093e264c`.** Quatre
changements supplémentaires concernent la compilation MSVC, les alias mémoire
GPU à détruire, la limite de mémoire engagée sous Windows et un avertissement
de compilation macOS. Le correctif d'alias est un candidat de stabilité,
pas un gain de cadence mesuré. Aucun rebase ni changement de moteur n'est
installé. La réutilisation de parties de programmes graphiques, étudiée dans
DXVK et ANGLE, reste une piste de développement. Les identités invitées du
cache ne suffisent pas à prouver une réutilisation correcte côté Vulkan.
Rapport : `spikes/switch2-room/pipeline-reuse-review-2026-11-10.json`.

**Préchargement complet activé en privé le 10 novembre.** Le même moteur met
2 525 programmes en préparation au départ, contre 1 742 dans les témoins,
et ne signale plus les 783 programmes écartés au démarrage. Ses 141 réglages
restent identiques. Un passage de 90 secondes au sol se termine normalement,
avec commandes et signal sonore reçu. La mémoire résidente relevée atteint
11,63 Gio pour le processus entier ; son surcoût propre reste à mesurer avec
un témoin. Ce passage unique ne compare pas les freezes, ne prouve pas la
réussite des 2 525 constructions et ne teste pas les nouveaux lieux ni
l'éviction tardive des programmes. L'option reste désactivée en production.
Rapport : `spikes/switch2-room/preload-all-activation-2026-11-10.json`.

**Le trajet du 10 novembre distingue cache existant et dessins encore inconnus.**
Un passage privé atteint un intérieur meublé puis revient dehors. Il comprend
un message de récupération de cœur, des pauses et des contacts avec le décor ;
aucune cadence de marche continue n'en est déduite. Une fenêtre Vulkan atteint
470,41 ms. Un compteur couvrant environ 60,21 secondes relève 430,6 ms cumulées
d'attente de programmes en construction. Le rapprochement ne prouve pas une
cause unique. Les premiers retraits de programmes arrivent plus tard et ne
peuvent pas expliquer ce gel antérieur.
Le catalogue complet du fichier initial retrouve 2 352 clés graphiques et
173 clés de calcul. Les cinq constructions lentes nommées par le journal en
sont absentes ; elles apparaissent après le trajet. Le préchargement ne peut
donc pas préparer directement ces clés depuis ce fichier initial. Une copie
privée du cache appris contient six nouvelles clés graphiques, soit environ
405 Kio supplémentaires sur disque pour tout le cache. Elles sont marquées
comme utilisées récemment. Le démarrage met réellement 1 748 travaux en
préparation avec cette copie, contre 1 742 auparavant. La comparaison de trajet
suivante est arrêtée après deux phases : les images montrent une vraie entrée
dans la pièce pour le témoin, mais seulement son seuil pour la variante.
Les mêmes durées de commandes n'ont pas donné les mêmes scènes. Aucun gain
de cache n'est retenu et aucune copie apprise n'est installée. Rapport initial :
`spikes/switch2-room/route-cache-coverage-2026-11-10.json`.
L'essai écarté et ses preuves figurent dans le rapport CPU ci-dessus.

**La salle habituelle propose GameCube, Wii, Switch et Switch 2 expérimentale.** Dolphin
reste le moteur GameCube/Wii. Ryubing, en version amont `475615f` depuis le
10 septembre, avec les correctifs locaux de `spikes/switch-room/amont/`, exécute
la Switch. Depuis le 10 novembre, un profil par titre sélectionne Lichii
`65defb74` pour Zelda Switch 2, avec une cible de 30 images/s, un joueur
et des spectateurs. Eglantine du 7 novembre reste le choix global des autres
titres Switch 2. Le salon, les places, le chef, les profils et
le transport vers les navigateurs sont communs.

**Depuis le 12 septembre 2026, la machine tient trois salles.** `nel3ab.app` ne
mène plus à une salle mais à leur liste: on en ouvre une d'un clic, et chacune
vit sous son adresse, `/r/1/` à `/r/3/`, avec au plus quatre places de jeu. Une
seule salle à la fois peut faire tourner un jeu Switch ou Switch 2, car ces moteurs coûtent
bien plus cher que Dolphin; la règle vit dans le worker, sous forme de verrou de
fichier, parce qu'une page demande son jeu au worker sans passer par le salon.
Une salle dont plus personne ne touche une manette pendant trente minutes
prévient cinq minutes avant, puis ferme son jeu et se ferme.

**Dernier point de reprise, le 10 novembre après activation du profil Zelda.** Les essais privés
avec maillages dessinés et NoSharpening donnent 32,06 contre 29,73
présentations/s, soit +7,82 % observé sur quatre phases alternées. L'option
change l'anticrénelage ; elle reste candidate privée. Les intervalles
restent irréguliers, y compris avec le plafond de présentation à30 :
les p99 de fenêtre sont encore autour de44–48ms. La sonde globale du
minuteur n'explique pas ces écarts. La nouvelle instrumentation ciblée
VI2/Vulkan est construite et activée réellement : elle mesure encore des
p99 autour de 46 ms aux deux étapes. Quatre nouvelles phases alternées
confirment ensuite une sortie Vulkan plus régulière avec son plafond natif
à 30 : p99 de fenêtre entre 33,58 et 36,30 ms, contre 46,06 à 48,00 ms
en automatique. Le maximum reste 43,52 ms avec le réglage retenu pour la
suite. La cadence des demandes du jeu reste moins régulière. Aucun diagnostic
préliminaire n'entre dans cette comparaison. Ce résultat de caméra ne prouve
ni 30 images/s constantes en déplacement ni l'affichage physique des images.
Ce contrôle caméra ne déclenche pas d'installation.
Le port ciblé de #1143 compile ensuite dans une nouvelle copie, avec
1 164 tests réussis et quatre ignorés sans réseau. Trois sessions vérifient
la descente au sol, de courts déplacements, un intérieur et son retour
extérieur, puis une sauvegarde manuelle explicitement reprise après arrêt.
Elles ne donnent aucune fenêtre complète de marche continue. Un passage
dédié de 90 secondes donne ensuite 30,00 retours Vulkan/s sur 60 secondes
de fenêtres complètes, avec p99 de fenêtre entre 33,48 et 34,22 ms,
maximum 34,58 ms et aucun intervalle au-delà de 100 ms. Il décrit de petites
traversées locales observées, avec une capture intermédiaire signalée.
Une portion de cinématique est ensuite comparée à ses sources audio et
vidéo : douze paires couvrant 90 secondes sont compatibles avec la vitesse
réelle et un écart son/image inférieur à l'incertitude de 0,5 seconde.
Sept paires rejetées restent publiées. Ce contrôle ne qualifie ni toutes
les cinématiques ni la vitesse absolue du monde 3D. Une nouvelle zone nommée
et la chaîne navigateur restent aussi à qualifier.
Le premier essai de salle isolée échoue avant tout lancement du moteur :
la dépendance Python `evdev` manque dans l'image employée par le helper
des manettes. Les 120 secondes d'attente de la page ne mesurent donc pas
la cadence de Zelda. Une image privée dérivée passe ensuite le contrôle
réel des quatre manettes. La deuxième salle atteint Kokiri depuis le
navigateur, avec joueur, spectateur, son reçu et commandes observées.
Le pilote externe des mouvements quitte toutefois avec le code 143 avant
son rapport final : les 90 secondes ne sont pas qualifiées et aucune
cadence navigateur n'est retenue. Le moteur continue et ferme normalement.
La troisième salle termine ensuite 90 secondes de commandes navigateur.
Les fenêtres complètes Vulkan couvrent 80,51 secondes à 29,81 retours/s.
Un intervalle atteint 113,15 ms ; trois des quatre fenêtres ont un p99
entre 33,88 et 34,36 ms. Le passage fonctionne, mais ne tient donc pas
30 constantes. Le son reçu et programmé progresse sans nouvelle coupure
comptée, avec joueur et spectateur. Les nouveaux décors et leurs chargements
restent à examiner. Un parcours atteint ensuite un intérieur distinct,
sans nom affiché ni durée de chargement mesurée. Ses courts appuis ne
donnent aucune fenêtre de marche continue. Le choix d'un moteur par titre
est ajouté et testé pour préparer Zelda seul. La salle isolée utilise ensuite
réellement le paquet installé et cette sélection, avant et après 90 secondes
de commandes. Les fenêtres Vulkan donnent 29,31 retours/s sur 61,42 secondes,
maximum 65,82 ms, sans intervalle au-delà de 100 ms ; 30 constantes restent
non prouvées. Le profil est ensuite activé pour les futurs lancements de
Zelda, avec caches préparés, ancienne configuration conservée et 22 fichiers
NAND sauvegardés sur deux emplacements. Aucun redémarrage de salle n'est fait.
Les sauvegardes habituelles restent identiques.
L'installation et ses limites sont dans
`spikes/switch2-room/title-profile-installation-2026-11-10.json`.
La suite prépare le préchauffage sans changer ce profil. La commande CPU
native extrait 4 794 enregistrements de calcul en privé, mais signale
18 conversions ignorées et 17 456 erreurs de membres aux causes non détaillées.
La structure du fichier passe ses contrôles. Le consommateur Vulkan termine
ensuite en 144,7 secondes : 5 461 travaux réussis, un échec, aucun non atteint.
La borne garantit au moins 4 678 nouveaux programmes de calcul compilés.
La fermeture est normale et le cache passe d'environ 17 à 128 Mo.
Le démarrage suivant reconnaît ensuite le marqueur et ne reprogramme aucun
calcul ; un travail graphique est tenté et échoue. La lecture du cache est
observée sans rejet, avec fermeture normale. Cela ne prouve ni succès internes
du cache RADV ni réduction des à-coups. La comparaison en partie reste à faire.
Le profil installé conserve son option de précache désactivée. Rapports :
`spikes/switch2-room/precompile-review-2026-11-10.json` et
`spikes/switch2-room/warm-compute-preparation-2026-11-10.json`.
Le contrôle GPU positif est dans
`spikes/switch2-room/warm-gpu-attempt-03-2026-11-10.json`.
La reconnaissance est dans
`spikes/switch2-room/warm-gpu-reuse-01-2026-11-10.json`.
Preuves et étapes : [plan courant](plan-60fps-switch2-2026-11-08.md) et
`spikes/switch2-room/no-sharpening-2026-11-09.json` et
`spikes/switch2-room/host-pacing-confirmation-2026-11-10.json`.
La qualification fonctionnelle est détaillée dans
`spikes/switch2-room/functional-qualification-2026-11-10.json`.
Le passage de marche est dans
`spikes/switch2-room/continuous-walk-2026-11-10.json`.
Le contrôle cinéma est dans
`spikes/switch2-room/cinema-qualification-2026-11-10.json`.

**Objectif actif du 9 novembre : 30 images/s régulières en jeu.** La nouvelle
version officielle Eglantine 0.1.0-rc3 du 8 novembre, révision `78743f30c`,
donne 23,68 images/s contre 22,50 pour le moteur installé, sur quatre passages
alternés avec mouvements de caméra. Le paquet complet change, sans attribution
à un correctif particulier. Un intervalle dépasse 100 ms avec rc3 ; 30 images/s
constantes ne sont pas atteintes. Le regroupement de certaines copies GPU en
mode 0 donne ensuite 22,05 images/s contre 21,14 pour son témoin local, sur
quatre passages alternés. Le petit gain observé ne suffit pas ; les premiers
chargements de cache limitent son interprétation. Les 242 tests passent dans
les deux configurations, cinq défauts réintroduits sont détectés, Link marche
au sol et les quatre arrêts sont normaux. Le son, la sauvegarde et un changement
de zone ne sont pas encore validés sur ce prototype. La série suivante compare
le même paquet officiel rc3 avec Mesa 25.2.8 et un conteneur privé Mesa 26.2.6.
Les quatre passages du pilote donnent ensuite 23,86 images/s avec Mesa 25.2.8
et 23,50 avec 26.2.6 ; aucun gain utile n'est retenu. Les publications plus
récentes Lichii 125, Superbuild v31 et Orchid 0.9.1 sont vérifiées et préparées.
Superbuild v31 atteint Kokiri : 21,16 images/s en mode 0 puis 23,33 en mode 2,
avec marche au sol et arrêts normaux. Ces deux phases successives, à cache
évolutif, ne prouvent pas un gain causal du mode. Lichii 125 atteint également
la scène et termine à 22,82 images/s, avec marche et arrêt normal. Orchid 0.9.1
reste inutilisable visuellement dans ce contrôle : aucun FPS jouable n'est
accepté. Un premier essai du profil portable de rc3 donne 23,04 images/s,
avec dimensions demandées par le jeu vérifiées, marche et arrêt normal. Aucun
de ces essais isolés ne valide une comparaison causale ni 30 images/s.
Les quatre phases alternées de placement CPU donnent ensuite 23,32 images/s
au placement initial et 20,22 avec le fil graphique dédié : cette politique est
écartée et le placement initial est rétabli avant l'arrêt normal. La suite
prépare une construction de rc3 adaptée au Ryzen, avec PGO officiel et LTO,
sans le prototype local de copies. Ses 239 tests passent, quatre tests réseau
restent ignorés sans réseau. Le premier essai donne 23,07 images/s au total,
avec des fenêtres après les à-coups initiaux autour de 24,41, une marche au sol
et un arrêt normal. Ce n'est pas une comparaison alternée de compilateurs et
cela n'atteint pas 30 images/s. Deux relevés CPU séparés terminent ensuite sans
perte ni expiration des cartes mémoire. Des copies coûteuses restent sans
appelant identifié même avec une pile plus profonde ; aucun correctif n'est
choisi sur cette attribution incomplète. Quatre phases alternées du mode
automatique et du mode performance GPU donnent ensuite 22,82 contre 23,87
images/s, avec une seule fenêtre complète par phase et un écart peu répétable.
La fermeture demandée quitte avec le code 139 ; sa cause reste inconnue.
Le mode automatique, le plafond de 150 W et la boîte noire sont rétablis.
Les adresses de retour rattachent ensuite des copies à l'envoi des tampons
vers le GPU ; un premier prototype privé en mémoire système donne 22,47
images/s, avec marche au sol et arrêt normal. Ce contrôle isolé ne juge pas
le placement mémoire seul, car il change aussi le nombre de tampons. Un second
prototype prépare un anneau distinct et corrige un défaut de curseur reproduit
sans GPU : après un tour refusé, une nouvelle demande pouvait réutiliser une
région encore occupée. Les tests vérifient le refus répété puis l'acceptation
après la fin du travail. Ce défaut n'est pas attribué aux saccades de Zelda ;
les quatre passages alternés du second prototype donnent ensuite 22,14
images/s en mémoire système contre 23,29 pour le chemin habituel. Cette variante
est écartée, avec marche au sol et quatre arrêts normaux. Le correctif de
curseur est présent dans les deux variantes, donc son effet sur la cadence
reste non mesuré. Ses trois nouveaux tests portent le total à 242 réussis dans
les deux configurations, avec quatre tests réseau ignorés. Le diagnostic
suivant vise les transferts de données identiques, sans en supprimer pendant
la mesure. Les huit fichiers `progress.sav` et la configuration sont inchangés.
Cette sonde observe ensuite 46 410 transferts admissibles représentant environ
3 Gio, tous identiques à leur précédent instantané source, soit 80,74 % des
octets transférés dans la période retenue. Cela ne prouve pas que leur
destination GPU est inchangée. Les 244 tests passent, trois mutations sont
détectées. Le relevé et le contrôle désactivé repris atteignent Kokiri et
s'arrêtent normalement ; le premier contrôle désactivé, sorti 134 au chargement
avec une erreur de mémoire Vulkan, reste exclu et conservé. Le code force
justement le réenvoi de certaines banques chaque image. Un prototype compare
les pages concernées avant cette seule invalidation forcée, tout en conservant
le suivi normal des écritures. Ses deux premiers passages successifs donnent
22,36 images/s activé et 23,87 désactivé ; ce ne sont pas des phases alternées.
Un diagnostic séparé ne compte aucun réenvoi évité sur 98 048 décisions en
mouvement : le cache entier est vidé 573 fois, dont 571 par des effacements GPU.
La version suivante limite ces invalidations aux pages qui recouvrent la
destination. Les 248 tests passent dans les deux configurations et les défauts
de portée réintroduits sont détectés. Le diagnostic de cette version évite
ensuite 76,02 % des invalidations forcées examinées, ce qui ne mesure pas les
octets réellement transférés. Ses quatre passages alternés donnent 24,23
images/s activé contre 22,48 désactivé, soit +7,79 % observés. Les fenêtres
retenues ont une couverture inégale et le premier témoin comporte des à-coups
initiaux ; une vérification secondaire de fenêtres plus tardives donne +4,41 %.
Les quatre marches et arrêts sont normaux. Un chargement sorti 134 et un
passage perturbé par une nouvelle CI restent exclus. Cette variante demeure
privée : elle n'atteint pas 30 images/s et ne valide pas encore les
clignotements, les zones, le son, une sauvegarde reprise ni la correspondance
exacte entre son instantané source et l'envoi sous écritures concurrentes.
Le rapport est `spikes/switch2-room/native-bank-2026-11-09.json`.
Deux contrôles successifs du regroupement existant en mode parallèle donnent
23,51 images/s à 8 ms puis 22,01 à 500 microsecondes, avec des fenêtres
tardives proches de 25 dans les deux cas. Ils ne prouvent pas un gain causal
du délai ni 30 images/s. Les arrêts sont normaux ; un premier témoin noir
avant activation observée reste exclu. Le réglage installé est conservé.
À partir de 11 heures, la recherche demandée sur les autres moteurs trouve
douze commits Lichii depuis build 125. Une copie isolée de `986a2b684` compile
avec le même Clang, PGO et ThinLTO, sans nos prototypes C++. Elle contient
de nouveaux chemins de sémaphores, de réutilisation d'uniformes et de
descripteurs à vérifier avant adoption. Un probe isolé reproduit une
divergence entre mot ordinaire et miroir sur état synthétique ; aucune
occurrence Zelda ni correction de cadence n'est encore établie sur cette base.
Le défaut de curseur reste à porter séparément. La quotidienne Eglantine
du 9 novembre pointe sur la même révision déjà testée ; Orchid 0.9.2 reste
une autre piste, sans correction Zelda démontrée. Les méthodes de suivi des
plages de Ryubing et de réservation de Dolphin complètent la recherche.
La compilation amont passe ensuite 1 086 tests, avec quatre ignorés sans
réseau. Le diagnostic en mode 0 n'exerce pas les optimisations delta ; il
n'est pas accepté comme validation. En mode 1, il observe 592 différences
d'octets sur 334 475 vérifications d'uniformes en mouvement, mais aucune sur
120 832 vérifications de descripteurs. Un test réel reproduit une écriture
non notifiée sur une page déjà sale. La correction valide les octets avant
de reprendre une allocation ; la mutation supprimant ce contrôle échoue.
Elle est combinée au seul correctif de curseur, sans autre prototype local.
Les 1 091 tests passent, quatre sont ignorés. Le chemin corrigé est exercé
en jeu et les sondes sont retirées avant les FPS. Les deux essais successifs
donnent 20,42 en mode 1 et 19,93 en mode 0, avec marche et arrêts normaux.
Cette sélection n'est pas une comparaison alternée et n'atteint pas 30.
Aucun changement de moteur n'est installé. Le rapport est
`spikes/switch2-room/upstream-refresh-2026-11-09.json`.
Le port exact de Lichii #874 distingue ensuite les publications constantes
des vrais compteurs GPU, avec nettoyage unique des requêtes. Le vrai cache
et le vrai gestionnaire de clôtures reproduisent l'attente avant correction ;
neuf tests ciblés passent ensuite et cinq mutants échouent. La construction
complète passe 1 100 tests, quatre sont ignorés sans réseau. Le callback est
observé en jeu avant quatre phases sans sondes, à caches privés identiques
restaurés : 21,32/20,21/20,62/19,93 images/s, corrigé/témoin alternés.
Le total donne 21,08 contre 20,07, soit +5,05 % observés, avec couverture
inégale. Les déplacements et arrêts sont normaux ; aucun 30 images/s
n'est démontré. Le rapport est `spikes/switch2-room/payload-release-2026-11-09.json`.
Le nouveau commit amont `0b83798bf`, publié à 12:05 et trouvé à 12:47,
prépare des copies GPU vers CPU plus tôt et déplace leur attente vers le
lecteur. La première copie amont séparée compile et passe 1 123 tests ;
quatre tests réseau sont ignorés. Cette construction précède la composition
avec #874 et ne mesure pas encore sa cadence.
La composition reproduit ensuite une vraie divergence mémoire, 73 au lieu
de 5, entre les caches de requêtes, clôtures et tampons. Exclure aussi les
publications immédiates des rapports différés la corrige. Les 68 cas ciblés
passent, quatre mutations échouent ; la construction complète passe 1 140
tests, quatre sont ignorés sans réseau. Après une première qualification
refusée pour rapports de descripteurs filtrés, le contrôle en mouvement
vérifie 102 313 téléchargements et 204 800 descripteurs sans désaccord ni
octet attendu manquant. Les octets réécrits exclus restent comptés à part.
Les quatre passages sans sondes donnent 24,85/19,46/23,22/19,81 images/s,
nouvelle base et témoin alternés, à caches privés identiques restaurés.
Le total donne 24,17 contre 19,69, soit +22,74 % observés, avec couverture
inégale. Les marches et arrêts sont normaux. Une capture montre un bonnet
dressé et étiré ; une ancienne image a déjà une autre forme allongée, sans
prouver la même anomalie ni une régression. Le rendu reste à qualifier.
Aucun 30 images/s ni changement de moteur installé n'est démontré.
Le rapport est `spikes/switch2-room/readback-2026-11-09.json`.
Un profil distinct du nouveau binaire couvre ensuite tous ses fils pendant
24,46 secondes de mouvement : 12 419 échantillons, aucune perte signalée.
Environ 66,5 % des cycles échantillonnés viennent des six cœurs invités,
18,4 % de GPUBack, 8,6 % de l'avant et 4,6 % du travailleur Vulkan. La pile
et le coût des passages par le noyau restent à analyser ; ces parts ne
désignent pas à elles seules le chemin critique ni une limite matérielle.
Le rapport agrégé est `spikes/switch2-room/readback-cpu-profile-2026-11-09.json`.
La relecture montre toutefois 75,26 % de cycles sans chaîne DWARF exploitable,
dont 89,83 % sur GPUBack. Une attente active de cœur invité est réellement
atteinte, sans expliquer tous les cycles noyau. Le réglage existant de cette
attente est ensuite comparé à 0/100/0/100 microsecondes, même binaire,
caches restaurés, valeur mise en cache lue avant chaque phase puis débogueur
détaché. Les résultats donnent 25,82/25,02/25,65/24,57 images/s, soit 25,74
contre 24,79 au total et +3,81 % observés. Les marches et arrêts sont normaux,
le défaut de bonnet reste présent dans les deux conditions, et zéro reste
réservé au laboratoire. Rapport : `spikes/switch2-room/idle-spin-2026-11-09.json`.
La capture à pile plus longue ne résout pas l'attribution de GPUBack et GPU ;
elle signale aussi la perte d'un bloc et ne sert pas de mesure de cadence.
La révision Lichii `0ab7736`, avec cache de shaders V2, passe 1 160 tests
généraux et ses deux nouvelles suites. Sa migration atteint Kokiri et les
contrôles de lectures restent sans divergence. Le premier redémarrage chaud
reste noir ; un essai retirant seulement les binaires du pilote atteint la
scène et donne 25,99 images/s, avec marche et arrêt normal. Ce résultat
isolé ne prouve ni gain causal ni cause du noir. La version reste non qualifiée.
Rapport : `spikes/switch2-room/cache-v2-2026-11-09.json`.
Le profil non précis conserve ensuite 1 801 échantillons sans perte mais ne
répare pas les chaînes complètes. Une récupération ciblée des premiers
retours désigne l'attente de `DmaPusher::Step`, justement modifiée par
`1a5e995`, fusionné à 16 h 03. Son port sélectif sur le candidat `0b83798`
corrigé passe 1 145 tests, sans cache V2 et en mode 1. Le contrôle de
sélection des écrivains passe ses huit cas ; l'ancien helper et deux mutants
échouent comme attendu. Le diagnostic réel vérifie 101 614 téléchargements
et 208 896 descripteurs sans divergence. Les quatre phases alternées donnent
26,94/26,26/26,97/26,12 images/s, soit 26,96 contre 26,19 au total et
+2,93 % observés. Les quatre marches et arrêts sont normaux. Le port reste
isolé, sous 30 images/s constantes, avec la limite de fidélité précédente.
Rapport : `spikes/switch2-room/macro-back-2026-11-09.json`.
Le port précis #1059 conserve ensuite la garde de reprise et compare les
petits tampons contigus à leur emplacement. Ses tests ciblés et deux mutants
de cohérence sont vérifiés ; la construction complète passe 1 148 tests.
Le diagnostic réel vérifie 97 774 téléchargements et 210 944 descripteurs
sans divergence. Les quatre phases donnent 26,60/26,65/27,25/26,94 images/s,
soit 26,92 contre 26,80 au total, +0,47 % observés. Les couples évoluent
en sens opposés ; aucun gain utile répété n'est retenu. Le port reste un
prototype et #1056 reste la référence. Rapport :
`spikes/switch2-room/uniform-span-2026-11-09.json`.
La suite prépare le mode 2 avec une politique privée d'acquisition `Reference`,
qui conserve l'attente du fil arrière et la lecture du miroir. Deux cas
intégrés relient les vraies publications et requêtes au lecteur de commandes :
107 assertions passent ; l'ancien code et quatre mutations échouent comme
attendu. Les 86 cas de régression sous cette politique passent aussi.
Les achèvements matériels restent simulés : cela autorise une construction
fraîche et un diagnostic en jeu. Ce dernier vérifie 111 405 téléchargements
et 230 400 descripteurs sans divergence, mais seize avertissements de mémoire
miroir des registres refusent la qualification du mode 2. Leur plafond cache
les éventuels avertissements suivants ; le résumé des registres ordinaires
à zéro ne prouve pas leur absence. Arrêt normal, aucune comparaison de FPS
acceptée. Rapport : `spikes/switch2-room/reference-acquire-2026-11-09.json`.
Le test ciblé reproduit ensuite une erreur du vérificateur : il compare
le miroir avant les écritures encore en attente, puis peut rétablir une
ancienne valeur. Le correctif calcule le miroir attendu sans forcer ces
écritures et conserve des totaux non plafonnés pour chaque classe d'écart.
Les cinq mutations sont détectées ; 1 149 tests et 87 régressions passent,
ainsi que le test séparé du vrai journal. Cela ne démontre pas encore que
tous les avertissements observés viennent de ce défaut. Le nouveau contrôle
en jeu reste nécessaire avant toute comparaison du mode 2.
Il passe ensuite sur le candidat reconstruit : 117 940 téléchargements,
239 616 descripteurs et 17 472 contrôles de registres pendant les mouvements,
sans divergence. Les 346 résumés depuis le chargement gardent les trois
totaux à zéro, avec arrêt normal. Les quatre passages alternés sans sondes
donnent ensuite 29,84/26,18/29,76/26,32 images/s pour les modes 2/1/2/1,
soit 29,80 contre 26,24 au total et +13,57 % observés. Les deux couples
vont dans le même sens, avec une couverture inégale de 4 800 contre 3 000
présentations et des durées de préparation différentes. Les vingt-quatre
images sont lues, les marches et arrêts sont normaux, sans intervalle retenu
au-delà de 100 ms. La pire image du mode 2 prend 66,34 ms : 30 images/s
constantes restent non atteintes. Le candidat reste isolé, avec la même
limite `NO_MESH=1`, sans qualification complète du son, des zones et des
sauvegardes. Rapport : `spikes/switch2-room/front-shadow-verify-2026-11-09.json`.
Le relevé séparé sans vérificateur observe ensuite un fil arrière occupé
à environ 84 % d'un cœur et 183,78 ms par seconde écoulées dans la
préparation des tampons. Ces zones instrumentées ne sont pas un budget
physique exclusif. La piste naïve de contrôles espacés est écartée après
lecture de l'ordonnanceur, car elle peut empêcher le progrès ou manquer
une valeur CPU temporaire. La suite réévalue le port #1059 sur cette base
en mode 2, sans réutiliser son ancien résultat de mode 1 comme prédiction.
Rapport : `spikes/switch2-room/reference-cost-2026-11-09.json`.
La variante combinée #1059 passe ensuite 1 152 tests, les 87 régressions
et le test séparé du journal. Son diagnostic en mode 2 observe les deux
chemins et vérifie 111 689 téléchargements, 247 808 descripteurs et
17 984 contrôles de registres sans divergence, avec arrêt normal.
Les quatre passages sans sondes donnent ensuite 30,63/29,71/30,65/30,38
images/s, soit 30,64 contre 30,04 au total et +1,99 % observés. Les couples
vont dans le même sens, mais préparations et durées couvertes diffèrent,
avec trois lancements exclus avant mesure. Les vingt-quatre images sont
lues et les quatre marches et arrêts sont normaux. Le maximum avec le port
reste 55,38 ms : 30 images/s constantes ne sont pas prouvées. Cette variante
devient la base isolée ; aucune nouvelle version n'est installée.
Rapport : `spikes/switch2-room/uniform-span-mode2-2026-11-09.json`.
La revue confirme FPS Unlock et Max Resolution actifs, sans génération
d'images. Elle reproduit aussi un biais commun d'environ 0,17 % du compteur
historique, qui divise 600 intervalles par 599 après sa première fenêtre.
Les valeurs historiques restent conservées ; la correction du compteur
et une sonde de régularité sont ensuite construites. Les demandes de présentation
ne prouvent pas des contenus tous distincts ni la vitesse de toute la logique.
Les 1 157 tests passent, ainsi que les 87 régressions et le contrôle séparé
du journal. Le diagnostic réel de caméra conserve 2 400 intervalles,
dont 728 au-delà de 33,333333 ms, soit 30,33 %, aucun au-delà de 100 ms.
Le maximum vaut 58,10 ms ; les percentiles 99 par fenêtre vont de 47,13
à 54,45 ms. Les bornes utilisent une horloge monotone commune vérifiée,
sans moyenne de percentiles. La marche courte est contrôlée séparément,
pas sa distribution sur un long trajet. L'arrêt est normal et la production
reste inchangée : `spikes/switch2-room/present-pacing-2026-11-09.json`.
La vérification amont de 18 h 07 trouve aussi les ports FSR pour Zelda et
le nouveau cumul de couches de textures. Ils restent des options distinctes,
sans mesure locale de gain :
`spikes/switch2-room/upstream-refresh-1807-2026-11-09.json`.
La revue de 20 h 21 vérifie aussi Lichii `cb5c5c7c` et Superbuild v37.
Le port privé #1095 des écritures de registres est préparé et reste à
qualifier. La suppression d'attente de #1094 garde une hypothèse non
protégée dans ce port ; elle n'est pas adoptée telle quelle. Les modèles
de clôtures et de plages de Dolphin, PCSX2 et Ryubing guident cette revue,
sans gain transférable présumé. Le FSR 4 officiel vise maintenant Windows,
pas le serveur Linux :
`spikes/switch2-room/upstream-refresh-2021-2026-11-09.json`.
Le chemin mesh par calcul GPU déjà présent est ensuite exercé sur la base
qualifiée, avec `NO_MESH` absent. Il dessine des groupes et rétablit
visiblement des fleurs et du feuillage, sans nouveau message noyau GPU/reset
dans ce contrôle court. Le trajet dérive toutefois vers un obstacle puis
une échelle. Il ne qualifie pas une longue marche : les huit intervalles
au-delà de 100 ms, maximum 1,677 seconde, appartiennent à une phase mixte
avec captures répétées. Aucun gain comparatif n'est retenu. Arrêt et nettoyage
sont normaux : `spikes/switch2-room/mesh-fallback-2026-11-09.json`.
Le port ciblé #1095 est ensuite construit complètement. Les 1 159 tests,
les 87 régressions et les contrôles séparés passent ; l'activation est
vérifiée dans le vrai exécutable de tests avec cinq conditions négatives.
Le diagnostic GPU combiné passe ensuite sans profilage qui désactiverait
la nouvelle branche : 103 003 téléchargements, 205 824 descripteurs et
14 784 contrôles de registres sans divergence, avec maillages dessinés,
trois images lues et arrêt normal. Les quatre phases donnent ensuite
30,17 / 29,59 / 29,45 / 29,47 images/s, soit 29,806 contre 29,519 au
total et +0,97 % observé. Les couples sont à +1,97 % puis -0,06 % :
aucun gain stable n'est retenu. Les douze images, soixante contrôles de
charge et quatre arrêts sont vérifiés ; les maxima dépassent encore le
budget de 30 FPS. La base avec compteur corrigé et maillages par calcul
reste la référence privée. La CI, les préparations et les couvertures
inégales limitent cette comparaison :
`spikes/switch2-room/state-write-2026-11-09.json`.
La première tentative de série avait été refusée avant lancement par une
CI, puis un passage avait été interrompu par un nouveau travail. Le garde
vérifie désormais les files de tous les runners locaux avant chaque essai.
La revue de 21 h 03 confirme également
la publication Superbuild v38, avec #1094 et #1095 encore ouvertes,
sans changer les deux exécutables de comparaison figés :
`spikes/switch2-room/upstream-refresh-2103-2026-11-09.json`.
Deux contrôles tracés prouvent ensuite que désactiver Max Resolution
réduit réellement le rendu 3D échantillonné de 2 560 × 1 440 à
1 920 × 1 080, tandis que certaines sorties restent en 1440p.
FPS Unlock reste appliqué et seules les trois clefs de désactivation changent.
Les traces ne servent pas à annoncer des FPS. Le petit aller-retour ZL
ne prouve pas un parcours reproductible ; les deux arrêts et le nettoyage
sont normaux. La suite mesure les intervalles sur quatre passages alternés,
avec les mêmes caches chauffés pour les deux résolutions :
`spikes/switch2-room/max-resolution-2026-11-09.json`.
Les quatre passages donnent ensuite 30,73 / 29,60 / 29,28 / 29,38
présentations/s, soit 30,090 contre 29,507 au total. Les couples sont
à +3,79 % puis -0,33 % : aucun gain stable n'est retenu. En résolution
dynamique, 32,24 % des intervalles dépassent encore 33,333333 ms,
contre 33,50 % avec le témoin ; les maxima sont 76,32 et 61,36 ms.
Les douze images, soixante contrôles et quatre arrêts sont normaux.
La référence privée reste en pleine résolution ; la suite contrôle
séparément l'option existante « No sharpening », avec son compromis visuel.
Le contrôle isolé de NoSharpening prouve une copie en 1440p et donne
32,16 présentations/s sur deux fenêtres complètes, avec 21,75 %
d'intervalles au-delà du budget de 30 FPS. Ce n'est pas un gain causal ;
la comparaison alternée reste à faire. Arrêt et nettoyage sont normaux :
`spikes/switch2-room/no-sharpening-2026-11-09.json`.
La comparaison NoSharpening se termine ensuite à 32,056 contre 29,730
présentations/s, +7,82 % observé. Les couples restent positifs à +4,44 %
et +11,34 %, avec un effet variable. L'option est retenue comme candidate
privée avec compromis visuel. Les dépassements du budget diminuent de
32,38 % à 23,21 %, mais un gel dépasse 100 ms dans chaque variante.
Les douze images, soixante contrôles et quatre arrêts sont vérifiés.
La normalisation du champ « valeur par défaut » explique la seconde clef
INI différente ; un seul réglage effectif change. La suite teste le plafond
de présentation à 30 sans changer l'horloge à 60 ni la vitesse à 100 %.
Le contrôle du plafond à 30 confirme ensuite son activation avec vblank60,
vitesse100 et mot natif inchangés : 29,956 présentations/s, mais des p99
par fenêtre entre 44,22 et 47,62 ms. Il ne stabilise donc pas les intervalles.
L'arrêt et le nettoyage sont normaux. La suite distingue les réveils tardifs
du reste de la préparation au moyen des sondes natives de temporisation :
`spikes/switch2-room/present-30-2026-11-09.json`.
La sonde HostTiming retient ensuite 88 fenêtres entièrement encadrées
dans la phase : p99 de réveil79–340µs, maxima≤2,924ms. Les présentations
restent à p99 44,53–46,14ms. Les délais de reprise du fil invité et de
sortie Vulkan restent à mesurer ; ces valeurs globales ne justifient pas
une modification d'horloge. Arrêt/nettoyage normaux :
`spikes/switch2-room/host-timing-2026-11-09.json`.
La revue suivante trouve #1143 fusionnée à22h52 sur les pointeurs perdus
après éviction d'un programme graphique. Le mécanisme existe dans notre
base, sans occurrence locale prouvée ; le correctif exige un port ciblé
et ne mesure aucun gain FPS. Aucun nouveau code n'est importé :
`spikes/switch2-room/upstream-refresh-2318-2026-11-09.json`.
Deux sondes ciblées sont ensuite autorisées sur une nouvelle copie privée :
délais du service VI2 et intervalles aux retours Vulkan acceptés, avec erreurs
et recréations séparées. La construction et la qualification restent à faire ;
aucun changement de cadence ni nouvel essai GPU n'est encore livré :
`spikes/switch2-room/service-wsi-probe-2026-11-09.json`.
Le delta des sondes est ensuite figé sur sept fichiers ; quatre cas CPU
passent646assertions et treize mutations sont détectées. Le premier build
complet révèle une collision de macroX11 absente des doubles ; le nom est
corrigé, les preuves régénérées et la construction complète reprend.
Aucun résultat GPU ni amélioration de cadence n'est encore revendiqué.
La construction complète des sondes passe ensuite, avec CLI d4480279,
1161tests réussis et4ignorés,87régressions,17assertions cachées et les
nouveaux tests. La fraîcheur des objets et l'ordre build→tests sont vérifiés.
Le contrôle réel des deux sondes reste à faire avant toute nouvelle conclusion.
Le diagnostic réel d448 passe ensuite ses activations et son nettoyage.
VI2 donne30,0012 intervalles/s etWSI29,9999 retours/s, mais les p99 restent
45,01–46,31ms et46,19–46,69ms. Les90observations de service ne montrent
que0,016–0,574ms de dépassement du sommeil demandé, sans décrire tous les
réveils. Le réglage natif de cadence Vulkan est le contrôle suivant :
`spikes/switch2-room/service-wsi-runtime-2026-11-09.json`.
La reprise du10novembre est d'abord retenue par deux nouvelles CI Souverain.
Leurs vrais jobs et les sources exactes prouvent un routage entièrement
hébergé ; le garde frais accepte uniquement ces exécutions/révision/tentative,
sans modifier ni interrompre de CI. Le contrôle FramePacing1 peut reprendre :
`spikes/switch2-room/ci-hosted-placement-2026-11-10.json`.
Le premier contrôle FramePacing1 donne ensuite29,9869 retoursVulkan/s,
p95 33,47–33,50ms etp99 33,62–36,41ms, maximum43,88ms. VI2 reste àp99
44,64–45,56ms. Le relevé est prometteur, sans comparaison causale ni
balayage physique prouvé ; quatre nouveaux passages1/0/1/0 sont préparés :
`spikes/switch2-room/host-pacing-2026-11-10.json`.
La revue du fork BC-250 écarte un rétrécissement de synchronisation
sans preuve de tous les producteurs ; le saut des dessins vides ne trouve
aucune occurrence dans ce diagnostic. Aucun code n'est importé :
`spikes/switch2-room/bc250-review-2026-11-09.json`.
Le garde de CI distingue désormais une exécution prouvée entièrement
chez GitHub d'un travail qui peut arriver sur ce serveur. Cette exception
est limitée à la révision et à la tentative vérifiées ; les cas inconnus
restent refusés, sans modifier ni interrompre de CI.
La porte locale complète, l'audit et la documentation stricte passent, sans
nouveau résultat de CI distante. La configuration installée et les huit progressions normales
sont vérifiées identiques au début de cette reprise.
Aucune nouvelle version n'est installée. Le
[plan](plan-60fps-switch2-2026-11-08.md#objectif-du-9-novembre-30-imagess-regulieres)
et `spikes/switch2-room/rc3-2026-11-09.json` conservent les preuves.

**Sonde GPU, reprise commencée le 8 novembre à 23:25 UTC et terminée le 9.**
Quatre phases alternées avec le même exécutable donnent 22,36 images/s sans
sonde et 21,75 avec, soit un écart observé de −2,74 %. La sonde reste un outil
de diagnostic, sans certification de transparence. Ses 64 captures de caméra
séparent environ 0,80 ms de transferts et 24,87 ms d'exécution principale en
médiane, avec 155 segments de soumission. Ces intervalles approximatifs ne
sont pas un budget matériel exclusif. Le contrôle de couverture force la mesure
d'un programme fréquent que la rotation avait manqué ; un autre, rare, reste
non mesuré. La piste suivante vise les nombreux petits lots, leurs dépendances
et la liaison des ressources. Aucun correctif de cadence n'est installé.
Le [plan](plan-60fps-switch2-2026-11-08.md#sonde-gpu-par-lots-du-8-au-9-novembre)
conserve les résultats. Les tests du moteur passent, quatre mutations sont
refusées ; marche, son et sauvegarde puis reprise passent. Les huit fichiers
de progression normaux sont conservés, le laboratoire est retiré et la boîte
noire est relancée. Aucun commit, envoi ou nouveau résultat de CI distante.

**Troisième prototype du 8 novembre : pas de gain à installer.** Les quatre
passages alternés en mode 0 donnent 22,37 images/s pour l'amont compilé
localement, 21,34 pour le résumé des plages mémoire, soit −4,61 %.
Le relevé séparé observe environ 139 000 demandes de synchronisation par
seconde pour 74,43 Mio/s transférés : beaucoup de demandes ne copient rien,
mais cette première façon d'éviter leur parcours coûte encore trop au total.
Les premières captures GPU sont complètes, mais trop détaillées pour attribuer
un budget exact à une image normale. Le moteur installé reste inchangé.
Le [plan vers 60 images/s](plan-60fps-switch2-2026-11-08.md#troisieme-prototype-recherches-memoire-et-commandes-gpu)
précise le résultat et les modifications suivantes avec leurs preuves attendues.
Les tests du moteur passent dans les deux configurations, 241 réussis et
quatre ignorés sans réseau ; cinq défauts réintroduits sont détectés.

## Ce que l'historique Git contient

**Switch 2 expérimentale installée le 7 novembre 2026.** Les quatre versions
Linux demandées sont téléchargées et vérifiées dans un laboratoire privé.
Deux tours alternés sur la même sauvegarde donnent environ 22 images
calculées/s pour Eglantine, 20 pour Lichii 93 et 18 pour Superbuild. La 95
passe de 14 à 20 quand la charge d'un autre projet retombe. L'extrait sonore
mesuré reste proche de l'image avec Eglantine ; les trois autres moteurs
atteignent environ 36 secondes d'avance du son. L'incertitude de 0,5 seconde
ne permet pas de revendiquer une synchronisation exacte à 40 millisecondes.
Le raccordement réel vérifie un joueur, deux spectateurs, le refus d'une
deuxième manette, les commandes dans Zelda, le passage maison/forêt et une
nouvelle sauvegarde reprise après arrêt complet. Le lanceur passe aussi de
la place 3 à l'unique place 1. Le contournement AMD supprime certains objets
pour éviter le chemin qui a redémarré le GPU au premier essai 3D. Ce résultat
ne prouve pas une partie complète satisfaisante. Seul Zelda est inscrit ;
Mario Tennis Fever est extrait mais reste non validé. Les parties de
laboratoire ne sont pas importées dans la progression normale.
L'[étude Switch 2](etude-switch2-2026-11-07.md) conserve les versions, les
conditions, les mesures et leurs limites.
Le retour de partie du soir confirme des gels du moteur et révèle que la boîte
noire ne reconnaissait pas `eden-cli`. La correction détecte le jeu, interdit
les lectures d'allocateur GPU pendant la partie et permet sa capture d'écran
en cas de chute. Les tests échouent avant correction et par réintroduction des
défauts. Tennis Fever atteint un match complet, mais présente des disparitions
de Mario et deux sorties 139 avec et sans le contournement du maillage.
Il reste hors du catalogue. Les résultats de cette reprise sont dans la même
étude datée ; ils ne valident pas une partie stable de Tennis.
Quatre passages alternés avec et sans synchronisation réactive retrouvent
22,5 à 22,7 images/s dans Kokiri. Aucun gain de cadence n'est observé ; ce
réglage de rendu installé reste inchangé. Ces essais ne reproduisent pas tous
les chargements de zones nouvelles signalés par Souhib.
La porte locale complète `just`, les commandes Switch, l'audit et la
documentation stricte passent. La page installée et le catalogue sont relus
par le proxy habituel, y compris avec un cookie de 16 Ko. Aucun nouveau
résultat de CI distante n'est revendiqué sans commit ni envoi.

**Reprise du 8 novembre : PGO et Lichii 117.** Deux tours alternés sur le même
passage de Kokiri donnent 22,68 images/s avec le paquet standard d'Eglantine
et 23,96 avec son paquet PGO officiel, soit 5,7 % de plus. Le son reste proche
de l'image sur neuf points reconnus de la cinématique. Mais un arrêt après
reprise de sauvegarde quitte avec le code 139 ; deux contrôles supplémentaires,
standard puis PGO, ne le reproduisent pas. La cause reste inconnue. Le gain
modeste ne justifie pas de remplacer le paquet installé avec cette incertitude :
**la salle conserve Eglantine standard**, sans modification de sa configuration
ni de la progression de Souhib. Lichii 117 PGO et standard restent bloqués avant
le menu sur notre configuration avec `NO_MESH=1`. Aucun gain ni comportement
correct de son Dynamic FPS n'est revendiqué. L'étude précise aussi une limite
du pilote de sauvegarde : ses captures nommées « house » montrent encore
Kokiri, donc elles prouvent une reprise de position, pas un changement de zone.
Les données de cette reprise sont conservées dans `pgo-2026-11-08.json`,
`lichii-117-2026-11-08.json`, `audio-2026-11-08.json` et
`followup-2026-11-08.json`, sous `spikes/switch2-room/`.
La porte locale complète `just` et l'audit passent à nouveau le 8 novembre.
La boîte noire est relancée après les mesures ; les conteneurs de laboratoire
sont supprimés. Aucun paquet de moteur n'est remplacé et aucune nouvelle CI
distante n'est revendiquée.

**Suite du 8 novembre après 02:00 UTC : Eglantine expérimental et Orchid.**
La branche Eglantine `eab2c2246d` en paquet PGO atteint 23,90 images/s contre
22,97 pour le standard installé, dans deux tours alternés sur Kokiri. Ses cinq
arrêts observés sont normaux, dont l'écriture et la reprise d'une sauvegarde.
Le son reste proche de l'image sur dix points reconnus. Cela ne prouve pas
la disparition du plantage rare du premier PGO ni une partie entière stable.
Un message de journal en retard de sept secondes avait inclus de la
préparation dans une phase ; la sélection est corrigée avant cette comparaison.
Les fenêtres de la première reprise PGO restent valides après relecture.

Orchid 0.9.0 standard termine deux matchs de Tennis Fever contre Harmonie puis
Kamek, sur gazon, avec les résultats 0–7 relus à l'écran. Les deux fermetures
et le redémarrage sont normaux. La portion mesurée du premier match atteint
45,5 images/s, avec des attentes entre points, et un signal stéréo est émis.
Des défauts visuels ponctuels et des glyphes incomplets restent observés.
Cela ne valide ni les autres courts, ni plusieurs joueurs, ni le transport
vers le navigateur avec Orchid. Le profil graphique utilisé diffère du profil
Eglantine imposé par l'adaptateur actuel. **Aucun moteur installé n'est
remplacé et Tennis reste hors du catalogue** après ces essais demandés.
L'étude conserve les conditions ; les trois nouveaux rapports portent les
préfixes `experimental`, `experimental-validation` et `orchid`.
La porte locale complète et l'audit passent après cette suite. Le laboratoire
est nettoyé, la boîte noire est relancée, la configuration installée et les
empreintes de progression habituelles restent identiques à celles du départ.

**Contrôle d'Orchid sur Zelda, le 8 novembre après 11:20 UTC.**
Trois lancements du paquet standard 0.9.0 chargent une copie de la sauvegarde
de Kokiri et reçoivent des commandes de déplacement. Les cœurs et la carte
apparaissent, mais le monde reste noir ou flou et Link n'est pas correctement
dessiné, y compris sans les variables de contournement Eglantine. Des
programmes graphiques sont refusés par le traducteur ; deux minutes après
l'apparition de l'interface, le dernier essai garde le même défaut. Aucune
cadence jouable n'est retenue et le succès de Tennis ne valide pas Zelda.
Le premier arrêt est forcé, les deux suivants sont normaux. Le rapport
`spikes/switch2-room/orchid-zelda-2026-11-08.json` conserve ces trois essais.
Un contrôle Eglantine standard rend la même sauvegarde avec Link et la forêt
visibles, confirme les commandes sur le balcon et l'échelle, puis ferme
normalement. Ce contrôle ne classe pas les vitesses. La configuration et les
empreintes de progression habituelles restent identiques ; les conteneurs et
manettes du laboratoire sont supprimés et la boîte noire est relancée.

**Profilage et parallélisme Zelda, le 8 novembre après 12:25 UTC.**
Un premier relevé est qualifié après la découverte d'une CI de navigateurs
d'un autre projet. Souhib demande d'attendre sa fin. Le profil repris ensuite
sans CI place le fil de préparation graphique à 94 % d'un processeur logique.
Le traitement des méthodes, les macros et la liaison des tampons sont ses
principaux coûts mesurés. Sept phases alternent les modes 0, 1 et 2 sur la même
sauvegarde de Kokiri : les cadences regroupées sont 20,64, 20,61 et 20,72
images/s. Aucun gain net n'est observé ; les sept fermetures sont normales.
Le mode 0 installé est conservé. Le CPU reste autour de 96 °C pendant les
comparaisons : le refroidissement est aussi à contrôler, sans gain attribué
à ce seul constat. Le rapport `spikes/switch2-room/split-2026-11-08.json`
et l'étude conservent les fenêtres, les conditions et les limites.
Un profil séparé du mode 2 montre le fil avant en attente active pendant
56 % de son temps, tout en consommant 93 % d'un processeur logique. Réduire
ce coût de coordination est alors une cible précise à étudier. L'expérience
suivante en donne le résultat compilé et mesuré. La configuration installée
et les quatre empreintes de progression habituelles restent identiques. Le laboratoire est nettoyé et
la boîte noire est relancée.

**Plan vers 60 images/s, reprise du 8 novembre après 14:00 UTC.**
Le [plan détaillé](plan-60fps-switch2-2026-11-08.md) distingue le coût
mesuré de la préparation graphique, l'attente active du mode 2, la chaleur
et les chargements de zones encore à instrumenter. Il fixe les expériences
et les preuves attendues, sans promettre que ce serveur atteindra 60.
Le correctif est compilé et comparé sur quatre phases alternées. Il ramène
le CPU du fil avant de 80,46 à 36,86 % d'un processeur logique, mais la cadence
regroupée baisse de 21,28 à 20,71 images/s. Il reste au laboratoire. Quatre
autres phases à résolution normale puis réduite donnent 21,68 et 21,63 images/s,
sans gain observé. Le profil avec symboles cible maintenant les lectures
d'arguments de `FrontDmaRead`, principales origines des attentes dans `Drain`,
et la liaison des tampons sur le fil arrière.
La marche au sol, une sauvegarde privée et sa reprise après arrêt complet
passent. Le contrôle de cinématique reconnaît douze points son/image sur 85 secondes,
sans dérive importante à son incertitude de 0,5 seconde. Il ne prouve pas une
synchronisation à 40 ms. Le boost CPU est déjà activé.
Le pilote standard de la carte mère expose deux ventilateurs qui tournent,
sans identifier le connecteur CPU ni le modèle du refroidisseur. La cause
thermique d'une baisse de fréquence n'est pas prouvée.
Les tests isolés échouent par réintroduction de l'attente active et d'une
notification perdue. Les 239 tests de la compilation corrigée passent ;
quatre tests réseau sont ignorés dans le conteneur isolé. Un premier
exécutable mal reconstruit est exclu : la preuve d'activation et le code
machine sont ensuite vérifiés. Un chargement de la référence non modifiée
a aussi quitté sur une allocation Vulkan impossible, non reproduite au
contrôle suivant. Aucune correction de ce défaut n'est revendiquée.
Le rapport `spikes/switch2-room/drain-2026-11-08.json` et le plan conservent
ces conditions. Le moteur de la salle et les sauvegardes habituelles restent
inchangés.

**Second prototype de lecture des arguments, le 8 novembre.**
La sonde trouve 845 091 lectures sur 50,02 secondes sans téléchargement
GPU requis dans Kokiri. Attendre les commandes précédentes sans demander
aussi le repos du gestionnaire graphique donne 22,13 contre 22,51 images/s
sur quatre phases alternées, soit +1,70 % observé. La charge du fil avant
reste vers 80 % d'un processeur logique. La couverture des fenêtres est
inégale et ce petit essai n'établit pas un gain important ; le prototype
reste isolé et le moteur installé garde le mode 0.
Le profil séparé montre encore 51,5 % des cycles échantillonnés du fil avant
dans l'attente des commandes. La liaison et la synchronisation des tampons
restent des cibles du fil arrière. Le [plan](plan-60fps-switch2-2026-11-08.md)
précise les dépendances à suivre et les mesures GPU encore manquantes.
La marche au sol, la sauvegarde et sa reprise passent. Les 240 tests du
moteur passent, avec quatre tests réseau ignorés. Un premier démarrage
du témoin échoue sur une allocation Vulkan ; aucun correctif de ce défaut
n'est revendiqué. Le rapport `spikes/switch2-room/mme-snapshot-2026-11-08.json`
conserve les limites. Le laboratoire est nettoyé, la boîte noire est
relancée, la configuration et les quatre fichiers de progression habituels
restent identiques. Aucun commit ni envoi n'est créé.

**Incident du 16 octobre 2026 : page blanche à l'ouverture d'une salle.**
Le worker ne lisait que 2 Kio de la requête avant de répondre. Avec des cookies
plus longs, la fermeture coupait la page pendant son transfert par Caddy.
La correction lit les en-têtes complets, y compris pour reconnaître les
connexions de jeu et vérifier leur origine. Les essais reproduisent la coupure
sur une connexion locale et vérifient aussi les requêtes fragmentées.
Installée le 16 octobre à 19:29 UTC, la correction est vérifiée sur le site
dans Firefox et Chrome avec un cookie long, jusqu'à la prise d'une manette.
Le contrôle de déploiement restait rouge pour un import documentaire préexistant
dans le Caddy installé, absent de sa copie dans le dépôt. Le 7 novembre,
la copie du dépôt reprend les imports installés des trois autres applications,
sans modifier leur configuration en service.
Le [carnet](carnet-de-bord.md#la-page-blanche-et-les-cookies-le-16-octobre)
conserve les mesures et la validation de la version servie.

La lecture du dépôt le 9 septembre retrouve `16eebcb`, du 5 septembre, comme
dernier commit. Les changements de cette conversation sont encore dans l'arbre
de travail, avec des fichiers modifiés et de nouveaux fichiers non suivis.
Certains ont déjà été déployés sur la machine, comme le raconte le carnet.
Un fichier non commité n'est donc pas nécessairement un prototype non utilisé.

Lire les commits seuls manquerait le nouveau protocole de places, la préparation,
les clips sonores et l'intégration Switch. Ce suivi croise les commits, les
sources présentes, les comptes rendus d'essais et les retours de Souhib. Aucun
commit ni envoi vers GitHub n'est créé par cette mise à jour documentaire.

## Ce qui fonctionne et où le retrouver

| Sujet | État au 9 septembre | Raisonnement et preuves |
|---|---|---|
| Audit initial | Relecture indépendante, corrections ciblées et questions encore ouvertes. Aucun total « tout corrigé » n'est revendiqué. | [Audit du 6 septembre](audit-2026-09-06.md), avec ses étapes datées. |
| Noms et places | Le worker donne un reçu à chaque attribution. Le salon associe un nom seulement au reçu confirmé. Une réponse manquante conserve la dernière lecture complète ; elle ne signifie pas que les quatre prises sont libres. | ADR D16 ; carnet, « Des joueurs rangés parmi les spectateurs ». Départs, retours, annonces anciennes et changement de processus exercés. |
| Chef et spectateurs | Couronne, liste des spectateurs et état d'attribution en attente distincts. Reprendre le rôle ou une manette demande une action explicite, une possibilité de réponse et une confirmation. | ADR D19 ; carnet, « Un chef connecté qui n'est plus devant son écran ». Le délai seul ne transfère rien. |
| Préparation du jeu | Avant Wii ou Switch, chaque place prépare son appareil et confirme. Le lanceur confirme ensuite pour tous. GameCube conserve son seul appareil et son lancement direct. | ADR D17 et intégration Switch ; configurations Wii mixtes jouées avec Dolphin dans une salle isolée. |
| Touches et manettes | Dessins physiques reconnus, clavier vers commande émulée, flèches assignables au stick, apprentissage visible et entrées neutres pendant les réglages. Les correspondances sont ouvertes sur une colonne ; le diagnostic brut reste fermé. | [Note du configurateur](ecran-manettes.md), essais de capture, profils et trois styles de menu. |
| Profils | Charger et enregistrer une configuration personnelle, conserver les modifications en attente quand le salon tombe. Dolphin permet aussi de proposer un profil pour un jeu ; les profils Switch se chargent manuellement. Un chargement ne valide jamais « prêt » à la place du joueur. | Note du configurateur ; ADR « Media and personal game profiles » et « Switch room integration ». |
| Branchement et diagnostic | Messages de branchement qui disparaissent après cinq secondes. Diagnostic du lecteur, trajet Tailscale observé quand disponible, signalement confirmé par le salon. | Carnet des 6 et 7 septembre. Le trajet réseau est un indice ; il ne désigne pas automatiquement la cause d'une saccade. |
| Fermer le jeu | Le chef peut fermer la partie et laisser le catalogue ouvert. Redémarrer une salle volontairement vide ne relance pas le dernier jeu. | ADR D18 ; essai réel de fermeture, arrivée d'un spectateur et lancement suivant. |
| Arrêt et reprise Dolphin | Arrêt coopératif, réveil avant fermeture, nettoyage de son propre orphelin avant le contrôle du tuyau audio, silence éveillé borné. | ADR D20 ; arrêt éveillé/en pause, producteur muet et conteneur orphelin reproduits dans une salle séparée. |
| Vidéo et son | Premier décodeur muet surveillé, capacité du demi-format relue, recadrage H.264 compatible avec le demi-format Wii, estimation son/image fondée sur les horaires complets. | Carnet du 7 septembre ; tests de décodeur, conversion GPU et décodage des bords. L'estimation n'est pas une mesure physique chez le joueur. |
| Clips | Vidéo et son sont conservés ensemble ; l'export MP4 encode une piste AAC. Le test décode un signal stéréo connu et refuse les variantes muettes. | Carnet, « Le clip avait une image et aucun son » ; `just clip-audio-test`. |
| Accès des amis | `nel3ab.app` sur TCP 443 montre la LISTE des salles depuis le 12 septembre, et la porte de secours `.ts.net:8443` est admise par le salon. L'autorisation Tailscale manquante pour 443 a été diagnostiquée ; Souhib confirme ensuite l'accès des amis. | Carnet du 6 septembre ; exemple d'autorisation dans `deploy/tailscale-nel3ab.grant.json`. Le domaine ne rend pas la salle publique. |
| Switch | Manette Pro par place, préparation et profils personnels, plein/demi-format, capture récupérable, son et clips, sauvegardes distinctes par titre. Une livraison de vibration refusée laisse les quatre manettes répondre. | [Utilisation et sauvegardes Switch](switch-room.md), [étude et mesures](etude-switch-2026-09-07.md), carnet des 8 et 9 septembre. |
| Interface | Revue complète le 12 septembre 2026 : 106 constats relevés écran par écran, triés par trois vérificateurs indépendants. Livrés : Espace qui lançait un jeu que le curseur ne désignait pas, écran noir sans aucune commande après « choisir un jeu », chargement sans porte de sortie et dont les étapes reculaient, alarme de panne affichée à chaque arrivée normale, préparation dont un non-initiateur ne pouvait plus sortir, boutons de reprise indistinguables et désormais répondables à la manette, salon au contraste AA avec sa liste mise à jour au lieu d'être refaite, opacités remplacées par des encres mesurées, rang et total écrits sur le rayon du menu XMB, sticks tactiles Switch devenus proportionnels et leurs cibles portées à 44 px de haut, préparation centrée et bornée, cartes du salon qui nomment les présents. Le 12 septembre au soir, la page d'accueil est refaite: identité de régie à trois canaux, mire EBU en écran vide, horloge de dernier relevé, et deux polices libres auto-hébergées (26 940 octets sous-ensemblés). Trois constats ont été rejetés sur mesure plutôt qu'appliqués. | Carnet, « Une revue de toute l'interface » et les quatre entrées qui suivent ; `just salon-reconciliation`, `just browser-contraste` (24 écrans, sept ambiances) ; 517 essais front, 253 essais salon. **Les paliers de texte s'appliquent enfin partout depuis le 13 septembre 2026** : `cn` rangeait `text-note` et ses voisins avec les couleurs, donc un palier accompagné d'une couleur disparaissait et le texte retombait à 16 px (19 appels sur 45). La couronne du chef quitte aussi le cadre qui tronquait le nom sous la prise. **La colonne de droite se règle depuis le 13 septembre 2026** : tirée par son bord gauche ou réglée dans le menu, entre 256 et 480 px et jamais plus de la moitié de la fenêtre, retenue par navigateur. La borne basse est mesurée (rien ne sort de la colonne à 256 px, un nombre en sort à 240) et remesurée par `just browser-colonne`, qui joue un faux jeu en manette seule parce qu'une salle sans jeu recouvre la colonne. Une première borne à 272 px reposait sur un relevé de nom pris quand `cn` gonflait le texte. Non vérifié sur téléphone ni avec des noms de joueurs réels. **Au 22 novembre 2026**, en service à 14 h 36 UTC, une seconde analyse sous six angles (113 constats, dont 10 critiques) a mené à une régie commune à la salle et au salon, à la manette tactile placée par le calcul, à un état de liaison qui dit l'image figée, au clavier dans la zone de jeu avec des menus modaux, à un lexique tenu par un essai et à la salle au doigt : paragraphe du 22 novembre en tête, ADR D26 et D28 à D35. |
| Boîte noire des parties | Depuis le 14 septembre 2026, `nel3ab-boite-noire.service` relève la machine toutes les 2 s pendant une partie et toutes les 60 s au repos, suit la cadence des pages dans le journal du salon, et capture un profil `perf` quand une salle reste sous 50 images/s pendant 30 s, ainsi que toutes les 10 minutes de partie. Sept jours gardés, relus par `just boite-noire`. Coût mesuré : 0,5 à 1 % d'un cœur en partie, environ 7,5 Mo par heure hors captures. Les fichiers debugfs de l'allocateur ne sont plus lus pendant une partie : chaque lecture arrêtait l'image environ 100 ms. Au second banc, 0 trou de plus de 33 ms avec captures périodiques et chute. Non mesuré sur Dolphin ni sur une soirée entière. Premier signalement traité par elle le 16 septembre 2026 (mini-freezes Mario Tennis): l'émulateur s'arrête 0,7 à 1,2 s toutes les deux minutes et demie pendant que ses fils de chargement travaillent, la chaîne est hors de cause, et elle n'avait rien capturé parce que la médiane de cadence ne bouge pas sur un trou d'une seconde ; une règle de gel (écart reçu de plus de 500 ms) a été ajoutée et a capturé trois gels toute seule le soir même. Débrider le GPU est ÉCARTÉ par la mesure: quatre phases alternées de trois minutes le 16 septembre 2026 donnent neuf gels d'environ 1,17 s en `profile_peak` contre zéro en `auto`, pour 100 W contre 24 ; `high` ne change même pas l'horloge. Reste non expliqué: pourquoi un GPU plus rapide gèle. Depuis la nuit du 17 septembre 2026, une chute emporte le profil des secondes qui la PRÉCÈDENT (`perf` en tampon circulaire, vérifié en service: 3 669 échantillons sur 37,5 s), le journal du conteneur de l'émulateur et deux compteurs de l'ordonnanceur GPU ; la page repropose le format réduit quand une liaison s'effondre et le salon écrit proposition, acceptation et refus. Préparés mais NON mesurés: `backend_threading: On` pour Ryujinx, et un `cpuset` éteint par défaut pour le conteneur du jeu. Depuis le 14 septembre 2026 également, chaque page ajoute à son relevé de dix secondes l'écart entre images reçues, l'aller-retour et le nom de sa manette et le temps passé onglet caché, et envoie son appareil une fois à l'arrivée ; environ 136 octets de plus par relevé. Vérifié par `journal.mjs` à travers le proxy (Chrome sans écran, onglet caché 7 004 ms, 7 016 ms écrits). | ADR D21 ; carnet, « Une boîte noire pour les parties, et les lectures qui arrêtaient l'image » et « Ce que chaque page ajoute à la boîte noire » ; `control/nel3ab_control/boite_noire/`. Depuis le 14 novembre 2026, le seuil de chute suit le plafond du jeu : un jeu de la table `boite_noire_plafonds` (Zelda sur Switch 2, 30) chute sous 0,9 fois son plafond, les autres sous 50 ; rejoué sur les mesures réelles des 10 et 11 novembre, plus aucune capture à médiane 30 et la chute du 11 est prise. Le profileur roulant ne suit plus le moteur Switch 2, à qui il coûtait 2,5 à 3,0 % sur le fil qui borne sa cadence. Restent connus : le démarrage du moteur et un onglet caché comptent encore comme des gels. |

La connexion au réseau privé reste nécessaire. L'identité vient de Tailscale,
par le proxy ou sa consultation locale ; le worker ne reçoit pas un compte
utilisateur signé. Il autorise les commandes selon les places et le rôle
annoncé par le salon. L'administrateur qui publie la référence de touches et le
chef qui choisit la partie sont deux rôles distincts. Depuis le 21 novembre
2026, l'administrateur et le chef d'une salle sont aussi les seuls à pouvoir
la fermer, et une écriture au salon exige l'origine d'une de ses pages. Cette
identité se forge encore depuis la machine elle-même : voir le carnet, entrée
« 21 novembre : fermer les portes du salon ».

## Jeux Switch effectivement essayés

| Jeu | Vérifié | Limite |
|---|---|---|
| Mario Tennis Aces, 3.1.0 | Double commandé par quatre pages, reprise de progression, lancement des deux emplacements, clip sonore. Sauvegarde communautaire chargée avec niveau 99 et courts d'aventure accessibles. Souhib confirme que le message auparavant bloqué peut être fermé après le correctif de vibration. | Toutes les tenues et tous les défis n'ont pas été inspectés. Les premiers essais d'import avaient involontairement chargé 1.0.0 avant le raccordement de la mise à jour. |
| Looney Tunes: Wacky World of Sports, 0.1.0.27382 | Base et mise à jour fournies, jaquette Nintendo, choix des équipes et personnages par quatre pages, déplacements en basket, clip stéréo de 30,166 s. | Les quatre sports n'ont pas tous été joués. Aucune sauvegarde Switch complète vérifiable trouvée. Les deux emplacements commencent sans progression, même celui nommé « débloquée ». |
| Mario Party Superstars, 1.1.1 | En sonde le 11 septembre : démarrage avec la mise à jour, son, une manette montrée par place occupée, choix de deux joueurs avec deux places tenues, partie lancée sur Yoshi's Tropical Island. Sauvegarde « LV99 » (GameBanana, lien MEGA) dans « débloquée » : niveau 99, 3 235 pièces, 86 heures. | Pages et autocollants non parcourus. Ryubing n'a qu'un profil : pour le joueur 2, descendre sur « OK! ». Une place vide plus de 5 s pendant la préparation rouvre l'écran des manettes ; « 1 » joueur avec deux places prises peut bloquer. |
| Mario Kart 8 Deluxe, 4.0.0 | Mise à jour et Booster Course Pass fournis le 11 septembre. En sonde : menu Multiplayer à deux jusqu'au choix de la cylindrée (en 1.0.0). Dans l'emplacement « débloquée » réel, la sauvegarde « Wave 1-5 » de 2023 : Mirror, 200cc, personnages et douze coupes du Booster Course Pass. | Aucune course jouée. Seul le fichier de progression est importé : fantômes et replays exclus. |
| Super Mario Party Jamboree, 2.3.0 | En sonde le 11 septembre : démarrage avec la mise à jour, son, introduction, écran titre, choix du personnage, Party Plaza. Sauvegarde fournie par Souhib (Checkpoint, octobre 2024) dans « débloquée » : 22 personnages dont Pauline et Ninji. | Aucune partie à plusieurs jouée. Ce n'est pas un 100 % vérifié. |
| Super Smash Bros. Ultimate, 13.0.5 | En sonde le 11 septembre : mise à jour et 99 contenus additionnels chargés, combattants additionnels annoncés sur une partie neuve. Avec la sauvegarde « All Spirits » de NX_Saves, les 89 combattants et toutes les arènes ; le joueur 2 rejoint. Installée dans « débloquée ». Cache de shaders prérempli (9 449, chargés en 13,5 s) et partagé par les deux emplacements. | Aucun combat lancé. Les événements en ligne (BCAT) de la sauvegarde ne sont pas importés. Il reste 1,6 gel par minute de moins de 400 ms : le jeu émulé ne produit pas l'image, moitié traduction de code à la demande, moitié décompression de ressources du jeu (12 septembre 2026). |

Les inscriptions et les données de console restent privées, hors du dépôt.
Une mise à jour NSP seule n'est pas un jeu lançable. Le mode Classique de
Looney Tunes est celui essayé ; les mouvements ne sont pas transmis.

## Pistes écartées, remplacées ou non démontrées

| Piste | Ce qui a changé la décision | Portée de la conclusion |
|---|---|---|
| Utiliser `xerpi/dolphin-switch` pour les jeux Switch | Ce dépôt fait tourner Dolphin sur une Switch. Il continue d'émuler GameCube/Wii. | Écarté pour la fonction demandée, après lecture du dépôt ; aucun essai sur console prétendu. |
| Retenir Eden dès le premier prototype | Eden 0.2.1 quitte avec le code 139 sur le programme de test, y compris sans mémoire rapide. Ryubing fait tourner ce programme. | Choix de Ryubing pour poursuivre. Aucune preuve qu'Eden serait plus lent sur Mario Tennis. |
| Ajouter Citron Neo en même temps | Aucune fonction d'intégration identifiée ne justifie un troisième adaptateur avant de mesurer les deux premiers. | Différé ; aucun benchmark de Citron annoncé. |
| Garder `SoftwarePageTable` parce que `HostMapped` plantait | Le conteneur remplissait sa limite de mémoire partagée de 512 Mio. Le même mode démarre avec un plafond de 8 Gio. | `HostMapped` est retenu après correction de notre quota, pas après changement de langage. |
| Capturer avec Xvfb | Le premier essai retombait sur un rendu logiciel. Cage, puis Sway, ont permis l'affichage privé avec le GPU. | Concerne ce montage mesuré ; ce n'est pas une conclusion sur tous les serveurs X. |
| Lire les paquets vidéo en attendant le suivant | Cette attente ajoutait du retard et perdait l'instant de capture. Le capturateur transmet maintenant un paquet terminé avec l'horloge du compositeur. | Gain mesuré avec une source artificielle jusqu'à Chrome local ; pas une mesure appui-écran distant. |
| Laisser le son ancien se vider naturellement | Une file SDL de plus de 1,7 s ne revenait pas au présent. Les échantillons anciens sont maintenant retirés au-delà de la borne décrite dans l'étude. | Un trou après blocage est préféré à un retard durable. Les échantillons d'une file saine sont conservés. |
| Conclure sur les mesures prises avec plusieurs captures oubliées | Arrêter `docker exec` ne terminait pas son enfant dans Docker. Jusqu'à quatre producteurs mélangeaient leurs sorties. | Séries invalidées. Arrêt des vrais processus, verrou de session, puis nouvelles mesures. |
| Garder le filtre vidéo `fps` pour annoncer 60 Hz | À corrections égales, le filtre réintroduit donne 65,45 ms médianes, contre 41,19 ms sans lui, sur 60 changements de couleur par variante. | Filtre retiré ; cadence nominale annoncée sans dupliquer les images. Ces chiffres ne sont pas la latence de Mario Tennis. |
| Passer à Ryubing amont `475615f` (26 août 2026) | Sur Looney Tunes, dans une sonde, cadence, délai de l'appui à l'image et charge processeur sont égaux à ceux de la version épinglée : 218 ms contre 217 ms médianes à l'écran de titre, 118 contre 110 ms au curseur du menu (série épinglée refusée par un témoin), 276 % contre 277 %. Deux correctifs portés sur SDL3 sont rangés dans `spikes/switch-room/amont/`. | Même vitesse, mais le son SDL3 de l'amont se coupait : 277 silences de 5 ms en 20 s sur le programme de test, 0 sur la version épinglée. Notre correctif rend à chaque session sa période, et le son revient intact. Mario Tennis charge sa sauvegarde niveau 99. Installée dans la salle le 10 septembre. Le même soir, un son en retard croissant a été trouvé en lançant la salle (le rappel SDL3 remettait une période même quand rien ne manquait), corrigé et réinstallé (`ryubing-1.3.3-475615f-c`). L'ancien moteur reste à côté pour revenir en arrière. |
| Réécrire l'émulateur C# en Rust | Aucun port comparable ni mesure n'a été réalisé. Les gains observés viennent des files audio, de la capture, de l'affichage et de la mémoire partagée. | D1 reste applicable. Le langage seul ne permet pas de promettre un gain. |
| Choisir Mario Kart 8 Wii U contre Deluxe Switch sur un chiffre de vitesse | Aucun essai comparatif de ces deux jeux et de leurs moteurs n'a été effectué sur lgf dans cette conversation. | Question encore ouverte ; aucun moteur Wii U intégré. |
| Déclarer Zen corrigé après désactivation du compositeur natif | Souhib a essayé ce réglage et le gel gris persiste. Son rapport décrit une fermeture anormale du canal graphique. | Le défaut Windows reste ouvert. YouTube et Twitch sans panne ne valident pas le chemin WebCodecs/canvas de nel3ab. |

L'[étude Switch](etude-switch-2026-09-07.md) conserve les versions, conditions,
sources et résultats des comparaisons. Une option non essayée reste distincte
d'une option réfutée par une expérience.

## Ce qui reste ouvert

| Sujet | Prochaine preuve utile |
|---|---|
| Switch ralentie en cours de partie | Le 14 septembre 2026, Mario Tennis à quatre passe de 60 à 40 images/s en 45 minutes. Le fil de rendu de Ryujinx crée 600 à 1 000 objets GPU de 4 Kio par seconde, et `drm_buddy` du noyau 6.8 les range dans une liste triée dont la longueur suit la fragmentation de la VRAM (16,3 % du temps de rendu à 6 457 blocs libres, 3 % à 3 240). `RADV_PERFTEST=nosam` est écarté (57 img/s au témoin, 56 avec). Le noyau 7.0.0-31 remplace cette liste par un arbre. Installé le 14 septembre 2026 avec l'accord de Souhib (`linux-generic-hwe-24.04`) ; le 6.8.0-139 reste dans GRUB. Mesuré après redémarrage : 59 img/s sur le même banc (57 au témoin du 6.8), allocation de la VRAM ramenée à 1,79 % du fil de rendu. Reste à vérifier sur une vraie soirée à quatre que la cadence ne baisse plus au bout de 45 minutes. La boîte noire relèvera cette soirée : `just boite-noire <jour> <plage>` montre la cadence, le fil de rendu et les captures. Le pilote de fréquence est passé à `amd-pstate-epp`, et l'audio HDMI du GPU est signalé non opérationnel (inutilisé par les salles). Preuves : Carnet, « Mario Tennis à quatre ralentit en cours de partie » ; relevés dans `~/.local/state/nel3ab/diagnostics/2026-09-14-lenteur-tennis/`. |
| Gel de Zen sous Windows | Refaire une séance sur le poste concerné, avec heure du gel et diagnostic graphique. Les essais de pilote et d'accélération proposés n'ont pas de résultat confirmé dans le suivi. |
| Transport et liaisons faibles | Étude du 22 septembre 2026, sources en main: [étude](etude-transport-2026-09-22.md). Un joueur sur trois jette 433 images en vingt minutes pendant que les deux autres n'en jettent aucune, machine au repos. Notre débit varie d'un facteur 17 (qualité constante), une image va de 6,4 à 60 Kio pour une file de 2 images par spectateur, et le son en PCM brut coûte 1,6 Mbit/s à chacun. Moonlight et Sunshine n'ont pas non plus de contrôle de congestion: ils ont de l'UDP et 20 % de redondance (50 % sur le son, en Opus à 96 kbit/s). Écartés par les sources: rafraîchissement progressif (absent de notre encodeur), invalidation de références (NVENC seul), FEC sur TCP (inutile), GameNetworkingSockets (injoignable d'un navigateur, et sans congestion ni FEC ni échéance), WebRTC en émission (la spec interdit à un script de créer une trame). Ordre proposé et NON mesuré: plafonner la taille d'image, adapter la file par spectateur, Opus, puis WebTransport. Découpé en étapes dans le [plan d'exécution du 23 septembre](plan-execution-2026-09-23.md). Phase 0 le 23 septembre: `deploy-check` voit un service plus vieux que son code, la boîte noire sépare un gel de salle d'un gel de page, et `just banc-liaison` dégrade une vraie liaison (`tc netem` dans un espace réseau). Falsifié en alternance: 20 ms de gigue seule, zéro chaîne cassée; avec 1 % de perte, deux. 1 % de perte sans délai ne casse rien. Ligne de base relevée sur une démonstration dont le débit varie de 0,8 à 25 Mbit/s: une tendance, pas une référence. Le banc rejoue désormais un clip à travers le vrai encodeur (`just banc-liaison … <clip>`), à débit stable. La file adaptative (étape 1.2) est codée mais tenue à deux: sur ce clip, elle cassait plus de chaînes. `max_frame_size` est refusé par FFmpeg en qualité constante. Le son en Opus est une [proposition d'amendement de D10](adr/proposition-d10-opus.md), non acceptée. |
| Demi-format à 5 Mbit/s | Le banc Wii du 7 septembre reçoit encore environ 9,66 Mbit/s sans plafond sur sa scène. Mesurer un contrôle de débit propre au réduit, sans changer le plein. WebRTC n'a pas été comparé au transport actuel. |
| Latence et endurance Switch | `just switch-reaction` mesure l'appui jusqu'à la première image changée sur `/video`, contre des témoins sans appui. Le 10 septembre sur Looney Tunes : 110 à 118 ms médianes au curseur du menu principal selon la version, qui répond aussi vite que le jeu le peut ; la série de la version épinglée est refusée par un de ses témoins. L'écran de titre donne 218 ms, fondu compris, mais son animation fait refuser la série. Le programme de test donne 67 à 70 ms, découpés le 10 septembre (`spikes/switch-room/latence/`) : notre chaîne en prend environ 15 (entrée 0,4, lecture 1,6, compositeur 8,5, transit 4,2), le programme et l'émulation 54. Sway à 120 Hz retire l'attente du compositeur (57 ms au total) et régularise les images ; la salle y est réglée depuis le 10 septembre (`refresh_hz`). Garder l'image affichée jusqu'à la suivante, comme une console, retire une image de plus : 64,5 à 39,9 ms sur le programme de test, 16,7 ms sur Mario Tennis ; la salle l'a depuis le 10 septembre (`hold_front_buffer`). Il manque le réseau et le navigateur du joueur, une partie prolongée avec quatre appareils distants, et un marqueur à l'instant où le jeu remet son image. Le worker rapporte `input_to_frame` pour la Switch depuis son redémarrage du 10 septembre. |
| Émulation Switch figée | Distinguer une session bloquée d'une image volontairement immobile quand le compositeur continue de produire. La reprise de capture ne résout pas ce cas. La sieste automatique de Dolphin n'a pas d'équivalent validé ici. |
| Manettes des places vides | Depuis le 10 septembre, seules les places occupées ont une manette branchée côté émulateur (`ryubing-seats.patch`, fichier `seats` écrit par le worker) : Mario Tennis accepte le simple à deux. La grâce de 5 s avant de débrancher une place vide est choisie, pas mesurée ; mesurer le temps qu'une page rechargée met à reprendre sa place. |
| Commandes Switch supplémentaires | Joy-Con séparés, gyroscope, Home, Capture et fidélité HD Rumble restent hors du périmètre vérifié. Le programme de test et la lecture des périphériques ne prouvent pas chaque action de chaque jeu. |
| Sauvegardes et exploitation | Copie hors machine avec restauration exercée ; import générique par titre ; arrêt pendant une écriture. Les copies locales actuelles ne protègent pas d'une perte du disque. |
| Déploiement reproductible | Le service exécute encore `core/target/release/nel3ab-worker`. Un build release peut devenir le prochain binaire servi. Séparer le binaire installé, les builds et les versions de l'adaptateur. |
| Moteurs des salles externes | Au 22 novembre 2026 : brancher le canari Xbox 360 sur une salle choisie et y jouer une partie ([La Xbox 360 dans la salle](xbox360.md)), puis l'étape E2c, la Switch 2 (E3) sur accord du propriétaire, et la Switch (E4a, E4b). Le doré ne voit pas les délais eux-mêmes : seul l'arbre syntaxique tient les deux copies de `serve` égales jusqu'à la bascule de la Switch. Les scripts `docker/*-room.py` gardent leur copie de la forme du titre jusqu'à E8. |
| Interface du 22 novembre | Rien n'a été vu sur un vrai téléphone (écran d'accueil d'un iPhone, son après un appel, plein écran d'un Android), dans Safari ni avec un lecteur d'écran. Les seuils de l'état de liaison n'ont pas été confrontés aux pauses réelles de Xenia et d'Eden ni à un relais. Les recettes de salle réelle qui demandent une ROM n'ont pas été relancées. La boucle de contraste de `manette-garde` doit poser `nuit` et `jour` au lieu des sept anciens thèmes. Caddy renvoie toute erreur de passerelle sous `/r/` vers « fermée », et l'accueil ne lit pas encore « redémarre ». |
| Ancien audit | Suivre les constats restants sans reprendre les anciens nombres comme un état courant. Les patches Dolphin, la surveillance mémoire, le fichier LICENSE et certaines corrections de messages restent à traiter ou à revalider. |
| Interface, le reste de la revue | L'échelle de texte est faite au 13 septembre 2026 : seize tailles et deux vocabulaires (`text-[Npx]` et `text-xs`) sont devenus **sept paliers nommés** (11, 13, 15, 17, 20, 26, 31 px) déclarés en jetons `--text-*`, sur 188 sites d'appel. Aucun palier ne rétrécit quoi que ce soit. `layout` et `contraste` étaient verts avant et le restent après. **Mais un bouton était coupé et aucun garde ne l'a vu** (« Modifier cette comman ») : `just check` ne surveille aucune taille de texte, et seule une capture l'a montré. La cause est générale — un conteneur en pixels fixes est calibré pour une taille de texte donnée, ici `250px` pour un corps à 12 px — d'où `browser-debordement`, qui mesure 23 px de dépassement et nomme les coupables. `browser-debordement` balaie désormais **quatre largeurs** (1920, 1440, 1100, 600) et imprime le panneau mesuré à chacune, de sorte qu'un balayage inopérant se distingue d'un vrai. Non couvert : l'état de configuration guidée, dont le bouton est `disabled={!identity}` et exige une manette détectée puis une leçon commencée ; ses surcharges de tailles vivent de toute façon sous `max-width: 900px`. Une carte du salon dit désormais qui est là, depuis quand la salle tourne et combien de manettes sont libres ; vérifié en direct le 12 septembre au soir sur la salle 1 (828 s d'ancienneté, trois manettes libres sur quatre). La colonne du menu XMB est désormais bornée (fenêtre de découpe au-dessus du croisement, garde de 72 px au-dessus du pied : trois entrées visibles au-dessus du curseur, huit sur quatorze au lieu de six, plus aucun contact avec la légende du pied). La superposition révélée par cette capture est CORRIGÉE au 13 septembre 2026, après décision de Souhib : la bande des rayons avale ce qui passe derrière elle. Mesuré : le texte de l'entrée croisait l'ICÔNE du rayon sur 32×17 px, le libellé n'étant frôlé que sur 3 px — trois versions de la sonde ont cherché la collision au mauvais endroit. Le remède est un `mask-image` sur la fenêtre de colonne et non un rectangle opaque : mesuré, une capture de la bande pèse 42 657 octets avec le décor du menu contre 3 830 sans, donc un rectangle plat y aurait découpé une balafre. Coût assumé : deux entrées étaient lisibles au-dessus du curseur, dont une qui collisionnait, il en reste une. Le filet est `browser-superposition`, dont l'en-tête liste les **cinq** critères précédents qui ne pouvaient pas échouer, et qui est BORNÉ : il juge le remède en place, un masque, et crierait à tort devant un remède par fond opaque. **L'écran d'entrée d'une salle a deux dessins depuis le 13 septembre 2026** : `classique`, inchangé, et `câbles`, où un câble tendu part du port vers le nom et un câble libre reste enroulé, choisis par un bouton sur la page même (aucun menu n'existe avant d'entrer). Le choix est retenu sous le contrat de `SHELLS`, et les sept identifiants lus par les pilotes sont présents dans les deux. Les quatre places portent enfin les couleurs GameCube, déjà dans `media/players.ts` et mesurées à 5,05 / 5,43 / 10,23 / 6,93 pour un sur le fond actuel, y compris quand elles sont libres. Un retour vers la liste des salles n'apparaît que derrière le proxy, car servie en direct la page est déjà la racine. **Deux défauts de méthode sont consignés** : `--font-mono` retombait sur une proportionnelle faute du garde-fou `"DejaVu Sans Mono"` que le salon portait déjà (455 px contre 462 mesurés dans Chrome), et `tsc --noEmit` ne vérifie RIEN dans ce dépôt (zéro fichier ; c'est `npm run typecheck` qui fait foi, ce que le carnet avait déjà écrit). **La jauge d'occupation du salon remplit enfin sa piste** : ses quatre segments portaient une largeur figée dans un cadre extensible, d'où un rectangle vide aux deux tiers (32 % de remplissage mesuré, segments tassés à droite par `justify-content: flex-end`). Ils prennent désormais `flex: 1` : 92 % à 1440, 86 % à 430, et le segment plein garde la couleur de son canal. Les couleurs ne sont pas touchées, leurs rapports étant couleur contre couleur et indépendants de la largeur. Pas de couleurs par port ici : `/api/salles` ne rend que des pseudos sans numéro de place et un compte de manettes libres, donc un segment vaut une personne, jamais un port. À retenir : `accueil.html` est lu une seule fois à l'import, donc toute correction y exige un redémarrage de `nel3ab-control`. Le 13 septembre également, le dessin « câbles » de la page d'entrée ne penche plus : ses deux colonnes finissaient 35 px l'une sous l'autre à 1440 px, elles finissent au même trait (292 px et 292 px, écart 0). La bascule d'`align-items` sur la page vivante montre que la baie n'y est pour rien — 292 px de haut et 60 px de vide dans les DEUX états — et qu'un « 44 px » cité dans un commentaire était une mesure prise à 430 px, pas à 1440. Toujours le 13 septembre, la page d'entrée reçoit un **troisième dessin**, « plan », choisi contre la moyenne de trois juges parce que celle-ci récompensait un 4 sur le critère demandé. Le travail a surtout révélé un trou de garde : `contraste.mjs` et `debordement.mjs` entrent tous deux dans la salle avant de mesurer, donc **aucun garde n'avait jamais regardé cette page** et les rapports écrits le matin pour le dessin « câbles » étaient des calculs, pas des mesures. Le nouveau `just browser-lobby` s'arrête avant d'entrer : 32 soucis à sa première exécution — blocs partagés portant les encres du thème sur des fonds peints (3:1), numéros de place atténués à l'alpha (« P1 » à 2,92:1 sur le classique) — puis **0 sur trois dessins et deux largeurs**. Il est falsifié dans les deux sens, et refuse de mesurer quand `data-look` ne nomme pas l'écran demandé. Le dessin « câbles » reçoit ensuite une **animation qui porte l'information** : une lueur parcourt le câble branché, la boucle d'une place libre respire, décalées de 320 ms par port. Vérifiée à l'image et non seulement dans le DOM — cinq images distinctes sur six pour un recadrage du seul câble de P1 — et son jumeau négatif établit que `prefers-reduced-motion` fige bien l'image (une seule image distincte) et efface la lueur (opacité 0) au lieu de la laisser posée sur le fil. |
| Pilotes et leur adresse | Le port mort est balayé à la source : plus aucun fichier de `spikes/m3-browser-drive` ne vise `8100` dans son code, et les quinze recettes qui le passaient ont suivi. Le relevé a été refait une troisième puis une quatrième fois, et la méthode compte plus que le chiffre : compter tout fichier qui appelle `.goto(`, puis regarder s'il accepte `process.argv` **sous toute forme**, `NEL3AB_URL`, ou importe `ROOM_URL`. Le troisième relevé cherchait `process.argv[2]` et ratait `capture-salle.mjs`, qui lit `process.argv.slice(2)`. Le quatrième a été falsifié avant d'être cru, sur cinq pilotes réputés paramétrables. Un cinquième relevé, déclenché par une capture ratée, a corrigé le quatrième : chercher `process.argv` sans demander « pour quoi faire » classe paramétrable un pilote qui reçoit un argument servant à autre chose (`capture-accueil.mjs` y reçoit son fichier de sortie). Résultat au 12 septembre au soir : **61** pilotes ouvrent une page, **10** n'acceptent ni argument ni variable d'environnement, **4** de plus prennent un argument qui ne désigne pas l'adresse, soit **14** dont l'adresse ne se change pas de l'extérieur. Mais les lire un par un réduit la dette : aucun des 14 ne vise une salle avec une adresse périmée (quatre calculent la leur depuis un port qu'ils gèrent, deux visent un site extérieur, un vise le salon vivant sur 8200, les autres pilotent un aperçu Vite ou la reçoivent autrement). Corrigés et exercés : `layout`, `contraste`, `library`, `padmenu`, `salon-accueil`, `panel`, `flood`, `sonde`, `stir`, `loading`, `games`. Les exercer a trouvé quatre défauts réels : deux adresses construites à partir de la racine, qui jettent le préfixe `/r/N/` (`new URL("/roms", url)` frappe le salon, `location.origin + "/video"` n'y reçoit aucune image) ; trois pilotes antérieurs à l'écran de préparation, qui s'arrêtaient au choix de la sauvegarde alors que le jeu ne part qu'après « Je suis prêt » puis « Lancer le jeu » ; et une ligne de commande où l'adresse et les touches se disputaient `argv[2]`. `polite` est **repointé** au 13 septembre 2026 : il comptait `counters().attempts`, qui vaut les trames d'entrée envoyées, et son scénario n'existe pas (`refused` désigne une page qui regarde PAR CHOIX, et rien ne rejette personne). Il mesure désormais l'invariant voisin et réel — une page qui tient une place la réannonce environ une fois par seconde — et montre les deux couleurs : 12 annonces en 12 s par le proxy, 0 sur le worker en direct. `sound` est vérifié sous proxy (188 Kio/s pour 187 attendus). `nap` accepte une adresse ET il est **exercé** depuis le 13 septembre 2026 : ses huit étapes passent. La réserve écrite la veille était fausse, et la leçon vaut plus que le pilote : `docker inspect nel3ab-dolphin` avait été tapé sans salle ouverte et contre le nom d'avant la bascule multi-salles, le conteneur s'appelant `nel3ab-dolphin-N`. Une absence constatée par une commande reste une absence de la COMMANDE tant que la commande n'a pas été vérifiée. Règle qui en découle : un pilote qui CHANGE de jeu a besoin du salon, donc du proxy, pas du worker en direct — `browser-loading`, `browser-games` et désormais `saves-test` exigent `NEL3AB_URL`. **`saves` est exercé et VERT au 13 septembre 2026** : dix-neuf vérifications, dont la seule qui compte, le dossier de carte mémoire qui bascule vers `/debloquee` puis revient vers `/neuve`, avec le navigateur témoin qui voit l'écran de chargement. Le remettre en marche a demandé **sept causes empilées**, dont trois explications démenties par la mesure avant la bonne : la dernière était une aide partagée qui pressait « Je suis prêt » une seule fois sans lire le résultat de sa pression, alors que ce bouton porte `disabled={working || occupied}` et peut donc être grisé à cet instant ; lequel des deux états bloquait n'a pas été établi, et c'est précisément pourquoi elle presse désormais jusqu'à ce que le lancement s'arme, au lieu de parier sur une durée, puis lève une erreur nommée si rien ne s'arme. Mes sondes réussissaient toutes là où le pilote échouait, parce qu'elles différaient de lui par ce que je ne comparais pas (l'instant de la pression, le pseudo donc le profil de touches) : la sortie a été d'instrumenter le VRAI fichier. **Et cet exercice a rapporté un défaut du SALON** : `SAVES` ne nommait que deux emplacements quand la page en propose trois et que la préparation accepte l'emplacement 2. Lancer « ta sauvegarde » levait `IndexError` à `handlers.py:790` après que le worker avait pris l'ordre : la partie démarrait, l'appel de la page expirait, et personne d'autre ne recevait l'écran de chargement. L'essai qui devait empêcher cette divergence bouclait sur la seule liste du salon et ne pouvait donc pas la voir ; il compare maintenant les deux listes entières. Corrigé en rouge d'abord, les deux essais redevenant rouges quand on remet `SAVES` à deux entrées. **Le défaut avait une SECONDE moitié dans le worker**, qui rendait la première invisible : `prepare_launch` gardait `choice.save > 1` quand tout le reste du chemin acceptait le personnel, et refusait en silence — le salon annonçait alors « Le worker n'a pas accepté le lancement » et la préparation restait ouverte. Corrigé en rouge d'abord lui aussi, avec son jumeau négatif (l'emplacement 3 reste refusé), et chaque refus de cette fonction porte désormais son motif dans le journal. **Vérifié en service** le 13 septembre 2026 sur le binaire recompilé : le témoin spectateur reçoit l'écran de chargement nommant « ta sauvegarde », `chosen-save = 2`, et la carte mémoire pointe vers `joueur-souhib-t-hotmail-fr`. Trois restes de la bascule multi-salles sont soldés le même jour : `bench/run.mjs` redémarrait l'unité d'avant (encore installée et démarrable, elle aurait levé une salle fantôme sur le port 8100 en consommant le GPU ; l'unité est supprimée du dépôt et de `/etc/systemd/system`), `depuis-la-page.py` visait ce port mort et ce journal mort, et surtout le garde-fou d'`extension-a-chaud.py` — qui empêche la manip de tuer la salle — ne reconnaissait plus les conteneurs `nel3ab-dolphin-N`. **Les trois dernières réserves « NON exercé » des pilotes sont soldées** : celle de `nap` était périmée (son propre passage reçoit 706 images sur la socket concernée), celle de `preparation-room` décrit un cas structurellement latent qu'aucun passage ne peut montrer (ses pages sont servies à la racine de sa salle jetable, où `location.href` et `location.origin` sont la même adresse), et `sound` est exercé ET falsifié à travers le proxy sur une salle qui joue : 188 Kio/s pour 187 attendus avec la correction, 0 Kio avec le défaut réintroduit. Aucun pilote de `spikes/m3-browser-drive` ne porte plus de réserve « NON exercé ». **Et `deploy-check` entre dans la porte locale** : il comparait déjà les unités installées à celles du dépôt, dans les deux sens, mais rien ne l'appelait. Le 13 septembre 2026 une unité corrigée dans le dépôt et non déployée a laissé la machine pointer vers un fichier supprimé sans que la porte bronche ; la dérive a été retrouvée à la main. Falsifié avant d'être branché : soumis à une vraie divergence il devient rouge et nomme le fichier. Dans `local` et pas dans `check`, qui est partagé avec une CI dépourvue de `/etc/systemd/system/nel3ab-*`. Au passage, `just saves`, `just save-import` et `just save-reset` lisaient encore `session/saves`, le répertoire d'avant la bascule multi-salles : inventaire figé et dépôt dans le vide, sans erreur ni l'un ni l'autre ; les trois prennent un numéro de salle. |
| Test GPU intermittent | Le 9 septembre, un test de conversion dma-buf a échoué pendant l'essai de deux jeux, puis passé seul et dans la porte complète sans changement de code. La cause n'est pas démontrée ; ne pas élargir son seuil. |

## Reprendre et vérifier

Commencer par l'ADR, puis la note propre au domaine. Pour les touches, lire
`ecran-manettes.md` avant de changer les dessins. Pour la Switch, lire
`switch-room.md` avant de lancer les anciens scripts du laboratoire : une partie
de `spikes/switch-room` sert désormais à la salle installée.

| Changement | Vérification à rejouer |
|---|---|
| Lenteur signalée | `just boite-noire <jour> <plage>` avant de relancer quoi que ce soit ; les captures sont dans `~/.local/state/nel3ab/boite-noire/captures/`. |
| Documentation | `just docs`, qui construit aussi le répertoire servi sous `/docs`. |
| Code commun | `just` : qualité Rust/Python/page (dont le doré des salles externes et le socle des moteurs depuis le 22 novembre 2026), GPU, clip audio, sauvegardes et capture Switch, Xbox 360, copie des sauvegardes, déploiement, puis cinq preuves dans un vrai navigateur. |
| Adaptateur d'une salle externe | `just salles-dore` et `just moteurs-test`. Une migration garde `docker/dore/` inchangé ; `just salles-dore-ecrire` refuse tant qu'un autre fichier est modifié. Travailler dans un worktree, jamais dans l'arbre de production. |
| Page de salle | `just focus-navigateur`, `just etats-navigateur`, `just parcours-navigateur`, `just salle-telephone` et `just manette-garde` ; après un changement de leurs étapes, les contrôles négatifs `*-rouge` doivent encore échouer sur leurs défauts. |
| Contrat HTTP généré | `just contract-check` après préparation de l'index correspondant ; voir la réserve ci-dessous. |
| Configurateur et préparation | `just browser-configuration`, `just browser-preparation` et `just preparation-test '/chemin/Mario Kart Wii.rvz'`, avec les prérequis des pilotes. |
| Cycle de vie Dolphin | `just resilience-test '/chemin/Mario Kart Wii.rvz'`. |
| Commandes Switch | `just switch-controls-test` : quatre périphériques jetables, y compris retour de vibration refusé. |
| Passage entre consoles | `NEL3AB_TEST_SWITCH_CONFIG=~/.config/nel3ab/switch.json just switch-room-test '/chemin/Mario Tennis Aces.xci'`. |
| Catalogue | `just catalogue-test`, avec Mario Tennis et Looney Tunes inscrits localement ; aucun jeu lancé. |
| Dépendances | `just audit`. La CI exécute séparément ses jobs qualité, dépendances Rust et documentation. |

La dernière porte complète locale du 9 septembre passe, après l'échec GPU décrit
plus haut. Le catalogue dans les trois menus et la documentation stricte passent
également. Ce n'est pas une CI distante : aucun nouveau commit n'a été envoyé.
Les comptes d'essais historiques restent datés dans le carnet.

Le contrôle du client généré compare ses sorties à l'index Git. Pendant ce
travail non commité, les vérifications ont utilisé un index temporaire contenant
les schémas et le client de l'arbre courant. Leur régénération devait rester
identique ; l'index habituel n'a pas été modifié. Cette condition accompagne le
résultat, elle ne transforme pas le dépôt en arbre propre.

Les résultats synthétiques conservés sous `bench/results` et
`spikes/switch-room/results` peuvent être repris avec le dépôt. Les captures et
journaux sous `/tmp/nel3ab-*` sont des pièces temporaires et peuvent disparaître.
Le carnet garde donc les observations et leurs limites sans dépendre uniquement
de ces chemins. Le répertoire local de travail doit être conservé tant que ses
changements n'ont pas été enregistrés dans l'historique.
