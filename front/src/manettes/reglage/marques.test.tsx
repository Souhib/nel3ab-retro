/** Les marques du pas à pas, sur le vrai balisage des dessins et une
 * horloge simulée. */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PadMapView } from "../../components/PadMap";
import { GAMECUBE, XBOX } from "../../lib/padmap";
import { Annonces } from "../../media/lesson";
import { MARQUES, pieceDe, poserMarques, type Moment } from "./marques";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function monter() {
  const { container } = render(
    <div>
      <PadMapView map={GAMECUBE} title="gauche" />
      <PadMapView map={XBOX} title="droite" />
    </div>,
  );
  const annonces = new Annonces<Moment>();
  const arreter = poserMarques(container, (ecoute) => annonces.ecouter(ecoute));
  const marque = (part: string) =>
    container.querySelector(`[data-part="${part}"]`)?.getAttribute("data-marque") ?? null;
  const marquees = () => container.querySelectorAll("[data-marque]").length;
  return { emettre: (m: Moment) => annonces.emettre(m), marque, marquees, arreter, container };
}

describe("la commande attendue", () => {
  it("se cadre aussitôt, insiste à 4 s, reçoit la flèche à 8 s, puis plus rien", () => {
    const { emettre, marque } = monter();
    emettre({ type: "etape", control: "A" });
    expect(marque("A")).toBe("cadre");
    vi.advanceTimersByTime(MARQUES.insiste - 1);
    expect(marque("A")).toBe("cadre");
    vi.advanceTimersByTime(1);
    expect(marque("A")).toBe("insiste");
    vi.advanceTimersByTime(MARQUES.fleche - MARQUES.insiste);
    expect(marque("A")).toBe("fleche");
    // Plus rien ne change : aucune minuterie n'attend, rien ne clignote.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(marque("A")).toBe("fleche");
  });

  it("cède à l'étape suivante, qui pose sa marque sans attendre (D5)", () => {
    const { emettre, marque } = monter();
    emettre({ type: "etape", control: "A" });
    vi.advanceTimersByTime(MARQUES.insiste);
    emettre({ type: "etape", control: "B" });
    expect(marque("A")).toBeNull();
    expect(marque("B")).toBe("cadre");
    // Les minuteries de A sont coupées : sa flèche ne vient jamais.
    vi.advanceTimersByTime(MARQUES.fleche);
    expect(marque("A")).toBeNull();
  });

  it("nomme le stick par sa pièce, pour Dolphin comme pour la trame Pro", () => {
    expect(pieceDe("y")).toBe("x");
    expect(pieceDe("cy")).toBe("cx");
    expect(pieceDe("lx+")).toBe("LS");
    expect(pieceDe("ry+")).toBe("RS");
    expect(pieceDe("A")).toBe("A");
  });
});

describe("la pièce appuyée", () => {
  it("prend ses coins 650 ms, s'efface, puis ne garde rien", () => {
    const { emettre, marque, marquees } = monter();
    emettre({ type: "etape", control: "A" });
    emettre({ type: "recu", indice: "b0" });
    expect(marque("b0")).toBe("coins");
    vi.advanceTimersByTime(MARQUES.coins);
    expect(marque("b0")).toBe("efface");
    vi.advanceTimersByTime(MARQUES.efface);
    expect(marque("b0")).toBeNull();
    // La commande attendue n'insiste plus après la réponse.
    vi.advanceTimersByTime(MARQUES.fleche);
    expect(marque("A")).toBe("cadre");
    expect(marquees()).toBe(1);
  });

  it("la fin et un débranchement retirent tout, et l'arrêt désabonne", () => {
    const { emettre, marquees, arreter } = monter();
    emettre({ type: "etape", control: "A" });
    emettre({ type: "recu", indice: "b0" });
    emettre({ type: "fin" });
    expect(marquees()).toBe(0);
    emettre({ type: "etape", control: "B" });
    emettre({ type: "suspendu" });
    expect(marquees()).toBe(0);
    emettre({ type: "etape", control: "B" });
    arreter();
    expect(marquees()).toBe(0);
    emettre({ type: "etape", control: "A" });
    expect(marquees()).toBe(0);
  });
});

describe("la ligne de liaison", () => {
  /** Une boîte fixe par pièce : jsdom ne mesure rien. */
  const boites = (container: Element, places: Record<string, [number, number]>) => {
    container.getBoundingClientRect = () => new DOMRect(100, 50, 400, 200);
    for (const [part, [x, y]] of Object.entries(places)) {
      const piece = container.querySelector(`[data-part="${part}"]`)!;
      piece.getBoundingClientRect = () => new DOMRect(x - 5, y - 5, 10, 10);
    }
  };
  const ligne = (container: Element) => container.querySelector(".n3-liaison line");

  it("relie la pièce appuyée à la commande attendue, puis s'efface avec les coins", () => {
    const m = monter();
    const { container } = m;
    boites(container, { A: [150, 100], b0: [400, 120] });
    m.emettre({ type: "etape", control: "A" });
    expect(ligne(container)).toBeNull();
    m.emettre({ type: "recu", indice: "b0" });
    const trait = ligne(container)!;
    // Du centre de la pièce appuyée au centre de l'attendue, dans la racine.
    expect([...["x1", "y1", "x2", "y2"].map((a) => trait.getAttribute(a))]).toEqual([
      "300",
      "70",
      "50",
      "50",
    ]);
    vi.advanceTimersByTime(MARQUES.coins);
    expect(container.querySelector(".n3-liaison")).toHaveAttribute("data-marque", "efface");
    vi.advanceTimersByTime(MARQUES.efface);
    expect(container.querySelector(".n3-liaison")).toBeNull();
  });

  it("ne se tire pas sans commande attendue, et l'étape suivante l'efface aussitôt", () => {
    const m = monter();
    const { container } = m;
    boites(container, { A: [150, 100], B: [160, 90], b0: [400, 120] });
    m.emettre({ type: "recu", indice: "b0" });
    expect(ligne(container)).toBeNull();
    // La pièce appuyée a quand même ses coins.
    expect(m.marque("b0")).toBe("coins");
    m.emettre({ type: "etape", control: "A" });
    m.emettre({ type: "recu", indice: "b0" });
    expect(ligne(container)).not.toBeNull();
    m.emettre({ type: "etape", control: "B" });
    expect(container.querySelector(".n3-liaison")).toBeNull();
    m.emettre({ type: "recu", indice: "b0" });
    m.emettre({ type: "fin" });
    expect(container.querySelector(".n3-liaison")).toBeNull();
    // Après la fin, plus aucune commande n'est attendue : un appui ne relie rien.
    m.emettre({ type: "recu", indice: "b0" });
    expect(container.querySelector(".n3-liaison")).toBeNull();
  });
});
