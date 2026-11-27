/**
 * Le plus long arrêt vu au verre, à travers la vraie `VideoStream` (VID-4).
 *
 * Le 26 novembre 2026, le relevé disait « 18 affamées » par fenêtre. Une
 * affamée compte un ÉPISODE de file vide : un trou de 30 ms et un trou de
 * 130 ms comptent pareil, et rien ne disait combien de temps l'image restait
 * arrêtée. Le relevé lit maintenant le plus long temps sans nouvelle image
 * peinte de la fenêtre, en millisecondes.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SOURCE_MS, doublures, reguliere, rejouer, retenue } from "../test/banc-video";

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

const ECRAN_MS = 1000 / 120;

/** Le relevé de la fenêtre qui finit à `instant` (une toutes les 2 s). */
function fenetreA(r: ReturnType<typeof rejouer>, instant: number) {
  const releve = r.releves.find((un) => Math.abs(un.instant - instant) < 1);
  if (releve === undefined) throw new Error(`précondition: pas de relevé à ${instant} ms`);
  return releve.fenetre;
}

it("lit un arrêt de 40 ms puis un de 130 ms, chacun dans sa fenêtre", () => {
  // Deux arrêts de la liaison : 40 ms à 4,5 s, 130 ms à 6,5 s.
  const arrivees = retenue(retenue(reguliere(10), 4500, 40), 6500, 130);
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 10, arrivees });
  const premier = fenetreA(r, 6000.001);
  const second = fenetreA(r, 8000.001);
  const dit = JSON.stringify({ premier, second, banc: Math.round(r.arretMax) });
  expect(typeof premier?.arretMs, `la fenêtre ne dit pas l'arrêt de 40 ms: ${dit}`).toBe("number");
  expect(premier?.arretMs, dit).toBeGreaterThanOrEqual(40);
  expect(premier?.arretMs, dit).toBeLessThanOrEqual(40 + 2 * SOURCE_MS);
  expect(second?.arretMs, dit).toBeGreaterThanOrEqual(130);
  expect(second?.arretMs, dit).toBeLessThanOrEqual(130 + 2 * SOURCE_MS);
});

// Le jumeau : sur une liaison régulière, l'arrêt le plus long est une période
// de la source, à un tic d'écran près.
it("lit environ une période sur une liaison régulière", () => {
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 8, arrivees: reguliere(8) });
  const fenetre = fenetreA(r, 6000.001);
  expect(fenetre?.arretMs, JSON.stringify(fenetre)).toBeGreaterThanOrEqual(SOURCE_MS - ECRAN_MS);
  expect(fenetre?.arretMs, JSON.stringify(fenetre)).toBeLessThanOrEqual(SOURCE_MS + ECRAN_MS);
});

it("repart de rien à chaque relevé : l'arrêt de 130 ms ne reste pas dans la fenêtre suivante", () => {
  const arrivees = retenue(reguliere(10), 6500, 130);
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 10, arrivees });
  expect(fenetreA(r, 8000.001)?.arretMs).toBeGreaterThanOrEqual(130);
  expect(fenetreA(r, 10000.001)?.arretMs).toBeLessThanOrEqual(SOURCE_MS + ECRAN_MS);
});

// Nul et pas zéro : une fenêtre où rien n'a été peint n'a pas d'arrêt mesuré,
// et `attente` dit le gel pendant qu'il dure.
it("rend nul quand rien n'a été peint dans la fenêtre", () => {
  const arrivees = reguliere(10).filter((une) => une.arrivee < 3900 || une.arrivee > 8100);
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 10, arrivees });
  expect(fenetreA(r, 6000.001)?.arretMs).toBeNull();
  // Et la fenêtre où les images reviennent dit l'arrêt entier.
  expect(fenetreA(r, 10000.001)?.arretMs).toBeGreaterThanOrEqual(4000);
});

it("ne compte pas le temps d'un onglet caché comme un arrêt", () => {
  // Un onglet caché ne reçoit aucun tic d'écran : à son retour, l'écart entre
  // deux images peintes couvre tout le temps caché, que personne n'a vu.
  const cacher = (cache: boolean) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (cache ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const ticSaute = (instant: number) => {
    const cache = instant >= 4300 && instant < 5300;
    if (cache !== (document.visibilityState === "hidden")) cacher(cache);
    return cache;
  };
  try {
    const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 8, arrivees: reguliere(8), ticSaute });
    expect(typeof fenetreA(r, 6000.001)?.arretMs, "précondition: la page a peint").toBe("number");
    expect(fenetreA(r, 6000.001)?.arretMs).toBeLessThan(100);
  } finally {
    cacher(false);
  }
});
