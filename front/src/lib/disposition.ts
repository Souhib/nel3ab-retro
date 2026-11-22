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

/** La règle, en fonction pure: ce que la requête dit, pour un essai. */
export function enTiroir(largeur: number, grossier: boolean): boolean {
  return grossier || largeur < TIROIR_SOUS;
}

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
