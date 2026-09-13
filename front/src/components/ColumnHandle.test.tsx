import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { COLUMN } from "../lib/column";
import { ColumnHandle } from "./ColumnHandle";

function show(width: number = COLUMN.normal) {
  const onWidth = vi.fn();
  const onSettle = vi.fn();
  render(<ColumnHandle width={width} onWidth={onWidth} onSettle={onSettle} />);
  const handle = screen.getByRole("separator");
  // jsdom ne connaît pas la capture du pointeur.
  handle.setPointerCapture = vi.fn();
  return { handle, onWidth, onSettle };
}

const viewport = (width: number) =>
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });

beforeEach(() => viewport(1440));

it("tirer vers la gauche élargit, et la largeur n'est rangée qu'au lâcher", () => {
  const { handle, onWidth, onSettle } = show();
  fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 952, pointerId: 1 });
  expect(onWidth).toHaveBeenLastCalledWith(352);
  expect(onSettle).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { clientX: 952, pointerId: 1 });
  expect(onSettle).toHaveBeenCalledExactlyOnceWith(352);
});

it("tirer vers la droite rétrécit", () => {
  const { handle, onWidth } = show();
  fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 1016, pointerId: 1 });
  expect(onWidth).toHaveBeenLastCalledWith(288);
});

it("s'arrête aux deux bornes", () => {
  const { handle, onWidth } = show();
  fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
  expect(onWidth).toHaveBeenLastCalledWith(COLUMN.max);
  fireEvent.pointerMove(handle, { clientX: 3000, pointerId: 1 });
  expect(onWidth).toHaveBeenLastCalledWith(COLUMN.min);
});

it("s'arrête à la moitié d'une fenêtre étroite", () => {
  viewport(800);
  const { handle, onWidth } = show();
  fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
  expect(onWidth).toHaveBeenLastCalledWith(400);
});

it("un survol sans appui ne change rien, ni un autre pointeur", () => {
  const { handle, onWidth, onSettle } = show();
  fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
  expect(onWidth).not.toHaveBeenCalled();
  fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 900, pointerId: 2 });
  fireEvent.pointerUp(handle, { clientX: 900, pointerId: 2 });
  expect(onWidth).not.toHaveBeenCalled();
  expect(onSettle).not.toHaveBeenCalled();
});

it("le bouton droit ne tire pas", () => {
  const { handle, onWidth } = show();
  fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1, button: 2 });
  fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
  expect(onWidth).not.toHaveBeenCalled();
});

it("un clic sans déplacement ne range rien", () => {
  const { handle, onSettle } = show();
  fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 1000, pointerId: 1 });
  expect(onSettle).not.toHaveBeenCalled();
});

it("le double-clic remet la largeur d'origine", () => {
  const { handle, onWidth, onSettle } = show(420);
  fireEvent.doubleClick(handle);
  expect(onWidth).toHaveBeenLastCalledWith(COLUMN.normal);
  expect(onSettle).toHaveBeenCalledExactlyOnceWith(COLUMN.normal);
});

/* La poignée ne doit JAMAIS garder le focus: la boucle d'entrée donne les
   flèches au jeu, et un élément focalisé qui les voudrait aussi se battrait
   avec lui. */
it("ne prend pas le focus, ni par la tabulation ni au clic", () => {
  const { handle } = show();
  expect(handle).not.toHaveAttribute("tabindex");
  const allowed = fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 });
  expect(allowed, "l'appui empêche le focus et la sélection").toBe(false);
});
