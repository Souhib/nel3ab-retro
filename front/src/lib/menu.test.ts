/**
 * Le menu de la salle sans React (chantier menus) : la forme de chaque
 * ligne, les groupes, les flèches et la place du menu. Chaque règle a son
 * jumeau : une flèche qui ne bouge pas doit aussi savoir bouger.
 */
import { describe, expect, it } from "vitest";
import { ICONES_PIXEL } from "../retro/icones";
import { MANETTES, miseEnPage, SANS_ZONES, type Entree, type Rect } from "./cadre";
import {
  AIDE_MAX,
  aidesTropLongues,
  BANDE_MIN,
  enGroupes,
  formeDe,
  ICONE_DE_RUBRIQUE,
  pas,
  placeDuMenu,
  RUBRIQUES,
  voisin,
  type Ligne,
  type Rubrique,
} from "./menu";

const ligne = (plus: Partial<Ligne> = {}): Ligne => ({
  id: "x",
  label: "x",
  ...plus,
});

describe("les rubriques", () => {
  it("sont quatre, dans l'ordre des onglets", () => {
    expect(RUBRIQUES).toEqual(["jeux", "manettes", "salle", "reglages"]);
  });

  it("ont chacune une icône du jeu du socle, et jamais la même (M14)", () => {
    const icones = RUBRIQUES.map((r) => ICONE_DE_RUBRIQUE[r]);
    for (const nom of icones) expect(Object.keys(ICONES_PIXEL)).toContain(nom);
    // Le jumeau : deux rubriques au même dessin ne se distinguent plus.
    expect(new Set(icones).size).toBe(RUBRIQUES.length);
  });
});

describe("la forme d'une ligne", () => {
  it("dit ce que la ligne dessine", () => {
    expect(formeDe(ligne({ onEnter: () => {} }))).toBe("action");
    expect(formeDe(ligne({ picks: [{ id: "a", label: "a" }] }))).toBe("choix");
    expect(
      formeDe(
        ligne({
          slide: {
            value: 1,
            min: 0,
            max: 2,
            step: 1,
            say: String,
            onSet: () => {},
          },
        }),
      ),
    ).toBe("glissiere");
    expect(formeDe(ligne({ bascule: false }))).toBe("bascule");
    expect(formeDe(ligne({ deplie: false }))).toBe("depli");
  });

  // Le jumeau : une décision n'agit jamais d'un seul geste, même quand la
  // ligne porte aussi des choix (les sauvegardes d'un jeu).
  it("ouvre une fiche pour une décision, même avec des choix", () => {
    const fiche = {
      consequence: "c",
      agir: "Lancer",
      annuler: "Revenir",
      onAgir: () => {},
    };
    expect(formeDe(ligne({ fiche, picks: [{ id: "a", label: "a" }], onEnter: () => {} }))).toBe(
      "fiche",
    );
  });
});

describe("les groupes", () => {
  it("posent un titre avant la première ligne de chaque groupe", () => {
    const blocs = enGroupes([
      ligne({ id: "a", group: "Image et son" }),
      ligne({ id: "b", group: "Image et son" }),
      ligne({ id: "c", group: "Cet appareil" }),
    ]);
    expect(blocs.map((b) => [b.group, b.lignes.map((l) => l.id)])).toEqual([
      ["Image et son", ["a", "b"]],
      ["Cet appareil", ["c"]],
    ]);
  });

  it("le jumeau : des lignes sans groupe forment un bloc sans titre", () => {
    expect(enGroupes([ligne({ id: "a" }), ligne({ id: "b" })])).toEqual([
      { group: null, lignes: [ligne({ id: "a" }), ligne({ id: "b" })] },
    ]);
  });
});

describe("les aides (M8)", () => {
  const rubrique = (hint: string): Rubrique => ({
    id: "salle",
    label: "Salle",
    lignes: [ligne({ id: "l", hint })],
  });

  it("refusent une aide de 70 caractères", () => {
    expect(aidesTropLongues([rubrique("a".repeat(AIDE_MAX))])).toEqual(["salle/l"]);
  });

  it("le jumeau : acceptent une aide de 69 caractères", () => {
    expect(aidesTropLongues([rubrique("a".repeat(AIDE_MAX - 1))])).toEqual([]);
  });
});

