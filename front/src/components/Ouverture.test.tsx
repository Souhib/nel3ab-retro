import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OUVERTURE_LIMITE_MS, Ouverture } from "./Ouverture";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("dit tout de suite ce qui se passe, au lieu d'une page blanche (E8)", () => {
  render(<Ouverture salle={1} onReessayer={vi.fn()} onEntrer={vi.fn()} />);
  expect(screen.getByText("On ouvre la salle 1.")).toBeVisible();
  // Le jumeau: une attente normale ne propose rien.
  act(() => vi.advanceTimersByTime(OUVERTURE_LIMITE_MS - 500));
  expect(screen.queryByRole("button")).toBeNull();
});

it("a une fin: passé la limite, il le dit et propose deux gestes qui marchent", () => {
  const onReessayer = vi.fn();
  const onEntrer = vi.fn();
  render(<Ouverture salle={1} onReessayer={onReessayer} onEntrer={onEntrer} />);
  act(() => vi.advanceTimersByTime(OUVERTURE_LIMITE_MS + 100));
  expect(screen.getByText("Le site ne répond pas.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
  fireEvent.click(screen.getByRole("button", { name: "Entrer quand même" }));
  expect(onReessayer).toHaveBeenCalledTimes(1);
  expect(onEntrer).toHaveBeenCalledTimes(1);
});
