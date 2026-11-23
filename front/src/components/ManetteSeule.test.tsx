import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ManetteSeule } from "./ManetteSeule";

const RECT = { x: 0, y: 52, w: 390, h: 400 };

describe("la page manette seule", () => {
  it("dit la place que ce téléphone tient, et que les touches arrivent", () => {
    render(
      <ManetteSeule
        rect={RECT}
        jeu="Mario Kart"
        place={2}
        allerRetourMs={18}
        entenduIlYaMs={500}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Manette seule, Mario Kart");
    expect(screen.getByText("Ce téléphone est ta manette, place 2.")).toBeTruthy();
    expect(screen.getByText("Tes touches arrivent.")).toBeTruthy();
  });

  it("le jumeau : sans place, et sans écho frais, rien n'est affirmé", () => {
    render(
      <ManetteSeule rect={RECT} jeu={null} place={null} allerRetourMs={18} entenduIlYaMs={6000} />,
    );
    expect(screen.getByText("Ce téléphone ne tient pas de place.")).toBeTruthy();
    expect(screen.queryByText("Tes touches arrivent.")).toBeNull();
    // Pas de capitales espacées : le titre est une phrase.
    expect(screen.getByRole("heading").textContent).toBe("Manette seule");
  });
});
