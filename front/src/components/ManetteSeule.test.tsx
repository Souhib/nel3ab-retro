import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

/**
 * Le chiffre de latence ne se relit pas (relecture finale du 25 novembre
 * 2026). La phrase « Tes touches mettent N ms à arriver. » était une région
 * `aria-live` : sur un lien lent, un lecteur d'écran la relisait à chaque
 * changement de médiane, jusqu'à une fois par seconde, en troisième région
 * de la page. Elle se lit sans être annoncée ; seul le changement de
 * catégorie est dit, une fois, par la ligne parlée.
 */
describe("ce que la manette seule dit à voix haute", () => {
  it("la phrase de latence n'est pas une région vivante", () => {
    const { container } = render(
      <ManetteSeule rect={RECT} jeu={null} place={1} allerRetourMs={85} entenduIlYaMs={500} />,
    );
    const phrase = screen.getByText("Tes touches mettent 85 ms à arriver.");
    expect(phrase.closest("[aria-live], [role=status], [role=alert], [role=log]")).toBeNull();
    expect(container.querySelectorAll("[aria-live], [role=status], [role=alert]")).toHaveLength(0);
  });

  it("dit le changement de catégorie une fois, tenu 3 s, jamais le chiffre", () => {
    vi.useFakeTimers();
    try {
      const annoncer = vi.fn();
      const vue = (allerRetourMs: number | null) => (
        <ManetteSeule
          rect={RECT}
          jeu={null}
          place={1}
          allerRetourMs={allerRetourMs}
          entenduIlYaMs={allerRetourMs === null ? null : 500}
          annoncer={annoncer}
        />
      );
      const { rerender } = render(vue(null));
      // La première catégorie se lit sur la page : rien n'est annoncé.
      act(() => vi.advanceTimersByTime(5000));
      expect(annoncer).not.toHaveBeenCalled();
      // Les touches arrivent, puis la médiane bouge sans changer de catégorie.
      rerender(vue(20));
      act(() => vi.advanceTimersByTime(3000));
      expect(annoncer).toHaveBeenCalledTimes(1);
      expect(annoncer).toHaveBeenLastCalledWith("Tes touches arrivent.", "ordinaire");
      for (const ms of [70, 72, 78, 74, 90]) {
        rerender(vue(ms));
        act(() => vi.advanceTimersByTime(1000));
      }
      act(() => vi.advanceTimersByTime(3000));
      expect(annoncer).toHaveBeenCalledTimes(2);
      expect(annoncer).toHaveBeenLastCalledWith("Tes touches arrivent lentement.", "ordinaire");
      for (const [phrase] of annoncer.mock.calls) expect(phrase).not.toMatch(/\d/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("jumeau : une catégorie qui ne tient pas 3 s n'est pas dite", () => {
    vi.useFakeTimers();
    try {
      const annoncer = vi.fn();
      const vue = (allerRetourMs: number) => (
        <ManetteSeule
          rect={RECT}
          jeu={null}
          place={1}
          allerRetourMs={allerRetourMs}
          entenduIlYaMs={500}
          annoncer={annoncer}
        />
      );
      const { rerender } = render(vue(20));
      for (let i = 0; i < 6; i += 1) {
        rerender(vue(i % 2 === 0 ? 70 : 20));
        act(() => vi.advanceTimersByTime(1000));
      }
      expect(annoncer).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
