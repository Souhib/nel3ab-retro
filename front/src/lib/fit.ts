/**
 * Quelle place l'image prend à l'écran.
 *
 * # Deux décisions, et elles n'ont rien à voir
 *
 * Ce qu'on **transporte** — 1216x896 ou 608x448 — se choisit sur le débit qu'on a.
 * Ce qu'on **affiche** se choisit sur ce qu'on aime voir. Les mélanger revenait à
 * dire que celui qui économise sa bande passante veut aussi une petite image, ce
 * que personne n'a jamais demandé.
 *
 * # Pourquoi quatre choix et pas un curseur
 *
 * Parce que ce sont quatre RÉSULTATS différents, pas quatre valeurs d'une même
 * grandeur:
 *
 * - **remplir**: toute la place, proportions gardées, agrandissement lissé. Le
 *   plus grand, et le plus flou quand la source est petite;
 * - **remplir net**: la même taille, sans lissage. Les pixels restent francs, ce
 *   qui plaît à qui préfère du net crénelé à du grand flou;
 * - **entier**: le plus grand agrandissement ENTIER qui tient. Doubler chaque
 *   pixel exactement donne une image franchement plus nette qu'un agrandissement
 *   de 1,87 fois, au prix de bandes noires plus larges;
 * - **origine**: un pixel reçu, un pixel à l'écran. Le plus net possible, et le
 *   plus petit.
 *
 * Un curseur donnerait mille tailles dont neuf cent quatre-vingt-dix-neuf sont
 * des agrandissements bâtards.
 */

/** Les quatre façons de poser l'image. */
export const FITS = [
  {
    id: "remplir",
    label: "remplir l'écran",
    note: "toute la place, agrandissement lissé",
  },
  { id: "remplir-net", label: "remplir, net", note: "la même taille, pixels francs" },
  { id: "entier", label: "agrandissement entier", note: "le plus net, avec des bandes" },
  { id: "origine", label: "taille d'origine", note: "un pixel reçu, un pixel à l'écran" },
] as const;

export type Fit = (typeof FITS)[number]["id"];

const KEY = "nel3ab:fit";

export function storedFit(): Fit {
  try {
    const found = localStorage.getItem(KEY);
    return FITS.some((choice) => choice.id === found) ? (found as Fit) : "remplir";
  } catch {
    return "remplir";
  }
}

export function rememberFit(fit: Fit): void {
  try {
    localStorage.setItem(KEY, fit);
  } catch {
    // Navigation privée: le choix dure le temps de l'onglet, ce qui suffit.
  }
}

export function fitLabel(fit: Fit): string {
  return FITS.find((choice) => choice.id === fit)?.label ?? fit;
}

/** Une taille en pixels d'écran, et comment l'agrandissement se fait. */
export type Placed = { width: number; height: number; smooth: boolean };

/**
 * Où poser l'image: sa taille à l'écran, et s'il faut lisser.
 *
 * Pure, donc testable, et c'est là que vivent les deux cas limites qui font la
 * différence entre un réglage et un défaut:
 *
 * - une image PLUS GRANDE que la place. « Entier » et « origine » demandent une
 *   taille fixe, et rien ne garantit qu'elle tienne: sur une petite fenêtre,
 *   1216x896 en taille d'origine déborderait et serait coupée. Les deux
 *   retombent alors sur « remplir », parce qu'une image tronquée est pire qu'une
 *   image réduite;
 * - une image de taille NULLE, avant la première image décodée. Diviser par elle
 *   donnerait l'infini, et un élément de taille infinie casse la mise en page.
 */
export function place(fit: Fit, picture: Placed | Size, room: Size): Placed {
  const wide = Math.max(1, picture.width);
  const tall = Math.max(1, picture.height);
  // « Remplir »: la plus grande taille qui garde les proportions.
  const ratio = Math.min(room.width / wide, room.height / tall);
  const filled = {
    width: Math.floor(wide * ratio),
    height: Math.floor(tall * ratio),
  };
  if (picture.width <= 0 || picture.height <= 0) return { ...filled, smooth: true };

  if (fit === "remplir") return { ...filled, smooth: true };
  if (fit === "remplir-net") return { ...filled, smooth: false };

  if (fit === "entier") {
    const times = Math.floor(ratio);
    // Moins d'une fois veut dire que l'image ne tient même pas en entier: on
    // remplit plutôt que de la couper.
    if (times < 1) return { ...filled, smooth: true };
    return { width: wide * times, height: tall * times, smooth: false };
  }

  // Origine, et le même repli quand elle ne tient pas.
  if (wide > room.width || tall > room.height) return { ...filled, smooth: true };
  return { width: wide, height: tall, smooth: false };
}

/** Une largeur et une hauteur, en pixels. */
export type Size = { width: number; height: number };
