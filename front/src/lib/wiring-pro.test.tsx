/** Les deux dessins de la trame Pro, peints sur leur vrai balisage. */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PadMapView } from "../components/PadMap";
import { emptySwitch, standardSwitchDevice } from "../media/switch";
import { SWITCH_PRO, XBOX } from "./padmap";
import { paintPro, type Raw } from "./wiring";

const monter = () => {
  const { container } = render(
    <>
      <div data-gauche="">
        <PadMapView map={SWITCH_PRO} title="gauche" />
      </div>
      <div data-droite="">
        <PadMapView map={XBOX} title="droite" />
      </div>
    </>,
  );
  const gauche = container.querySelector("[data-gauche]")!;
  const droite = container.querySelector("[data-droite]")!;
  const allumees = (racine: Element) =>
    [...racine.querySelectorAll<SVGGElement>("[data-part][data-lit=oui]")].map(
      (piece) => piece.dataset["part"],
    );
  return { gauche, droite, allumees };
};

const brut = (presses: number[], axes: number[] = [0, 0, 0, 0]): Raw => ({
  buttons: Array.from({ length: 17 }, (_, at) => ({
    pressed: presses.includes(at),
    value: presses.includes(at) ? 1 : 0,
  })),
  axes,
});

describe("paintPro", () => {
  it("allume A à gauche depuis la trame, et b0 à droite depuis la manette", () => {
    const { gauche, droite, allumees } = monter();
    paintPro(gauche, droite, { ...emptySwitch(), buttons: 1 }, brut([0]), standardSwitchDevice());
    expect(allumees(gauche)).toEqual(["A"]);
    expect(allumees(droite)).toEqual(["b0"]);
  });

  it("garde les deux lectures séparées : une trame neutre n'allume rien à gauche", () => {
    // Le jumeau : la manette appuie, mais la trame envoyée est neutre (pendant
    // un réglage). La gauche ne doit pas lire la manette.
    const { gauche, droite, allumees } = monter();
    paintPro(gauche, droite, emptySwitch(), brut([0]), standardSwitchDevice());
    expect(allumees(gauche)).toEqual([]);
    expect(allumees(droite)).toEqual(["b0"]);
  });

  it("incline chaque stick dans son repère, sans mêler les deux racines", () => {
    const { gauche, droite } = monter();
    paintPro(gauche, droite, { ...emptySwitch(), ly: 1 }, brut([], [0.5, 0, 0, 0]), null);
    const corps = (racine: Element) =>
      racine.querySelector('[data-stick="a0"] .n3-stick-body')!.getAttribute("transform");
    // Trame : ly vers le haut, donc le capot monte. Manette : x vers la droite.
    expect(corps(gauche)).toMatch(/^translate\(0\.00 -/);
    expect(corps(droite)).toMatch(/^translate\([1-9]/);
    expect(corps(droite)).toMatch(/ 0\.00\)$/);
  });
});

describe("une peinture qui ne change rien n'écrit rien", () => {
  it("repeindre le même appui ne touche aucun attribut, un nouvel appui si", async () => {
    const { gauche, droite } = monter();
    const peindre = (presses: number[]) =>
      paintPro(
        gauche,
        droite,
        { ...emptySwitch(), buttons: presses.length ? 1 : 0 },
        brut(presses),
        standardSwitchDevice(),
      );
    peindre([0]);
    const ecrits: string[] = [];
    const veille = new MutationObserver((records) =>
      ecrits.push(...records.map((r) => r.attributeName ?? "")),
    );
    veille.observe(gauche.parentElement!, { attributes: true, subtree: true });
    peindre([0]);
    peindre([0]);
    await Promise.resolve();
    expect(ecrits.filter((nom) => nom === "data-lit")).toEqual([]);
    // Jumeau : relâcher change A et b0, et seulement eux.
    peindre([]);
    await Promise.resolve();
    expect(ecrits.filter((nom) => nom === "data-lit")).toHaveLength(2);
    veille.disconnect();
  });
});
