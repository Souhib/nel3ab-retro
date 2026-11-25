import { describe, expect, it } from "vitest";
import { MANETTES, miseEnPage, modeDuCadre, SANS_ZONES } from "./cadre";
import {
  BARRE_NOM_PX,
  BARRE_SALLE_PX,
  BARRE_TETE_PX,
  lieuDeLaFiche,
  montageDeLaPastille,
  PASTILLE_DOIGT_PX,
  PASTILLE_LARGE_PX,
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
    reglage: false,
  });
}

/** Une image posée sous un fronton de `h` px, à 844x390 : le fronton en
 * haut de l'écran, l'image juste dessous. */
function sousUnFronton(h: number) {
  const g = geo(844, 390);
  return {
    ...g,
    ecran: { x: 0, y: 0, w: 844, h: 390 },
    fronton: { x: 162, y: 0, w: 520, h },
    image: { x: 162, y: h, w: 520, h: 390 - h },
  };
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
    reglage: false,
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
  it("prend le fronton de la salle, hors de l'image, quand il la tient avec sa marge", () => {
    // 44 px de bouton au doigt et 4 px au-dessus comme au-dessous : 52.
    const g = sousUnFronton(52);
    expect(placeDeLaPastille(g, true)).toEqual({
      lieu: "a-part",
      rect: { x: 162, y: 0, w: 520, h: 52 },
    });
  });
  it("jumeau : un fronton de 40 à 51 px ne la prend pas, elle déborderait sur l'image", () => {
    // Relecture finale du 25 novembre 2026 : à 1080x810 en « entier », un
    // fronton de 42 px posait la pastille « Ferme dans 5 min » (44 px) à
    // 1 px sur la première rangée de l'image.
    for (const h of [40, 42, 44, 51]) {
      const g = sousUnFronton(h);
      expect(placeDeLaPastille(g, true), `fronton de ${h} px`).not.toEqual({
        lieu: "a-part",
        rect: g.fronton,
      });
    }
  });
  it("posée à part, sa boîte au doigt reste à 4 px de l'image, à toutes les tailles", () => {
    // Le balayage de la relecture finale (25 novembre 2026) : 8 367 mises en
    // page posaient le bouton de 44 px sur l'image, toutes en « entier » ou
    // « origine », avec une image 640x480 ou 640x528. Le rectangle seul ne
    // touchait jamais l'image : c'est la pastille centrée dedans qui débordait.
    const images = [
      { width: 640, height: 480 },
      { width: 640, height: 528 },
      { width: 1280, height: 720 },
    ];
    const ajustements = ["remplir", "entier", "origine"] as const;
    const manettes = [null, MANETTES.dolphin, MANETTES.pro];
    const fautes: string[] = [];
    let aPart = 0;
    // Par pas de 24 px : 57 000 mises en page, 1,6 s seul. Par pas de 12,
    // le balayage prenait 5,6 s sous la charge de `just check` et dépassait
    // les 5 s de vitest (25 novembre 2026) : d'où aussi l'échéance de 20 s
    // de cet essai, qui ne coûte rien quand il passe.
    for (let largeur = 320; largeur <= 1400; largeur += 24)
      for (let hauteur = 320; hauteur <= 1400; hauteur += 24)
        for (const image of images)
          for (const ajustement of ajustements)
            for (const manette of manettes) {
              const g = miseEnPage({
                mode: modeDuCadre({ largeur, hauteur, grossier: true, role: "joueur" }),
                fenetre: { width: largeur, height: hauteur },
                zonesSures: SANS_ZONES,
                image,
                ajustement,
                base: { image, ajustement },
                etat: "figee",
                role: "joueur",
                manette,
                largeurColonne: 304,
                largeurPanneau: null,
                agrandie: false,
                reglage: false,
              });
              const place = placeDeLaPastille(g, true);
              if (place?.lieu !== "a-part" || g.image === null) continue;
              aPart += 1;
              const r = place.rect;
              // Sa largeur est bornée par le rectangle (`max-width: 100%`).
              const large = Math.min(PASTILLE_LARGE_PX, r.w);
              const boite = {
                x: r.x + (r.w - large) / 2 - 4,
                y: r.y + (r.h - PASTILLE_DOIGT_PX) / 2 - 4,
                w: large + 8,
                h: PASTILLE_DOIGT_PX + 8,
              };
              if (coupe(boite, g.image) && fautes.length < 5)
                fautes.push(`${largeur}x${hauteur} ${ajustement} ${image.width}x${image.height}`);
            }
    // Le cas est exercé : des pastilles posées à part, pas un balayage vide.
    expect(aPart).toBeGreaterThan(300);
    expect(fautes).toEqual([]);
  }, 20_000);
  it("une bande de 44 px la prend dans sa pile, pas une de 43", () => {
    // La garde `geo.bande.h >= 44` n'avait pas d'essai (relecture finale du
    // 25 novembre 2026). Sans fronton ni barre : la bande seule décide.
    const avec = (h: number) => ({
      ...geo(390, 844),
      fronton: null,
      barre: null,
      bande: { x: 0, y: 0, w: 390, h },
    });
    expect(placeDeLaPastille(avec(44), true)).toEqual({ lieu: "pile" });
    expect(placeDeLaPastille(avec(43), true)).toBeNull();
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
