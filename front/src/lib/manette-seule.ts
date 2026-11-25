/**
 * Ce que la page « manette seule » dit de ses touches.
 *
 * Avant le 23 novembre 2026, elle écrivait « aller-retour 18 ms » en police
 * machine : un chiffre d'atelier, juste mais muet pour qui tient le
 * téléphone. Elle dit maintenant ce que le chiffre veut dire, et seulement
 * quand elle le sait :
 *
 * - « Tes touches arrivent. » quand la socket des manettes a répondu depuis
 *   moins de 2 s et que l'aller-retour médian vaut 60 ms ou moins ;
 * - « Tes touches mettent 85 ms à arriver. » au-delà de 60 ms ;
 * - « La page attend la réponse de la salle. » tant que rien n'est mesuré,
 *   ou quand l'écho se tait depuis 2 s.
 *
 * Pourquoi 2 s et pas 1 : l'écho part chaque seconde (`media/input.ts`), donc
 * un seuil d'une seconde dirait « attend » une fois sur deux par simple
 * phase (plan données, D21).
 *
 * Pourquoi 60 ms : un aller-retour de 60 ms met 30 ms entre le doigt et la
 * salle, deux images à 60 Hz ; au-delà, le chiffre lui-même est utile à qui
 * joue, il dit pourquoi un saut part en retard.
 */
import { LATENCE } from "./mots";

export const ECHO_FRAIS_MS = 2000;
export const ARRIVENT_SOUS_MS = 60;

type Mesure = {
  /** L'aller-retour médian, `null` tant qu'aucun n'est mesuré. */
  allerRetourMs: number | null;
  /** Depuis combien de millisecondes l'écho a été entendu, `null` jamais. */
  entenduIlYaMs: number | null;
};

/** Ce que la phrase dit, sans son chiffre. */
export type CategorieLatence = "attend" | "arrivent" | "lentes";

export function categorieDeLatence(e: Mesure): CategorieLatence {
  if (e.allerRetourMs === null || e.entenduIlYaMs === null) return "attend";
  if (e.entenduIlYaMs >= ECHO_FRAIS_MS) return "attend";
  return e.allerRetourMs <= ARRIVENT_SOUS_MS ? "arrivent" : "lentes";
}

export function phraseDeLatence(e: Mesure): string {
  const categorie = categorieDeLatence(e);
  if (categorie === "lentes" && e.allerRetourMs !== null)
    return LATENCE.lentes(Math.round(e.allerRetourMs));
  return categorie === "arrivent" ? LATENCE.arrivent : LATENCE.attend;
}

/** Ce que la ligne parlée dit d'une catégorie : jamais un chiffre. */
export const DIRE_LA_LATENCE: Readonly<Record<CategorieLatence, string>> = {
  attend: LATENCE.attend,
  arrivent: LATENCE.arrivent,
  lentes: LATENCE.lentesDit,
};

/** Le temps qu'une catégorie doit tenir avant d'être dite : trois échos,
 * qui partent chaque seconde. Une médiane qui hésite autour de 60 ms ne
 * fait pas parler la page à chaque écho. */
export const LATENCE_TENUE_MS = 3000;
