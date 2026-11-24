/**
 * Ce qui est enfoncé sur la manette qu'on TIENT, en indices bruts.
 *
 * # Pourquoi ce n'est pas ce que `readPad` rend
 *
 * `readPad` applique la correspondance et rend ce que le JEU verra. C'est
 * précisément la moitié qu'on est venu vérifier: si les deux schémas lisaient la
 * même chose, appuyer sur une touche les allumerait tous les deux au même
 * endroit et n'apprendrait rien.
 *
 * Ici on lit la manette telle qu'elle est, sans rien traduire. Le schéma de
 * gauche montre ce que le jeu reçoit, celui de droite ce qu'on appuie, et
 * l'écart entre les deux EST l'information.
 *
 * # Le repos, pas zéro
 *
 * Un adaptateur GameCube rapporte une gâchette au repos à 0,6, et un stick qui
 * n'est pas centré. Le profil garde ces repos, mesurés pendant l'apprentissage;
 * on les soustrait ici comme la boucle d'entrée le fait, sinon la moitié des
 * pièces s'allument alors que personne ne touche à rien.
 */
import {
  BUTTON,
  MOVED,
  readPad,
  type ButtonName,
  type Control,
  type PadProfile,
  type PadReading,
  type StickAxis,
} from "../media/pad";
import type { Snapshot } from "../media/lesson";
import { SWITCH_BUTTONS, type SwitchReading } from "../media/switch";

/** Une manette réduite à ce qu'on lit d'elle. Un objet plutôt que `Gamepad`,
 * pour que ça s'écrive dans un essai sans navigateur. */
export type Raw = {
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
};

/** Ce que `heldOn` lit d'un réglage : les entrées nommées et leur repos.
 * Un profil Dolphin (`PadProfile`) et une manette de la trame Pro
 * (`SwitchDevice`, sans gâchettes à part) en ont tous les deux la forme. */
export type Reglage = {
  buttons: Partial<Record<string, Control>>;
  triggers?: { L?: Control; R?: Control };
  sticks: Partial<Record<string, StickAxis>>;
};

/** Ce qui est allumé sur le schéma physique: les clés de ses pièces.
 *
 * `neutre` est le repos qu'une leçon ou une réassignation a pris au clic
 * (`InputState.neutre`). Il complète les repos du profil pour les indices que
 * le profil ignore: pendant la leçon d'un adaptateur jamais réglé, la gâchette
 * posée à 0,62 restait sinon allumée sur son drapeau `pressed`, alors que la
 * détection, elle, lisait déjà la course depuis ce même repos. */
export function heldOn(
  raw: Raw,
  profile: Reglage | null,
  neutre: Snapshot | null = null,
): string[] {
  const rests = restsOf(profile, neutre);
  const lit: string[] = [];
  raw.buttons.forEach((button, at) => {
    const rest = rests.buttons.get(at);
    // Quand le profil connaît le repos de ce bouton, c'est la COURSE qui décide
    // et non le drapeau `pressed`. Une gâchette d'adaptateur GameCube repose à
    // 0,6, donc le navigateur la déclare enfoncée en permanence: la lire ferait
    // briller une pièce qui n'a rien reçu, sur l'écran même qui doit rassurer
    // sur ce que la salle voit. Trouvé par l'essai, avant tout dessin.
    if (rest !== undefined) {
      // Ramenée à SA course, comme `pad.travel` le fait pour la boucle d'entrée:
      // une gâchette qui repose à 0,6 n'a plus que 0,4 de course, et la comparer
      // au seuil sans la remettre à l'échelle la déclarerait jamais enfoncée.
      // Deux échelles différentes pour la même gâchette donneraient un schéma qui
      // s'allume à un autre moment que le jeu.
      const span = 1 - rest;
      if (span > 0 && (button.value - rest) / span > MOVED) lit.push(`b${at}`);
      return;
    }
    // Sans repos connu, le drapeau est ce qu'on a de mieux: une manette qu'on
    // vient de brancher doit s'allumer quand on appuie dessus.
    if (button.pressed || button.value > MOVED) lit.push(`b${at}`);
  });
  raw.axes.forEach((value, at) => {
    const rest = rests.axes.get(at) ?? 0;
    const travel = value - rest;
    if (Math.abs(travel) > MOVED) lit.push(`a${at}${travel > 0 ? "+" : "-"}`);
  });
  return lit;
}

