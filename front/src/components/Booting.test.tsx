import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Booting } from "./Booting";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("laisse attendre en paix, puis ouvre une sortie quand l'attente devient longue", () => {
  render(<Booting game="Mario Kart" step="waiting" onMenu={vi.fn()} onGiveUp={vi.fn()} />);
  // Le jumeau négatif, et il compte autant que le reste: une dizaine de
  // secondes de noir est NORMALE, et proposer d'annuler tout de suite ferait
  // croire à une panne à chaque lancement.
  expect(screen.queryByRole("button", { name: "ouvrir le menu" })).toBeNull();
  act(() => vi.advanceTimersByTime(8_000));
  expect(screen.getByRole("button", { name: "ouvrir le menu" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "annuler et revenir au menu" })).toBeNull();
  act(() => vi.advanceTimersByTime(12_000));
  expect(screen.getByRole("button", { name: "annuler et revenir au menu" })).toBeVisible();
});

it("l'écran qui a cessé d'attendre le dit, au lieu de s'effacer sur du noir", () => {
  const abandon = vi.fn();
  render(<Booting game="Mario Kart" step="asked" stalled onMenu={vi.fn()} onGiveUp={abandon} />);
  expect(screen.getByText(/n’a pas démarré/)).toBeVisible();
  expect(screen.getByRole("button", { name: "annuler et revenir au menu" })).toBeVisible();
});

it("sans sortie fournie, l'écran reste ce qu'il était", () => {
  render(<Booting game="Mario Kart" step="painting" />);
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.queryByRole("button")).toBeNull();
});
