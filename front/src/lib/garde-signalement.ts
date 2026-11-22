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
 * Le garde vit donc ici, hors de React, et les deux boutons le lisent. Il ne
 * dit qu'une chose: un repère est-il parti depuis moins de vingt secondes ?
 */

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
