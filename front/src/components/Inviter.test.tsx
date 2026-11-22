/** Le bouton « Inviter » de la colonne (audit P11). */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { Inviter } from "./Inviter";

const LIEN = "https://nel3ab.app/r/1/?entrer=jouer";

it("copie le lien, le dit, et rappelle la condition du réseau privé", async () => {
  const copier = vi.fn().mockResolvedValue(undefined);
  render(<Inviter lien={LIEN} outils={{ copier }} />);
  // Rien d'affiché avant le geste: une colonne qui parle sans qu'on demande
  // se lit en diagonale.
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Inviter quelqu'un" }));
  });
  expect(copier).toHaveBeenCalledWith(LIEN);
  expect(screen.getByRole("status")).toHaveTextContent("Lien copié");
  expect(screen.getByText(/réseau privé/)).toBeVisible();
});

it("montre le lien à copier quand le navigateur refuse de copier", async () => {
  render(<Inviter lien={LIEN} outils={{ copier: vi.fn().mockRejectedValue(new Error("non")) }} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Inviter quelqu'un" }));
  });
  expect(screen.getByRole("textbox", { name: "lien d'invitation" })).toHaveValue(LIEN);
});
