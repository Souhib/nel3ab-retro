/**
 * « lettres »: une annonce s'écrit dans sa boîte une lettre à la fois, comme
 * dans un jeu de rôle. Un clic l'affiche toute.
 *
 * Le lecteur d'écran reçoit la phrase ENTIÈRE, d'un coup, par la région
 * d'annonce de la page (`region`); la boîte qui s'écrit lui est cachée le
 * temps de l'écriture. Sans région, la phrase s'affiche d'un coup: une phrase
 * lue lettre par lettre serait pire qu'une phrase sans effet.
 *
 * Jamais pour une erreur ni une consigne urgente: celles-là s'affichent d'un
 * coup, toujours.
 */
import { effetActif, mouvementReduit } from "../lib/effets";
import { sonMenu } from "./sons";

export type Annonce = {
  /** Résolue quand toute la phrase est affichée. */
  fini: Promise<void>;
  /** Affiche tout de suite la phrase entière. */
  finir(): void;
};

/** L'intervalle entre deux lettres, celui de la page des effets. */
export const PAS_MS = 28;

/**
 * Écrit `texte` dans `visible`. `visible` est le texte de la boîte; la boîte
 * (`.rt-lettres`, son parent le plus proche) reçoit `data-fini` à la fin, qui
 * allume son ▼, et `data-erreur` pour une erreur.
 */
export function annoncerLettres(
  visible: HTMLElement,
  texte: string,
  { region = null, erreur = false }: { region?: HTMLElement | null; erreur?: boolean } = {},
): Annonce {
  const boite = visible.closest<HTMLElement>(".rt-lettres") ?? visible;
  if (region) region.textContent = texte;
  boite.toggleAttribute("data-erreur", erreur);
  boite.removeAttribute("data-fini");

  const toutAfficher = () => {
    visible.textContent = texte;
    visible.removeAttribute("aria-hidden");
    boite.setAttribute("data-fini", "");
  };

  if (erreur || region === null || !effetActif("lettres") || mouvementReduit()) {
    toutAfficher();
    return { fini: Promise.resolve(), finir: toutAfficher };
  }

  visible.setAttribute("aria-hidden", "true");
  visible.textContent = "";
  let ecrites = 0;
  let terminer = () => {};
  const fini = new Promise<void>((fin) => {
    terminer = fin;
  });
  const minuterie = window.setInterval(() => {
    ecrites += 1;
    visible.textContent = texte.slice(0, ecrites);
    if (ecrites >= texte.length) {
      window.clearInterval(minuterie);
      toutAfficher();
      terminer();
    } else if (ecrites % 3 === 0) {
      sonMenu("lettre");
    }
  }, PAS_MS);

  const finir = () => {
    window.clearInterval(minuterie);
    toutAfficher();
    terminer();
  };
  boite.addEventListener("click", finir, { once: true });
  return { fini, finir };
}
