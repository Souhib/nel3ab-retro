/**
 * What the picture and the sound are scheduled against.
 *
 * Both streams carry the same server capture instant, and both are presented at
 * that instant plus an offset this page steers. Keeping the arithmetic in one
 * place is what lets the two be compared: the gap between them is a subtraction,
 * not an opinion (measured at 68 ms once, and named to the millisecond).
 */

/** Nearest-rank, on a copy: the caller's samples keep their order. */
export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * quantile))];
}

/** A bounded window of samples, oldest dropped first. */
export class Window {
  private readonly samples: number[] = [];
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  push(value: number): void {
    this.samples.push(value);
    if (this.samples.length > this.cap) this.samples.shift();
  }

  clear(): void {
    this.samples.length = 0;
  }

  get length(): number {
    return this.samples.length;
  }

  /** The best this pipe has been seen to do, which is what a schedule is set
   * against: anchoring on the FIRST sample cost 51 ms of latency for a whole
   * session, because the first picture is the key frame and the slowest. */
  fastest(): number | null {
    return this.samples.length === 0 ? null : Math.min(...this.samples);
  }

  at(quantile: number): number {
    return percentile(this.samples, quantile);
  }
}

/** Moves `current` towards `want` by at most `step`. */
export function steer(current: number, want: number, step: number): number {
  return current + Math.max(-step, Math.min(step, want - current));
}

/**
 * Combien de retard, par rapport à la cadence de la source, compte pour un vrai
 * trou.
 *
 * Une image et demie. En dessous, l'écart s'explique par la cadence de la source
 * elle-même; au-dessus, quelque chose s'est arrêté quelque part.
 */
const LATE = 1.5;

/**
 * Un tic d'affichage sans rien à montrer: est-ce une famine, ou juste une source
 * plus lente que l'écran ?
 *
 * La distinction n'existait pas, et elle coûtait cher. Un jeu PAL tourne à
 * 50 Hz: sur un écran à 60 Hz il y a forcément une dizaine de tics par seconde
 * où rien de neuf n'est encore arrivé, et ce n'est pas une panne, c'est de
 * l'arithmétique. La page comptait une famine à chaque fois, jetait son horaire
 * d'affichage, et faisait grossir sa marge de 8 ms par fenêtre.
 *
 * Mesuré sur Mario Party 4 (PAL) le 16 août 2026: **38 ms de marge** contre 3 ms
 * sur un jeu 60 Hz, et ça montait encore vers le plafond de 60. Trente-cinq
 * millisecondes de latence ajoutées pour compenser un problème qui n'existait
 * pas.
 *
 * Ce qu'on compare est donc le temps écoulé depuis la DERNIÈRE arrivée, contre
 * la période propre de la source. Pas la longueur de la file, qui ne dit rien
 * d'autre que « l'écran est plus rapide que le jeu ».
 */
export function isStarved(sinceLastArrivalMs: number, sourcePeriodMs: number): boolean {
  if (sourcePeriodMs <= 0) return true;
  return sinceLastArrivalMs > sourcePeriodMs * LATE;
}
