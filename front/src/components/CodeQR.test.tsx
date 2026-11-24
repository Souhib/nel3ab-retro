/** Le code QR : l'encodeur n'est chargé qu'au montage, et le cadre ne change
 * pas de taille quand le dessin arrive. */
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { INVITER } from "../lib/mots";
import * as qr from "../lib/qr";
import { CodeQR } from "./CodeQR";

it("charge l'encodeur une fois, puis dessine le lien", async () => {
  let livrer: (m: typeof qr) => void = () => {};
  const charger = vi.fn(() => new Promise<typeof qr>((r) => (livrer = r)));
  render(<CodeQR texte="https://nel3ab.app/r/1/?entrer=jouer" titre="code" charger={charger} />);
  expect(charger).toHaveBeenCalledTimes(1);
  // Avant le dessin : le cadre est là, vide, et rien ne se dit dessiné.
  const cadre = document.querySelector(".n3-qr-cadre");
  expect(cadre).not.toBeNull();
  expect(cadre).not.toHaveAttribute("data-dessine");
  expect(screen.queryByRole("img")).toBeNull();
  await act(async () => livrer(qr));
  // Le même cadre, et le dessin dedans.
  expect(document.querySelector(".n3-qr-cadre")).toBe(cadre);
  expect(cadre).toHaveAttribute("data-dessine");
  expect(screen.getByRole("img", { name: "code" })).toHaveAttribute(
    "shape-rendering",
    "crispEdges",
  );
});

it("jumeau : un lien trop long est dit, pas coupé", async () => {
  render(<CodeQR texte={"x".repeat(181)} titre="code" charger={() => Promise.resolve(qr)} />);
  expect(await screen.findByText(INVITER.tropLong)).toBeVisible();
  expect(screen.queryByRole("img")).toBeNull();
});
