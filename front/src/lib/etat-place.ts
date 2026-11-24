/**
 * Où se pose la pastille d'état d'une salle tenue en main (ADR D40).
 *
 * Au bureau, la pile des avis la pose hors de l'image (`lieuDesAvis` de la
 * salle) : en tête de la colonne, dans une bande noire. Tenue en main, la
 * pile vit dans la bande du téléphone, quand elle existe. Sans bande :
 *
 * - dans la bande noire au-dessus de l'image (le fronton) ou à sa droite,
 *   ou en paysage en haut de la grappe droite de la manette, au-dessus des
 *   gâchettes (`emplacementPastille`, K12) ;
 * - tenu droit, dans la barre, à la place du nom de la salle, qui reste lu
 *   par les lecteurs d'écran : la pastille le couvre, la tête d'Aïn reste à
 *   gauche et « La salle » à droite ;
 * - sinon, nulle part. Jamais sur l'image : la ligne parlée dit l'état, et
 *   « La salle » ouvre la feuille où la fiche est en tête. Mesuré par
 *   `manette-garde` le 24 novembre 2026 : à 375x667 et en paysage 16:9, ni
 *   bande, ni grappe libre, ni barre.
 */
import { emplacementPastille, type Geometrie, type Rect } from "./cadre";

/** La largeur que garde « La salle » à droite de la barre, en px : son
 * bouton fait au plus 120 px, plus les marges. */
export const BARRE_SALLE_PX = 140;

/** Ce que la tête d'Aïn prend à gauche de la barre, en px : la marge de la
 * barre (8), la tête (32) et l'écart qui la suit (10), comme
 * `components/telephone.css` les pose. La pastille commence après elle : la
 * tête est la maison d'Aïn au téléphone (décision du propriétaire), et ses
 * scènes d'état y jouent (`ouEstLaMascotte`). Exporté pour les essais. */
export const BARRE_TETE_PX = 50;

/** Ce qu'une pastille doit avoir pour se lire : « Ferme dans 30 min ». */
export const PASTILLE_MIN_PX = 120;

/** Les lieux de la salle où la pastille se pose seule, sans recouvrir rien. */
const A_PART: readonly string[] = ["fronton", "bordure", "grappe-droite"];

export type PlacePastille = { lieu: "pile" } | { lieu: "a-part"; rect: Rect } | null;

export function placeDeLaPastille(geo: Geometrie, tenu: boolean): PlacePastille {
  if (!tenu) return { lieu: "pile" };
  // Le fronton, la bordure droite et le haut de la grappe droite sont hors
  // de l'image par construction (`emplacementPastille` de la salle). Le
  // panneau, lui, porte les places START : la pastille ne s'y pose pas
  // par-dessus.
  const ici = emplacementPastille(geo);
  if (ici?.rect && A_PART.includes(ici.lieu)) return { lieu: "a-part", rect: ici.rect };
  if (geo.bande !== null && geo.bande.h >= 44) return { lieu: "pile" };
  if (geo.barre !== null) {
    const largeur = geo.barre.w - BARRE_TETE_PX - BARRE_SALLE_PX;
    if (largeur >= PASTILLE_MIN_PX)
      return {
        lieu: "a-part",
        rect: { x: geo.barre.x + BARRE_TETE_PX, y: geo.barre.y, w: largeur, h: geo.barre.h },
      };
  }
  return null;
}
