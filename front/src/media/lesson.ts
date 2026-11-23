/**
 * Learning a pad, as a state machine over snapshots.
 *
 * Pure on purpose: the defect this had — one press answering two questions —
 * is a SEQUENCE, and the only way to see it was to drive a real browser frame
 * by frame with a real gamepad. Feeding snapshots to a function instead makes
 * that a unit test, and the same defect could not survive it.
 */
import {
  BUTTON,
  CONTROLS,
  MOVED,
  isStick,
  controlsFor,
  type ButtonName,
  type Control,
  type PadProfile,
} from "./pad";

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

/** Les ports d'un adaptateur partagent leur profil et leur diagnostic. */
export function modelSnapshot(pads: readonly (Gamepad | null)[], like: Gamepad): Snapshot {
  let merged: Snapshot | null = null;
  for (const pad of pads) {
    if (!pad || pad.id !== like.id) continue;
    const one = snapshot(pad);
    merged = merged === null ? one : loudest(merged, one);
  }
  return merged ?? snapshot(like);
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
      // Le repos voyage AVEC la commande. Sans lui, un adaptateur qui pose sa
      // gâchette à 0,6 au repos donne un bouton tenu pendant toute la partie, et
      // rien en aval ne peut plus le rattraper: l'instantané neutre n'est qu'ici.
      best = { control: { button: index, rest: neutral.buttons[index] ?? 0 }, value, moved };
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
/** L'indice d'une entrée tel que les dessins le nomment (`heldOn`) : `b6`
 * pour un bouton, `a2-` pour un axe poussé vers le négatif. */
export function indiceDe(control: Control, value: number): string {
  if ("button" in control) return `b${control.button}`;
  return `a${control.axis}${value >= control.rest ? "+" : "-"}`;
}

/** L'entrée physique d'une commande, sans son sens : `b6` ou `a2`. */
export function entreeDe(control: Control | { axis: number }): string {
  return "button" in control ? `b${control.button}` : `a${control.axis}`;
}

/**
 * Les entrées que les réponses d'une leçon ont prises.
 *
 * Une commande passée garde son réglage d'avant, SAUF si une réponse a pris
 * son entrée : répondre b2 pour A sur une manette standard, puis passer X
 * (standard sur b2), laisserait b2 presser A et X à la fois. La leçon est un
 * nouveau plan de la manette, et une entrée y fait une seule chose, comme une
 * touche du clavier (`bindKey`). X reste alors sans réglage, et la table le
 * montre.
 */
export function entreesPrises(reponses: readonly (Control | { axis: number })[]): Set<string> {
  return new Set(reponses.map(entreeDe));
}

export class Capture {
  private readonly neutral: Snapshot;

  constructor(neutral: Snapshot) {
    this.neutral = neutral;
  }

  /** Le repos pris au clic, lu par les dessins comme celui d'une leçon. */
  get repos(): Snapshot {
    return this.neutral;
  }

  feed(now: Snapshot): { control: Control; value: number } | null {
    const best = furthest(this.neutral, now);
    return best === null ? null : { control: best.control, value: best.value };
  }
}

/** Ce qu'un pas à pas a laissé : combien de commandes ont reçu une réponse,
 * lesquelles ont été passées, et ce que gardent les passées. « avant » : le
 * réglage rangé de cette manette ; « standard » : la disposition standard
 * d'une manette qui n'en avait pas ; « rien » : un adaptateur jamais réglé,
 * où une commande passée reste sans réglage. */
export type FinDe<K extends string> = {
  retenues: number;
  passees: K[];
  garde: "avant" | "standard" | "rien";
};

/**
 * Ce que la boucle dit d'un réglage, au moment où ça arrive.
 *
 * L'instantané React se lit deux fois par seconde (règle 8) : les marques
 * d'une étape (cadre de la touche attendue, coins d'un appui) ne peuvent pas
 * le suivre. Elles s'abonnent à la boucle, dans un module ordinaire (constat
 * C9). `indice` est nommé comme les pièces du dessin de droite (`heldOn`).
 */
export type EvenementDe<K extends string> =
  | { type: "etape"; control: K; etape: number; total: number }
  | { type: "recu"; control: K; indice: string }
  | { type: "relache" }
  | { type: "fin"; resultat: FinDe<K> }
  | { type: "suspendu"; etape: number }
  | { type: "premiere-manette"; id: string };

/** Les abonnés aux moments d'un réglage. Un abonné qui lève ne doit jamais
 * arrêter la boucle d'entrée : elle porte aussi la partie des autres. */
export class Annonces<E> {
  private readonly ecoutes = new Set<(evenement: E) => void>();

  /** S'abonne ; rend la fonction qui désabonne. */
  ecouter(ecoute: (evenement: E) => void): () => void {
    this.ecoutes.add(ecoute);
    return () => {
      this.ecoutes.delete(ecoute);
    };
  }

  emettre(evenement: E): void {
    for (const ecoute of this.ecoutes) {
      try {
        ecoute(evenement);
      } catch {
        /* l'abonné est seul responsable de ce qu'il fait */
      }
    }
  }
}

/**
 * La machine d'étapes commune aux deux trames : une question à la fois, un
 * repos pris UNE fois, l'attente du relâchement entre deux réponses, et la
 * liste des étapes passées. Ce qu'une réponse écrit appartient à la trame
 * (`retenir`) : un profil Dolphin pour `Lesson`, un `SwitchDevice` pour la
 * leçon Pro de `media/switch`.
 */
export class Pas<K extends string> {
  step = 0;
  /** Waiting for the hand to let go before the next question is asked. */
  waiting = false;
  /** La dernière réponse retenue, et la valeur qui l'a donnée. */
  dernier: { key: K; control: Control; value: number } | null = null;
  /** Les commandes passées, dans l'ordre où elles ont été demandées. */
  readonly passees: K[] = [];

  /** The neutral sample is taken ONCE, with nothing held. Re-reading it after
   * each answer was the bug: the sample was taken while the button was still
   * down, so RELEASING it moved just as far as pressing and answered the next
   * question. One press of A took the counter from 1 to 3. */
  private neutral: Snapshot;
  private readonly keys: readonly K[];
  private readonly estStick: (key: K) => boolean;
  private readonly retenir: (key: K, control: Control, value: number) => void;

  constructor(
    neutral: Snapshot,
    keys: readonly K[],
    estStick: (key: K) => boolean,
    retenir: (key: K, control: Control, value: number) => void,
  ) {
    this.neutral = neutral;
    this.keys = keys;
    this.estStick = estStick;
    this.retenir = retenir;
  }

  get done(): boolean {
    return this.step >= this.keys.length;
  }

  /** Combien d'étapes compte cette leçon. */
  get total(): number {
    return this.keys.length;
  }

  /** La commande demandée maintenant, ou rien quand c'est fini. */
  get demandee(): K | null {
    return this.keys[this.step] ?? null;
  }

  /** Combien de commandes ont reçu une réponse. */
  get retenues(): number {
    return this.step - this.passees.length;
  }

  /** Le repos pris au clic sur « Commencer ». Les dessins le lisent pendant la
   * leçon (`heldOn`), à la même échelle que la détection. */
  get repos(): Snapshot {
    return this.neutral;
  }

  /**
   * Reprend une leçon suspendue par un débranchement, avec un repos pris au
   * clic sur « Reprendre ». Les réponses et les passées sont gardées.
   *
   * Un repos nouveau et pas l'ancien : la manette rebranchée peut reposer
   * ailleurs (un adaptateur qui a changé de port), et c'est le même instant
   * qu'au début, mains hors de la manette. La leçon attend ensuite le repos
   * avant la question suivante, comme après une réponse.
   */
  reprendre(neutre: Snapshot): void {
    this.neutral = neutre;
    this.waiting = true;
  }

  /** Skips the control being asked for: not every pad has every button. */
  skip(): void {
    const current = this.keys[this.step];
    if (current !== undefined) this.passees.push(current);
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

    const key = this.keys[this.step]!;
    // Un bouton ne valide pas une question de stick.
    if (this.estStick(key) && !("axis" in best.control)) return false;
    this.retenir(key, best.control, best.value);
    this.dernier = { key, control: best.control, value: best.value };
    this.step += 1;
    this.waiting = true;
    return true;
  }

  atRest(now: Snapshot): boolean {
    return (
      now.buttons.every(
        (value, index) => Math.abs(value - (this.neutral.buttons[index] ?? 0)) <= MOVED,
      ) &&
      now.axes.every((value, index) => Math.abs(value - (this.neutral.axes[index] ?? 0)) <= MOVED)
    );
  }
}

/** La leçon de la trame Dolphin : seize commandes, dans un profil GameCube. */
export class Lesson extends Pas<StepKey> {
  private readonly profile: PadProfile;
  /** Les questions, nommées pour la console qu'on joue.
   *
   * La manette apprise est la même — la page envoie toujours la même trame — mais
   * personne ne cherche « le bouton X » sur une Wiimote. Ce sont les mots qui
   * changent, pas ce qu'on enregistre. */
  private readonly steps: { key: StepKey; ask: string }[];

  constructor(id: string, neutral: Snapshot, console = "gc", pad: 0 | 1 | 2 | 3 = 0) {
    const profile: PadProfile = { id, buttons: {}, triggers: {}, sticks: {} };
    const steps = controlsFor(console, pad).map(({ key, ask }) => ({ key, ask }));
    super(
      neutral,
      steps.map((one) => one.key),
      isStick,
      (key, control, value) => {
        if (key === "L" || key === "R") {
          profile.triggers[key] = control;
        } else if (key === "x" || key === "y" || key === "cx" || key === "cy") {
          // A stick is signed, and the sign is whichever way the player just
          // pushed: asking for RIGHT and UP means the recorded direction IS
          // positive.
          if ("axis" in control) {
            profile.sticks[key] = {
              axis: control.axis,
              sign: value >= control.rest ? 1 : -1,
              // Un stick de GameCube ne revient pas au centre. Le garder ici
              // est ce qui évite un personnage qui marche tout seul pendant
              // tout un match.
              rest: control.rest,
            };
          }
        } else {
          profile.buttons[key as ButtonName] = control;
        }
      },
    );
    this.profile = profile;
    this.steps = steps;
  }

  get asking(): string {
    return this.done ? "" : (this.steps[this.step]?.ask ?? "");
  }

  get progress(): { control: StepKey; step: number; total: number; waiting: boolean } | null {
    const current = this.steps[this.step];
    return current
      ? {
          control: current.key,
          step: this.step + 1,
          total: this.steps.length,
          waiting: this.waiting,
        }
      : null;
  }

  /**
   * Le profil appris, et pour chaque commande passée, son réglage d'avant.
   *
   * `precedent` est le profil rangé de cette manette, ou la disposition
   * standard d'une manette standard qui n'en avait pas. Sans lui (adaptateur
   * jamais réglé), une commande passée reste sans réglage. Avant le 23 novembre
   * 2026, la fin rendait les seules réponses : passer B pour « le garder »
   * l'effaçait, puisque `readPad` ne retombe pas sur la disposition standard
   * quand un profil existe (constat C4 du chantier manettes).
   */
  learned(precedent: PadProfile | null = null): PadProfile {
    const out = structuredClone(this.profile);
    if (!precedent) return out;
    const prises = entreesPrises([
      ...Object.values(out.buttons),
      ...Object.values(out.triggers),
      ...Object.values(out.sticks),
    ]);
    const libre = (entree: Control | { axis: number }) => !prises.has(entreeDe(entree));
    for (const key of this.passees) {
      if (key === "L" || key === "R") {
        const avant = precedent.triggers[key];
        if (avant && libre(avant)) out.triggers[key] = structuredClone(avant);
      } else if (isStick(key)) {
        const avant = precedent.sticks[key];
        if (avant && libre(avant)) out.sticks[key] = structuredClone(avant);
      } else {
        const avant = precedent.buttons[key as ButtonName];
        if (avant && libre(avant)) out.buttons[key as ButtonName] = structuredClone(avant);
      }
    }
    return out;
  }
}

export const BUTTON_NAMES = Object.keys(BUTTON) as ButtonName[];
