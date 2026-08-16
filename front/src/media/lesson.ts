/**
 * Learning a pad, as a state machine over snapshots.
 *
 * Pure on purpose: the defect this had — one press answering two questions —
 * is a SEQUENCE, and the only way to see it was to drive a real browser frame
 * by frame with a real gamepad. Feeding snapshots to a function instead makes
 * that a unit test, and the same defect could not survive it.
 */
import { BUTTON, MOVED, type ButtonName, type Control, type PadProfile } from "./pad";

/** What the pad reports right now, flattened so a step can compare "before"
 * with "now" without caring what kind of control moved. */
export type Snapshot = { buttons: number[]; axes: number[] };

export const STEPS = [
  { key: "A", ask: "le bouton A" },
  { key: "B", ask: "le bouton B" },
  { key: "X", ask: "le bouton X" },
  { key: "Y", ask: "le bouton Y" },
  { key: "Z", ask: "le bouton Z" },
  { key: "START", ask: "Start" },
  { key: "D_UP", ask: "la croix ↑" },
  { key: "D_DOWN", ask: "la croix ↓" },
  { key: "D_LEFT", ask: "la croix ←" },
  { key: "D_RIGHT", ask: "la croix →" },
  { key: "L", ask: "la gâchette L, à fond" },
  { key: "R", ask: "la gâchette R, à fond" },
  { key: "x", ask: "le stick principal à DROITE" },
  { key: "y", ask: "le stick principal en HAUT" },
  { key: "cx", ask: "le stick C à DROITE" },
  { key: "cy", ask: "le stick C en HAUT" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export function snapshot(pad: Gamepad): Snapshot {
  return {
    buttons: pad.buttons.map((button) =>
      button.value > 0 ? button.value : button.pressed ? 1 : 0,
    ),
    axes: [...pad.axes],
  };
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

    const best = this.furthest(now);
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

  /** Whatever moved furthest from rest. Furthest rather than first: a GameCube
   * trigger moves its axis AND clicks a button, and the axis is the one worth
   * keeping. */
  private furthest(now: Snapshot): { control: Control; value: number; moved: number } | null {
    let best: { control: Control; value: number; moved: number } | null = null;
    now.buttons.forEach((value, index) => {
      const moved = Math.abs(value - (this.neutral.buttons[index] ?? 0));
      if (moved > MOVED && (best === null || moved > best.moved)) {
        best = { control: { button: index }, value, moved };
      }
    });
    now.axes.forEach((value, index) => {
      const rest = this.neutral.axes[index] ?? 0;
      const moved = Math.abs(value - rest);
      if (moved > MOVED && (best === null || moved > best.moved)) {
        best = { control: { axis: index, rest, full: value }, value, moved };
      }
    });
    return best;
  }
}

export const BUTTON_NAMES = Object.keys(BUTTON) as ButtonName[];
