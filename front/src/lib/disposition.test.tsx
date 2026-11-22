import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUETE_TIROIR, TIROIR_SOUS, enTiroir, useEnTiroir } from "./disposition";

describe("la colonne en tiroir", () => {
  it("passe en tiroir sous 900 px de large, même à la souris", () => {
    expect(enTiroir(TIROIR_SOUS - 1, false)).toBe(true);
    expect(enTiroir(390, false)).toBe(true);
  });

  it("reste à côté de l'image à 900 px et plus, à la souris", () => {
    // Le jumeau: une règle qui mettrait tout en tiroir passerait l'essai
    // d'au-dessus.
    expect(enTiroir(TIROIR_SOUS, false)).toBe(false);
    expect(enTiroir(1440, false)).toBe(false);
  });

  it("passe en tiroir au doigt, quelle que soit la largeur", () => {
    expect(enTiroir(1024, true)).toBe(true);
    expect(enTiroir(2560, true)).toBe(true);
  });

  it("dit la même chose au navigateur que la fonction", () => {
    // La requête est ce que le hook écoute: si elle disait 800 ou oubliait le
    // pointeur grossier, la fonction testée au-dessus ne serait pas la règle
    // appliquée.
    expect(REQUETE_TIROIR).toContain(`(max-width: ${TIROIR_SOUS - 0.02}px)`);
    expect(REQUETE_TIROIR).toContain("(pointer: coarse)");
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
