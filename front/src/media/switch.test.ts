import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultSwitchProfile,
  emptySwitch,
  encodeSwitch,
  readSwitch,
  readSwitchProfile,
  SwitchInput,
  SWITCH_BUTTONS,
} from "./switch";
function pad(mapping = "standard", index = 0): Gamepad {
  return {
    id: `pad ${index}`,
    index,
    connected: true,
    mapping,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 18 }, () => ({ value: 0, pressed: false, touched: false })),
  } as unknown as Gamepad;
}
const press = (p: Gamepad, index: number, value = 1) =>
  Object.assign(p.buttons[index], { value, pressed: value > 0.5 });
const bits = (source: SwitchInput) =>
  new DataView(source.frame(1, false).buffer).getUint32(3, true);
beforeEach(() => localStorage.clear());
describe("Switch gameplay and profiles", () => {
  it("freezes the Rust wire and preserves quarter-stick precision", () => {
    expect([
      ...encodeSwitch(3, {
        buttons: 0x8421,
        lx: 8192 / 32767,
        ly: -4096 / 32767,
        rx: -16384 / 32767,
        ry: 2048 / 32767,
      }),
    ]).toEqual([0x53, 1, 3, 0x21, 0x84, 0, 0, 0, 32, 0, 240, 0, 192, 0, 8]);
    expect(encodeSwitch(1, emptySwitch())).toHaveLength(15);
  });
  it.each(SWITCH_BUTTONS)("maps %s independently and releases it", (name) => {
    const p = pad();
    const index = SWITCH_BUTTONS.indexOf(name);
    press(p, index);
    expect(readSwitch(new Set(), defaultSwitchProfile(), p).buttons).toBe(1 << index);
    press(p, index, 0);
    expect(readSwitch(new Set(), defaultSwitchProfile(), p).buttons).toBe(0);
  });
  it("combines keyboard axes with the pad without saturation or phantom dpad", () => {
    const p = pad();
    (p.axes as number[])[0] = 0.25;
    (p.axes as number[])[3] = -0.5;
    const profile = defaultSwitchProfile();
    expect(readSwitch(new Set(), profile, p)).toEqual({
      buttons: 0,
      lx: 0.25,
      ly: 0,
      rx: 0,
      ry: 0.5,
    });
    expect(readSwitch(new Set(["ArrowLeft"]), profile, p).lx).toBe(-1);
    expect(readSwitch(new Set(["ArrowLeft"]), profile, p).buttons).toBe(0);
    expect(readSwitch(new Set(["ArrowLeft", "ArrowRight"]), profile, null).lx).toBe(0);
  });
  it("does not invent standard bindings for an unknown adapter", () => {
    const p = pad("");
    press(p, 0);
    expect(readSwitch(new Set(), defaultSwitchProfile(), p)).toEqual(emptySwitch());
  });
  it("captures a button, waits for release and keeps the other standard buttons", () => {
    const p = pad();
    const source = new SwitchInput();
    source.poll(new Set(), [p]);
    source.begin("R", "pad");
    press(p, 3);
    source.poll(new Set(), [p]);
    expect(source.capturing).toBeNull();
    expect(source.device()?.buttons.R).toEqual({ button: 3, rest: 0 });
    expect(bits(source)).toBe(0);
    press(p, 3, 0);
    source.poll(new Set(), [p]);
    press(p, 3);
    source.poll(new Set(), [p]);
    expect(bits(source) & (1 << 5)).not.toBe(0);
    expect(source.device()?.buttons.L).toEqual({ button: 4, rest: 0 });
    expect(new DataView(source.frame(1, true).buffer).getUint32(3, true)).toBe(0);
  });
  it("asks for an axis, ignores a button and retains measured rest and sign", () => {
    const p = pad("");
    const source = new SwitchInput();
    (p.axes as number[])[2] = 0.25;
    source.poll(new Set(), [p]);
    source.begin("ly+", "pad");
    press(p, 0);
    source.poll(new Set(), [p]);
    expect(source.capturing).not.toBeNull();
    press(p, 0, 0);
    (p.axes as number[])[2] = -1;
    source.poll(new Set(), [p]);
    expect(source.device()?.sticks.ly).toEqual({ axis: 2, sign: -1, rest: 0.25 });
    expect(source.device()?.buttons).toEqual({});
    (p.axes as number[])[2] = 0.25;
    source.poll(new Set(), [p]);
    expect(source.reading.ly).toBe(0);
  });
  it("cancels unplugged capture and does not transfer selection to another pad", () => {
    const a = pad(),
      b = pad("standard", 1),
      source = new SwitchInput();
    source.selected = 0;
    source.poll(new Set(), [a, b]);
    source.begin("A", "pad");
    press(b, 0);
    source.poll(new Set(), [b]);
    expect(source.capturing).toBeNull();
    expect(source.pad).toBeNull();
    expect(bits(source)).toBe(0);
    source.poll(new Set(), [a, b]);
    expect(source.pad?.id).toBe(a.id);
    expect(bits(source)).toBe(0);
  });
  it("moves a keyboard arrow from the stick to the requested command", () => {
    const source = new SwitchInput();
    source.begin("A", "key");
    expect(source.captureKey(new KeyboardEvent("keydown", { code: "ArrowLeft" }))).toBe(true);
    source.poll(new Set(["ArrowLeft"]), []);
    expect(source.reading).toEqual({ ...emptySwitch(), buttons: 1 });
    source.begin("B", "key");
    source.captureKey(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(source.profile.keys.B).toBe("KeyC");
  });
  it("persists distinct named profiles, restores them and supports transfer", () => {
    const source = new SwitchInput();
    source.save("Tennis");
    source.begin("R", "key");
    source.captureKey(new KeyboardEvent("keydown", { code: "KeyV" }));
    source.save("Course");
    const next = new SwitchInput();
    expect(next.profile.keys.R).toBe("KeyV");
    next.load("Tennis");
    expect(next.profile.keys.R).toBe("KeyF");
    next.load("Course");
    expect(next.profile.keys.R).toBe("KeyV");
    const foreign = new SwitchInput();
    foreign.import(JSON.stringify(next.profile));
    expect(foreign.profile).toEqual(next.profile);
    expect(() => next.load("absent")).toThrow();
    expect(() => next.import('{"version":1,"console":"dolphin"}')).toThrow();
    expect(next.profile.keys.R).toBe("KeyV");
  });
  it("rejects corrupt, foreign, conflicting and out of range profiles", () => {
    const valid = defaultSwitchProfile();
    expect(readSwitchProfile(valid)).toEqual(valid);
    for (const bad of [
      null,
      [],
      {},
      { ...valid, console: "gamecube" },
      { ...valid, keys: { A: "ArrowLeft", B: "ArrowLeft" } },
      { ...valid, keys: { A: "Escape" } },
      {
        ...valid,
        devices: { bad: { standard: true, buttons: { A: { button: -1 } }, sticks: {} } },
      },
      {
        ...valid,
        devices: { bad: { standard: true, buttons: {}, sticks: { lx: { axis: 0, sign: 0 } } } },
      },
    ])
      expect(readSwitchProfile(bad)).toBeNull();
    localStorage.setItem("nel3ab:switch-profiles:1", "broken");
    expect(new SwitchInput().profile).toEqual(valid);
  });
  it("reports a storage refusal while preserving the usable session profile", () => {
    const source = new SwitchInput();
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    try {
      expect(() => source.save("Tennis")).toThrow(/active.*enregistrer/);
      expect(source.named.Tennis).toEqual(source.profile);
    } finally {
      write.mockRestore();
    }
    expect(() => source.save("Tennis")).not.toThrow();
  });
  it("announces cancellation and clearing stops the pending capture", () => {
    const source = new SwitchInput();
    source.begin("R", "key");
    source.captureKey(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(source.message).toMatch(/annulée/);
    source.begin("A", "key");
    source.clear("A", "key");
    expect(source.capturing).toBeNull();
    expect(source.profile.keys.A).toBeUndefined();
  });
  it("does not swallow the first new press after closing at rest", () => {
    const source = new SwitchInput();
    source.poll(new Set(), []);
    source.releaseBeforePlay();
    source.poll(new Set(["KeyX"]), []);
    expect(bits(source)).toBe(1);
  });
  it("waits for neutral after closing configuration, then resumes new presses", () => {
    const p = pad(),
      source = new SwitchInput();
    press(p, 0);
    source.poll(new Set(), [p]);
    source.releaseBeforePlay();
    source.poll(new Set(), [p]);
    expect(bits(source)).toBe(0);
    press(p, 0, 0);
    source.poll(new Set(), [p]);
    press(p, 0);
    source.poll(new Set(), [p]);
    expect(bits(source)).toBe(1);
  });
});

it("touch controls use Switch targets independently from the player's keyboard profile", () => {
  const source = new SwitchInput();
  source.profile.keys = {};
  source.touched.add("A");
  source.touched.add("lx-");
  source.poll(new Set(), []);
  expect(source.reading.buttons).toBe(1);
  expect(source.reading.lx).toBe(-1);
  source.touched.add("lx+");
  source.poll(new Set(), []);
  expect(source.reading.lx).toBe(0);
  expect([...source.frame(1, true).slice(3)]).toEqual(Array(12).fill(0));
  source.touched.clear();
  source.poll(new Set(), []);
  expect(source.reading).toEqual(emptySwitch());
});
