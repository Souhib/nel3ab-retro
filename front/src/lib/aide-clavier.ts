/**
 * Les touches du clavier, dites à la première visite.
 *
 * # Pourquoi
 *
 * Aucun écran de la salle ne donnait les touches par défaut: il fallait ouvrir
 * le menu, les réglages, « touches et manettes », puis l'onglet Clavier (audit
 * T02, 22 novembre 2026). Quelqu'un qui arrive sur un ordinateur sans manette
 * ne savait donc pas jouer, et celui qui appuyait sur A pour valider envoyait Z.
 *
 * # Lu dans le profil qui joue, jamais recopié
 *
 * La carte lit le jeu de touches ACTIF, celui que la boucle d'entrée applique.
 * Une liste écrite ici serait juste le premier jour et fausse dès qu'on change
 * une touche, et c'est justement la personne qui a changé ses touches qui
 * relira la carte pour vérifier.
 *
 * Deux trames, deux profils: la trame Dolphin pour la GameCube et la Wii, la
 * trame Pro pour la Switch et la Xbox 360. Le nom des commandes suit ce que
 * la place présente au jeu: « Start » sur une GameCube, « + » sur une Switch,
 * « Start » et « LB » sur une Xbox.
 *
 * # Une trame, trois lectures
 *
 * Dans une salle Wii, la trame Dolphin se lit comme une manette GameCube, une
 * Wiimote ou une guitare (docs/ecran-manettes.md). La première version de la
 * carte ne connaissait que la GameCube: à la Wiimote, elle disait « Entrée →
 * Start » et « S → X », là où le jeu lit + et 1 (relecture du 22 novembre
 * 2026). La carte prend donc l'appareil de la place:
 *
 * - les NOMS viennent de `controlsFor`, la lecture que le tableau des
 *   correspondances affiche déjà, flèche finale retirée;
 * - un BOUTON n'est dit que si le plan dessiné de l'appareil (`EMULATED`) a
 *   une pièce à sa clé: la guitare n'a ni croix gauche ni deuxième gâchette,
 *   la Wiimote seule n'a ni C ni Z;
 * - les deux STICKS sont toujours lus par Dolphin (stick, Nunchuk ou
 *   inclinaison; stick C ou pointeur), sauf la guitare, dont le vibrato ne lit
 *   que le stick C poussé à droite (`emulator::config::guitar_binds`).
 */
import { controlsFor, type ControlKey, type KeyProfile } from "../media/pad";
import type { SwitchTarget } from "../media/switch";
import { inscription } from "./faces";
import { EMULATED, GAMECUBE } from "./padmap";
import type { Pad } from "./saves";
import { labels as switchLabels, xboxLabels } from "./switch-labels";

/** Une ligne de la carte: les touches, ce qu'elles font dans le jeu, et les
 * commandes de la trame qu'elles pressent. `commandes` sert à la vue des
 * touches (`components/VueTouches`), qui allume la ligne quand la trame
 * envoyée en porte une: une `ControlKey` pour la trame Dolphin, une
 * `SwitchTarget` pour la trame Pro. */
export type Ligne = { touches: string; fait: string; commandes: readonly string[] };

/** Le nom imprimé d'une touche (`keyLabel` avec la disposition du clavier). */
export type Nom = (code: string) => string;

const FLECHES = ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"] as const;

/** Les quatre directions d'un stick, dans l'ordre haut, gauche, bas, droite.
 * « Flèches » quand ce sont exactement les quatre flèches: c'est ce que tout le
 * monde comprend, et quatre symboles de suite se lisent mal. */
function stick(
  codes: (string | undefined)[],
  nom: Nom,
  fait: string,
  commandes: readonly string[],
): Ligne | null {
  const presents = codes.filter((code): code is string => code !== undefined);
  if (presents.length === 0) return null;
  if (codes.every((code, at) => code === FLECHES[at]))
    return { touches: "Flèches", fait, commandes };
  return { touches: presents.map(nom).join(" "), fait, commandes };
}

const ou = (codes: string[], nom: Nom) => codes.map(nom).join(" ou ");

/** « + » seul devient « bouton + »: un signe isolé se lisait à peine à côté de
 * sa touche (capture de la relecture du 22 novembre 2026). */
export const lisible = (fait: string) => (/^[+−-]$/u.test(fait) ? `bouton ${fait}` : fait);

/** Ce que la place présente au jeu, pour une salle Dolphin. */
export type Lecture = { console: string; pad: Pad };

/** La guitare ne lit du stick C que le vibrato, poussé à droite
 * (`Guitar/Whammy/Bar = Axis C X +` dans `guitar_binds`). */
const GUITARE = 2;

/** Le nom d'une commande de la trame Dolphin pour l'appareil de la place.
 * « stick → » devient « stick »: la ligne porte les quatre directions.
 * « gâchette L » devient « L »: la carte range deux paires par ligne, et le
 * mot long passait sur deux lignes. Lu aussi par la vue de la manette
 * (`lib/verification`), pour que les deux vues nomment pareil. */
export function nommerDolphin(lecture: Lecture): (commande: ControlKey) => string {
  const pad: Pad = lecture.console === "wii" ? lecture.pad : 0;
  const noms = new Map<string, string>(
    controlsFor(lecture.console, pad).map((one) => [one.key, one.label]),
  );
  return (commande) =>
    lisible(
      (noms.get(commande) ?? commande).replace(/\s*[←↑→↓]$/u, "").replace(/^gâchette\s+/u, ""),
    );
}

