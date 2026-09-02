/**
 * Où se trouve chaque commande sur une manette, en schéma.
 *
 * # Des coques dessinées, pas des photos
 *
 * Ce qu'on cherche est de pouvoir DÉSIGNER une touche: « celle-là, en haut à
 * droite ». Le moyen le plus sûr est que la silhouette évoque la vraie coque et
 * ses détails: la manette GameCube a deux poignées inégales et un grand A au
 * milieu de son losange, une Wiimote est une baguette qui se termine en
 * s'élargissant, une PlayStation a son pavé tactile en haut et son stick droit
 * plus bas que le gauche.
 *
 * On ne colle pas de photo: la page est un fichier unique de 127 ko qui tient
 * dans un budget, s'affiche sur sept ambiances et doit rester nette à toute
 * taille. Les coques sont donc des chemins SVG, à plat, avec trois tons (le
 * boîtier, son liseré, et un ton de creux pour les puits et les pavés) et une
 * ombre légère. De quoi reconnaître le modèle à distance et son détail de près,
 * à un prix qui tient dans un fichier de données.
 *
 * # Des DONNÉES et pas du balisage
 *
 * Deux manettes à l'écran — celle que le jeu voit et celle qu'on tient — et
 * une Wiimote et une guitare. Un composant qui dessine n'importe quel plan
 * coûte un fichier; quatre composants qui dessinent chacun le leur coûtent
 * quatre fichiers qui divergent.
 *
 * Le repère va de 0 à 100 en largeur et de 0 à 62 en hauteur, sans unité: c'est
 * le composant qui décide de la taille réelle.
 */

/** La couleur qui IDENTIFIE une touche, quand elle en a une.
 *
 * Sur une manette GameCube on reconnaît le A au vert avant d'avoir lu son
 * étiquette; c'est la même chose d'une PlayStation à ses symboles. Les valeurs
 * sont celles des vraies manettes: A vert, B rouge, X bleu, Y jaune, la croix
 * PlayStation bleue, le carré violet.
 *
 * Choisies assez soutenues pour tenir sur les sept ambiances, claires comprises,
 * et le pilote `just browser-contraste` vérifie que leurs étiquettes se lisent.
 */
export const TINTS = {
  vert: "#2f9e5e",
  rouge: "#c8402f",
  violet: "#7a5bb5",
  jaune: "#c8a01f",
  bleu: "#3c7dc7",
  gris: "#6e6e7a",
} as const;

/**
 * Un symbole DESSINÉ dans la pièce, en chemin SVG autour de l'origine.
 *
 * La croix, le carré, le rond et le triangle d'une PlayStation s'écrivent en
 * texte, mais aucune des polices de la page ne garantit de les porter, et un
 * caractère absent rend un carré vide sans que rien ne le signale. On les
 * dessine donc — un trait qui tient dans le disque de la pièce, avec les mêmes
 * règles de couleur que les étiquettes.
 */
export const GLYPHS = {
  triangle: "M -1.9 -1.35 L 1.9 -1.35 L 0 1.9 Z",
  croix: "M -1.7 -1.7 L 1.7 1.7 M 1.7 -1.7 L -1.7 1.7",
  rond: "M -1.75 0 A 1.75 1.75 0 1 0 1.75 0 A 1.75 1.75 0 1 0 -1.75 0",
  carre: "M -1.5 -1.5 L 1.5 -1.5 L 1.5 1.5 L -1.5 1.5 Z",
} as const;

