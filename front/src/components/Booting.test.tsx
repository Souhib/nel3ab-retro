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
  expect(screen.queryByRole("button", { name: "arrêter d'attendre" })).toBeNull();
  act(() => vi.advanceTimersByTime(12_000));
  expect(screen.getByRole("button", { name: "arrêter d'attendre" })).toBeVisible();
});

it("l'écran qui a cessé d'attendre le dit, au lieu de s'effacer sur du noir", () => {
  const abandon = vi.fn();
  render(<Booting game="Mario Kart" step="asked" stalled onMenu={vi.fn()} onGiveUp={abandon} />);
  expect(screen.getByText(/n’a pas démarré/)).toBeVisible();
  expect(screen.getByRole("button", { name: "arrêter d'attendre" })).toBeVisible();
});

it("sans sortie fournie, l'écran reste ce qu'il était", () => {
  render(<Booting game="Mario Kart" step="painting" />);
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.queryByRole("button")).toBeNull();
});

it("se range sous le menu: « ouvrir le menu » ouvre un menu qu'on voit (P2, E5)", () => {
  // Le 22 novembre 2026, cet écran était en z 60 et les trois menus en z 50:
  // le menu demandé se montait DESSOUS, invisible, et captait pourtant le
  // clavier et la manette. Le menu est maintenant au-dessus de tout état.
  render(<Booting game="Mario Kart" step="waiting" onMenu={vi.fn()} />);
  const ecran = document.querySelector("#booting") as HTMLElement;
  const couche = Number(getComputedStyle(ecran).zIndex);
  expect(Number.isFinite(couche)).toBe(true);
  expect(couche).toBeLessThan(50);
  expect(couche).toBeGreaterThanOrEqual(30);
});
