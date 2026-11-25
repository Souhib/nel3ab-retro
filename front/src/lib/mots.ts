/**
 * Les mots de la salle: la seule source des termes que le joueur lit.
 *
 * # Pourquoi un fichier
 *
 * L'audit des textes du 22 novembre 2026 a compté cinq noms pour un même
 * emplacement (manette, place, prise, port, P1), trois pour la sauvegarde
 * personnelle et quatre pour l'image légère, avec deux prix différents. Chaque
 * écran avait choisi son mot. Un nouveau venu ne relie pas « prendre une
 * manette » dans la colonne à « reprendre une manette » dans le menu, ni l'un
 * ni l'autre à « entrer et jouer » sur l'accueil.
 *
 * Un mot écrit ici se lit partout pareil. Un mot que la charte refuse est
 * refusé par `mots.test.ts`, qui parcourt les chaînes visibles de tous les
 * composants: la règle vit dans la machine, pas dans un document qu'on relit.
 *
 * # La charte, en six lignes
 *
 * 1. Tutoiement partout. Présent.
 * 2. L'effet d'abord, l'action ensuite: « L'image ne bouge plus. Réessaie. »
 * 3. Jamais de cause supposée: le propriétaire calibre sur ce que les joueurs
 *    ressentent, pas sur ce que la page devine.
 * 4. Une aide tient en une phrase courte.
 * 5. Un bouton commence par une majuscule, une étiquette reste en minuscules.
 * 6. Aucun mot d'atelier hors des mesures techniques, et aucun tiret cadratin.
 *
 * # Le lexique
 *
 * - **place**: l'emplacement 1 à 4. « place 2 », « 2 places libres »,
 *   « Prendre une place », « Rendre ma place » (`PLACE`).
 * - **manette**: l'objet qu'on tient, et lui seul. « Aucune manette détectée. »
 * - **1P à 4P**: la pastille d'une place, comme sur une borne (`pastille`),
 *   jamais un nom.
 * - **chef**: la personne qui choisit le jeu. « Bo choisit le jeu. »
 * - **nouvelle partie**, **tout débloqué**, **ma sauvegarde**: les trois
 *   sauvegardes. Aux autres: « la sauvegarde de Bo ».
 * - **image complète**, **image légère**: les deux qualités de l'image.
 * - **rejoindre**, **regarder**: les deux façons d'entrer (`ENTREES`), sur
 *   l'accueil des salles comme dans l'avant-salle.
 * - **quitter la salle**: la seule sortie, vers les autres salles.
 *
 * Un geste du lexique ne s'écrit qu'ici: `mots.test.ts` refuse la même phrase
 * écrite en dur ailleurs. Le menu les écrit en minuscules (`enMenu`), comme
 * toutes ses entrées; une colonne ou un panneau les écrit avec leur majuscule
 * de bouton (charte, règle 5). Le mot reste le même.
 */

/** Une place, par son numéro. */
export const placeN = (numero: number): string => `place ${numero}`;

/** Combien de places restent, en toutes lettres. */
export function placesLibres(nombre: number): string {
  if (nombre <= 0) return "aucune place libre";
  return nombre === 1 ? "1 place libre" : `${nombre} places libres`;
}

/** Prendre ou rendre sa place: les deux gestes d'une place, partout. */
export const PLACE = {
  prendre: "Prendre une place",
  rendre: "Rendre ma place",
} as const;

/** Le bouton du spectateur, qui dit quelle place il prendra. */
export const prendreLaPlace = (numero: number): string => `Prendre la place ${numero}`;

/** Les deux façons d'entrer dans une salle.
 *
 * L'accueil des salles disait « Rejoindre » et l'avant-salle « entrer et
 * jouer » pour le même geste (relecture du 22 novembre 2026). */
export const ENTREES = {
  rejoindre: "Rejoindre",
  regarder: "Regarder",
} as const;

/** Un geste du lexique, écrit comme une entrée du menu: en minuscules. */
export const enMenu = (geste: string): string => geste.charAt(0).toLowerCase() + geste.slice(1);

/** Un mot du lexique, écrit comme un bouton: avec sa majuscule (charte, règle 5). */
export const enBouton = (mot: string): string => mot.charAt(0).toUpperCase() + mot.slice(1);

/** Qui choisit le jeu. */
export const chefChoisit = (nom: string): string => `${nom} choisit le jeu.`;

/** Le chef est là mais ne joue plus: le worker laisse choisir les autres. */
export const chefAbsent = (nom: string): string => `${nom} ne joue plus : tu peux choisir le jeu.`;

/** Les trois sauvegardes, nommées comme le panneau de lancement les nomme.
 *
 * « reprendre » ne disait pas à qui; « ta partie personnelle » et « ta
 * sauvegarde » nommaient la même chose ailleurs (audit T06). */
export const SAUVEGARDES = {
  neuve: "nouvelle partie",
  debloque: "tout débloqué",
  perso: "ma sauvegarde",
} as const;

/** Les voyelles qui font élider « de ». */
const VOYELLES = "aeiouàâäéèêëîïôöùûüœæ";

/** « de Bo », « d'Ami »: l'élision d'un prénom.
 *
 * Devant une voyelle. Devant un « y » seulement s'il sonne comme une voyelle,
 * c'est-à-dire suivi d'une consonne: « d'Yves », mais « de Yassine ». Jamais
 * devant un « h »: la page ne sait pas s'il est muet, et « de Hamza » se lit
 * bien quand « d'Hamza » se lit mal. La première règle élidait devant tout
 * « y » et tout « h » (relecture du 22 novembre 2026).
 *
 * Le salon élide de la même façon (`handlers.de`); les deux lisent la même
 * table d'exemples (`test/elisions.json`). */
export function de(nom: string): string {
  const premiere = nom.charAt(0).toLowerCase();
  const seconde = nom.charAt(1).toLowerCase();
  const voyelle = premiere !== "" && VOYELLES.includes(premiere);
  const y = premiere === "y" && seconde !== "" && !`${VOYELLES}y`.includes(seconde);
  return voyelle || y ? `d'${nom}` : `de ${nom}`;
}

/** L'image, ses deux qualités, et un seul prix.
 *
 * # Le prix
 *
 * La page disait « environ le quart du débit » à un endroit et « environ 2,6
 * fois moins » à un autre (audit T11). Le quart est un calcul: un quart des
 * pixels. Le 2,6 est une MESURE: 13,7 Mbit/s en image complète contre 5,27 en
 * image légère, les deux flux relevés en même temps pendant une course de Mario
 * Kart Wii le 17 août 2026 (carnet de bord). C'est le chiffre mesuré qui reste.
 * Il vaut pour Dolphin sur cette course; un autre jeu, ou la Switch, peut s'en
 * écarter, d'où « environ ». */
export const IMAGE = {
  reglage: "qualité de l'image",
  complete: "image complète",
  legere: "image légère",
  /** Le geste qui y passe. Le bandeau disait « Passer en réduit » et le
   * diagnostic « Essayer l'image légère » (vérification finale du 22 novembre
   * 2026). */
  passer: "Passer en image légère",
} as const;

/** Ce que l'image légère coûte en moins, dit seulement là où on l'a mesuré.
 *
 * Le 2,6 vient d'une course Dolphin. Une salle Switch ou Xbox 360 envoie du
 * 1280 × 720 avec un autre codeur, et personne ne l'a mesurée: lui donner le
 * même chiffre serait affirmer une mesure qui n'existe pas (CLAUDE.md, règle 1,
 * relecture du 22 novembre 2026). Ailleurs, l'effet sans le chiffre.
 *
 * `moteur` est celui du manifeste (`consoles.json`, `engine`). */
export function prixImageLegere(moteur: string | null | undefined): string {
  return moteur === "dolphin" ? "environ 2,6 fois moins de débit" : "moins de débit";
}

/** Ce que la manette seule rend au wifi, dit seulement là où on l'a mesuré.
 *
 * 13,6 Mbit/s est le p95 d'un flux par appareil, lu sur trois jours de journal
 * d'une salle GameCube et Wii (commit 6e0fd98, 19 août 2026). Aucune salle
 * Switch ni Xbox 360 n'a ce relevé: ailleurs, l'effet sans le chiffre
 * (CLAUDE.md, règle 1, vérification finale du 22 novembre 2026). */
export function prixManetteSeule(moteur: string | null | undefined): string {
  return moteur === "dolphin"
    ? "mesuré à 13,6 Mbit/s par appareil, c'est autant de wifi et de batterie rendus"
    : "c'est autant de wifi et de batterie rendus";
}

/** Les commandes dessinées à l'écran d'un téléphone, sous un seul nom.
 *
 * Le menu disait « commandes tactiles », la feuille du bas « Cacher la manette »
 * à côté de « Pour jouer avec une vraie manette. », et le pavé « Manette
 * tactile » (vérification finale du 22 novembre 2026). « Manette » est l'objet
 * qu'on tient. */
export const TACTILE = "commandes tactiles";

