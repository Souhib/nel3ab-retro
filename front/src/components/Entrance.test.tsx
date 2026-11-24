/** « Qui joue ? » monte le champ du nom de personnes (K03, 24 novembre 2026). */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { rememberedName } from "../lib/name";
import { NOM, QUI_JOUE } from "../lib/mots";
import { Entrance } from "./Entrance";

beforeEach(() => localStorage.clear());

const entrer = () => document.querySelector<HTMLButtonElement>("#entrerNom")!;

it("un nom vide est refusé avec sa raison, le focus rendu au champ, sans entrer", () => {
  const onName = vi.fn();
  render(<Entrance onName={onName} salle="salle 1" />);
  // Toujours actif : un bouton grisé ne disait pas pourquoi (A11Y-17).
  expect(entrer().disabled).toBe(false);
  fireEvent.click(entrer());
  expect(onName).not.toHaveBeenCalled();
  expect(screen.getByText(NOM.vide)).toBeTruthy();
  const champ = screen.getByLabelText(NOM.libelle);
  expect(champ.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(champ);
});

it("un nom tapé entre, et l'appareil le garde", () => {
  const onName = vi.fn();
  render(<Entrance onName={onName} salle="salle 1" />);
  fireEvent.change(screen.getByLabelText(NOM.libelle), { target: { value: "  Nour " } });
  fireEvent.click(entrer());
  expect(onName).toHaveBeenCalledWith("Nour");
  expect(rememberedName()).toBe("Nour");
});

it("le bouton nomme la salle quand elle est connue", () => {
  render(<Entrance onName={vi.fn()} salle="salle 2" />);
  expect(entrer().textContent).toBe("Entrer dans la salle 2");
});

it("dit qu'un autre nom était gardé seulement après « Ce n'est pas toi ? »", () => {
  const { unmount } = render(<Entrance onName={vi.fn()} oublie />);
  expect(screen.queryByText(QUI_JOUE.autreNom)).not.toBeNull();
  unmount();
  render(<Entrance onName={vi.fn()} />);
  expect(screen.queryByText(QUI_JOUE.autreNom)).toBeNull();
  expect(entrer().textContent).toBe("Entrer");
});
