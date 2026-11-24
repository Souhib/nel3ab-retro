/** La nouvelle des places écrite lettre par lettre sur l'ancre du socle
 * (effet « lettres »), sans seconde région parlée. */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CLE, oublierPourEssai } from "../lib/effets";
import { PAS_MS } from "../retro/lettres";
import { ANNONCE_RESTE_MS, AnnonceEnLettres } from "./AnnonceEnLettres";

let ancre: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem(CLE, JSON.stringify({ niveau: "tout", sons: false }));
  oublierPourEssai();
  ancre = document.createElement("span");
  ancre.setAttribute("data-ancre", "annonce");
  document.body.append(ancre);
});
afterEach(() => {
  ancre.remove();
  localStorage.removeItem(CLE);
  oublierPourEssai();
  vi.useRealTimers();
});

const dite = (texte: string, cle: number, nature: "ordinaire" | "urgente" = "ordinaire") => ({
  texte,
  cle,
  nature,
});

it("écrit la phrase lettre par lettre sur l'ancre, cachée au lecteur le temps de l'écrire", () => {
  render(<AnnonceEnLettres nouvelle={dite("Bo prend la place 2.", 1)} />);
  act(() => void vi.advanceTimersByTime(PAS_MS * 4));
  expect(ancre.textContent).toBe("Bo p");
  expect(ancre.getAttribute("aria-hidden")).toBe("true");
  act(() => void vi.advanceTimersByTime(PAS_MS * 40));
  expect(ancre.textContent).toBe("Bo prend la place 2.");
  expect(ancre.hasAttribute("aria-hidden")).toBe(false);
});

it("efface la phrase quelques secondes après l'avoir finie, pas avant", async () => {
  render(<AnnonceEnLettres nouvelle={dite("Lien copié.", 1)} />);
  // La fin de l'écriture est une promesse : on laisse passer ses suites.
  await act(async () => void vi.advanceTimersByTime(PAS_MS * 20));
  expect(ancre.textContent).toBe("Lien copié.");
  await act(async () => void vi.advanceTimersByTime(ANNONCE_RESTE_MS - 100));
  expect(ancre.textContent).toBe("Lien copié.");
  await act(async () => void vi.advanceTimersByTime(200));
  expect(ancre.textContent).toBe("");
});

it("une nouvelle phrase remplace la précédente, sans la mêler", () => {
  const rendu = render(<AnnonceEnLettres nouvelle={dite("Bo prend la place 2.", 1)} />);
  act(() => void vi.advanceTimersByTime(PAS_MS * 3));
  rendu.rerender(<AnnonceEnLettres nouvelle={dite("Lien copié.", 2)} />);
  act(() => void vi.advanceTimersByTime(PAS_MS * 40));
  expect(ancre.textContent).toBe("Lien copié.");
});

it("jumeau : une erreur s'affiche d'un coup, jamais lettre par lettre", () => {
  render(<AnnonceEnLettres nouvelle={dite("Le signalement n'est pas parti.", 1, "urgente")} />);
  expect(ancre.textContent).toBe("Le signalement n'est pas parti.");
});

it("jumeau : l'ancre n'est jamais une région parlée", () => {
  render(<AnnonceEnLettres nouvelle={dite("Bo prend la place 2.", 1)} />);
  act(() => void vi.advanceTimersByTime(PAS_MS * 40));
  expect(ancre.getAttribute("role")).toBeNull();
  expect(ancre.getAttribute("aria-live")).toBeNull();
  expect(document.querySelectorAll("[role=status], [aria-live]")).toHaveLength(0);
});

it("jumeau : sans ancre (pas de fronton, colonne repliée), rien ne casse", () => {
  ancre.remove();
  expect(() =>
    render(<AnnonceEnLettres nouvelle={dite("Bo prend la place 2.", 1)} />),
  ).not.toThrow();
});