/** Le mode où un téléphone sert seulement de manette, sans image ni son. Le
 * menu l'appelait aussi « télécommande sans vidéo ». */
export const MANETTE_SEULE = "manette seule";

/** Les sorties, chacune sous un seul nom (audit P8). */
export const SORTIES = {
  /** La seule sortie de la salle: elle mène aux autres salles. */
  quitter: "Quitter la salle",
  /** Le lien vers la liste des salles, depuis l'avant-salle. */
  autres: "autres salles",
} as const;

/** La sortie du menu, sous un seul nom (vérification finale du 22 novembre
 * 2026) : « Reprendre la partie » pendant une partie, « Fermer le menu » dans
 * une salle au repos. « Retour aux consoles » est parti avec les dossiers du
 * menu unique (W3, 24 novembre 2026). Un bouton l'écrit avec sa majuscule,
 * une ligne en minuscules (`enMenu`). */
export const SORTIES_MENU = {
  fermer: "Fermer le menu",
  reprendre: "Reprendre la partie",
} as const;

/** Le réglage des effets rétro, dans le menu de la salle et au pied de la
 * liste des salles (ADR D37). Les mêmes mots aux deux endroits: le salon les
 * reçoit écrits depuis ce module (`retro/reglage.html`, `salon-retro.test.ts`).
 *
 * Le propriétaire a nommé les trois niveaux « Sobre, Conseillé, Tout ». Ce
 * sont des choix d'une liste: en minuscules, comme les autres choix du menu
 * (charte, règle 5). */
export const EFFETS_RETRO = {
  reglage: "effets rétro",
  niveaux: {
    sobre: {
      label: "sobre",
      note: "les couleurs, les lettres en pixels et les coins, presque rien ne bouge",
    },
    conseille: {
      label: "conseillé",
      note: "le réglage de départ, avec un peu de mouvement, jamais sur le jeu",
    },
    tout: { label: "tout", note: "tous les effets, lignes d'écran et tremblements compris" },
  },
  sons: "sons de menu",
  sonsNote: "un petit bip dans les menus, jamais pendant une partie",
} as const;

/** Les phrases du lexique qui ne s'écrivent qu'ici: `mots.test.ts` refuse la
 * même phrase écrite en dur dans une autre source. `saves.ts` garde les trois
 * sauvegardes en clair, parce que le salon les y lit octet pour octet; un
 * essai vérifie qu'elles sont celles de `SAUVEGARDES`. */
export const LEXIQUE: readonly string[] = [
  ...Object.values(PLACE),
  ...Object.values(ENTREES),
  ...Object.values(SORTIES),
  ...Object.values(SAUVEGARDES),
  ...Object.values(SORTIES_MENU),
  TACTILE,
  MANETTE_SEULE,
  IMAGE.complete,
  IMAGE.legere,
  IMAGE.passer,
];

/** Quand une demande reste sans réponse.
 *
 * « Le salon ne répond pas. » nommait un programme que le joueur ne connaît
 * pas, et supposait une cause: une page peut aussi avoir perdu son réseau.
 * L'effet, puis l'action. */
export const SANS_REPONSE = "Pas de réponse. Réessaie dans un instant.";

/** L'état du son, en mots de joueur.
 *
 * Le navigateur dit `running`, `suspended` ou `closed`, et ces trois mots
 * anglais arrivaient tels quels dans le menu (audit T09). Un état inconnu le
 * dit, plutôt que de passer pour l'un des trois. */
export function etatDuSon(etat: string): string {
  switch (etat) {
    case "running":
      return "joue";
    case "suspended":
      return "en attente d'un geste";
    case "closed":
      return "arrêté";
    default:
      return "inconnu";
  }
}

/** Une faute de vocabulaire, trouvée dans une chaîne visible. */
export type Faute = { mot: string; raison: string };

/** Un mot ENTIER, accents compris.
 *
 * `\b` ne connaît que l'ASCII: « portée » se coupe après « port », puisque
 * « é » n'est pas une lettre pour lui, et la règle aurait refusé un mot
 * français. Les bornes regardent ici toutes les lettres Unicode. */
function entier(source: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, "iu");
}

/** Ce que l'on ne dit pas à un joueur.
 *
 * # Les mots d'atelier
 *
 * Ils sont permis dans les mesures techniques (`MesuresTechniques`), qui
 * servent au propriétaire, et nulle part ailleurs. Chaque motif dit pourquoi.
 *
 * « prise » n'est refusée qu'en nom: « une prise », « cette prise ». Le
 * participe reste français: « la Switch est prise », « les places sont
 * prises ». « port » est refusé en mot entier: « importer », « porte » et
 * « portée » passent. */
export const ATELIER: readonly { motif: RegExp; mot: string; raison: string }[] = [
  {
    motif: entier("salons?"),
    mot: "salon",
    raison: "le service, vu du joueur, n'a pas de nom: dire ce qui se passe",
  },
  { motif: entier("workers?"), mot: "worker", raison: "nom de programme" },
  { motif: entier("sockets?"), mot: "socket", raison: "nom de technique réseau" },
  { motif: entier("running|suspended"), mot: "running", raison: "état du navigateur, en anglais" },
  { motif: entier("ports?"), mot: "port", raison: "une place s'appelle une place" },
  {
    motif: entier(
      "(?:une|la|les|des|cette|ces|sa|ta|ma|chaque|aucune|quelle|autre)\\s+prises?|prises?\\s+libres?",
    ),
    mot: "prise",
    raison: "une place s'appelle une place",
  },
  { motif: /rééchantillonn/i, mot: "rééchantillonnage", raison: "mot de traitement du son" },
  { motif: entier("xenia"), mot: "Xenia", raison: "nom d'émulateur" },
  { motif: entier("ryubing"), mot: "Ryubing", raison: "nom d'émulateur" },
  { motif: entier("eden"), mot: "Eden", raison: "nom d'émulateur" },
  { motif: entier("dolphin"), mot: "Dolphin", raison: "nom d'émulateur" },
];

/** Les anciens noms, remplacés par un mot du lexique. Refusés partout. */
export const REMPLACES: readonly { motif: RegExp; mot: string; raison: string }[] = [
  {
    motif: /format réduit|\ben réduit\b/i,
    mot: "format réduit",
    raison: `dire « ${IMAGE.legere} »`,
  },
  {
    motif: /format plein|pleine taille/i,
    mot: "pleine taille",
    raison: `dire « ${IMAGE.complete} »`,
  },
  { motif: /qualité reçue/i, mot: "qualité reçue", raison: `dire « ${IMAGE.reglage} »` },
  { motif: /partie neuve/i, mot: "partie neuve", raison: `dire « ${SAUVEGARDES.neuve} »` },
  {
    motif: /pren(?:dre|ds|ez) une manette/i,
    mot: "prendre une manette",
    raison: "dire « prendre une place »",
  },
  {
    motif: /rendre (?:la|ma|sa|ta) manette/i,
    mot: "rendre la manette",
    raison: "dire « rendre ma place »",
  },
  { motif: /sans manette/i, mot: "sans manette", raison: "dire « sans place » ou « regarder »" },
  { motif: /manettes? libres?/i, mot: "manette libre", raison: "dire « place libre »" },
  { motif: /\bmanette [1-4]\b/i, mot: "manette N", raison: "dire « place N »" },
  {
    motif: /demande (?:ta|sa) manette/i,
    mot: "demande ta manette",
    raison: "dire « demande ta place »",
  },
  { motif: /décide du jeu/i, mot: "décide du jeu", raison: "dire « choisit le jeu »" },
  {
    motif: /après correspondance/i,
    mot: "après correspondance",
    raison: "dire « ce que le jeu reçoit »",
  },
];

/** Le tiret cadratin, refusé partout par les règles du dépôt. Écrit par son
 * code: le caractère lui-même dans ce fichier serait refusé par son essai. */
const CADRATIN = String.fromCodePoint(0x2014);

/**
 * Les fautes d'une chaîne visible.
 *
 * `technique` dit si la chaîne vit dans les mesures techniques: les mots
 * d'atelier y sont permis. Les anciens noms et le tiret cadratin ne le sont
 * nulle part.
 */
export function fautes(texte: string, technique = false): Faute[] {
  const trouvees: Faute[] = [];
  const noter = (faute: Faute) => {
    if (!trouvees.some((une) => une.mot === faute.mot)) trouvees.push(faute);
  };
  if (!technique)
    for (const regle of ATELIER)
      if (regle.motif.test(texte)) noter({ mot: regle.mot, raison: regle.raison });
  for (const regle of REMPLACES)
    if (regle.motif.test(texte)) noter({ mot: regle.mot, raison: regle.raison });
  if (texte.includes(CADRATIN)) noter({ mot: "tiret cadratin", raison: "une virgule ou un point" });
  return trouvees;
}

// ==== chantier salle ====

/** Ce que la page « manette seule » dit de ses touches (`lib/manette-seule`).
 * Rien n'est affirmé tant que rien n'est mesuré. */