/** Les repos que le profil connaît, rangés par indice.
 *
 * Un profil décrit des COMMANDES, pas des indices; il faut donc le retourner.
 * Deux commandes peuvent viser le même indice — c'est rare et ce n'est pas une
 * erreur — et la première gagne, parce qu'un repos est une propriété du matériel
 * et non de la commande.
 */
export function restsOf(
  profile: Reglage | null,
  neutre: Snapshot | null = null,
): {
  buttons: Map<number, number>;
  axes: Map<number, number>;
} {
  const buttons = new Map<number, number>();
  const axes = new Map<number, number>();
  // Le profil d'abord, le neutre de la leçon ensuite: `completer` n'écrit
  // qu'un indice que le profil n'a pas nommé.
  const completer = () => {
    neutre?.buttons.forEach((value, at) => {
      if (!buttons.has(at)) buttons.set(at, value);
    });
    neutre?.axes.forEach((value, at) => {
      if (!axes.has(at)) axes.set(at, value);
    });
    return { buttons, axes };
  };
  if (!profile) return completer();
  const note = (
    control: { button: number; rest?: number } | { axis: number; rest: number } | undefined,
  ) => {
    if (!control) return;
    if ("button" in control) {
      if (!buttons.has(control.button)) buttons.set(control.button, control.rest ?? 0);
      return;
    }
    if (!axes.has(control.axis)) axes.set(control.axis, control.rest);
  };
  for (const control of Object.values(profile.buttons)) note(control);
  note(profile.triggers?.L);
  note(profile.triggers?.R);
  for (const stick of Object.values(profile.sticks)) {
    if (stick && !axes.has(stick.axis)) axes.set(stick.axis, stick.rest ?? 0);
  }
  return completer();
}

/** Un stick incliné, dit dans le repère de l'ÉCRAN: `down` grandit vers le BAS.
 *
 * # Pourquoi ce type existe
 *
 * Les deux schémas s'inclinent à partir de nombres qui se ressemblent et
 * n'ont pas le même sens. Ce que le jeu reçoit compte le vertical vers le
 * HAUT — `readPad` nie déjà l'axe du navigateur, et c'est ce qui part sur le
 * fil. Le navigateur, lui, compte vers le BAS, comme SVG. Une paire de nombres
 * ne dit pas laquelle des deux on tient, et les deux côtés se sont donc
 * inclinés en sens contraires pour la même poussée.
 *
 * Le type ne se construit plus qu'en NOMMANT le repère d'où l'on vient. Un
 * appelant ne peut plus se tromper sans le dire.
 */
export type Tilt = { along: number; down: number };

/** Depuis un repère qui compte le vertical vers le HAUT: ce que le jeu reçoit. */
export function upward(along: number, up: number): Tilt {
  return { along, down: -up };
}

/** Depuis un repère qui compte le vertical vers le BAS: les axes du navigateur,
 * qui sont déjà ceux de l'écran. */
export function downward(along: number, down: number): Tilt {
  return { along, down };
}

/** Remplit le vrai balisage de PadMapView. Les deux lectures restent séparées:
 * readPad traduit la gauche, heldOn lit les indices bruts à droite. */
export function paintWiring(
  root: Element,
  live: Pick<Gamepad, "buttons" | "axes" | "timestamp"> | null,
  profile: PadProfile | null,
  neutre: Snapshot | null = null,
): void {
  const on = new Set(live ? heldOn(live, profile, neutre) : []);
  const reading = live ? readPad(live, profile) : { buttons: 0, x: 0, y: 0, cx: 0, cy: 0 };
  const axes = live?.axes ?? [];
  paintReading(root, reading, on, {
    a0: downward(axes[0] ?? 0, axes[1] ?? 0),
    a2: downward(axes[2] ?? 0, axes[3] ?? 0),
  });
}

