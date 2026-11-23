/** Le plancher de lecture des inscriptions des dessins : 9 px rendus.
 *
 * Un dessin de manette se met à l'échelle de sa boîte : à 120 px de large,
 * une inscription de 2,2 unités tombe sous 3 px. Elle est portée à 9 px si
 * elle tient encore dans sa pièce, sinon cachée ; son nom reste dans la
 * table des correspondances. Une inscription posée hors de la pièce (un
 * renvoi) n'a pas de pièce à respecter. Les lettres restent en Anybody (D4).
 *
 * Hors de React : une boîte qui change de taille ne rend pas le panneau, elle
 * réécrit seulement `font-size` et `visibility` des textes. */
import { appliquerZones } from "./zones";

export const PLANCHER_PX = 9;

/** La taille d'une inscription en unités du dessin, ou `null` : cachée. */
export function tailleLisible(
  taille: number,
  pxParUnite: number,
  piece: number | null,
): number | null {
  if (!(pxParUnite > 0)) return null;
  if (taille * pxParUnite >= PLANCHER_PX) return taille;
  const voulue = PLANCHER_PX / pxParUnite;
  return piece === null || voulue <= piece ? voulue : null;
}

/** Réécrit chaque inscription marquée `data-taille` (et `data-piece`) d'un
 * dessin rendu à `pxParUnite` pixels par unité. */
export function appliquerInscriptions(svg: Element, pxParUnite: number): void {
  for (const texte of svg.querySelectorAll<SVGTextElement>("text[data-taille]")) {
    const piece = texte.dataset["piece"];
    const taille = tailleLisible(
      Number(texte.dataset["taille"]),
      pxParUnite,
      piece === undefined ? null : Number(piece),
    );
    if (taille === null) {
      texte.setAttribute("visibility", "hidden");
    } else {
      texte.removeAttribute("visibility");
      texte.setAttribute("font-size", String(Math.round(taille * 100) / 100));
    }
  }
}

/** Tient le plancher à chaque changement de taille du dessin ; rend la
 * fonction qui arrête. Sans `ResizeObserver`, rien ne change. */
export function tenirInscriptions(svg: SVGSVGElement): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const largeur = svg.viewBox.baseVal?.width ?? 0;
  const observateur = new ResizeObserver(([entree]) => {
    const rendue = entree?.contentRect.width ?? 0;
    if (largeur > 0 && rendue > 0) {
      appliquerInscriptions(svg, rendue / largeur);
      // Les zones de clic suivent la même taille rendue (`zones.ts`).
      appliquerZones(svg, rendue / largeur);
    }
  });
  observateur.observe(svg);
  return () => observateur.disconnect();
}

/** Tient le plancher de tous les dessins d'une racine. */
export function tenirDessins(racine: Element): () => void {
  const arrets = [...racine.querySelectorAll("svg")].map(tenirInscriptions);
  return () => {
    for (const arreter of arrets) arreter();
  };
}