export const LATENCE = {
  arrivent: "Tes touches arrivent.",
  attend: "La page attend la réponse de la salle.",
  lentes: (ms: number) => `Tes touches mettent ${ms} ms à arriver.`,
} as const;

/** L'image agrandie par Ctrl (`lib/fullscreen`) : la seule indication qui
 * reste, posée trois secondes dans une bande noire, jamais sur l'image. */
export const AGRANDIE = {
  pastille: "Image agrandie : Ctrl pour revenir à la salle",
  tactile: "Image agrandie",
} as const;

/** La colonne de la salle au bureau (`components/Colonne`) : des rangs
 * nommés en clair, une chose une fois. Les onglets « essentiel » et
 * « mesures » sont partis ; les mesures s'ouvrent depuis la ligne du coin. */
export const COLONNE = {
  rangs: "Commandes de la salle",
  role: "Ton rôle",
  regardent: "Ils regardent",
  personne: "Personne pour l'instant.",
  activerSon: "Activer le son",
  menu: "Menu du jeu",
  manette: "Ta manette",
  agrandir: "Agrandir l'image",
  autres: "Autres réglages",
  plusBas: "Plus bas",
  mesures: "Mesures de la liaison",
  revenir: "Fermer",
  panneau: "Les places",
} as const;

/** La vue des touches (`components/VueTouches`) : ce que chaque commande
 * presse sur la console de la salle. La coche dit « envoyée », jamais
 * « reçue » : la salle ne renvoie pas encore d'accusé par bouton. */
export const TOUCHES = {
  clavier: "Tes touches au clavier",
  manette: (nom: string) => `Ta ${nom}`,
  aConfigurer: "à configurer",
  revenir: "Revenir",
  changer: "Changer les touches",
  horsJeu: "Clique sur l'image pour que tes touches aillent au jeu.",
  legende: "Une case se coche quand la touche part au jeu.",
  envoyee: "envoyée",
} as const;

/** Le crédit de la borne (`components/Credit`), en casse normale : les
 * capitales viennent de la feuille. */
export const CREDIT = {
  placesLibres: (n: number) => `places libres ${n}`,
} as const;

/** Le temps de jeu (`components/TempsDeJeu`), dit en clair à côté de
 * l'afficheur, qui est caché au lecteur d'écran. */
export const TEMPS = {
  lisible: (secondes: number) => `${Math.floor(Math.max(0, secondes) / 60)} min de jeu`,
} as const;

/** Le nom de la zone de jeu (`components/Screen`), et ce que les touches y
 * font, au clavier seulement : Ctrl n'existe pas au doigt. */
export const ZONE = {
  nom: (jeu: string) => `${jeu}, l'image de la partie`,
  sansJeu: "L'image de la partie",
  aide: "Ctrl agrandit l'image, Échap ouvre le menu du jeu, Tab en sort.",
} as const;

/** L'écran éteint d'une salle sans jeu (`components/EcranEteint`). Il ne
 * s'ouvre plus rien d'office : l'écran dit qu'il n'y a pas de jeu, et qui
 * le choisit. */
export const REPOS = {
  titre: "Pas encore de jeu.",
  choisir: "Choisir un jeu",
  verras: "Tu le verras démarrer ici.",
} as const;

/** Une vraie manette dans une salle tenue en main (`ControllerStatus`) : la
 * bande dit laquelle joue et où, au lieu d'un avis posé sur les touches
 * (audit N1). « Manette » est l'objet qu'on tient ; les touches dessinées
 * gardent leur nom (`TACTILE`). */
export const BRANCHEE = {
  joue: (nom: string, place: number) => `Ta ${nom} joue à la place ${place}.`,
  verifier: "Vérifier les boutons",
  tactile: `Les ${TACTILE}`,
  tourne: "Tourne ton téléphone : l'image sera plus grande.",
} as const;

// ==== fin salle ====

// ==== chantier personnes ====

/** La pastille d'une place, « 1P » à « 4P », comme l'écran de sélection d'une
 * borne d'arcade (« P1 » jusqu'au 23 novembre 2026). Un numéro hors de 1 à 4
 * n'est pas une place : il n'a pas de pastille, plutôt qu'un « 0P » ou un
 * « 5P » sur un bouton. Pas d'exception non plus : le numéro vient du réseau,
 * et une exception dans un rendu viderait toute la page. */
export function pastille(place: number): string {
  return Number.isInteger(place) && place >= 1 && place <= 4 ? `${place}P` : "";
}

/** Les places START du panneau (`components/Places`) : le nom accessible de
 * chaque bouton dit la place, qui la tient et ce que fait un toucher, parce
 * que le dessin seul ne le dit à personne (audit A11Y-11). En casse normale :
 * les capitales d'arcade viennent de la feuille. */
export const PLACES = {
  /** Écrit sur sa propre place, à la place de son nom d'étiquette. */
  toi: "toi",
  /** Ce que dit une place sans nom à la place d'une étiquette. */
  vide: "libre",
  sansNom: "tenue",
  /** Le badge qui saute sur une place qui s'allume (effet « arrive »). */
  pret: "prêt !",
  /** Le bouton qui montre les quatre places quand la rangée en petit n'a
   * pas leur largeur. */
  toutes: (dites: string) => `Les places : ${dites}. Les voir dans la salle`,
  libre: (n: number) => `Place ${n}, libre : la prendre`,
  tenue: (n: number) => `Place ${n}, tenue : la reprendre`,
  aToi: (n: number) => `Place ${n} : la tienne`,
  aQuelquun: (n: number, nom: string) => `Place ${n} : ${nom}`,
  choisit: "choisit le jeu",
  tuChoisis: "tu choisis le jeu",
  microCoupe: "micro coupé",
  demander: "lui demander sa place",
  roleJoue: (n: number) => `Tu joues à la place ${n}.`,
  roleLibre: "Tu regardes : prends une place libre pour jouer.",
  rolePlein: "Tu regardes : touche la place d'un joueur pour la lui demander.",
  /** Le worker a donné ma place à quelqu'un d'autre. */
  deplace:
    "Quelqu'un a repris ta place. Choisis une place libre, ou demande la sienne à un joueur.",
} as const;

/** Les arrivées et les départs, dits une fois par la ligne parlée de la salle
 * (`lib/usePlaces`). Aucune durée qui avance : la ligne serait relue. */
export const ARRIVEES = {
  premiere: (nom: string, n: number) => `${nom} prend la place ${n}.`,
  retour: (nom: string, n: number) => `${nom} revient à la place ${n}.`,
  sansNom: (n: number) => `La place ${n} est prise.`,
  depart: (nom: string, n: number) => `${nom} rend la place ${n}.`,
  departSansNom: (n: number) => `La place ${n} est libre.`,
  prisePar: (n: number, nom: string) => `Ta place ${n} est à ${nom}. Tu regardes.`,
  regarde: (nom: string) => `${nom} regarde la partie.`,
} as const;

/** La carte d'une place (`components/CartePlace`) : demander la place de
 * quelqu'un selon la vraie règle du salon (20 s, puis la reprise confirmée),
 * reprendre une place sans nom, ou rendre la sienne. Aucune phrase genrée sur
 * l'autre personne, et plus de « est prévenu ». */
export const CARTE = {
  estA: (n: number, nom: string) => `La place ${n} est à ${nom}`,
  tenue: (n: number) => `La place ${n} est tenue`,
  personne: "Personne n'y est nommé : tu peux la reprendre.",
  delai: (nom: string, s: number, n: number) =>
    `${nom} a ${s} s pour répondre. Sans réponse, tu pourras prendre la place ${n}.`,
  demander: "Lui demander sa place",
  reprendre: (n: number) => `Reprendre la place ${n}`,
  chezLui: (nom: string) => `Ta demande est chez ${nom}`,
  annuler: "Annuler la demande",
  prendre: (n: number) => `Prendre la place ${n}`,
  silence: (nom: string) => `${nom} n'a pas répondu`,
  /** « Donner ma place » reçu par le salon (`accepted`). */
  laisse: (nom: string, n: number | null) =>
    n === null ? `${nom} te laisse choisir le jeu.` : `${nom} te laisse sa place ${n}.`,
  /** Un reste à 0 venu d'un salon qui ne dit pas encore `accepted`. */
  peux: (n: number | null) =>
    n === null ? "Tu peux choisir le jeu." : `Tu peux prendre la place ${n}.`,
  garde: (nom: string, n: number) => `${nom} garde sa place ${n}.`,
  ta: (n: number) => `Ta place ${n}`,
  tuJoues: (comment: string) => `Tu joues ${comment}.`,
  nom: "Ton nom se change entre deux parties, depuis l'avant-salle.",
  choix: "Le choix du jeu",
  choixA: (nom: string) => `${nom} choisit le jeu`,
  choisir: "Choisir le jeu",
  fermer: "Fermer",
  restant: (s: number) => `${s} s`,
  /** Comment je joue, sur la carte de ma place (`tuJoues`). */
  auClavier: "au clavier",
  auDoigt: "au doigt",
  aLaManette: "à la manette",
} as const;

