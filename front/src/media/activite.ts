/**
 * Ce que la trame envoyée porte en ce moment, dit en commandes.
 *
 * Demandé par la salle (K34) pour la vue des touches : une ligne de la carte
 * s'allume quand la trame envoyée presse une de ses commandes. Lu dans
 * l'instantané (`InputState.activite`), donc sur ce qui est PARTI, pas sur ce
 * que la manette dit : un menu ouvert ou un réglage en cours envoie un état
 * neutre, et la vue ne doit rien allumer pendant ce temps.
 *
 * Deux trames, deux vocabulaires : une `ControlKey` pour Dolphin (les douze
 * boutons, les deux sticks par axe), une `SwitchTarget` pour la trame Pro
 * (seize boutons, et chaque sens de stick). `suivies` dit ce que la trame
 * sait porter : une ligne dont une commande n'est pas suivie n'a pas de case.
 */
import { BUTTON, MOVED, type ButtonName, type PadReading } from "./pad";
import {
  SWITCH_AXES,
  SWITCH_BUTTONS,
  SWITCH_TARGETS,
  type SwitchReading,
  type SwitchTarget,
} from "./switch";

/** Même forme que `Activite` de `lib/verification`, que la salle lit. */
export type ActiviteTrame = { suivies: ReadonlySet<string>; actives: ReadonlySet<string> };

const STICKS_DOLPHIN = ["x", "y", "cx", "cy"] as const;
const SUIVIES_DOLPHIN: ReadonlySet<string> = new Set([...Object.keys(BUTTON), ...STICKS_DOLPHIN]);
const SUIVIES_PRO: ReadonlySet<string> = new Set(SWITCH_TARGETS);

/** La trame Dolphin : ses boutons, ses gâchettes à mi-course ou plus, et
 * chaque axe de stick hors du repos (la zone morte est déjà appliquée). */
export function activiteDolphin(lu: PadReading | null): ActiviteTrame {
  const actives = new Set<string>();
  if (lu) {
    for (const nom of Object.keys(BUTTON) as ButtonName[])
      if ((lu.buttons & BUTTON[nom]) !== 0) actives.add(nom);
    // Une gâchette à mi-course presse déjà L ou R pour le jeu, même avant son
    // clic de fin de course (`finish`) : l'octet analogique part avec elle.
    if (lu.l / 255 > MOVED) actives.add("L");
    if (lu.r / 255 > MOVED) actives.add("R");
    for (const axe of STICKS_DOLPHIN) if (lu[axe] !== 0) actives.add(axe);
  }
  return { suivies: SUIVIES_DOLPHIN, actives };
}

/** La trame Pro : seize boutons, et le sens de chaque axe hors du repos. */
export function activitePro(lu: SwitchReading | null): ActiviteTrame {
  const actives = new Set<SwitchTarget>();
  if (lu) {
    SWITCH_BUTTONS.forEach((nom, bit) => {
      if ((lu.buttons & (1 << bit)) !== 0) actives.add(nom);
    });
    for (const axe of SWITCH_AXES) {
      if (lu[axe] > 0) actives.add(`${axe}+`);
      else if (lu[axe] < 0) actives.add(`${axe}-`);
    }
  }
  return { suivies: SUIVIES_PRO, actives };
}
