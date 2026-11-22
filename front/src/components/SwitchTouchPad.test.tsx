import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SwitchTouchPad } from "./SwitchTouchPad";
import { SwitchInput } from "../media/switch";

function poser(source: SwitchInput) {
  const { container } = render(
    <SwitchTouchPad source={source} console="switch" bar={0} onFeuille={vi.fn()} />,
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
    <SwitchTouchPad source={new SwitchInput()} console="x360" bar={0} onFeuille={vi.fn()} />,
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
    <SwitchTouchPad source={new SwitchInput()} console="switch" bar={0} onFeuille={vi.fn()} />,
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
    <SwitchTouchPad source={source} console="x360" bar={0} onFeuille={vi.fn()} />,
  );
  const lb = pieces(container).get("L")?.el as HTMLElement;
  lb.setPointerCapture = vi.fn();
  fireEvent.pointerDown(lb, { pointerId: 3 });
  expect([...source.touched]).toEqual(["L"]);
  fireEvent.pointerUp(lb, { pointerId: 3 });
  expect(source.touched.size).toBe(0);
});

/** Le pavé d'une salle Switch, ses touches prêtes à être capturées. */
function salle(source: SwitchInput, soundOff = false) {
  const view = render(
    <SwitchTouchPad
      source={source}
      console="switch"
      bar={0}
      soundOff={soundOff}
      onFeuille={vi.fn()}
    />,
  );
  for (const el of view.container.querySelectorAll<HTMLElement>("[data-touche]")) {
    el.setPointerCapture = vi.fn();
    el.hasPointerCapture = () => true;
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
      }) as DOMRect;
  }
  return { ...view, at: pieces(view.container) };
}

it("une annulation de pointeur ou une capture perdue relâche la touche Pro tenue", () => {
  const source = new SwitchInput();
  const { at } = salle(source);
  const a = at.get("A")?.el as HTMLElement;
  fireEvent.pointerDown(a, { pointerId: 4 });
  expect([...source.touched]).toEqual(["A"]);
  fireEvent.pointerCancel(a, { pointerId: 4 });
  expect(source.touched.size).toBe(0);
  fireEvent.pointerDown(a, { pointerId: 5 });
  expect([...source.touched]).toEqual(["A"]);
  fireEvent.lostPointerCapture(a, { pointerId: 5 });
  expect(source.touched.size).toBe(0);
});

it("la croix Pro relâche sa direction sur annulation et sur capture perdue", () => {
  const source = new SwitchInput();
  const { at } = salle(source);
  const croix = at.get("croix")?.el as HTMLElement;
  fireEvent.pointerDown(croix, { clientX: 5, clientY: 50, pointerId: 6 });
  expect([...source.touched]).toEqual(["LEFT"]);
  fireEvent.pointerCancel(croix, { pointerId: 6 });
  expect(source.touched.size).toBe(0);
  fireEvent.pointerDown(croix, { clientX: 50, clientY: 95, pointerId: 7 });
  expect([...source.touched]).toEqual(["DOWN"]);
  fireEvent.lostPointerCapture(croix, { pointerId: 7 });
  expect(source.touched.size).toBe(0);
});

it("quitter l'onglet relâche les touches et les sticks de la manette Pro", () => {
  const source = new SwitchInput();
  const { at } = salle(source);
  fireEvent.pointerDown(at.get("ZR")?.el as HTMLElement, { pointerId: 8 });
  fireEvent.pointerDown(at.get("stick-r")?.el as HTMLElement, {
    clientX: 95,
    clientY: 50,
    pointerId: 9,
  });
  expect([...source.touched]).toEqual(["ZR"]);
  expect(source.pushed.get("rx")).toBeGreaterThan(0.5);
  window.dispatchEvent(new Event("blur"));
  expect(source.touched.size).toBe(0);
  expect(source.pushed.size).toBe(0);
});

it("le son coupé se voit sur le « ••• » de la manette Pro, et seulement alors", () => {
  const coupe = salle(new SwitchInput(), true);
  expect(coupe.container.querySelector("#ouvrirFeuille")?.hasAttribute("data-alerte")).toBe(true);
  coupe.unmount();
  const joue = salle(new SwitchInput(), false);
  expect(joue.container.querySelector("#ouvrirFeuille")?.hasAttribute("data-alerte")).toBe(false);
});
