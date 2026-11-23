/**
 * « curseur »: un seul ▶ devant l'élément choisi, comme dans le menu d'un jeu.
 *
 * Il suit le focus du clavier et le survol de la souris, dans les surfaces
 * qui l'activent (`activerCurseur`): le salon, les menus, la colonne. Il
 * clignote une fois par seconde, ne reçoit jamais le pointeur, et reste fixe
 * en mouvement réduit (`src/effets.css`). Le contour de focus reste, pour qui
 * navigue au clavier: le ▶ s'y ajoute, il ne le remplace pas.
 *
 * Une surface qui contient l'image du jeu est refusée: le ▶ se pose à gauche
 * de sa cible, et une cible au bord de l'image le poserait dessus.
 */
import { abonner, effetActif } from "../lib/effets";
import { toucheLImage } from "./image";
import { sonMenu } from "./sons";

/** Ce que le ▶ suit, par défaut: ce qu'on peut choisir. */
export const CIBLES =
  '[data-curseur], button:not(:disabled), a[href], [role="menuitem"], [role="option"], [role="tab"], input[type="radio"], input[type="checkbox"]';

/** Le ▶ en pixels: une flèche de 5 × 9 cases. */
const FLECHE =
  '<svg viewBox="0 0 5 9" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M0 0h1v9H0zM1 1h1v7H1zM2 2h1v5H2zM3 3h1v3H3zM4 4h1v1H4z"/></svg>';

const ECART = 6;

export type Curseur = {
  /** Pose le ▶ devant cet élément, ou le cache (`null`). */
  placer(cible: Element | null): void;
  /** Retire le ▶ et ce qu'il écoutait. */
  arreter(): void;
};

/** Active le ▶ dans une surface. Rend de quoi le placer et l'arrêter. */
export function activerCurseur(surface: HTMLElement, { cibles = CIBLES } = {}): Curseur {
  if (toucheLImage(surface)) return { placer: () => {}, arreter: () => {} };
  const avant = surface.style.position;
  if (getComputedStyle(surface).position === "static") surface.style.position = "relative";
  const fleche = document.createElement("span");
  fleche.className = "rt-curseur";
  fleche.setAttribute("aria-hidden", "true");
  fleche.innerHTML = FLECHE;
  surface.append(fleche);
  let suivie: Element | null = null;

  const placer = (cible: Element | null) => {
    if (cible === null || !effetActif("curseur") || !surface.contains(cible)) {
      fleche.removeAttribute("data-visible");
      if (cible === null) suivie = null;
      return;
    }
    const r = cible.getBoundingClientRect();
    const s = surface.getBoundingClientRect();
    const x = r.left - s.left + surface.scrollLeft - fleche.offsetWidth - ECART;
    const y = r.top - s.top + surface.scrollTop + (r.height - fleche.offsetHeight) / 2;
    fleche.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    fleche.setAttribute("data-visible", "");
    if (suivie !== null && suivie !== cible) sonMenu("bip");
    suivie = cible;
  };

  const viser = (evenement: Event) => {
    const cible = evenement.target instanceof Element ? evenement.target.closest(cibles) : null;
    if (cible && surface.contains(cible)) placer(cible);
  };
  const quitter = (evenement: FocusEvent) => {
    if (evenement.relatedTarget instanceof Node && surface.contains(evenement.relatedTarget))
      return;
    placer(null);
  };
  surface.addEventListener("focusin", viser);
  surface.addEventListener("pointerover", viser);
  surface.addEventListener("focusout", quitter);
  const desabonner = abonner(() => placer(suivie));

  return {
    placer,
    arreter() {
      surface.removeEventListener("focusin", viser);
      surface.removeEventListener("pointerover", viser);
      surface.removeEventListener("focusout", quitter);
      desabonner();
      fleche.remove();
      surface.style.position = avant;
    },
  };
}
