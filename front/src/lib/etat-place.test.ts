import { describe, expect, it } from "vitest";
import { MANETTES, miseEnPage, modeDuCadre, SANS_ZONES } from "./cadre";
import {
  BARRE_SALLE_PX,
  BARRE_TETE_PX,
  lieuDeLaFiche,
  montageDeLaPastille,
  placeDeLaPastille,
} from "./etat-place";

/** La géométrie d'une salle tenue en main, comme la page la calcule. */
function geo(largeur: number, hauteur: number, image = { width: 640, height: 480 }) {
  const fenetre = { width: largeur, height: hauteur };
  return miseEnPage({
    mode: modeDuCadre({ largeur, hauteur, grossier: true, role: "joueur" }),
    fenetre,
    zonesSures: SANS_ZONES,
    image,
    ajustement: "remplir",
    base: null,
    etat: "vit",
    role: "joueur",
    manette: MANETTES.dolphin,
    largeurColonne: 304,
    largeurPanneau: null,
    agrandie: false,
  });
}

const coupe = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("la place de la pastille, tenue en main", () => {
  it("au bureau, la pile des avis la pose", () => {
    expect(placeDeLaPastille(geo(1440, 900), false)).toEqual({ lieu: "pile" });
  });
  it("aucune place rendue ne touche l'image, à toutes les tailles de téléphone", () => {
    for (const [l, h] of [
      [375, 667],
      [390, 844],
      [430, 932],
      [844, 390],
      [932, 430],
      [768, 1024],
    ]) {
      for (const image of [
        { width: 640, height: 480 },
        { width: 1280, height: 720 },
      ]) {
        const g = geo(l, h, image);
        const place = placeDeLaPastille(g, true);
        if (place?.lieu === "a-part" && g.image)
          expect(coupe(place.rect, g.image), `${l}x${h} ${image.width}`).toBe(false);
      }
    }
  });
  it("dans la barre, sans bande, elle laisse la place de « La salle » à droite", () => {
    const g = { ...geo(375, 667), bande: null, barre: { x: 0, y: 0, w: 375, h: 52 } };
    const place = placeDeLaPastille(g, true);
    expect(place?.lieu).toBe("a-part");
    if (place?.lieu !== "a-part") throw new Error("pas de place à part");
    expect(place.rect.y).toBe(0);
    expect(place.rect.x + place.rect.w).toBeLessThanOrEqual(375 - BARRE_SALLE_PX);
  });
  it("dans la barre, elle commence après la tête d'Aïn, sa maison au téléphone", () => {
    // La tête est posée à 8 px du bord, 32 px de large, suivie de 10 px
    // (`components/telephone.css`). Le 24 novembre 2026, la pastille partait
    // de x + 8 et la couvrait toute à 375x667 (relecture du chantier).
    const g = { ...geo(375, 667), bande: null, barre: { x: 12, y: 0, w: 375, h: 52 } };
    const place = placeDeLaPastille(g, true);
    if (place?.lieu !== "a-part") throw new Error("pas de place à part");
    const tete = { x: 12 + 8, y: 10, w: 32, h: 32 };
    expect(coupe(place.rect, tete)).toBe(false);
    expect(place.rect.x).toBe(12 + BARRE_TETE_PX);
    expect(place.rect.x + place.rect.w).toBe(12 + 375 - BARRE_SALLE_PX);
  });
  it("prend le fronton de la salle, hors de l'image, quand il existe", () => {
    const g = { ...geo(844, 390), fronton: { x: 162, y: 0, w: 520, h: 44 } };
    expect(placeDeLaPastille(g, true)).toEqual({
      lieu: "a-part",
      rect: { x: 162, y: 0, w: 520, h: 44 },
    });
  });
  it("jumeau : une barre trop étroite ne la prend pas", () => {
    const g = geo(375, 667);
    const etroite = { ...g, bande: null, barre: { x: 0, y: 0, w: 200, h: 52 } };
    expect(placeDeLaPastille(etroite, true)).toBeNull();
  });
});

describe("où la salle monte la pastille et la fiche", () => {
  const pastille = { pastille: { texte: "Image figée" } };
  it("au bureau, dans la pile des avis", () => {
    expect(montageDeLaPastille(pastille, geo(1440, 900), false)).toEqual({
      pile: true,
      aPart: null,
    });
  });
  it("tenue en main sans bande, à part dans la barre", () => {
    const g = { ...geo(375, 667), bande: null, barre: { x: 0, y: 0, w: 375, h: 52 } };
    const m = montageDeLaPastille(pastille, g, true);
    expect(m.pile).toBe(false);
    expect(m.aPart).toEqual({
      x: BARRE_TETE_PX,
      y: 0,
      w: 375 - BARRE_TETE_PX - BARRE_SALLE_PX,
      h: 52,
    });
  });
  it("jumeau : sans pastille, nulle part", () => {
    expect(montageDeLaPastille({ pastille: null }, geo(1440, 900), false)).toEqual({
      pile: false,
      aPart: null,
    });
  });
  it("jumeau : sans place hors de l'image, nulle part plutôt que dessus", () => {
    const g = { ...geo(375, 667), bande: null, barre: { x: 0, y: 0, w: 200, h: 52 } };
    expect(montageDeLaPastille(pastille, g, true)).toEqual({ pile: false, aPart: null });
  });
  it("la fiche en tête de la colonne à côté ou dessous, sinon dans la feuille", () => {
    expect(lieuDeLaFiche("a-cote")).toBe("colonne");
    expect(lieuDeLaFiche("dessous")).toBe("colonne");
    expect(lieuDeLaFiche("feuille")).toBe("feuille");
    expect(lieuDeLaFiche(null)).toBe("feuille");
  });
});
