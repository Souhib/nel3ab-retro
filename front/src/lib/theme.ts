/**
 * Six ambiances, et celle qu'on garde.
 *
 * Un thème ne change que des couleurs et une famille de caractères. Il ne touche
 * ni la disposition, ni ce qui est affiché, ni quoi que ce soit par-dessus
 * l'image: la zone d'écran reste noire dans tous. C'est ce qui permet d'en
 * proposer six sans risquer la boucle d'affichage.
 *
 * Le thème s'écrit sur `<html>`, pas dans un contexte React: la couleur de fond
 * doit être posée avant le premier rendu, sinon la page clignote au chargement.
 */
export const THEMES = [
  {
    id: "instrument-sombre",
    label: "instrument sombre",
    note: "l'appareil de mesure, et le défaut",
  },
  { id: "instrument-clair", label: "instrument clair", note: "le même, de jour" },
  { id: "phosphore", label: "phosphore", note: "terminal à tube, vert P1" },
  { id: "ambre", label: "ambre", note: "le même tube, monochrome chaud" },
  { id: "indigo", label: "indigo", note: "le plastique de la console" },
  { id: "famicom", label: "famicom", note: "crème et rouge, 1983" },
  { id: "gameboy", label: "game boy", note: "les quatre verts de 1989" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

const DEFAULT: Theme = "instrument-sombre";
const REMEMBERED = "nel3ab:theme";

const known = (value: string | null): value is Theme => THEMES.some((theme) => theme.id === value);

export function storedTheme(): Theme {
  try {
    const found = localStorage.getItem(REMEMBERED);
    return known(found) ? found : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Pose le thème sur le document. Appelé avant React, puis à chaque changement. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function rememberTheme(theme: Theme): void {
  try {
    localStorage.setItem(REMEMBERED, theme);
  } catch {
    /* navigation privée: le thème vaut pour cette session */
  }
}

export const themeLabel = (theme: Theme): string =>
  THEMES.find((found) => found.id === theme)?.label ?? theme;

/** Ce que la colonne montre: la salle, ou les mesures. */
export type Mode = "normal" | "details";

const MODE = "nel3ab:mode";

export function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE) === "details" ? "details" : "normal";
  } catch {
    return "normal";
  }
}

export function rememberMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE, mode);
  } catch {
    /* navigation privée */
  }
}

/**
 * Le menu: celui de quelle console.
 *
 * Ce n'est pas un thème. Un thème change les couleurs de la SALLE; ceci change
 * le menu, et chacun porte les couleurs de sa console plutôt que celles du
 * thème. Copier le tableau de bord d'une Xbox en vert Game Boy ne serait plus
 * le tableau de bord d'une Xbox.
 */
export const SHELLS = [
  { id: "ps3", label: "PlayStation 3", note: "la croix du XMB" },
  { id: "wii", label: "Wii", note: "le tableau des chaînes" },
  { id: "switch", label: "Switch", note: "la rangée de l'écran d'accueil" },
] as const;

export type Shell = (typeof SHELLS)[number]["id"];

const SHELL = "nel3ab:shell";

export function storedShell(): Shell {
  try {
    const found = localStorage.getItem(SHELL);
    return SHELLS.some((choice) => choice.id === found) ? (found as Shell) : "ps3";
  } catch {
    return "ps3";
  }
}

export function rememberShell(shell: Shell): void {
  try {
    localStorage.setItem(SHELL, shell);
  } catch {
    /* navigation privée */
  }
}

export const shellLabel = (shell: Shell): string =>
  SHELLS.find((found) => found.id === shell)?.label ?? shell;

/** Faut-il montrer la manette à l'écran ?
 *
 * Trois états et pas deux. « Auto » regarde l'appareil: un écran tactile sans
 * souris la montre, un ordinateur non. Les deux autres sont un choix explicite,
 * parce que la détection se trompe des deux côtés — un portable tactile n'a pas
 * besoin d'une manette à l'écran, et une tablette branchée à un clavier peut
 * quand même en vouloir une.
 */
export const TOUCHPADS = [
  { id: "auto", label: "selon l'appareil", note: "montrée sur un écran tactile" },
  { id: "on", label: "toujours", note: "même avec un clavier" },
  { id: "off", label: "jamais", note: "cachée quoi qu'il arrive" },
] as const;

export type TouchPref = (typeof TOUCHPADS)[number]["id"];

const TOUCH_KEY = "nel3ab:touchpad";

const PAD_ONLY_KEY = "nel3ab:padonly";

/** Vrai quand cette page ne doit servir que de manette.
 *
 * Gardé dans le navigateur, comme les autres réglages: un téléphone qui sert de
 * manette le soir sert de manette le lendemain, et le redemander à chaque
 * ouverture serait un geste de plus à faire à quatre.
 */
export function storedPadOnly(): boolean {
  try {
    return localStorage.getItem(PAD_ONLY_KEY) === "oui";
  } catch {
    return false;
  }
}

export function rememberPadOnly(only: boolean): void {
  try {
    localStorage.setItem(PAD_ONLY_KEY, only ? "oui" : "non");
  } catch {
    // Un navigateur en navigation privée refuse d'écrire. Le réglage vaut alors
    // pour cette séance et pas au-delà, ce qui est mieux que de ne pas marcher.
  }
}

export function storedTouch(): TouchPref {
  try {
    const found = localStorage.getItem(TOUCH_KEY);
    return TOUCHPADS.some((choice) => choice.id === found) ? (found as TouchPref) : "auto";
  } catch {
    return "auto";
  }
}

export function rememberTouch(pref: TouchPref): void {
  try {
    localStorage.setItem(TOUCH_KEY, pref);
  } catch {
    // Navigation privée: le choix dure le temps de l'onglet.
  }
}

export function touchLabel(pref: TouchPref): string {
  return TOUCHPADS.find((choice) => choice.id === pref)?.label ?? pref;
}

/** L'appareil a-t-il un écran tactile et pas de souris fine ?
 *
 * `pointer: coarse` plutôt que la présence d'événements tactiles: un portable
 * tactile répond oui à la seconde question et n'a pas besoin d'une manette à
 * l'écran. Ce qu'on veut savoir est comment la personne DÉSIGNE, pas ce que le
 * matériel sait faire.
 */
export function looksLikeAPhone(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Faut-il la montrer, tout compte fait ? */
export function showsTouchPad(pref: TouchPref, coarse: boolean): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return coarse;
}
