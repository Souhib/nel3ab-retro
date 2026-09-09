/** Switch normalization lives beside Dolphin's reader, outside React. The seat
 * and connection still belong to InputStream. No GameCube profile is re-used. */
import type { InputSource } from "./input-source";
import { Capture, snapshot, type Snapshot } from "./lesson";
import { centred, travel, DEAD_ZONE, type Control, type StickAxis } from "./pad";

// Frozen with protocol::switch. Home, capture and motion are not guest gameplay
// inputs in this prototype; offering them would advertise an unconnected button.
export const SWITCH_BUTTONS = [
  "A",
  "B",
  "X",
  "Y",
  "L",
  "R",
  "ZL",
  "ZR",
  "MINUS",
  "PLUS",
  "LS",
  "RS",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
] as const;
export const SWITCH_AXES = ["lx", "ly", "rx", "ry"] as const;
export type SwitchButton = (typeof SWITCH_BUTTONS)[number];
export type SwitchAxis = (typeof SWITCH_AXES)[number];
export type SwitchTarget = SwitchButton | `${SwitchAxis}+` | `${SwitchAxis}-`;
export const SWITCH_TARGETS: readonly SwitchTarget[] = [
  ...SWITCH_BUTTONS,
  ...SWITCH_AXES.flatMap((axis) => [`${axis}+`, `${axis}-`] as const),
];
export type SwitchReading = { buttons: number } & Record<SwitchAxis, number>;
export const emptySwitch = (): SwitchReading => ({ buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0 });
export type SwitchDevice = {
  standard: boolean;
  buttons: Partial<Record<SwitchButton, Control>>;
  sticks: Partial<Record<SwitchAxis, StickAxis>>;
};
export type SwitchProfile = {
  version: 1;
  console: "switch";
  keys: Partial<Record<SwitchTarget, string>>;
  devices: Record<string, SwitchDevice>;
};
export function defaultSwitchProfile(): SwitchProfile {
  return {
    version: 1,
    console: "switch",
    devices: {},
    keys: {
      A: "KeyX",
      B: "KeyC",
      X: "KeyS",
      Y: "KeyD",
      L: "KeyA",
      R: "KeyF",
      ZL: "KeyQ",
      ZR: "KeyE",
      MINUS: "Backspace",
      PLUS: "Enter",
      LS: "Digit1",
      RS: "Digit2",
      UP: "KeyT",
      DOWN: "KeyG",
      LEFT: "KeyR",
      RIGHT: "KeyY",
      "lx-": "ArrowLeft",
      "lx+": "ArrowRight",
      "ly+": "ArrowUp",
      "ly-": "ArrowDown",
      "rx-": "KeyJ",
      "rx+": "KeyL",
      "ry+": "KeyI",
      "ry-": "KeyK",
    },
  };
}
export function standardSwitchDevice(): SwitchDevice {
  // Browser standard positions. Labels in the editor explicitly say bottom,
  // right, left, top; Xbox lettering is not silently presented as Nintendo's.
  const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  return {
    standard: true,
    buttons: Object.fromEntries(
      SWITCH_BUTTONS.map((name, i) => [name, { button: positions[i], rest: 0 }]),
    ),
    sticks: {
      lx: { axis: 0, sign: 1 },
      ly: { axis: 1, sign: -1 },
      rx: { axis: 2, sign: 1 },
      ry: { axis: 3, sign: -1 },
    },
  };
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const index = (v: unknown) => bounded(v, 0, 255) && Number.isInteger(v);
function control(value: unknown): boolean {
  if (!object(value)) return false;
  if ("button" in value)
    return index(value.button) && (value.rest === undefined || bounded(value.rest, 0, 1));
  return (
    index(value.axis) &&
    bounded(value.rest, -1, 1) &&
    bounded(value.full, -1, 1) &&
    value.rest !== value.full
  );
}
/** Bound imported files and reject foreign profiles before changing anything. */
export function readSwitchProfile(value: unknown): SwitchProfile | null {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.console !== "switch" ||
    !object(value.keys) ||
    !object(value.devices)
  )
    return null;
  if (
    Object.entries(value.keys).some(
      ([key, code]) =>
        !SWITCH_TARGETS.includes(key as SwitchTarget) ||
        typeof code !== "string" ||
        !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(code) ||
        code === "Escape" ||
        code === "Tab",
    )
  )
    return null;
  const codes = Object.values(value.keys);
  if (new Set(codes).size !== codes.length || Object.keys(value.devices).length > 16) return null;
  for (const [id, device] of Object.entries(value.devices)) {
    if (
      !id ||
      id.length > 512 ||
      !object(device) ||
      typeof device.standard !== "boolean" ||
      !object(device.buttons) ||
      !object(device.sticks)
    )
      return null;
    if (
      Object.entries(device.buttons).some(
        ([name, binding]) => !SWITCH_BUTTONS.includes(name as SwitchButton) || !control(binding),
      )
    )
      return null;
    if (
      Object.entries(device.sticks).some(
        ([name, v]) =>
          !SWITCH_AXES.includes(name as SwitchAxis) ||
          !object(v) ||
          !index(v.axis) ||
          (v.sign !== 1 && v.sign !== -1) ||
          (v.rest !== undefined && !bounded(v.rest, -1, 1)),
      )
    )
      return null;
  }
  return structuredClone(value) as SwitchProfile;
}

