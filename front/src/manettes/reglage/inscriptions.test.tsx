import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PadMapView } from "../../components/PadMap";
import { GAMECUBE } from "../../lib/padmap";
import { appliquerInscriptions, PLANCHER_PX, tailleLisible } from "./inscriptions";

describe("tailleLisible", () => {
  it("porte une inscription de 2,2 unités à 9 px quand la pièce les tient", () => {
    expect(tailleLisible(2.2, 3, 3)).toBe(3);
    expect(tailleLisible(2.2, 3, 3)! * 3).toBe(PLANCHER_PX);
  });

  it("la cache quand la pièce est plus petite que le plancher", () => {
    expect(tailleLisible(2.2, 3, 2.9)).toBeNull();
  });

  it("laisse telle quelle une inscription déjà lisible, et porte un renvoi sans pièce", () => {
    expect(tailleLisible(3.2, 4, 1)).toBe(3.2);
    expect(tailleLisible(2.2, 1, null)).toBe(9);
    expect(tailleLisible(2.2, 0, null)).toBeNull();
  });
});

describe("appliquerInscriptions", () => {
  const monter = () => render(<PadMapView map={GAMECUBE} title="essai" />).container;
  const textes = (racine: Element) => [
    ...racine.querySelectorAll<SVGTextElement>("text[data-taille]"),
  ];

  it("tient chaque inscription au-dessus du plancher ou la cache, sur le vrai dessin", () => {
    const racine = monter();
    const tous = textes(racine);
    expect(tous.length).toBeGreaterThan(0);
    // Petit : 1,2 px par unité, comme un dessin de 120 px de large.
    appliquerInscriptions(racine, 1.2);
    const visibles = tous.filter((t) => t.getAttribute("visibility") !== "hidden");
    expect(visibles.length).toBeGreaterThan(0);
    for (const t of visibles)
      expect(Number(t.getAttribute("font-size")) * 1.2).toBeGreaterThanOrEqual(PLANCHER_PX - 0.01);
    expect(tous.some((t) => t.getAttribute("visibility") === "hidden")).toBe(true);
    // Le jumeau : à 10 px par unité, rien n'est caché ni agrandi.
    appliquerInscriptions(racine, 10);
    expect(tous.every((t) => t.getAttribute("visibility") === null)).toBe(true);
    expect(tous.every((t) => t.getAttribute("font-size") === t.dataset["taille"])).toBe(true);
  });
});