/** La demande reçue (`components/DemandeRecue`) : jamais sur l'image, un
 * geste qui ne coûte rien en premier, et « Donner » qui s'annule 4 s. */
export const DEMANDE = {
  titre: (nom: string, n: number) => `${nom} demande ta place ${n}`,
  reprise: (s: number, nom: string) => `Sans réponse dans ${s} s, ${nom} pourra la prendre.`,
  ancienne: (s: number) => `Sans réponse dans ${s} s, tu la gardes.`,
  manette: "A sur ta manette garde ta place.",
  garder: "Garder ma place",
  donner: "Donner ma place",
  donne: (n: number, nom: string) => `Tu donnes ta place ${n} à ${nom}`,
  annuler: "Annuler",
  prise: (nom: string, n: number) => `${nom} a pris ta place ${n}.`,
  redemander: "Redemander une place",
  /** Le libellé du bouton « La salle » pendant une demande, en paysage. */
  libelle: (nom: string) => `${nom} · ta place`,
} as const;

/** Inviter quelqu'un (`components/Inviter`) : un panneau déplié dans la
 * colonne, le lien pour jouer ou pour regarder, son code, et la condition du
 * réseau privé, toujours dite. Une seule région parle : la ligne de la salle. */
export const INVITER = {
  bouton: "Inviter quelqu'un",
  legende: "Le lien ouvre la salle",
  pourJouer: "pour jouer",
  pourRegarder: "pour regarder",
  attend: (n: number) => `La place ${n} attend ton invité.`,
  pleine: "Aucune place libre : ton invité pourra regarder.",
  lien: "Le lien",
  copier: "Copier le lien",
  copierCourt: "Copier",
  envoyer: "Envoyer le lien",
  replier: "Replier l'invitation",
  copie: "Lien copié.",
  envoye: "Lien envoyé.",
  nonCopie: "Le lien n'a pas pu être copié. Il est sélectionné.",
  aLaMain: "Ton navigateur n'a pas pu copier : le lien est sélectionné, copie-le à la main.",
  reseau: "Le lien ne marche que pour qui est déjà sur le réseau privé de nel3ab.",
  code: (pour: string) => `Code QR du lien ${pour}`,
  tropLong: "Ce lien est trop long pour un code : copie-le.",
} as const;

/** L'heure d'un accusé, à la française : « 21 h 42 », « 9 h 05 ». */
export const heureDite = (d: Date): string =>
  `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;

/** Signaler un problème (`components/Signaler`) : un seul composant, posé au
 * premier rang de la colonne, dans la feuille, ou dans la fiche d'un état
 * (K25). En casse de phrase, comme ses voisins. */
export const SIGNALER = {
  pret: "Signaler un problème",
  court: "Signaler",
  envoi: "Envoi…",
  tenu: (s: number) => `Déjà signalé il y a ${s} s`,
  reste: (s: number) => `Tu pourras en envoyer un autre dans ${s} s.`,
  note: (heure: string) =>
    `C'est noté, à ${heure}. Les deux dernières minutes de mesures partent avec, pour la maison.`,
  sansReponse:
    "Le signalement n'est pas parti : le site ne répond pas. Il passe par le site, pas par la salle. Réessaie dès que la page le rejoint.",
  reessayer: "Réessayer",
} as const;

/** « Ils regardent » (`components/IlsRegardent`) : les spectateurs en
 * étiquettes tapées, et qui arrive sans place encore annoncée. */
export const REGARDENT = {
  arrive: (nom: string) =>
    `${nom} arrive : sa place n'est pas encore annoncée. Si c'est toi sur un autre appareil, recharge cette page pour la retrouver.`,
} as const;

/** Les mesures de la liaison (`components/Mesures`), au premier niveau : ce
 * que le joueur lit. Un chiffre qu'on n'a pas encore se dit « pas encore
 * mesuré », jamais une valeur de repli ni un zéro. Les mots d'atelier restent
 * sous le pli des mesures techniques. */
export const MESURES = {
  titre: "Ta liaison",
  /** La ligne du coin et « Ta liaison », quand rien ne manque. */
  toutArrive: "Tout arrive",
  saute: "L'image saute",
  peintes: (n: number) =>
    n < 2 ? `${n} image peinte par seconde` : `${n} images peintes par seconde`,
  jeu: (n: number) => `le jeu en fait ${n}`,
  sousLeJeu: "moins que le jeu",
  allerRetour: (ms: number) => `${ms} ms d'aller-retour pour tes touches`,
  pire: (ms: number) => `${ms} ms au pire entre deux images, une fois sur vingt`,
  pasEncore: "pas encore mesuré",
  peintesSans: "Images peintes par seconde",
  jeuSans: "Le jeu",
  allerRetourSans: "Aller-retour de tes touches",
  pireSans: "Écart au pire entre deux images",
  direct: "Trajet direct jusqu'à la salle.",
  relais: "Trajet par un relais : souvent plus lent, rarement la seule cause d'une saccade.",
  inconnu: "Trajet inconnu pour l'instant : la page n'a pas encore pu le lire.",
  legereRefusee: "L'image légère n'existe pas pour la taille d'image de ce jeu.",
  technique: "Mesures techniques, pour chercher une panne",
} as const;

/** Le champ du nom (`components/ChampNom`), à l'entrée et dans l'avant-salle :
 * un libellé visible, son aide, la raison d'un refus, et l'aperçu de
 * l'étiquette telle que les autres la verront. */
export const NOM = {
  libelle: "Ton nom",
  aide: "Il s'affiche sur ta place.",
  vide: "Tape ton nom pour entrer.",
  apercu: "Ton étiquette, telle que les autres la verront",
  coupe: "Ton nom sera coupé sur ta place.",
} as const;

// ==== fin personnes ====

// ==== chantier manettes ====

/** « B, Z et Start » : une liste de noms dite comme une phrase. */
const enPhrase = (noms: readonly string[]) =>
  noms.length <= 1 ? (noms[0] ?? "") : `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}`;

/** « la Xbox 360 », ou « le jeu » quand la console n'a pas de nom propre. */
const laConsole = (nom: string | null) => (nom ? `la ${nom}` : "le jeu");

/** Le panneau « Touches et manettes » (`manettes/reglage`), ses phrases et
 * ses boutons. La fin du pas à pas et la manette débranchée suivent. */
