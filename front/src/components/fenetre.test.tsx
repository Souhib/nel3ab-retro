/**
 * La fenêtre que la salle lit (`useFenetre`) : la vue de mise en page, pas
 * `innerWidth`.
 *
 * Relecture finale du 25 novembre 2026 : à 1366x1024 au doigt, l'ouverture
 * débordait de 32 px à droite. En émulation mobile de Chrome, un débordement
 * élargit `innerWidth` (1398), et la salle gardait ensuite une pose trop
 * large : la page défilait dans les deux sens et les touches R et X de la
 * manette à l'écran sortaient de 23 px. `documentElement.clientWidth` reste
 * la largeur de la vue (1366).
 */
import { render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useFenetre } from "./Cadre";

function Lit() {
  const f = useFenetre();
  return <p data-l={f.width} data-h={f.height} />;
}

const racine = document.documentElement;
const poser = (nom: "clientWidth" | "clientHeight", valeur: number) =>
  Object.defineProperty(racine, nom, { configurable: true, get: () => valeur });

afterEach(() => {
  delete (racine as unknown as Record<string, unknown>).clientWidth;
  delete (racine as unknown as Record<string, unknown>).clientHeight;
});

it("lit la vue de mise en page, pas une fenêtre élargie par un débordement", () => {
  Object.assign(window, { innerWidth: 1398, innerHeight: 1048 });
  poser("clientWidth", 1366);
  poser("clientHeight", 1024);
  const { container } = render(<Lit />);
  const p = container.querySelector("p")!;
  expect(p.dataset.l).toBe("1366");
  expect(p.dataset.h).toBe("1024");
});

it("jumeau : sans vue mesurée (jsdom, ou avant la mise en page), innerWidth", () => {
  Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
  poser("clientWidth", 0);
  poser("clientHeight", 0);
  const { container } = render(<Lit />);
  const p = container.querySelector("p")!;
  expect(p.dataset.l).toBe("1024");
  expect(p.dataset.h).toBe("768");
});
