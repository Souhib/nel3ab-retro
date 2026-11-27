/**
 * Une touche part tout de suite (ENT-9, audit du 27 novembre 2026).
 *
 * `keydown` ne faisait qu'ajouter la touche aux touches tenues : la trame
 * partait au tour suivant de la pompe, celui de la minuterie de 4 ms ou de
 * l'image d'écran suivante. Environ 1,5 ms d'attente en moyenne, 5 ms au pire
 * quand le navigateur espace ses minuteurs. Un doigt sur la manette tactile
 * attendait de même. La pompe tourne maintenant dès que ce qui est tenu
 * change. Les manettes physiques restent lues par la pompe : l'API Gamepad ne
 * donne aucun événement.
 *
 * Chaque essai lit la trame AVANT d'avancer les minuteurs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ZONE_JEU } from "../lib/focus-jeu";
import { InputStream } from "./input";
import { BUTTON } from "./pad";

let stream: InputStream;
const sent: Uint8Array[] = [];

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("navigator", { getGamepads: () => [] });
  document.body.innerHTML = `
    <main><div ${ZONE_JEU} tabindex="0" id="zone"><canvas id="image"></canvas></div></main>
    <aside><input id="pseudo" /></aside>`;
  stream = new InputStream(
    (path) => path,
    () => {},
    () => {},
    true,
  );
  stream.start();
  Object.assign(stream, {
    socket: { readyState: 1, send: (b: Uint8Array) => sent.push(b), close: () => {} },
    port: 1,
  });
  // Un tour de pompe, puis plus aucun minuteur : ce qui part ensuite est
  // parti tout de suite.
  vi.advanceTimersByTime(4);
  sent.length = 0;
});

afterEach(() => {
  stream.stop();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const $ = (id: string) => document.getElementById(id)!;
const boutons = () => {
  const last = sent.at(-1);
  return last ? last[0]! | (last[1]! << 8) : null;
};
const appui = (cible: EventTarget, code: string, repeat = false) =>
  cible.dispatchEvent(
    new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, repeat }),
  );

describe("le clavier", () => {
  it("envoie la trame d'une touche du jeu sans attendre la pompe", () => {
    appui($("zone"), "Enter");
    expect(sent.length, "la touche attend le tour suivant de la pompe").toBe(1);
    expect(boutons()! & BUTTON.START).toBe(BUTTON.START);
  });

  it("envoie aussi le relâché sans attendre", () => {
    appui($("zone"), "Enter");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Enter" }));
    expect(sent.length, "le relâché attend le tour suivant de la pompe").toBe(2);
    expect(boutons()! & BUTTON.START).toBe(0);
  });

  // Les jumeaux : une touche tapée dans un champ n'envoie rien, et la
  // répétition du clavier ne multiplie pas les envois.
  it("n'envoie rien pour une touche tapée dans un champ", () => {
    appui($("pseudo"), "KeyA");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
    expect(sent.length).toBe(0);
  });

  it("n'envoie qu'une trame pour une touche qui se répète", () => {
    appui($("zone"), "Enter");
    appui($("zone"), "Enter", true);
    appui($("zone"), "Enter", true);
    expect(sent.length).toBe(1);
  });
});

describe("la manette à l'écran", () => {
  it("envoie la trame d'un doigt posé sans attendre la pompe", () => {
    stream.touch.press("A");
    expect(sent.length, "le doigt attend le tour suivant de la pompe").toBe(1);
    expect(boutons()! & BUTTON.A).toBe(BUTTON.A);
    stream.touch.release("A");
    expect(sent.length).toBe(2);
    expect(boutons()! & BUTTON.A).toBe(0);
  });

  it("envoie la trame Pro d'un doigt posé sans attendre la pompe", () => {
    Object.assign(stream, { source: stream.switch });
    // Ce que fait le pavé Pro (`SwitchTouchPad`) : il pose la touche, puis
    // le dit. Une page d'avant n'a pas `signaler` : la touche attend alors.
    const dire = () => (stream.switch as { signaler?: () => void }).signaler?.();
    stream.switch.touched.add("A");
    dire();
    expect(sent.length, "le doigt attend le tour suivant de la pompe").toBe(1);
    // La trame Pro : « S », version, place, puis trente-deux bits de boutons.
    const trame = sent.at(-1)!;
    expect(trame[0]).toBe(0x53);
    expect(new DataView(trame.buffer).getUint32(3, true)).not.toBe(0);
    stream.switch.touched.delete("A");
    dire();
    expect(new DataView(sent.at(-1)!.buffer).getUint32(3, true)).toBe(0);
  });
});
