import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SwitchTouchPad } from "./SwitchTouchPad";
import { SwitchInput } from "../media/switch";

function poser(source: SwitchInput) {
  const { container } = render(
    <SwitchTouchPad source={source} onMenu={vi.fn()} onLeave={vi.fn()} onSound={vi.fn()} />,
  );
  const puits = container.querySelector("#switchStickL") as HTMLElement;
  puits.setPointerCapture = vi.fn();
  puits.releasePointerCapture = vi.fn();
  // Un puits de 100 px centré en (50, 50): jsdom ne mesure rien tout seul.
  puits.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
  return puits;
}

it("le puits rend une valeur proportionnelle, et la rend au relâchement", () => {
  const source = new SwitchInput();
  const puits = poser(source);
  // Un pouce à mi-course vers la droite: 25 px sur un rayon de 50.
  fireEvent.pointerDown(puits, { clientX: 75, clientY: 50, pointerId: 1 });
  expect(source.pushed.get("lx")).toBeCloseTo(0.5);
  expect(source.pushed.get("ly")).toBeCloseTo(0);
  // Le jumeau négatif: un pouce levé rend la main, sinon le stick resterait
  // collé à sa dernière valeur et le personnage courrait tout seul.
  fireEvent.pointerUp(puits, { pointerId: 1 });
  expect(source.pushed.has("lx")).toBe(false);
  expect(source.pushed.has("ly")).toBe(false);
});

it("le centre du puits ne pousse rien: une zone morte, comme une vraie manette", () => {
  const source = new SwitchInput();
  const puits = poser(source);
  fireEvent.pointerDown(puits, { clientX: 52, clientY: 50, pointerId: 1 });
  expect(source.pushed.get("lx")).toBe(0);
  expect(source.pushed.get("ly")).toBe(0);
});
