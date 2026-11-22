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

/** Au-delà de ce nombre de secondes, un démarrage « met plus longtemps que
 * d'habitude » et l'écran offre ses sorties. Vingt secondes, la valeur que
 * l'écran de chargement utilisait déjà seul; elle vit ici pour que la ligne
 * parlée dise la même chose au même moment (audit A11Y-07). */
export const ATTENTE_LONGUE_S = 20;

/** Où en est l'attente d'un démarrage, telle que l'écran la montre: normale,
 * longue, ou perdue (`stalled`, le plafond de soixante secondes de la page). */
export function attenteDemarrage(attenduS: number, stalled: boolean): "long" | "echec" | undefined {
  if (stalled) return "echec";
  return attenduS >= ATTENTE_LONGUE_S ? "long" : undefined;
}

/** Le plafond d'un chargement, en millisecondes: au-delà, la page cesse
 * d'attendre et propose une sortie. */
export const PLAFOND_CHARGEMENT_MS = 60_000;

/** Ce que devient un chargement en cours, à chaque instantané.
 *
 * Extrait de l'effet d'`App` qui retire l'écran, pour la page « manette
 * seule »: elle n'a pas d'image, donc rien ne peint jamais, et son chargement
 * attendait sans fin. */
export function suiteDuChargement(e: {
  padOnly: boolean;
  /** Le jeu demandé, tel que le salon le nomme. */
  demande: string;
  /** Le jeu que la salle dit faire tourner, `null` au repos. */
  enCours: string | null;
  depuisMs: number;
  cale: boolean;
  /** L'image telle que la vidéo la voit MAINTENANT, `null` sans session. */
  image: Live | null;
}): "effacer" | "caler" | "attendre" {
  // Manette seule: le jeu demandé tourne, ou la page a cessé d'attendre. Il
  // n'y a pas d'écran de chargement à tenir, seulement des touches à rendre.
  if (e.padOnly)
    return e.enCours === e.demande || e.depuisMs > PLAFOND_CHARGEMENT_MS ? "effacer" : "attendre";
  if (e.image === null) return "attendre";
  if (bootingStep(e.image) === "painting") return "effacer";
  if (e.depuisMs > PLAFOND_CHARGEMENT_MS && !e.cale) return "caler";
  return "attendre";
}
