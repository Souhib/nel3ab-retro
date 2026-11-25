/**
 * Où se pose la pastille d'état d'une salle tenue en main (ADR D40).
 *
 * Au bureau, sur le panneau de commande sous l'image, avant « Toutes les
 * touches », quand le cadre l'y pose (`emplacementPastille` rend
 * « panneau » : pas de bande noire de 40 px) ; sinon la pile des avis la
 * pose hors de l'image (`lieuDesAvis` de la salle) : dans une bande noire,
 * en tête de la colonne. Tenue en main, la pile vit dans la bande du
 * téléphone, quand elle existe. Sans bande :
 *
 * - dans la bande noire au-dessus de l'image (le fronton) ou à sa droite,
 *   ou en paysage en haut de la grappe droite de la manette, au-dessus des
 *   gâchettes (`emplacementPastille`, K12) ;
 * - tenu droit, dans sa place de la barre (`BarreSalle`), entre le nom de
 *   la salle et « La salle » : jamais par-dessus le nom, qui se lit entier,
 *   ni sur la tête d'Aïn à gauche (décision du chef de chantier, 24 novembre
 *   2026 ; jusque-là, elle se posait par-dessus le nom) ;
 * - sinon, nulle part. Jamais sur l'image : la ligne parlée dit l'état, et
 *   « La salle » ouvre la feuille où la fiche est en tête. Mesuré par
 *   `salle-telephone` le 24 novembre 2026 : à 390x664 et 375x548 en 4:3, ni
 *   bande, ni grappe libre, ni barre.
 */
import { emplacementPastille, type Geometrie, type Rect } from "./cadre";

/** La largeur que garde « La salle » à droite de la barre, en px : son
 * bouton mesure 111 px dans Chrome (24 novembre 2026), plus l'écart qui le
 * précède et le bord de la barre (18), arrondi au-dessus. */
export const BARRE_SALLE_PX = 140;

/** Ce que garde le nom de la salle dans la barre, en px : « Salle 1 » mesure
 * 48 px de lettres en police pixel à 17 px (Chrome, 24 novembre 2026), un
 * second chiffre en ajoute 6, et l'écart qui le suit 10. Le nom ne se coupe
 * jamais quand la pastille est là (`telephone.css`, `[data-pastille]`). */
export const BARRE_NOM_PX = 64;

/** Ce que la tête d'Aïn prend à gauche de la barre, en px : la marge de la
 * barre (8), la tête (32) et l'écart qui la suit (10), comme
 * `components/telephone.css` les pose. La pastille commence après elle : la
 * tête est la maison d'Aïn au téléphone (décision du propriétaire), et ses
 * scènes d'état y jouent (`ouEstLaMascotte`). Exporté pour les essais. */
export const BARRE_TETE_PX = 50;

/** Ce qu'une pastille doit avoir pour se lire : « Ferme dans 30 min ». */
export const PASTILLE_MIN_PX = 120;

/** La hauteur d'une pastille au doigt : un bouton de 44 px quand elle mène à
 * sa fiche (`etat-salle.css`). */
export const PASTILLE_DOIGT_PX = 44;

/** La plus large pastille posée seule, en px : « La salle ne répond plus »
 * mesure 231 px en bouton dans Chrome, à 1080x810 au doigt (25 novembre
 * 2026 ; « Ferme dans 30 min » 198, « Image figée » 150), arrondi au-dessus.
 * Posée à part, rien ne la coupe : elle prend la largeur de ses mots. */
export const PASTILLE_LARGE_PX = 240;

/** L'écart que la pastille garde avec l'image, en px (ADR D40). */
const MARGE_PX = 4;

/** Les lieux de la salle où la pastille se pose seule, sans recouvrir rien. */
const A_PART: readonly string[] = ["fronton", "bordure", "grappe-droite"];

/**
 * - pile : dans la pile des avis (`#avisDuCadre`) ;
 * - panneau : sur le panneau de commande du bureau, avant « Toutes les
 *   touches » ;
 * - barre : dans sa place de la barre du téléphone ;
 * - a-part : posée seule sur un rectangle du cadre, tenue en main.
 */
export type PlacePastille =
  | { lieu: "pile" }
  | { lieu: "panneau" }
  | { lieu: "barre" }
  | { lieu: "a-part"; rect: Rect }
  | null;

