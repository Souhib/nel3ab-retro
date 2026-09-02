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

/** Les mêmes seize commandes, dites comme une Wiimote les nomme.
 *
 * # Pourquoi ce n'est pas un deuxième profil
 *
 * La page envoie toujours la même trame: douze boutons, deux sticks, deux
 * gâchettes. C'est Dolphin qui la relit ensuite comme une manette GameCube OU
 * comme une Wiimote, selon le fichier de correspondances qu'on lui écrit — les
 * deux à la fois, sur le même tuyau. Une personne n'a donc qu'UNE manette à
 * apprendre, et ce sont les mots qui changent.
 *
 * L'apprendre deux fois serait pire que redondant: il faudrait se souvenir
 * laquelle des deux vaut pour le jeu qu'on lance.
 *
 * # Ce qui n'a pas de nom ici
 *
 * Le bouton Home et le bouton « moins ». Une Wiimote plus un Nunchuk comptent
 * treize boutons, notre trame en porte douze, et la secousse en demandait un
 * quatorzième; voir `emulator::config::wiimote_ini`, qui dit lesquels on
 * sacrifie et pourquoi.
 */
const WII_NAMES: Partial<Record<ControlKey, { label: string; ask: string }>> = {
  A: { label: "A", ask: "le bouton A de la Wiimote" },
  B: { label: "B", ask: "le bouton B, la gâchette sous la Wiimote" },
  X: { label: "1", ask: "le bouton 1" },
  Y: { label: "2", ask: "le bouton 2" },
  // « Moins » a laissé sa place à la secousse: notre trame porte douze boutons
  // et une Wiimote avec son Nunchuk en demande treize, Home déjà sacrifié. Le
  // besoin est concret — Mario Strikers Charged met les coups d'épaule sur une
  // secousse, et ils sont différents des tacles. Voir `emulator::config`.
  Z: { label: "secouer", ask: "de quoi SECOUER la Wiimote" },
  START: { label: "+", ask: "le bouton plus" },
  L: { label: "C", ask: "le bouton C du Nunchuk" },
  R: { label: "Z", ask: "le bouton Z du Nunchuk" },
  x: { label: "stick →", ask: "le stick du Nunchuk à DROITE" },
  y: { label: "stick ↑", ask: "le stick du Nunchuk en HAUT" },
  cx: { label: "viser →", ask: "de quoi viser à DROITE" },
  cy: { label: "viser ↑", ask: "de quoi viser en HAUT" },
};

/** Les mêmes commandes, dites comme une guitare les nomme.
 *
 * Les cinq frettes sur les cinq boutons, le grattage sur la croix haut et bas.
 * C'est la disposition des jeux de guitare sur clavier, et la seule qui tienne:
 * notre trame porte douze boutons, une guitare en demande cinq plus deux.
 *
 * Ce qui n'a pas de nom ici est ce que la guitare n'a pas. Une croix gauche et
 * droite, par exemple: elle n'en a pas, donc la ligne garde son nom de manette
 * plutôt que d'inventer un mot pour rien.
 */
const GUITAR_NAMES: Partial<Record<ControlKey, { label: string; ask: string }>> = {
  A: { label: "verte", ask: "la frette VERTE" },
  B: { label: "rouge", ask: "la frette ROUGE" },
  X: { label: "jaune", ask: "la frette JAUNE" },
  Y: { label: "bleue", ask: "la frette BLEUE" },
  Z: { label: "orange", ask: "la frette ORANGE" },
  D_UP: { label: "gratter ↑", ask: "gratter vers le HAUT" },
  D_DOWN: { label: "gratter ↓", ask: "gratter vers le BAS" },
  START: { label: "+", ask: "le bouton plus" },
  L: { label: "−", ask: "le bouton moins" },
  cx: { label: "vibrato", ask: "la barre de vibrato, poussée à fond" },
};

/** Les commandes, nommées pour ce qu'on tient.
 *
 * La console ne suffit pas: sur un jeu Wii on peut tenir une Wiimote ou une
 * guitare, et ce ne sont pas les mêmes mots. Rien ne change dans ce qu'on
 * envoie, seulement dans ce qu'on demande à la personne.
 */
