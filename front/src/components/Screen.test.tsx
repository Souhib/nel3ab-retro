/**
 * La zone d'image est peinte par le jeton `--ecran`, noir dans les deux régies.
 *
 * `src/lib/regie.test.ts` vérifie que `--ecran` vaut #000000 la nuit comme le
 * jour. Jusqu'à la relecture du 22 novembre 2026, aucun composant ne
 * l'employait: l'écran était peint par `bg-black`, et l'essai du jeton ne
 * pouvait pas échouer si le fond de l'écran changeait. Ici on vérifie que
 * l'écran lit vraiment le jeton.
 */
import { render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Screen } from "./Screen";

type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
// Par une fonction et non `new URL("…", import.meta.url)` écrit en entier:
// Vite réécrit cette forme littérale en adresse de ressource (`/src/…`).
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;

beforeEach(() => {
  // jsdom ne mesure rien: l'écran observe sa place, l'observateur ne dit rien.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const zone = () => {
  const { container } = render(
    <Screen canvasRef={createRef()} fit="remplir" picture={{ width: 640, height: 480 }} />,
  );
  const canvas = container.querySelector("canvas#screen");
  // La précondition: c'est bien l'écran, et sa boîte est le parent du canevas.
  expect(canvas).not.toBeNull();
  return canvas?.parentElement as HTMLElement;
};

it("l'écran est peint par le jeton de la régie", () => {
  expect(zone().className.split(/\s+/)).toContain("bg-ecran");
});

it("et par lui seul: pas de noir écrit en dur à côté", () => {
  // Le jumeau: `bg-black` en plus de `bg-ecran` laisserait l'ordre des
  // classes décider, et le jeton redeviendrait décoratif.
  expect(zone().className).not.toMatch(/\bbg-(black|ink|fond|plaque)\b/);
});

it("la classe existe: `--color-ecran` pointe sur `--ecran`", () => {
  // Sans cette déclaration dans `@theme`, Tailwind ne produit aucune règle
  // pour `bg-ecran`, et l'écran n'aurait plus de fond du tout.
  const css = fs.readFileSync(ici("../index.css"), "utf-8");
  expect(css).toMatch(/--color-ecran:\s*var\(--ecran\);/);
});

describe("le nom de la zone de jeu", () => {
  it("dit l'aide du clavier par aria-describedby, sans rien poser sur l'image", () => {
    const { container } = render(
      <Screen
        canvasRef={createRef()}
        fit="remplir"
        picture={{ width: 640, height: 480 }}
        libelle="Zelda, l'image de la partie"
        aide="Ctrl agrandit l'image, Échap ouvre le menu du jeu, Tab en sort."
      />,
    );
    const zoneJeu = container.querySelector("#zone-jeu")!;
    expect(zoneJeu.getAttribute("aria-label")).toBe("Zelda, l'image de la partie");
    const aide = container.querySelector(`#${zoneJeu.getAttribute("aria-describedby")}`);
    expect(aide?.textContent).toContain("Ctrl agrandit l'image");
    expect(aide?.hasAttribute("hidden")).toBe(true);
  });

  it("sans aide, la zone ne pointe vers rien", () => {
    const { container } = render(
      <Screen canvasRef={createRef()} fit="remplir" picture={{ width: 640, height: 480 }} />,
    );
    expect(container.querySelector("#zone-jeu")!.hasAttribute("aria-describedby")).toBe(false);
    expect(container.querySelector("#aideZoneJeu")).toBeNull();
  });
});
