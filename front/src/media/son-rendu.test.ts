/**
 * Le son rend peu à peu le retard qu'il a pris (SON-1).
 *
 * La page pose chaque morceau juste après le précédent. Après un arrêt de la
 * liaison suivi de sa rafale, les morceaux retenus s'empilent derrière le
 * réancrage, et ce retard restait pour toute la séance : la file ne revenait
 * à sa cible que sur un trou. L'avance qui « redescend d'une milliseconde »
 * ne changeait que la cible du prochain réancrage. Une horloge de carte son
 * un peu plus lente que celle de la salle faisait de même, sans trou, jusqu'à
 * 500 ms.
 *
 * La correction lit la plus petite file vue sur deux secondes. Si elle
 * dépasse l'avance de plus de 10 ms, la page coupe un morceau sur cinq au
 * plus : elle en garde 2 ms qui s'éteignent, et le suivant s'allume en 2 ms.
 * La plus petite et pas la moyenne : on ne coupe jamais ce dont la gigue a
 * besoin.
 *
 * La coupe ne tourne que sous `?son=rendre` depuis la relecture du
 * 27 novembre 2026 : sur des hoquets qui reviennent avec des tailles
 * différentes, elle fait de chaque hoquet plus long un trou
 * (`son-hoquets.test.ts`). Ces essais la demandent donc.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MORCEAU_S, doubluresSon, regulier, rejouerSon } from "../test/banc-son";
import { FLOOR, LEAD_MIN, RENDU_ESPACE } from "./sound";

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

function retenue(arrivees: { capture: number; arrivee: number }[], debut: number, ms: number) {
  return arrivees.map((une) =>
    une.arrivee >= debut && une.arrivee < debut + ms ? { ...une, arrivee: debut + ms } : une,
  );
}

/** Un hasard reproductible : la même gigue à chaque passage. */
function hasard(graine: number) {
  let x = graine;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

const resume = (r: Awaited<ReturnType<typeof rejouerSon>>) =>
  JSON.stringify({
    releves: r.releves.map((un) => un.fileMs),
    trous: r.stats.gaps,
    avance: Math.round(r.stats.leadMs),
    rendu: Math.round((r.stats as { renduMs?: number }).renduMs ?? NaN),
  });

it("rend le retard d'une rafale : la file revient à son avance sans nouveau trou", async () => {
  // Dix secondes régulières, un arrêt de 300 ms juste après, puis trente
  // secondes régulières : la forme d'un hoquet de liaison.
  const arrivees = retenue(regulier(0, 41_000), 10_020, 300);
  const r = await rejouerSon(etat, arrivees, { rendre: true });
  const dit = resume(r);
  // La précondition : l'arrêt a bien empilé la rafale.
  expect(
    r.releves[1]?.fileMs?.[2],
    `précondition: la rafale doit s'empiler: ${dit}`,
  ).toBeGreaterThan(250);
  // Les vingt dernières secondes : la file sous l'avance plus 15 ms.
  for (const releve of r.releves.slice(2))
    expect(releve.fileMs?.[2], `le son garde le retard de la rafale: ${dit}`).toBeLessThanOrEqual(
      r.stats.leadMs + 15,
    );
  // Sans recréer de trou : ceux de l'arrêt, et pas un de plus.
  expect(r.stats.gaps, dit).toBeLessThanOrEqual(2);
  expect((r.stats as { renduMs?: number }).renduMs, dit).toBeGreaterThan(250);
});

// Le jumeau : une liaison qui tremble de ±8 ms ne doit rien perdre. La file
// la plus petite de deux secondes est ce que la gigue demande : rien à rendre.
it("ne coupe rien sur une liaison qui tremble de ±8 ms", async () => {
  const tirage = hasard(7);
  const arrivees = regulier(0, 60_000, () => 20 + (tirage() * 2 - 1) * 8);
  const r = await rejouerSon(etat, arrivees, { rendre: true });
  const dit = resume(r);
  expect((r.stats as { renduMs?: number }).renduMs, dit).toBe(0);
  // Le réancrage du début de la gigue, une fois : l'avance monte et tient.
  expect(r.stats.gaps, dit).toBeLessThanOrEqual(1);
});

it("tient la file quand la carte son va un peu moins vite que la salle", async () => {
  // Cinq cents parties par million pendant six minutes : les 180 ms qu'une
  // dérive de cinquante prend en une heure, sans un seul trou.
  const arrivees = regulier(0, 360_000);
  const r = await rejouerSon(etat, arrivees, { derive: -500, releveMs: 60_000, rendre: true });
  const dit = resume(r);
  expect(r.stats.gaps, dit).toBe(0);
  for (const releve of r.releves.slice(1))
    expect(releve.fileMs?.[2], `la dérive s'accumule: ${dit}`).toBeLessThanOrEqual(
      r.stats.leadMs + 15,
    );
});

it("ne coupe jamais ce qui laisserait la file sous l'avance", async () => {
  // La rafale fixe ce qu'il faut rendre, et la page commence à couper à 14 s.
  // Juste après, la liaison s'arrête 300 ms et vide presque la file : le
  // morceau qui arrive alors, cinq morceaux après la dernière coupe, n'a plus
  // qu'une quinzaine de millisecondes devant lui. Le couper en laisserait
  // sept, sous l'avance que la gigue a gagnée.
  const arrivees = retenue(retenue(regulier(0, 20_000), 10_020, 300), 14_045, 300);
  const r = await rejouerSon(etat, arrivees, { rendre: true });
  const coupes = etat.poses.filter((p) => p.duree > 0.001 && p.duree < MORCEAU_S - 1e-6);
  expect(coupes.length, `précondition: la page a rendu: ${resume(r)}`).toBeGreaterThan(5);
  const reste = coupes.map((p) => Math.round((p.at - p.maintenant - (MORCEAU_S - p.duree)) * 1000));
  expect(
    Math.min(...reste),
    `une coupe a vidé la file: ${JSON.stringify(reste)}`,
  ).toBeGreaterThanOrEqual((LEAD_MIN + FLOOR) * 1000);
});

it("éteint le morceau coupé et allume le suivant, sans marche", async () => {
  const arrivees = retenue(regulier(0, 16_000), 10_020, 300);
  await rejouerSon(etat, arrivees, { rendre: true });
  // Le premier tampon posé est l'échantillon vide du déblocage d'iOS.
  const coupe = etat.poses.findIndex((p) => p.duree > 0.001 && p.duree < MORCEAU_S - 1e-6);
  expect(coupe, "précondition: un morceau a été coupé").toBeGreaterThan(0);
  const morceau = etat.poses[coupe];
  const suivant = etat.poses[coupe + 1];
  // Le morceau coupé part du niveau plein et finit au silence ; le suivant
  // part du silence. Le niveau du flux est 0,5.
  // Le fondu commence au premier échantillon : une marche de 0,5/96 au plus.
  expect(morceau.debut[0]).toBeCloseTo(0.5, 1);
  expect(Math.abs(morceau.fin.at(-1) ?? 1)).toBeLessThan(0.02);
  expect(Math.abs(suivant.debut[0])).toBeLessThan(0.02);
  // Il commence là où le coupé finit : rien ne se chevauche, rien ne manque.
  expect(suivant.at).toBeCloseTo(morceau.at + morceau.duree, 6);
  // Le jumeau : un morceau ordinaire commence à son niveau.
  expect(etat.poses[coupe - 1].debut[0]).toBeCloseTo(0.5, 2);
});

it("rend peu à peu : une coupe au plus tous les cinq morceaux", async () => {
  const arrivees = retenue(regulier(0, 20_000), 10_020, 300);
  await rejouerSon(etat, arrivees, { rendre: true });
  const coupes = etat.poses.flatMap((p, i) =>
    p.duree > 0.001 && p.duree < MORCEAU_S - 1e-6 ? [i] : [],
  );
  expect(coupes.length, "précondition: la page a rendu").toBeGreaterThan(10);
  const ecarts = coupes.slice(1).map((i, k) => i - coupes[k]);
  expect(Math.min(...ecarts), JSON.stringify(ecarts)).toBeGreaterThanOrEqual(RENDU_ESPACE);
});
