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
  const onFeuille = vi.fn();
  const view = render(<TouchPad bar={0} touch={touch} soundOff onFeuille={onFeuille} />);
  for (const el of view.container.querySelectorAll<HTMLElement>("[data-touche]")) {
    el.setPointerCapture = vi.fn();
    el.hasPointerCapture = () => true;
  }
  return { ...view, touch, onFeuille };
}

/** Le rectangle qu'une pièce a reçu, lu dans son style. */
function rect(el: Element | null) {
  if (!(el instanceof HTMLElement)) throw new Error("pièce absente");
  const n = (v: string) => Number.parseFloat(v);
  return { x: n(el.style.left), y: n(el.style.top), w: n(el.style.width), h: n(el.style.height) };
}

it("taper R tient R, et n'ouvre aucun geste de page", () => {
  // La faute du 22 novembre 2026: « cacher » posé sur R, en portrait.
  const { container, touch, onFeuille } = poser();
  const r = container.querySelector("#touch-R") as HTMLElement;
  fireEvent.pointerDown(r, { pointerId: 1 });
  expect((touch.reading()?.buttons ?? 0) & BUTTON.R).toBe(BUTTON.R);
  fireEvent.pointerUp(r, { pointerId: 1 });
  expect(touch.reading()).toBeNull();
  expect(onFeuille).not.toHaveBeenCalled();
  // Le jumeau: « La salle » ouvre bien la feuille.
  fireEvent.click(container.querySelector("#laSalleManette") as HTMLElement);
  expect(onFeuille).toHaveBeenCalledTimes(1);
});

it("un seul geste de page peut rester parmi les touches, « La salle »", () => {
  // Son, menu et cacher vivent dans la feuille depuis le 22 novembre 2026. Un
  // retour de l'un d'eux parmi les touches remettrait une cible de page sous
  // les pouces. Le « ••• » est devenu « La salle » le 23 novembre : son nom
  // est dit, son signe est l'icône de la salle.
  const { container } = poser();
  const gestes = [...container.querySelectorAll<HTMLElement>("[data-geste]")];
  expect(gestes.map((one) => one.dataset.geste)).toEqual(["feuille"]);
  expect(gestes[0]?.getAttribute("aria-label")).toMatch(/La salle/);
  expect(gestes[0]?.textContent).not.toContain("•••");
  for (const ancien of ["#wakeSound", "#showColumn", "#hideTouch"])
    expect(container.querySelector(ancien), ancien).toBeNull();
});

