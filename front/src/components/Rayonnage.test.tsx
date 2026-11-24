/**
 * Le rayonnage de l'écran éteint (B1 à B11) : les rangées, la fiche à la
 * place des rangées, le clavier et la manette, le dernier jeu.
 */
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Game } from "../client";
import type { MenuAction } from "../media/menupad";
import type { FicheDeLigne } from "../lib/menu";
import { Rayonnage } from "./Rayonnage";

const BANC: Game[] = [
  { index: 0, key: "mp4.iso", name: "Mario Party 4", console: "gc", art: true },
  { index: 1, key: "sonic.iso", name: "Sonic Generations", console: "x360" },
  { index: 2, key: "mkw.rvz", name: "Mario Kart Wii", console: "wii" },
  { index: 3, key: "f-zero.iso", name: "F-Zero GX", console: "gc" },
];

const ficheDe = (onAgir = vi.fn()) =>
  vi.fn((game: Game): FicheDeLigne => ({
    consequence: "Le jeu part tout de suite.",
    agir: "Lancer",
    annuler: "Revenir à la liste",
    choix: [
      { id: "neuve", label: "nouvelle partie" },
      { id: "commune", label: "tout débloqué" },
    ],
    onAgir: (choix) => onAgir(game.index, choix),
  }));

const cartouche = (i: number) => document.querySelector<HTMLElement>(`[data-jeu="${i}"]`)!;

describe("Rayonnage", () => {
  it("une rangée par console dans l'ordre du manifeste, une cartouche par jeu", () => {
    const { container } = render(
      <Rayonnage library={BANC} ficheDe={ficheDe()} focusEntree={false} />,
    );
    const titres = [...container.querySelectorAll(".n3-rangee-titre")].map((t) => t.textContent);
    expect(titres).toEqual(["GameCube, 2 jeux", "Wii, 1 jeu", "Xbox 360, 1 jeu"]);
    expect(container.querySelectorAll("[data-jeu]")).toHaveLength(BANC.length);
    // La jaquette servie pour le seul jeu qui en a une.
    expect(cartouche(0).querySelector("img")).not.toBeNull();
    expect(cartouche(3).querySelector("img")).toBeNull();
    // B2b : rien du cordon ni de la prise de l'ancienne mascotte.
    expect(container.innerHTML).not.toMatch(/cordon|prise/);
  });

  it("prend le focus à l'arrivée sur la première cartouche, et pas quand on ne le lui demande pas", () => {
    const { unmount } = render(<Rayonnage library={BANC} ficheDe={ficheDe()} focusEntree />);
    expect(document.activeElement).toBe(cartouche(0));
    unmount();
    render(<Rayonnage library={BANC} ficheDe={ficheDe()} focusEntree={false} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("Entrée ouvre la fiche à la place des rangées, le focus sur la sauvegarde cochée", () => {
    const onAgir = vi.fn();
    const { container } = render(
      <Rayonnage library={BANC} ficheDe={ficheDe(onAgir)} focusEntree />,
    );
    fireEvent.click(cartouche(3));
    expect(cartouche(3).getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector<HTMLElement>(".n3-rayonnage-rangees")?.hidden).toBe(true);
    expect(document.getElementById("ficheJeuTitre")?.textContent).toBe("F-Zero GX");
    expect(document.activeElement).toBe(document.getElementById("ficheJeu-neuve"));
    fireEvent.click(document.getElementById("ficheJeu-commune")!);
    fireEvent.click(document.getElementById("ficheJeuAgir")!);
    expect(onAgir).toHaveBeenCalledWith(3, "commune");
  });

  it("Échap ferme la fiche, rend le focus à la cartouche et ne remonte pas jusqu'à la page", () => {
    const page = vi.fn();
    addEventListener("keydown", page);
    render(<Rayonnage library={BANC} ficheDe={ficheDe()} focusEntree />);
    fireEvent.click(cartouche(2));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.getElementById("ficheJeu")).toBeNull();
    expect(document.activeElement).toBe(cartouche(2));
    expect(cartouche(2).getAttribute("aria-expanded")).toBe("false");
    expect(page).not.toHaveBeenCalled();
    // Le jumeau : sans fiche ouverte, Échap remonte à la page (qui ouvre le menu).
    fireEvent.keyDown(cartouche(2), { key: "Escape" });
    expect(page).toHaveBeenCalledOnce();
    removeEventListener("keydown", page);
  });

  it("les flèches passent d'une cartouche à l'autre ; ↑ sur la première rangée ne bouge pas", () => {
    render(<Rayonnage library={BANC} ficheDe={ficheDe()} focusEntree />);
    fireEvent.keyDown(cartouche(0), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cartouche(3));
    fireEvent.keyDown(cartouche(3), { key: "ArrowUp" });
    expect(document.activeElement).toBe(cartouche(3));
    fireEvent.keyDown(cartouche(3), { key: "ArrowDown" });
    // jsdom n'a pas de mise en page : tous les centres valent 0, et la
    // première cartouche de la rangée suivante gagne.
    expect(document.activeElement).toBe(cartouche(2));
    expect(document.getElementById("ficheJeu")).toBeNull();
  });

  it("la manette : ↓ comme ArrowDown, A ouvre, B referme", () => {
    let pad: ((action: MenuAction) => void) | null = null;
    const onPad = vi.fn((h: ((action: MenuAction) => void) | null) => {
      pad = h;
    });
    render(<Rayonnage library={BANC} ficheDe={ficheDe()} focusEntree onPad={onPad} />);
    act(() => pad?.("down"));
    expect(document.activeElement).toBe(cartouche(2));
    act(() => pad?.("confirm"));
    expect(document.getElementById("ficheJeu")).not.toBeNull();
    act(() => pad?.("back"));
    expect(document.getElementById("ficheJeu")).toBeNull();
    expect(document.activeElement).toBe(cartouche(2));
  });

  it("dit le dernier jeu et ouvre sa fiche ; rien sans la donnée ni pour un jeu parti", () => {
    const dernier = { cle: "mkw.rvz", titre: "Mario Kart Wii", quand: "2026-11-24T19:00:00" };
    const maintenant = () => new Date(2026, 10, 24, 21, 0);
    const { container, unmount } = render(
      <Rayonnage
        library={BANC}
        ficheDe={ficheDe()}
        focusEntree={false}
        dernier={dernier}
        maintenant={maintenant}
      />,
    );
    expect(container.textContent).toContain(
      "Le dernier jeu de cette salle : Mario Kart Wii, ce soir.",
    );
    fireEvent.click(document.getElementById("ouvrirDernier")!);
    expect(document.getElementById("ficheJeuTitre")?.textContent).toBe("Mario Kart Wii");
    unmount();
    const sans = render(<Rayonnage library={BANC} ficheDe={ficheDe()} focusEntree={false} />);
    expect(sans.container.textContent).not.toContain("dernier jeu");
    sans.unmount();
    const parti = render(
      <Rayonnage
        library={BANC}
        ficheDe={ficheDe()}
        focusEntree={false}
        dernier={{ ...dernier, cle: "parti.iso" }}
        maintenant={maintenant}
      />,
    );
    expect(parti.container.textContent).not.toContain("dernier jeu");
  });
});
