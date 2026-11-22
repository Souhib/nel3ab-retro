import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Asked } from "./Swap";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("n'est plus une alerte assertive qui relit un nombre chaque seconde (A11Y-09)", () => {
  render(<Asked from="Lina" port={2} lasts={10} onAnswer={vi.fn()} onExpire={vi.fn()} />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.querySelector("[aria-live='assertive']")).toBeNull();
  // Le décompte reste VISIBLE, mais hors de ce que lit un lecteur d'écran: la
  // ligne parlée de la salle dit le délai une fois, en mots.
  const decompte = screen.getByText("10 s");
  expect(decompte).toHaveAttribute("aria-hidden", "true");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("9 s")).toHaveAttribute("aria-hidden", "true");
});

it("jumeau: la question et ses deux réponses restent lisibles et atteignables", () => {
  const answer = vi.fn();
  render(<Asked from="Lina" port={2} lasts={10} onAnswer={answer} onExpire={vi.fn()} />);
  expect(screen.getByText(/demande ta manette 2/)).toBeVisible();
  screen.getByRole("button", { name: "garder" }).click();
  expect(answer).toHaveBeenCalledWith(false);
});
