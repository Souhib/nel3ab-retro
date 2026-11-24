/** La place du réglage des touches dans la salle : jamais sur l'image. */
import { describe, expect, it } from "vitest";
import {
  MANETTES,
  REGLAGE_TENU_MIN,
  SANS_ZONES,
  miseEnPage,
  type Entree,
  type Rect,
  type ZonesSures,
} from "./cadre";
import { COLUMN, largeurPanneau, PANNEAU } from "./column";
import { couchesDeLaSalle } from "./disposition";
import type { Size } from "./fit";

/* La place du panneau tenu en main (constat 4 de la relecture des manettes,
   24 novembre 2026). Jusque-là, la salle le posait dans sa feuille agrandie,
   qui couvrait l'image : 113 880 px² à 390×844, 85 020 à 844×390.
   `placeDuReglage` disait la bonne règle sans que rien ne la lise ; le cadre
   pose maintenant le rectangle lui-même (`Geometrie.reglage`). */
const ZONES_IPHONE: ZonesSures = { haut: 47, droite: 0, bas: 34, gauche: 0 };
const ZONES_COUCHE: ZonesSures = { haut: 0, droite: 47, bas: 21, gauche: 47 };
const FORMATS: Size[] = [
  { width: 1280, height: 720 },
  { width: 640, height: 480 },
];
const MANETTES_TENUES = [MANETTES.dolphin, MANETTES.pro, null];

const tenu = (plus: Partial<Entree>): Entree => ({
  mode: "portrait",
  fenetre: { width: 390, height: 844 },
  zonesSures: SANS_ZONES,
  image: FORMATS[0]!,
  ajustement: "remplir",
  etat: "vit",
  role: "joueur",
  manette: MANETTES.dolphin,
  largeurColonne: 304,
  largeurPanneau: null,
  agrandie: false,
  ...plus,
});

const coupe = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5 ? w * h : 0;
};

