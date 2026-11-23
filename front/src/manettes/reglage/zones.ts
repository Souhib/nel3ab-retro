/** Les zones de clic des pièces d'un dessin, à la souris (changement 9 du
 * plan manettes). Une pièce de 2 unités se dessine en 5 px à 120 px de large :
 * trop petite pour un clic sûr. Chaque pièce reçoit un disque invisible
 * (`.n3-zone`) qui vise 24 px de diamètre rendus, la cible minimale du WCAG
 * (les règles d'accessibilité du web), sans jamais mordre sur une voisine :
 * quand la place manque, la zone s'arrête à mi-chemin, et jamais dans une
 * pièce voisine. Au doigt, le dessin n'est pas cliquable du tout (`Wiring`) :
 * la liste est le chemin.
 *
 * Calculé ici, pur ; posé hors de React à chaque changement de taille, avec
 * le plancher des inscriptions (`inscriptions.ts`). */

/** Le diamètre visé, en pixels rendus. */
export const CIBLE_PX = 24;

export type Piece = { key: string; x: number; y: number; r: number };

/** Le rayon de la zone de chaque pièce, en unités du dessin. Jamais moins que
 * la pièce elle-même. */
export function rayonsDesZones(
  pieces: readonly Piece[],
  pxParUnite: number,
  cible = CIBLE_PX,
): Map<string, number> {
  const voulu = cible / 2 / pxParUnite;
  const rayons = new Map<string, number>();
  for (const p of pieces) {
    let r = Math.max(p.r, voulu);
    for (const q of pieces) {
      if (q === p) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      // Deux pièces qui se touchent déjà (les branches d'une croix) gardent
      // leur forme : la zone ne grandit pas entre elles.
      if (d < p.r + q.r) {
        r = p.r;
        continue;
      }
      r = Math.min(r, Math.max(p.r, Math.min(d / 2, d - q.r)));
    }
    rayons.set(p.key, Math.max(p.r, r));
  }
  return rayons;
}

/** Pose le rayon de chaque `.n3-zone` d'un dessin rendu à `pxParUnite`. */
export function appliquerZones(svg: Element, pxParUnite: number): void {
  const cercles = [...svg.querySelectorAll<SVGCircleElement>("circle.n3-zone")];
  const pieces = cercles.map((c) => ({
    key: c.closest("[data-part]")?.getAttribute("data-part") ?? "",
    x: Number(c.getAttribute("cx")),
    y: Number(c.getAttribute("cy")),
    r: Number(c.dataset.r),
  }));
  const rayons = rayonsDesZones(pieces, pxParUnite);
  cercles.forEach((cercle, rang) => {
    const r = rayons.get(pieces[rang]!.key) ?? pieces[rang]!.r;
    const ecrit = r.toFixed(2);
    if (cercle.getAttribute("r") !== ecrit) cercle.setAttribute("r", ecrit);
  });
}
