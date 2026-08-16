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

/** Les seize commandes d'une manette GameCube, dans l'ordre où on les montre.
 *
 * Une seule liste, parce qu'il y en avait deux: celle de l'apprentissage et
 * celle qu'on affiche. Deux listes des mêmes choses finissent par diverger, et
 * la première commande qui manque à l'une est celle que personne ne peut
 * reconfigurer. */
export const CONTROLS = [
  { key: "A", label: "A", ask: "le bouton A" },
  { key: "B", label: "B", ask: "le bouton B" },
  { key: "X", label: "X", ask: "le bouton X" },
  { key: "Y", label: "Y", ask: "le bouton Y" },
  { key: "Z", label: "Z", ask: "le bouton Z" },
  { key: "START", label: "Start", ask: "Start" },
  { key: "D_UP", label: "croix ↑", ask: "la croix ↑" },
  { key: "D_DOWN", label: "croix ↓", ask: "la croix ↓" },
  { key: "D_LEFT", label: "croix ←", ask: "la croix ←" },
  { key: "D_RIGHT", label: "croix →", ask: "la croix →" },
  { key: "L", label: "gâchette L", ask: "la gâchette L, à fond" },
  { key: "R", label: "gâchette R", ask: "la gâchette R, à fond" },
  { key: "x", label: "stick →", ask: "le stick principal à DROITE" },
  { key: "y", label: "stick ↑", ask: "le stick principal en HAUT" },
  { key: "cx", label: "stick C →", ask: "le stick C à DROITE" },
  { key: "cy", label: "stick C ↑", ask: "le stick C en HAUT" },
] as const;

export type ControlKey = (typeof CONTROLS)[number]["key"];

/** Ce qu'une touche fait, du point de vue de la GameCube.
 *
 * Trois formes, parce qu'une manette a trois sortes de commandes et qu'une
 * touche de clavier doit pouvoir jouer les trois: un bouton est tout ou rien,
 * une gâchette est analogique, une direction de stick est signée. */
export type Action =
  | { kind: "button"; name: ButtonName }
  | { kind: "trigger"; side: "L" | "R" }
  | { kind: "stick"; stick: "x" | "y" | "cx" | "cy"; sign: 1 | -1 };

/** Une touche du clavier vers ce qu'elle fait. La clé est `KeyboardEvent.code`,
 * qui décrit la POSITION physique: la même touche marche sur un clavier azerty
 * et sur un qwerty, ce qui est exactement ce qu'on veut d'un jeu. */
export type KeyProfile = Record<string, Action>;

/** La disposition par défaut, celle qui existait avant qu'on puisse la changer.
 * La main gauche sur les touches, la droite sur les flèches. */
export const DEFAULT_KEYS: KeyProfile = {
  KeyX: { kind: "button", name: "A" },
  KeyC: { kind: "button", name: "B" },
  KeyS: { kind: "button", name: "X" },
  KeyD: { kind: "button", name: "Y" },
  KeyA: { kind: "button", name: "Z" },
  KeyQ: { kind: "trigger", side: "L" },
  KeyE: { kind: "trigger", side: "R" },
  Enter: { kind: "button", name: "START" },
  ArrowRight: { kind: "stick", stick: "x", sign: 1 },
  ArrowLeft: { kind: "stick", stick: "x", sign: -1 },
  ArrowUp: { kind: "stick", stick: "y", sign: 1 },
  ArrowDown: { kind: "stick", stick: "y", sign: -1 },
};

/** The W3C "standard gamepad", which is what a browser reports for anything
 * Xbox- or PlayStation-shaped. What was here before wired four of them and
 * stopped: no D-pad, no C-stick, no analogue triggers, and `Z` on the LEFT
 * trigger, where no GameCube player's hand goes looking for it. */
