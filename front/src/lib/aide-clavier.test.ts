/**
 * La carte des touches lit le profil qui joue (audit T02).
 *
 * Le piège à éviter: une liste écrite à la main, juste le premier jour. Chaque
 * essai qui lit une touche par défaut a donc un jumeau qui la change et exige
 * que la carte suive.
 */
import { describe, expect, it } from "vitest";

import { keyLabel } from "../media/describe";
import { DEFAULT_KEYS, type KeyProfile } from "../media/pad";
import { defaultSwitchProfile } from "../media/switch";
import { aideDejaVue, aideDolphin, aidePro, retenirAideVue } from "./aide-clavier";

const nom = (code: string) => keyLabel(code, null);
const fait = (lignes: { touches: string; fait: string }[], quoi: string) =>
  lignes.find((ligne) => ligne.fait === quoi)?.touches;

describe("la carte d'une salle GameCube ou Wii", () => {
  it("dit les touches par défaut: flèches pour le stick, Entrée pour Start", () => {
    const lignes = aideDolphin(DEFAULT_KEYS, nom);
    expect(fait(lignes, "stick")).toBe("Flèches");
    expect(fait(lignes, "Start")).toBe("Entrée");
    expect(fait(lignes, "A")).toBe("X");
    expect(fait(lignes, "Z")).toBe("A");
    expect(fait(lignes, "L")).toBe("Q");
    expect(lignes[0]?.fait).toBe("stick");
    expect(lignes[1]?.fait).toBe("Start");
  });

  it("suit un profil changé, et ne montre pas une commande sans touche", () => {
    const keys: KeyProfile = { ...DEFAULT_KEYS, Space: { kind: "button", name: "START" } };
    delete keys.Enter;
    delete keys.KeyD;
    keys.KeyW = { kind: "stick", stick: "y", sign: 1 };
    delete keys.ArrowUp;
    const lignes = aideDolphin(keys, nom);
    expect(fait(lignes, "Start")).toBe("Espace");
    expect(fait(lignes, "Y")).toBeUndefined();
    // Trois flèches et un W ne sont plus « les flèches ».
    expect(fait(lignes, "stick")).toBe("W ← ↓ →");
  });

  it("montre deux touches pour une même commande", () => {
    const keys: KeyProfile = { ...DEFAULT_KEYS, KeyJ: { kind: "button", name: "A" } };
    expect(fait(aideDolphin(keys, nom), "A")).toBe("X ou J");
  });

  it("nomme les touches comme le clavier de la personne", () => {
    // Sur un azerty, la touche `KeyQ` est imprimée A.
    const azerty = new Map([["KeyQ", "a"]]);
    expect(
      fait(
        aideDolphin(DEFAULT_KEYS, (code) => keyLabel(code, azerty)),
        "L",
      ),
    ).toBe("A");
  });
});

describe("la carte d'une salle Switch ou Xbox 360", () => {
  it("parle Switch dans une salle Switch", () => {
    const lignes = aidePro(defaultSwitchProfile().keys, false, nom);
    expect(fait(lignes, "stick gauche")).toBe("Flèches");
    expect(fait(lignes, "+")).toBe("Entrée");
    expect(fait(lignes, "ZL")).toBe("Q");
    expect(fait(lignes, "LT")).toBeUndefined();
  });

  it("parle Xbox dans une salle Xbox 360", () => {
    const lignes = aidePro(defaultSwitchProfile().keys, true, nom);
    expect(fait(lignes, "Start")).toBe("Entrée");
    expect(fait(lignes, "LT")).toBe("Q");
    expect(fait(lignes, "+")).toBeUndefined();
  });

  it("suit un profil changé", () => {
    const keys = { ...defaultSwitchProfile().keys, PLUS: "KeyP" };
    expect(fait(aidePro(keys, false, nom), "+")).toBe("P");
  });
});

describe("se souvenir de la carte", () => {
  it("lue et repliée, elle reste repliée; rouverte, elle se remontre", () => {
    const boite = new Map<string, string>();
    const stockage = {
      getItem: (cle: string) => boite.get(cle) ?? null,
      setItem: (cle: string, valeur: string) => void boite.set(cle, valeur),
    };
    expect(aideDejaVue(stockage)).toBe(false);
    retenirAideVue(true, stockage);
    expect(aideDejaVue(stockage)).toBe(true);
    retenirAideVue(false, stockage);
    expect(aideDejaVue(stockage)).toBe(false);
  });

  it("survit à un stockage qui lève", () => {
    const casse = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
    };
    expect(aideDejaVue(casse)).toBe(false);
    expect(() => retenirAideVue(true, casse)).not.toThrow();
  });
});
