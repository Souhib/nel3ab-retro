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
import { MOVED, type PadProfile } from "../media/pad";

/** Une manette réduite à ce qu'on lit d'elle. Un objet plutôt que `Gamepad`,
 * pour que ça s'écrive dans un essai sans navigateur. */
export type Raw = {
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
};

/** Ce qui est allumé sur le schéma physique: les clés de ses pièces. */
export function heldOn(raw: Raw, profile: PadProfile | null): string[] {
  const rests = restsOf(profile);
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
function restsOf(profile: PadProfile | null): {
  buttons: Map<number, number>;
  axes: Map<number, number>;
} {
  const buttons = new Map<number, number>();
  const axes = new Map<number, number>();
  if (!profile) return { buttons, axes };
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
  note(profile.triggers.L);
  note(profile.triggers.R);
  for (const stick of Object.values(profile.sticks)) {
    if (stick && !axes.has(stick.axis)) axes.set(stick.axis, stick.rest ?? 0);
  }
  return { buttons, axes };
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
