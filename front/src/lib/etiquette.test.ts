import { describe, expect, it } from "vitest";
import { initiales } from "../retro/arcade";
import { initialesDeLaSalle, troisLettres } from "./etiquette";

describe("les trois lettres d'une étiquette", () => {
  it("reprend le calcul du socle : sans accent, en capitales, les lettres seules", () => {
    expect(troisLettres("Lina")).toBe("LIN");
    expect(troisLettres("Sami")).toBe("SAM");
    expect(troisLettres("mémé")).toBe("MEM");
    expect(troisLettres("Jean-Pierre")).toBe("JEA");
    // Le socle reste la source : une lettre qu'il garde, l'étiquette la garde.
    for (const nom of ["Élodie", "o'Neil", "Zoé 2"]) {
      expect(troisLettres(nom).replace(/-+$/, "")).toBe(initiales(nom));
    }
  });

  it("complète un nom court par des tirets, jamais par du vide", () => {
    expect(troisLettres("A")).toBe("A--");
    expect(troisLettres("Al")).toBe("AL-");
    expect(troisLettres("42")).toBe("---");
    expect(troisLettres("")).toBe("---");
    // Le jumeau : un nom de trois lettres ou plus n'est jamais complété.
    expect(troisLettres("Bob")).toBe("Bob".toUpperCase());
  });
});

describe("les initiales d'une salle", () => {
  it("deux « Lina » ne donnent pas deux LIN : chacune prend son numéro de place", () => {
    const lettres = initialesDeLaSalle(
      new Map([
        [1, "Lina"],
        [3, "Lina"],
        [2, "Sami"],
      ]),
    );
    expect(lettres.get(1)).toBe("LI1");
    expect(lettres.get(3)).toBe("LI3");
    expect(new Set(lettres.values()).size).toBe(3);
    // Le jumeau : sans doublon, les lettres restent celles du nom.
    expect(lettres.get(2)).toBe("SAM");
  });

  it("ne dépend pas de l'ordre d'arrivée", () => {
    const avant = initialesDeLaSalle(
      new Map([
        [4, "Linus"],
        [2, "Lina"],
      ]),
    );
    const apres = initialesDeLaSalle(
      new Map([
        [2, "Lina"],
        [4, "Linus"],
      ]),
    );
    expect([...avant.entries()].sort()).toEqual([...apres.entries()].sort());
    expect(avant.get(2)).toBe("LI2");
  });

  it("n'invente rien pour une place sans nom", () => {
    const lettres = initialesDeLaSalle(new Map([[1, "Bo"]]));
    expect(lettres.has(2)).toBe(false);
    expect(lettres.get(1)).toBe("BO-");
  });
});
