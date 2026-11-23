import { describe, expect, it } from "vitest";
import { ETATS_DU_CADRE, SANS_IMAGE } from "./cadre";
import { RANGS, rangsDeLaColonne } from "./colonne";

const base = {
  etat: "vit" as const,
  role: "joueur" as const,
  appareil: "clavier" as const,
  fiche: false,
};

describe("les rangs de la colonne", () => {
  it("donne en partie, au clavier, l'ordre de la maquette avec Signaler en tête", () => {
    expect(rangsDeLaColonne(base)).toEqual([
      "signaler",
      "son",
      "menu",
      "touches",
      "garder",
      "agrandir",
      "autres",
    ]);
  });

  it("montre « Ta manette » à qui joue à la manette, et rien au doigt", () => {
    expect(rangsDeLaColonne({ ...base, appareil: "manette" })).toContain("manette");
    expect(rangsDeLaColonne({ ...base, appareil: "manette" })).not.toContain("touches");
    const doigt = rangsDeLaColonne({ ...base, appareil: "tactile" });
    expect(doigt).not.toContain("touches");
    expect(doigt).not.toContain("manette");
  });

  it("retire au repos ce qui ne sert à rien au lieu de le griser, et garde le menu (K23)", () => {
    expect(rangsDeLaColonne({ ...base, etat: "repos" })).toEqual(["signaler", "menu", "autres"]);
  });

  it.each(SANS_IMAGE)("n'offre ni son, ni clip, ni agrandir sans image (« %s »)", (etat) => {
    const rangs = rangsDeLaColonne({ ...base, etat });
    for (const absent of ["son", "garder", "agrandir", "touches"] as const) {
      expect(rangs).not.toContain(absent);
    }
  });

  it("ne donne à un spectateur ni le menu ni ses touches", () => {
    const rangs = rangsDeLaColonne({ ...base, role: "regarde" });
    expect(rangs).toEqual(["signaler", "son", "garder", "agrandir", "autres"]);
  });

  it("cache Signaler pendant qu'une fiche parle, qui le porte : jamais deux (K25)", () => {
    expect(rangsDeLaColonne({ ...base, etat: "figee", fiche: true })).not.toContain("signaler");
    // Le jumeau : la même panne sans fiche garde le rang.
    expect(rangsDeLaColonne({ ...base, etat: "figee", fiche: false })[0]).toBe("signaler");
  });

  it("ferme le menu d'une salle fermée", () => {
    expect(rangsDeLaColonne({ ...base, etat: "fermee" })).toEqual(["signaler", "autres"]);
  });

  it("garde Autres réglages dans chaque état, rôle et appareil, et rend des rangs connus", () => {
    for (const etat of ETATS_DU_CADRE) {
      for (const role of ["joueur", "regarde", "seule"] as const) {
        for (const appareil of ["clavier", "manette", "tactile"] as const) {
          const rangs = rangsDeLaColonne({ etat, role, appareil, fiche: false });
          expect(rangs.at(-1)).toBe("autres");
          for (const rang of rangs) expect(RANGS).toContain(rang);
          expect(new Set(rangs).size).toBe(rangs.length);
        }
      }
    }
  });
});