/** Le dessin de sortie commun au clavier et à la manette physique.
 * La lecture d'entrée reste distincte : readKeys ou readPad. */
export function paintReading(
  root: Element,
  reading: Pick<PadReading, "buttons" | "x" | "y" | "cx" | "cy">,
  on = new Set<string>(),
  physical: Record<string, Tilt> = {},
): void {
  for (const name of Object.keys(BUTTON) as ButtonName[]) {
    if ((reading.buttons & BUTTON[name]) !== 0) on.add(name);
  }
  if (Math.abs(reading.x) > MOVED || Math.abs(reading.y) > MOVED) on.add("x");
  if (Math.abs(reading.cx) > MOVED || Math.abs(reading.cy) > MOVED) on.add("cx");
  for (const piece of root.querySelectorAll<SVGGElement>("[data-part]")) {
    poser(piece, "data-lit", on.has(piece.dataset["part"] ?? "") ? "oui" : "non");
  }
  const tilts: Record<string, Tilt> = {
    ...physical,
    x: upward(reading.x, reading.y),
    cx: upward(reading.cx, reading.cy),
  };
  tiltSticks(root, tilts);
}

/** Écrit un attribut seulement s'il change. La peinture tourne à chaque
 * image : une écriture identique coûte quand même un enregistrement à chaque
 * observateur (les tenues de la table, `tenues.ts`) et une invalidation de
 * style possible. */
function poser(el: Element, nom: string, valeur: string): void {
  if (el.getAttribute(nom) !== valeur) el.setAttribute(nom, valeur);
}

/** Incline le capot de chaque stick dessiné selon son `Tilt`. */
function tiltSticks(root: Element, tilts: Record<string, Tilt>): void {
  for (const piece of root.querySelectorAll<SVGGElement>("[data-stick]")) {
    const body = piece.querySelector<SVGGElement>(".n3-stick-body");
    const push = tilts[piece.dataset["stick"] ?? ""];
    if (!body || !push) continue;
    const travel = Number(body.dataset["drive"] ?? 0);
    poser(
      body,
      "transform",
      `translate(${(Math.max(-1, Math.min(1, push.along)) * travel).toFixed(2)} ${(Math.max(-1, Math.min(1, push.down)) * travel).toFixed(2)})`,
    );
  }
}

/** Les deux dessins de la trame Pro, chacun dans sa racine : les deux
 * portent des sticks nommés `a0` et `a2`, et une seule racine les confondrait.
 * La gauche lit la trame envoyée (`reading`, vertical vers le haut), la droite
 * les indices bruts de la manette (`heldOn`, vertical vers le bas), comme
 * pour Dolphin : l'écart entre les deux dit la correspondance qui manque. */
export function paintPro(
  gauche: Element,
  droite: Element | null,
  reading: SwitchReading,
  live: Raw | null,
  device: Reglage | null,
  neutre: Snapshot | null = null,
): void {
  const on = new Set<string>(SWITCH_BUTTONS.filter((_, at) => reading.buttons & (1 << at)));
  for (const piece of gauche.querySelectorAll<SVGGElement>("[data-part]")) {
    poser(piece, "data-lit", on.has(piece.dataset["part"] ?? "") ? "oui" : "non");
  }
  tiltSticks(gauche, { a0: upward(reading.lx, reading.ly), a2: upward(reading.rx, reading.ry) });
  if (!droite) return;
  const tenus = new Set(live ? heldOn(live, device, neutre) : []);
  for (const piece of droite.querySelectorAll<SVGGElement>("[data-part]")) {
    poser(piece, "data-lit", tenus.has(piece.dataset["part"] ?? "") ? "oui" : "non");
  }
  const axes = live?.axes ?? [];
  tiltSticks(droite, {
    a0: downward(axes[0] ?? 0, axes[1] ?? 0),
    a2: downward(axes[2] ?? 0, axes[3] ?? 0),
  });
}
