/**
 * Dire une assignation dans la langue de celui qui la lit.
 *
 * Un profil enregistre « bouton 2 » ou « axe 4 ». Une antisèche qui affiche ça
 * demande à la personne de traduire, donc n'est pas une antisèche. Ce module
 * traduit, en séparant ce qui est sûr de ce qui est supposé (voir `families`).
 */
import { axisLabel, buttonLabel, identify, type PadIdentity } from "./families";
import { STANDARD, type Control, type ControlKey, type KeyProfile, type PadProfile } from "./pad";

/**
 * Ce qu'un profil a retenu pour cette commande. Une liste, et rarement vide.
 *
 * Une liste parce que L et R en ont DEUX sur une manette standard, et que c'est
 * voulu: la tranche donne le clic, la gâchette donne la course analogique. Une
 * description qui n'en montrerait qu'une enverrait la moitié des gens appuyer
 * sur la mauvaise, et c'est ce que la première version faisait.
 */
export function bindingsOf(profile: PadProfile, key: ControlKey): Control[] {
  if (key === "L" || key === "R") {
    return [profile.buttons[key], profile.triggers[key]].filter(
      (control): control is Control => control !== undefined,
    );
  }
  if (key === "x" || key === "y" || key === "cx" || key === "cy") {
    const stick = profile.sticks[key];
    return stick ? [{ axis: stick.axis, rest: 0, full: stick.sign }] : [];
  }
  const button = profile.buttons[key];
  return button ? [button] : [];
}

/**
 * Ce qu'il faut faire sur la manette pour déclencher cette commande.
 *
 * Sans profil, c'est la table du constructeur qui s'applique, et on la lit
 * plutôt que d'afficher « rien »: une manette standard EST configurée, elle ne
 * l'est simplement pas par nous.
 */
export function describePad(
  profile: PadProfile | null,
  identity: PadIdentity | null,
  key: ControlKey,
): string | null {
  if (identity === null) return null;
  if (profile === null) {
    if (!identity.standard) return null;
    return join(standardControls(key).map((control) => label(identity, key, control)));
  }
  return join(bindingsOf(profile, key).map((control) => label(identity, key, control)));
}

/** La table du constructeur, écrite comme des commandes. Deux pour L et R,
 * exactement comme `readPad` les lit quand aucun profil n'existe. */
function standardControls(key: ControlKey): Control[] {
  const found = STANDARD.filter(([, name]) => name === key).map(([index]) => ({ button: index }));
  if (key === "L") return [...found, { button: 6 }];
  if (key === "R") return [...found, { button: 7 }];
  const axes: Partial<Record<ControlKey, number>> = { x: 0, y: 1, cx: 2, cy: 3 };
  const axis = axes[key];
  // `full` au-dessus de `rest` veut dire « pas inversé »: c'est le sens que la
  // norme donne pour la droite, et le HAUT que la norme donne à l'envers est
  // déjà retourné par `readPad`.
  return axis === undefined ? found : [{ axis, rest: 0, full: 1 }];
}

function label(identity: PadIdentity, key: ControlKey, control: Control): string {
  if ("button" in control) return buttonLabel(identity, control.button);
  const way = key === "x" || key === "cx" ? "→" : key === "y" || key === "cy" ? "↑" : "";
  const sign = control.full < control.rest ? " (inversé)" : "";
  return `${axisLabel(identity, control.axis)}${way ? ` ${way}` : ""}${sign}`;
}

const join = (labels: string[]): string | null =>
  labels.length === 0 ? null : labels.join(" ou ");

/** Les touches qui déclenchent cette commande. Plusieurs, parce que rien
 * n'empêche d'en mettre deux, et une seule, le plus souvent. */
export function keysFor(keys: KeyProfile, key: ControlKey): string[] {
  return Object.entries(keys)
    .filter(([, action]) => {
      if (action.kind === "button") return action.name === key;
      if (action.kind === "trigger") return action.side === key;
      return action.stick === key && action.sign === 1;
    })
    .map(([code]) => code);
}

/** Les noms qu'on donne aux touches qui n'écrivent pas de caractère. */
const NAMED: Record<string, string> = {
  Enter: "Entrée",
  Space: "Espace",
  Escape: "Échap",
  Tab: "Tab",
  Backspace: "Retour",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ShiftLeft: "Maj gauche",
  ShiftRight: "Maj droite",
  ControlLeft: "Ctrl gauche",
  ControlRight: "Ctrl droit",
  AltLeft: "Alt",
  AltRight: "Alt Gr",
};

/**
 * Le nom d'une touche, tel qu'il est IMPRIMÉ sur le clavier de la personne.
 *
 * `KeyboardEvent.code` décrit une POSITION, nommée d'après un clavier
 * américain: sur un azerty, la touche marquée « A » rend `KeyQ`. Afficher « Q »
 * à quelqu'un qui vient d'appuyer sur A est exactement le genre de détail qui
 * fait croire que le configurateur s'est trompé.
 *
 * `navigator.keyboard.getLayoutMap()` donne le caractère réellement imprimé.
 * Elle n'existe pas partout, d'où la position en repli, qui est juste sur un
 * qwerty et honnête ailleurs.
 */
export function keyLabel(code: string, layout: Map<string, string> | null): string {
  const printed = layout?.get(code);
  if (printed) return printed.toUpperCase();
  if (code in NAMED) return NAMED[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `pavé ${code.slice(6)}`;
  return code;
}

type KeyboardLayoutApi = {
  keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> };
};

/** Charge la correspondance une fois. Rend `null` là où l'API n'existe pas. */
export async function keyboardLayout(): Promise<Map<string, string> | null> {
  try {
    const api = navigator as unknown as KeyboardLayoutApi;
    const map = await api.keyboard?.getLayoutMap?.();
    return map ?? null;
  } catch {
    // Certains navigateurs la refusent hors contexte sécurisé. Le repli suffit.
    return null;
  }
}

/** Quelle manette la page tient, d'après ce que la boucle d'entrée a vu.
 *
 * Ici plutôt que dans le composant qui l'affiche: un composant qui exporte
 * autre chose que des composants casse le rechargement à chaud, et cette
 * fonction n'a rien de visuel.
 */
export function identityOf(state: {
  padId: string | null;
  padLayout: "standard" | "unknown" | null;
}): PadIdentity | null {
  if (state.padId === null) return null;
  return identify(state.padId, state.padLayout === "standard" ? "standard" : "");
}
