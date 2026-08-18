/**
 * Faire défiler un menu au doigt.
 *
 * # Pourquoi ça manquait
 *
 * Le menu se conduit à la croix: haut, bas, gauche, droite. Au clavier et à la
 * manette c'est immédiat. Au doigt, il n'y avait que le clic: on pouvait taper
 * une entrée visible, et rien pour atteindre celles qui ne l'étaient pas.
 * Signalé le 18 août 2026 depuis un téléphone.
 *
 * # Ce que ce module décide, et ce qu'il ne décide pas
 *
 * Il traduit un glissement en CRANS, et rien d'autre. Ce que fait un cran
 * appartient au menu, qui reçoit déjà les mêmes ordres du clavier et de la
 * manette: un troisième chemin vers la même porte, pas une troisième porte.
 */

/** Combien de pixels il faut glisser pour avancer d'un cran.
 *
 * Quarante-huit. Un cran par ligne de menu à peu près, donc un glissement du
 * pouce traverse une liste sans qu'on ait l'impression de tirer un poids. Plus
 * court et le menu part en courant sur un tremblement de main.
 */
export const STEP = 48;

/** Le rapport minimum entre les deux axes pour qu'un glissement soit décidé.
 *
 * Un et demi. En dessous, le geste est trop diagonal pour qu'on sache ce qu'il
 * voulait, et deviner à la place de la personne donne un menu qui part de
 * travers une fois sur trois.
 */
const CLEAR = 1.5;

/** Ce qu'un glissement veut dire. */
export type Swipe = { axis: "x" | "y"; steps: number };

/**
 * Combien de crans, et dans quel sens, pour un déplacement donné.
 *
 * Rend `null` quand le geste ne dit rien: trop court, ou trop diagonal pour
 * qu'on sache lequel des deux axes il visait.
 *
 * Les deux axes ne sont pas mélangés. Un glissement qui donnerait à la fois du
 * haut et de la droite ferait sauter le menu en biais, et personne ne vise ça.
 */
export function swipeFrom(dx: number, dy: number, step = STEP): Swipe | null {
  const [across, down] = [Math.abs(dx), Math.abs(dy)];
  if (across < step && down < step) return null;
  if (down > across) {
    if (down < across * CLEAR) return null;
    return { axis: "y", steps: Math.trunc(dy / step) };
  }
  if (across < down * CLEAR) return null;
  return { axis: "x", steps: Math.trunc(dx / step) };
}
