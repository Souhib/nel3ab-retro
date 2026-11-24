import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EntreePlaces } from "../lib/places";
import { PlacesAuPasse } from "./PlacesAuPasse";

const entree = (e: Partial<EntreePlaces> = {}): EntreePlaces => ({
  places: 4,
  tenues: [false, true, true, false],
  noms: new Map([
    [2, "Bilel"],
    [3, "Moi"],
  ]),
  micros: [false, true, false, false],
  chef: 2,
  mienne: 3,
  ...e,
});

const port = (n: number) => document.querySelector<HTMLButtonElement>(`#port${n}`)!;

describe("les places d'une salle fermée, au passé (plan des états)", () => {
  it("quatre START éteints, les étiquettes de qui jouait, sans toi ni couronne ni micro, lus « Ils ont joué »", () => {
    render(<PlacesAuPasse forme="rangee" entree={entree()} />);
    const groupe = document.querySelector("#ports")!;
    expect(groupe.getAttribute("role")).toBe("group");
    expect(groupe.getAttribute("aria-label")).toBe("Ils ont joué");
    for (const n of [1, 2, 3, 4]) {
      expect(port(n).querySelector(".rt-bouton-start")!.hasAttribute("data-libre")).toBe(true);
      expect(port(n).style.getPropertyValue("--rt-joueur")).toBe("");
      expect(port(n).textContent).toContain(`${n}P`);
    }
    expect(port(2).textContent).toContain("Bilel");
    expect(port(3).textContent).toContain("Moi");
    expect(port(3).textContent).not.toContain("toi");
    expect(document.querySelectorAll(".n3-couronne, .n3-place-signes")).toHaveLength(0);
    expect(port(2).getAttribute("aria-label")).toBe("Place 2 : Bilel");
    expect(port(3).getAttribute("aria-label")).toBe("Place 3 : Moi");
    expect(port(1).getAttribute("aria-label")).toBe("Place 1, libre");
    expect(document.querySelector(".n3-places-role")).toBeNull();
  });

  it("aucun geste : les quatre places et le bouton des quatre lampes sont inertes", () => {
    render(<PlacesAuPasse forme="petite" entree={entree()} />);
    for (const n of [1, 2, 3, 4]) expect(port(n).disabled).toBe(true);
    const toutes = document.querySelector<HTMLButtonElement>("#placesToutes")!;
    expect(toutes.disabled).toBe(true);
    // Le bouton des lampes ne dit pas « toi » au passé : le nom de qui jouait.
    expect(toutes.getAttribute("aria-label")).toBe(
      "Ils ont joué : 1P libre, 2P Bilel, 3P Moi, 4P libre",
    );
    fireEvent.click(port(2));
    expect(port(2).disabled).toBe(true);
  });

  it("jumeau : hors de la forme petite, pas de bouton des quatre lampes", () => {
    render(<PlacesAuPasse forme="rangee" entree={entree()} />);
    expect(document.querySelector("#placesToutes")).toBeNull();
  });

  it("garde les ancres d'Aïn sur chaque place", () => {
    render(<PlacesAuPasse forme="rangee" entree={entree()} />);
    expect([1, 2, 3, 4].map((n) => port(n).dataset.ancre)).toEqual([
      "start-1",
      "start-2",
      "start-3",
      "start-4",
    ]);
  });
});
