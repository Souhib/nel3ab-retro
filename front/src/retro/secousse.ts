/**
 * « secousse »: sur une erreur, l'écran tremble de quelques pixels pendant un
 * sixième de seconde.
 *
 * Niveau « tout » seulement (la page des effets la déconseillait). Jamais sur
 * l'image du jeu: un élément qui la contient, qui en fait partie ou qui
 * la touche est refusé, et l'erreur reste écrite comme toujours.
 */
import { effetActif, mouvementReduit } from "../lib/effets";
import { toucheLImage } from "./image";

/** Secoue un élément. Rend `true` si la secousse a été jouée. */
export function secouer(el: HTMLElement): boolean {
  if (!effetActif("secousse") || mouvementReduit() || toucheLImage(el)) return false;
  if (typeof el.animate !== "function") return false;
  el.animate(
    [
      { transform: "translate(0, 0)" },
      { transform: "translate(-4px, 1px)" },
      { transform: "translate(4px, -1px)" },
      { transform: "translate(-3px, 0)" },
      { transform: "translate(0, 0)" },
    ],
    { duration: 170, easing: "steps(4, end)" },
  );
  return true;
}