/** Une pièce du schéma: sa clé, son nom, sa place, sa forme. */
export type Part = {
  /** Ce que cette pièce désigne. Une commande pour le plan émulé (`A`, `D_UP`),
   * un indice brut pour le plan physique (`b0`, `a1+`). */
  key: string;
  /** Ce qu'on écrit dessus ou à côté. Vide quand la forme se suffit. */
  label: string;
  x: number;
  y: number;
  /** Rayon pour un rond, demi-largeur pour une pastille. */
  r: number;
  shape: "rond" | "pastille";
  /** Une pastille est plus large que haute; ceci dit de combien. */
  wide?: number;
  /** Sa couleur d'identification. Absente veut dire la couleur du boîtier. */
  tint?: string;
  /** Une couronne autour, comme la garde d'un stick. */
  gate?: boolean;
  /** Ce stick S'INCLINE avec son axe.
   *
   * « x » et « cx » pour le côté émulation (lue dans `readPad`), « a0 » et
   * « a2 » pour le côté physique (les axes du navigateur). C'est ce qui donne
   * à un stick l'air d'un stick: la boucle d'affichage déplace son capot du
   * côté où on pousse, comme sur un banc d'essai de manette.
   */
  stick?: "x" | "cx" | "a0" | "a2";
  /** Un symbole DESSINÉ au milieu, dans `GLYPHS`. */
  glyph?: string;
};

export type PadMap = {
  id: string;
  name: string;
  /** Le cadre de la coque: par défaut `-2 -2 104 66`. Une coque au cadre plus
     carré peut déclarer le sien — la manette standard, tirée du banc d'essai,
     est plus haute que large et mentirait dans le cadre commun. */
  viewBox?: string;
  /** La silhouette du boîtier, en chemin SVG dans le même repère.
   *
   * Deux corps se déclarent en deux tracés fermés dans la même chaîne:
   * la Wiimote et son Nunchuk, par exemple. */
  body: string;
  /** Les creux du boîtier — pavé tactile, puits d'un bouton, plaque — premiers
   * tracés, remplis du ton de creux. Ils ne s'allument jamais. */
  recess?: string;
  /** Les lignes gravées — couture, fentes — des tracés en liseré de creux. */
  slots?: string;
  /** La version PLATE de la coque: pas de capots bombés sur les pièces, pas
   * d'ombre portée, deux tons seulement. La préférence d'un plan à l'autre:
   * la Wiimote est modelée, la PlayStation, la Xbox et la GameCube restent
   * le dessin d'origine. Le creux (le pavé tactile, le puits) reste, parce
   * qu'il est de l'information. */
  flat?: boolean;
  /** Un fil dessiné entre ou sur les corps: le câble du Nunchuk, la couture
   * d'une PlayStation. Dessiné en liseré et jamais éclairé. */
  wire?: string;
  /** Là où le boîtier occupe le repère, pour qu'un essai vérifie que les pièces
   * se posent DESSUS. Le repère est plus grand que la manette: sans ça une pièce
   * peut tenir dedans et pendre à côté, ce qui est arrivé. Déclaré par le plan
   * plutôt que deviné, parce qu'une guitare et une manette n'occupent pas la même
   * partie de l'espace. */
  hull: { left: number; right: number; top: number; bottom: number };
  parts: Part[];
};

/**
 * La manette que le jeu voit quand la salle présente une GameCube.
 *
 * Deux poignées inégales, la droite longue pour loger le stick C sous le groupe
 * de boutons, une crête plate entre les épaules des gâchettes L et R. Le bouton
 * Start est au fond d'un petit puits rectangulaire, comme sur la console.
 * Les couleurs sont celles du matériel: A vert, B rouge, X bleu, Y jaune.
 */
