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
 *   « prendre une place », « rendre ma place ».
 * - **manette**: l'objet qu'on tient, et lui seul. « Aucune manette détectée. »
 * - **P1 à P4**: la pastille de couleur d'une place, jamais un nom.
 * - **chef**: la personne qui choisit le jeu. « Le chef choisit le jeu. »
 * - **nouvelle partie**, **tout débloqué**, **ma sauvegarde**: les trois
 *   sauvegardes. Aux autres: « la sauvegarde de Bo ».
 * - **image complète**, **image légère**: les deux qualités de l'image.
 * - **regarder**: être là sans place.
 * - **quitter la salle**: la seule sortie, vers les autres salles.
 */

/** Une place, par son numéro. */
export const placeN = (numero: number): string => `place ${numero}`;

/** Combien de places restent, en toutes lettres. */
export function placesLibres(nombre: number): string {
  if (nombre <= 0) return "aucune place libre";
  return nombre === 1 ? "1 place libre" : `${nombre} places libres`;
}

/** Combien de places sont prises. */
export function placesPrises(nombre: number): string {
  if (nombre <= 0) return "aucune place prise";
  return nombre === 1 ? "1 place prise" : `${nombre} places prises`;
}

/** Le rôle du chef, dit une fois et en clair (audit T12). */
export const CHEF = "Le chef choisit le jeu.";

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

/** « de Bo », « d'Ami »: l'élision devant une voyelle ou un h muet supposé. */
export function de(nom: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
}

/** La sauvegarde de quelqu'un d'autre, vue par les autres joueurs. */
export const sauvegardeDe = (nom: string): string => `la sauvegarde ${de(nom)}`;

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
  prix: "environ 2,6 fois moins de débit",
} as const;

/** Les sorties, chacune sous un seul nom (audit P8). */
export const SORTIES = {
  /** La seule sortie de la salle: elle mène aux autres salles. */
  quitter: "Quitter la salle",
  /** Le lien vers la liste des salles, depuis l'avant-salle. */
  autres: "autres salles",
  /** Rester dans la salle sans place. */
  regarder: "Regarder",
} as const;

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
  { motif: /format réduit/i, mot: "format réduit", raison: `dire « ${IMAGE.legere} »` },
  {
    motif: /format plein|pleine taille/i,
    mot: "pleine taille",
    raison: `dire « ${IMAGE.complete} »`,
  },
  { motif: /qualité reçue/i, mot: "qualité reçue", raison: `dire « ${IMAGE.reglage} »` },
  { motif: /partie neuve/i, mot: "partie neuve", raison: `dire « ${SAUVEGARDES.neuve} »` },
  {
    motif: /prendre une manette/i,
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
  if (!technique)
    for (const regle of ATELIER)
      if (regle.motif.test(texte)) trouvees.push({ mot: regle.mot, raison: regle.raison });
  for (const regle of REMPLACES)
    if (regle.motif.test(texte)) trouvees.push({ mot: regle.mot, raison: regle.raison });
  if (texte.includes(CADRATIN))
    trouvees.push({ mot: "tiret cadratin", raison: "une virgule ou un point" });
  return trouvees;
}
