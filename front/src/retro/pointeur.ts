/**
 * La flèche de souris en pixels (effet « pointeur »).
 *
 * Dessinée sur une grille de 12 × 18 (`K` noir, `W` blanc), la grille de la
 * page des effets. La feuille (`src/effets.css`) porte la valeur toute faite
 * dans `--rt-pointeur`, parce qu'un pointeur se déclare en CSS; `pointeur.test.ts`
 * exige que cette valeur soit celle que `pointeurCSS()` calcule ici. Un pixel
 * changé dans la grille sans recopier la valeur fait échouer l'essai.
 */
import { chemin } from "../lib/logo";

export const FLECHE = [
  "K...........",
  "KK..........",
  "KWK.........",
  "KWWK........",
  "KWWWK.......",
  "KWWWWK......",
  "KWWWWWK.....",
  "KWWWWWWK....",
  "KWWWWWWWK...",
  "KWWWWWWWWK..",
  "KWWWWWWWWWK.",
  "KWWWWWWKKKKK",
  "KWWWKWWK....",
  "KWWK.KWWK...",
  "KWK..KWWK...",
  "KK....KWWK..",
  "K.....KWWK..",
  ".......KK...",
] as const;

function cases(lettre: "K" | "W"): { x: number; y: number }[] {
  const trouvees: { x: number; y: number }[] = [];
  FLECHE.forEach((ligne, y) => {
    [...ligne].forEach((c, x) => {
      if (c === lettre) trouvees.push({ x, y });
    });
  });
  return trouvees;
}

/** La flèche en SVG, deux fois plus grande que sa grille. */
export function pointeurSVG(): string {
  return (
    "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='36' viewBox='0 0 12 18' shape-rendering='crispEdges'>" +
    `<path fill='#000' d='${chemin(cases("K"))}'/>` +
    `<path fill='#fff' d='${chemin(cases("W"))}'/>` +
    "</svg>"
  );
}

/** La valeur de `cursor`, la pointe en haut à gauche, et la flèche du système
 * en repli. */
export function pointeurCSS(): string {
  return `url("data:image/svg+xml,${encodeURIComponent(pointeurSVG())}") 0 0, auto`;
}