export function placeDeLaPastille(geo: Geometrie, tenu: boolean): PlacePastille {
  if (!tenu)
    return emplacementPastille(geo)?.lieu === "panneau" ? { lieu: "panneau" } : { lieu: "pile" };
  // Le fronton, la bordure droite et le haut de la grappe droite sont hors
  // de l'image par construction (`emplacementPastille` de la salle). Le
  // panneau tenu en main, lui, n'a de place que pour les places START : la
  // pastille ne s'y pose pas.
  //
  // Le rectangle seul ne suffit pas : la pastille s'y centre sans être coupée
  // (`.n3-pastille-place`), et un bouton de 44 px dans un fronton de 42 px
  // débordait de 1 px sur la première rangée de l'image (relecture finale,
  // 25 novembre 2026, 1080x810 en « entier »). Un fronton trop bas laisse
  // donc passer au lieu suivant, comme une bande noire absente.
  const premier = emplacementPastille(geo);
  const sansFronton = geo.fronton ? emplacementPastille({ ...geo, fronton: null }) : null;
  for (const ici of [premier, sansFronton]) {
    if (ici?.rect && A_PART.includes(ici.lieu) && tientAPart(geo, ici.rect))
      return { lieu: "a-part", rect: ici.rect };
  }
  if (geo.bande !== null && geo.bande.h >= 44) return { lieu: "pile" };
  if (geo.barre !== null) {
    const largeur = geo.barre.w - BARRE_TETE_PX - BARRE_NOM_PX - BARRE_SALLE_PX;
    if (largeur >= PASTILLE_MIN_PX) return { lieu: "barre" };
  }
  return null;
}

/**
 * La pastille la plus large, au doigt, centrée dans `rect` comme
 * `.n3-pastille-place` la pose, tient-elle sans toucher l'image à 4 px près
 * et sans sortir de l'écran ? Pure : les mesures sont celles de Chrome
 * (`PASTILLE_LARGE_PX`, `PASTILLE_DOIGT_PX`).
 */
function tientAPart(geo: Geometrie, rect: Rect): boolean {
  const x = rect.x + (rect.w - PASTILLE_LARGE_PX) / 2;
  const y = rect.y + (rect.h - PASTILLE_DOIGT_PX) / 2;
  if (geo.ecran) {
    const e = geo.ecran;
    if (x < e.x || x + PASTILLE_LARGE_PX > e.x + e.w) return false;
    if (y < e.y || y + PASTILLE_DOIGT_PX > e.y + e.h) return false;
  }
  const im = geo.image;
  if (im === null) return true;
  const gauche = x - MARGE_PX;
  const haut = y - MARGE_PX;
  const droite = x + PASTILLE_LARGE_PX + MARGE_PX;
  const bas = y + PASTILLE_DOIGT_PX + MARGE_PX;
  return !(gauche < im.x + im.w && droite > im.x && haut < im.y + im.h && bas > im.y);
}

/** Où la salle monte la pastille de ce modèle : dans la pile des avis, sur
 * le panneau du bureau, dans la barre du téléphone, à part sur un rectangle
 * tenu en main, ou nulle part (aucune pastille, ou aucune place hors de
 * l'image). Un seul de ces lieux à la fois. */
export function montageDeLaPastille(
  modele: { pastille: unknown },
  geo: Geometrie,
  tenu: boolean,
): { pile: boolean; panneau: boolean; barre: boolean; aPart: Rect | null } {
  const rien = { pile: false, panneau: false, barre: false, aPart: null };
  if (modele.pastille === null) return rien;
  const place = placeDeLaPastille(geo, tenu);
  return {
    pile: place?.lieu === "pile",
    panneau: place?.lieu === "panneau",
    barre: place?.lieu === "barre",
    aPart: place?.lieu === "a-part" ? place.rect : null,
  };
}

/** Où vit la fiche : en tête de la colonne quand elle est à côté de l'image
 * ou dessous, sinon dans la feuille agrandie, où la colonne entière l'a en
 * tête et où la pastille l'ouvre. Pas dans la bande d'un téléphone : mesurée
 * à 390x844 le 24 novembre 2026, elle ne tient que la pastille, et les
 * gestes de la fiche passaient sous la manette à l'écran. */
export const lieuDeLaFiche = (colonne: string | null): "colonne" | "feuille" =>
  colonne === "a-cote" || colonne === "dessous" ? "colonne" : "feuille";
