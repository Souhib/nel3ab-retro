import { describe, expect, it } from "vitest";
import { axisLabel, buttonLabel, identify } from "./families";

/** Des identifiants tels que Chrome les rapporte vraiment. */
const IDS = {
  dualsense: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
  dualshock: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
  xboxOne: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)",
  xbox360: "Xbox 360 Controller (XInput STANDARD GAMEPAD)",
  gamecube: "Mayflash GameCube Controller Adapter (Vendor: 0079 Product: 1844)",
  proController: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)",
  unknown: "Some Generic Pad (Vendor: 1234 Product: 5678)",
};

describe("reconnaître une manette", () => {
  it("distingue une PS5 d'une PS4, par le produit et pas par le nom", () => {
    expect(identify(IDS.dualsense, "standard").name).toBe("DualSense (PS5)");
    expect(identify(IDS.dualshock, "standard").name).toBe("DualShock 4 (PS4)");
    expect(identify(IDS.dualshock, "standard").family).toBe("playstation");
  });

  it("reconnaît une Xbox par l'identifiant ou par le nom", () => {
    expect(identify(IDS.xboxOne, "standard").family).toBe("xbox");
    // La 360 n'expose pas d'identifiant fabricant: il reste « XInput ».
    expect(identify(IDS.xbox360, "standard").family).toBe("xbox");
  });

  it("reconnaît un adaptateur GameCube par son nom, pas par son fabricant", () => {
    // Ces adaptateurs se déclarent sous une demi-douzaine d'identifiants, dont
    // celui-ci qui n'est ni Nintendo ni rien de reconnaissable.
    expect(identify(IDS.gamecube, "").family).toBe("gamecube");
  });

  it("reconnaît une manette Nintendo", () => {
    expect(identify(IDS.proController, "standard").family).toBe("nintendo");
  });

  // Le jumeau négatif: sans lui, une reconnaissance qui rendrait « playstation »
  // pour tout passerait chaque ligne au-dessus.
  it("ne suppose rien d'une manette qu'elle ne connaît pas", () => {
    const found = identify(IDS.unknown, "standard");
    expect(found.family).toBe("standard");
    expect(found.name).toBe("Some Generic Pad");
  });
});

describe("nommer un bouton", () => {
  it("donne la lettre de la marque ET la position garantie par la norme", () => {
    const ps = identify(IDS.dualsense, "standard");
    expect(buttonLabel(ps, 0)).toBe("✕ (bas)");
    expect(buttonLabel(ps, 3)).toBe("△ (haut)");
    const xbox = identify(IDS.xboxOne, "standard");
    expect(buttonLabel(xbox, 0)).toBe("A (bas)");
    // Le même index, une autre lettre: c'est tout l'intérêt du tableau.
    expect(buttonLabel(identify(IDS.proController, "standard"), 0)).toBe("B (bas)");
  });

  /**
   * Le coeur du module. Sur une disposition inconnue les index appartiennent au
   * matériel, donc supposer « ✕ » serait inventer. On dit ce qu'on sait.
   */
  it("ne nomme rien sur une disposition inconnue", () => {
    const gc = identify(IDS.gamecube, "");
    expect(buttonLabel(gc, 7)).toBe("bouton 7");
    expect(axisLabel(gc, 4)).toBe("axe 4");
  });

  it("nomme la position quand la marque n'a pas de nom pour ce bouton", () => {
    // 12 à 15 sont la croix, garantie par la norme dans toutes les familles.
    expect(buttonLabel(identify(IDS.unknown, "standard"), 12)).toBe("bouton 12 (croix ↑)");
  });

  it("nomme les quatre axes que la norme fixe, et pas les autres", () => {
    const ps = identify(IDS.dualsense, "standard");
    expect(axisLabel(ps, 1)).toBe("stick gauche ↑↓");
    expect(axisLabel(ps, 9)).toBe("axe 9");
  });
});