describe("les flèches (M4)", () => {
  it("↑ ↓ passent de ligne en ligne, ← → de rubrique", () => {
    expect(pas("bas", "ligne")).toEqual({ vers: "ligne", sens: 1 });
    expect(pas("haut", "ligne")).toEqual({ vers: "ligne", sens: -1 });
    expect(pas("droite", "ligne")).toEqual({ vers: "rubrique", sens: 1 });
    expect(pas("gauche", "onglet")).toEqual({ vers: "rubrique", sens: -1 });
    expect(pas("bas", "onglet")).toEqual({ vers: "ligne", sens: 1 });
  });

  // Le jumeau : une pastille radio et un curseur gardent ← →. Sans cette
  // règle, ← sur « légère » changeait de rubrique au lieu de choix.
  it("laissent ← → à une pastille et à un curseur, ↑ ↓ passent de ligne", () => {
    for (const sous of ["choix", "glissiere"] as const) {
      expect(pas("gauche", sous)).toBeNull();
      expect(pas("droite", sous)).toBeNull();
      expect(pas("bas", sous)).toEqual({ vers: "ligne", sens: 1 });
      expect(pas("haut", sous)).toEqual({ vers: "ligne", sens: -1 });
    }
  });

  it("ne prennent rien hors des onglets et des lignes, ni ↑ sur un onglet", () => {
    for (const geste of ["haut", "bas", "gauche", "droite"] as const)
      expect(pas(geste, "ailleurs")).toBeNull();
    expect(pas("haut", "onglet")).toBeNull();
  });

  it("ne font pas le tour : après la dernière ligne, ↓ reste sur la dernière", () => {
    expect(voisin(4, 5, 1)).toBe(4);
    expect(voisin(0, 5, -1)).toBe(0);
    expect(voisin(2, 5, 1)).toBe(3);
    expect(voisin(2, 5, -1)).toBe(1);
    expect(voisin(0, 0, 1)).toBe(0);
  });
});

const entree = (plus: Partial<Entree>): Entree => ({
  mode: "bureau",
  fenetre: { width: 1440, height: 900 },
  zonesSures: SANS_ZONES,
  image: { width: 1216, height: 896 },
  ajustement: "remplir",
  etat: "vit",
  role: "joueur",
  manette: null,
  largeurColonne: 304,
  largeurPanneau: null,
  agrandie: false,
  ...plus,
});

const coupe = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

describe("la place du menu (M2)", () => {
  it("se pose dans la colonne au bureau et en fenêtre étroite", () => {
    for (const mode of ["bureau", "etroit"] as const) {
      const e = entree({ mode });
      expect(placeDuMenu(miseEnPage(e), e.fenetre, SANS_ZONES)).toEqual({
        lieu: "colonne",
      });
    }
  });

  it("tenu droit, sous l'image jusqu'au bas de l'écran, sans la toucher", () => {
    for (const fenetre of [
      { width: 390, height: 844 },
      { width: 375, height: 667 },
      { width: 320, height: 568 },
    ]) {
      for (const image of [
        { width: 1216, height: 896 },
        { width: 1280, height: 720 },
      ]) {
        const e = entree({
          mode: "portrait",
          fenetre,
          image,
          manette: MANETTES.dolphin,
        });
        const geo = miseEnPage(e);
        const place = placeDuMenu(geo, fenetre, SANS_ZONES);
        if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
        expect(place.surImage).toBe(false);
        expect(coupe(place.rect, geo.image!)).toBe(0);
        expect(place.rect.y + place.rect.h).toBe(fenetre.height);
        expect(place.rect.h).toBeGreaterThan(200);
      }
    }
  });

  it("garde les zones sûres d'un téléphone", () => {
    const zones = { haut: 47, droite: 0, bas: 34, gauche: 0 };
    const fenetre = { width: 390, height: 844 };
    const geo = miseEnPage(entree({ mode: "portrait", fenetre, zonesSures: zones }));
    const place = placeDuMenu(geo, fenetre, zones);
    if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
    expect(place.rect.y + place.rect.h).toBe(fenetre.height - zones.bas);
  });

  it("couché, dans la plus large bande à côté de l'image", () => {
    const fenetre = { width: 844, height: 390 };
    for (const manette of [MANETTES.dolphin, null]) {
      const geo = miseEnPage(entree({ mode: "paysage", fenetre, manette }));
      const place = placeDuMenu(geo, fenetre, SANS_ZONES);
      if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
      expect(place.surImage).toBe(false);
      expect(place.rect.w).toBeGreaterThanOrEqual(BANDE_MIN);
      expect(coupe(place.rect, geo.image!)).toBe(0);
      // « La salle » en haut de la bande gauche ne couvre pas le menu.
      if (geo.boutonSalle) expect(coupe(place.rect, geo.boutonSalle)).toBe(0);
    }
  });

  // Le jumeau : une image 16:9 couchée ne laisse que deux bandes de 75 px.
  // Le repli couvre le bord de l'image, et il le DIT au lieu de le taire.
  it("dit quand il n'y a pas de place à côté d'une image couchée", () => {
    const fenetre = { width: 844, height: 390 };
    const geo = miseEnPage(
      entree({ mode: "paysage", fenetre, image: { width: 1280, height: 720 } }),
    );
    const place = placeDuMenu(geo, fenetre, SANS_ZONES);
    if (place.lieu === "colonne") throw new Error("tenu en main, pas de colonne");
    expect(place.surImage).toBe(true);
    expect(coupe(place.rect, geo.image!)).toBeGreaterThan(0);
  });
});
