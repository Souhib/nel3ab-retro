import { describe, expect, it } from "vitest";
import { ETATS_DU_CADRE, SANS_IMAGE } from "./cadre";
import { RANGS, rangsDeLaColonne } from "./colonne";

const base = {
  etat: "vit" as const,
  role: "joueur" as const,
  appareil: "clavier" as const,
  fiche: false,
  partie: true,
};

describe("les rangs de la colonne", () => {
  it("donne en partie, au clavier, l'ordre de la maquette avec Signaler en tête", () => {
    expect(rangsDeLaColonne(base)).toEqual([
      "signaler",
      "reglage",
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
    expect(rangsDeLaColonne({ ...base, etat: "repos" })).toEqual([
      "signaler",
      "reglage",
      "menu",
      "autres",
    ]);
  });

  it.each(SANS_IMAGE)(
    "n'offre ni son, ni clip, ni agrandir sans image ni partie (« %s »)",
    (etat) => {
      const rangs = rangsDeLaColonne({ ...base, etat, partie: false });
      for (const absent of ["son", "garder", "agrandir", "touches"] as const) {
        expect(rangs).not.toContain(absent);
      }
    },
  );

  it("donne dès l'arrivée les rangs d'une partie en cours : la première image ne les change pas", () => {
    // colonne-stable d'etats.mjs, 24 novembre 2026 : quatre rangs paraissaient
    // à la première image, et la colonne grandissait de 196 px.
    expect(rangsDeLaColonne({ ...base, etat: "connexion" })).toEqual(rangsDeLaColonne(base));
    // Les jumeaux : une arrivée dans une salle sans partie, et un chargement
    // (le clip reste caché pendant un lancement, C8), n'ont pas ces rangs.
    // « Touches et manettes » y reste : on règle sa manette avant de jouer
    // (chantier manettes, 24 novembre 2026).
    expect(rangsDeLaColonne({ ...base, etat: "connexion", partie: false })).toEqual([
      "signaler",
      "reglage",
      "menu",
      "autres",
    ]);
    expect(rangsDeLaColonne({ ...base, etat: "demarrage" })).toEqual([
      "signaler",
      "reglage",
      "menu",
      "autres",
    ]);
    expect(rangsDeLaColonne({ ...base, etat: "repos", partie: false })).toEqual([
      "signaler",
      "reglage",
      "menu",
      "autres",
    ]);
  });

  it("met « Touches et manettes » en tête, juste sous Signaler, pour qui tient une place", () => {
    for (const appareil of ["clavier", "manette", "tactile"] as const) {
      const rangs = rangsDeLaColonne({ ...base, appareil });
      expect(rangs.indexOf("reglage")).toBe(rangs.indexOf("signaler") + 1);
    }
    // Sans Signaler (une fiche parle), il passe en tête.
    expect(rangsDeLaColonne({ ...base, etat: "figee", fiche: true })[0]).toBe("reglage");
    // Les jumeaux : ni pour qui regarde, ni dans une salle fermée.
    expect(rangsDeLaColonne({ ...base, role: "regarde" })).not.toContain("reglage");
    expect(rangsDeLaColonne({ ...base, etat: "fermee" })).not.toContain("reglage");
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
      for (const role of ["joueur", "regarde"] as const) {
        for (const appareil of ["clavier", "manette", "tactile"] as const) {
          const rangs = rangsDeLaColonne({ etat, role, appareil, fiche: false, partie: true });
          expect(rangs.at(-1)).toBe("autres");
          for (const rang of rangs) expect(RANGS).toContain(rang);
          expect(new Set(rangs).size).toBe(rangs.length);
        }
      }
    }
  });
});