export const REGLAGE = {
  titre: "Touches et manettes",
  /** Au bout du panneau de commande : ouvre le panneau sur le clavier. */
  toutes: "Toutes les touches",
  fermer: "Fermer",
  /** La phrase de tête : `console` est nommée pour une salle Pro. */
  tete: (console: string | null) =>
    `Pendant ce réglage, ${laConsole(console)} ne reçoit pas tes appuis.`,
  autres: "Les autres continuent de jouer.",
  onglets: { manette: "Manette", clavier: "Clavier", profils: "Profils" },
  ongletsNom: "Ce que tu règles",
  recoit: (console: string | null) => `Ce que ${laConsole(console)} reçoit`,
  taManette: "Ta manette",
  aucune:
    "Cette page ne voit aucune manette. Le navigateur ne la montre qu'après un premier appui.",
  branche: "Branche-la, puis appuie sur un bouton.",
  /** La première manette vue par la page (`premiere-manette`), dite une fois. */
  arrivee: (nom: string) =>
    `${nom.charAt(0).toUpperCase()}${nom.slice(1)} branchée : elle apparaît à droite.`,
  standard: "branchée, disposition standard",
  nonStandard: "branchée, disposition non standard",
  adaptateur:
    "Le navigateur ne garantit pas la place des boutons de cet adaptateur. Règle-le pas à pas.",
  tuRegles: "Tu règles",
  plusieurs: (n: number, place: number | null) =>
    `${n} manettes parlent à cette page. Elles jouent toutes à ${place ? `ta ${placeN(place)}` : "ta place"}.`,
  regler: "Régler pas à pas",
  repos: "Lâche tout : boutons, sticks et gâchettes. Ton réglage d'avant reste si tu arrêtes.",
  commencer: "Commencer",
  annuler: "Annuler",
  etape: (n: number, total: number) => `Étape ${n} sur ${total}`,
  /** Devant le compteur « 03/16 » du pas à pas, que le lecteur d'écran ne lit pas. */
  etapeCourte: "Étape",
  appuie: (nom: string) => `Appuie sur ce que tu veux pour ${nom}.`,
  pousse: (sens: string) => `Pousse ${sens}.`,
  relache: "Relâche avant de continuer.",
  passer: "Passer cette commande",
  arreter: "Arrêter",
  reprendre: (etape: number) => `Reprendre à l'étape ${etape}`,
  daccord: "D'accord",
  reglerDans: (nom: string) => `Régler ${nom} dans la liste`,
  correspondances: "Toutes les correspondances",
  dansLeJeu: "Dans le jeu",
  changer: "Changer",
  changerNom: (nom: string) => `Changer ${nom}`,
  effacerNom: (nom: string) => `Effacer ${nom}`,
  rien: "aucune",
  attendManette: "Appuie sur un bouton de ta manette",
  attendTouche: "Appuie sur une touche",
  nombres: "Les nombres de ta manette",
  /** Le mot sous le trait de repos d’une jauge du banc. */
  reposDuBanc: (valeur: number) => `repos ${valeur.toFixed(2).replace(".", ",")}`,
  horodatage: "L'horodatage avance tant que la manette parle. Figé, elle ne dit plus rien.",
  lecture: "Ce que le jeu reçoit, vu comme",
  taPlace: "ta place",
  apercu: (appareil: string) =>
    `Aperçu seulement. Ta place présente ${appareil} au jeu : les actions du jeu suivent cet appareil.`,
  essai: "Clique ici, puis tape.",
  essaiNom: "Zone d'essai du clavier",
  touche: "Touche",
  oppose: (nom: string) => `${nom}, sens opposé`,
  bouton: "Bouton",
  axe: "Axe",
  inverse: "inversé",
  /** Le sens demandé d'un stick de la trame Pro : droite ou haut (D6). */
  sensPro: (gauche: boolean, haut: boolean) =>
    `le stick ${gauche ? "gauche" : "droit"} vers ${haut ? "le haut" : "la droite"}`,
  sticks: "Les sticks, direction par direction",
  nonTransmis: (xbox: boolean) =>
    xbox
      ? "Pas transmis au jeu : le bouton Guide."
      : "Pas transmis au jeu : Home, Capture, gyroscope.",
  retablirManette: "Rétablir la manette",
  retablirClavier: "Rétablir le clavier",
  retablir: "Rétablir",
  retablirQuestion: (quoi: "pad" | "key") =>
    `Rétablir ${quoi === "pad" ? "la manette" : "le clavier"} ? Tes changements seront remplacés par le réglage d'origine.`,
  retabli: "Réglage d'origine rétabli.",
  mesProfils: (console: string | null) => (console ? `Mes profils ${console}` : "Mes profils"),
  profilsClavier: "Profils du clavier",
  enService: "en service",
  defaut: "Profil par défaut",
  modifies: "réglages modifiés",
  nomProfil: "Nom",
  enregistrer: "Enregistrer ce profil sous",
  charger: "Charger",
  supprimer: "Supprimer",
  supprime: (nom: string) => `Le profil « ${nom} » est supprimé.`,
  /** Une copie de tes réglages attend l'accord du service (`enAttente`). */
  garde: "Gardé ici, envoi au prochain passage.",
  reessayer: "Réessayer maintenant",
  /** Les profils du clavier (`ProfilsDolphin`) : le nom d'une copie, la
   * référence de la salle, et la publication. */
  nomVide: "Donne un nom à la copie.",
  nomPris: "Ce nom existe déjà.",
  nomReserve: "Ce préfixe est réservé à la salle.",
  nomAide: (max: number) => `Un nom unique, ${max} caractères au plus.`,
  /** Une option de la liste des profils, quand c'est une référence. */
  referenceNom: (nom: string) => `${nom}, référence de la salle`,
  reference: "Référence de la salle. La modifier crée une copie à toi et garde l’original.",
  aToi: "Profil à toi. Tes changements s’appliquent tout de suite.",
  cree: (nom: string) => `Le profil « ${nom} » est créé et en service.`,
  publier: "Publier dans la salle",
  publication: "Publication…",
  publie: "Profil publié dans la salle.",
  publicationGardee: "Publication impossible. Tes réglages à toi sont gardés.",
  publicationPlusTard: "Publication impossible. Réessaie dans un instant.",
  /** Les avis de la trame Pro (`media/switch.ts`), que le panneau affiche
   * tels quels (`SwitchInput.message` et ses refus). */
  pro: {
    brancher: "Branche une manette et appuie sur un bouton.",
    debranchee: "Manette débranchée : assignation annulée.",
    assignee: "Commande assignée. Relâche le bouton ou le stick.",
    toucheAssignee: "Touche assignée.",
    attendTouche: "Appuie sur une touche. Échap pour annuler.",
    attendManette: "Appuie sur un bouton ou déplace le stick demandé. Échap pour annuler.",
    annulee: "Assignation annulée.",
    nom: (max: number) => `Donne un nom de 1 à ${max} caractères.`,
    plein: (n: number) => `${n} profils sont déjà enregistrés.`,
    absent: "Ce profil n’existe pas.",
    tropGrand: "Le fichier est trop grand.",
    invalide: "Ce fichier n’est pas un profil de manette valide.",
    nonRange:
      "Configuration active, mais ce navigateur n’a pas pu l’enregistrer. Exporte le profil pour le garder.",
  },
  exporter: "Exporter dans un fichier",
  importer: "Importer un fichier",
  tropGrand: "Fichier trop grand.",
  refuse: "Réglage refusé.",
  pret: "Charger un profil ne te déclare pas prêt.",
  /** Le profil Pro rangé : il part au service dès que la salle répond. */
  enregistre: "Profil enregistré. Il rejoint tes réglages personnels dès que la salle répond.",
  /** La fin du pas à pas, comptée. `passees` : les commandes passées, nommées
   * pour la console ; `garde` : ce qu'elles gardent (`FinDe` de la leçon). */
  fin: (retenues: number, passees: readonly string[], garde: "avant" | "standard" | "rien") => {
    if (retenues === 0) return "Aucune commande changée.";
    const reglees =
      passees.length === 0
        ? `Tes ${retenues} commandes sont réglées.`
        : retenues === 1
          ? "1 commande réglée."
          : `${retenues} commandes réglées.`;
    if (passees.length === 0) return reglees;
    const une = passees.length === 1;
    const reste =
      garde === "rien"
        ? une
          ? "elle reste sans réglage"
          : "elles restent sans réglage"
        : une
          ? "elle garde son réglage d'avant"
          : "elles gardent leur réglage d'avant";
    return `${reglees} Tu as passé ${enPhrase(passees)} : ${reste}. Tu peux ${une ? "la" : "les"} changer dans la liste.`;
  },
  /** Une manette débranchée au milieu du pas à pas : rien n'est écrit. */
  suspendu: (etape: number) =>
    `Ta manette s'est débranchée. Rien n'a changé. Le pas à pas est arrêté à l'étape ${etape} ; ton réglage d'avant est gardé.`,
} as const;

// ==== fin manettes ====

// ==== chantier etats ====
/** Les gestes des états de la salle. Leurs phrases vivent dans
 * `lib/liaison-mots.ts`, vérifiées par sa propre garde. */
export const ETAT = {
  relancer: "Relancer l'image",
  reessayer: "Réessayer",
  nonMerci: "Non merci",
  /** La réponse à l'avis de fermeture : la salle compte la place comme
   * active, sans que le jeu reçoive rien (D16, ADR D43). */
  rester: "Je reste",
  revenir: enBouton(`revenir en ${IMAGE.complete}`),
  garder: "Garder",
  /** Le lien d'une salle fermée vers le carnet du salon (D12). */
  parties: "Dernières parties",
  /** Ce qu'une salle fermée garde dans la colonne : le jeu et ceux qui
   * regardaient. Ceux qui ont joué sont sur le panneau, au passé. */
  ceSoir: (salle: number) => `Ce soir dans la salle ${salle}`,
  ontRegarde: "Ils ont regardé",
  /** Les places d'une salle fermée, au passé (`PlacesAuPasse`) : le groupe,
   * et une place que personne ne tenait. */
  ontJoue: "Ils ont joué",
  restaitLibre: (n: number) => `Place ${n}, libre`,
  /** Le pli de la fiche d'une image figée : les faits, ligne à ligne. */
  voit: "Ce que ta page voit",
  /** Les étapes de l'arrivée, dites pour un lecteur d'écran. */
  fait: "fait",
  enCours: "en cours",
} as const;
// ==== fin etats ====

// ==== chantier salon ====

/** L'avant-salle (`components/Lobby`), un seul dessin depuis le 24 novembre
 * 2026 : la borne de la salle et son panneau START 1P à 4P, comme à l'accueil
 * du salon. Les mots en casse normale ; les capitales d'arcade viennent de la
 * feuille quand un effet les demande. */
export const AVANT_SALLE = {
  autres: "Toutes les salles",
  bonjour: "Tu es",
  changer: "Changer ton nom",
  pasToi: "Ce n'est pas toi ?",
  garder: "Garder ce nom",
  annuler: "Annuler",
  nouveauNom: "Ton nouveau nom",
  aucunJeu: "Aucun jeu chargé",
  prendre: "Prendre",
  regarderSansPlace: "Regarder sans place",
  regarderLaPartie: "Regarder la partie",
  injoignable: "Les noms des joueurs ne s'affichent pas pour l'instant. Tu peux jouer quand même.",
  libre:
    "Prends une place libre, ou regarde sans place. Tu pourras changer de place dans la salle.",
  pleine: (n: number) =>
    `Les ${n} places sont prises. Entre pour regarder : une place peut se libérer.`,
  regarde: (noms: readonly string[]) =>
    `${new Intl.ListFormat("fr", { type: "conjunction" }).format(noms)} ${noms.length > 1 ? "regardent" : "regarde"}.`,
} as const;

