/**
 * Les utilitaires des effets rétro, hors du chemin de l'image (ADR D37).
 *
 * Chacun lit le niveau de l'appareil (`lib/effets`), respecte le mouvement
 * réduit et refuse ce qui toucherait l'image du jeu (`./image`). Aucun ne
 * s'abonne à ce que la boucle média peint: React et ces modules agissent sur
 * un geste ou un changement d'état, jamais à chaque image.
 *
 * Les classes `rt-…` qu'ils posent sont décrites dans `src/effets.css`.
 */
export { BOUTON_START, initiales, surInactivite, surStart } from "./arcade";
export {
  bruit,
  neige,
  poserCalquesAttente,
  poserCalquesUi,
  poserFiltreBombe,
  poserFiltresMosaique,
} from "./calques";
export { ecrireChiffres, fantome, poserAfficheur } from "./chiffres";
export { activerCurseur, CIBLES, type Curseur } from "./curseur";
export { ICONES_PIXEL, iconePixelSVG, type IconePixel } from "./icones";
export { cacherLImage, IMAGE_CACHEE, toucheLImage, zonesDeJeu } from "./image";
export { annoncerLettres, PAS_MS, type Annonce } from "./lettres";
export { courbe } from "./paliers";
export { pointeurCSS, pointeurSVG } from "./pointeur";
export { secouer } from "./secousse";
export { jeuAuFocus, PARTITIONS, preparerSons, sonMenu, type SonMenu } from "./sons";
export {
  choisirTransition,
  MOMENTS,
  transition,
  TRANSITIONS,
  type Moment,
  type TypeTransition,
} from "./transitions";
