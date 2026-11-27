/**
 * Les lignes des rubriques du menu, construites hors d'`App.tsx` (M8, M9,
 * M10).
 *
 * `App.tsx` les écrivait en ligne, au milieu de trois mille lignes : une aide
 * de plus de 150 caractères y a vécu des semaines sans que rien ne la voie.
 * Ici, chaque rubrique est une fonction pure de ce que la salle sait, et
 * `rubriques.test.ts` la construit pour chaque console, une console inconnue
 * comprise, pour vérifier ses aides (moins de 70 caractères) et ses gestes.
 */
import type { ReactNode } from "react";
import type { Ligne } from "./menu";
import { chefAbsent, enMenu, FICHE, MENU, PLACE, SORTIES, TACTILE } from "./mots";
import { PADS, type Pad } from "./saves";
import { arrange, MANETTES } from "./settings";
import { TOUCHPADS, type TouchPref } from "./theme";

/** Ce que la rubrique Manettes lit de la salle, et ce qu'elle fait. */
export type EntreeManettes = {
  /** La manette branchée attend ses correspondances. */
  aConfigurer: boolean;
  /** Le profil clavier en usage. */
  profilClavier: string;
  /** La console du jeu en cours, `undefined` au repos. */
  console: string | undefined;
  pad: Pad;
  touchPref: TouchPref;
  /** Ouvre « Touches et manettes » (`ouvrirReglage`) sur un onglet. */
  ouvrirTouches: (onglet: "manette" | "clavier") => void;
  switchPad: (pad: Pad) => void;
  setTouchPref: (pref: TouchPref) => void;
};

/** La rubrique Manettes (M9) : tes touches, toutes les touches du clavier,
 * l'appareil des jeux Wii et les commandes tactiles, dans
 * l'ordre de `MANETTES`. Les deux premières ouvrent le réglage du chantier
 * des manettes ; elles n'en copient rien. */
export function lignesManettes(e: EntreeManettes): Ligne[] {
  return arrange<Ligne>(
    [
      {
        id: "bindings",
        label: MENU.touches,
        // Une manette qui attend ses correspondances le dit ici aussi :
        // l'avis de branchement s'efface au bout de cinq secondes (P12).
        ...(e.aConfigurer
          ? { value: "à configurer", hint: MENU.attendCorrespondances }
          : { hint: MENU.profilClavier(e.profilClavier) }),
        // Le panneau vit dans la colonne : le menu se ferme, et le jeu de
        // cette place reçoit un état neutre tant qu'il est ouvert.
        onEnter: () => e.ouvrirTouches("manette"),
      },
      {
        id: "touches-clavier",
        label: MENU.clavier,
        hint: MENU.aideClavier,
        onEnter: () => e.ouvrirTouches("clavier"),
      },
      {
        id: "pad",
        // « appareil » : ce choix dit ce que le jeu voit (manette GameCube,
        // Wiimote, guitare), pas quelle manette on tient.
        label: MENU.appareilWii,
        // Une seule des deux à la fois : elles lisent le même tuyau, et un
        // jeu qui voit les deux compte deux manettes pour une personne.
        hint:
          e.console === "wii"
            ? e.pad === 0
              ? MENU.wiiRelance
              : MENU.wiiSansRelance
            : MENU.wiiProchain,
        picks: PADS.map((one) => ({ id: String(one.id), label: one.label, hint: one.note })),
        picked: String(e.pad),
        // Relu dans la table, jamais deviné : la guitare retombait sur la
        // manette GameCube sans un mot.
        onPick: (id: string) => {
          const wanted = PADS.find((one) => String(one.id) === id)?.id;
          if (wanted !== undefined) e.switchPad(wanted);
        },
      },
      {
        id: "touchpad",
        label: TACTILE,
        hint: MENU.aideTactile,
        picks: TOUCHPADS.map((choice) => ({
          id: choice.id,
          label: choice.label,
          hint: choice.note,
        })),
        picked: e.touchPref,
        onPick: (id) => {
          const voulu = TOUCHPADS.find((choice) => choice.id === id)?.id;
          if (voulu !== undefined) e.setTouchPref(voulu);
        },
      },
    ],
    MANETTES,
  );
}

/** Qui choisit le jeu, tel que la salle le dit. */
export type Chef = { nom: string; place: number | null; moi: boolean };