/** « Qui joue ? » (`components/Entrance`), pour une page sans identité. */
export const QUI_JOUE = {
  titre: "Qui joue ?",
  intro:
    "Quatre manettes, une machine, une image. Ton nom sert à ce qu'une place puisse dire qui l'occupe, et à rien d'autre.",
  entrer: (salle: string | null) => (salle ? `Entrer dans la ${salle}` : "Entrer"),
  autreNom: "Cet appareil gardait un autre nom.",
} as const;

/** L'ouverture (`components/Ouverture`) : le squelette de la salle pendant
 * que le site dit qui on est, puis sa fin à huit secondes. */
export const OUVERTURE = {
  salle: (n: number) => `Salle ${n}`,
  ouvre: (n: number) => `On ouvre la salle ${n}…`,
  muet: "nel3ab ne répond pas encore.",
  depuis: (s: number) => `La page l'attend depuis ${s} secondes…`,
  reessayer: "Réessayer",
  entrerEnTantQue: (nom: string) => `Entrer en tant que ${nom}`,
  entrerQuandMeme: "Entrer quand même",
} as const;

/* Les pages du salon (accueil, dépôt, carnet) et leur en-tête commun.
 *
 * Elles sont du HTML servi par le salon, sans paquet: elles ne peuvent pas
 * importer ce fichier. Leurs mots y vivent quand même, depuis le 24 novembre
 * 2026, pour deux raisons. La charte les juge (`mots.test.ts` lit ces
 * tables): le dépôt disait « l'administrateur du salon », un nom de programme
 * que le joueur ne connaît pas, et l'accueil « Pas de réponse : réessaie »
 * quand la salle dit « Pas de réponse. Réessaie ». Et un mot du lexique s'y
 * écrit par le lexique (`ENTREES.regarder`, `SAUVEGARDES`).
 *
 * `salon-retro.test.ts` écrit ces tables dans `retro/mots.json`, une clé
 * `groupe.cle` par texte, et la compare. `retro.py` les pose: un texte fixe
 * par une marque `<!--MOT:groupe.cle-->`, une phrase calculée par
 * `mots("groupe.cle", { trou: valeur })` dans le script de la page. Un trou
 * s'écrit `{nom}`. Une clé inconnue lève une erreur au démarrage du salon.
 *
 * Des tables plates, une par page: la garde de la charte ne lit que les
 * chaînes posées directement dans une constante en capitales. */

/** L'en-tête commun des trois pages (`retro/bandeau.html`). `logo` est le
 * nom du lien du logo: Aïn peint, le logo statique est caché et sa toile
 * muette, et le lien ne tirait plus son nom de rien. */
export const SALON_ENTETE = {
  logo: "nel3ab, les salles",
  pages: "Les pages",
  salles: "Les salles",
  carnet: "Ton carnet",
  depot: "Déposer un jeu",
  tuEs: AVANT_SALLE.bonjour,
  changerNom: AVANT_SALLE.changer,
} as const;

/** Ce que plusieurs pages du salon disent pareil. */
export const SALON_COMMUN = {
  moinsDUneMinute: "moins d'une minute",
  quelquun: "quelqu'un",
  sansReponse: SANS_REPONSE,
} as const;

/** L'accueil: la rangée de bornes, la mire, l'accroche et le panneau. */
export const SALON_ACCUEIL = {
  onglet: "nel3ab · les salles",
  horloge: "L'heure du dernier relevé de la liste",
  compris: "Compris",
  ouvrirUne: "Ouvrir une salle",
  recharger: "Recharger la page",
  start: "Appuie sur Start",
  /** Les nombres dits en lettres, de zéro à quatre, séparés par une espace. */
  nombres: "zéro une deux trois quatre",
  vientDeSOuvrir: "la salle {n} vient de s'ouvrir",
  sEstFermee: "la salle {n} s'est fermée",
  passeA: "la salle {n} passe à {jeu}",
  revientAuMenu: "la salle {n} revient à son menu",
  lesPlaces: "Les places de la salle {n}",
  regarder: ENTREES.regarder,
  /** Après l'étiquette du chef: `chefChoisit` sans le nom. */
  choisit: "choisit le jeu.",
  regarde: "regarde.",
  regardent: "regardent.",
  prendre: AVANT_SALLE.prendre,
  prendreLaPlace: "Prendre la place {place}",
  prendreLaPlaceDe: "Prendre la place {place} de la salle {n}",
  placeDe: "Place {place} : {nom}",
  placeInconnue: "Place {place} : la salle ne la dit pas encore",
  redemarre: "Salle {n}, elle redémarre…",
  muette: "Salle {n}, elle ne répond pas.",
  ouverte: "Salle {n}, ouverte.",
  ouverteDepuis: "Salle {n}, ouverte depuis {duree}.",
  placesQuandElleRepond: "Ses places s'affichent dès qu'elle répond.",
  quatrePrises: "Les 4 places sont prises.",
  unePlaceLibre: "Une place libre.",
  placesLibres: "{nombre} places libres.",
  aucunJeu: "Aucun jeu pour l'instant",
  regarderLaSalle: "Regarder la salle {n}",
  ouvrirLaSalle: "Ouvrir la salle {n}",
  eteinte: "Salle {n}, éteinte.",
  horsAntenne: "Hors antenne",
  rienNeTourne: "Aucune salle ne tourne, donc rien ne consomme sur le serveur.",
  demo: "Démo · touche une touche pour reprendre",
  listeDate: "La liste date de {h} h {mm}.",
  plusAJour: "Elle ne se met plus à jour : recharge la page.",
  ouverteTaPlace: "La salle {n} est ouverte : prends la place {place}.",
  estOuverte: "La salle {n} est ouverte.",
  choisirasDedans: "Tu choisiras le jeu une fois dedans.",
  aucuneCeSoir: "Aucune salle ouverte ce soir.",
  ouvreUne: "Ouvre une salle : tu choisiras le jeu une fois dedans.",
  uneTAttend: "Joue en salle {n} : une place t'attend.",
  tAttendent: "Joue en salle {n} : {nombre} places t'attendent.",
  ouUneAutre: "Ou ouvre une autre salle, pour un autre jeu.",
  toutesPrises: "Toutes les places sont prises : regarde une partie.",
  placesQuandUneRepond: "Les places s'affichent dès qu'une salle répond.",
  sOuvre: "La salle s'ouvre…",
  pasEncoreRepondu: "Elle n'a pas encore répondu.",
  credit: "Salles ouvertes {n}",
  creditLibres: "Salles ouvertes {n} · Places libres {libres}",
  refusOuvrir: "La salle n'a pas voulu s'ouvrir.",
  revient: "La salle {n} redémarre : elle revient dans quelques secondes.",
  neRepondPas: "La salle {n} ne répond pas.",
  deNouveau: "La salle {n} est de nouveau ouverte.",
  fermee: "La salle {n} s'est fermée.",
  fermeeInactivite: "La salle {n} s'est fermée faute d'activité.",
  fermeePanne: "La salle {n} s'est fermée après une panne.",
  rouvrir: "Tu peux la rouvrir : les sauvegardes sont intactes.",
  cetteSalle:
    "Cette salle s'est fermée, et le jeu avec elle. Tu peux en rouvrir une : les sauvegardes sont intactes.",
} as const;

/** Le dépôt: la rangée, la zone, les envois, les droits et les jaquettes.
 *
 * Les preuves de l'estimation (« « HEAD » à 0x100 ») restent dans
 * `importer.mjs`: ce sont des mesures du fichier, des octets et des
 * positions, pas des phrases. */