export function controlsFor(console: string, pad: 0 | 1 | 2 = 0): typeof CONTROLS {
  // Une manette GameCube reste une manette GameCube, même sur un jeu Wii: c'est
  // ce que le worker écrit dans son fichier de correspondances.
  if (console !== "wii" || pad === 0) return CONTROLS;
  const said = pad === 2 ? GUITAR_NAMES : WII_NAMES;
  return CONTROLS.map((one) => {
    const named = said[one.key];
    return named ? { ...one, ...named } : one;
  }) as unknown as typeof CONTROLS;
}

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

/** Une commande apprise, et son REPOS.
 *
 * Le repos n'est pas un détail de confort: aucune manette ne rend zéro quand on
 * ne la touche pas. Un stick de GameCube revient où il veut, et un adaptateur
 * qui présente une gâchette comme un bouton lui donne une valeur au repos. Sans
 * ce nombre, la page envoie cette valeur au jeu en permanence, et ça se voit
 * comme un bouton coincé ou un personnage qui court tout seul.
 *
 * Absent veut dire zéro, pour que les profils appris avant ce champ continuent
 * de marcher exactement comme avant. */
export type Control =
  | { button: number; rest?: number }
  | { axis: number; rest: number; full: number };
export type StickAxis = { axis: number; sign: number; rest?: number };

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
 * Fond deux lectures en une: ce qui bouge quelque part bouge dans le jeu.
 *
 * Sert deux fois. Le clavier et la manette d'abord, pour qu'on puisse tenir une
 * direction au clavier et appuyer sur A à la manette. Et toutes les manettes
 * entre elles ensuite, ce qui est moins évident et plus important: un adaptateur
 * GameCube présente QUATRE manettes au navigateur, une par port de l'adaptateur,
 * même s'il n'y a qu'un pad branché dessus. Ne lire que la première rendait donc
 * la manette morte trois fois sur quatre, sans rien pour l'expliquer.
 *
 * Les boutons s'ajoutent, les gâchettes prennent la plus enfoncée, et un stick
 * prend la valeur la plus GRANDE EN VALEUR ABSOLUE. Ce dernier point est la
 * seule subtilité: prendre « la première non nulle » ferait gagner une manette
 * au repos qui dérive d'un cheveu contre une manette qu'on pousse à fond.
 */
export function merge(first: PadReading, second: PadReading): PadReading {
  const strongest = (left: number, right: number) =>
    Math.abs(right) > Math.abs(left) ? right : left;
  return {
    buttons: first.buttons | second.buttons,
    x: strongest(first.x, second.x),
    y: strongest(first.y, second.y),
    cx: strongest(first.cx, second.cx),
    cy: strongest(first.cy, second.cy),
    l: Math.max(first.l, second.l),
    r: Math.max(first.r, second.r),
  };
}

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
  if ("button" in control) {
    // Depuis le repos, et pas depuis zéro. Un adaptateur qui rapporte une
    // gâchette comme un bouton la pose au repos à 0,6: sans cette soustraction
    // le bouton est tenu pour toute la partie, sans que rien ne l'ait touché.
    const rest = control.rest ?? 0;
    const span = 1 - rest;
    const moved = analogue(pad.buttons[control.button]) - rest;
    return span <= 0 ? 0 : Math.max(0, Math.min(1, moved / span));
  }
  const value = pad.axes[control.axis] ?? control.rest;
  const span = control.full - control.rest;
  return span === 0 ? 0 : Math.max(0, Math.min(1, (value - control.rest) / span));
}

/** Un axe de stick ramené autour de son repos, sur toute sa course.
 *
 * Recentrer sans redimensionner rendrait le stick asymétrique: un axe qui repose
 * à 0,25 n'a plus que 0,75 de course d'un côté et 1,25 de l'autre, donc le
 * personnage irait plus vite d'un côté que de l'autre. Les deux moitiés sont
 * donc remises à l'échelle séparément.
 */
function centred(value: number, axis: StickAxis): number {
  const rest = axis.rest ?? 0;
  const moved = value - rest;
  if (moved === 0) return 0;
  const span = moved > 0 ? 1 - rest : 1 + rest;
  return span <= 0 ? 0 : Math.max(-1, Math.min(1, moved / span));
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
      axis ? plainZero(dead(centred(pad.axes[axis.axis] ?? 0, axis) * axis.sign)) : 0;
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