it("aucun geste de page ne touche L, Z, R ou START à 390 sur 844", () => {
  const { container } = poser();
  const gestes = [...container.querySelectorAll("[data-geste]")].map(rect);
  expect(gestes).toHaveLength(1);
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

it("le son coupé se voit sur « La salle », et se dit dans son nom", () => {
  const { container } = poser();
  const plus = container.querySelector("#laSalleManette");
  expect(plus?.hasAttribute("data-alerte")).toBe(true);
  expect(plus?.getAttribute("aria-label")).toMatch(/^Son coupé\./);
});

it("le son qui joue ne s'alerte pas", () => {
  // Le jumeau négatif de l'essai d'au-dessus: un pavé qui alerterait toujours
  // le passerait.
  const touch = new Touch();
  const { container } = render(
    <TouchPad bar={0} touch={touch} soundOff={false} onFeuille={vi.fn()} />,
  );
  const plus = container.querySelector("#laSalleManette");
  expect(plus?.hasAttribute("data-alerte")).toBe(false);
  expect(plus?.getAttribute("aria-label")).not.toMatch(/coupé/);
});

/* Ce qui relâche sans que le doigt se lève.
 *
 * Un appel entrant annule les pointeurs (`pointercancel`), le navigateur peut
 * reprendre la capture (`lostpointercapture`), et quitter l'onglet n'envoie
 * aucun `pointerup`. Sans relâchement, la touche reste tenue pour toujours. */

it("une annulation de pointeur relâche la touche tenue", () => {
  const { container, touch } = poser();
  const a = container.querySelector("#touch-A") as HTMLElement;
  fireEvent.pointerDown(a, { pointerId: 4 });
  expect((touch.reading()?.buttons ?? 0) & BUTTON.A).toBe(BUTTON.A);
  fireEvent.pointerCancel(a, { pointerId: 4 });
  expect(touch.reading()).toBeNull();
});

it("une capture perdue relâche la touche tenue", () => {
  const { container, touch } = poser();
  const a = container.querySelector("#touch-A") as HTMLElement;
  fireEvent.pointerDown(a, { pointerId: 5 });
  expect((touch.reading()?.buttons ?? 0) & BUTTON.A).toBe(BUTTON.A);
  fireEvent.lostPointerCapture(a, { pointerId: 5 });
  expect(touch.reading()).toBeNull();
});

it("une annulation ou une capture perdue relâche aussi la croix", () => {
  const { container, touch } = poser();
  const croix = container.querySelector("#touch-croix") as HTMLElement;
  croix.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
  fireEvent.pointerDown(croix, { clientX: 50, clientY: 5, pointerId: 6 });
  expect(touch.reading()?.buttons).toBe(BUTTON.D_UP);
  fireEvent.pointerCancel(croix, { pointerId: 6 });
  expect(touch.reading()).toBeNull();
  expect(croix.hasAttribute("data-up")).toBe(false);
  fireEvent.pointerDown(croix, { clientX: 95, clientY: 50, pointerId: 7 });
  expect(touch.reading()?.buttons).toBe(BUTTON.D_RIGHT);
  fireEvent.lostPointerCapture(croix, { pointerId: 7 });
  expect(touch.reading()).toBeNull();
  expect(croix.hasAttribute("data-right")).toBe(false);
});

it("quitter l'onglet relâche une touche tenue, et la croix éteint sa branche", () => {
  const { container, touch } = poser();
  fireEvent.pointerDown(container.querySelector("#touch-B") as HTMLElement, { pointerId: 8 });
  expect((touch.reading()?.buttons ?? 0) & BUTTON.B).toBe(BUTTON.B);
  window.dispatchEvent(new Event("blur"));
  expect(touch.reading()).toBeNull();
  const croix = container.querySelector("#touch-croix") as HTMLElement;
  croix.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 }) as DOMRect;
  fireEvent.pointerDown(croix, { clientX: 50, clientY: 95, pointerId: 9 });
  expect(croix.hasAttribute("data-down")).toBe(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(touch.reading()).toBeNull();
  expect(croix.hasAttribute("data-down")).toBe(false);
});

it("la croix se nomme une fois, et ses flèches dessinées restent muettes", () => {
  // Un lecteur d'écran lisait « triangle noir pointant vers le haut » quatre
  // fois sous « croix directionnelle ». Les branches sont du dessin.
  const { container } = poser();
  const croix = container.querySelector("#touch-croix") as HTMLElement;
  expect(croix.getAttribute("aria-label")).toBe("croix directionnelle");
  const bras = [...croix.querySelectorAll("[data-bras]")];
  expect(bras).toHaveLength(4);
  for (const one of bras)
    expect(one.getAttribute("aria-hidden"), one.textContent ?? "").toBe("true");
});

it("« La salle » parmi les touches dit le libellé qu'on lui passe, et rien sans lui", () => {
  // L'emplacement promis au chantier personnes (« Lina · ta place ») : le
  // texte du geste et son nom accessible. Le jumeau : sans libellé, le geste
  // garde son icône seule et son nom de toujours.
  const avec = render(
    <TouchPad
      bar={0}
      touch={new Touch()}
      soundOff={false}
      onFeuille={vi.fn()}
      libelleSalle="Lina · ta place"
    />,
  );
  const geste = avec.container.querySelector("#laSalleManette") as HTMLElement;
  expect(geste.textContent).toContain("Lina · ta place");
  expect(geste.getAttribute("aria-label")).toMatch(/^Lina · ta place\. La salle/);
  avec.unmount();
  const sans = render(
    <TouchPad bar={0} touch={new Touch()} soundOff={false} onFeuille={vi.fn()} />,
  );
  const nu = sans.container.querySelector("#laSalleManette") as HTMLElement;
  expect(nu.textContent).toBe("");
  expect(nu.getAttribute("aria-label")).toBe("La salle : son, menu, places");
});