export const SALON_DEPOT = {
  onglet: "nel3ab · déposer un jeu",
  chapeau:
    "Lâche un ou plusieurs fichiers de jeu, ou une archive. La page estime la console en lisant le début du fichier. Le serveur relit ensuite le fichier entier, reconnaît la console, puis range le jeu dans la bibliothèque.",
  bibliotheque: "La bibliothèque",
  zone: "Pose tes fichiers ici, ou",
  zoneSurvol: "Lâche-les : ils se rangent dès qu'ils sont lus.",
  choisir: "Choisir des fichiers",
  rangees:
    "Les jeux {consoles} sont rangés tout de suite; mises à jour, contenus additionnels et autres consoles restent de côté, avec la raison.",
  reserve:
    "Déposer un jeu est réservé à l'administrateur de nel3ab et aux personnes qu'il a nommées. Demande-lui de t'ajouter, ou envoie-lui le fichier.",
  quiPeut: "Qui peut déposer",
  quiPeutSous:
    "Les personnes qui ont accès à nel3ab, d'après le tailnet et les noms déjà choisis. Donne le droit de déposer à qui doit pouvoir ranger des jeux; tu peux le retirer quand tu veux.",
  peuvent: "Peuvent déposer",
  peuventPas: "Ne peuvent pas",
  personneDAutre: "Personne d'autre que toi.",
  toutLeMonde: "Tout le monde peut déposer.",
  jaquettes: "Les jaquettes",
  jaquettesSous:
    "L'image d'un jeu s'affiche sur sa borne, à l'accueil, et dans le menu d'une salle. Dépose un PNG d'un Mio au plus : il passe avant la bannière du disque, et une salle le montre à son prochain démarrage.",
  pied: "Un envoi coupé reprend où il s'était arrêté: redépose le même fichier, même après avoir fermé la page. Après un dépôt, le bouton ouvre une salle, où le jeu rangé est déjà là, ou rejoint celle qui est ouverte: elle le montre à son prochain changement de jeu.",
  pause: "Pause",
  reprendre: "Reprendre",
  annuler: AVANT_SALLE.annuler,
  retirer: "Retirer",
  auDebut: "Au début du fichier :",
  jouer: "Jouer maintenant",
  allerDans: "Aller dans la salle {n}",
  auProchainJeu: "Le jeu apparaîtra au prochain changement de jeu.",
  compte: "{pourcent} % · {recus} sur {taille}",
  debit: "{debit}/s · reste {duree}",
  nonReconnue: "console non reconnue au début du fichier",
  lueParLeServeur: "{format} · console lue par le serveur",
  lecture: "lecture du début du fichier…",
  empreinte: "calcul de l'empreinte rapide…",
  dejaLa: "Déjà dans la bibliothèque: {fichier}.",
  refusStatut: "refus {statut}",
  enCours: "envoi en cours",
  coupee: "La connexion a coupé. « Reprendre » repart d'où le serveur en est.",
  nouvelEssai: "connexion coupée, nouvel essai ({n}/{max})…",
  verification: "vérification par le serveur: empreinte complète, console, rangement…",
  perdu: "le serveur ne retrouve plus cet envoi",
  verifie: "vérification par le serveur…",
  archive: "{n} fichiers dans l'archive",
  enPause: "en pause",
  arrete: "Arrêté à {pourcent} %. Redépose « {nom} » pour reprendre.",
  echec: "La vérification a échoué",
  reparer: "{raison}. Retire-le, puis redépose « {nom} » pour réessayer.",
  dans: "dans {destination}",
  administrateur: "administrateur",
  configuration: "droit fixé par la configuration",
  partage: "arrive par un partage du tailnet",
  tailnet: "sur le tailnet",
  connu: "a déjà un nom ici",
  enLigne: "en ligne maintenant",
  appareils: "sur {n} appareils",
  parti: "n'est plus sur le tailnet",
  retirerLeDroit: "Retirer le droit",
  donnerLeDroit: "Donner le droit",
  gesteA: "{geste} à {nom} ({login})",
  tailnetMuet:
    "Le tailnet n'a pas répondu : la liste ne montre que les personnes déjà venues et celles qui ont le droit.",
  droitsIlisibles:
    "Le fichier des droits ne se lit pas, donc rien n'y sera écrit. Répare-le ou retire-le, puis redémarre nel3ab.",
  rienNAChange: "Rien n'a changé: {detail}.",
  sansReponse: "pas de réponse",
  peutDeposer: "{nom} peut maintenant déposer des jeux.",
  nePeutPlus: "{nom} ne peut plus déposer de jeux.",
  imageTropGrande: "L'image dépasse un Mio.",
  imageAdministrateur: "Seul l'administrateur de nel3ab change une image.",
  imageNonGardee: "L'image n'a pas été gardée. Réessaie dans un instant.",
  pileUn: "Sur la pile : 1 envoi pas encore rangé.",
  pile: "Sur la pile : {n} envois pas encore rangés.",
  pasLue: "La bibliothèque n'a pas encore été lue : ouvre une salle une fois.",
  unJeu: "1 jeu dans la bibliothèque.",
  jeux: "{n} jeux dans la bibliothèque.",
  aucuneLue: "Aucune salle n'a encore lu la bibliothèque : ouvre une salle une fois.",
  deposerImage: "Déposer une image",
  deposerImagePour: "Déposer une image pour {jeu}",
  retirerImage: "Retirer l'image",
  retirerImageDe: "Retirer l'image de {jeu}",
  imageGardee: "Image gardée.",
  imageRetiree: "Image retirée.",
  envoiEchoue: "L'envoi a échoué ({message}). Redépose « {nom} » pour reprendre.",
} as const;

/** Le carnet: le tableau des dernières parties, les sauvegardes, le nom. */
export const SALON_CARNET = {
  onglet: "nel3ab · ton carnet",
  ouvre: "On ouvre ton carnet…",
  voirSalles: "Voir les salles",
  dernieres: "Dernières parties",
  quand: "Quand",
  jeu: "Jeu",
  duree: "Durée",
  lanceePar: "Lancée par",
  sauvegarde: "Sauvegarde",
  aucune: "Aucune partie notée pour l'instant.",
  plusAnciennes: "Voir les plus anciennes",
  reessayer: OUVERTURE.reessayer,
  sauvegardes: "Tes sauvegardes",
  etiquette: "Ton étiquette",
  nomChamp: "Ton nom, tel que les autres le voient",
  etiquetteApercu: "Ton étiquette :",
  garder: AVANT_SALLE.garder,
  annuler: AVANT_SALLE.annuler,
  perso: SAUVEGARDES.perso,
  debloque: SAUVEGARDES.debloque,
  neuve: SAUVEGARDES.neuve,
  /** `{de}` est « de Bo » ou « d'Ami », élidé comme `de`. */
  duLanceur: "la sauvegarde {de}",
  inconnue: "inconnue",
  avec: "Tu as joué avec {noms}.",
  /** Un joueur et sa pastille (`pastille`): « Ben (2P) ». */
  joueur: "{nom} ({place}P)",
  aRegarde: "{noms} a regardé.",
  ontRegarde: "{noms} ont regardé.",
  consoleSalle: "{console} · salle {n}",
  enCours: "en cours",
  dureeInconnue: "durée inconnue",
  toi: "toi",
  aucuneSauvegarde: `Aucune sauvegarde à toi pour l'instant. Lance un jeu sur « ${SAUVEGARDES.perso} » et elle apparaîtra ici.`,
  ecrite: "écrite le {jour} à {heure}",
  encoreVide: "encore vide",
  aucuneVersion: "Aucune version précédente gardée",
  uneVersion: "{n} version précédente gardée",
  versions: "{n} versions précédentes gardées",
  octets: "{n} octets",
  nomVide: "Écris un nom : les autres te voient par lui.",
  nomRefuse: "Le nom n'a pas été gardé. Réessaie dans un instant.",
  vide: "{pseudo}, ton carnet est encore vide. Il commence à ta première partie dans une salle.",
  resume: "{pseudo}, {parties} sur {jeux} : {duree} de jeu en tout.",
  resumeDepuis: "{pseudo}, {parties} sur {jeux} depuis le {date} : {duree} de jeu en tout.",
  unePartie: "{n} partie",
  parties: "{n} parties",
  unJeu: "{n} jeu",
  jeux: "{n} jeux",
  uneInconnue: "{n} partie sans fin connue ne compte pas dans ce temps.",
  inconnues: "{n} parties sans fin connue ne comptent pas dans ce temps.",
  sansIdentite: "nel3ab ne sait pas qui tu es sur cet appareil.",
  jouerQuandMeme: "Tu peux quand même jouer : entre dans une salle, et donne ton nom à l'entrée.",
  neSOuvrePas: "Le carnet ne s'ouvre pas.",
  rechargeDansUnInstant: "Pas de réponse. Recharge la page dans un instant.",
} as const;

/** Les mots du salon, une clé `groupe.cle` par texte: ce que
 * `retro/mots.json` doit contenir. Une fonction et pas une constante: la page
 * de la salle ne l'appelle pas, et le paquet la laisse de côté. */
export function motsDuSalon(): Record<string, string> {
  const groupes = {
    entete: SALON_ENTETE,
    commun: SALON_COMMUN,
    accueil: SALON_ACCUEIL,
    depot: SALON_DEPOT,
    carnet: SALON_CARNET,
  };
  const table: Record<string, string> = {};
  for (const [groupe, mots] of Object.entries(groupes))
    for (const [cle, texte] of Object.entries(mots)) table[`${groupe}.${cle}`] = texte;
  return table;
}

// ==== fin salon ====

// ==== chantier menus ====

/** Le menu unique de la salle (chantier menus, 24 novembre 2026) : quatre
 * rubriques en onglets, nommées en casse de phrase (M5). Les capitales
 * d'arcade, quand le niveau les veut, viennent du CSS. */
