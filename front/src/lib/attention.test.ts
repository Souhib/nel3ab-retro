import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demarrerAttention, instantsDAttention } from "./attention";

function faux() {
  const cible = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const jouer = vi.fn();
  return { cible, doc, jouer };
}

describe("la boucle d'attention", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joue à 2 500, 8 500 et 14 500 ms, jamais ensuite", () => {
    expect(instantsDAttention()).toEqual([2500, 8500, 14500]);
    const { cible, doc, jouer } = faux();
    demarrerAttention({ jouer, cible, doc });
    const appels: number[] = [];
    jouer.mockImplementation(() => appels.push(Date.now()));
    const debut = Date.now();
    vi.advanceTimersByTime(60_000);
    expect(appels.map((t) => t - debut)).toEqual([2500, 8500, 14500]);
  });

  it("se tait au premier geste", () => {
    const { cible, doc, jouer } = faux();
    demarrerAttention({ jouer, cible, doc });
    vi.advanceTimersByTime(3000);
    expect(jouer).toHaveBeenCalledTimes(1);
    cible.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(60_000);
    expect(jouer).toHaveBeenCalledTimes(1);
  });

  it("se tait à une touche aussi", () => {
    const { cible, doc, jouer } = faux();
    demarrerAttention({ jouer, cible, doc });
    cible.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(60_000);
    expect(jouer).not.toHaveBeenCalled();
  });

  it("se tait quand l'onglet se cache, et ne repart pas quand il revient", () => {
    const { cible, doc, jouer } = faux();
    demarrerAttention({ jouer, cible, doc });
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60_000);
    expect(jouer).not.toHaveBeenCalled();
  });

  it("ne part pas dans un onglet déjà caché", () => {
    const { cible, doc, jouer } = faux();
    doc.hidden = true;
    demarrerAttention({ jouer, cible, doc });
    vi.advanceTimersByTime(60_000);
    expect(jouer).not.toHaveBeenCalled();
  });

  it("s'arrête au démontage", () => {
    const { cible, doc, jouer } = faux();
    const arreter = demarrerAttention({ jouer, cible, doc });
    arreter();
    vi.advanceTimersByTime(60_000);
    expect(jouer).not.toHaveBeenCalled();
    // Le jumeau : un geste après l'arrêt ne casse rien.
    expect(() => cible.dispatchEvent(new Event("pointerdown"))).not.toThrow();
  });
});
