/**
 * Les chiffres du premier niveau des mesures (`components/Mesures`) : ce que
 * le joueur lit, avec leur sens écrit.
 *
 * Trois chiffres, et chacun est ABSENT tant qu'il n'est pas mesuré. Le
 * 21 novembre 2026, la boîte noire a imprimé « pages 250 img/s » pendant le gel
 * de Sonic : la cadence du jeu retombait sur celle de l'écran faute de trente
 * écarts, et une valeur de repli a voyagé comme une mesure (CLAUDE.md, règle 4).
 *
 * - les images PEINTES par seconde : l'écart du compteur `painted` entre deux
 *   relevés datés à l'horloge murale, sur une seconde au moins. Ce sont des
 *   événements comptés, pas une allure supposée ;
 * - la cadence du jeu (`sourceHz`), absente sous trente écarts (`video.ts`) ;
 * - l'aller-retour des touches (`roundTripMs`), absent avant le premier écho ;
 * - l'écart au pire entre deux images, une fois sur vingt (`gapMs.p95`),
 *   absent tant que le flux n'a pas trente images : un p95 de deux images ne
 *   dit rien, et un zéro d'une page qui n'a reçu qu'une image se lisait
 *   « reçue 0 ms ».
 *
 * Un seul chiffre se dit mauvais, avec un mot et non une couleur seule : les
 * images peintes sous 90 % du jeu (`SHORT_RATE`, la même borne que le
 * diagnostic d'un écran plus lent que le jeu, mesurée en septembre 2026).
 */
import type { VideoStats } from "../media/video";
import { SHORT_RATE } from "./vitals";

/** Un relevé du compteur d'images peintes, daté à l'horloge murale. */
export type Releve = { a: number; peintes: number };

/** La plus courte fenêtre comptée : une seconde. */
export const FENETRE_MS = 1000;

/** Combien d'écarts il faut avant de dire un écart au pire : le même seuil
 * que la cadence du jeu dans `media/video`. */
export const ECARTS_MIN = 30;

/** Les images peintes par seconde entre deux relevés, ou `null` quand la
 * fenêtre est trop courte, ou le compteur revenu en arrière. */
export function cadence(avant: Releve | null, apres: Releve): number | null {
  if (avant === null) return null;
  const duree = apres.a - avant.a;
  const peintes = apres.peintes - avant.peintes;
  if (duree < FENETRE_MS || peintes < 0) return null;
  return Math.round((peintes * 1000) / duree);
}

export type Chiffres = {
  peintes: number | null;
  jeu: number | null;
  allerRetour: number | null;
  pire: number | null;
  /** Les images peintes restent sous 90 % de celles du jeu. */
  sousLeJeu: boolean;
};

export function chiffres(
  video: Pick<VideoStats, "sourceHz" | "paintedSince" | "gapMs">,
  allerRetourMs: number | null,
  peintes: number | null,
): Chiffres {
  const jeu = video.sourceHz > 0 ? Math.round(video.sourceHz) : null;
  return {
    peintes,
    jeu,
    allerRetour: allerRetourMs === null ? null : Math.round(allerRetourMs),
    pire: video.paintedSince >= ECARTS_MIN ? Math.round(video.gapMs.p95) : null,
    sousLeJeu: peintes !== null && jeu !== null && peintes < SHORT_RATE * jeu,
  };
}
