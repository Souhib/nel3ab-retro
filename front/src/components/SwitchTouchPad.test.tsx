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

/** Les pièces du pavé, par ce qu'elles portent écrit, avec leur place. */
function pieces(container: HTMLElement) {
  const n = (v: string) => Number.parseFloat(v);
  return new Map(
    [...container.querySelectorAll<HTMLElement>("[data-touche]")].map((el) => [
      el.dataset.touche ?? "",
      { text: el.textContent ?? "", x: n(el.style.left), y: n(el.style.top), el },
    ]),
  );
}

it("dans une salle Xbox 360, le pavé dit LB, LT, Back et Start, et range A en bas", () => {
  const { container } = render(
    <SwitchTouchPad
      source={new SwitchInput()}
      console="x360"
      onMenu={vi.fn()}
      onLeave={vi.fn()}
      onSound={vi.fn()}
    />,
  );
  const at = pieces(container);
  expect(at.get("L")?.text).toBe("LB");
  expect(at.get("ZL")?.text).toBe("LT");
  expect(at.get("MINUS")?.text).toBe("Back");
  expect(at.get("PLUS")?.text).toBe("Start");
  expect(container.textContent).not.toMatch(/ZL|ZR|[+−]/);
  // A en bas et Y en haut, dans la même colonne; X à gauche, B à droite.
  const [a, b, x, y] = ["A", "B", "X", "Y"].map((key) => at.get(key));
  expect(a?.x).toBe(y?.x);
  expect(a?.y).toBeGreaterThan(y?.y ?? Infinity);
  expect(b?.x).toBeGreaterThan(x?.x ?? Infinity);
  expect(b?.y).toBe(x?.y);
});

it("dans une salle Switch, le pavé garde ZL et + , et range A à droite", () => {
  // Le jumeau négatif: les noms et la place Xbox ne fuient pas ici.
  const { container } = render(
    <SwitchTouchPad
      source={new SwitchInput()}
      console="switch"
      onMenu={vi.fn()}
      onLeave={vi.fn()}
      onSound={vi.fn()}
    />,
  );
  const at = pieces(container);
  expect(at.get("ZL")?.text).toBe("ZL");
  expect(at.get("PLUS")?.text).toBe("+");
  expect(container.textContent).not.toMatch(/LB|LT|Back|Start/);
  const [a, b, x, y] = ["A", "B", "X", "Y"].map((key) => at.get(key));
  expect(a?.x).toBeGreaterThan(y?.x ?? Infinity);
  expect(a?.y).toBe(y?.y);
  expect(b?.y).toBeGreaterThan(x?.y ?? Infinity);
});

it("taper LB écrit L sur la trame, et le relâcher l'efface", () => {
  const source = new SwitchInput();
  const { container } = render(
    <SwitchTouchPad
      source={source}
      console="x360"
      onMenu={vi.fn()}
      onLeave={vi.fn()}
      onSound={vi.fn()}
    />,
  );
  const lb = pieces(container).get("L")?.el as HTMLElement;
  lb.setPointerCapture = vi.fn();
  fireEvent.pointerDown(lb, { pointerId: 3 });
  expect([...source.touched]).toEqual(["L"]);
  fireEvent.pointerUp(lb, { pointerId: 3 });
  expect(source.touched.size).toBe(0);
});
