/** La phrase de fin du pas à pas s'écrit lettre par lettre au niveau tout
 * (effet « lettres », `retro/lettres.ts`). Le lecteur d'écran reçoit la
 * phrase entière d'un coup par une région, vidée une fois la phrase écrite,
 * pour qu'elle ne soit pas lue deux fois. Aux autres niveaux, la phrase est
 * là tout de suite, une seule fois. */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changerNiveau, oublierPourEssai } from "../../lib/effets";
import { PAS_MS } from "../../retro/lettres";
import { Fin } from "./PasAPas";

const PHRASE = "Réglage gardé : 14 commandes, 2 passées.";
const rien = () => {};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  oublierPourEssai();
  localStorage.clear();
});

describe("la phrase de fin du pas à pas", () => {
  it("au niveau tout, s'écrit lettre par lettre et se dit entière d'un coup", async () => {
    changerNiveau("tout");
    const { container } = render(<Fin texte={PHRASE} passee={null} onRegler={rien} />);
    const visible = container.querySelector<HTMLElement>("[data-fin-lecon] p")!;
    const region = container.querySelector<HTMLElement>("[data-fin-region]")!;
    // La précondition : les deux éléments existent.
    expect(visible).not.toBeNull();
    expect(region).not.toBeNull();
    expect(region.textContent).toBe(PHRASE);
    expect(visible.getAttribute("aria-hidden")).toBe("true");
    expect(visible.textContent!.length).toBeLessThan(PHRASE.length);

    act(() => vi.advanceTimersByTime(PAS_MS * 5));
    expect(visible.textContent).toBe(PHRASE.slice(0, 5));

    // La région se vide quand la promesse de fin est tenue : laisser passer
    // ses microtâches avec les minuteries.
    await act(async () => {
      vi.advanceTimersByTime(PAS_MS * PHRASE.length);
    });
    expect(visible.textContent).toBe(PHRASE);
    expect(visible.hasAttribute("aria-hidden")).toBe(false);
    expect(container.querySelector(".rt-lettres")!.hasAttribute("data-fini")).toBe(true);
    // Écrite, la phrase n'est plus qu'une fois dans la page.
    expect(region.textContent).toBe("");
    expect(screen.getAllByText(PHRASE)).toHaveLength(1);
  });

  it("un clic l'affiche toute", () => {
    changerNiveau("tout");
    const { container } = render(<Fin texte={PHRASE} passee={null} onRegler={rien} />);
    const visible = container.querySelector<HTMLElement>("[data-fin-lecon] p")!;
    // La précondition : la phrase n'est pas encore écrite.
    expect(visible.textContent!.length).toBeLessThan(PHRASE.length);
    act(() => {
      visible.click();
    });
    expect(visible.textContent).toBe(PHRASE);
  });

  it("au niveau conseillé, est là tout de suite, une seule fois", () => {
    // Le jumeau : sans l'effet, ni écriture ni région.
    changerNiveau("conseille");
    const { container } = render(<Fin texte={PHRASE} passee={null} onRegler={rien} />);
    expect(screen.getAllByText(PHRASE)).toHaveLength(1);
    expect(container.querySelector("[data-fin-lecon] p")!.hasAttribute("aria-hidden")).toBe(false);
    expect(container.querySelector("[data-fin-region]")?.textContent ?? "").toBe("");
  });

  it("change de phrase sans garder la précédente", () => {
    changerNiveau("tout");
    const { container, rerender } = render(<Fin texte="Avant." passee={null} onRegler={rien} />);
    act(() => vi.advanceTimersByTime(PAS_MS * 20));
    rerender(<Fin texte={PHRASE} passee={null} onRegler={rien} />);
    act(() => vi.advanceTimersByTime(PAS_MS * (PHRASE.length + 2)));
    expect(container.querySelector("[data-fin-lecon] p")!.textContent).toBe(PHRASE);
  });
});
