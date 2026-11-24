/** Le nom tapé : gardé tel quel, sans les espaces du bord, borné. */
import { describe, expect, it } from "vitest";
import { NAME_MAX, verifierNom } from "./name";

describe("verifierNom", () => {
  it("garde le nom sans ses espaces de bord", () => {
    expect(verifierNom("  Lina ")).toBe("Lina");
  });

  it("coupe au-delà de la longueur permise, plutôt que de refuser", () => {
    expect(verifierNom("x".repeat(NAME_MAX + 5))).toHaveLength(NAME_MAX);
  });

  it("jumeau : vide ou fait d'espaces, ce n'est pas un nom", () => {
    expect(verifierNom("")).toBeNull();
    expect(verifierNom("   ")).toBeNull();
    expect(verifierNom("\t\n")).toBeNull();
  });
});
