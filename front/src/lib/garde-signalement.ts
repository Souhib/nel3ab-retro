/**
 * Le garde du signalement, UN par page.
 *
 * Deux boutons « Signaler » existent depuis le 22 novembre 2026: celui de la
 * colonne et celui du bandeau d'une image figée. Chacun tenait son propre garde
 * dans son état React. Un clic sur le bandeau laissait donc la colonne armée,
 * et le second clic recevait du salon « Demande trop rapprochée. Réessaie dans
 * un instant. ». Le bandeau, démonté à chaque passage par « en marche », se
 * réarmait en plus à chaque remontage. La relecture adverse l'a relevé.
 *
 * Le garde vit donc ici, hors de React, et les deux boutons le lisent. Il dit
 * si un repère est parti depuis moins de vingt secondes, et depuis le 23
 * novembre 2026 depuis quand et pour combien de temps encore : un bouton
 * grisé sans raison se lisait comme une panne (audit A11Y-11).
 */

import { SANS_REPONSE } from "./mots";

/** Combien de temps les boutons restent désarmés, en millisecondes.
 *
 * La même valeur que le garde du salon (`COMPLAINT_EVERY`, vingt secondes), qui
 * refuse un deuxième repère avant. Deux repères si rapprochés porteraient de
 * toute façon presque la même trace: chacun emporte les deux minutes qui
 * précèdent. */
export const COMPLAIN_EVERY = 20_000;

export class GardeSignalement {
  private jusqua: number | null = null;
  private minuteur: number | null = null;
  private readonly abonnes = new Set<() => void>();
  private readonly maintenant: () => number;

  constructor(maintenant: () => number = () => performance.now()) {
    this.maintenant = maintenant;
  }

  /** Un repère est-il parti il y a moins de `COMPLAIN_EVERY` ? */
  tenu = (): boolean => this.jusqua !== null && this.maintenant() < this.jusqua;

  /** Depuis combien de secondes entières le repère est parti, ou `null`
   * quand rien n'est tenu (« Déjà signalé il y a 12 s »). */
  depuis = (): number | null =>
    this.jusqua === null || !this.tenu()
      ? null
      : Math.floor((this.maintenant() - (this.jusqua - COMPLAIN_EVERY)) / 1000);

  /** Combien de secondes avant le prochain repère, arrondi vers le haut :
   * une attente qui n'est pas finie ne se dit jamais « 0 s ». */
  reste = (): number =>
    this.jusqua === null || !this.tenu() ? 0 : Math.ceil((this.jusqua - this.maintenant()) / 1000);

  /** Un repère vient d'être ACCEPTÉ: les deux boutons se désarment. */
  tenir(): void {
    this.jusqua = this.maintenant() + COMPLAIN_EVERY;
    if (this.minuteur !== null) window.clearTimeout(this.minuteur);
    this.minuteur = window.setTimeout(() => {
      this.minuteur = null;
      this.prevenir();
    }, COMPLAIN_EVERY);
    this.prevenir();
  }

  /** Pour `useSyncExternalStore`. */
  abonner = (abonne: () => void): (() => void) => {
    this.abonnes.add(abonne);
    return () => this.abonnes.delete(abonne);
  };

  private prevenir(): void {
    for (const abonne of this.abonnes) abonne();
  }
}

/** Ce qu'un signalement raté veut dire, pour ne pas supposer de cause.
 *
 * `room.request` rejette de trois façons : la socket du salon est fermée
 * (`SANS_REPONSE`), l'accusé n'arrive pas en cinq secondes (le délai de
 * socket.io, « operation has timed out »), ou le salon répond non avec sa
 * raison. Les deux premières sont la même chose pour le joueur : le site ne
 * répond pas. La troisième se dit telle que le salon l'a écrite ; la page n'y
 * ajoute pas « le site ne répond pas », qui serait faux (audit E7). */
export type Rate = { sansReponse: true } | { sansReponse: false; message: string };

/** Le message de socket.io quand un accusé ne vient pas à temps. */
export const DELAI_DEPASSE = "operation has timed out";

export function rate(erreur: unknown): Rate {
  const message = erreur instanceof Error ? erreur.message : "";
  if (message === SANS_REPONSE || message === DELAI_DEPASSE) return { sansReponse: true };
  return { sansReponse: false, message: message || "Signalement non confirmé. Réessaie." };
}
