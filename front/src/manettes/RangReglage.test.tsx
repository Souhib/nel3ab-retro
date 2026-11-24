/** Le rang « Touches et manettes » de la colonne. */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RangReglage } from "./RangReglage";

it("dit « Touches et manettes » et ouvre le panneau d'un clic", () => {
  const onOuvrir = vi.fn();
  render(<RangReglage onOuvrir={onOuvrir} />);
  const rang = screen.getByRole("button", { name: "Touches et manettes" });
  expect(rang).toHaveAttribute("id", "touchesEtManettes");
  // Le jumeau : rien ne s'ouvre avant le clic.
  expect(onOuvrir).not.toHaveBeenCalled();
  fireEvent.click(rang);
  expect(onOuvrir).toHaveBeenCalledTimes(1);
});