export const MENU = {
  /** Le nom du menu pour un lecteur d'écran : celui du rang qui l'ouvre. */
  nom: "Menu du jeu",
  /** La tête de la rubrique Salle (M10) : l'étiquette du chef, puis ceci. */
  choisitLeJeu: "choisit le jeu.",
  tuChoisis: "Tu choisis le jeu.",
  /** La ligne Signaler, quand le menu remplace la colonne (K25). */
  signaler: "Signaler un problème",
  rubriques: {
    jeux: "Jeux",
    manettes: "Manettes",
    salle: "Salle",
    reglages: "Réglages",
  },
  /** Ce que deviennent tes touches, en tête du menu (M3a). */
  tesTouches: "Le jeu continue pour les autres. Tes touches pilotent ce menu.",
  /** Le même, pour qui regarde : il n'a rien à piloter. */
  regarde: "L'image continue, pour toi comme pour les autres.",
  /** Qui regarde, quand le menu prend la place de l'écran et cache l'image
   * (téléphone couché, image 16:9) : elle ne continue plus « pour toi ». */
  regardeCachee: "L'image continue pour les autres. Elle revient à la fermeture.",
  /** Les groupes de Réglages (M7a). */
  groupes: {
    image: "Image et son",
    appareil: "Cet appareil",
    avances: "Réglages avancés",
    manette: "Ta manette",
    wii: "Jeux Wii",
    telephone: "Ce téléphone",
  },
  /** Une ligne sans aide encore n'est pas vide pour autant : elle se lit. */
  aucuneLigne: "Rien ici pour l'instant.",
  /** Le pied, nommé pour un lecteur d'écran. */
  pied: "Touches du menu",
  /** La rubrique Manettes (M9). */
  touches: "touches et manettes",
  clavier: "toutes les touches du clavier",
  aideClavier: "Chaque touche du clavier, et ce qu'elle fait dans le jeu.",
  attendCorrespondances: "La manette branchée attend ses correspondances.",
  profilClavier: (nom: string) => `Profil clavier « ${nom} ».`,
  appareilWii: "appareil des jeux Wii",
  /** Ce qui suit un nouvel appareil Wii, selon le jeu en cours. */
  wiiRelance: "Passer à la Wiimote relance le jeu.",
  wiiSansRelance: "Entre Nunchuk et guitare, rien ne relance.",
  wiiProchain: "Appareil du prochain jeu Wii.",
  aideTactile: "Pour jouer au téléphone, avec ou sans clavier et manettes.",
  avecImage: "non, avec l'image",
  sansImage: "oui, sans image",
} as const;

/** La fiche d'une décision, dans le menu (M10, M15) : elle dit ce que le
 * geste fait, et un bouton revient sans rien faire. */
export const FICHE = {
  revenir: "Revenir à la liste",
  continuer: "Continuer à jouer",
  lancer: "Lancer",
  /** Le nom de la liste des sauvegardes d'une fiche. */
  sauvegarde: "Sauvegarde",
  /** Le résumé de la connexion mène au détail. */
  detail: "Voir le détail",
  /** La fermeture demandée, comme état de la ligne et de sa fiche (P10). */
  fermeture: "fermeture…",
  fermetureEnCours: "Fermeture du jeu en cours…",
} as const;

/** La bibliothèque : les rangées de l'écran éteint et la fiche d'un jeu
 * (B1 à B11, `lib/bibliotheque`). */
export const BIBLIO = {
  /** Le nom de la bibliothèque pour un lecteur d'écran. */
  nom: "Les jeux de la salle",
  titre: (console: string, n: number) => `${console}, ${n} ${n > 1 ? "jeux" : "jeu"}`,
  /** La note d'une console à l'essai, sous le titre de sa rangée. */
  essai: "Un jeu peut ralentir ou s'arrêter.",
  /** Ce qui suit « Lancer » (`suiteDuLancement`). */
  toutDeSuite: "Le jeu part tout de suite.",
  chacunPret: "Chacun dit qu'il est prêt, puis le jeu part.",
  /** Ce que « Lancer » arrête (`consequence`). */
  arrete: (jeu: string, n: number, assis: boolean) =>
    n === 0
      ? `${jeu} s'arrête.`
      : n === 1
        ? `${jeu} s'arrête ${assis ? "pour toi" : "pour 1 joueur"}.`
        : `${jeu} s'arrête pour les ${n} joueurs.`,
  repart: "La partie repart de la sauvegarde choisie.",
  relancer: "Relancer",
  /** Qui ne choisit pas lit la fiche, sans « Lancer » (B8). */
  choisit: (nom: string) => `${nom} choisit le jeu et la sauvegarde.`,
  pasJouable: "Cette console n'est pas encore jouable ici.",
  /** Le dernier jeu de la salle (D06), sous les rangées. */
  dernier: (titre: string, quand: string) => `Le dernier jeu de cette salle : ${titre}, ${quand}.`,
  ouvrirFiche: "Ouvrir sa fiche",
} as const;

/** La préparation à plusieurs, en bloc dans la colonne (P1 à P9). Le titre
 * dit qui lance ; la console et la sauvegarde viennent dessous, sans
 * sur-titre en capitales (P4). */
export const PREPARATION = {
  /** Le nom du bloc pour un lecteur d'écran. */
  nom: "Préparation du lancement",
  moi: "Tu prépares le prochain jeu",
  lance: (nom: string) => `${nom} lance le prochain jeu`,
  /** Le nom de qui lance, quand la préparation ne le dit pas. */
  quelquun: "Quelqu'un",
  /** La ligne du jeu, sous le titre. */
  sauvegarde: (slot: string) => `Sauvegarde : ${slot}`,
  avecQuoi: "Avec quoi joues-tu ?",
  appareil: (nom: string) => `Ton appareil : ${nom}`,
  essayer: "Essayer mes touches",
  /** Qui regarde lit le compte, sans bouton (P9). */
  prets: (n: number, sur: number) =>
    n === 0
      ? `Aucun joueur sur ${sur} n'est prêt.`
      : `${n} ${n > 1 ? "joueurs" : "joueur"} sur ${sur} ${n > 1 ? "sont prêts" : "est prêt"}.`,
  regarde: "Tu regardes. Prends une place pour participer.",
  annuler: "Annuler le lancement",
  /** Un jeu tourne : l'annulation le garde (P6). */
  garder: (jeu: string) => `Garder ${jeu}`,
  /** Tenu en main, la bande dit la préparation en une ligne et ouvre le
   * bloc dans la feuille (P8). */
  choisir: "Choisir ma manette",
  voir: "Voir qui est prêt",
} as const;

/** L'écran de chargement (`Booting`, C5, C12, D05). */
export const CHARGEMENT = {
  titre: (jeu: string) => `${jeu} démarre.`,
  habitude: (s: number) => `D'habitude, il démarre en ${Math.round(s)} s.`,
  plusLong: "Le jeu met plus longtemps que d'habitude.",
  /** Sans habitude mesurée, la lenteur se dit sans « d'habitude ». */
  encore: (s: number) => `Le jeu démarre encore, depuis ${s} s.`,
  /** Calé : aucune image depuis le lancement (C4). */
  aucuneImage: (duree: string) => `Aucune image en ${duree}.`,
  /** À qui ne choisit pas le jeu, quand il n'a pas démarré (C7a). */
  relancePar: (nom: string | null) =>
    `${nom ?? "Qui choisit le jeu"} peut le relancer ou choisir un autre jeu.`,
  /** Les trois étapes, dans l'ordre de `STEPS` (C4). */
  etapes: ["La salle a reçu la demande", "Le jeu démarre", "Première image"],
  /** Ce que dit chaque case à qui ne la voit pas. */
  cases: {
    faite: "faite",
    "en-cours": "en cours",
    "a-venir": "à venir",
    inconnue: "on ne sait pas",
    echec: "pas arrivée",
  },
  arreter: "Arrêter le lancement",
  autre: "Choisir un autre jeu",
  /** Sur quelle sauvegarde (C6). */
  taSauvegarde: "Sur ta sauvegarde.",
  saSauvegarde: "l'a lancé sur sa sauvegarde.",
  sur: (save: string) => `Sur « ${save} ».`,
} as const;

/** « Manette seule » en une aide du menu, sous 70 caractères (M8) : la
 * phrase de `prixManetteSeule` (salle), et son chiffre seulement là où il a
 * été mesuré. Posée ici, dans le bloc du chantier qui la lit (relecture du
 * 24 novembre 2026 : elle était entrée dans la section de la salle). */
export function aideManetteSeule(moteur: string | null | undefined): string {
  return moteur === "dolphin"
    ? "Sans image ni son : 13,6 Mbit/s de wifi rendus par appareil."
    : "Sans image ni son : du wifi et de la batterie rendus.";
}

// ==== fin menus ====

// ==== chantier mascotte ====
/** Les mots de la maison d'Aïn (ADR D46). */
export const MASCOTTE = {
  /** Le nom du logo du coin, maison d'Aïn, pour un lecteur d'écran : le nom
   * du site, que le logo de l'en-tête de la colonne disait avant de
   * descendre au pied (relecture d'Aïn, 24 novembre 2026). */
  logo: "nel3ab",
} as const;
// ==== fin mascotte ====
