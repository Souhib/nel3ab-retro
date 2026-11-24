import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ATTENTION, surAttention } from "./attention";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const visible = { cachee: () => false, reduit: () => false };

it("joue « attente » à 2,5 s, puis toutes les 6 s, trois fois, puis « dort », puis plus rien", () => {
  const jouer = vi.fn();
  surAttention(jouer, visible);
  vi.advanceTimersByTime(ATTENTION.premier - 1);
  expect(jouer).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(jouer.mock.calls).toEqual([["attente"]]);
  vi.advanceTimersByTime(ATTENTION.pas);
  vi.advanceTimersByTime(ATTENTION.pas);
  expect(jouer.mock.calls).toEqual([["attente"], ["attente"], ["attente"]]);
  vi.advanceTimersByTime(ATTENTION.pas);
  expect(jouer.mock.calls.at(-1)).toEqual(["dort"]);
  vi.advanceTimersByTime(60_000);
  expect(jouer).toHaveBeenCalledTimes(4);
});

it("un tour sauté, onglet caché, compte quand même", () => {
  const jouer = vi.fn();
  let cachee = true;
  surAttention(jouer, { cachee: () => cachee, reduit: () => false });
  vi.advanceTimersByTime(ATTENTION.premier);
  expect(jouer).not.toHaveBeenCalled();
  cachee = false;
  vi.advanceTimersByTime(ATTENTION.pas * 3);
  // Deux « attente » visibles, puis « dort » : le premier tour n'est pas rattrapé.
  expect(jouer.mock.calls).toEqual([["attente"], ["attente"], ["dort"]]);
});

it("un geste l'arrête pour de bon : un clic, une touche", () => {
  for (const geste of ["pointerdown", "keydown"]) {
    const jouer = vi.fn();
    surAttention(jouer, visible);
    vi.advanceTimersByTime(ATTENTION.premier);
    expect(jouer).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event(geste));
    vi.advanceTimersByTime(60_000);
    expect(jouer, geste).toHaveBeenCalledTimes(1);
  }
});

it("le jumeau : passer la souris n'est pas un geste", () => {
  const jouer = vi.fn();
  surAttention(jouer, visible);
  document.dispatchEvent(new Event("pointermove"));
  vi.advanceTimersByTime(ATTENTION.premier + ATTENTION.pas);
  expect(jouer).toHaveBeenCalledTimes(2);
});

it("en mouvement réduit, elle n'est jamais armée", () => {
  const jouer = vi.fn();
  surAttention(jouer, { cachee: () => false, reduit: () => true });
  vi.advanceTimersByTime(60_000);
  expect(jouer).not.toHaveBeenCalled();
});

it("la fonction rendue l'arrête avant le premier tour", () => {
  const jouer = vi.fn();
  const arreter = surAttention(jouer, visible);
  arreter();
  arreter();
  vi.advanceTimersByTime(60_000);
  expect(jouer).not.toHaveBeenCalled();
});
