/**
 * Une image en retard d'une période, sur un écran deux fois plus rapide que
 * la source (VID-6, 27 novembre 2026).
 *
 * Le rattrapage du 8 septembre 2026 montre la dernière image dont l'heure est
 * venue et ferme les autres. Une image en retard d'une période devient
 * disponible quand la suivante est due : elle était donc jetée. Sur un écran
 * à 120 Hz pour une source à 60, il reste un tic pour la montrer : le joueur
 * voit alors chaque image, l'une 8 ms en retard, au lieu d'un saut.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SOURCE_MS, doublures, reguliere, rejouer } from "../test/banc-video";

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

/** Une source régulière dont les images `k` à `k + n` arrivent ensemble,
 * avec 15 ms de retard sur l'arrivée prévue de la dernière : la dernière est
 * déjà due quand elles arrivent, la marge ne la couvre pas. Dans l'ordre :
 * TCP ne double personne. */
function enRetard(secondes: number, k: number, n = 1) {
  const images = reguliere(secondes);
  const avec = images[k + n].arrivee + 15;
  return images.map((une, i) => (i >= k && i <= k + n ? { ...une, arrivee: avec } : une));
}

const K = 180; // à 3 s : la cadence de l'écran et celle de la source sont mesurées
const capture = K * SOURCE_MS;
const suivante = (K + 1) * SOURCE_MS;
const presque = (a: number, b: number) => Math.abs(a - b) < 0.01;

it("montre l'image en retard pendant un tic sur un écran 120 Hz, puis la suivante", () => {
  const r = rejouer(etat, { ecranMs: 1000 / 120, secondes: 4, arrivees: enRetard(4, K) });
  const vue = r.peintes.find((p) => presque(p.capture, capture));
  const apres = r.peintes.find((p) => presque(p.capture, suivante));
  expect(apres, "précondition: la suivante doit être peinte").toBeDefined();
  expect(
    vue,
    `l'image en retard n'a jamais été peinte: ${r.fin.caughtUp} rattrapages`,
  ).toBeDefined();
  expect((apres?.tic ?? 0) - (vue?.tic ?? 0)).toBe(1);
  expect(r.fin.caughtUp).toBe(0);
});

// Le jumeau : sur un écran au rythme de la source, il ne reste pas de tic.
// Montrer l'image en retard retarderait toutes les suivantes, ce que le
// rattrapage du 8 septembre 2026 existe pour éviter.
it("la jette encore sur un écran 60 Hz", () => {
  const r = rejouer(etat, { ecranMs: 1000 / 60, secondes: 4, arrivees: enRetard(4, K) });
  expect(r.peintes.find((p) => presque(p.capture, capture))).toBeUndefined();
  expect(r.fin.caughtUp).toBeGreaterThan(0);
});

it("rattrape toujours un vrai retard sur un écran 120 Hz : deux images en retard, une montrée", () => {
  // Trois images livrées ensemble, toutes en retard : la plus vieille est
  // jetée, les deux autres sont montrées chacune un tic.
  const r = rejouer(etat, { ecranMs: 1000 / 120, secondes: 4, arrivees: enRetard(4, K, 2) });
  expect(r.peintes.find((p) => presque(p.capture, capture))).toBeUndefined();
  expect(
    r.peintes.find((p) => presque(p.capture, suivante)),
    `la deuxième image en retard n'a pas été peinte: ${r.fin.caughtUp} rattrapages`,
  ).toBeDefined();
  expect(r.fin.caughtUp).toBe(1);
});
