/**
 * La vue « Tes touches » et « Ta manette » : ce que chaque commande presse sur
 * la console de la salle, et quand une ligne s'allume (23 novembre 2026,
 * chantier salle, étape 6).
 *
 * # Lu dans le produit, jamais recopié
 *
 * La vue de la manette ne tient aucune table. Pour chaque commande de la
 * manette branchée, elle construit une manette simulée où seule cette commande
 * est pressée, et la fait lire par la fonction que la boucle d'entrée appelle
 * vraiment : `readPad` pour une salle Dolphin, `readSwitch` pour une salle
 * Switch ou Xbox 360. Ce qui sort de la lecture est ce que la salle recevrait.
 *
 * C'est la leçon du 11 septembre 2026 : l'essai attendait le même code faux
 * que l'aide, et le X de la page arrivait Y dans chaque jeu. Une table écrite
 * ici aurait été juste le premier jour et fausse dès qu'un profil change.
 * docs/ecran-manettes.md dit la même chose autrement : une trame, trois
 * lectures. La vue suit la lecture de la place.
 *
 * # Quand une ligne s'allume
 *
 * Une ligne s'allume quand la trame envoyée porte l'une de ses commandes, que
 * l'écho de la socket des manettes date de moins de deux secondes et, au
 * clavier, que le focus est dans la zone de jeu (hors de la zone, les touches
 * ne partent pas : `lib/focus-jeu`). L'écho part chaque seconde
 * (`media/input.ts`, ECHO_EVERY_MS) : un seuil d'une seconde ferait clignoter
 * la ligne, deux périodes ne le font pas.
 *
 * La coche dit « envoyée », jamais « reçue » : la salle ne renvoie pas encore
 * d'accusé par bouton (plan donnees, D21).
 *
 * # Ce que l'instantané dit aujourd'hui
 *
 * `InputState.pressed` ne porte que les boutons de la trame Dolphin. Les
 * sticks, les gâchettes analogiques et toute la trame Pro n'y sont pas : le
 * chantier manettes les y ajoute (K34, il possède `media/input.ts`). Une ligne
 * dont aucune commande n'est suivie n'a pas de case du tout. Une case qui ne
 * s'allumerait jamais dirait « rien n'est parti » à tort.
 */
import { identify, buttonLabel } from "../media/families";
import { BUTTON, readPad, type ButtonName, type ControlKey, type PadProfile } from "../media/pad";
import {
  readSwitch,
  SWITCH_AXES,
  SWITCH_BUTTONS,
  type SwitchProfile,
  type SwitchTarget,
} from "../media/switch";
import { lisible, nommerDolphin, type Lecture, type Ligne } from "./aide-clavier";
import { inscription } from "./faces";
import { labels as switchLabels, xboxLabels } from "./switch-labels";

/** Deux périodes d'écho (`media/input.ts`, ECHO_EVERY_MS = 1000). */
export const ECHO_FRAIS_MS = 2000;

/** La manette branchée, telle que le navigateur la présente. */
export type ManetteLue = { id: string; mapping: string; boutons: number; axes: number };

/** Une commande de la manette : les boutons et les sens d'axe qui la font. */
type Commande = { nom: string; boutons: number[]; axes: { axe: number; sens: 1 | -1 }[] };

/** Les quinze commandes d'une manette standard : douze boutons, la croix et
 * les deux sticks. Une disposition inconnue n'a pas de nom : chaque bouton et
 * chaque axe y est dit par son numéro (`media/families`). */
