/**
 * Learning a pad, as a state machine over snapshots.
 *
 * Pure on purpose: the defect this had — one press answering two questions —
 * is a SEQUENCE, and the only way to see it was to drive a real browser frame
 * by frame with a real gamepad. Feeding snapshots to a function instead makes
 * that a unit test, and the same defect could not survive it.
 */
import { BUTTON, CONTROLS, MOVED, type ButtonName, type Control, type PadProfile } from "./pad";

/** What the pad reports right now, flattened so a step can compare "before"
 * with "now" without caring what kind of control moved. */
export type Snapshot = { buttons: number[]; axes: number[] };

/** Les mêmes commandes que partout ailleurs, dans le même ordre, avec la phrase
 * qui les demande. Dérivé plutôt que recopié: une liste des seize commandes
 * suffit, et deux finissent par diverger. */
export const STEPS = CONTROLS.map(({ key, ask }) => ({ key, ask }));

export type StepKey = (typeof STEPS)[number]["key"];

export function snapshot(pad: Gamepad): Snapshot {
  return {
    buttons: pad.buttons.map((button) =>
      button.value > 0 ? button.value : button.pressed ? 1 : 0,
    ),
    axes: [...pad.axes],
  };
}

/**
 * Fond deux instantanés en gardant, pour chaque entrée, la plus grande valeur
 * absolue.
 *
 * Pour un adaptateur qui présente plusieurs manettes du MÊME modèle: le pad est
 * peut-être dans le troisième port, et demander « appuie sur A » à un port vide
 * est une leçon qu'on ne peut pas finir. Du même modèle seulement, parce que
 * fondre les boutons d'une Xbox et d'une GameCube apprendrait n'importe quoi.
 */
export function loudest(first: Snapshot, second: Snapshot): Snapshot {
  const pick = (left: number[], right: number[]) => {
    const out: number[] = [];
    for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
      const a = left[at] ?? 0;
      const b = right[at] ?? 0;
      out.push(Math.abs(b) > Math.abs(a) ? b : a);
    }
    return out;
  };
  return { buttons: pick(first.buttons, second.buttons), axes: pick(first.axes, second.axes) };
}

/**
 * Ce qui a le plus bougé depuis le repos, ou rien.
 *
 * Le plus loin plutôt que le premier: une gâchette de GameCube déplace son axe
 * ET clique un bouton, et c'est l'axe qu'il faut garder.
 *
 * Fonction de module plutôt que méthode, parce que réassigner UNE commande a
 * besoin d'exactement ça sans le reste de la leçon.
 */
export function furthest(
  neutral: Snapshot,
  now: Snapshot,
): { control: Control; value: number; moved: number } | null {
  let best: { control: Control; value: number; moved: number } | null = null;
  now.buttons.forEach((value, index) => {
    const moved = Math.abs(value - (neutral.buttons[index] ?? 0));
    if (moved > MOVED && (best === null || moved > best.moved)) {
      best = { control: { button: index }, value, moved };
    }
  });
  now.axes.forEach((value, index) => {
    const rest = neutral.axes[index] ?? 0;
    const moved = Math.abs(value - rest);
    if (moved > MOVED && (best === null || moved > best.moved)) {
      best = { control: { axis: index, rest, full: value }, value, moved };
    }
  });
  return best;
}

/**
 * Réassigner UNE commande: on prend le repos au moment du clic, et on rend la
 * première chose qui bouge.
 *
 * Pas d'attente de relâchement ici, contrairement à la leçon: on vient de
 * cliquer avec la souris, donc les mains ne sont pas sur la manette.
 */
export class Capture {
  private readonly neutral: Snapshot;

  constructor(neutral: Snapshot) {
    this.neutral = neutral;
  }

  feed(now: Snapshot): { control: Control; value: number } | null {
    const best = furthest(this.neutral, now);
    return best === null ? null : { control: best.control, value: best.value };
  }
}

export class Lesson {
  step = 0;
  /** Waiting for the hand to let go before the next question is asked. */
  waiting = false;
  private readonly neutral: Snapshot;
  private readonly profile: PadProfile;

  /** The neutral sample is taken ONCE, with nothing held. Re-reading it after
   * each answer was the bug: the sample was taken while the button was still
   * down, so RELEASING it moved just as far as pressing and answered the next
   * question. One press of A took the counter from 1 to 3. */
  constructor(id: string, neutral: Snapshot) {
    this.neutral = neutral;
    this.profile = { id, buttons: {}, triggers: {}, sticks: {} };
  }

  get done(): boolean {
    return this.step >= STEPS.length;
  }

  get asking(): string {
    return this.done ? "" : STEPS[this.step].ask;
  }

  learned(): PadProfile {
    return this.profile;
  }

  /** Skips the control being asked for: not every pad has every button. */
  skip(): void {
    this.step += 1;
    this.waiting = true;
  }

  /** Feeds one frame. Returns true when something was recorded. */
  feed(now: Snapshot): boolean {
    if (this.done) return false;
    if (this.waiting) {
      if (this.atRest(now)) this.waiting = false;
      return false;
    }

    const best = furthest(this.neutral, now);
    if (best === null) return false;

    const { key } = STEPS[this.step];
    if (key === "L" || key === "R") {
      this.profile.triggers[key] = best.control;
    } else if (key === "x" || key === "y" || key === "cx" || key === "cy") {
      // A stick is signed, and the sign is whichever way the player just pushed:
      // asking for RIGHT and UP means the recorded direction IS positive.
      if ("axis" in best.control) {
        this.profile.sticks[key] = {
          axis: best.control.axis,
          sign: best.value >= best.control.rest ? 1 : -1,
        };
      }
    } else {
      this.profile.buttons[key as ButtonName] = best.control;
    }
    this.step += 1;
    this.waiting = true;
    return true;
  }

  private atRest(now: Snapshot): boolean {
    return (
      now.buttons.every(
        (value, index) => Math.abs(value - (this.neutral.buttons[index] ?? 0)) <= MOVED,
      ) &&
      now.axes.every((value, index) => Math.abs(value - (this.neutral.axes[index] ?? 0)) <= MOVED)
    );
  }
}

export const BUTTON_NAMES = Object.keys(BUTTON) as ButtonName[];
