/** Une explication à la demande, au doigt comme à la souris (audit T10). */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Aide } from "./Aide";

it("cache la phrase, l'ouvre au toucher, et la referme", () => {
  render(
    <Aide texte="Les 45 dernières secondes, en un fichier." sujet="le clip">
      <button type="button">clip</button>
    </Aide>,
  );
  const bouton = screen.getByRole("button", { name: "à quoi sert le clip" });
  const phrase = screen.getByText("Les 45 dernières secondes, en un fichier.");
  // Le jumeau d'abord: fermée, elle ne prend pas de place.
  expect(phrase).not.toBeVisible();
  expect(bouton).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(bouton);
  expect(phrase).toBeVisible();
  expect(bouton).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(bouton);
  expect(phrase).not.toBeVisible();
});