function commandesDe(manette: ManetteLue): Commande[] {
  const identite = identify(manette.id, manette.mapping);
  if (manette.mapping === "standard") {
    const seuls: Commande[] = Array.from({ length: 12 }, (_, i) => ({
      nom: buttonLabel(identite, i),
      boutons: [i],
      axes: [],
    }));
    return [
      ...seuls,
      { nom: "croix", boutons: [12, 13, 14, 15], axes: [] },
      {
        nom: "stick gauche",
        boutons: [],
        axes: [
          { axe: 0, sens: 1 },
          { axe: 0, sens: -1 },
          { axe: 1, sens: 1 },
          { axe: 1, sens: -1 },
        ],
      },
      {
        nom: "stick droit",
        boutons: [],
        axes: [
          { axe: 2, sens: 1 },
          { axe: 2, sens: -1 },
          { axe: 3, sens: 1 },
          { axe: 3, sens: -1 },
        ],
      },
    ];
  }
  return [
    ...Array.from({ length: manette.boutons }, (_, i) => ({
      nom: buttonLabel(identite, i),
      boutons: [i],
      axes: [],
    })),
    ...Array.from({ length: manette.axes }, (_, axe) => ({
      nom: `axe ${axe}`,
      boutons: [],
      axes: [
        { axe, sens: 1 as const },
        { axe, sens: -1 as const },
      ],
    })),
  ];
}

/** Une manette simulée où seule une entrée est pressée, à fond. */
function simulee(
  manette: ManetteLue,
  bouton: number | null,
  axe: number | null,
  sens = 1,
): Gamepad {
  const boutons = Array.from({ length: Math.max(17, manette.boutons) }, (_, i) => ({
    pressed: i === bouton,
    touched: i === bouton,
    value: i === bouton ? 1 : 0,
  }));
  const axes = Array.from({ length: Math.max(4, manette.axes) }, (_, i) => (i === axe ? sens : 0));
  return {
    id: manette.id,
    index: 0,
    connected: true,
    mapping: manette.mapping as GamepadMappingType,
    axes,
    buttons: boutons,
    timestamp: 0,
    vibrationActuator: null,
    hapticActuators: [],
  } as unknown as Gamepad;
}

/** Les entrées d'une commande, chacune pressée seule. */
function pressions(manette: ManetteLue, commande: Commande): Gamepad[] {
  return [
    ...commande.boutons.map((b) => simulee(manette, b, null)),
    ...commande.axes.map(({ axe, sens }) => simulee(manette, null, axe, sens)),
  ];
}

/** Ce qu'une lecture Dolphin presse, dans l'ordre de la trame. */
function presseDolphin(pad: Gamepad, profil: PadProfile | null): ControlKey[] {
  const lu = readPad(pad, profil);
  const boutons = (Object.keys(BUTTON) as ButtonName[]).filter(
    (n) => (lu.buttons & BUTTON[n]) !== 0,
  );
  const sticks = (["x", "y", "cx", "cy"] as const).filter((axe) => lu[axe] !== 0);
  // Une gâchette à fond clique : `finish` pose déjà le bouton L ou R.
  return [...boutons, ...sticks];
}

const CROIX_PRO: readonly SwitchTarget[] = ["UP", "DOWN", "LEFT", "RIGHT"];

/** Ce qu'une lecture Pro presse : les boutons, puis les sens des sticks. */
function presseSwitch(pad: Gamepad, profil: SwitchProfile): SwitchTarget[] {
  const lu = readSwitch(new Set(), profil, pad);
  const boutons = SWITCH_BUTTONS.filter((_, bit) => (lu.buttons & (1 << bit)) !== 0);
  const sens = SWITCH_AXES.flatMap((axe): SwitchTarget[] =>
    lu[axe] > 0 ? [`${axe}+`] : lu[axe] < 0 ? [`${axe}-`] : [],
  );
  return [...boutons, ...sens];
}

function sansDoublon<T>(liste: T[]): T[] {
  return [...new Set(liste)];
}

/** « rien » quand la commande ne presse rien : Back et les clics de stick
 * sur une GameCube, par exemple. La ligne le dit au lieu de disparaître. */
export const RIEN = "rien";

