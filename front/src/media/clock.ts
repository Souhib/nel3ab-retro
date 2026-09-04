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
 * La marge la plus grande que la page s'autorise, en millisecondes.
 *
 * C'était 60, choisi quand toutes les liaisons d'essai étaient bonnes. Une
 * capture envoyée le 2026-08-16 par quelqu'un sur une connexion moyenne montre
 * pourquoi c'est trop peu: sa marge était collée à 60, ses écarts d'arrivée
 * montaient à 67 ms au p95, et la page a compté 513 famines en 214 secondes. Un
 * plafond doit être au-dessus de la gigue qu'il est censé absorber.
 *
 * Pourquoi un plafond quand même. Attendre répare une liaison IRRÉGULIÈRE, pas
 * une liaison trop ÉTROITE: si le débit ne passe pas, la marge grandirait sans
 * fin et n'achèterait que du retard. 180 ms font onze images; au-delà la manette
 * ne se pilote plus, donc mieux vaut une image qui saute qu'un jeu injouable.
 */
export const SLACK_CEILING = 180;

/** La marge la plus petite. Zéro voudrait dire « aucune tolérance », et une
 * image arrivée une milliseconde en retard serait déjà périmée. */
export const SLACK_FLOOR = 3;

/**
 * La marge suivante, d'après les famines de la fenêtre qui vient de s'écouler.
 *
 * Elle monte vite et redescend lentement, et c'est voulu: une famine se voit,
 * une marge de trop ne se voit pas. Elle redescend quand même, sinon une seule
 * mauvaise minute coûterait du retard à la manette pour toute la partie.
 */
export function nextSlack(current: number, starved: number, evicted = 0): number {
  // Une image JETÉE de la file interdit d'agrandir la marge, et c'est ce qui
  // casse un emballement.
  //
  // Jeter veut dire qu'une image est arrivée, a attendu son tour, et que la file
  // a débordé avant que son tour vienne: l'horaire est donc trop TARD pour la
  // file. Grandir le retarde encore, ce qui fait déborder plus tôt, ce qui vide
  // la file au mauvais moment, ce qui compte une famine, ce qui fait grandir.
  // Mesuré chez quelqu'un le 2026-08-17: 8594 images arrivées, 4971 peintes,
  // 321 famines, et une marge montée à 121 ms pour un lien qui livrait à
  // 16,3 ms d'écart — soit exactement la cadence de la source.
  if (evicted > 0) return current;
  if (starved > 1) return Math.min(SLACK_CEILING, current + 8);
  if (starved === 0) return Math.max(SLACK_FLOOR, current - 2);
  return current;
}

/** Le moins d'images que la file garde, quoi qu'il arrive. */
export const QUEUE_FLOOR = 8;
/** Le plus. Vingt-quatre images décodées de 1216x896 tiennent dans une
 * quarantaine de mégaoctets de mémoire graphique, ce qui est acceptable; au-delà
 * on paierait de la mémoire pour un retard que personne ne veut jouer. */
export const QUEUE_CEILING = 24;
/** Des places en plus, pour la rafale qui arrive pendant qu'on peint. */
const QUEUE_MARGIN = 4;

/**
 * Combien d'images la file doit pouvoir retenir, d'après l'horaire.
 *
 * DÉRIVÉ et non fixé, parce que c'est la même grandeur écrite deux fois:
 * l'horaire retarde chaque image de `boughtMs` millisecondes, et la file doit
 * pouvoir garder autant d'images que ça représente. Deux écritures d'une même
 * grandeur finissent par ne plus être d'accord, et c'est arrivé: le plafond de
 * marge est passé de 60 à 180 ms sans que la file bouge de ses huit images, soit
 * 133 ms. Les images arrivaient, attendaient leur tour, et étaient jetées avant
 * — 58 % peintes chez quelqu'un dont le lien livrait pourtant à l'heure.
 *
 * La propriété qui compte: une bonne liaison n'achète presque rien, donc elle
 * retombe sur le plancher et garde exactement le comportement d'avant.
 */
export function roomFor(boughtMs: number, periodMs: number): number {
  const period = Math.max(1, periodMs);
  const needed = Math.ceil(Math.max(0, boughtMs) / period) + QUEUE_MARGIN;
  return Math.min(QUEUE_CEILING, Math.max(QUEUE_FLOOR, needed));
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

/** Combien de fenêtres d'affilée la marge doit rester au plafond pour conclure.
 *
 * Cinq, soit dix secondes: la marge monte de huit millisecondes par fenêtre, donc
 * atteindre le plafond depuis le plancher demande déjà une vingtaine de fenêtres
 * de famine continue. Y RESTER cinq de plus n'arrive pas par accident.
 *
 * Plus court prendrait une mauvaise minute pour un mauvais lien et réduirait
 * l'image de quelqu'un qui n'avait qu'un hoquet. Plus long laisserait la
 * personne subir une image qui traîne pendant qu'on hésite.
 */
export const GIVE_UP_WINDOWS = 5;

/** Depuis combien de fenêtres l'allure a renoncé.
 *
 * # Pourquoi ce nombre veut dire quelque chose
 *
 * La marge existe pour absorber une arrivée irrégulière: quand la page manque
 * d'images, elle grandit, ce qui ajoute du retard mais lisse le mouvement. C'est
 * la bonne réponse à un réseau qui hoquette.
 *
 * Ce n'est PAS la bonne réponse à un lien trop étroit. Là, la marge monte
 * jusqu'au plafond et y reste, et tout ce qu'elle a fait est transformer un
 * manque de débit en retard permanent — ce qui se voit comme une image au
 * ralenti qui saute de temps en temps. Rapporté le 2026-09-04 exactement dans
 * ces mots.
 *
 * La marge collée au plafond est donc le signal que l'allure a fait tout ce
 * qu'elle pouvait et que ça ne suffit pas. Ce qu'il faut alors n'est pas plus de
 * marge, c'est moins d'octets.
 */
export function stuckAtCeiling(previous: number, slackMs: number): number {
  return slackMs >= SLACK_CEILING ? previous + 1 : 0;
}

/** L'allure a-t-elle renoncé ? */
export function pacingGaveUp(windowsAtCeiling: number): boolean {
  return windowsAtCeiling >= GIVE_UP_WINDOWS;
}
