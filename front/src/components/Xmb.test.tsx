/**
 * Le menu XMB: un dialogue modal dont le curseur est le focus.
 *
 * Ce que jsdom peut vérifier: où est le focus, ce que disent les attributs, ce
 * que le pied nomme. Ce qu'il ne peut pas: l'inertie du reste de la page, Tab
 * qui reste dans le menu, l'activation native d'un bouton par Entrée. Ces
 * trois-là sont dans `spikes/m3-browser-drive/focus.mjs`, contre un vrai
 * Chrome (`just focus-navigateur`).
 */
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Xmb, type XmbCategory } from "./Xmb";

const rubriques = (choisi = vi.fn(), grise = vi.fn()): XmbCategory[] => [
  {
    id: "jeux",
    label: "jeux",
    icon: null,
    items: [
      { id: "gc", label: "GameCube", icon: null, onEnter: choisi },
      { id: "wii", label: "Wii", icon: null, onEnter: vi.fn() },
      { id: "verrou", label: "Jeu d'un autre", icon: null, disabled: true, onEnter: grise },
    ],
  },
  {
    id: "manettes",
    label: "manettes",
    icon: null,
    items: [{ id: "bindings", label: "touches et manettes", icon: null }],
  },
  {
    id: "salle",
    label: "salle",
    icon: null,
    items: [{ id: "leave", label: "quitter la salle", icon: null }],
  },
  {
    id: "reglages",
    label: "réglages",
    icon: null,
    items: [
      {
        id: "theme",
        label: "couleurs",
        icon: null,
        picks: [
          { id: "nuit", label: "nuit" },
          { id: "jour", label: "jour" },
        ],
        picked: "nuit",
      },
    ],
  },
];

const $ = (selecteur: string) => document.querySelector<HTMLElement>(selecteur);
const touche = (key: string) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

describe("le menu est un dialogue modal", () => {
  it("s'ouvre en dialogue nommé, et se ferme en partant", () => {
    const { unmount } = render(<Xmb categories={rubriques()} onClose={vi.fn()} />);
    const menu = $("dialog#menu");
    expect(menu).not.toBeNull();
    expect(menu?.hasAttribute("open")).toBe(true);
    expect(menu?.getAttribute("aria-label")).toBe("menu de la salle");
    unmount();
    expect(menu?.hasAttribute("open")).toBe(false);
  });

  it("donne le focus à l'entrée choisie, et à elle seule la tabulation", () => {
    render(<Xmb categories={rubriques()} onClose={vi.fn()} />);
    expect(document.activeElement?.id).toBe("item-gc");
    expect($("#item-gc")?.getAttribute("aria-current")).toBe("true");
    expect($("#item-gc")?.tabIndex).toBe(0);
    expect($("#item-wii")?.tabIndex).toBe(-1);
    expect($("#item-wii")?.getAttribute("aria-current")).toBeNull();
  });

  it("fait suivre le focus au curseur, par les flèches", () => {
    render(<Xmb categories={rubriques()} onClose={vi.fn()} />);
    touche("ArrowDown");
    expect(document.activeElement?.id).toBe("item-wii");
    expect($("#item-wii")?.getAttribute("aria-current")).toBe("true");
    touche("ArrowRight");
    expect(document.activeElement?.id).toBe("item-bindings");
    expect($("#ray-manettes")?.getAttribute("aria-current")).toBe("true");
    expect($("#ray-jeux")?.getAttribute("aria-current")).toBeNull();
  });

  it("garde une entrée grisée focalisable, et ne la lance pas", () => {
    // Avec `disabled`, le curseur s'y posait sans le focus, et Entrée
    // activait l'entrée d'avant: le focus et le curseur se séparaient encore.
    const grise = vi.fn();
    render(<Xmb categories={rubriques(vi.fn(), grise)} onClose={vi.fn()} />);
    touche("ArrowDown");
    touche("ArrowDown");
    expect(document.activeElement?.id).toBe("item-verrou");
    expect($("#item-verrou")?.hasAttribute("disabled")).toBe(false);
    expect($("#item-verrou")?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click($("#item-verrou")!);
    expect(grise).not.toHaveBeenCalled();
  });

  it("donne le focus au sélecteur ouvert, puis le rend à l'entrée", () => {
    render(<Xmb categories={rubriques()} onClose={vi.fn()} />);
    for (let i = 0; i < 3; i += 1) touche("ArrowRight");
    fireEvent.click($("#item-theme")!);
    expect(document.activeElement?.id).toBe("pick-nuit");
    expect($("#pick-nuit")?.getAttribute("aria-current")).toBe("true");
    touche("ArrowDown");
    expect(document.activeElement?.id).toBe("pick-jour");
    touche("Escape");
    expect($("#picker")).toBeNull();
    expect(document.activeElement?.id).toBe("item-theme");
  });
});

describe("les rubriques et le pied", () => {
  it("nomme les quatre rubriques, pas seulement la choisie", () => {
    render(<Xmb categories={rubriques()} onClose={vi.fn()} />);
    const noms = [...document.querySelectorAll("[data-nom]")].map((el) => el.textContent);
    expect(noms).toEqual(["jeux", "manettes", "salle", "réglages"]);
    for (const el of document.querySelectorAll("[data-nom]"))
      expect(el.className).not.toMatch(/opacity-0/);
  });
});
