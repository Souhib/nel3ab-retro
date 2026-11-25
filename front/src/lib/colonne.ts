/**
 * Les rangs de la colonne de la salle, dans l'ordre, selon l'état, le rôle et
 * l'appareil tenu.
 *
 * Avant le 23 novembre 2026, la colonne montrait tout, tout le temps, et
 * grisait ce qui ne servait pas : au repos, Son, Garder 45 s et Agrandir
 * restaient là, éteints. Un rang qui ne sert à rien disparaît maintenant au
 * lieu d'être grisé. Les places, la phrase de qui choisit le jeu, « Ils
 * regardent » et « Inviter » ne sont pas des rangs : ce sont des emplacements
 * du cadre, que le chantier personnes remplit.
 *
 * - signaler : en premier (K25, mesuré visible à 1280×720 par personnes) ;
 *   caché pendant qu'une fiche d'état parle, qui porte alors Signaler ;
 * - reglage : « Touches et manettes », juste sous Signaler, pour qui tient
 *   une place, au repos compris (on règle sa manette avant de jouer) ; pas
 *   dans une salle fermée. Le panneau prend la place des rangs (chantier
 *   manettes, 24 novembre 2026) ;
 * - son : un jeu tourne ;
 * - menu : partout sauf une salle fermée, au repos compris (K23 : le
 *   rayonnage se pose sur l'écran éteint, « Menu du jeu » reste ici) ; pas
 *   pour un spectateur, à qui Échap ouvre quand même le menu ;
 * - touches ou manette : la vue de l'appareil tenu, pour qui tient une place
 *   et joue (« Tes touches au clavier » ou « Ta manette ») ;
 * - garder : les 45 dernières secondes, un jeu tourne ;
 * - agrandir : l'image agrandie par Ctrl, quand il y a une image ;
 * - autres : Autres réglages, toujours (Rendre ma place, Micro pour les clips).
 *
 * « Un jeu tourne » et « il y a une image » comptent aussi l'arrivée dans une
 * partie en cours, avant sa première image : la première image ne change
 * pas la colonne (24 novembre 2026).
 */
import type { Appareil } from "./appareil";
import { sansImage, type EtatDuCadre, type Role } from "./cadre";

export const RANGS = [
  "signaler",
  "reglage",
  "son",
  "menu",
  "touches",
  "manette",
  "garder",
  "agrandir",
  "autres",
] as const;
export type Rang = (typeof RANGS)[number];

export function rangsDeLaColonne(e: {
  etat: EtatDuCadre;
  role: Role;
  appareil: Appareil;
  /** Une fiche d'état parle dans la colonne (états) : elle porte Signaler. */
  fiche: boolean;
  /** Une partie tourne dans la salle (`room.game`). */
  partie: boolean;
}): Rang[] {
  // Les rangs d'une partie dès l'arrivée dans une partie en cours : ils
  // paraissaient à la première image, et la colonne grandissait de 196 px
  // sous les yeux (colonne-stable d'etats.mjs, 24 novembre 2026). Un
  // lancement les garde cachés (C8) : aucune partie ne tourne encore.
  const jeu = !sansImage(e.etat) || (e.etat === "connexion" && e.partie);
  const joue = e.role === "joueur";
  const rangs: Rang[] = [];
  if (!e.fiche) rangs.push("signaler");
  if (joue && e.etat !== "fermee") rangs.push("reglage");
  if (jeu) rangs.push("son");
  if (joue && e.etat !== "fermee") rangs.push("menu");
  if (joue && jeu) {
    if (e.appareil === "clavier") rangs.push("touches");
    else if (e.appareil === "manette") rangs.push("manette");
  }
  if (jeu) rangs.push("garder", "agrandir");
  rangs.push("autres");
  return rangs;
}
