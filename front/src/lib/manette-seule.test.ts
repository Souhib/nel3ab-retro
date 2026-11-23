import { describe, expect, it } from "vitest";
import { phraseDeLatence } from "./manette-seule";
import { fautes } from "./mots";

describe("la latence dite à la manette seule", () => {
  it("dit que les touches arrivent quand l'écho est frais et l'aller-retour court", () => {
    expect(phraseDeLatence({ allerRetourMs: 18, entenduIlYaMs: 500 })).toBe(
      "Tes touches arrivent.",
    );
    expect(phraseDeLatence({ allerRetourMs: 60, entenduIlYaMs: 1999 })).toBe(
      "Tes touches arrivent.",
    );
  });

  it("donne le chiffre au-delà de 60 ms", () => {
    expect(phraseDeLatence({ allerRetourMs: 85, entenduIlYaMs: 500 })).toBe(
      "Tes touches mettent 85 ms à arriver.",
    );
    expect(phraseDeLatence({ allerRetourMs: 61, entenduIlYaMs: 0 })).toContain("61 ms");
  });

  it("n'affirme rien d'un écho qui se tait depuis 2 s, même rapide", () => {
    expect(phraseDeLatence({ allerRetourMs: 18, entenduIlYaMs: 6000 })).not.toContain("arrivent");
    expect(phraseDeLatence({ allerRetourMs: 18, entenduIlYaMs: 2000 })).toBe(
      "La page attend la réponse de la salle.",
    );
  });

  it("attend tant que rien n'est mesuré", () => {
    expect(phraseDeLatence({ allerRetourMs: null, entenduIlYaMs: 100 })).toBe(
      "La page attend la réponse de la salle.",
    );
    expect(phraseDeLatence({ allerRetourMs: 20, entenduIlYaMs: null })).toBe(
      "La page attend la réponse de la salle.",
    );
  });

  it("parle sans mot d'atelier", () => {
    for (const phrase of [
      phraseDeLatence({ allerRetourMs: 18, entenduIlYaMs: 0 }),
      phraseDeLatence({ allerRetourMs: 85, entenduIlYaMs: 0 }),
      phraseDeLatence({ allerRetourMs: null, entenduIlYaMs: null }),
    ]) {
      expect(fautes(phrase)).toEqual([]);
    }
  });
});
