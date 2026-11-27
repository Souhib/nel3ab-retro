/**
 * Des hoquets de liaison qui reviennent ne doivent pas devenir des trous de
 * son (relecture du 27 novembre 2026).
 *
 * La page pose chaque morceau après le précédent. Après un arrêt de la
 * liaison et sa rafale, la file garde la taille de l'arrêt : c'est ce qui
 * absorbe l'arrêt suivant sans trou. Le 26 novembre 2026, le joueur distant
 * avait un trou de 117 à 166 ms dans chaque fenêtre de dix secondes, et son
 * son n'a eu aucun trou pendant six minutes.
 *
 * La coupe de SON-1 rend ce que la plus petite file de deux secondes a de
 * trop. Sur des hoquets de taille variable, elle rend aussi la marge que le
 * hoquet suivant, plus long, aurait prise : chacun devient un trou. En temps
 * simulé, sur dix minutes de hoquets de 100 à 160 ms toutes les 0,7 à 1,3 s,
 * la page de b5f21f8 faisait 2 trous et celle de la branche 31. La coupe ne
 * part donc plus par défaut : elle attend `?son=rendre`, et la comparaison
 * en phases alternées que le propriétaire décidera.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { doubluresSon, regulier, rejouerSon } from "../test/banc-son";
import { rendreDeLAdresse } from "./sound";

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

/** Un hasard reproductible : les mêmes hoquets à chaque passage. */
function hasard(graine: number) {
  let x = graine;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

/** Deux minutes de son, et un hoquet de 100 à 160 ms toutes les 0,7 à
 * 1,3 s : la liaison retient les morceaux, puis les livre ensemble. */
function hoquets() {
  const tirage = hasard(3);
  let arrivees = regulier(0, 120_000);
  for (let debut = 2000; debut < 119_500; debut += 700 + Math.round(tirage() * 600)) {
    const ms = 100 + Math.round(tirage() * 60);
    arrivees = arrivees.map((une) =>
      une.arrivee >= debut && une.arrivee < debut + ms ? { ...une, arrivee: debut + ms } : une,
    );
  }
  return arrivees;
}

const resume = (r: Awaited<ReturnType<typeof rejouerSon>>) =>
  JSON.stringify({
    trous: r.stats.gaps,
    avance: Math.round(r.stats.leadMs),
    rendu: r.stats.renduMs,
    files: r.releves.map((un) => un.fileMs),
  });

it("par défaut, des hoquets qui reviennent ne font pas de trous de plus", async () => {
  const r = await rejouerSon(etat, hoquets());
  const dit = resume(r);
  // La précondition : les hoquets ont bien retenu le son.
  expect(
    Math.max(...r.releves.map((un) => un.fileMs?.[2] ?? 0)),
    `précondition: les hoquets doivent empiler une rafale: ${dit}`,
  ).toBeGreaterThan(90);
  // Le premier hoquet fait un trou, le plus long des suivants peut en faire
  // un autre ; la file garde ensuite ce qu'ils ont pris.
  expect(
    r.stats.gaps,
    `la page coupe par défaut, et chaque hoquet plus long devient un trou: ${dit}`,
  ).toBeLessThanOrEqual(2);
  expect(r.stats.renduMs, `la page coupe sans qu'on le lui demande: ${dit}`).toBeNull();
});

// Le jumeau : la coupe reste derrière `?son=rendre`, et elle coupe.
it("coupe encore sous ?son=rendre", async () => {
  const r = await rejouerSon(etat, hoquets(), { rendre: true });
  expect(r.stats.renduMs, resume(r)).toBeGreaterThan(0);
});

it("lit ?son=rendre dans l'adresse, et rien d'autre", () => {
  expect(rendreDeLAdresse("?son=rendre")).toBe(true);
  expect(rendreDeLAdresse("?marge=ancienne&son=rendre")).toBe(true);
  // Les jumeaux : sans le paramètre, avec une autre valeur ou une faute de
  // frappe, la page ne coupe pas.
  expect(rendreDeLAdresse("")).toBe(false);
  expect(rendreDeLAdresse("?son=Rendre")).toBe(false);
  expect(rendreDeLAdresse("?son=")).toBe(false);
  expect(rendreDeLAdresse("?rendre")).toBe(false);
});
