import { beforeEach, describe, expect, it } from "vitest";

import { rememberSlot, SLOTS, slotLabel, storedSlot } from "./saves";

beforeEach(() => localStorage.clear());

describe("les deux sauvegardes", () => {
  it("part sur la partie neuve quand rien n'est retenu", () => {
    // Neuve par défaut, et pas l'inverse: quelqu'un qui découvre un jeu doit le
    // découvrir. Tout débloquer est un choix, pas un état où on se retrouve.
    expect(storedSlot()).toBe(0);
  });

  it("se garde dans les deux sens", () => {
    // Le jumeau: une fonction qui rendrait toujours zéro satisferait le test
    // au-dessus sans rien retenir du tout.
    rememberSlot(1);
    expect(storedSlot()).toBe(1);
    rememberSlot(0);
    expect(storedSlot()).toBe(0);
  });

  it("ne connaît que deux emplacements, et ils ne se confondent pas", () => {
    expect(SLOTS).toHaveLength(2);
    expect(new Set(SLOTS.map((s) => s.id)).size).toBe(2);
    expect(new Set(SLOTS.map((s) => s.label)).size).toBe(2);
  });

  it("nomme chaque emplacement, et retombe sur la neuve pour le reste", () => {
    expect(slotLabel(0)).toBe("partie neuve");
    expect(slotLabel(1)).toBe("tout débloqué");
  });

  it("survit à un stockage cassé", () => {
    // Navigation privée: `localStorage` lève au lieu de répondre. Le pire cas
    // doit être « on démarre sur une partie neuve », pas une page blanche.
    const broken = {
      getItem: () => {
        throw new Error("refusé");
      },
      setItem: () => {
        throw new Error("refusé");
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: broken, configurable: true });
    expect(storedSlot()).toBe(0);
    expect(() => rememberSlot(1)).not.toThrow();
  });
});
