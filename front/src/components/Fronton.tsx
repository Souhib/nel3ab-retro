/**
 * Le fronton de la borne : le titre du jeu au-dessus de l'image, dans la
 * bande noire quand elle fait 40 px ou plus (effet « fronton » ; 23 novembre
 * 2026, chantier salle, étape 7).
 *
 * Il vit dans la bande et n'en sort pas : son bas, mire comprise, reste à
 * 2 px au moins au-dessus de l'image, et il ne prend aucune hauteur à
 * l'image (posé en absolu dans la boîte de l'écran). Sans bande assez
 * haute, il n'existe pas et le nom reste dans l'en-tête de la colonne.
 * Quand la pile des avis occupe la bande, il lui laisse la place.
 */
import { FRONTON_MIN } from "../lib/cadre";

/** La hauteur de l'enseigne : assez pour une ligne de titre et sa mire. */
export const FRONTON_HAUTEUR = 44;
/** L'écart minimal entre le bas du fronton et le haut de l'image. */
export const FRONTON_ECART = 2;

export type Bande = { x: number; y: number; w: number; h: number };

/** Le rectangle de l'enseigne dans sa bande, ou `null` sans place. */
export function placeDuFronton(bande: Bande): Bande | null {
  if (bande.h < FRONTON_MIN) return null;
  const libre = bande.h - FRONTON_ECART;
  const h = Math.min(libre, FRONTON_HAUTEUR);
  return { x: bande.x, y: bande.y + Math.floor((libre - h) / 2), w: bande.w, h };
}

export function Fronton({ jeu, bande }: { jeu: string; bande: Bande }) {
  const place = placeDuFronton(bande);
  if (!place) return null;
  return (
    <div
      id="fronton"
      className="rt-fronton n3-fronton"
      style={{ left: place.x, top: place.y, width: place.w, height: place.h }}
    >
      <span className="n3-fronton-titre">{jeu}</span>
      <span data-ancre="annonce" />
    </div>
  );
}
