/** Les zones de clic des pièces, à la souris : 24 px là où la place existe,
 * jamais sur une voisine (changement 9 du plan). */
import { describe, expect, it } from "vitest";
import { GAMECUBE, SWITCH_PRO, XBOX_360 } from "../../lib/padmap";
import { rayonsDesZones, type Piece } from "./zones";

/** Deux zones se coupent-elles, ou une zone entre-t-elle dans une pièce ? */
function fautes(pieces: readonly Piece[], rayons: Map<string, number>): string[] {
  const dites: string[] = [];
  for (const p of pieces)
    for (const q of pieces) {
      if (p === q) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      const rp = rayons.get(p.key)!;
      if (rp > d - q.r + 1e-9 && d >= p.r + q.r) dites.push(`${p.key} mord sur la pièce ${q.key}`);
      if (p.key < q.key && rp + rayons.get(q.key)! > d + 1e-9 && d >= p.r + q.r)
        dites.push(`${p.key} et ${q.key} se coupent`);
    }
  return dites;
}

describe("rayonsDesZones", () => {
  it("donne 24 px de diamètre à une petite pièce isolée", () => {
    // 2 px par unité : 12 px de rayon font 6 unités.
    const rayons = rayonsDesZones([{ key: "A", x: 0, y: 0, r: 2 }], 2);
    expect(rayons.get("A")).toBe(6);
  });

  it("ne rapetisse jamais une pièce plus grande que la cible", () => {
    expect(rayonsDesZones([{ key: "S", x: 0, y: 0, r: 10 }], 2).get("S")).toBe(10);
  });

  it("s'arrête à mi-chemin entre deux voisines trop proches", () => {
    const rayons = rayonsDesZones(
      [
        { key: "A", x: 0, y: 0, r: 1 },
        { key: "B", x: 6, y: 0, r: 1 },
      ],
      2,
    );
    expect(rayons.get("A")).toBe(3);
    expect(rayons.get("B")).toBe(3);
  });

  it("n'entre pas dans une grosse voisine", () => {
    const pieces: Piece[] = [
      { key: "petit", x: 0, y: 0, r: 1 },
      { key: "gros", x: 8, y: 0, r: 6 },
    ];
    const rayons = rayonsDesZones(pieces, 2);
    expect(rayons.get("petit")).toBe(2);
    expect(fautes(pieces, rayons)).toEqual([]);
  });

  it("aucune zone ne mord sur une voisine dans les vrais plans, à trois tailles", () => {
    for (const plan of [GAMECUBE, XBOX_360, SWITCH_PRO])
      for (const pxParUnite of [1.2, 3, 6]) {
        const pieces = plan.parts.filter((p) => !p.under);
        expect(
          fautes(pieces, rayonsDesZones(pieces, pxParUnite)),
          `${plan.id} à ${pxParUnite}`,
        ).toEqual([]);
      }
  });
});
