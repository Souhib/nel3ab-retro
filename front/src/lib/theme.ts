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
 * La forme du menu: trois consoles, trois façons de se conduire.
 *
 * Ce n'est pas un thème: un thème change des couleurs, ceci change la
 * disposition et la façon de naviguer. Les deux se choisissent séparément, donc
 * un XMB en Game Boy est possible et c'est très bien.
 */
export const SHELLS = [
  { id: "croix", label: "croix", note: "une rangée, une colonne, un croisement fixe" },
  { id: "grille", label: "grille", note: "une page de tuiles, une barre en bas" },
  { id: "rangée", label: "rangée", note: "une file de grandes tuiles, une par une" },
] as const;

export type Shell = (typeof SHELLS)[number]["id"];

const SHELL = "nel3ab:shell";

export function storedShell(): Shell {
  try {
    const found = localStorage.getItem(SHELL);
    return SHELLS.some((choice) => choice.id === found) ? (found as Shell) : "croix";
  } catch {
    return "croix";
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