export const STANDARD: ReadonlyArray<readonly [number, ButtonName]> = [
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

/**
 * La disposition standard, écrite comme un profil qu'on peut modifier.
 *
 * Sans elle, une manette Xbox ou PlayStation n'a pas de profil du tout: `readPad`
 * applique une table figée et il n'y a rien à changer. La matérialiser rend
 * chaque touche réassignable sur n'importe quelle manette, ce qui est la
 * demande.
 *
 * Ce que ça coûte, et il faut le dire: à partir du moment où quelqu'un
 * personnalise, sa copie ne suit plus les corrections de la table. C'est le prix
 * d'une préférence enregistrée, et il vaut mieux que l'inverse, où une mise à
 * jour du navigateur déplacerait les boutons de quelqu'un sans prévenir.
 */
export function standardProfile(id: string): PadProfile {
  const buttons: Partial<Record<ButtonName, Control>> = {};
  for (const [index, name] of STANDARD) buttons[name] = { button: index };
  return {
    id,
    buttons,
    triggers: { L: { button: 6 }, R: { button: 7 } },
    sticks: {
      x: { axis: 0, sign: 1 },
      y: { axis: 1, sign: -1 },
      cx: { axis: 2, sign: 1 },
      cy: { axis: 3, sign: -1 },
    },
  };
}

/**
 * Ce que le clavier envoie, d'après le profil.
 *
 * Séparé de `readPad` et pur, parce que c'était douze lignes au milieu de la
 * boucle d'envoi où rien ne pouvait le tester. Une gâchette au clavier va à
 * fond: une touche n'a pas de demi-course, et prétendre le contraire
 * n'aiderait personne.
 */
export function readKeys(held: ReadonlySet<string>, profile: KeyProfile): PadReading {
  let buttons = 0;
  let l = 0;
  let r = 0;
  const sticks = { x: 0, y: 0, cx: 0, cy: 0 };
  for (const [code, action] of Object.entries(profile)) {
    if (!held.has(code)) continue;
    if (action.kind === "button") buttons |= BUTTON[action.name];
    else if (action.kind === "trigger") {
      if (action.side === "L") l = 1;
      else r = 1;
    } else sticks[action.stick] += action.sign;
  }
  return finish(buttons, l, r, {
    // Deux touches opposées tenues ensemble s'annulent, ce qui est ce que fait
    // un vrai stick qu'on ne pousse pas.
    x: Math.max(-1, Math.min(1, sticks.x)),
    y: Math.max(-1, Math.min(1, sticks.y)),
    cx: Math.max(-1, Math.min(1, sticks.cx)),
    cy: Math.max(-1, Math.min(1, sticks.cy)),
  });
}

/** Le bout commun des deux lectures: le clic de gâchette et la mise en octets.
 *
 * Une gâchette de GameCube clique en fin de course, et les jeux lisent ce clic
 * comme un bouton plutôt que comme un grand nombre. La règle vaut pour le
 * clavier comme pour la manette, donc elle vit à un seul endroit. */
function finish(
  buttons: number,
  l: number,
  r: number,
  sticks: { x: number; y: number; cx: number; cy: number },
): PadReading {
  if (l > TRIGGER_CLICK) buttons |= BUTTON.L;
  if (r > TRIGGER_CLICK) buttons |= BUTTON.R;
  return {
    buttons,
    ...sticks,
    l: Math.round(Math.min(1, l) * 255),
    r: Math.round(Math.min(1, r) * 255),
  };
}

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

/** Zéro est zéro.
 *
 * Multiplier 0 par -1 rend `-0` en JavaScript, que `Object.is` distingue de `0`.
 * L'octet envoyé est le même, donc ça ne change rien au jeu, mais ça faisait
 * échouer une comparaison entre deux façons de lire la MÊME manette. Un test qui
 * échoue sur une distinction que rien en aval ne fait décrit le langage et pas
 * le sujet, alors on retire la distinction ici. */
const plainZero = (value: number): number => (value === 0 ? 0 : value);

export function readPad(pad: Gamepad, profile: PadProfile | null): PadReading {
  const dead = (value: number) => plainZero(Math.abs(value) < DEAD_ZONE ? 0 : value);
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
      axis ? plainZero(dead((pad.axes[axis.axis] ?? 0) * axis.sign)) : 0;
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
    y = plainZero(-dead(pad.axes[1] ?? 0));
    cx = dead(pad.axes[2] ?? 0);
    cy = plainZero(-dead(pad.axes[3] ?? 0));
  }

  return finish(buttons, l, r, { x, y, cx, cy });
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
