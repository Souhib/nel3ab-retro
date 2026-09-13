/**
 * La largeur de la colonne de droite, choisie par la personne.
 *
 * La colonne faisait 304 px, fixes (`w-[19rem]`). On peut désormais la tirer
 * par son bord gauche, ou la régler dans le menu, mais entre deux bornes.
 *
 * # La borne basse: 256 px
 *
 * Mesurée dans Chromium le 13 septembre 2026 (`just browser-colonne`), en
 * rétrécissant la colonne de 16 px en 16 px. En mode « salle », rien n'en sort
 * jusqu'à 256 px. À 240 px un nombre sort de la colonne et elle se met à défiler
 * de côté; à 224 px le lien « les salles » suit, à 208 px la glissière du volume.
 * Le mode « détails » tient jusqu'à 208 px.
 *
 * Ce ne sont PAS les noms sous les prises. Une première version posait 272 px
 * pour que « Souhib » tienne dans sa cellule, d'après les 55 px relevés dans
 * `Seats`. Ce relevé datait d'un texte à 16 px, que `cn` gonflait par erreur; à
 * 13 px ce nom mesure 44,5 px, et sa cellule en fait encore 53 à 256 px.
 *
 * Limite de la mesure: une salle de test en manette seule, sans joueurs
 * nommés. Un état qui ajoute une ligne insécable à la colonne n'a pas été vu.
 * `colonne.mjs` refait donc la mesure à chaque passage.
 *
 * # La borne haute: 480 px, et jamais plus de la moitié de la fenêtre
 *
 * Mesuré sur un vrai téléphone le 18 août 2026 (voir `fullscreen.ts`): une
 * colonne qui prend la moitié de la largeur écrase le jeu dans l'autre moitié.
 * Au-delà de 480 px la colonne n'affiche rien de plus, elle rend seulement ses
 * lignes plus longues.
 */

export const COLUMN = {
  min: 256,
  normal: 304,
  max: 480,
  /** Le cran du menu. Seize pixels, soit quatre par cellule de prise. */
  step: 16,
} as const;

const KEY = "nel3ab:colonne";

/** La plus grande largeur permise dans une fenêtre de cette largeur. */
export function widest(viewport: number): number {
  return Math.max(COLUMN.min, Math.min(COLUMN.max, Math.floor(viewport / 2)));
}

/** Une largeur ramenée entre les bornes, en pixels entiers. */
export function clampColumn(px: number, viewport = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(px)) return COLUMN.normal;
  return Math.round(Math.min(widest(viewport), Math.max(COLUMN.min, px)));
}

/**
 * La largeur retenue par ce navigateur.
 *
 * Un nombre entier et rien d'autre. `Number("")` vaut 0 et `parseInt("304px")`
 * vaut 304: les deux accepteraient une valeur que cette page n'a jamais écrite.
 * La fenêtre n'est pas regardée ici: au chargement, c'est le `max-width` de la
 * colonne qui la tient à la moitié de l'écran.
 */
export function storedColumn(): number {
  try {
    const found = localStorage.getItem(KEY);
    return found !== null && /^\d+$/.test(found) ? clampColumn(Number(found)) : COLUMN.normal;
  } catch {
    return COLUMN.normal;
  }
}

export function rememberColumn(px: number): void {
  try {
    localStorage.setItem(KEY, String(clampColumn(px)));
  } catch {
    // Navigation privée: la largeur dure le temps de l'onglet, ce qui suffit.
  }
}
