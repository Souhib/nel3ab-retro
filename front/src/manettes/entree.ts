/** L'entrée du réglage des touches : qui l'ouvre, et sur quel onglet.
 *
 * Un seul panneau par page. Le rang de la colonne, la vue des touches, l'avis
 * d'une manette à configurer et « Toutes les touches » l'ouvrent tous par
 * `ouvrirReglage` (K05) ; l'hôte (`HoteReglage`) s'y abonne. Le panneau reste
 * dans la page (K38) : il n'y a rien à charger, donc rien qui puisse échouer
 * entre le clic et le panneau.
 *
 * L'ouvreur est retenu au clic, pour lui rendre le focus à la fermeture : le
 * panneau prend la place des rangs de la colonne, donc l'élément qui l'a
 * ouvert peut avoir disparu entre-temps. `focusRendu` le dit alors. */
import { useSyncExternalStore } from "react";

export type Onglet = "manette" | "clavier" | "profils";

export type Ouverture = { onglet: Onglet; ouvreur: HTMLElement | null };

let courant: Ouverture | null = null;
const ecoutes = new Set<() => void>();
const prevenir = () => {
  for (const ecoute of ecoutes) ecoute();
};

/** Ouvre le panneau, ou change d'onglet s'il est déjà ouvert : l'ouvreur
 * d'avant est gardé, c'est à lui que le focus revient. */
export function ouvrirReglage(onglet: Onglet = "manette"): void {
  const ici = document.activeElement;
  courant = {
    onglet,
    ouvreur: courant?.ouvreur ?? (ici instanceof HTMLElement && ici !== document.body ? ici : null),
  };
  prevenir();
}

/** Change d'onglet sans changer d'ouvreur ; rien quand le panneau est fermé. */
export function changerOnglet(onglet: Onglet): void {
  if (!courant || courant.onglet === onglet) return;
  courant = { ...courant, onglet };
  prevenir();
}

/** Ferme le panneau et rend l'ouvreur, pour que l'hôte lui rende le focus. */
export function fermerReglage(): HTMLElement | null {
  const ouvreur = courant?.ouvreur ?? null;
  if (!courant) return null;
  courant = null;
  prevenir();
  return ouvreur;
}

const abonner = (ecoute: () => void) => {
  ecoutes.add(ecoute);
  return () => ecoutes.delete(ecoute);
};
const lire = () => courant;

/** L'ouverture en cours, ou `null` : un rendu à chaque changement. */
export function useReglage(): Ouverture | null {
  return useSyncExternalStore(abonner, lire, lire);
}

/** Où rendre le focus : l'ouvreur s'il est encore dans la page et visible,
 * sinon `repli` (le rang de la colonne, qui revient avec les rangs). */
export function focusRendu(
  ouvreur: HTMLElement | null,
  repli: () => HTMLElement | null,
): HTMLElement | null {
  if (ouvreur?.isConnected && !ouvreur.closest("[hidden],[inert]")) return ouvreur;
  return repli();
}
