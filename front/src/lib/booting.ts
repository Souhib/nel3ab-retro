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
 * longue, ou perdue (`stalled`, le plafond de soixante secondes de la page).
 * `seuil` est celui de `seuilLong`, vingt secondes sans habitude mesurée. */
export function attenteDemarrage(
  attenduS: number,
  stalled: boolean,
  seuil: number = ATTENTE_LONGUE_S,
): "long" | "echec" | undefined {
  if (stalled) return "echec";
  return attenduS >= seuil ? "long" : undefined;
}

/** L'état d'une case du chargement (C4) : faite (coche), en cours
 * (pointillé et compteur), à venir (vide), inconnue (?), échec (croix). */
export type Case = "faite" | "en-cours" | "a-venir" | "inconnue" | "echec";

/** Les trois cases, dans l'ordre des étapes (C4).
 *
 * Ce que la page sait, et rien de plus. Une attente longue ne sait plus si
 * l'étape en cours avance : sa case devient un point d'interrogation. Calé,
 * la première image est un échec, et ce qui la précède sans être fait n'est
 * pas su. Une case faite le reste : la liste ne recule jamais (même règle que
 * `bootingStep`). */
export function etapesAffichees(step: Step, attente: "long" | "echec" | undefined): Case[] {
  const atteinte = STEPS.indexOf(step);
  if (step === "painting") return STEPS.map(() => "faite");
  return STEPS.map((_, rang): Case => {
    if (rang < atteinte) return "faite";
    if (attente === "echec") return rang === STEPS.length - 1 ? "echec" : "inconnue";
    if (rang > atteinte) return "a-venir";
    return attente === "long" ? "inconnue" : "en-cours";
  });
}

/** Depuis combien de temps aucune image n'est arrivée, comme l'écran le dit
 * (« Aucune image en 1 min 32 »). */
export function dureeSansImage(secondes: number): string {
  if (secondes < 60) return `${secondes} s`;
  return `${Math.floor(secondes / 60)} min ${String(secondes % 60).padStart(2, "0")}`;
}

/** Un geste offert sur l'écran de chargement (C7a). */
export type GesteDuChargement = "arreter" | "autre" | "signaler";

/** Les gestes de l'écran de chargement, selon l'attente et le rôle.
 *
 * Rien tant que l'attente est normale : une dizaine de secondes de noir est
 * normale, et un bouton d'annulation ferait croire à une panne à chaque
 * lancement. Plus long : qui choisit le jeu peut arrêter le lancement. Sans
 * image : il peut en choisir un autre. Tout le monde peut signaler. */
export function gestesDuChargement(
  attente: "long" | "echec" | undefined,
  choisit: boolean,
): GesteDuChargement[] {
  if (attente === undefined) return [];
  if (!choisit) return ["signaler"];
  return [attente === "long" ? "arreter" : "autre", "signaler"];
}

/** L'habitude d'un jeu, telle que le salon la publie (D05) : rien avant
 * cinq démarrages réussis. */
export type Habitude = { mediane_s: number; p90_s: number; n: number };

/** Une habitude se dit seulement quand elle est mesurée : cinq démarrages
 * réussis au moins, et des durées lisibles. Le salon n'en publie pas
 * moins ; la page ne recopie pas sa confiance pour autant. */
export function habitudeMesuree(h: Habitude | null | undefined): Habitude | null {
  if (!h || h.n < 5) return null;
  if (!(h.mediane_s > 0) || !(h.p90_s >= h.mediane_s)) return null;
  return h;
}

/** Le seuil d'une attente longue, en secondes : le 90e centile de ce jeu
 * quand il est mesuré (au-delà, « c'est plus long que d'habitude »), les
 * vingt secondes d'avant sinon (C5, D05). */
export function seuilLong(h: Habitude | null | undefined): number {
  const mesuree = habitudeMesuree(h);
  return mesuree ? Math.ceil(mesuree.p90_s) : ATTENTE_LONGUE_S;
}

/** La soirée d'un instant, à l'heure de cet appareil : jusqu'à 5 h du
 * matin, la nuit continue la soirée de la veille. */
export function soireeDe(maintenant: Date): string {
  const d = new Date(maintenant.getTime() - 5 * 3_600_000);
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** La version de la scène « chercher » (C11) : complète au premier
 * chargement de la soirée dans ce navigateur, courte ensuite. `vu` est la
 * soirée retenue au chargement précédent, `null` s'il n'y en a pas. */
export function versionDuChargement(vu: string | null, maintenant: Date): "complete" | "courte" {
  return vu === soireeDe(maintenant) ? "courte" : "complete";
}

/** Le plafond d'un chargement, en millisecondes: au-delà, la page cesse
 * d'attendre et propose une sortie. */
export const PLAFOND_CHARGEMENT_MS = 60_000;

/** Ce que devient un chargement en cours, à chaque instantané. Extrait de
 * l'effet d'`App` qui retire l'écran. */
export function suiteDuChargement(e: {
  depuisMs: number;
  cale: boolean;
  /** L'image telle que la vidéo la voit MAINTENANT, `null` sans session. */
  image: Live | null;
}): "effacer" | "caler" | "attendre" {
  if (e.image === null) return "attendre";
  if (bootingStep(e.image) === "painting") return "effacer";
  if (e.depuisMs > PLAFOND_CHARGEMENT_MS && !e.cale) return "caler";
  return "attendre";
}
