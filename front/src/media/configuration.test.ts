import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputStream } from "./input";
import { BUTTON, standardProfile } from "./pad";

describe("configurer une manette pendant une partie", () => {
  let stream: InputStream;
  let pad: Gamepad;
  let connected: (Gamepad | null)[];
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const sent: Uint8Array[] = [];

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    pad = {
      id: "test pad",
      index: 0,
      mapping: "standard",
      connected: true,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0],
      timestamp: 0,
    } as unknown as Gamepad;
    connected = [pad];
    vi.stubGlobal("navigator", { getGamepads: () => connected });
    stream = new InputStream(
      (path) => path,
      () => {},
      () => {},
      true,
    );
    stream.start();
    sent.length = 0;
    // Le vrai pump écrit sur cette socket; aucun réseau ni Dolphin ne tourne.
    Object.assign(stream, {
      socket: { readyState: 1, send: (b: Uint8Array) => sent.push(b), close: () => {} },
      port: 1,
    });
    tick();
  });

  const tick = () => vi.advanceTimersByTime(4);
  const press = (index: number, value = 1) => {
    Object.assign(pad.buttons[index]!, { value, pressed: value > 0.5 });
    tick();
  };

  afterEach(() => {
    stream.stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("charger un profil restaure les boutons et le clavier sur cette manette standard", () => {
    const profile = standardProfile("une autre DualSense");
    profile.buttons.A = { button: 3, rest: 0 };
    const before = structuredClone(stream.state().keys);
    stream.applySetup("Kart", {
      kind: 1,
      device: profile.id,
      standard: true,
      pad: profile,
      keys: { KeyQ: { kind: "button", name: "B" } },
    });
    expect(stream.state().profile?.id).toBe(pad.id);
    expect(stream.state().profile?.buttons.A).toEqual({ button: 3, rest: 0 });
    expect(stream.state().keys).toEqual({ KeyQ: { kind: "button", name: "B" } });
    expect(stream.keyProfileNamed("défaut")).toEqual(before);
    const kept = structuredClone(stream.state().profile);
    expect(() =>
      stream.applySetup("Adaptateur", {
        kind: 0,
        device: "adaptateur inconnu",
        standard: false,
        pad: null,
        keys: {},
      }),
    ).toThrow(/Branche/);
    expect(stream.state().profile).toEqual(kept);
    expect(stream.state().keys.KeyQ).toEqual({ kind: "button", name: "B" });
  });

  it("la préparation laisse tester la manette sans envoyer ses boutons au jeu", () => {
    stream.blockGameplay(true);
    press(0);
    expect(stream.readPadNow(pad).buttons & BUTTON.A).not.toBe(0);
    expect(sent.at(-1)?.slice(0, 2)).toEqual(new Uint8Array([0, 0]));
    stream.blockGameplay(false);
    press(0, 0);
    press(0);
    expect(sent.at(-1)?.[0]).toBe(BUTTON.A);
  });

  it("arrête aussi la boucle d'affichage, pas seulement les minuteurs", () => {
    expect(frames.size).toBe(1);
    stream.stop();
    expect(frames.size).toBe(0);
    const count = sent.length;
    tick();
    expect(sent).toHaveLength(count);
  });

  it("Échap annule une capture de manette", () => {
    stream.beginCapture("A", "pad");
    expect(stream.state().capturing).not.toBeNull();
    dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));
    expect(stream.state().capturing).toBeNull();
    expect(stream.state().profile).toBeNull();
  });

  it("un bouton ne valide pas une question qui attend un axe", () => {
    stream.beginCapture("x", "pad");
    press(0);
    expect(stream.state().capturing?.control).toBe("x");
    press(0, 0);
    (pad.axes as number[])[2] = 1;
    tick();
    expect(stream.state().capturing).toBeNull();
    expect(stream.state().profile?.sticks.x?.axis).toBe(2);
  });

  it("une réassignation conserve le repos mesuré du stick", () => {
    (pad.axes as number[])[2] = 0.3;
    stream.beginCapture("x", "pad");
    (pad.axes as number[])[2] = 1;
    tick();
    expect(stream.state().profile?.sticks.x).toEqual({ axis: 2, sign: 1, rest: 0.3 });
    (pad.axes as number[])[2] = 0.3;
    tick();
    expect(stream.readPadNow(pad).x).toBe(0);
  });

  it("ne devine pas quinze commandes standard sur un adaptateur inconnu", () => {
    Object.assign(pad, { mapping: "" });
    tick();
    stream.beginCapture("A", "pad");
    press(3);
    const profile = stream.state().profile;
    expect(profile?.buttons.A).toEqual({ button: 3, rest: 0 });
    expect(profile?.buttons.B).toBeUndefined();
    expect(profile?.sticks).toEqual({});
  });

  it("garde les commandes du constructeur quand une manette standard est personnalisée", () => {
    stream.beginCapture("A", "pad");
    press(3);
    expect(stream.state().profile?.buttons.B).toEqual(standardProfile(pad.id).buttons.B);
  });

  it("attend le relâchement après l'assignation avant de rendre la main au jeu", () => {
    stream.beginCapture("A", "pad");
    press(0);
    expect(stream.state().capturing).toBeNull();
    tick();
    expect(stream.lastSent()?.buttons).toBe(0);
    press(0, 0);
    press(0);
    expect(stream.lastSent()?.buttons).toBe(BUTTON.A);
  });

  it("assigne séparément les deux directions d'un axe au clavier", () => {
    stream.beginCapture("x", "key", -1);
    dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", key: "v" }));
    dispatchEvent(new KeyboardEvent("keyup", { code: "KeyV", key: "v" }));
    dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", key: "v" }));
    tick();
    expect(stream.lastSent()?.x).toBe(-1);
    dispatchEvent(new KeyboardEvent("keyup", { code: "KeyV", key: "v" }));
    tick();
    expect(stream.lastSent()?.x).toBe(0);
  });

  it.each([
    ["ArrowLeft", "x", -1],
    ["ArrowRight", "x", 1],
    ["ArrowUp", "y", 1],
    ["ArrowDown", "y", -1],
  ] as const)("réassigne %s au stick sans changer la croix", (code, axis, sign) => {
    stream.beginCapture(axis, "key", sign);
    dispatchEvent(new KeyboardEvent("keydown", { code }));
    expect(stream.state().keys[code]).toEqual({ kind: "stick", stick: axis, sign });
    dispatchEvent(new KeyboardEvent("keyup", { code }));
    dispatchEvent(new KeyboardEvent("keydown", { code }));
    tick();
    expect(stream.lastSent()?.[axis]).toBe(sign);
    expect(stream.lastSent()?.buttons).toBe(0);
    dispatchEvent(new KeyboardEvent("keyup", { code }));
    tick();
    expect(stream.lastSent()?.[axis]).toBe(0);
  });

  it("une flèche assignée à la croix ne tourne pas le stick du Nunchuk", () => {
    stream.beginCapture("D_LEFT", "key");
    dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" }));
    dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    tick();
    expect(stream.lastSent()?.buttons).toBe(BUTTON.D_LEFT);
    expect(stream.lastSent()?.x).toBe(0);
  });

  it("laisse le clavier piloter les champs du configurateur hors capture", () => {
    const dialog = document.createElement("dialog");
    dialog.open = true;
    const select = document.createElement("select");
    dialog.append(select);
    document.body.append(dialog);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    select.dispatchEvent(event);
    dialog.remove();
    expect(event.defaultPrevented).toBe(false);
    tick();
    expect(stream.lastSent()?.buttons).toBe(0);
  });

  it("l'apprentissage libère immédiatement le dernier appui dans le jeu", () => {
    press(0);
    expect(stream.lastSent()?.buttons).toBe(BUTTON.A);
    stream.beginLesson();
    tick();
    expect(stream.lastSent()?.buttons).toBe(0);
  });

  it("annuler l'apprentissage rend les anciennes correspondances", () => {
    stream.beginLesson();
    expect(stream.state().learning).not.toBeNull();
    stream.cancelCapture();
    expect(stream.state().learning).toBeNull();
    expect(stream.state().profile).toBeNull();
  });

  it("un débranchement efface l'identité affichée et annule la capture", () => {
    stream.beginCapture("A", "pad");
    connected = [];
    tick();
    expect(stream.state().padId).toBeNull();
    expect(stream.state().profile).toBeNull();
    expect(stream.state().capturing).toBeNull();
  });

  it("réaffirme l'extension personnelle quand le worker attribue une nouvelle socket", () => {
    const messages: number[][] = [];
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      onmessage = (_event: { data: ArrayBuffer }) => {};
      constructor() {
        sockets.push(this);
      }
      send(bytes: Uint8Array) {
        messages.push([...bytes]);
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    stream.choosePad(2);
    stream.chooseExtension(1);
    stream.take(1);
    expect(sockets).toHaveLength(1);
    sockets[0].onmessage({ data: new Uint8Array([4, 1, 1, 1, 0, 0, 0]).buffer });
    expect(messages).toContainEqual([4, 1]);
    messages.length = 0;
    sockets[0].onmessage({ data: new Uint8Array([4, 1, 1, 1, 1, 0, 0]).buffer });
    expect(messages).toEqual([]);
    stream.choosePad(1);
    stream.chooseExtension(0);
    messages.length = 0;
    stream.take(1);
    expect(sockets).toHaveLength(2);
    sockets[1].onmessage({ data: new Uint8Array([4, 1, 1, 1, 0, 0, 0]).buffer });
    expect(messages).toContainEqual([4, 0]);
  });

  it("un profil stocké de forme invalide ne casse pas la boucle d'entrée", () => {
    stream.stop();
    localStorage.setItem(`nel3ab.pad.${pad.id}`, JSON.stringify({ id: pad.id }));
    stream = new InputStream(
      (path) => path,
      () => {},
      () => {},
      true,
    );
    stream.start();
    expect(tick).not.toThrow();
    expect(stream.state().profile).toBeNull();
  });
});
