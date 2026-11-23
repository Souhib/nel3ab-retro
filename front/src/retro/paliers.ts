/**
 * « paliers »: les petits mouvements avancent par à-coups, comme un
 * personnage de jeu.
 *
 * Seulement les petits éléments (le curseur, les chiffres, « PRÊT ! », la
 * mascotte): sur un grand panneau, un mouvement en marches ressemble à une
 * page qui rame. Les feuilles le font par `.fx-paliers`; le code qui anime en
 * JavaScript demande sa courbe ici.
 */
import { effetActif } from "../lib/effets";

/** La courbe d'une petite animation: `douce` d'ordinaire, `pas` marches quand
 * l'effet est allumé. */
export function courbe(douce: string, pas: number): string {
  if (!Number.isInteger(pas) || pas < 1) throw new Error(`nombre de marches invalide: ${pas}`);
  return effetActif("paliers") ? `steps(${pas}, end)` : douce;
}