describe("le réglage tenu en main", () => {
  it("monte sous l'image tenu droit, sur toute la largeur de la zone sûre, jusqu'en bas", () => {
    let vus = 0;
    for (const [width, height] of [
      // 375×548 : un téléphone court, où l'image rapetisse pour garder
      // 240 px au panneau.
      [375, 548],
      [375, 667],
      [390, 844],
      [430, 932],
      [768, 1024],
    ] as const)
      for (const zonesSures of [SANS_ZONES, ZONES_IPHONE])
        for (const image of FORMATS)
          for (const manette of MANETTES_TENUES) {
            const geo = miseEnPage(
              tenu({ fenetre: { width, height }, zonesSures, image, manette, reglage: true }),
            );
            const ici = `${width}×${height} ${image.width}×${image.height} ${manette ? "manette" : "sans"}`;
            expect(geo.reglage, ici).not.toBeNull();
            expect(geo.image, ici).not.toBeNull();
            const r = geo.reglage!;
            expect(coupe(r, geo.image!), ici).toBe(0);
            expect(coupe(r, geo.ecran!), ici).toBe(0);
            expect(r.y, ici).toBeGreaterThanOrEqual(geo.ecran!.y + geo.ecran!.h);
            expect(r.x, ici).toBe(zonesSures.gauche);
            expect(r.w, ici).toBe(width - zonesSures.gauche - zonesSures.droite);
            expect(r.y + r.h, ici).toBe(height - zonesSures.bas);
            expect(r.h, ici).toBeGreaterThanOrEqual(REGLAGE_TENU_MIN);
            // Rien d'autre ne se pose dans sa place : ni la manette à
            // l'écran, ni le panneau, ni la bande.
            expect(geo.manette, ici).toBeNull();
            expect(geo.bande, ici).toBeNull();
            expect(geo.panneau.rect, ici).toBeNull();
            vus += 1;
          }
    expect(vus).toBe(60);
  });

  it("tenu droit, l'image ne bouge pas quand la manette à l'écran lui gardait sa place", () => {
    for (const image of FORMATS) {
      const avant = miseEnPage(tenu({ image }));
      const pendant = miseEnPage(tenu({ image, reglage: true }));
      expect(pendant.image).toEqual(avant.image);
    }
  });

  it("se range à droite de l'image en travers, téléphone et tablette, sans la toucher", () => {
    let vus = 0;
    for (const [width, height, zonesSures] of [
      [667, 375, SANS_ZONES],
      [844, 390, ZONES_COUCHE],
      [932, 430, ZONES_COUCHE],
      [1024, 768, SANS_ZONES],
      [1366, 1024, SANS_ZONES],
    ] as const)
      for (const image of FORMATS)
        for (const manette of MANETTES_TENUES) {
          const geo = miseEnPage(
            tenu({
              mode: "paysage",
              fenetre: { width, height },
              zonesSures,
              image,
              manette,
              reglage: true,
            }),
          );
          const ici = `${width}×${height} ${image.width}×${image.height} ${manette ? "manette" : "sans"}`;
          expect(geo.reglage, ici).not.toBeNull();
          expect(geo.image, ici).not.toBeNull();
          const r = geo.reglage!;
          const i = geo.image!;
          expect(coupe(r, i), ici).toBe(0);
          expect(r.x, ici).toBeGreaterThanOrEqual(i.x + i.w);
          expect(r.x + r.w, ici).toBe(width - zonesSures.droite);
          expect(r.y, ici).toBe(zonesSures.haut);
          expect(r.h, ici).toBe(height - zonesSures.haut - zonesSures.bas);
          expect(r.w, ici).toBeGreaterThanOrEqual(300);
          expect(r.w, ici).toBeLessThanOrEqual(380);
          // L'image garde la plus grande part de ce qui reste.
          expect(i.w * i.h, ici).toBeGreaterThan(0.25 * width * height * 0.5);
          expect(geo.manette, ici).toBeNull();
          vus += 1;
        }
    expect(vus).toBe(30);
  });

  it("le jumeau : sans réglage ouvert, aucun rectangle ; au bureau, la colonne le porte", () => {
    expect(miseEnPage(tenu({})).reglage).toBeNull();
    expect(
      miseEnPage(tenu({ mode: "paysage", fenetre: { width: 844, height: 390 } })).reglage,
    ).toBeNull();
    expect(
      miseEnPage(tenu({ mode: "bureau", fenetre: { width: 1440, height: 900 }, reglage: true }))
        .reglage,
    ).toBeNull();
    expect(
      miseEnPage(tenu({ mode: "etroit", fenetre: { width: 800, height: 900 }, reglage: true }))
        .reglage,
    ).toBeNull();
    // Une manette seule n'a pas d'image à épargner : sa page reste la manette.
    expect(miseEnPage(tenu({ role: "seule", reglage: true })).reglage).toBeNull();
    expect(
      miseEnPage(
        tenu({
          mode: "paysage",
          fenetre: { width: 844, height: 390 },
          role: "seule",
          reglage: true,
        }),
      ).reglage,
    ).toBeNull();
  });
});

describe("largeurPanneau", () => {
  it("élargit la colonne à 46 % de la fenêtre, entre 560 et 700 px", () => {
    expect(largeurPanneau(1440, COLUMN.normal)).toBe(662);
    expect(largeurPanneau(1024, COLUMN.normal)).toBe(PANNEAU.min);
    expect(largeurPanneau(2560, COLUMN.max)).toBe(PANNEAU.max);
  });

  it("ne rend jamais moins que la colonne choisie", () => {
    // Le jumeau : une colonne plus large que la borne basse du panneau reste.
    expect(largeurPanneau(1024, 600)).toBe(600);
  });
});

describe("couchesDeLaSalle pendant le réglage", () => {
  const base = {
    tenu: true,
    etroit: false,
    feuille: null,
    manette: true,
    voile: false,
    bare: false,
  };

  it("ne monte pas la manette à l'écran : elle enverrait au jeu ce qu'on essaie", () => {
    expect(couchesDeLaSalle({ ...base, reglage: true }).pave).toBe(false);
    expect(couchesDeLaSalle({ ...base, reglage: false }).pave).toBe(true);
    expect(couchesDeLaSalle(base).pave).toBe(true);
  });
});
