/**
 * « icones »: les icônes de la colonne de la salle dessinées sur une grille de
 * douze pixels, celles de la page des effets.
 *
 * Un composant pose l'icône au trait (`.rt-icone-trait`) ET l'icône en pixels
 * (`.rt-icone-pixel`); la feuille en montre une selon le niveau. Chaque icône
 * garde son mot à côté: un dessin de douze pixels ne suffit pas à dire
 * « inviter ».
 */
import { chemin } from "../lib/logo";

export const ICONES_PIXEL = {
  manette: [
    "..########..",
    ".##########.",
    "###.####.###",
    "##...####.##",
    "###.########",
    "####....####",
    "###......###",
  ],
  son: [
    "...#........",
    "..##...#....",
    "####....#...",
    "####.#..#...",
    "####....#...",
    "..##...#....",
    "...#........",
  ],
  inviter: [
    ".##.........",
    "####........",
    "####.....#..",
    ".##.....###.",
    ".........#..",
    "######......",
    "######......",
  ],
  quitter: [
    "#####.......",
    "#...#..#....",
    "#...#...#...",
    "#..#######..",
    "#...#...#...",
    "#...#..#....",
    "#####.......",
  ],
} as const satisfies Record<string, readonly string[]>;

export type IconePixel = keyof typeof ICONES_PIXEL;

/** L'icône en SVG, de la couleur du texte, centrée dans un carré de 12. */
export function iconePixelSVG(nom: IconePixel): string {
  const cases: { x: number; y: number }[] = [];
  ICONES_PIXEL[nom].forEach((ligne, y) => {
    [...ligne].forEach((c, x) => {
      if (c === "#") cases.push({ x, y: y + 2 });
    });
  });
  return (
    '<svg class="rt-icone-pixel" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
    `<path fill="currentColor" d="${chemin(cases)}"/></svg>`
  );
}
