import { describe, expect, it } from "vitest";
import { describePad, keyLabel, keysFor } from "./describe";
import { identify } from "./families";
import { DEFAULT_KEYS, standardProfile, type PadProfile } from "./pad";

const dualsense = identify(
  "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
  "standard",
);
const adapter = identify("Mayflash GameCube Controller Adapter", "");

describe("dire ce qu'il faut appuyer sur la manette", () => {
  it("lit la table du constructeur quand rien n'a été personnalisé", () => {
    expect(describePad(null, dualsense, "A")).toBe("✕ (bas)");
    // Deux commandes pour un seul L, et c'est voulu: la tranche donne le clic,
    // la gâchette donne la course. Le dire est le seul moyen que la personne
    // trouve celle qu'elle cherche.
    expect(describePad(null, dualsense, "L")).toBe("L1 ou L2");
    expect(describePad(null, dualsense, "y")).toBe("stick gauche ↑↓ ↑");
  });

  /** Personnaliser ne doit pas changer ce qui s'affiche tant qu'on n'a rien
   * changé: sinon le bouton « personnaliser » aurait l'air de tout casser. */
  it("dit la même chose une fois la disposition matérialisée", () => {
    const profile = standardProfile("test");
    for (const key of ["A", "B", "START", "D_UP", "L", "R"] as const) {
      expect(describePad(profile, dualsense, key)).toBe(describePad(null, dualsense, key));
    }
  });

  it("dit qu'un axe est inversé quand il l'est", () => {
    const profile: PadProfile = {
      id: "x",
      buttons: {},
      triggers: {},
      sticks: { y: { axis: 1, sign: -1 } },
    };
    expect(describePad(profile, dualsense, "y")).toBe("stick gauche ↑↓ ↑ (inversé)");
  });

  // Le jumeau négatif: une commande jamais apprise ne s'invente pas.
  it("ne dit rien d'une commande qui n'est pas assignée", () => {
    const empty: PadProfile = { id: "x", buttons: {}, triggers: {}, sticks: {} };
    expect(describePad(empty, adapter, "Z")).toBeNull();
    // Et rien non plus quand la disposition est inconnue et qu'aucun profil
    // n'existe: il n'y a alors littéralement rien à dire.
    expect(describePad(null, adapter, "A")).toBeNull();
  });
});

describe("dire quelle touche", () => {
  it("trouve les touches d'une commande", () => {
    expect(keysFor(DEFAULT_KEYS, "A")).toEqual(["KeyX"]);
    expect(keysFor(DEFAULT_KEYS, "L")).toEqual(["KeyQ"]);
    expect(keysFor(DEFAULT_KEYS, "x")).toEqual(["ArrowRight"]);
  });

  it("ne trouve rien pour une commande qu'aucune touche ne fait", () => {
    expect(keysFor(DEFAULT_KEYS, "D_UP")).toEqual([]);
  });

  /**
   * Le piège que ce module existe pour éviter: `code` nomme une POSITION d'après
   * un clavier américain. Sur un azerty, la touche marquée A rend `KeyQ`.
   */
  it("affiche le caractère imprimé quand le navigateur le connaît", () => {
    const azerty = new Map([["KeyQ", "a"]]);
    expect(keyLabel("KeyQ", azerty)).toBe("A");
  });

  it("se rabat sur la position quand le navigateur ne dit rien", () => {
    expect(keyLabel("KeyQ", null)).toBe("Q");
    expect(keyLabel("Enter", null)).toBe("Entrée");
    expect(keyLabel("ArrowUp", null)).toBe("↑");
    expect(keyLabel("Numpad5", null)).toBe("pavé 5");
    expect(keyLabel("F13", null)).toBe("F13");
  });
});