/** Pour la trame Dolphin: GameCube et Wii, qui partagent le profil. */
export function aideDolphin(
  keys: KeyProfile,
  nom: Nom,
  lecture: Lecture = { console: "gc", pad: 0 },
): Ligne[] {
  // Une manette GameCube reste une manette GameCube, même dans une salle Wii.
  const pad: Pad = lecture.console === "wii" ? lecture.pad : 0;
  const plan = lecture.console === "wii" ? (EMULATED[pad] ?? GAMECUBE) : GAMECUBE;
  const pieces = new Set(plan.parts.map((part) => part.key));
  const dit = nommerDolphin(lecture);
  const entrees = Object.entries(keys);
  const boutons = (name: string) =>
    pieces.has(name)
      ? entrees
          .filter(([, action]) => action.kind === "button" && action.name === name)
          .map(([code]) => code)
      : [];
  const gachette = (side: "L" | "R") =>
    pieces.has(side)
      ? entrees
          .filter(
            ([, action]) =>
              (action.kind === "trigger" && action.side === side) ||
              (action.kind === "button" && action.name === side),
          )
          .map(([code]) => code)
      : [];
  const sens = (axe: "x" | "y" | "cx" | "cy", signe: 1 | -1) =>
    entrees.find(
      ([, action]) => action.kind === "stick" && action.stick === axe && action.sign === signe,
    )?.[0];

  // Le stick et Start d'abord: ce sont les deux qu'il faut pour commencer une
  // partie, et la carte les pose sur sa première ligne.
  const start = boutons("START");
  const lignes: (Ligne | null)[] = [
    stick([sens("y", 1), sens("x", -1), sens("y", -1), sens("x", 1)], nom, dit("x"), ["x", "y"]),
    start.length ? { touches: ou(start, nom), fait: dit("START"), commandes: ["START"] } : null,
  ];
  for (const commande of ["A", "B", "X", "Y", "Z"] as const) {
    const codes = boutons(commande);
    lignes.push(
      codes.length ? { touches: ou(codes, nom), fait: dit(commande), commandes: [commande] } : null,
    );
  }
  for (const side of ["L", "R"] as const) {
    const codes = gachette(side);
    lignes.push(
      codes.length ? { touches: ou(codes, nom), fait: dit(side), commandes: [side] } : null,
    );
  }
  const CROIX = ["D_UP", "D_LEFT", "D_DOWN", "D_RIGHT"] as const;
  const croix = CROIX.map((name) => boutons(name)[0]);
  lignes.push(stick(croix, nom, dit("D_UP"), CROIX));
  lignes.push(
    pad === GUITARE
      ? stick([sens("cx", 1)], nom, dit("cx"), ["cx"])
      : stick([sens("cy", 1), sens("cx", -1), sens("cy", -1), sens("cx", 1)], nom, dit("cx"), [
          "cx",
          "cy",
        ]),
  );
  return lignes.filter((ligne): ligne is Ligne => ligne !== null);
}

/** Pour la trame Pro: Switch, Switch 2 et Xbox 360, nommée selon la salle. */
export function aidePro(
  keys: Partial<Record<SwitchTarget, string>>,
  xbox: boolean,
  nom: Nom,
): Ligne[] {
  const noms = xbox ? xboxLabels : switchLabels;
  const gauche = ["ly+", "lx-", "ly-", "lx+"] as const;
  const droit = ["ry+", "rx-", "ry-", "rx+"] as const;
  const croix = ["UP", "LEFT", "DOWN", "RIGHT"] as const;
  const lignes: (Ligne | null)[] = [
    stick(
      gauche.map((cible) => keys[cible]),
      nom,
      "stick gauche",
      gauche,
    ),
  ];
  for (const cible of ["PLUS", "A", "B", "X", "Y", "L", "R", "ZL", "ZR", "MINUS"] as const) {
    const code = keys[cible];
    lignes.push(
      code
        ? { touches: nom(code), fait: lisible(inscription(noms[cible])), commandes: [cible] }
        : null,
    );
  }
  lignes.push(
    stick(
      croix.map((cible) => keys[cible]),
      nom,
      "croix",
      croix,
    ),
  );
  lignes.push(
    stick(
      droit.map((cible) => keys[cible]),
      nom,
      "stick droit",
      droit,
    ),
  );
  return lignes.filter((ligne): ligne is Ligne => ligne !== null);
}

/** La carte se souvient d'avoir été lue: repliée, elle le reste aux visites
 * suivantes. Une commodité du navigateur, protégée comme les autres: une
 * fenêtre privée la remontre, c'est tout. */
const VUE = "nel3ab:aide-clavier";

export function aideDejaVue(stockage: Pick<Storage, "getItem"> | null = lire()): boolean {
  try {
    return stockage?.getItem(VUE) === "vue";
  } catch {
    return false;
  }
}

export function retenirAideVue(vue: boolean, stockage: Pick<Storage, "setItem"> | null = lire()) {
  try {
    stockage?.setItem(VUE, vue ? "vue" : "ouverte");
  } catch {
    // Sans stockage, la carte se remontrera à la prochaine visite.
  }
}

function lire(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