export function encodeSwitch(port: number, reading: SwitchReading): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(15);
  const view = new DataView(bytes.buffer);
  bytes.set([0x53, 1, port]);
  view.setUint32(3, reading.buttons, true);
  SWITCH_AXES.forEach((axis, i) =>
    view.setInt16(7 + i * 2, Math.round(reading[axis] * 32767), true),
  );
  return bytes;
}
export function readSwitch(
  held: ReadonlySet<string>,
  profile: SwitchProfile,
  pad: Gamepad | null,
): SwitchReading {
  const reading = emptySwitch();
  const device = pad
    ? Object.hasOwn(profile.devices, pad.id)
      ? profile.devices[pad.id]
      : pad.mapping === "standard"
        ? standard
        : null
    : null;
  SWITCH_BUTTONS.forEach((name, bit) => {
    if (
      (profile.keys[name] && held.has(profile.keys[name])) ||
      (pad && device && travel(pad, device.buttons[name]) > 0.5)
    )
      reading.buttons |= 1 << bit;
  });
  SWITCH_AXES.forEach((axis) => {
    const positive = profile.keys[`${axis}+`];
    const negative = profile.keys[`${axis}-`];
    const key =
      Number(positive !== undefined && held.has(positive)) -
      Number(negative !== undefined && held.has(negative));
    const binding = device?.sticks[axis];
    const raw =
      pad && binding
        ? centred(pad.axes[binding.axis] ?? binding.rest ?? 0, binding) * binding.sign
        : 0;
    const analog = Math.abs(raw) < DEAD_ZONE ? 0 : raw;
    reading[axis] = Math.abs(key) >= Math.abs(analog) ? key : analog;
  });
  return reading;
}
const standard = standardSwitchDevice();
const STORAGE = "nel3ab:switch-profiles:1";
type CaptureState = { target: SwitchTarget; source: "key" | "pad"; machine?: Capture; id?: string };

export class SwitchInput implements InputSource {
  profile = defaultSwitchProfile();
  named: Record<string, SwitchProfile> = {};
  selected: number | null = null;
  pads: readonly Gamepad[] = [];
  reading = emptySwitch();
  raw: Snapshot | null = null;
  capturing: CaptureState | null = null;
  message = "";
  readonly previewKeys = new Set<string>();
  readonly touched = new Set<SwitchTarget>();
  private releasing: { id: string; machine: Capture } | null = null;
  private waitingForRest = false;

