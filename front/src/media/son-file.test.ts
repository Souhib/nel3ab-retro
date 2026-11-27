/**
 * La file réelle du son, relevée à chaque morceau (SON-4).
 *
 * Le relevé écrivait `son.avance`, qui est la CIBLE du prochain réancrage. Le
 * 26 novembre 2026 elle disait 10 ms pendant que la file réelle restait, au
 * moins, à 33 ms. La file réelle est ce que le son a d'avance sur la carte au
 * moment où un morceau arrive : `playAt − currentTime`. La fenêtre en garde la
 * plus petite, la médiane et la plus grande.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { doubluresSon, regulier, rejouerSon } from "../test/banc-son";

let etat: ReturnType<typeof doubluresSon>;

beforeEach(() => {
  vi.useFakeTimers();
  etat = doubluresSon();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Les morceaux arrivés pendant `[debut, debut + ms[` arrivent ensemble à
 * `debut + ms`, dans l'ordre : un arrêt de la liaison, puis sa rafale. */
function retenue(arrivees: { capture: number; arrivee: number }[], debut: number, ms: number) {
  return arrivees.map((une) =>
    une.arrivee >= debut && une.arrivee < debut + ms ? { ...une, arrivee: debut + ms } : une,
  );
}

it("relève la file réelle : quelques millisecondes, puis la rafale qui reste", async () => {
  const arrivees = retenue(regulier(0, 21_000), 10_020, 300);
  const { releves } = await rejouerSon(etat, arrivees);
  const [calme, rafale] = releves;
  const dit = JSON.stringify(releves);
  expect(calme?.fileMs, `la fenêtre ne dit pas la file réelle du son: ${dit}`).toHaveLength(3);
  // Une liaison régulière : la file tient l'avance de départ, 10 ms.
  expect(calme?.fileMs?.[2], dit).toBeLessThanOrEqual(15);
  expect(calme?.fileMs?.[0], dit).toBeGreaterThanOrEqual(2);
  // Après l'arrêt de 300 ms, la rafale s'est empilée derrière le réancrage.
  expect(rafale?.fileMs?.[2], dit).toBeGreaterThanOrEqual(300);
});

// Nul et pas zéro : une fenêtre sans morceau n'a pas de file mesurée.
it("rend nul quand aucun morceau n'est arrivé dans la fenêtre", async () => {
  const arrivees = [...regulier(0, 9_000), ...regulier(21_000, 25_000)];
  const { releves } = await rejouerSon(etat, arrivees);
  expect(releves[0]?.fileMs).not.toBeNull();
  expect(releves[1]?.fileMs).toBeNull();
});
