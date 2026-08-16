/**
 * The controller: keyboard, gamepad, and a profile the page learns.
 *
 * A real GameCube pad on its adapter announces an UNKNOWN layout: its buttons
 * sit at indices of its own and its triggers are AXES. The next adapter's will
 * differ again, so the page asks rather than shipping a table that is wrong for
 * the one nobody tested.
 */

export const BUTTON = {
  A: 1 << 0,
  B: 1 << 1,
  X: 1 << 2,
  Y: 1 << 3,
  Z: 1 << 4,
  L: 1 << 5,
  R: 1 << 6,
  START: 1 << 7,
  D_UP: 1 << 8,
  D_DOWN: 1 << 9,
  D_LEFT: 1 << 10,
  D_RIGHT: 1 << 11,
} as const;

export type ButtonName = keyof typeof BUTTON;

export const KEYS: Record<string, ButtonName> = {
  KeyX: "A",
  KeyC: "B",
  KeyS: "X",
  KeyD: "Y",
  KeyA: "Z",
  KeyQ: "L",
  KeyE: "R",
  Enter: "START",
};

/** The W3C "standard gamepad", which is what a browser reports for anything
 * Xbox- or PlayStation-shaped. What was here before wired four of them and
 * stopped: no D-pad, no C-stick, no analogue triggers, and `Z` on the LEFT
 * trigger, where no GameCube player's hand goes looking for it. */
const STANDARD: ReadonlyArray<readonly [number, ButtonName]> = [
  [0, "A"],
  [1, "B"],
  [2, "X"],
  [3, "Y"],
  [4, "L"],
  [5, "Z"],
  [9, "START"],
  [12, "D_UP"],
  [13, "D_DOWN"],
  [14, "D_LEFT"],
  [15, "D_RIGHT"],
];

/** Below this a stick is centred. The browser applies the dead zone and Dolphin
 * applies none (ADR D3): two would compound into a numb stick. */
const DEAD_ZONE = 0.15;
/** A GameCube trigger clicks at the end of its travel, and games read that click
 * as a button rather than as a big number. */
const TRIGGER_CLICK = 0.9;
/** How far a control must move from rest to count as "that one". */
export const MOVED = 0.5;

export type Control = { button: number } | { axis: number; rest: number; full: number };
export type StickAxis = { axis: number; sign: number };

export type PadProfile = {
  id: string;
  buttons: Partial<Record<ButtonName, Control>>;
  triggers: { L?: Control; R?: Control };
  sticks: { x?: StickAxis; y?: StickAxis; cx?: StickAxis; cy?: StickAxis };
};

export type PadReading = {
  buttons: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  l: number;
  r: number;
};

const analogue = (button: GamepadButton | undefined): number =>
  button === undefined ? 0 : button.value > 0 ? button.value : button.pressed ? 1 : 0;

/** How far a control has travelled from where it rests, between 0 and 1.
 *
 * A control can be a button OR an axis, and which one is not ours to decide.
 * Both are read the same way here so nothing above has to know which it was. */
function travel(pad: Gamepad, control: Control | undefined): number {
  if (control === undefined) return 0;
  if ("button" in control) return analogue(pad.buttons[control.button]);
  const value = pad.axes[control.axis] ?? control.rest;
  const span = control.full - control.rest;
  return span === 0 ? 0 : Math.max(0, Math.min(1, (value - control.rest) / span));
}

export function readPad(pad: Gamepad, profile: PadProfile | null): PadReading {
  const dead = (value: number) => (Math.abs(value) < DEAD_ZONE ? 0 : value);
  let buttons = 0;
  let l = 0;
  let r = 0;
  let x = 0;
  let y = 0;
  let cx = 0;
  let cy = 0;

  if (profile) {
    for (const [name, control] of Object.entries(profile.buttons)) {
      if (travel(pad, control) > MOVED) buttons |= BUTTON[name as ButtonName];
    }
    l = travel(pad, profile.triggers.L);
    r = travel(pad, profile.triggers.R);
    const stick = (axis: StickAxis | undefined) =>
      axis ? dead((pad.axes[axis.axis] ?? 0) * axis.sign) : 0;
    x = stick(profile.sticks.x);
    y = stick(profile.sticks.y);
    cx = stick(profile.sticks.cx);
    cy = stick(profile.sticks.cy);
  } else {
    for (const [index, name] of STANDARD) {
      if (pad.buttons[index]?.pressed) buttons |= BUTTON[name];
    }
    l = analogue(pad.buttons[6]);
    r = analogue(pad.buttons[7]);
    x = dead(pad.axes[0] ?? 0);
    y = -dead(pad.axes[1] ?? 0);
    cx = dead(pad.axes[2] ?? 0);
    cy = -dead(pad.axes[3] ?? 0);
  }

  if (l > TRIGGER_CLICK) buttons |= BUTTON.L;
  if (r > TRIGGER_CLICK) buttons |= BUTTON.R;
  return {
    buttons,
    x,
    y,
    cx,
    cy,
    l: Math.round(Math.min(1, l) * 255),
    r: Math.round(Math.min(1, r) * 255),
  };
}

/** Thirteen bytes, and the port is the server's to decide. */
export function encodePad(port: number, reading: PadReading): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(new ArrayBuffer(13));
  const view = new DataView(frame.buffer);
  view.setUint16(0, reading.buttons, true);
  frame[2] = port;
  view.setInt16(3, Math.round(reading.x * 32767), true);
  view.setInt16(5, Math.round(reading.y * 32767), true);
  view.setInt16(7, Math.round(reading.cx * 32767), true);
  view.setInt16(9, Math.round(reading.cy * 32767), true);
  frame[11] = reading.l;
  frame[12] = reading.r;
  return frame;
}