export const GAMECUBE: PadMap = {
  id: "gamecube",
  name: "manette GameCube",
  body:
    "M 21 9 C 21 5, 26 4, 31 7 C 35 9, 39 10, 43 10 C 48 10, 52 10, 57 10 " +
    "C 61 10, 65 9, 68 7 C 72 5, 77 4, 79 8 C 83 13, 87 20, 89 28 " +
    "C 92 37, 91 46, 87 52 C 83 56, 78 56, 75 53 C 73 51, 70 52, 66 52 " +
    "C 60 51, 55 51, 50 51 C 45 51, 41 52, 37 52 C 34 52, 31 52, 28 53 " +
    "C 26 55, 22 54, 18 50 C 14 46, 13 39, 12 32 C 12 23, 12 15, 15 12 " +
    "C 17 10, 19 9, 21 9 Z",
  recess:
    "M 47 23.5 L 57 23.5 C 58.5 23.5, 59 24, 59 25.5 C 59 27, 58.5 27.5, 57 27.5 " +
    "L 47 27.5 C 45.5 27.5, 45 27, 45 25.5 C 45 24, 45.5 23.5, 47 23.5 Z",
  hull: { left: 11, right: 92, top: 4, bottom: 56 },
  flat: true,
  parts: [
    { key: "L", label: "L", x: 28, y: 13, r: 3.2, shape: "pastille", wide: 2.2 },
    { key: "R", label: "R", x: 72, y: 13, r: 3.2, shape: "pastille", wide: 2.2 },
    {
      key: "Z",
      label: "Z",
      x: 80,
      y: 16,
      r: 2.6,
      shape: "rond",
      tint: TINTS.violet,
    },
    {
      key: "x",
      label: "",
      x: 24,
      y: 25,
      r: 6.6,
      shape: "rond",
      gate: true,
      stick: "x",
      tint: TINTS.gris,
    },
    { key: "D_UP", label: "", x: 27, y: 40, r: 2.6, shape: "pastille", wide: 0.5 },
    { key: "D_DOWN", label: "", x: 27, y: 46.6, r: 2.6, shape: "pastille", wide: 0.5 },
    { key: "D_LEFT", label: "", x: 23.4, y: 43.3, r: 1.3, shape: "pastille", wide: 2.2 },
    { key: "D_RIGHT", label: "", x: 30.6, y: 43.3, r: 1.3, shape: "pastille", wide: 2.2 },
    {
      key: "START",
      label: "",
      x: 52,
      y: 25.5,
      r: 2.2,
      shape: "pastille",
      wide: 1.8,
      tint: TINTS.gris,
    },
    {
      key: "cx",
      label: "C",
      x: 66,
      y: 43.5,
      r: 4,
      shape: "rond",
      gate: true,
      stick: "cx",
      tint: TINTS.jaune,
    },
    { key: "A", label: "A", x: 75, y: 30, r: 6.6, shape: "rond", tint: TINTS.vert },
    { key: "B", label: "B", x: 63, y: 38, r: 3.6, shape: "rond", tint: TINTS.rouge },
    { key: "X", label: "X", x: 66, y: 22, r: 3, shape: "rond", tint: TINTS.bleu },
    { key: "Y", label: "Y", x: 84, y: 22, r: 3, shape: "rond", tint: TINTS.jaune },
  ],
};

/**
 * La manette qu'on tient, quand on n'en sait rien du tout: le dernier recours.
 *
 * Le navigateur ne dit pas à quoi ressemble une manette. Quand il dit son nom,
 * on dessine sa vraie coque — `DUALSHOCK` pour une PlayStation, `XBOX` pour
 * une Xbox. Cette silhouette générique ne sert que lorsqu'aucune famille ne
 * s'est annoncée, et elle le dit: un adaptateur GameCube n'annonce aucune
 * disposition, et pour lui aucun plan ne peut être juste.
 *
 * # Le banc d'essai des manettes
 *
 * Le site sur lequel on teste ses manettes (hardwaretester) ne dessine qu'UNE
 * manette, générique: un boîtier clair au liseré bleuté, la disposition d'une
 * Xbox (stick gauche haut, croix en bas à gauche, les quatre boutons en haut à
 * droite, stick droit en bas), de gros puits ronds autour des sticks et des
 * pastilles aux arêtes. C'est ce modèle-là que ce plan reprend, redessiné à
 * notre main: plat, sans capots ni ombre (`flat`), des cercles de puits dans
 * la matière de la coque.
 */
