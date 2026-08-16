/**
 * Quelle manette la personne tient, et comment ses boutons s'appellent CHEZ ELLE.
 *
 * Le navigateur ne donne qu'une chaîne de caractères et une position dans un
 * tableau. « Le bouton 2 » ne veut rien dire pour quelqu'un qui tient une
 * DualSense: chez lui c'est le carré. Une antisèche qui dit « bouton 2 » est une
 * antisèche qu'il faut traduire soi-même, donc une antisèche inutile.
 *
 * Deux niveaux de certitude, et ils ne sont pas mélangés:
 *
 * - **la position est garantie.** La disposition « standard » du W3C fixe que
 *   l'index 0 est le bouton du BAS du losange de droite, le 1 celui de DROITE,
 *   et ainsi de suite. Ça ne dépend pas de la marque;
 * - **la lettre est une supposition.** Elle vient de l'identifiant USB, qui est
 *   du texte libre écrit par un fabricant. Une manette inconnue, ou une copie,
 *   peut mentir.
 *
 * D'où la forme des étiquettes: « ✕ (bas) ». Si la supposition est fausse, la
 * position reste vraie, et la personne peut quand même trouver le bouton.
 */

export type Family = "playstation" | "xbox" | "nintendo" | "gamecube" | "standard";

export type PadIdentity = {
  family: Family;
  /** Ce qu'on affiche: « DualSense (PS5) », « manette Xbox », etc. */
  name: string;
  /** Vrai quand la disposition est celle du W3C, donc quand les positions
   * ci-dessous veulent dire quelque chose. */
  standard: boolean;
};

/** Ce que le navigateur écrit dans `Gamepad.id` quand il connaît le matériel. */
const VENDOR = /vendor:\s*([0-9a-f]{4})/i;
const PRODUCT = /product:\s*([0-9a-f]{4})/i;

const SONY = "054c";
const MICROSOFT = "045e";
const NINTENDO = "057e";

/** Les produits Sony qu'on sait nommer. Le reste reste « manette PlayStation »,
 * ce qui est vrai et suffisant. */
const SONY_PRODUCTS: Record<string, string> = {
  "0ce6": "DualSense (PS5)",
  "0df2": "DualSense Edge (PS5)",
  "09cc": "DualShock 4 (PS4)",
  "05c4": "DualShock 4 (PS4)",
  "0ba0": "DualShock 4 (PS4)",
};

export function identify(id: string, mapping: string): PadIdentity {
  const text = id.toLowerCase();
  const standard = mapping === "standard";
  const vendor = VENDOR.exec(text)?.[1];
  const product = PRODUCT.exec(text)?.[1];

  // Le GameCube d'abord, et par le NOM plutôt que par l'identifiant: ces
  // adaptateurs se déclarent sous une demi-douzaine d'identifiants différents,
  // et celui de Nintendo se confond avec les autres produits de la marque.
  if (/gamecube|mayflash|wup-028|gc adapter/.test(text)) {
    return { family: "gamecube", name: "manette GameCube (adaptateur)", standard };
  }
  if (vendor === SONY) {
    return {
      family: "playstation",
      name: (product && SONY_PRODUCTS[product]) || "manette PlayStation",
      standard,
    };
  }
  if (vendor === MICROSOFT) return { family: "xbox", name: "manette Xbox", standard };
  if (vendor === NINTENDO) return { family: "nintendo", name: "manette Nintendo", standard };

  // Pas d'identifiant utilisable: le nom du produit, faute de mieux.
  if (/dualsense|dualshock|playstation|\bps[45]\b/.test(text)) {
    return { family: "playstation", name: "manette PlayStation", standard };
  }
  if (/xbox|xinput/.test(text)) return { family: "xbox", name: "manette Xbox", standard };
  if (/switch|joy-?con|pro controller/.test(text)) {
    return { family: "nintendo", name: "manette Nintendo", standard };
  }
  return { family: "standard", name: id.split("(")[0].trim() || "manette", standard };
}

/** Où se trouve un bouton, quelle que soit la marque. Garanti par la norme. */
const WHERE: Record<number, string> = {
  0: "bas",
  1: "droite",
  2: "gauche",
  3: "haut",
  12: "croix ↑",
  13: "croix ↓",
  14: "croix ←",
  15: "croix →",
};

/** Comment la marque appelle ses boutons. Supposé, jamais garanti. */
const NAMES: Record<Family, Record<number, string>> = {
  playstation: {
    0: "✕",
    1: "○",
    2: "▢",
    3: "△",
    4: "L1",
    5: "R1",
    6: "L2",
    7: "R2",
    8: "Share",
    9: "Options",
    10: "L3",
    11: "R3",
    16: "PS",
  },
  xbox: {
    0: "A",
    1: "B",
    2: "X",
    3: "Y",
    4: "LB",
    5: "RB",
    6: "LT",
    7: "RT",
    8: "View",
    9: "Menu",
    10: "LS",
    11: "RS",
    16: "Xbox",
  },
  nintendo: {
    0: "B",
    1: "A",
    2: "Y",
    3: "X",
    4: "L",
    5: "R",
    6: "ZL",
    7: "ZR",
    8: "-",
    9: "+",
    10: "stick G",
    11: "stick D",
    16: "Home",
  },
  gamecube: {},
  standard: {
    4: "tranche G",
    5: "tranche D",
    6: "gâchette G",
    7: "gâchette D",
    8: "select",
    9: "start",
  },
};

/**
 * Le nom d'un bouton pour la personne qui le tient.
 *
 * Sur une disposition inconnue, il n'y a rien à supposer: les index sont propres
 * au matériel, donc on dit « bouton 7 » et rien d'autre. Inventer « ✕ » là serait
 * exactement le mensonge que ce module existe pour éviter.
 */
export function buttonLabel(identity: PadIdentity, index: number): string {
  if (!identity.standard) return `bouton ${index}`;
  const name = NAMES[identity.family][index];
  const where = WHERE[index];
  if (name && where) return `${name} (${where})`;
  return name ?? (where ? `bouton ${index} (${where})` : `bouton ${index}`);
}

/** Le nom d'un axe. Les quatre premiers sont fixés par la norme; au-delà, c'est
 * du matériel qui parle et on ne devine pas. */
export function axisLabel(identity: PadIdentity, index: number): string {
  if (!identity.standard) return `axe ${index}`;
  return (
    { 0: "stick gauche ←→", 1: "stick gauche ↑↓", 2: "stick droit ←→", 3: "stick droit ↑↓" }[
      index
    ] ?? `axe ${index}`
  );
}
