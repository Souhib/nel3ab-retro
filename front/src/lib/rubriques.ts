/**
 * Les lignes des rubriques du menu, construites hors d'`App.tsx` (M8, M9).
 *
 * `App.tsx` les écrivait en ligne, au milieu de trois mille lignes : une aide
 * de plus de 150 caractères y a vécu des semaines sans que rien ne la voie.
 * Ici, chaque rubrique est une fonction pure de ce que la salle sait, et
 * `rubriques.test.ts` la construit pour chaque console, une console inconnue
 * comprise, pour vérifier ses aides (moins de 70 caractères) et ses gestes.
 */
import type { Ligne } from "./menu";
import { aideManetteSeule, MANETTE_SEULE, MENU, TACTILE } from "./mots";
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
  /** Le moteur de cette console (`moteurDe`), pour ne dire un chiffre
   * mesuré que là où il l'a été. */
  moteur: string | null;
  pad: Pad;
  touchPref: TouchPref;
  padOnly: boolean;
  /** Ouvre « Touches et manettes » (`ouvrirReglage`) sur un onglet. */
  ouvrirTouches: (onglet: "manette" | "clavier") => void;
  switchPad: (pad: Pad) => void;
  setTouchPref: (pref: TouchPref) => void;
  onPadOnly: (sansImage: boolean) => void;
};

/** La rubrique Manettes (M9) : tes touches, toutes les touches du clavier,
 * l'appareil des jeux Wii, les commandes tactiles et la manette seule, dans
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
      {
        id: "padonly",
        label: MANETTE_SEULE,
        hint: aideManetteSeule(e.moteur),
        picks: [
          { id: "avec", label: MENU.avecImage },
          { id: "sans", label: MENU.sansImage },
        ],
        picked: e.padOnly ? "sans" : "avec",
        // Changer de mode reconstruit la session : la place tenue est rendue
        // puis reprise.
        onPick: (id) => e.onPadOnly(id === "sans"),
      },
    ],
    MANETTES,
  );
}
