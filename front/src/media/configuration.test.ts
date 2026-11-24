import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputStream } from "./input";
import { BUTTON, standardProfile } from "./pad";
import { SwitchInput } from "./switch";
import { ROOM_MARK } from "../lib/keys";

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

  it("refuse Ctrl, Alt et Méta comme touche de jeu et attend la suivante", () => {
    // Ctrl tenue avec W fermerait l'onglet en pleine partie, et Ctrl seule
    // replie la colonne de la page.
    stream.beginCapture("A", "key");
    for (const [code, key, flag] of [
      ["ControlLeft", "Control", "ctrlKey"],
      ["AltLeft", "Alt", "altKey"],
      ["MetaLeft", "Meta", "metaKey"],
    ] as const) {
      dispatchEvent(new KeyboardEvent("keydown", { code, key, [flag]: true }));
      expect(stream.state().keys[code]).toBeUndefined();
    }
    expect(stream.state().capturing).not.toBeNull();
    dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", key: "m" }));
    expect(stream.state().keys.KeyM).toBeDefined();
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

  /** Répond A sur `index`, puis passe toutes les autres étapes. */
  const aSeulement = (index: number) => {
    stream.beginLesson();
    press(index);
    press(index, 0);
    const total = stream.state().lesson?.total ?? 0;
    expect(total).toBe(16);
    for (let etape = 1; etape < total; etape += 1) stream.skipLessonStep();
    expect(stream.state().lesson).toBeNull();
  };

  // Constat C4 du chantier manettes (23 novembre 2026) : `Lesson.skip` ne
  // notait rien, la fin remplaçait tout le profil par les seules réponses, et
  // `readPad` ne retombe pas sur la disposition standard quand un profil
  // existe. Passer B pour « le garder » l'effaçait.
  it("une commande passée pendant le pas à pas garde son réglage d'avant", () => {
    stream.beginCapture("B", "pad");
    press(5);
    press(5, 0);
    expect(stream.state().profile?.buttons.B).toEqual({ button: 5, rest: 0 });
    aSeulement(2);
    press(5);
    expect(stream.readPadNow(pad).buttons & BUTTON.B).not.toBe(0);
  });

  it("une commande passée garde la disposition standard d'une manette sans profil", () => {
    aSeulement(2);
    press(1);
    expect(stream.readPadNow(pad).buttons & BUTTON.B).not.toBe(0);
  });

  it("une commande répondue prend le nouvel indice et quitte l'ancien", () => {
    aSeulement(2);
    press(0);
    expect(stream.readPadNow(pad).buttons & BUTTON.A).toBe(0);
    press(0, 0);
    press(2);
    expect(stream.readPadNow(pad).buttons & BUTTON.A).not.toBe(0);
    expect(stream.state().lessonResult?.retenues).toBe(1);
    expect(stream.state().lessonResult?.passees).toHaveLength(15);
    expect(stream.state().lessonResult?.passees[0]).toBe("B");
    expect(stream.state().lessonResult?.garde).toBe("standard");
  });

  it("tout passer ne change pas le profil d'avant", () => {
    stream.beginCapture("B", "pad");
    press(5);
    press(5, 0);
    const avant = structuredClone(stream.state().profile);
    const ecrit = localStorage.getItem(`nel3ab.pad.${pad.id}`);
    stream.beginLesson();
    for (let etape = 0; etape < 16; etape += 1) stream.skipLessonStep();
    expect(stream.state().lesson).toBeNull();
    expect(stream.state().profile).toEqual(avant);
    expect(localStorage.getItem(`nel3ab.pad.${pad.id}`)).toBe(ecrit);
    expect(stream.state().lessonResult?.retenues).toBe(0);
    expect(stream.state().lessonResult?.passees).toHaveLength(16);
    expect(stream.state().lessonResult?.garde).toBe("avant");
  });

  it("sur un adaptateur sans profil, une commande passée reste sans réglage", () => {
    Object.assign(pad, { mapping: "" });
    tick();
    aSeulement(2);
    expect(stream.state().profile?.buttons.A).toEqual({ button: 2, rest: 0 });
    expect(stream.state().profile?.buttons.B).toBeUndefined();
    expect(stream.state().lessonResult?.garde).toBe("rien");
  });

  it("expose aux dessins le repos pris au début de la leçon, et seulement pendant", () => {
    Object.assign(pad, { mapping: "" });
    Object.assign(pad.buttons[6]!, { value: 0.62, pressed: true });
    tick();
    expect(stream.state().neutre).toBeNull();
    stream.beginLesson();
    expect(stream.state().neutre?.buttons[6]).toBe(0.62);
    stream.cancelCapture();
    expect(stream.state().neutre).toBeNull();
    stream.beginCapture("A", "pad");
    expect(stream.state().neutre?.buttons[6]).toBe(0.62);
  });

  it("l'instantané dit ce que la trame Dolphin envoyée presse (K34)", () => {
    press(0);
    (pad.axes as number[])[0] = 1;
    tick();
    expect([...stream.state().activite.actives].sort()).toEqual(["A", "x"]);
    expect(stream.state().activite.suivies.has("cy")).toBe(true);
    // Le jumeau : pendant un réglage, la trame part neutre et rien ne s'allume.
    stream.blockGameplay(true);
    tick();
    expect(stream.state().activite.actives.size).toBe(0);
  });

  it("l'instantané dit ce que la trame Pro envoyée presse (K34)", () => {
    stream.stop();
    const pro = new SwitchInput();
    stream = new InputStream(
      (path) => path,
      () => {},
      () => {},
      true,
      pro,
    );
    stream.start();
    Object.assign(stream, {
      socket: { readyState: 1, send: (b: Uint8Array) => sent.push(b), close: () => {} },
      port: 1,
    });
    press(0);
    (pad.axes as number[])[1] = -1;
    tick();
    expect([...stream.state().activite.actives].sort()).toEqual(["A", "ly+"]);
    expect(stream.state().activite.suivies.has("ZL")).toBe(true);
    expect(stream.state().activite.suivies.has("Z")).toBe(false);
    stream.blockGameplay(true);
    tick();
    expect(stream.state().activite.actives.size).toBe(0);
  });

  /** Répond aux quatre premières étapes sur b0 à b3. */
  const quatreReponses = () => {
    for (const index of [0, 1, 2, 3]) {
      press(index);
      press(index, 0);
    }
    expect(stream.state().lesson?.step).toBe(5);
  };

  // Constat C5 du plan manettes : le débranchement annulait la leçon, et
  // « Reprendre à l'étape 5 » n'avait rien à reprendre.
  it("un débranchement suspend le pas à pas sans rien écrire", () => {
    stream.beginCapture("B", "pad");
    press(5);
    press(5, 0);
    const avant = structuredClone(stream.state().profile);
    stream.beginLesson();
    quatreReponses();
    connected = [];
    tick();
    expect(stream.state().lesson).toBeNull();
    expect(stream.state().suspendu).toEqual({ etape: 5, total: 16, id: pad.id });
    connected = [pad];
    tick();
    expect(stream.state().profile).toEqual(avant);
    expect(stream.reprendreLecon()).toBe(true);
    expect(stream.state().suspendu).toBeNull();
    expect(stream.state().lesson?.step).toBe(5);
    for (let etape = 5; etape <= 16; etape += 1) stream.skipLessonStep();
    const appris = stream.state().profile;
    expect(appris?.buttons.A).toEqual({ button: 0, rest: 0 });
    expect(appris?.buttons.Y).toEqual({ button: 3, rest: 0 });
    // Z, passée après la reprise, garde le réglage d'avant.
    expect(appris?.buttons.Z).toEqual(avant?.buttons.Z);
  });

  it("« D'accord » oublie la suspension et garde le profil d'avant", () => {
    stream.beginLesson();
    quatreReponses();
    connected = [];
    tick();
    connected = [pad];
    tick();
    stream.oublierSuspension();
    expect(stream.state().suspendu).toBeNull();
    expect(stream.reprendreLecon()).toBe(false);
    expect(stream.state().lesson).toBeNull();
    expect(stream.state().profile).toBeNull();
  });

  it("une autre manette ne reprend pas le pas à pas d'une autre", () => {
    stream.beginLesson();
    quatreReponses();
    connected = [{ ...pad, id: "une autre manette" } as Gamepad];
    tick();
    expect(stream.state().suspendu?.id).toBe(pad.id);
    expect(stream.reprendreLecon()).toBe(false);
    expect(stream.state().lesson).toBeNull();
  });

  it("la boucle annonce chaque moment du pas à pas, hors de React", () => {
    const vus: string[] = [];
    const finir = stream.surReglage((e) =>
      vus.push(
        e.type === "etape"
          ? `etape ${e.etape}/${e.total} ${e.control}`
          : e.type === "recu"
            ? `recu ${e.control} ${e.indice}`
            : e.type === "fin"
              ? `fin ${e.resultat.retenues}`
              : e.type,
      ),
    );
    stream.beginLesson();
    press(2);
    press(2);
    press(2, 0);
    stream.skipLessonStep();
    for (let etape = 3; etape <= 16; etape += 1) stream.skipLessonStep();
    expect(vus.slice(0, 5)).toEqual([
      "etape 1/16 A",
      "recu A b2",
      "etape 2/16 B",
      "relache",
      "etape 3/16 X",
    ]);
    expect(vus.at(-1)).toBe("fin 1");
    expect(vus.filter((v) => v.startsWith("recu"))).toHaveLength(1);
    // Le jumeau : une fois désabonné, plus rien n'arrive.
    finir();
    stream.beginLesson();
    expect(vus.at(-1)).toBe("fin 1");
  });

  it("la boucle annonce une réassignation reçue et une suspension", () => {
    const vus: string[] = [];
    stream.surReglage((e) =>
      vus.push(e.type === "recu" ? `recu ${e.control} ${e.indice}` : e.type),
    );
    stream.beginCapture("x", "pad");
    (pad.axes as number[])[2] = -1;
    tick();
    expect(vus).toEqual(["recu x a2-"]);
    (pad.axes as number[])[2] = 0;
    tick();
    stream.beginLesson();
    connected = [];
    tick();
    expect(vus.at(-1)).toBe("suspendu");
  });

  it("un abonné qui lève ne casse pas la boucle", () => {
    stream.surReglage(() => {
      throw new Error("abonné cassé");
    });
    expect(() => stream.beginLesson()).not.toThrow();
    expect(stream.state().lesson?.step).toBe(1);
  });

  it("la première manette vue par la page s'annonce une seule fois", () => {
    stream.stop();
    connected = [];
    stream = new InputStream(
      (path) => path,
      () => {},
      () => {},
      true,
    );
    const vus: string[] = [];
    stream.surReglage((e) => vus.push(e.type === "premiere-manette" ? `premiere ${e.id}` : e.type));
    stream.start();
    tick();
    expect(vus).toEqual([]);
    connected = [pad];
    tick();
    connected = [];
    tick();
    connected = [pad, { ...pad, id: "deuxième", index: 1 } as Gamepad];
    tick();
    expect(vus).toEqual([`premiere ${pad.id}`]);
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
    sockets[0].onmessage({ data: new Uint8Array([4, 1, 1, 0, 1, 0, 0, 0, 0]).buffer });
    expect(messages).toContainEqual([4, 1]);
    messages.length = 0;
    sockets[0].onmessage({ data: new Uint8Array([4, 1, 1, 0, 1, 1, 0, 0, 0]).buffer });
    expect(messages).toEqual([]);
    stream.choosePad(1);
    stream.chooseExtension(0);
    messages.length = 0;
    stream.take(1);
    expect(sockets).toHaveLength(2);
    sockets[1].onmessage({ data: new Uint8Array([4, 1, 1, 0, 1, 0, 0, 0, 0]).buffer });
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

describe("rendre un profil du clavier supprimé", () => {
  it("le remet tel qu'il était, en service s'il l'était", () => {
    const stream = new InputStream(
      () => "",
      () => {},
    );
    stream.newKeys("Course");
    const profil = stream.keyProfileNamed("Course")!;
    stream.forgetKeys("Course");
    expect(stream.state().keyProfiles).not.toContain("Course");
    stream.rendreKeys("Course", profil, true);
    expect(stream.state().keyProfiles).toContain("Course");
    expect(stream.state().keyProfile).toBe("Course");
    expect(stream.keyProfileNamed("Course")).toEqual(profil);
  });

  it("n'écrase pas un nom repris entre-temps, et refuse le préfixe de la salle", () => {
    const stream = new InputStream(
      () => "",
      () => {},
    );
    stream.newKeys("Course");
    const profil = stream.keyProfileNamed("Course")!;
    const avant = stream.state().keyProfiles;
    // Un autre contenu sous le même nom : le profil en place ne bouge pas.
    stream.rendreKeys("Course", {}, false);
    expect(stream.keyProfileNamed("Course")).toEqual(profil);
    expect(stream.state().keyProfiles).toEqual(avant);
    stream.rendreKeys(`${ROOM_MARK}faux`, profil, true);
    expect(stream.state().keyProfiles).toEqual(avant);
    expect(stream.state().keyProfile).toBe("Course");
  });
});

describe("rendre un profil Pro supprimé", () => {
  it("le remet une fois, et n'écrase jamais un nom repris", () => {
    const source = new SwitchInput();
    source.save("Course");
    const profil = structuredClone(source.named["Course"]!);
    source.forget("Course");
    source.rendre("Course", profil);
    expect(source.named["Course"]).toEqual(profil);
    const autre = { ...profil, keys: { A: "KeyQ" } };
    source.rendre("Course", autre);
    expect(source.named["Course"]).toEqual(profil);
  });
});
