/**
 * Clair ou sombre, et qui décide.
 *
 * Trois états et non deux: « clair », « sombre », et « comme le système ». Le
 * troisième existe parce qu'un site qui impose son thème est un site qu'on
 * regarde à 2 h du matin en plissant les yeux, et un site qui suit le système
 * sans laisser en sortir est un site qu'on ne peut pas montrer à quelqu'un dont
 * la machine est réglée autrement.
 *
 * Le thème s'écrit sur `<html>`, pas dans un contexte React: la couleur de fond
 * doit être posée avant le premier rendu, sinon la page clignote en blanc au
 * chargement.
 */
export type Theme = "light" | "dark" | "system";

const REMEMBERED = "nel3ab:theme";

const systemPrefersDark = (): boolean =>
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function storedTheme(): Theme {
  try {
    const found = localStorage.getItem(REMEMBERED);
    return found === "dark" || found === "light" || found === "system" ? found : "light";
  } catch {
    return "light";
  }
}

/** Pose le thème sur le document. Appelé avant React, puis à chaque changement. */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function rememberTheme(theme: Theme): void {
  try {
    localStorage.setItem(REMEMBERED, theme);
  } catch {
    /* navigation privée: le thème vaut pour cette session */
  }
}

/** L'état suivant du bouton: clair, sombre, système, et on recommence. */
export const nextTheme = (theme: Theme): Theme =>
  theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

export const themeLabel = (theme: Theme): string =>
  theme === "light" ? "clair" : theme === "dark" ? "sombre" : "système";
