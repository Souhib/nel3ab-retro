/**
 * « icones »: les icônes de la colonne de la salle dessinées sur une grille de
 * douze pixels, celles de la page des effets.
 *
 * Un composant pose l'icône au trait (`.rt-icone-trait`) ET l'icône en pixels
 * (`.rt-icone-pixel`); la feuille en montre une selon le niveau. Chaque icône
 * garde son mot à côté: un dessin de douze pixels ne suffit pas à dire
 * « inviter ».
 *
 * La grille: sept lignes de douze cases, `#` allumée et `.` éteinte, posées à
 * deux cases du haut du carré de douze (`retro.test.ts` le vérifie). C'est le
 * seul jeu d'icônes de la page (partition du 23 novembre 2026, K27): chaque
 * chantier y ajoute les siennes, une clé par icône, sans changer celles qui
 * existent. Le chevron, les curseurs, l'horloge et la porte ont été dessinés
 * par le socle parce que deux chantiers au moins les demandaient: deux
 * ajouts de la même clé se seraient heurtés à la fusion.
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
  /* Ouvrir, déplier, aller plus loin (salle et personnes). */
  chevron: [
    "....##......",
    ".....##.....",
    "......##....",
    ".......##...",
    "......##....",
    ".....##.....",
    "....##......",
  ],
  /* Les réglages (salle et menus). */
  curseurs: [
    "..##........",
    "############",
    "..##........",
    "........##..",
    "############",
    "........##..",
    "............",
  ],
  /* Une durée, une attente (états et menus). */
  horloge: [
    "....###.....",
    "..##...##...",
    ".#...#...#..",
    ".#...###.#..",
    ".#.......#..",
    "..##...##...",
    "....###.....",
  ],
  /* La salle (salle et menus). */
  porte: [
    "...######...",
    "...#....#...",
    "...#....#...",
    "...#..#.#...",
    "...#....#...",
    "...#....#...",
    ".##########.",
  ],
  // Le clavier de « Tes touches au clavier » (chantier salle, étape 6) :
  // trois rangées de touches et une barre d'espace.
  clavier: [
    "############",
    "#.#.#.#.#.##",
    "############",
    "##.#.#.#.#.#",
    "############",
    "###......###",
    "############",
  ],
  // Chantier salle : un téléphone couché sous une flèche qui tourne, pour
  // le conseil d'une salle tenue droite avec une vraie manette.
  tourne: [
    "...#####....",
    "..#.....#...",
    "..#....###..",
    "............",
    "############",
    "#.........##",
    "############",
  ],
  // Chantier personnes : la couronne de qui choisit le jeu, et le micro d'une
  // place, ouvert ou coupé. Elles marquent une place START ; le mot reste
  // dans son nom accessible.
  couronne: [
    "#....##....#",
    "##..####..##",
    "###.####.###",
    "############",
    "############",
    "............",
    "############",
  ],
  micro: [
    "....####....",
    "....####....",
    "....####....",
    "..#.####.#..",
    "..#..##..#..",
    "...######...",
    ".....##.....",
  ],
  "micro-coupe": [
    "#...####....",
    ".#..####....",
    "..#.####....",
    "..#.#.##.#..",
    "..#..#...#..",
    "...####.#...",
    ".....##..#..",
  ],
  // Le chantier personnes : Signaler, un fanion planté pour « note cet
  // instant ».
  drapeau: [
    "..#######...",
    "..########..",
    "..#######...",
    "..#.........",
    "..#.........",
    "..#.........",
    ".###........",
  ],
  // Chantier menus (M14) : la rubrique Jeux, une cartouche vue de face,
  // son étiquette en creux et ses contacts dessous.
  cartouche: [
    ".##########.",
    ".#........#.",
    ".#.######.#.",
    ".#.######.#.",
    ".#........#.",
    ".##########.",
    "..#.#..#.#..",
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