export const STANDARD_PAD: PadMap = {
  id: "standard",
  name: "manette standard",
  viewBox: "0 0 104 96",
  flat: true,
  // La silhouette mesurée sur le site: un plateau haut plat, deux poignées
  // PROFONDES aux coins bas, et le côté du milieu qui remonte entre elles —
  // la forme en « M » du banc d'essai. Les gâchettes forment deux petites
  // bosses au-dessus de la crête.
  body:
    "M 11 24 C 9 17, 11 9, 20 7 C 30 6, 36 9, 40 11 C 46 12, 52 12, 57 11 " +
    "C 63 10, 70 7, 80 7 C 89 9, 92 16, 91 24 C 93 30, 96 38, 99 47 " +
    "C 102 57, 103 68, 102 77 C 101 84, 96 89, 90 89 C 86 89, 84 84, 82 78 " +
    "C 78 70, 72 68, 66 68 C 58 68, 46 68, 38 68 C 32 68, 26 70, 22 78 " +
    "C 20 84, 18 89, 14 89 C 8 89, 3 84, 2 77 C 1 68, 2 56, 6 47 " +
    "C 8 38, 11 30, 11 24 Z",
  // Les puits ronds, dans la matière de la coque: un cercle sous chaque stick,
  // sous la croix et sous le losange des boutons.
  recess:
    "M 27 29.5 A 8.5 8.5 0 1 0 27.01 29.5 Z " +
    "M 66 47.7 A 8.5 8.5 0 1 0 66.01 47.7 Z " +
    "M 39 47.7 A 8 8 0 1 0 39.01 47.7 Z " +
    "M 78 29.5 A 8 8 0 1 0 78.01 29.5 Z",
  hull: { left: 2, right: 103, top: 5, bottom: 90 },
  parts: [
    { key: "b6", label: "LT", x: 31, y: 11, r: 1.8, shape: "rond" },
    { key: "b7", label: "RT", x: 73, y: 11, r: 1.8, shape: "rond" },
    { key: "b4", label: "LB", x: 31, y: 17, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b5", label: "RB", x: 73, y: 17, r: 3, shape: "pastille", wide: 2.1 },
    {
      key: "b10",
      label: "",
      x: 27,
      y: 38,
      r: 6.6,
      shape: "rond",
      gate: true,
      stick: "a0",
      tint: TINTS.gris,
    },
    {
      key: "b11",
      label: "",
      x: 66,
      y: 56,
      r: 6.6,
      shape: "rond",
      gate: true,
      stick: "a2",
      tint: TINTS.gris,
    },
    { key: "b12", label: "", x: 39, y: 48.5, r: 3.2, shape: "pastille", wide: 0.42 },
    { key: "b13", label: "", x: 39, y: 62.5, r: 3.2, shape: "pastille", wide: 0.42 },
    { key: "b14", label: "", x: 32.5, y: 55.5, r: 1.6, shape: "pastille", wide: 2.3 },
    { key: "b15", label: "", x: 45.5, y: 55.5, r: 1.6, shape: "pastille", wide: 2.3 },
    { key: "b3", label: "", x: 78, y: 31, r: 3.6, shape: "rond" },
    { key: "b2", label: "", x: 71.5, y: 37.8, r: 3.6, shape: "rond" },
    { key: "b1", label: "", x: 83, y: 37.8, r: 3.6, shape: "rond" },
    { key: "b0", label: "", x: 78, y: 45, r: 3.6, shape: "rond" },
    { key: "b8", label: "", x: 44, y: 38, r: 2.4, shape: "rond" },
    { key: "b9", label: "", x: 60, y: 38, r: 2.4, shape: "rond" },
    { key: "b16", label: "", x: 52, y: 28, r: 2, shape: "rond" },
  ],
};

/**
 * La manette PlayStation qu'on tient, quand son nom le dit.
 *
 * La disposition est celle du W3C, dont la PlayStation est la référence: la
 * croix, le carré, le rond et le triangle dans leur losange, chacun dans SA
 * couleur, la croix directionnelle à gauche, les arêtes au dos. Les symboles
 * sont DESSINÉS et non écrits: aucune police de la page ne garantit de porter
 * « ✕ » ou « ▢ » au milieu d'un bouton de 3 unités.
 */
export const DUALSHOCK: PadMap = {
  id: "dualshock",
  name: "manette PlayStation",
  body:
    "M 21 8 C 21 4, 27 3, 31 5 C 35 7, 42 8, 50 8 C 58 8, 65 7, 69 5 " +
    "C 73 3, 79 4, 79 8 C 81 12, 86 19, 91 28 C 93 36, 92 44, 87 49 " +
    "C 85 54, 79 55, 76 51 C 73 49, 70 50, 64 50 C 58 50, 54 50, 50 50 " +
    "C 45 50, 40 50, 34 50 C 30 51, 27 51.5, 24 53.5 C 21 55, 15 54, 12 49 " +
    "C 10 42, 11 35, 14 27 C 16 19, 19 13, 21 8 Z",
  recess:
    "M 34 11.5 C 34 11, 35 10.5, 36 10.5 L 64 10.5 C 65 10.5, 66 11, 66 11.5 " +
    "L 66 15 C 66 15.6, 65 16, 64 16 L 36 16 C 35 16, 34 15.6, 34 15 Z",
  wire: "M 50 4 C 50 14, 50 34, 50 48",
  hull: { left: 12, right: 94, top: 3, bottom: 55 },
  flat: true,
  parts: [
    { key: "b6", label: "L2", x: 28.5, y: 8, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b7", label: "R2", x: 72.5, y: 8, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b4", label: "L1", x: 26, y: 14.5, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b5", label: "R1", x: 74, y: 14.5, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b12", label: "", x: 23, y: 20, r: 4, shape: "pastille", wide: 0.42 },
    { key: "b13", label: "", x: 23, y: 28, r: 4, shape: "pastille", wide: 0.42 },
    { key: "b14", label: "", x: 19, y: 24, r: 1.7, shape: "pastille", wide: 2.3 },
    { key: "b15", label: "", x: 27.6, y: 24, r: 1.7, shape: "pastille", wide: 2.3 },
    {
      key: "b3",
      label: "",
      x: 78,
      y: 21,
      r: 3.6,
      shape: "rond",
      tint: TINTS.vert,
      glyph: GLYPHS.triangle,
    },
    {
      key: "b2",
      label: "",
      x: 70,
      y: 29,
      r: 3.6,
      shape: "rond",
      tint: TINTS.violet,
      glyph: GLYPHS.carre,
    },
    {
      key: "b1",
      label: "",
      x: 86,
      y: 29,
      r: 3.6,
      shape: "rond",
      tint: TINTS.rouge,
      glyph: GLYPHS.rond,
    },
    {
      key: "b0",
      label: "",
      x: 78,
      y: 37,
      r: 3.6,
      shape: "rond",
      tint: TINTS.bleu,
      glyph: GLYPHS.croix,
    },
    { key: "b8", label: "", x: 43, y: 22, r: 2, shape: "pastille", wide: 1.9 },
    { key: "b9", label: "", x: 57, y: 22, r: 2, shape: "pastille", wide: 1.9 },
    { key: "b16", label: "", x: 50, y: 21, r: 2.4, shape: "rond", tint: TINTS.gris },
    {
      key: "b10",
      label: "",
      x: 37,
      y: 42,
      r: 6,
      shape: "rond",
      gate: true,
      stick: "a0",
      tint: TINTS.gris,
    },
    {
      key: "b11",
      label: "",
      x: 63,
      y: 42,
      r: 6,
      shape: "rond",
      gate: true,
      stick: "a2",
      tint: TINTS.gris,
    },
  ],
};

/**
 * La manette Xbox qu'on tient, quand son nom le dit.
 *
 * Même disposition que la PlayStation — c'est la norme W3C — mais la coque et
 * les boutons sont ceux de Microsoft: deux sticks hauts et symétriques, la
 * croix en bas à gauche, les lettres A B X Y en bas à droite, le bouton au logo
 * au creux du haut.
 */
export const XBOX: PadMap = {
  id: "xbox",
  name: "manette Xbox",
  body:
    "M 19 7 C 20 3, 26 3, 31 5 C 37 3, 45 3, 50 3 C 55 3, 63 3, 69 5 " +
    "C 74 3, 81 4, 84 8 C 86 13, 89 20, 91 28 C 93 37, 92 45, 88 50 " +
    "C 85 55, 79 56, 76 52 C 72 49, 68 50, 63 50 C 57 49, 53 49, 50 49 " +
    "C 46 49, 42 50, 36 50 C 31 50, 28 52, 25 54 C 21 56, 15 55, 12 50 " +
    "C 9 45, 8 37, 11 28 C 13 20, 16 13, 18 8 Z",
  recess:
    "M 50 4.5 C 47 4.5, 45.5 6, 45.5 8 C 45.5 10, 47 11.5, 50 11.5 " +
    "C 53 11.5, 54.5 10, 54.5 8 C 54.5 6, 53 4.5, 50 4.5 Z",
  wire: "M 50 4 C 50 12, 50 28, 50 47",
  hull: { left: 8, right: 92, top: 2, bottom: 56 },
  flat: true,
  parts: [
    { key: "b6", label: "LT", x: 26, y: 8, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b7", label: "RT", x: 76, y: 8, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b4", label: "LB", x: 25, y: 14.5, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b5", label: "RB", x: 75, y: 14.5, r: 3, shape: "pastille", wide: 2.1 },
    { key: "b16", label: "", x: 50, y: 8, r: 2.6, shape: "rond", tint: TINTS.gris },
    { key: "b8", label: "", x: 43, y: 21, r: 2, shape: "pastille", wide: 1.6 },
    { key: "b9", label: "", x: 57, y: 21, r: 2, shape: "pastille", wide: 1.6 },
    {
      key: "b10",
      label: "",
      x: 34,
      y: 25,
      r: 6,
      shape: "rond",
      gate: true,
      stick: "a0",
      tint: TINTS.gris,
    },
    {
      key: "b11",
      label: "",
      x: 66,
      y: 25,
      r: 6,
      shape: "rond",
      gate: true,
      stick: "a2",
      tint: TINTS.gris,
    },
    {
      key: "b12",
      label: "",
      x: 25,
      y: 32,
      r: 3,
      shape: "pastille",
      wide: 0.45,
    },
    {
      key: "b13",
      label: "",
      x: 25,
      y: 46,
      r: 3,
      shape: "pastille",
      wide: 0.45,
    },
    {
      key: "b14",
      label: "",
      x: 18,
      y: 39,
      r: 1.5,
      shape: "pastille",
      wide: 2.3,
    },
    {
      key: "b15",
      label: "",
      x: 32,
      y: 39,
      r: 1.5,
      shape: "pastille",
      wide: 2.3,
    },
    { key: "b3", label: "Y", x: 78, y: 31, r: 3.4, shape: "rond", tint: TINTS.jaune },
    { key: "b2", label: "X", x: 69, y: 39, r: 3.4, shape: "rond", tint: TINTS.bleu },
    { key: "b1", label: "B", x: 88, y: 39, r: 3.2, shape: "rond", tint: TINTS.rouge },
    { key: "b0", label: "A", x: 78.5, y: 47, r: 3.2, shape: "rond", tint: TINTS.vert },
  ],
};

/**
 * La Wiimote et son Nunchuk, quand la salle présente une Wii.
 *
 * # Les mêmes clés que la GameCube, et c'est le point
 *
 * La page envoie TOUJOURS la même trame: douze boutons, deux sticks, deux
 * gâchettes. Une GameCube, une Wiimote et une guitare en sont trois LECTURES,
 * décidées par le fichier de correspondances qu'on écrit à Dolphin. Les plans
 * partagent donc leurs clés — `A` reste `A` — et seules les places et les
 * étiquettes changent.
 *
 * D'où un écran qui vaut mieux qu'un tableau: on tient un bouton, et on voit ce
 * qu'il devient sur chacune des trois. Ce qu'aucune ne montre est aussi
 * instructif — une guitare n'a pas de croix droite, donc cette commande n'y
 * allume rien, et c'est vrai.
 *
 * Les correspondances viennent de `emulator::config::wiimote_ini`, qui est
 * l'endroit où elles sont DÉCIDÉES. Les recopier d'ailleurs ferait un schéma qui
 * ment le jour où l'une change.
 *
 * # La Wiimote, de haut en bas
 *
 * La fenêtre infrarouge qui sert à viser tout en haut, puis A (l'anneau), la
 * croix, « plus », les boutons 1 et 2, la gâchette B qui élargit le bas de la
 * baguette, et la secousse qu'on apprend pour les coups d'épaule. Le Nunchuk, à
 * gauche, porte le stick, C et Z, et se branche par une petite prise sous son
 * ventre.
 */
export const WIIMOTE: PadMap = {
  id: "wiimote",
  name: "Wiimote et Nunchuk",
  // La Wiimote, à droite, s'élargit en bas pour la gâchette B; le Nunchuk, à
  // gauche, est un pavé rond qui se termine par la prise du câble.
  body:
    "M 62 4 C 60 4, 60 6, 60 8 L 60 48 C 60 52, 62 55, 66 55 L 72 55 " +
    "C 76 55, 77 52, 77 48 L 77 8 C 77 5, 74 4, 73 4 Z " +
    "M 19 24 C 19 22, 22 21, 26 21 C 31 21, 34 22, 35 24 L 35 44 " +
    "C 35 46, 32 47, 26 47 C 21 47, 18 46, 18 44 Z " +
    "M 23 47 L 29 47 L 30 51 L 22 51 Z",
  wire: "M 26 51 C 26 55, 38 50, 40 40 C 42 30, 52 33, 59 33",
  hull: { left: 18, right: 77, top: 4, bottom: 55 },
  parts: [
    {
      key: "cx",
      label: "viser",
      x: 69,
      y: 8,
      r: 2.2,
      shape: "pastille",
      wide: 2.2,
      tint: TINTS.gris,
    },
    { key: "A", label: "A", x: 69, y: 16, r: 4.2, shape: "rond", tint: TINTS.gris },
    { key: "D_UP", label: "", x: 69, y: 23, r: 3.2, shape: "pastille", wide: 0.42 },
    { key: "D_DOWN", label: "", x: 69, y: 28.4, r: 3.2, shape: "pastille", wide: 0.42 },
    {
      key: "D_LEFT",
      label: "",
      x: 64.9,
      y: 25.7,
      r: 1.6,
      shape: "pastille",
      wide: 2.3,
    },
    {
      key: "D_RIGHT",
      label: "",
      x: 73.1,
      y: 25.7,
      r: 1.6,
      shape: "pastille",
      wide: 2.3,
    },
    { key: "START", label: "+", x: 74, y: 33, r: 2.1, shape: "rond", tint: TINTS.gris },
    { key: "X", label: "1", x: 66, y: 38.5, r: 2.5, shape: "rond", tint: TINTS.gris },
    { key: "Y", label: "2", x: 73, y: 38.5, r: 2.5, shape: "rond", tint: TINTS.gris },
    {
      key: "B",
      label: "B",
      x: 69,
      y: 48.5,
      r: 2.6,
      shape: "pastille",
      wide: 1.9,
      tint: TINTS.violet,
    },
    {
      key: "Z",
      label: "secouer",
      x: 69,
      y: 52.5,
      r: 1.3,
      shape: "pastille",
      wide: 1.8,
      tint: TINTS.jaune,
    },
    {
      key: "x",
      label: "",
      x: 26,
      y: 28,
      r: 5.4,
      shape: "rond",
      gate: true,
      stick: "x",
      tint: TINTS.gris,
    },
    { key: "L", label: "C", x: 21, y: 36.5, r: 2.5, shape: "rond", tint: TINTS.vert },
    { key: "R", label: "Z", x: 32.5, y: 37.5, r: 2.4, shape: "rond", tint: TINTS.rouge },
  ],
};

/**
 * La guitare, pour les jeux qui n'acceptent qu'elle.
 *
 * La tête au bout du manche, cinq frettes le long du bord, puis le corps avec
 * la barre de grattage dans sa plaque, le « moins » et le « plus », la barre de
 * vibrato qui dépasse à droite et le petit joystick tout en bas à droite. Les
 * correspondances viennent de `emulator::config::guitar_binds`.
 *
 * Trois commandes de la trame n'apparaissent pas: une guitare n'a ni croix
 * gauche ni croix droite ni deuxième gâchette. Les tenir n'allume donc rien, et
 * c'est exactement ce que le jeu en fait.
 */
export const GUITAR: PadMap = {
  id: "guitar",
  name: "guitare",
  body:
    "M 7 23 C 5 21, 3 22, 3 24 C 3 26, 5 27, 7 25 Z " +
    "M 10 21 C 7 21, 6 24, 7 26 L 49 26.5 C 51 26.5, 52 25, 52 23 L 52 21.5 " +
    "C 50 20, 38 20, 27 20 C 18 20, 13 20, 10 21 Z " +
    "M 52 24 C 53 18, 56 13, 62 12 C 72 11, 82 14, 87 21 C 92 29, 92 39, 88 46 " +
    "C 84 53, 76 56, 68 55 C 63 54, 60 51, 60 47 C 60 40, 58 37, 54 33 " +
    "C 52 30, 52 27, 52 24 Z",
  recess:
    "M 64 40 C 62 42, 60 46, 61 50 C 62 54, 66 56, 71 55 C 76 54, 79 51, 78 46 " +
    "C 77 41, 74 38, 70 38 C 66 38, 65 39, 64 40 Z",
  hull: { left: 3, right: 91, top: 12, bottom: 56 },
  parts: [
    { key: "A", label: "", x: 13, y: 23.5, r: 2.2, shape: "pastille", wide: 0.8, tint: TINTS.vert },
    {
      key: "B",
      label: "",
      x: 22,
      y: 23.5,
      r: 2.2,
      shape: "pastille",
      wide: 0.8,
      tint: TINTS.rouge,
    },
    {
      key: "X",
      label: "",
      x: 31,
      y: 23.5,
      r: 2.2,
      shape: "pastille",
      wide: 0.8,
      tint: TINTS.jaune,
    },
    { key: "Y", label: "", x: 40, y: 23.5, r: 2.2, shape: "pastille", wide: 0.8, tint: TINTS.bleu },
    {
      key: "Z",
      label: "",
      x: 49,
      y: 23.5,
      r: 2.2,
      shape: "pastille",
      wide: 0.8,
      tint: "#c9791f",
    },
    { key: "L", label: "−", x: 62, y: 34, r: 2, shape: "rond", tint: TINTS.gris },
    { key: "START", label: "+", x: 70, y: 34, r: 2, shape: "rond", tint: TINTS.gris },
    {
      key: "D_UP",
      label: "gratter ↑",
      x: 70,
      y: 42,
      r: 2.4,
      shape: "pastille",
      wide: 3.2,
      tint: TINTS.gris,
    },
    {
      key: "D_DOWN",
      label: "gratter ↓",
      x: 70,
      y: 49,
      r: 2.4,
      shape: "pastille",
      wide: 3.2,
      tint: TINTS.gris,
    },
    {
      key: "cx",
      label: "vibrato",
      x: 79.5,
      y: 50,
      r: 1.8,
      shape: "pastille",
      wide: 2.2,
      tint: TINTS.violet,
    },
    {
      key: "x",
      label: "",
      x: 85,
      y: 33,
      r: 3.2,
      shape: "rond",
      gate: true,
      stick: "x",
      tint: TINTS.gris,
    },
  ],
};

/** Le plan de chaque manette que Dolphin peut présenter, dans l'ordre du réglage
 * qui les choisit (`lib/saves.PADS`). */
export const EMULATED: readonly PadMap[] = [GAMECUBE, WIIMOTE, GUITAR];

/** Les coques parmi lesquelles l'écran choisit celle qu'on TIENT. La famille
 * que le navigateur annonce décide (voir `Wiring.tsx`). */
export const PHYSICAL: readonly PadMap[] = [STANDARD_PAD, DUALSHOCK, XBOX];

export const MAPS: Record<string, PadMap> = {
  [GAMECUBE.id]: GAMECUBE,
  [STANDARD_PAD.id]: STANDARD_PAD,
  [DUALSHOCK.id]: DUALSHOCK,
  [XBOX.id]: XBOX,
  [WIIMOTE.id]: WIIMOTE,
  [GUITAR.id]: GUITAR,
};