/** Ce que la rubrique Salle lit de la salle, et ce qu'elle fait. */
export type EntreeSalle = {
  /** Qui choisit le jeu, `null` sans chef. */
  chef: Chef | null;
  /** « Prendre le rôle de chef » se propose (`repriseDuRole`). */
  reprise: boolean;
  /** Le jeu en cours, `null` au repos. */
  jeu: { index: number } | null;
  /** Cette page choisit le jeu : elle peut le fermer, et fermer la salle. */
  peutFermer: boolean;
  /** L'index du jeu dont la fermeture est acceptée, `null` sinon (P10). */
  fermeture: number | null;
  /** Combien de places sont tenues. */
  tenues: number;
  /** La salle vit sous un salon : elle peut se fermer (P14). */
  sousUnSalon: boolean;
  nomSalle: string;
  /** La salle est tenue en main : ses places vivent dans la feuille. */
  tenu: boolean;
  /** L'aide de la ligne « la salle », selon l'appareil. */
  aideSalle: string;
  /** Cette page regarde sans place. */
  regarde: boolean;
  /** Le bouton Signaler de la page (K25), quand le menu remplace la
   * colonne et ses rangs ; `null` quand la colonne ou la feuille le porte. */
  signaler: ReactNode;
  reprendre: () => void;
  fermerJeu: (index: number) => void;
  fermerSalle: () => void;
  ouvrirSalle: () => void;
  basculerPlace: () => void;
  quitter: () => void;
};

/** La phrase de tête de la rubrique Salle : « [Nour] choisit le jeu. »,
 * l'étiquette à la place de Nour ; « Tu choisis le jeu. » pour le chef. */
export function qui(
  chef: Chef | null,
): { nom: string | null; place: number | null; texte: string } | null {
  if (chef === null) return null;
  if (chef.moi) return { nom: null, place: null, texte: MENU.tuChoisis };
  return { nom: chef.nom, place: chef.place, texte: MENU.choisitLeJeu };
}

/** Les lignes de la rubrique Salle (M10).
 *
 * Les places, le clip et Signaler vivent dans la colonne : deux endroits
 * pour un même geste sont deux endroits à tenir d'accord. Ce qui reste ici
 * n'existe nulle part ailleurs, sauf Signaler quand le menu prend la place
 * des rangs de la colonne (K25). Fermer le jeu et fermer la salle ne sont
 * que pour qui choisit le jeu, par une fiche qui dit ce que ça arrête. */
export function lignesSalle(e: EntreeSalle): Ligne[] {
  const lignes: Ligne[] = [];
  if (e.signaler !== null && e.signaler !== undefined)
    lignes.push({ id: "signaler", label: MENU.signaler, element: e.signaler });
  // Seulement quand le chef ne joue plus : proposé à tous, c'était la
  // première action offerte à un nouveau venu (T12).
  if (e.chef && e.reprise)
    lignes.push({
      id: "recover-owner",
      label: "prendre le rôle de chef",
      hint: `${chefAbsent(e.chef.nom)} ${e.chef.nom} sera prévenu.`,
      onEnter: e.reprendre,
    });
  const jeu = e.jeu;
  if (jeu && e.peutFermer) {
    // Une fermeture demandée est l'état de la ligne et de sa fiche, pas une
    // erreur dans un avis (P10).
    const enCours = e.fermeture === jeu.index;
    lignes.push({
      id: "close-game",
      label: "fermer le jeu",
      value: enCours ? FICHE.fermeture : undefined,
      hint: "Les sauvegardes sont conservées.",
      fiche: {
        consequence:
          e.tenues > 1
            ? `La partie s'arrête pour les ${e.tenues} joueurs. La salle reste ouverte.`
            : "La partie s'arrête. La salle reste ouverte.",
        agir: "Fermer le jeu",
        annuler: FICHE.continuer,
        occupe: enCours,
        suite: enCours ? FICHE.fermetureEnCours : undefined,
        onAgir: () => e.fermerJeu(jeu.index),
      },
    });
  }
  if (e.peutFermer && e.sousUnSalon)
    lignes.push({
      id: "close-room",
      label: "fermer la salle",
      hint: "Libère la carte graphique. Les sauvegardes sont conservées.",
      fiche: {
        consequence: `La partie s'arrête pour tous, et ${e.nomSalle} ferme.`,
        agir: "Fermer la salle",
        annuler: FICHE.continuer,
        onAgir: e.fermerSalle,
      },
    });
  // La feuille agrandie, quand la salle est tenue en main : les places,
  // demander celle d'un autre, signaler, le diagnostic, les spectateurs.
  if (e.tenu)
    lignes.push({ id: "places", label: "la salle", hint: e.aideSalle, onEnter: e.ouvrirSalle });
  lignes.push(
    {
      id: "watch",
      label: enMenu(e.regarde ? PLACE.prendre : PLACE.rendre),
      value: e.regarde ? "tu regardes" : undefined,
      hint: e.regarde ? "la première place libre" : "tu regardes, l'image et le son continuent",
      onEnter: e.basculerPlace,
    },
    {
      id: "leave",
      label: enMenu(SORTIES.quitter),
      // « retour à l'accueil » désignait deux pages différentes (P8).
      hint: e.sousUnSalon
        ? "vers les autres salles. La partie continue sans toi."
        : "retour à l'entrée de la salle. La partie continue sans toi.",
      onEnter: e.quitter,
    },
  );
  return lignes;
}
