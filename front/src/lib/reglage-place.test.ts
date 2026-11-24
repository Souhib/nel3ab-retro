/** La place du réglage des touches dans la salle : jamais sur l'image. */
import { describe, expect, it } from "vitest";
import { COLUMN, largeurPanneau, PANNEAU } from "./column";
import { couchesDeLaSalle, placeDuReglage } from "./disposition";

describe("placeDuReglage", () => {
  it("prend la colonne au bureau à la souris, et passe dessous en fenêtre étroite", () => {
    expect(placeDuReglage({ largeur: 1440, hauteur: 900, grossier: false })).toBe("colonne");
    expect(placeDuReglage({ largeur: 900, hauteur: 700, grossier: false })).toBe("colonne");
    expect(placeDuReglage({ largeur: 899, hauteur: 700, grossier: false })).toBe("dessous");
  });

  it("se range à droite au doigt tenu en travers, tablette comprise, et dessous tenu droit", () => {
    expect(placeDuReglage({ largeur: 1024, hauteur: 768, grossier: true })).toBe("droite");
    expect(placeDuReglage({ largeur: 844, hauteur: 390, grossier: true })).toBe("droite");
    expect(placeDuReglage({ largeur: 390, hauteur: 844, grossier: true })).toBe("dessous");
    expect(placeDuReglage({ largeur: 768, hauteur: 1024, grossier: true })).toBe("dessous");
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
