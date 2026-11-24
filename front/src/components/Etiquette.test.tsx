import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Etiquette } from "./Etiquette";

describe("l'étiquette tapée", () => {
  it("écrit le nom, ses initiales, et la couleur de sa place", () => {
    const { container } = render(<Etiquette nom="Lina" place={3} />);
    const etiquette = container.querySelector<HTMLElement>(".n3-etiquette")!;
    expect(etiquette.querySelector(".rt-nom-plein")?.textContent).toBe("Lina");
    expect(etiquette.querySelector(".rt-initiales")?.textContent).toBe("LIN");
    expect(etiquette.style.getPropertyValue("--etiquette-encre")).toBe("var(--p3-encre)");
    expect(etiquette.dataset.place).toBe("3");
  });

  it("garde le nom entier pour le lecteur d'écran, effet allumé ou non", () => {
    // Les deux textes visibles sont cachés au lecteur d'écran : la feuille en
    // montre un selon l'effet, et le nom entier reste dans le texte caché.
    const { container } = render(<Etiquette nom="Jean-Pierre" place={1} />);
    expect(container.querySelector(".sr-only")?.textContent).toBe("Jean-Pierre");
    for (const visible of container.querySelectorAll(".rt-nom-plein, .rt-initiales")) {
      expect(visible.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("prend les initiales de la salle quand elles sont données", () => {
    const { container } = render(<Etiquette nom="Lina" place={1} lettres="LI1" />);
    expect(container.querySelector(".rt-initiales")?.textContent).toBe("LI1");
  });

  it("n'a pas de couleur de joueur sans place", () => {
    const { container } = render(<Etiquette nom="Sami" />);
    const etiquette = container.querySelector<HTMLElement>(".n3-etiquette")!;
    expect(etiquette.getAttribute("style")).toBeNull();
    expect(etiquette.dataset.place).toBeUndefined();
  });
});
