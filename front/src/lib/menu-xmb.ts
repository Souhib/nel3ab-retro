/**
 * Où poser les rubriques et la liste du menu XMB, selon l'écran.
 *
 * # Ce qui était faux sur un téléphone
 *
 * La rangée des rubriques partait de 18 % de la largeur, par pas fixes de
 * 148 px. À 390 px de large, « réglages » et « mesures » tombaient à 366 et
 * 514 px: hors de l'écran, sur le seul menu qu'un téléphone peut ouvrir (audit
 * M12, 22 novembre 2026). La liste, à 62 % de la largeur, coupait « GameCube »
 * en « GameC… ». Couché, le pied de quatre lignes mangeait la moitié des
 * entrées.
 *
 * # Deux dispositions, un calcul
 *
 * Large: la croix de la console. Les rubriques glissent pour que la choisie
 * reste au croisement, à 18 % de la largeur, par pas de 148 px, tant que la
 * première reste dans l'écran. Au-delà, la rangée s'arrête au bord et c'est la
 * croix qui avance d'un pas, la liste avec elle: à 1 440 px, « réglages »
 * glissait « jeux » et « manettes » hors de l'écran par la gauche, et les
 * quatre noms ne se lisaient plus qu'à l'ouverture (audit T13).
 *
 * Étroit: une rangée fixe, partagée en parts égales, qui ne glisse pas. Quatre
 * noms qu'on voit tous valent mieux qu'une croix dont la moitié sort de
 * l'écran. La liste prend toute la largeur, et une ligne plus haute laisse le
 * nom courir sur deux lignes.
 *
 * Bas (un téléphone couché): la croix remonte près du haut, pour que la liste
 * montre trois entrées au lieu de deux.
 */

/** Sous cette largeur, la croix ne tient plus: 18 % plus trois pas de 148 px
 * plus une rubrique de 120 px font 0,82 × L ≥ 572, soit L ≥ 698. */
export const ETROIT_SOUS = 700;
/** Sous cette hauteur, la croix à 40 % laisse moins de trois entrées. */
export const BAS_SOUS = 520;

const PAS = 148;
const RUBRIQUE = 120;
const MARGE = 12;

export type Disposition = {
  etroit: boolean;
  bas: boolean;
  /** Le croisement, en pixels depuis le haut. */
  croixY: number;
  /** Où commence la rangée (rubrique 0), une fois glissée. */
  rangee: number;
  /** L'écart entre deux rubriques, et la largeur de chacune. */
  pas: number;
  rubrique: number;
  /** La liste des entrées, sous le croisement. */
  colonne: { gauche: number; largeur: number };
  /** La hauteur d'une entrée. */
  rang: number;
  /** La place laissée au pied, sous la liste. */
  pied: number;
};

export function dispositionXmb({
  largeur,
  hauteur,
  nombre,
  choisi,
  tactile,
}: {
  largeur: number;
  hauteur: number;
  nombre: number;
  choisi: number;
  /** Le pied porte alors un vrai bouton de 44 px au lieu d'une ligne d'aide. */
  tactile: boolean;
}): Disposition {
  const etroit = largeur < ETROIT_SOUS;
  const bas = hauteur < BAS_SOUS;
  // Couché, la rangée commence à 12 px du haut: la croix est 34 px plus bas.
  const croixY = bas ? 46 : Math.round(hauteur * 0.4);
  // Le pied tactile porte un bouton de 44 px. Étroit, le pied du clavier passe
  // sur deux lignes: il lui faut la même place.
  const pied = tactile || etroit ? (bas ? 68 : 120) : 72;
  if (etroit) {
    const pas = Math.floor((largeur - 2 * MARGE) / Math.max(1, nombre));
    return {
      etroit,
      bas,
      croixY,
      rangee: MARGE,
      pas,
      rubrique: pas,
      colonne: { gauche: 16, largeur: largeur - 32 },
      rang: 84,
      pied,
    };
  }
  const rangee = Math.max(MARGE, Math.round(largeur * 0.18) - choisi * PAS);
  const croixX = rangee + choisi * PAS;
  return {
    etroit,
    bas,
    croixY,
    rangee,
    pas: PAS,
    rubrique: RUBRIQUE,
    colonne: {
      gauche: croixX,
      largeur: Math.min(Math.round(largeur * 0.62), largeur - croixX - 16),
    },
    rang: 74,
    pied,
  };
}
