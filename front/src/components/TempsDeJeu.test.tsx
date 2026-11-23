import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { horloge, TempsDeJeu } from "./TempsDeJeu";

describe("le temps de jeu", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("écrit 00:12:34 sur l'afficheur caché, et « 12 min de jeu » en clair", () => {
    let t = 1000 + 754;
    const { container } = render(<TempsDeJeu depuisS={1000} maintenant={() => t} />);
    const valeur = container.querySelector(".rt-afficheur-valeur")!;
    expect(valeur.textContent).toBe("00:12:34");
    expect(valeur.closest("[aria-hidden='true']")).not.toBeNull();
    expect(container.querySelector(".sr-only")!.textContent).toBe("12 min de jeu");
    t += 1;
    act(() => void vi.advanceTimersByTime(1000));
    expect(valeur.textContent).toBe("00:12:35");
  });

  it("sans instant de lancement, ne rend rien", () => {
    const { container } = render(<TempsDeJeu depuisS={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("compte les heures, et jamais un temps négatif", () => {
    expect(horloge(3 * 3600 + 5)).toBe("03:00:05");
    expect(horloge(-4)).toBe("00:00:00");
  });
});
