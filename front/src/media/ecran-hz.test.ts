/**
 * La cadence de l'écran, lue sur une horloge arrondie à la milliseconde
 * (VID-7).
 *
 * Firefox arrondit `performance.now()` à la milliseconde quand la page n'est
 * pas isolée (ni COOP ni COEP). Un écran à 120 Hz y donne des intervalles de
 * 8, 8 et 9 ms, dont la médiane vaut 8 : le relevé du 26 novembre 2026
 * disait « écran 125 Hz ». La page lit maintenant la médiane des durées de
 * six intervalles d'affilée, divisées par six : 50 ms pour six tics, 120 Hz.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doublures, reguliere, rejouer } from "../test/banc-video";
import { periodeDesInstants } from "./clock";

let etat: ReturnType<typeof doublures>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  etat = doublures();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** L'horloge de la page arrondie à la milliseconde, comme Firefox. */
function arrondirLHorloge() {
  const vraie = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockImplementation(() => Math.floor(vraie()));
}

it("lit 120 Hz sur un écran 120 Hz dont l'horloge est arrondie à la milliseconde", () => {
  arrondirLHorloge();
  const r = rejouer(etat, { ecranMs: 1000 / 120, secondes: 4, arrivees: reguliere(4) });
  expect(r.fin.refreshHz, "l'écran 120 Hz se lit comme un autre").toBeGreaterThanOrEqual(119);
  expect(r.fin.refreshHz).toBeLessThanOrEqual(121);
});

it("lit 60 Hz sur un écran 60 Hz arrondi de même", () => {
  arrondirLHorloge();
  const r = rejouer(etat, { ecranMs: 1000 / 60, secondes: 4, arrivees: reguliere(4) });
  expect(r.fin.refreshHz).toBeGreaterThanOrEqual(59.5);
  expect(r.fin.refreshHz).toBeLessThanOrEqual(60.5);
});

// Le jumeau : un vrai écran à 125 Hz se lit 125, arrondi ou non.
it("lit encore 125 Hz sur un vrai écran à 125 Hz", () => {
  arrondirLHorloge();
  const r = rejouer(etat, { ecranMs: 8, secondes: 4, arrivees: reguliere(4) });
  expect(r.fin.refreshHz).toBeCloseTo(125, 5);
});

describe("la période d'après les instants", () => {
  it("ne bouge pas pour un tic bloqué parmi cent vingt", () => {
    // Une moyenne simple lirait 107 Hz ici (relecture de l'audit).
    const instants = [0];
    for (let i = 1; i <= 120; i++) instants.push(instants[i - 1] + (i === 60 ? 130 : 1000 / 120));
    expect(1000 / (periodeDesInstants(instants) ?? NaN)).toBeCloseTo(120, 0);
  });

  it("lit 8, 8, 9 répétés comme 120 Hz, et 8 partout comme 125", () => {
    const pas = (motif: number[]) => {
      const instants = [0];
      for (let i = 0; i < 90; i++) instants.push(instants[i] + motif[i % motif.length]);
      return 1000 / (periodeDesInstants(instants) ?? NaN);
    };
    expect(pas([8, 8, 9])).toBeCloseTo(120, 5);
    expect(pas([8])).toBeCloseTo(125, 5);
  });

  it("ne dit rien avec trop peu d'instants", () => {
    expect(periodeDesInstants([0, 8, 16])).toBeNull();
  });
});
