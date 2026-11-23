/** Le garde du signalement dit depuis quand un repère est parti, et pour
 * combien de temps encore les boutons restent désarmés. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLAIN_EVERY, GardeSignalement } from "./garde-signalement";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("depuis et reste", () => {
  it("à 12 s d'un repère : parti il y a 12 s, 8 s à attendre", () => {
    let t = 1000;
    const garde = new GardeSignalement(() => t);
    garde.tenir();
    t += 12_000;
    expect(garde.depuis()).toBe(12);
    expect(garde.reste()).toBe(8);
  });

  it("arrondit l'attente vers le haut : 0,4 s restante se dit 1 s, jamais 0", () => {
    let t = 0;
    const garde = new GardeSignalement(() => t);
    garde.tenir();
    t = COMPLAIN_EVERY - 400;
    expect(garde.tenu()).toBe(true);
    expect(garde.reste()).toBe(1);
  });

  it("jumeau : sans repère, ou à vingt secondes, rien n'est tenu ni compté", () => {
    let t = 0;
    const garde = new GardeSignalement(() => t);
    expect(garde.depuis()).toBeNull();
    expect(garde.reste()).toBe(0);
    garde.tenir();
    t = COMPLAIN_EVERY;
    expect(garde.tenu()).toBe(false);
    expect(garde.depuis()).toBeNull();
    expect(garde.reste()).toBe(0);
  });
});
