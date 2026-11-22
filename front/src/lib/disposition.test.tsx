import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUETE_TIROIR, TIROIR_SOUS, useEnTiroir } from "./disposition";

describe("la colonne en tiroir", () => {
  it("demande au navigateur: sous 900 px de large, OU au doigt", () => {
    // La requête elle-même, et pas une copie de la règle: une fonction pure
    // `enTiroir` était essayée ici sans que la page l'appelle, et des
    // sous-chaînes laissaient passer « et » à la place de « ou » (vérification
    // finale du 22 novembre 2026). Le vrai comportement est prouvé par
    // `salle-telephone.mjs`, dans un vrai navigateur.
    expect(REQUETE_TIROIR).toBe("(max-width: 899.98px), (pointer: coarse)");
    expect(TIROIR_SOUS).toBe(900);
  });
});

describe("useEnTiroir", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  function brancher(depart: boolean) {
    let ecoute: ((event: { matches: boolean }) => void) | null = null;
    const requete = {
      matches: depart,
      addEventListener: vi.fn((_: string, fn: (event: { matches: boolean }) => void) => {
        ecoute = fn;
      }),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn(() => requete) as unknown as typeof window.matchMedia;
    return { requete, changer: (matches: boolean) => act(() => ecoute?.({ matches })) };
  }

  function Sonde() {
    return <p data-testid="t">{String(useEnTiroir())}</p>;
  }

  it("suit la requête quand la fenêtre change", () => {
    const { requete, changer } = brancher(false);
    render(<Sonde />);
    expect(window.matchMedia).toHaveBeenCalledWith(REQUETE_TIROIR);
    expect(screen.getByTestId("t").textContent).toBe("false");
    changer(true);
    expect(screen.getByTestId("t").textContent).toBe("true");
    changer(false);
    expect(screen.getByTestId("t").textContent).toBe("false");
    expect(requete.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("vaut faux sans `matchMedia`, sans planter", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    render(<Sonde />);
    expect(screen.getByTestId("t").textContent).toBe("false");
  });
});
