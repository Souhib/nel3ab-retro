/**
 * L'image du jeu, vue par les effets rétro: ce qu'aucun effet ne touche.
 *
 * La règle absolue du thème (ADR D37): rien ne passe sur l'image du jeu ni ne
 * la modifie. La zone de jeu se reconnaît à son attribut (`ZONE_JEU`, posé par
 * `Screen.tsx`); chaque utilitaire de `retro/` qui anime, secoue, recouvre ou
 * filtre un élément demande d'abord `toucheLImage`, et refuse s'il répond oui.
 *
 * React n'est jamais sur ce chemin: ces fonctions lisent le DOM une fois, au
 * moment du geste, et ne s'abonnent à rien de ce que la boucle média peint.
 */
import { ZONE_JEU } from "../lib/focus-jeu";

/** L'élément est-il la zone de jeu, à l'intérieur, ou la contient-il ? */
export function toucheLImage(element: Element): boolean {
  return (
    element.closest(`[${ZONE_JEU}]`) !== null || element.querySelector(`[${ZONE_JEU}]`) !== null
  );
}

/** Les zones de jeu sous cet élément (ou lui-même). */
export function zonesDeJeu(dans: ParentNode = document): HTMLElement[] {
  const trouvees = [...dans.querySelectorAll<HTMLElement>(`[${ZONE_JEU}]`)];
  if (dans instanceof HTMLElement && dans.hasAttribute(ZONE_JEU)) trouvees.unshift(dans);
  return trouvees;
}

/** L'attribut qui cache une zone de jeu le temps d'une transition
 * (`src/effets.css`: `visibility: hidden`). Cachée, pas modifiée: le canevas
 * garde ses pixels et la boucle média continue de peindre dessous. */
export const IMAGE_CACHEE = "data-transition-image";

/** Cache les zones de jeu d'une surface; rend la fonction qui les remontre. */
export function cacherLImage(dans: ParentNode = document): () => void {
  const zones = zonesDeJeu(dans);
  for (const zone of zones) zone.setAttribute(IMAGE_CACHEE, "");
  return () => {
    for (const zone of zones) zone.removeAttribute(IMAGE_CACHEE);
  };
}
