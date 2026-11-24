/**
 * Le plan du banc d'essai: ce qu'on montre d'une manette qu'on ne connaît pas.
 *
 * # Pourquoi un plan plutôt qu'un gabarit
 *
 * Un banc d'essai montre la manette TELLE QU'ELLE S'ANNONCE, pas telle qu'on
 * l'espérait. Une manette standard rend quatre axes et dix-sept boutons; un
 * adaptateur GameCube en rend ce qu'il veut, et le sien n'a rien de standard.
 * Écrire deux sticks en dur afficherait juste, mais seulement pour les manettes
 * qu'on a sous la main.
 *
 * Le plan se calcule donc du NOMBRE d'axes annoncés. Les axes vont par deux
 * dans un cadran, et le dernier axe d'un compte impair reste seul — montré
 * comme une valeur, sans cadran. C'est le cas qui compte: un compte impair
 * n'est pas une erreur, c'est une pédale, un curseur ou un adaptateur, et
 * l'arrondir en bas ferait disparaître un axe sans rien dire.
 */
import { fantome } from "../retro/chiffres";

/** Deux axes montrés ensemble dans un cadran. */
export type Scope = { name: string; along: number; down: number };

/** Un axe qui n'a pas de partenaire: une valeur, pas un cadran. */
export type Lone = { name: string; axis: number };

export type Bench = { scopes: Scope[]; lone: Lone[] };

/** Les deux premières paires ont un nom qu'une main reconnaît. Au-delà, on ne
 * sait pas ce que c'est et on le dit par ses indices plutôt que d'inventer. */
const NAMED = ["stick gauche", "stick droit"];

export function bench(axes: number): Bench {
  const count = Number.isFinite(axes) && axes > 0 ? Math.floor(axes) : 0;
  const scopes: Scope[] = [];
  const lone: Lone[] = [];
  for (let at = 0; at + 1 < count; at += 2) {
    const pair = at / 2;
    scopes.push({ name: NAMED[pair] ?? `axes ${at}·${at + 1}`, along: at, down: at + 1 });
  }
  if (count % 2 === 1) lone.push({ name: `axe ${count - 1}`, axis: count - 1 });
  return { scopes, lone };
}

/** Ce que le banc lit d'une manette. Un objet plutôt que `Gamepad`, pour que
 * ça s'écrive dans un essai sans navigateur. */
export type Live = {
  buttons: readonly { value: number }[];
  axes: readonly number[];
  timestamp: number;
};

/** Écrit les chiffres du banc dans le DOM déjà rendu.
 *
 * # Pourquoi ici et pas dans le composant
 *
 * Les marques `data-gauge` et `data-scope` sont un contrat entre le composant
 * qui les pose et la boucle qui écrit dedans. Tant que les deux moitiés
 * vivaient dans deux fichiers, le contrat n'était écrit nulle part et rien ne
 * pouvait le vérifier. Ici il est dans une fonction, donc un essai peut poser
 * le balisage, appeler, et lire ce qui a été écrit — sans navigateur.
 *
 * Rien ne rend React: vingt nombres à soixante hertz feraient soixante rendus
 * par seconde d'un écran qui n'en demande aucun (règle 8).
 *
 * `repos` donne, par indice, le repos appris d'un bouton (`restsOf` de
 * `lib/wiring.ts`). Sa jauge part alors de ce repos et s'étend sur la course
 * qui reste, comme `heldOn` et la boucle d'entrée la lisent: une gâchette
 * d'adaptateur posée à 0,62 montre une jauge vide au repos, pleine au fond.
 */
export function paintBench(
  root: ParentNode,
  live: Live,
  repos: ReadonlyMap<number, number> = new Map(),
): void {
  const write = (mark: string, value: number, digits: number, fill: number) => {
    const box = root.querySelector(`[data-gauge="${mark}"]`);
    if (!box) return;
    const shown = box.querySelector(".n3-value");
    if (shown) shown.textContent = value.toFixed(digits);
    const part = box.querySelector<HTMLElement>(".n3-fill");
    if (part) part.style.height = `${Math.min(100, Math.max(0, fill) * 100).toFixed(1)}%`;
  };

  live.buttons.forEach((button, at) => {
    const rest = repos.get(at) ?? 0;
    write(`b${at}`, button.value, 2, rest < 1 ? (button.value - rest) / (1 - rest) : 0);
  });
  // La jauge d'un axe montre une COURSE, donc une distance au repos: un axe à
  // -0,9 est aussi loin de zéro qu'un axe à 0,9, et le signe se lit sur le
  // chiffre. Sans la valeur absolue, la moitié des axes auraient une jauge vide.
  live.axes.forEach((value, at) => write(`a${at}`, value, 5, Math.abs(value)));

  for (let at = 0; at + 1 < live.axes.length; at += 2) {
    const scope = root.querySelector(`[data-scope="a${at}"]`);
    if (!scope) continue;
    // Les axes du navigateur comptent déjà comme l'écran, le bas positif: pas
    // de conversion ici, contrairement au schéma de gauche. Voir `Tilt`.
    const x = Math.max(-1, Math.min(1, live.axes[at] ?? 0)).toFixed(3);
    const y = Math.max(-1, Math.min(1, live.axes[at + 1] ?? 0)).toFixed(3);
    const needle = scope.querySelector(".n3-needle");
    needle?.setAttribute("x2", x);
    needle?.setAttribute("y2", y);
    const dot = scope.querySelector(".n3-dot");
    dot?.setAttribute("cx", x);
    dot?.setAttribute("cy", y);
  }

  // L'horodatage est un afficheur (`retro/chiffres.ts`) : sa valeur s'écrit
  // sans rouler, puisqu'elle change à chaque image, et son fantôme suit sa
  // longueur.
  const stamp = root.querySelector('[data-gauge="stamp"] .n3-value');
  if (stamp) {
    const text = live.timestamp.toFixed(0);
    stamp.textContent = text;
    const ghost = stamp.previousElementSibling;
    if (ghost && ghost.textContent?.length !== text.length) ghost.textContent = fantome(text);
  }
}
