import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InputStream } from "../media/input";
import { fermerReglage, ouvrirReglage } from "./entree";
import { HoteReglage } from "./HoteReglage";
import type { TrameDolphin } from "./reglage/Dolphin";

const rien = () => {};
const image = () => new Promise((fin) => requestAnimationFrame(fin));
const input = new InputStream(() => "", rien);
const trame: TrameDolphin = {
  genre: "dolphin",
  console: "gc",
  tenue: 0,
  state: input.state(),
  input,
  refresh: rien,
};

afterEach(() => {
  fermerReglage();
  document.body.innerHTML = "";
});

it("ne rend rien avant ouvrirReglage, puis le panneau sur l'onglet demandé", () => {
  render(<HoteReglage trame={trame} autres={false} vit repli={() => null} />);
  expect(document.querySelector("[data-reglage]")).toBeNull();
  act(() => ouvrirReglage("clavier"));
  expect(screen.getByRole("tab", { name: "Clavier" })).toHaveAttribute("aria-selected", "true");
});

it("rend le focus à l'ouvreur à la fermeture, et au repli quand l'ouvreur a disparu", async () => {
  // L'ouvreur vit hors de React, comme le rang que la colonne démonte.
  const ouvreur = document.body.appendChild(document.createElement("button"));
  ouvreur.textContent = "Touches";
  const { container } = render(
    <>
      <button type="button" id="repli">
        Repli
      </button>
      <HoteReglage
        trame={trame}
        autres={false}
        vit
        repli={() => document.getElementById("repli")}
      />
    </>,
  );
  ouvreur.focus();
  act(() => ouvrirReglage());
  fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
  await act(image);
  expect(container.querySelector("[data-reglage]")).toBeNull();
  expect(document.activeElement).toBe(ouvreur);
  // Le jumeau : l'ouvreur part avec les rangs, le repli prend le focus.
  ouvreur.focus();
  act(() => ouvrirReglage());
  ouvreur.remove();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Manette" }), { key: "Escape" });
  await act(image);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Repli" }));
});

it("ne monte rien sans trame, même ouvert", () => {
  act(() => ouvrirReglage());
  render(<HoteReglage trame={null} autres={false} vit repli={() => null} />);
  expect(document.querySelector("[data-reglage]")).toBeNull();
});
