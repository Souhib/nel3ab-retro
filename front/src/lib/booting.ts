/**
 * À quelle étape en est un chargement de jeu.
 *
 * Extrait du rendu pour une seule raison: c'est la seule liste ORDONNÉE de la
 * page, et une liste ordonnée qui recule est pire que pas de liste du tout. Une
 * fonction pure se prouve en quatre lignes d'essai; la même expression au
 * milieu d'un rendu ne se prouve qu'en attendant un vrai redémarrage.
 */
export type Step = "asked" | "waiting" | "painting";

/** Les étapes dans l'ordre, pour comparer deux positions. */
export const STEPS: Step[] = ["asked", "waiting", "painting"];

/** Ce que la page sait de l'image, et rien d'autre. */
export type Live = {
  connected: boolean;
  awaitingRestart: boolean;
  paintedSince: number;
  dark: boolean;
};

/** Branchée sur les MÊMES faits que le retrait de l'écran.
 *
 * L'ancienne version lisait la socket d'abord, ce qui faisait reculer la liste:
 * le clic posait « le jeu démarre » alors que la socket vivait encore, puis sa
 * chute remettait « la salle a reçu la demande », puis la toute première image
 * noire allumait « première image » pendant qu'on regardait encore du noir.
 *
 * Ici les trois étapes sortent des mêmes conditions que le reste de la page:
 * « première image » est EXACTEMENT ce qui retire l'écran (voir App.tsx), pour
 * qu'aucune étape ne s'allume sur un écran qui ne s'en va pas. */
export function bootingStep({ connected, awaitingRestart, paintedSince, dark }: Live): Step {
  if (!awaitingRestart && paintedSince > 30 && !dark) return "painting";
  if (awaitingRestart && connected) return "asked";
  return "waiting";
}
