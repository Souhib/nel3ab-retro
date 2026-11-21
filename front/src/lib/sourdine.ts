/** Ce que la page dit au salon de sa sourdine.
 *
 * Depuis le 23 septembre 2026, un volume à zéro ferme la socket du son
 * (`SoundStream.setMuted`). Le salon l'écrit dans son journal, avec qui et quand,
 * pour comparer une même liaison avec et sans le son. */

/** Combien de temps le volume doit rester du même côté de zéro avant d'en parler.
 *
 * Deux secondes: une glissière qu'on traverse en la faisant glisser ne doit pas
 * écrire trois lignes, et le dernier état doit toujours finir par être dit. */
export const MUTE_SETTLES_MS = 2000;

export type MuteNews = "coupé" | "remis";

/** La nouvelle à envoyer, ou rien.
 *
 * `told` est ce que le salon sait déjà, `null` au début. Une page qui s'ouvre avec
 * le son la laisse telle quelle: rien ne s'est passé. Une page qui s'ouvre en
 * sourdine le dit, sinon la comparaison la compterait avec le son. */
export function muteNews(told: boolean | null, muted: boolean): MuteNews | null {
  if (told === muted) return null;
  if (told === null && !muted) return null;
  return muted ? "coupé" : "remis";
}
