/**
 * Deux crochets du menu et du rayonnage (chantier menus), sortis d'`App.tsx`
 * à la relecture du 24 novembre 2026 : la partition ne laisse à chaque
 * chantier qu'un commit de câblage dans ce fichier. Leur texte est celui
 * qui tournait, déplacé tel quel.
 */
import { useEffect, useRef, useState } from "react";
import { under } from "../../lib/base";
import { useMenuIdentity, useRelireIdentite } from "../../lib/me";
import { readUnlocked } from "../../lib/saves";

/** Les sauvegardes débloquées de chaque jeu et la vérification de
 * l'identité, lues quand une fiche de jeu peut s'ouvrir, et relues à chaque
 * ouverture (`relireLaBibliotheque`). */
export function useLectureDesSauvegardes(
  menu: boolean,
  idle: boolean,
): {
  unlockedSaves: readonly boolean[] | null;
  checkingIdentity: boolean;
  relireLaBibliotheque: () => void;
} {
  /* Les sauvegardes débloquées et l'identité se lisent quand une fiche de
     jeu peut s'ouvrir : le menu, ou le rayonnage d'une salle sans jeu. Lues
     menu ouvert seulement, toutes les fiches du rayonnage restaient grisées
     (B6a, 24 novembre 2026). */
  const bibliotheque = menu || idle;
  const checkingIdentity = useMenuIdentity(bibliotheque);
  /* Et elles se RELISENT à chaque ouverture du menu et de chaque fiche du
     rayonnage. Au repos, le rayonnage reste à l'écran : lues une fois à
     l'arrivée, elles proposaient encore une sauvegarde débloquée dont le
     contenu avait disparu, et une identité absente ne se redemandait
     jamais (save-options.mjs, 24 novembre 2026). La clé dit quelle lecture
     vaut : une réponse d'une autre clé ne compte pas, si bien qu'aucun
     rendu ne montre un ancien choix comme sûr. */
  const [relecture, setRelecture] = useState(0);
  const relireIdentite = useRelireIdentite();
  const relireLaBibliotheque = () => {
    setRelecture((n) => n + 1);
    relireIdentite();
  };
  const cleDesSauvegardes = bibliotheque ? `${menu ? "menu" : "repos"}:${relecture}` : null;
  const [sauvegardesLues, setSauvegardesLues] = useState<{
    cle: string;
    debloquees: readonly boolean[];
  } | null>(null);
  useEffect(() => {
    if (cleDesSauvegardes === null) return;
    let current = true;
    const lire = (debloquees: readonly boolean[]) => {
      if (current) setSauvegardesLues({ cle: cleDesSauvegardes, debloquees });
    };
    void readUnlocked(under("/saves"))
      .then(lire)
      .catch(() => lire([]));
    return () => {
      current = false;
    };
  }, [cleDesSauvegardes]);
  const unlockedSaves =
    sauvegardesLues !== null && sauvegardesLues.cle === cleDesSauvegardes
      ? sauvegardesLues.debloquees
      : null;
  return { unlockedSaves, checkingIdentity, relireLaBibliotheque };
}

/** La colonne repliée par Ctrl se déplie quand le menu s'y ouvre, et se
 * replie à sa fermeture. */
export function useColonneDuMenu(e: {
  menu: boolean;
  bare: boolean;
  /** Le menu se pose dans la colonne (`placeDuMenu`, lieu « colonne »). */
  dansLaColonne: boolean;
  setBare: (oui: boolean) => void;
}): void {
  const { menu, bare, dansLaColonne, setBare } = e;
  /* La colonne repliée par Ctrl se déplie quand le menu s'ouvre : c'est sa
     place au bureau. Elle se replie à la fermeture, pour rendre l'image
     agrandie qu'on avait demandée (focus.mjs, agrandir-ctrl). */
  const replieeAvantMenu = useRef(false);
  useEffect(() => {
    if (menu && bare && dansLaColonne) {
      replieeAvantMenu.current = true;
      setBare(false);
    } else if (!menu && replieeAvantMenu.current) {
      replieeAvantMenu.current = false;
      setBare(true);
    }
  }, [menu, bare, dansLaColonne, setBare]);
}
