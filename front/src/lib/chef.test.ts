import { describe, expect, it } from "vitest";

import { chefParti, pourquoiPasChoisir, repriseDuRole, type Role } from "./chef";

const assis: Role = { port: 2, mine: false, chef: "Bo", moi: false };

describe("ce que la page dit du chef", () => {
  it("dit qui choisit le jeu, avec le verbe de la colonne", () => {
    expect(pourquoiPasChoisir(assis)).toBe("Bo choisit le jeu.");
    expect(pourquoiPasChoisir(assis)).not.toMatch(/décide/);
  });

  it("demande une place, et non une manette, à qui regarde", () => {
    expect(pourquoiPasChoisir({ ...assis, port: null })).toBe(
      "Prends une place pour changer de jeu.",
    );
  });

  it("ne dit rien au chef, et dit au suivant que le chef ne joue plus", () => {
    expect(pourquoiPasChoisir({ port: 1, mine: true, chef: "Ami", moi: true })).toBeNull();
    expect(pourquoiPasChoisir({ ...assis, mine: true })).toBe(
      "Bo ne joue plus : tu peux choisir le jeu.",
    );
    // Sans chef annoncé, celui à qui le worker donne la main choisit, sans un mot.
    expect(pourquoiPasChoisir({ ...assis, mine: true, chef: null })).toBeNull();
  });
});

describe("la reprise du rôle de chef", () => {
  it("n'est proposée que quand le chef ne joue plus, à qui le salon connaît", () => {
    const parti = { ...assis, mine: true };
    expect(chefParti(parti)).toBe(true);
    expect(repriseDuRole(parti, true)).toBe(true);
  });

  it("n'est pas proposée à tous: chef présent, chef soi-même, ou sans identité", () => {
    // Le défaut de l'audit T12: proposée à tout nouveau venu.
    expect(repriseDuRole(assis, true)).toBe(false);
    expect(repriseDuRole({ port: 1, mine: true, chef: "Ami", moi: true }, true)).toBe(false);
    expect(repriseDuRole({ ...assis, mine: true }, false)).toBe(false);
    expect(repriseDuRole({ ...assis, mine: true, chef: null }, true)).toBe(false);
  });
});
