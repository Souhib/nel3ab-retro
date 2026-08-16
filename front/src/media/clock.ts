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
