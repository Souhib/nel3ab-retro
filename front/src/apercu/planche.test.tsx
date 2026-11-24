/**
 * Le gardien de la planche : chaque ancre et chaque sol qu'une scène d'Aïn
 * demande existe dans le décor où la planche la joue.
 *
 * Les noms ne sont pas recopiés ici : chaque scène est jouée contre un décor
 * qui dit oui à toute ancre et note ce qu'on lui demande ; un sol absent lève
 * `SansAncre`, qu'on ajoute avant de rejouer. Une scène qui demande une
 * ancre nouvelle rend donc la planche périmée, et cet essai le dit.
 *
 * Que la version complète y joue VRAIMENT (sans contact, sans repli) ne se
 * voit que dans un navigateur : `just planche-garde`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Plan, SansAncre, type Ancre, type Decor, type Sol } from "../mascotte/moteur";
import { AU_SALON, SCENES_AIN, type DefScene, type IdAin } from "../mascotte/scenes-ain";
import type { Scene } from "../mascotte/scenes";
import { DE_LA_SALLE, DU_SALON } from "./lieux";

const ICI: Ancre = { x: 100, y: 100, w: 20, h: 20, cx: 110, cy: 110, droite: 120, bas: 120 };

/** Les ancres et les sols qu'une version d'une scène demande. */
function demandes(
  id: IdAin,
  faire: NonNullable<DefScene["courte"]>,
  joueur: "1" | "2" | "3" | "4",
) {
  const noms = new Set<string>();
  const sols: Sol[] = [{ nom: "coin", x0: 0, x1: 640, y: 120 }];
  for (let essai = 0; essai < 30; essai++) {
    const d: Decor = {
      c: 1.5,
      tete: false,
      maison: [500, 120],
      logo: [450, 80],
      largeur: 1280,
      ancre: (nom) => (noms.add(nom), ICI),
      zones: () => [],
      sols: () => sols,
      passages: () => [],
      image: () => ({ x: 16, y: 44, w: 404, h: 227, cx: 218, cy: 157, droite: 420, bas: 271 }),
    };
    try {
      faire(new Plan(d, id, { joueur, mode: "tous" }));
      return noms;
    } catch (e) {
      if (!(e instanceof SansAncre)) throw e;
      noms.add(e.message);
      sols.push({ nom: e.message, x0: 0, x1: 640, y: 160 });
    }
  }
  throw new Error(`${id} demande sans fin`);
}

/** Ce que les scènes d'un décor demandent, versions complète et courte,
 * pour chacun des quatre joueurs. */
function toutesLesDemandes(scenes: readonly Scene[], salon: boolean) {
  const noms = new Set<string>();
  for (const scene of scenes) {
    const id = ((salon ? AU_SALON[scene as IdAin] : undefined) ?? scene) as IdAin;
    const def: DefScene = SCENES_AIN[id];
    for (const faire of [def.complete, def.courte])
      for (const j of ["1", "2", "3", "4"] as const)
        if (faire) for (const n of demandes(id, faire, j)) noms.add(n);
  }
  return noms;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Monte la planche comme la page le fait, dans `#root`. */
async function monter(adresse = "/planche.html") {
  vi.resetModules();
  history.replaceState(null, "", adresse);
  document.body.innerHTML = '<div id="root"></div>';
  await import("./planche");
  await vi.waitFor(() => expect(document.querySelectorAll(".rt-mascotte")).toHaveLength(4));
}
const manquantes = (lieu: string, noms: Set<string>) =>
  [...noms].filter(
    (n) => !document.querySelector(`#planche-${lieu} :is([data-ancre="${n}"], [data-sol="${n}"])`),
  );

describe("la planche d'Aïn", () => {
  it("joue toutes les scènes : la salle et le plateau les seize de la salle, le salon ses dix", () => {
    expect(DE_LA_SALLE).toHaveLength(16);
    expect(DU_SALON).toHaveLength(10);
    // 16 + 10, plus « premiere-image » (une coupe, rien à voir), plus les
    // cinq variantes du salon, plus le clic et le retour : les 27 + 2.
    expect(Object.keys(SCENES_AIN)).toHaveLength(16 + 5 + 1 + 5 + 2);
  });

  it("chaque ancre et chaque sol que les scènes demandent est dans son décor", async () => {
    await monter();
    const salle = toutesLesDemandes(DE_LA_SALLE, false);
    const salon = toutesLesDemandes(DU_SALON, true);
    // Les préconditions : la recherche trouve bien des ancres, sinon un
    // décor vide passerait.
    expect([...salle]).toEqual(expect.arrayContaining(["start-1", "start-4", "prise", "toque"]));
    expect([...salon]).toEqual(expect.arrayContaining(["salles", "depot", "etagere-bas"]));
    expect(manquantes("salle", salle)).toEqual([]);
    expect(manquantes("salon", salon)).toEqual([]);
  });

  it("jumeau : une ancre retirée par l'adresse manque, et l'essai le voit", async () => {
    await monter("/planche.html?sans=start-2,etagere-haut");
    const salle = toutesLesDemandes(DE_LA_SALLE, false);
    const salon = toutesLesDemandes(DU_SALON, true);
    expect(manquantes("salle", salle)).toEqual(["start-2"]);
    expect(manquantes("salon", salon)).toEqual(["etagere-haut"]);
  });

  it("la maison de chaque décor porte Aïn : le logo, le plateau, le logo du salon", async () => {
    await monter();
    for (const [lieu, hote] of [
      ["salle", "coin"],
      ["plateau", "plateau"],
      ["salon", "logo"],
    ])
      expect(
        document.querySelector(`#planche-${lieu} [data-hote="${hote}"] > .rt-mascotte`),
        lieu,
      ).not.toBeNull();
  });
});
