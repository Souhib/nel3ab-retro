import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faireNeiger, NEIGE_EVERY_MS, type MondeNeige } from "./neige";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function monde(changes: Partial<MondeNeige> = {}) {
  const dessins = { n: 0 };
  const etat = { posee: true, visible: true };
  const m: MondeNeige = {
    dessiner: () => {
      dessins.n += 1;
    },
    visible: () => etat.visible,
    reduit: () => false,
    posee: () => etat.posee,
    ...changes,
  };
  return { m, dessins, etat };
}

describe("la neige d'une connexion coupée", () => {
  it("tombe vingt fois par seconde tant que le jeton est posé", () => {
    const { m, dessins } = monde();
    const arreter = faireNeiger(document.createElement("canvas"), m);
    vi.advanceTimersByTime(1000);
    expect(dessins.n).toBe(1 + 1000 / NEIGE_EVERY_MS);
    arreter();
  });
  it("s'arrête seule quand la première image a levé le jeton", () => {
    const { m, dessins, etat } = monde();
    faireNeiger(document.createElement("canvas"), m);
    vi.advanceTimersByTime(200);
    etat.posee = false;
    const avant = dessins.n;
    vi.advanceTimersByTime(1000);
    expect(dessins.n).toBe(avant);
    // Et son minuteur est parti : rien ne tourne entre deux états.
    expect(vi.getTimerCount()).toBe(0);
  });
  it("jumeau : le jeton posé, le minuteur reste", () => {
    const { m } = monde();
    const arreter = faireNeiger(document.createElement("canvas"), m);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(1);
    arreter();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ne dessine pas un onglet caché", () => {
    const { m, dessins, etat } = monde();
    const arreter = faireNeiger(document.createElement("canvas"), m);
    etat.visible = false;
    vi.advanceTimersByTime(1000);
    expect(dessins.n).toBe(1);
    arreter();
  });
  it("en mouvement réduit, un seul bruit et aucun minuteur", () => {
    const { m, dessins } = monde({ reduit: () => true });
    faireNeiger(document.createElement("canvas"), m);
    vi.advanceTimersByTime(1000);
    expect(dessins.n).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