/** La vue de la manette pour une salle Dolphin (GameCube, Wii). */
export function verificationDolphin(
  manette: ManetteLue,
  profil: PadProfile | null,
  lecture: Lecture,
): Ligne[] {
  const dit = nommerDolphin(lecture);
  return commandesDe(manette).map((commande) => {
    const presse = sansDoublon(
      pressions(manette, commande).flatMap((pad) => presseDolphin(pad, profil)),
    );
    const noms = sansDoublon(presse.map(dit));
    return { touches: commande.nom, fait: noms.length ? noms.join(", ") : RIEN, commandes: presse };
  });
}

/** La vue de la manette pour une salle Switch, Switch 2 ou Xbox 360. */
export function verificationPro(
  manette: ManetteLue,
  profil: SwitchProfile,
  xbox: boolean,
): Ligne[] {
  const noms = xbox ? xboxLabels : switchLabels;
  const dit = (cible: SwitchTarget) => {
    if (CROIX_PRO.includes(cible)) return "croix";
    // Les sens des sticks sont en minuscules (`lx+`), les boutons en capitales.
    const axe = SWITCH_AXES.find((a) => cible.startsWith(a));
    if (axe) return axe.startsWith("l") ? "stick gauche" : "stick droit";
    return lisible(inscription(noms[cible]));
  };
  return commandesDe(manette).map((commande) => {
    const presse = sansDoublon(
      pressions(manette, commande).flatMap((pad) => presseSwitch(pad, profil)),
    );
    const lus = sansDoublon(presse.map(dit));
    return { touches: commande.nom, fait: lus.length ? lus.join(", ") : RIEN, commandes: presse };
  });
}

/** Ce que l'instantané dit de la trame envoyée : les commandes qu'il suit, et
 * celles qui sont pressées en ce moment. */
export type Activite = { suivies: ReadonlySet<string>; actives: ReadonlySet<string> };

const BOUTONS_DOLPHIN: ReadonlySet<string> = new Set(Object.keys(BUTTON));

/** La trame Dolphin : `pressed` porte ses douze boutons, rien d'autre. */
export function activiteDolphin(pressed: readonly string[]): Activite {
  return { suivies: BOUTONS_DOLPHIN, actives: new Set(pressed) };
}

/** La trame Pro : rien n'est suivi tant que manettes n'a pas ajouté
 * l'activité à l'instantané (K34). */
export const SANS_ACTIVITE: Activite = { suivies: new Set(), actives: new Set() };

/** Une ligne a une case quand l'instantané suit TOUTES ses commandes. Une
 * ligne de stick dont seul un sens serait suivi s'allumerait à moitié. */
export function suivie(ligne: Ligne, activite: Activite): boolean {
  return ligne.commandes.length > 0 && ligne.commandes.every((c) => activite.suivies.has(c));
}

/** Les conditions qui ne dépendent pas de la ligne : l'écho, et au clavier le
 * focus dans la zone de jeu. */
export type Garde = { focusAuJeu: boolean; clavier: boolean; sinceHeardMs: number | null };

export function envoiPossible(garde: Garde): boolean {
  if (garde.clavier && !garde.focusAuJeu) return false;
  return garde.sinceHeardMs !== null && garde.sinceHeardMs < ECHO_FRAIS_MS;
}

/** Les lignes allumées en ce moment. */
export function allumees(lignes: readonly Ligne[], activite: Activite, garde: Garde): boolean[] {
  const possible = envoiPossible(garde);
  return lignes.map(
    (ligne) =>
      possible && suivie(ligne, activite) && ligne.commandes.some((c) => activite.actives.has(c)),
  );
}

/** Toutes les lignes ont été vues allumées : la scène « fier », une fois. Une
 * vue dont une ligne n'est pas suivie ne l'atteint jamais. */
export function toutesVues(
  lignes: readonly Ligne[],
  vues: ReadonlySet<number>,
  activite: Activite,
): boolean {
  return lignes.length > 0 && lignes.every((ligne, i) => suivie(ligne, activite) && vues.has(i));
}
