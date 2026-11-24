import { describe, expect, it } from "vitest";
import { MANETTES, miseEnPage, modeDuCadre, SANS_ZONES } from "./cadre";
import {
  BARRE_NOM_PX,
  BARRE_SALLE_PX,
  BARRE_TETE_PX,
  lieuDeLaFiche,
  montageDeLaPastille,
  PASTILLE_MIN_PX,
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

/** La géométrie d'un bureau : la base est le format attendu de la console
 * (`baseDuPanneau`), l'image reçue peut en différer. */
function bureau(largeur: number, hauteur: number, image: Size, attendu: Size) {
  return miseEnPage({
    mode: "bureau",
    fenetre: { width: largeur, height: hauteur },
    zonesSures: SANS_ZONES,
    image,
    ajustement: "remplir",
    base: { image: attendu, ajustement: "remplir" },
    etat: "figee",
    role: "joueur",
    manette: null,
    largeurColonne: 304,
    largeurPanneau: null,
    agrandie: false,
  });
}
type Size = { width: number; height: number };
const XBOX = { width: 16, height: 9 };
const CUBE = { width: 4, height: 3 };

describe("la place de la pastille, au bureau", () => {
  it("sur le panneau de commande, quand il est sous l'image sans bande noire", () => {
    // Le banc des états : une Xbox 360 attendue, une image 4:3 reçue, à
    // 1440×900 ; le panneau reste sous l'écran et l'image le touche.
    expect(placeDeLaPastille(bureau(1440, 900, { width: 640, height: 480 }, XBOX), false)).toEqual({
      lieu: "panneau",
    });
  });
  it("le jumeau : une bande noire de 40 px la prend, ou la colonne quand le panneau y est", () => {
    // 16:9 à 1440×900 : un fronton de 86 px au-dessus de l'image.
    expect(placeDeLaPastille(bureau(1440, 900, { width: 1280, height: 720 }, XBOX), false)).toEqual(
      {
        lieu: "pile",
      },
    );
    // 4:3 attendu à 1440×900 : le panneau est au pied de la colonne.
    expect(placeDeLaPastille(bureau(1440, 900, { width: 640, height: 480 }, CUBE), false)).toEqual({
      lieu: "pile",
    });
  });
});

describe("la place de la pastille, tenue en main", () => {
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
  it("dans la barre, sans bande, elle a sa place, entre le nom de la salle et « La salle »", () => {
    // Décision du chef de chantier du 24 novembre 2026 : un vrai emplacement
    // dans la barre (`BarreSalle`), jamais par-dessus le nom de la salle.
    const g = { ...geo(375, 667), bande: null, barre: { x: 0, y: 0, w: 375, h: 52 } };
    expect(placeDeLaPastille(g, true)).toEqual({ lieu: "barre" });
    // Ce que la barre lui laisse à 375 px : la tête, le nom, « La salle ».
    expect(375 - BARRE_TETE_PX - BARRE_NOM_PX - BARRE_SALLE_PX).toBeGreaterThanOrEqual(
      PASTILLE_MIN_PX,
    );
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
    // Au pixel près : la tête, le nom et « La salle » gardés, 120 px de
    // pastille tiennent, 119 non.
    const juste = BARRE_TETE_PX + BARRE_NOM_PX + BARRE_SALLE_PX + PASTILLE_MIN_PX;
    const barre = (w: number) => ({ ...g, bande: null, barre: { x: 0, y: 0, w, h: 52 } });
    expect(placeDeLaPastille(barre(juste), true)).toEqual({ lieu: "barre" });
    expect(placeDeLaPastille(barre(juste - 1), true)).toBeNull();
  });
});

describe("où la salle monte la pastille et la fiche", () => {
  const pastille = { pastille: { texte: "Image figée" } };
  const nulle = { pile: false, panneau: false, barre: false, aPart: null };
  it("au bureau, dans la pile des avis, ou sur le panneau sous l'image", () => {
    expect(montageDeLaPastille(pastille, geo(1440, 900), false)).toEqual({ ...nulle, pile: true });
    expect(
      montageDeLaPastille(pastille, bureau(1440, 900, { width: 640, height: 480 }, XBOX), false),
    ).toEqual({ ...nulle, panneau: true });
  });
  it("tenue en main sans bande, dans sa place de la barre", () => {
    const g = { ...geo(375, 667), bande: null, barre: { x: 0, y: 0, w: 375, h: 52 } };
    expect(montageDeLaPastille(pastille, g, true)).toEqual({ ...nulle, barre: true });
  });
  it("jumeau : sans pastille, nulle part", () => {
    expect(montageDeLaPastille({ pastille: null }, geo(1440, 900), false)).toEqual(nulle);
  });
  it("jumeau : sans place hors de l'image, nulle part plutôt que dessus", () => {
    const g = { ...geo(375, 667), bande: null, barre: { x: 0, y: 0, w: 200, h: 52 } };
    expect(montageDeLaPastille(pastille, g, true)).toEqual(nulle);
  });
  it("la fiche en tête de la colonne à côté ou dessous, sinon dans la feuille", () => {
    expect(lieuDeLaFiche("a-cote")).toBe("colonne");
    expect(lieuDeLaFiche("dessous")).toBe("colonne");
    expect(lieuDeLaFiche("feuille")).toBe("feuille");
    expect(lieuDeLaFiche(null)).toBe("feuille");
  });
});
