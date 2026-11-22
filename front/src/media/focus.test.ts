/**
 * La vraie boucle d'entrée et le focus (audit A11Y-01).
 *
 * Le défaut, mesuré le 22 novembre 2026: Entrée sur un bouton de la colonne
 * partait au jeu comme START, et le bouton ne s'activait pas, parce que la
 * boucle appelait `preventDefault` sur toute touche liée. Ces essais conduisent
 * la vraie boucle sur une socket simulée et lisent la trame envoyée.
 *
 * Chaque essai qui garde une touche à la page a son jumeau qui l'envoie au jeu:
 * une correction qui couperait le clavier de la partie passerait sinon.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ZONE_JEU } from "../lib/focus-jeu";
import { InputStream } from "./input";
import { BUTTON } from "./pad";

describe("le clavier, le jeu et la page", () => {
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
      <aside><button id="details">détails</button></aside>`;
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
    sent.length = 0;
  });

  afterEach(() => {
    stream.stop();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const tick = () => vi.advanceTimersByTime(4);
  const boutons = () => {
    const last = sent.at(-1);
    return last ? last[0]! | (last[1]! << 8) : null;
  };
  const stickX = () => {
    const last = sent.at(-1);
    return last ? new DataView(last.buffer).getInt16(3, true) : null;
  };
  const touche = (cible: EventTarget, code: string, key = code) => {
    const event = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true });
    cible.dispatchEvent(event);
    tick();
    return event;
  };
  const $ = (id: string) => document.getElementById(id)!;

  it("Entrée sur un bouton de la colonne reste au bouton et n'envoie pas START", () => {
    const appui = touche($("details"), "Enter");
    expect(appui.defaultPrevented).toBe(false);
    expect(boutons()! & BUTTON.START).toBe(0);
  });

  it("Entrée dans la zone de jeu envoie START", () => {
    const appui = touche($("image"), "Enter");
    expect(appui.defaultPrevented).toBe(true);
    expect(boutons()! & BUTTON.START).toBe(BUTTON.START);
  });

  it("Entrée quand personne n'a le focus envoie START aussi", () => {
    // Un clic sur un texte de la colonne laisse le focus au document.
    touche(document.body, "Enter");
    expect(boutons()! & BUTTON.START).toBe(BUTTON.START);
  });

  it("une flèche sur un bouton ne pousse pas le stick, dans la zone si", () => {
    const dehors = touche($("details"), "ArrowRight");
    expect(dehors.defaultPrevented).toBe(false);
    expect(stickX()).toBe(0);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    const dedans = touche($("zone"), "ArrowRight");
    expect(dedans.defaultPrevented).toBe(true);
    expect(stickX()).toBe(32767);
  });

  it("quitter la zone pour un bouton relâche ce qui était tenu", () => {
    // Sans ça, une flèche tenue au moment d'un Tab garde le personnage en
    // marche tant que la touche n'est pas relâchée, focus ailleurs.
    touche($("zone"), "ArrowRight");
    expect(stickX()).toBe(32767);
    $("details").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    tick();
    expect(stickX()).toBe(0);
  });

  it("revenir dans la zone ne relâche rien", () => {
    // Le jumeau: le focus qui ARRIVE dans la zone ne doit pas couper un appui.
    touche($("zone"), "ArrowRight");
    $("zone").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    tick();
    expect(stickX()).toBe(32767);
  });
});
