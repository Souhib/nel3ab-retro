/**
 * La manette GameCube à l'écran, rendue par le vrai composant.
 *
 * jsdom ne pose rien : la boîte du pavé prend alors la taille de la fenêtre,
 * qu'on règle ici sur celle d'un iPhone tenu droit. Les positions lues dans le
 * style sont celles que `placePad` a calculées ; la garde navigateur
 * (`manette-garde.mjs`) vérifie ce que Chrome en fait.
 */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BUTTON } from "../media/pad";
import { Touch } from "../media/touch";
import { TouchPad } from "./TouchPad";

const size = { width: window.innerWidth, height: window.innerHeight };
beforeEach(() => {
  Object.assign(window, { innerWidth: 390, innerHeight: 844 });
});
afterEach(() => {
  Object.assign(window, { innerWidth: size.width, innerHeight: size.height });
});

function poser() {
  const touch = new Touch();
  const onLeave = vi.fn();
  const onMenu = vi.fn();
  const onSound = vi.fn();
  const view = render(
    <TouchPad bar={0} touch={touch} soundOff onSound={onSound} onLeave={onLeave} onMenu={onMenu} />,
  );
  for (const el of view.container.querySelectorAll<HTMLElement>("[data-touche]")) {
    el.setPointerCapture = vi.fn();
    el.hasPointerCapture = () => true;
  }
  return { ...view, touch, onLeave, onMenu, onSound };
}

/** Le rectangle qu'une pièce a reçu, lu dans son style. */
function rect(el: Element | null) {
  if (!(el instanceof HTMLElement)) throw new Error("pièce absente");
  const n = (v: string) => Number.parseFloat(v);
  return { x: n(el.style.left), y: n(el.style.top), w: n(el.style.width), h: n(el.style.height) };
}

it("taper R tient R, et ne cache pas la manette", () => {
  // La faute du 22 novembre 2026: « cacher » posé sur R, en portrait.
  const { container, touch, onLeave, onMenu } = poser();
  const r = container.querySelector("#touch-R") as HTMLElement;
  fireEvent.pointerDown(r, { pointerId: 1 });
  expect((touch.reading()?.buttons ?? 0) & BUTTON.R).toBe(BUTTON.R);
  fireEvent.pointerUp(r, { pointerId: 1 });
  expect(touch.reading()).toBeNull();
  expect(onLeave).not.toHaveBeenCalled();
  expect(onMenu).not.toHaveBeenCalled();
  // Le jumeau: « cacher » cache bien.
  fireEvent.click(container.querySelector("#hideTouch") as HTMLElement);
  expect(onLeave).toHaveBeenCalledTimes(1);
});

it("aucun geste de page ne touche L, Z, R ou START à 390 sur 844", () => {
  const { container } = poser();
  const gestes = [...container.querySelectorAll("[data-geste]")].map(rect);
  expect(gestes).toHaveLength(3);
  for (const id of ["#touch-L", "#touch-Z", "#touch-R", "#touch-START"]) {
    const key = rect(container.querySelector(id));
    for (const geste of gestes) {
      const dx = Math.max(0, key.x - (geste.x + geste.w), geste.x - (key.x + key.w));
      const dy = Math.max(0, key.y - (geste.y + geste.h), geste.y - (key.y + key.h));
      expect(Math.hypot(dx, dy), id).toBeGreaterThanOrEqual(12);
    }
    expect(Math.min(key.w, key.h), id).toBeGreaterThanOrEqual(44);
  }
});

it("la croix d'un seul bloc tient la direction du doigt, puis la lâche", () => {
  const { container, touch } = poser();
  const croix = container.querySelector("#touch-croix") as HTMLElement;
  // Un bloc de 100 px centré en (50, 50): jsdom ne mesure rien tout seul.
  croix.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
  fireEvent.pointerDown(croix, { clientX: 50, clientY: 5, pointerId: 2 });
  expect(touch.reading()?.buttons).toBe(BUTTON.D_UP);
  expect(croix.hasAttribute("data-up")).toBe(true);
  // Glisser vers la gauche lâche le haut et prend la gauche.
  fireEvent.pointerMove(croix, { clientX: 5, clientY: 50, pointerId: 2, buttons: 1 });
  expect(touch.reading()?.buttons).toBe(BUTTON.D_LEFT);
  expect(croix.hasAttribute("data-up")).toBe(false);
  fireEvent.pointerUp(croix, { pointerId: 2 });
  expect(touch.reading()).toBeNull();
});

it("le son coupé se voit sur son geste", () => {
  const { container } = poser();
  expect(container.querySelector("#wakeSound")?.hasAttribute("data-alerte")).toBe(true);
});
