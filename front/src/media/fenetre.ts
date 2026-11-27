/**
 * Ce qu'une fenêtre de relevé a vu de pire, et quand.
 *
 * # Pourquoi des maxima pris et pas des compteurs soustraits
 *
 * Le relevé de dix secondes compare deux instantanés : un total se soustrait,
 * un maximum non. « Le plus long arrêt vu au verre » de la fenêtre ne se
 * déduit pas de celui de la fenêtre d'avant. Chaque flux garde donc ses pics
 * depuis le dernier relevé, et le relevé les PREND, ce qui les remet à zéro
 * (`Session.fenetre`). Un signalement les lit sans les prendre : il ne doit
 * pas voler sa fenêtre au relevé suivant.
 *
 * # Nul et pas zéro
 *
 * Une fenêtre sans mesure rend `null`. Un zéro publié à la place d'une mesure
 * absente a déjà fait lire « reçue 0 ms » à une page qui avait reçu une seule
 * image (21 novembre 2026, CLAUDE.md).
 *
 * # Rien ici ne touche au chemin des images
 *
 * Une comparaison par image, un ajout dans un tableau borné par morceau de
 * son. Le tri n'a lieu qu'au relevé, toutes les dix secondes.
 */

/** Le plus grand d'une fenêtre, et l'instant où il a été vu. */
export class Pic {
  private max: number | null = null;
  private at: number | null = null;

  /** Une valeur de plus, vue à `at` (l'horloge de la page). */
  note(value: number, at: number): void {
    if (this.max !== null && value <= this.max) return;
    this.max = value;
    this.at = at;
  }

  /** Le pic de la fenêtre, et on repart de rien si `prendre`. */
  lire(prendre: boolean): { max: number | null; at: number | null } {
    const vu = { max: this.max, at: this.at };
    if (prendre) this.vider();
    return vu;
  }

  vider(): void {
    this.max = null;
    this.at = null;
  }
}

/** Combien d'échantillons une `Serie` garde au plus : dix secondes de son en
 * morceaux de 10 ms, et deux fenêtres d'avance pour un minuteur en retard. */
export const SERIE_MAX = 3000;

/** Les valeurs d'une fenêtre. Bornée : un onglet dont le minuteur ne vient
 * plus ne doit pas faire grossir la mémoire de la page. Au-delà de la borne,
 * les plus vieilles partent les premières. */
export class Serie {
  private values: number[] = [];

  note(value: number): void {
    this.values.push(value);
    if (this.values.length > SERIE_MAX) this.values.shift();
  }

  /** Les valeurs de la fenêtre, rangées, ou nul sans aucune. On repart de
   * rien si `prendre`. */
  lire(prendre: boolean): number[] | null {
    const vues = this.values;
    if (prendre) this.values = [];
    if (vues.length === 0) return null;
    return [...vues].sort((a, b) => a - b);
  }

  vider(): void {
    this.values = [];
  }
}

/** Le rang le plus proche de `quantile` dans des valeurs déjà rangées. */
export function rang(rangees: readonly number[], quantile: number): number {
  return rangees[Math.min(rangees.length - 1, Math.round((rangees.length - 1) * quantile))];
}

/** `[min, médiane, max]` de valeurs rangées, arrondis à la milliseconde. */
export function etendue(rangees: readonly number[]): [number, number, number] {
  return [
    Math.round(rangees[0]),
    Math.round(rang(rangees, 0.5)),
    Math.round(rangees[rangees.length - 1]),
  ];
}

/** Un nombre arrondi, ou nul s'il n'y en a pas. */
export function arrondi(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}
