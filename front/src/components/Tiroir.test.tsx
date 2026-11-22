import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BarreDuTiroir } from "./Tiroir";

describe("le haut du tiroir", () => {
  it("nomme le bouton qui rend le jeu en mots, et pas « ✕ »", () => {
    render(<BarreDuTiroir onFermer={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Revenir au jeu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✕" })).not.toBeInTheDocument();
  });

  it("referme le tiroir, et seulement quand on le touche", () => {
    const fermer = vi.fn();
    render(<BarreDuTiroir onFermer={fermer} />);
    expect(fermer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revenir au jeu" }));
    expect(fermer).toHaveBeenCalledTimes(1);
  });
});
