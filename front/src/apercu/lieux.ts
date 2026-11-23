/**
 * Les scènes que la planche joue dans chacun de ses décors (`planche.tsx`),
 * lues aussi par son gardien (`planche.test.tsx`) et par `planche-ain.mjs`.
 */
import { SCENES, type Scene } from "../mascotte";
import { AU_SALON } from "../mascotte/scenes-ain";

/** Les scènes de chaque décor. Le salon joue ses scènes et les variantes
 * de cinq scènes de la salle (`AU_SALON`). */
export const DE_LA_SALLE: readonly Scene[] = SCENES.filter(
  (s) => !["ouvre", "range", "depot", "refus", "demo", "premiere-image"].includes(s),
);
export const DU_SALON: readonly Scene[] = [
  "ouvre",
  "range",
  "depot",
  "refus",
  "demo",
  ...(Object.keys(AU_SALON) as Scene[]),
];
export const LIEUX = { salle: DE_LA_SALLE, plateau: DE_LA_SALLE, salon: DU_SALON } as const;
export type Lieu = keyof typeof LIEUX;