  private readonly saveAccount: ((text: string) => void) | undefined;
  constructor(saveAccount?: (text: string) => void) {
    this.saveAccount = saveAccount;
    try {
      const text = localStorage.getItem(STORAGE);
      if (!text || text.length > 200_000) return;
      const saved: unknown = JSON.parse(text);
      if (!object(saved)) return;
      this.profile = readSwitchProfile(saved.working) ?? defaultSwitchProfile();
      if (object(saved.named))
        for (const [name, value] of Object.entries(saved.named).slice(0, 24)) {
          const profile = readSwitchProfile(value);
          if (profile && name.trim() && name.length <= 64)
            Object.defineProperty(this.named, name, {
              value: profile,
              enumerable: true,
              configurable: true,
              writable: true,
            });
        }
    } catch {
      /* A private browser can still configure this session. */
    }
  }
  get pad(): Gamepad | null {
    return this.selected === null
      ? (this.pads[0] ?? null)
      : (this.pads.find((pad) => pad.index === this.selected) ?? null);
  }
  device(): SwitchDevice | null {
    const pad = this.pad;
    return pad
      ? Object.hasOwn(this.profile.devices, pad.id)
        ? this.profile.devices[pad.id]
        : pad.mapping === "standard"
          ? standard
          : null
      : null;
  }
  poll(held: ReadonlySet<string>, pads: readonly (Gamepad | null)[]): void {
    this.pads = pads.filter((pad): pad is Gamepad => pad !== null && pad.connected);
    const pad = this.pad;
    this.raw = pad ? snapshot(pad) : null;
    const capture = this.capturing;
    if (capture?.source === "pad") {
      if (!pad || pad.id !== capture.id) {
        this.cancel();
        this.message = "Manette débranchée : assignation annulée.";
      } else if (capture.machine) {
        const moved = capture.machine.feed(snapshot(pad));
        const axis = capture.target.slice(0, 2) as SwitchAxis;
        if (
          moved &&
          (SWITCH_BUTTONS.includes(capture.target as SwitchButton) || "axis" in moved.control)
        ) {
          const device = structuredClone(
            this.device() ?? { standard: false, buttons: {}, sticks: {} },
          );
          if (SWITCH_BUTTONS.includes(capture.target as SwitchButton))
            device.buttons[capture.target as SwitchButton] = moved.control;
          else if ("axis" in moved.control)
            device.sticks[axis] = {
              axis: moved.control.axis,
              sign:
                Math.sign(moved.value - moved.control.rest) *
                (capture.target.endsWith("+") ? 1 : -1),
              rest: moved.control.rest,
            };
          Object.defineProperty(this.profile.devices, pad.id, {
            value: device,
            enumerable: true,
            configurable: true,
            writable: true,
          });
          this.releasing = { id: pad.id, machine: capture.machine };
          this.capturing = null;
          this.message = "Commande assignée. Relâche le bouton ou le stick.";
          this.persist();
        }
      }
    }
    if (
      this.releasing &&
      (!pad || pad.id !== this.releasing.id || this.releasing.machine.feed(snapshot(pad)) === null)
    )
      this.releasing = null;
    this.reading = readSwitch(
      this.previewKeys.size ? new Set([...held, ...this.previewKeys]) : held,
      this.profile,
      pad,
    );
    // Touch labels are independent of the player's keyboard assignments.
    for (const button of SWITCH_BUTTONS)
      if (this.touched.has(button)) this.reading.buttons |= 1 << SWITCH_BUTTONS.indexOf(button);
    for (const axis of SWITCH_AXES) {
      if (this.touched.has(`${axis}+`) || this.touched.has(`${axis}-`))
        this.reading[axis] =
          Number(this.touched.has(`${axis}+`)) - Number(this.touched.has(`${axis}-`));
    }
    if (
      this.waitingForRest &&
      this.reading.buttons === 0 &&
      SWITCH_AXES.every((axis) => this.reading[axis] === 0)
    )
      this.waitingForRest = false;
  }
  frame(port: number, neutral: boolean): Uint8Array<ArrayBuffer> {
    return encodeSwitch(
      port,
      neutral || this.capturing !== null || this.releasing !== null || this.waitingForRest
        ? emptySwitch()
        : this.reading,
    );
  }
  handlesKey(code: string): boolean {
    return Object.values(this.profile.keys).includes(code);
  }
  captureKey(event: KeyboardEvent): boolean {
    if (!this.capturing) return false;
    if (event.code === "Escape") {
      this.cancel();
      return true;
    }
    if (this.capturing.source !== "key") return false;
    if (event.code === "Tab" || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
      return true;
    for (const target of SWITCH_TARGETS)
      if (this.profile.keys[target] === event.code) delete this.profile.keys[target];
    this.profile.keys[this.capturing.target] = event.code;
    this.capturing = null;
    this.message = "Touche assignée.";
    this.persist();
    return true;
  }
  begin(target: SwitchTarget, source: "key" | "pad"): void {
    this.cancel();
    if (source === "pad" && !this.pad) {
      this.message = "Branche une manette et appuie sur un bouton.";
      return;
    }
    this.capturing = {
      target,
      source,
      ...(source === "pad" && this.pad
        ? { machine: new Capture(snapshot(this.pad)), id: this.pad.id }
        : {}),
    };
    this.message =
      source === "key"
        ? "Appuie sur une touche. Échap pour annuler."
        : "Appuie sur un bouton ou déplace le stick demandé. Échap pour annuler.";
  }
  cancel(): void {
    if (this.capturing) this.message = "Assignation annulée.";
    this.capturing = null;
  }
  releaseBeforePlay(): void {
    this.previewKeys.clear();
    this.cancel();
    this.waitingForRest =
      this.reading.buttons !== 0 || SWITCH_AXES.some((axis) => this.reading[axis] !== 0);
  }
  clear(target: SwitchTarget, source: "key" | "pad"): void {
    this.cancel();
    if (source === "key") delete this.profile.keys[target];
    else if (this.pad) {
      const device = structuredClone(this.device() ?? { standard: false, buttons: {}, sticks: {} });
      if (SWITCH_BUTTONS.includes(target as SwitchButton))
        delete device.buttons[target as SwitchButton];
      else delete device.sticks[target.slice(0, 2) as SwitchAxis];
      Object.defineProperty(this.profile.devices, this.pad.id, {
        value: device,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    this.persist();
  }
  reset(): void {
    this.profile = defaultSwitchProfile();
    this.releaseBeforePlay();
    if (!this.persist()) throw new Error(this.message);
  }
  save(name: string): void {
    name = name.trim();
    if (!name || name.length > 64) throw new Error("Donne un nom de 1 à 64 caractères.");
    if (!Object.hasOwn(this.named, name) && Object.keys(this.named).length >= 24)
      throw new Error("24 profils sont déjà enregistrés.");
    Object.defineProperty(this.named, name, {
      value: structuredClone(this.profile),
      enumerable: true,
      configurable: true,
      writable: true,
    });
    if (!this.persist()) throw new Error(this.message);
  }
  load(name: string): void {
    if (!Object.hasOwn(this.named, name)) throw new Error("Ce profil n’existe pas.");
    this.profile = structuredClone(this.named[name]);
    this.releaseBeforePlay();
    if (!this.persist()) throw new Error(this.message);
  }
  import(text: string): void {
    if (text.length > 100_000) throw new Error("Le fichier est trop grand.");
    const profile = readSwitchProfile(JSON.parse(text));
    if (!profile) throw new Error("Ce fichier n’est pas un profil Switch valide.");
    this.profile = profile;
    this.releaseBeforePlay();
    if (!this.persist()) throw new Error(this.message);
  }
  private persist(): boolean {
    try {
      const text = JSON.stringify({ working: this.profile, named: this.named });
      // Match the read bound: a successful save must survive the next visit.
      if (text.length > 200_000 || !readSwitchProfile(this.profile))
        throw new Error("profile limit");
      this.saveAccount?.(text);
      localStorage.setItem(STORAGE, text);
      return true;
    } catch {
      this.message =
        "Configuration active, mais ce navigateur n’a pas pu l’enregistrer. Exporte le profil pour le garder.";
      return false;
    }
  }
}
