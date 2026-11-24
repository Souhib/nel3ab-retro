/**
 * Les deux gestes de la rubrique Salle qui finissent quelque chose : fermer
 * le jeu, fermer la salle (chantier menus, relecture du 24 novembre 2026).
 *
 * Ils vivaient dans `App.tsx`, où ni l'un ni l'autre ne jouait la transition
 * que le plan et la partition (K13) leur donnaient : la page de qui fermait
 * la salle partait tout de suite, avant l'extinction que les autres voient,
 * et « Fermer le jeu » n'avait pas d'iris. Ici, avec des doubles, chaque
 * ordre se prouve : la navigation n'arrive qu'après la fin de l'extinction,
 * un refus n'anime rien et s'écrit dans le menu.
 *
 * Les transitions sont celles du socle (`retro/transitions`) : elles lisent
 * le niveau des effets, respectent le mouvement réduit et cachent l'image de
 * leur surface avant de commencer.
 */
import { choisirTransition, transition } from "../../retro";
import { SANS_REPONSE } from "../../lib/mots";

/** La phrase d'un refus de fermeture. Le client généré rejette avec le corps
 * de la réponse, `{ detail }`, et non avec une `Error`. */
export function refusDeFermeture(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "detail" in error &&
    typeof error.detail === "string"
    ? `La salle n'a pas fermé : ${error.detail}.`
    : "La salle n'a pas pu fermer. Réessaie.";
}

/** « Fermer la salle » : le salon ferme, puis le tube s'éteint sur la page
 * (`fermer-salle` : extinction, ou fondu en « sobre »), et seulement ensuite
 * la page part. Un refus ne joue rien et s'écrit. */
export async function fermerLaSalle(e: {
  fermer: () => Promise<unknown>;
  partir: () => void;
  surface: () => HTMLElement | null;
  refus: (texte: string) => void;
}): Promise<void> {
  try {
    await e.fermer();
  } catch (error) {
    e.refus(refusDeFermeture(error));
    return;
  }
  const surface = e.surface();
  if (surface === null) {
    e.partir();
    return;
  }
  await transition(choisirTransition("fermer-salle"), surface, e.partir);
}

/** « Fermer le jeu » : le salon accepte, puis l'iris se referme sur le menu
 * et le rouvre sur « Fermeture du jeu en cours… » (`quitter-partie`). Le
 * menu seulement : l'image tourne encore jusqu'à ce que le jeu s'arrête, et
 * aucune transition ne passe sur elle. */
export async function fermerLeJeu(e: {
  fermer: () => Promise<unknown>;
  enCours: () => void;
  surface: () => HTMLElement | null;
  refus: (texte: string) => void;
}): Promise<void> {
  try {
    await e.fermer();
  } catch (error) {
    e.refus(error instanceof Error ? error.message : SANS_REPONSE);
    return;
  }
  const surface = e.surface();
  if (surface === null) {
    e.enCours();
    return;
  }
  await transition(choisirTransition("quitter-partie"), surface, e.enCours);
}
