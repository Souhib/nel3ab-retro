/**
 * Conduire un menu à la manette.
 *
 * Un menu ne se conduit pas comme un jeu. Pousser le stick une fois doit
 * déplacer d'UN cran, pas de vingt: la boucle lit la manette toutes les quatre
 * millisecondes, et sans mémoire un simple appui traverserait la liste entière.
 *
 * La cadence est celle qu'on trouve sur une console: le premier cran part tout
 * de suite, puis rien pendant un temps de garde, puis une répétition régulière
 * tant que la direction est tenue. C'est ce qui permet à la fois de choisir la
 * ligne d'à côté et de descendre une longue liste sans lâcher.
 *
 * Pur et sans horloge à lui: l'appelant passe l'instant. C'est ce qui rend les
 * trois temps ci-dessous vérifiables sans attendre une seconde par assertion.
 */
import { BUTTON, type PadReading } from "./pad";

/** Ce qu'un menu comprend. Pas de « bouton 7 »: un menu a quatre directions,
 * une façon de dire oui et une de dire non. */
export type MenuAction = "up" | "down" | "left" | "right" | "confirm" | "back";

/** Au-delà de quoi un stick compte comme poussé. Plus haut que la zone morte:
 * un stick qui traîne à 0,2 ne veut pas dire « descends ». */
const PUSHED = 0.5;
/** Avant la première répétition. Assez long pour qu'un cran seul reste un cran. */
const HOLD_MS = 400;
/** Entre deux répétitions ensuite. */
const REPEAT_MS = 110;

/** La direction d'une lecture, ou rien. La croix et le stick disent la même
 * chose: on tient l'un ou l'autre selon la manette et selon la main. */
export function directionOf(reading: PadReading): MenuAction | null {
  if (reading.y > PUSHED || (reading.buttons & BUTTON.D_UP) !== 0) return "up";
  if (reading.y < -PUSHED || (reading.buttons & BUTTON.D_DOWN) !== 0) return "down";
  if (reading.x < -PUSHED || (reading.buttons & BUTTON.D_LEFT) !== 0) return "left";
  if (reading.x > PUSHED || (reading.buttons & BUTTON.D_RIGHT) !== 0) return "right";
  return null;
}

export class MenuPad {
  private direction: MenuAction | null = null;
  private since = 0;
  private repeats = 0;
  /** Les boutons tenus au tour d'avant, pour n'agir que sur le front montant. */
  private held = 0;

  /** Lit une image de manette et rend ce que le menu doit faire, s'il doit faire
   * quelque chose. Une action au plus par appel: un menu qui reculerait et
   * descendrait dans le même tour serait un menu qui saute. */
  feed(reading: PadReading, now: number): MenuAction | null {
    // Les boutons d'abord: dire oui compte plus que la direction où traîne le
    // pouce gauche.
    const pressed = reading.buttons & ~this.held;
    this.held = reading.buttons;
    if ((pressed & BUTTON.A) !== 0 || (pressed & BUTTON.START) !== 0) return "confirm";
    if ((pressed & BUTTON.B) !== 0) return "back";

    const way = directionOf(reading);
    if (way === null) {
      this.direction = null;
      this.repeats = 0;
      return null;
    }
    if (way !== this.direction) {
      this.direction = way;
      this.since = now;
      this.repeats = 0;
      return way;
    }
    const waited = now - this.since;
    const due = this.repeats === 0 ? HOLD_MS : HOLD_MS + this.repeats * REPEAT_MS;
    if (waited >= due) {
      this.repeats += 1;
      return way;
    }
    return null;
  }
}
