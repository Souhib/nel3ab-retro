import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Credit } from "./Credit";

describe("le crédit de la borne", () => {
  it("dit le nombre de places libres, caché au lecteur d'écran", () => {
    for (const libres of [0, 1, 2, 4]) {
      const { container, unmount } = render(<Credit libres={libres} fermee={false} />);
      const credit = container.querySelector("#credit")!;
      expect(credit.textContent).toBe(`places libres ${libres}`);
      expect(credit.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("n'existe pas dans une salle fermée", () => {
    const { container } = render(<Credit libres={3} fermee />);
    expect(container.querySelector("#credit")).toBeNull();
  });
});
