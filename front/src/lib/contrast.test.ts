/**
 * Les planchers de lisibilité des trois coques, épinglés.
 *
 * Ces essais ne vérifient pas une jolie couleur: ils vérifient qu'un texte
 * atténué reste lisible. Chacun tomberait si quelqu'un baissait une opacité « pour
 * que ce soit plus discret », ce qui est exactement comme les trois défauts du
 * 31 août 2026 sont arrivés.
 */
import { describe, expect, it } from "vitest";

import { AA_TEXT, contrast, dimFloor } from "./contrast";

describe("le rapport de contraste", () => {
  it("rend 21 pour le noir sur blanc et 1 pour une couleur sur elle-même", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#7c6ce0", "#7c6ce0")).toBeCloseTo(1, 5);
  });

  it("ne dépend pas de l'ordre", () => {
    expect(contrast("#e8e8ee", "#08080a")).toBeCloseTo(contrast("#08080a", "#e8e8ee"), 6);
  });
});

describe("les planchers des trois coques", () => {
  it("PS3: le texte tient jusqu'à la moitié d'opacité", () => {
    // `DIM = 0.5` dans `Xmb.tsx` vient de là. Si quelqu'un descend en dessous,
    // c'est cet essai qui doit le dire, pas quelqu'un qui plisse les yeux.
    const floor = dimFloor("#e8e8ee", "#08080a");

    expect(floor).not.toBeNull();
    expect(floor).toBeCloseTo(0.5, 2);
  });

  it("Switch: le pire des deux fonds décide", () => {
    // Le fond de l'écran est plus indulgent que celui d'une vignette, et la même
    // classe sert aux deux. On garde donc le plus exigeant.
    const screen = dimFloor("#f2f2f2", "#2b2b2b") ?? 1;
    const tile = dimFloor("#f2f2f2", "#3a3a3a") ?? 1;

    expect(tile).toBeGreaterThan(screen);
    expect(tile).toBeCloseTo(0.57, 2);
  });

  it("Wii: l'encre principale ne peut presque pas s'atténuer", () => {
    // LA raison pour laquelle cette coque a une seconde encre au lieu d'une
    // opacité. Sur un fond clair, l'alpha rapproche le texte du fond.
    const floor = dimFloor("#4a5259", "#dfe3e6");

    expect(floor).not.toBeNull();
    expect(floor).toBeGreaterThan(0.8);
  });

  it("Wii: la seconde encre tient le seuil sur ses DEUX fonds, sans alpha", () => {
    expect(contrast("#5d666d", "#dfe3e6")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast("#5d666d", "#ffffff")).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("quand aucune opacité ne suffit", () => {
  it("rend rien plutôt qu'un nombre, parce que c'est un verdict", () => {
    // Le jumeau: un calcul qui rendrait 1,00 au lieu de rien laisserait croire
    // qu'il existe une opacité qui marche, et on l'écrirait.
    expect(dimFloor("#888888", "#8a8a8a")).toBeNull();
  });
});
