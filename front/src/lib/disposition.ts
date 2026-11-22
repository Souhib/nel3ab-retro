/**
 * La colonne à côté de l'image, ou dans un tiroir par-dessus.
 *
 * Sur un grand écran, la colonne vit à droite de l'image et se replie par Ctrl
 * (`fullscreen.ts`). Sur un téléphone, elle était repliée d'office et ses
 * fonctions n'existaient nulle part ailleurs: ni prendre une place précise, ni
 * demander celle d'un autre, ni signaler, ni le diagnostic, ni les spectateurs
 * (audit P5 et E2, 22 novembre 2026). Dépliée, elle prenait la moitié de la
 * largeur: une image de 195 px, START hors de l'écran, dix touches qui se
 * recouvraient (audit M6).
 *
 * Sous 900 px de large ou au doigt, la colonne devient donc un TIROIR posé
 * par-dessus l'image, qu'on ouvre quand on en a besoin et qu'on referme pour
 * jouer. Elle n'est jamais posée à côté de l'image d'un téléphone.
 *
 * # Pourquoi 900 px
 *
 * La colonne fait 304 px par défaut (`lib/column`). À 900 px de large, elle
 * laisse 596 px à l'image, les deux tiers de la fenêtre; en dessous, l'image
 * passe sous les deux tiers et la colonne la mange. C'est aussi le seuil que
 * l'audit mobile a proposé.
 *
 * # Pourquoi le pointeur grossier compte aussi
 *
 * Une tablette de 1024 px tenue en travers a la place d'une colonne, mais pas
 * celle d'une colonne ET de la manette à l'écran: les deux se disputaient les
 * bandes noires. Au doigt, le tiroir vaut à toutes les tailles.
 */
import { useEffect, useState } from "react";

export const TIROIR_SOUS = 900;

/** Ce que le hook demande au navigateur. `- 0,02` pour que 899,5 px (un
 * zoom) compte encore comme étroit, sans attraper 900. */
export const REQUETE_TIROIR = `(max-width: ${TIROIR_SOUS - 0.02}px), (pointer: coarse)`;

/** Vrai quand la colonne doit être un tiroir. Suit la fenêtre: tourner une
 * tablette ou rétrécir une fenêtre change la forme sans recharger. */
export function useEnTiroir(): boolean {
  const [vrai, poser] = useState(() => lire());
  useEffect(() => {
    let requete: MediaQueryList;
    try {
      requete = window.matchMedia(REQUETE_TIROIR);
    } catch {
      return;
    }
    if (!requete) return;
    const suivre = (event: { matches: boolean }) => poser(event.matches);
    poser(requete.matches);
    requete.addEventListener("change", suivre);
    return () => requete.removeEventListener("change", suivre);
  }, []);
  return vrai;
}

function lire(): boolean {
  try {
    return window.matchMedia(REQUETE_TIROIR).matches;
  } catch {
    return false;
  }
}

/** Ce que la salle sait au moment de poser ses couches par-dessus l'image. */
export type EtatDesCouches = {
  /** La colonne est un tiroir (`useEnTiroir`). */
  compact: boolean;
  /** Le tiroir a été demandé. */
  tiroir: boolean;
  /** La feuille du bas est ouverte. */
  feuille: boolean;
  /** La manette à l'écran est voulue, et une session existe pour elle. */
  manette: boolean;
  /** Un écran couvre l'image (`voileSurImage`). */
  voile: boolean;
  /** La colonne est repliée par Ctrl (grand écran seulement). */
  bare: boolean;
};

/** Ce qui est monté: le tiroir, la manette à l'écran, le « ••• » seul, la
 * colonne. Une seule fonction, pour qu'aucune condition de montage ne lise
 * un état que les autres ont oublié. */
export type Couches = {
  /** Le tiroir est VRAIMENT ouvert. */
  tiroir: boolean;
  pave: boolean;
  plusSeul: boolean;
  colonne: "a-cote" | "tiroir" | null;
};

export function couchesDeLaSalle(e: EtatDesCouches): Couches {
  // `compact` d'abord: un tiroir demandé sur un grand écran (la manette à
  // l'écran réglée sur « toujours », ou une fenêtre étroite agrandie tiroir
  // ouvert) démontait la manette et n'ouvrait rien (relecture du 22 novembre
  // 2026). Il ne restait qu'Échap au clavier.
  const tiroir = e.compact && e.tiroir;
  const pave = e.manette && !e.voile && !tiroir && !e.feuille;
  // Le « ••• » seul reste monté sous la feuille, inerte sous le dialogue
  // modal: le navigateur lui rend le focus à la fermeture (WCAG 2.4.3).
  const plusSeul = e.compact && !(e.manette && !e.voile) && !tiroir;
  const colonne = e.compact ? (tiroir ? "tiroir" : null) : e.bare ? null : "a-cote";
  return { tiroir, pave, plusSeul, colonne };
}

/** « La salle », depuis la feuille ou le menu: le tiroir quand la colonne en
 * est un, la colonne dépliée sinon. */
export function ouvrirLaSalle(compact: boolean): { tiroir: true } | { bare: false } {
  return compact ? { tiroir: true } : { bare: false };
}

/** Ce que Ctrl seule change quand la colonne est un tiroir. `null`: rien. */
export function apresCtrl(e: {
  tiroir: boolean;
  menu: boolean;
  feuille: boolean;
  /** Le réglage des touches est ouvert. */
  touches: boolean;
}): { tiroir: boolean; menu: boolean; feuille: boolean } | null {
  // Le réglage des touches lit le clavier, et un tiroir par-dessus le
  // rendrait inerte au milieu d'une capture.
  if (e.touches) return null;
  // Le menu et la feuille se ferment: deux dialogues modaux empilés
  // laissaient le bouton « menu » du tiroir sans effet (relecture du
  // 22 novembre 2026).
  return { tiroir: !e.tiroir, menu: false, feuille: false };
}

/** Un écran couvre-t-il toute l'image ? */
export function voileSurImage(e: {
  /** La salle au repos, sans menu ni préparation par-dessus. */
  repos: boolean;
  /** Un changement de jeu se charge. */
  chargement: boolean;
  /** Le rideau d'une arrivée sans image. */
  rideau: boolean;
  padOnly: boolean;
}): boolean {
  // Une page « manette seule » n'a pas d'image: son chargement ne s'efface
  // jamais tout seul (il attend une image peinte), et le compter ici
  // démontait la manette après chaque lancement (relecture du 22 novembre
  // 2026). Le rideau d'une arrivée, de même, ne parle que de l'image.
  return e.repos || (!e.padOnly && (e.chargement || e.rideau));
}

/** Où rendre le focus quand la feuille ou le tiroir se ferme. */
export function focusApresFermeture(e: {
  /** Le focus est retombé sur le document: ce qui l'avait a disparu. */
  perdu: boolean;
  /** Un « ••• » est monté pour le reprendre. */
  plus: boolean;
}): "plus" | "jeu" | null {
  if (!e.perdu) return null;
  return e.plus ? "plus" : "jeu";
}
