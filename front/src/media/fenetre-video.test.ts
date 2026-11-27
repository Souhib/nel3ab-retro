/**
 * Ce que la fenêtre de relevé voit de l'image, pour séparer le navigateur de
 * la liaison (chantier 2 de l'audit du 27 novembre 2026, VID-5).
 *
 * Le 26 novembre 2026, la page d'un joueur distant voyait un trou d'arrivée de
 * 117 à 166 ms dans chaque fenêtre de dix secondes, que la capture n'avait
 * pas. Le relevé ne permettait pas de dire s'il naissait sur la liaison ou sur
 * le fil principal du navigateur, qui date aussi les arrivées. Trois mesures
 * de plus, prises dans la vraie `VideoStream` :
 *
 * - l'intervalle le plus long entre deux images d'écran (un fil bloqué) ;
 * - les écarts d'arrivée au-dessus de 100 ms, et quand tombe le plus grand ;
 * - l'attente d'une image décodée dans la file, p50 et p95.
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

function fenetreA(r: ReturnType<typeof rejouer>, instant: number) {
  const releve = r.releves.find((un) => Math.abs(un.instant - instant) < 1);
  if (releve === undefined) throw new Error(`précondition: pas de relevé à ${instant} ms`);
  return releve.fenetre;
}

it("lit un fil principal bloqué 130 ms dans l'intervalle des images d'écran", () => {
  // Aucun tic d'écran entre 4,5 et 4,63 s : le navigateur n'a pas rendu la
  // main. La liaison, elle, livre à l'heure.
  const ticSaute = (instant: number) => instant >= 4500 && instant < 4630;
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 8, arrivees: reguliere(8), ticSaute });
  const fenetre = fenetreA(r, 6000.001);
  const dit = JSON.stringify(fenetre);
  expect(typeof fenetre?.ecranMaxMs, `la fenêtre ne dit pas l'intervalle d'écran: ${dit}`).toBe(
    "number",
  );
  expect(fenetre?.ecranMaxMs, dit).toBeGreaterThanOrEqual(130);
  expect(fenetre?.ecranMaxMs, dit).toBeLessThanOrEqual(130 + 2 * ECRAN_MS);
  // Et ce n'est pas la liaison : aucun écart d'arrivée au-dessus de 100 ms.
  expect(fenetre?.ecarts?.plus100, dit).toBe(0);
});

it("lit un arrêt de la liaison dans les écarts d'arrivée, et pas dans l'écran", () => {
  // Le jumeau du précédent : la liaison retient 130 ms, l'écran tourne.
  const arrivees = retenue(reguliere(8), 4500, 130);
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 8, arrivees });
  const fenetre = fenetreA(r, 6000.001);
  const dit = JSON.stringify(fenetre);
  expect(fenetre?.ecarts, `la fenêtre ne dit pas les écarts d'arrivée: ${dit}`).toBeTruthy();
  expect(fenetre?.ecarts?.plus100, dit).toBe(1);
  expect(fenetre?.ecarts?.pireMs, dit).toBeGreaterThanOrEqual(130);
  expect(fenetre?.ecarts?.pireMs, dit).toBeLessThanOrEqual(130 + SOURCE_MS + 1);
  // Le plus grand est tombé à 4,63 s : 1,37 s avant le relevé de 6 s.
  expect(fenetre?.ecarts?.ilYaMs, dit).toBeGreaterThanOrEqual(1360);
  expect(fenetre?.ecarts?.ilYaMs, dit).toBeLessThanOrEqual(1380);
  expect(fenetre?.ecranMaxMs, dit).toBeLessThanOrEqual(ECRAN_MS + 1);
});

it("lit une période sur une liaison régulière, et aucun écart au-dessus de 100 ms", () => {
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 8, arrivees: reguliere(8) });
  const fenetre = fenetreA(r, 6000.001);
  expect(fenetre?.ecarts?.plus100).toBe(0);
  expect(fenetre?.ecarts?.pireMs).toBeGreaterThanOrEqual(SOURCE_MS - 1);
  expect(fenetre?.ecarts?.pireMs).toBeLessThanOrEqual(SOURCE_MS + 1);
  expect(fenetre?.ecranMaxMs).toBeGreaterThanOrEqual(ECRAN_MS - 1);
  expect(fenetre?.ecranMaxMs).toBeLessThanOrEqual(ECRAN_MS + 1);
});

it("lit l'attente d'une image décodée dans la file, p50 et p95", () => {
  // Une liaison régulière : chaque image attend son heure dans la file, la
  // marge et la moitié d'un tic, quelques millisecondes.
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 8, arrivees: reguliere(8) });
  const sejour = fenetreA(r, 6000.001)?.sejourMs;
  expect(sejour, "la fenêtre ne dit pas l'attente dans la file").toHaveLength(2);
  const [p50, p95] = sejour ?? [NaN, NaN];
  expect(p50).toBeGreaterThanOrEqual(0);
  expect(p50).toBeLessThanOrEqual(p95);
  expect(p95).toBeLessThanOrEqual(20);
});

// Nul et pas zéro : une fenêtre sans image n'a ni écart, ni attente mesurés.
it("rend nul ce que la fenêtre n'a pas mesuré", () => {
  const arrivees = reguliere(10).filter((une) => une.arrivee < 3900 || une.arrivee > 8100);
  const r = rejouer(etat, { ecranMs: ECRAN_MS, secondes: 10, arrivees });
  const fenetre = fenetreA(r, 6000.001);
  expect(fenetre?.ecarts).toBeNull();
  expect(fenetre?.sejourMs).toBeNull();
  // L'écran, lui, a tourné : son intervalle est mesuré.
  expect(fenetre?.ecranMaxMs).toBeLessThanOrEqual(ECRAN_MS + 1);
});

it("ne compte pas le temps d'un onglet caché comme un intervalle d'écran", () => {
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
    const fenetre = fenetreA(r, 6000.001);
    expect(typeof fenetre?.ecranMaxMs, "précondition: l'écran a tourné").toBe("number");
    expect(fenetre?.ecranMaxMs).toBeLessThan(100);
  } finally {
    cacher(false);
  }
});
