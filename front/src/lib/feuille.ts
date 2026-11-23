/**
 * La feuille « La salle » d'une salle tenue en main : les gestes de la PAGE,
 * hors des touches du jeu.
 *
 * La manette à l'écran portait trois gestes de page parmi ses touches: son,
 * menu, cacher. Le 22 novembre 2026, sur un iPhone tenu droit, « cacher » était
 * posé sur R, et taper R faisait disparaître la manette en pleine partie
 * (audit M1). Le plein écran et « signaler » n'avaient pas de place du tout,
 * et la colonne, repliée d'office, emportait avec elle les places, les
 * spectateurs et la sortie (audit P5).
 *
 * Une feuille du bas, ouverte par « ••• », et un tiroir pour la colonne les
 * ont remplacés ce jour-là. Depuis le 23 novembre, c'est une seule feuille, à
 * deux hauteurs, ouverte par « La salle » (dans la barre, ou parmi les
 * touches quand la barre manque). À mi-hauteur, elle porte les gestes de la
 * partie ; « Toute la salle » l'agrandit, et la colonne entière y vit : les
 * places, qui regarde, inviter, signaler, quitter.
 *
 * Ce module dit QUOI montrer à mi-hauteur ; `FeuilleSalle` le pose. Le son
 * coupé passe en tête : c'est la seule entrée qui répare quelque chose.
 */
import type { PleinEcran } from "./plein-ecran";
import { clipAide, type ClipState } from "./clip";
import { TACTILE } from "./mots";

/** Le nom du bouton « La salle », lu à voix haute : le son coupé y est dit
 * en mots, la pastille rouge seule ne se lisant pas. Un seul texte pour le
 * bouton de la barre et pour celui qui se pose parmi les touches.
 *
 * `libelle` est l'emplacement du chantier personnes (« Lina · ta place ») :
 * dit en premier, avant ce que le bouton ouvre. */
export function nomDeLaSalle(sonCoupe: boolean, libelle?: string): string {
  const nom = libelle ? `${libelle}. La salle : son, menu, places` : "La salle : son, menu, places";
  return sonCoupe ? `Son coupé. ${nom}` : nom;
}

/** Les boutons qui ouvrent la feuille : celui de la barre, celui posé parmi
 * les touches et celui du cadre en travers. Lu par la salle pour leur rendre
 * le focus. */
export const OUVRE_LA_FEUILLE = '[data-geste="feuille"]';

export type IdEntree =
  | "son"
  | "menu"
  | "clip"
  | "manette"
  | "plein-ecran"
  | "ecran-accueil"
  | "toute-la-salle";

export type EntreeFeuille = {
  id: IdEntree;
  titre: string;
  detail: string;
  alerte: boolean;
  /** Le geste ne fait rien pour l'instant (un clip qui s'emballe). */
  inactif?: true;
};

export type EtatFeuille = {
  /** Le contexte audio ne joue pas. */
  sonCoupe: boolean;
  /** La manette à l'écran: montrée, cachée, ou sans objet à la souris. */
  manette: "montree" | "cachee" | null;
  plein: PleinEcran;
  /** La page est en plein écran en ce moment. */
  pleinActif: boolean;
  /** Le clip des 45 dernières secondes, ou `null` sans partie à garder. */
  clip: ClipState | null;
  /** Le téléphone est en travers : la feuille n'a qu'une colonne. */
  travers?: boolean;
};

/** Le clip, à mi-hauteur : quarante-cinq secondes ne se demandent pas
 * après coup, et la feuille agrandie était à deux touchers (feuille-du-bas.2,
 * 23 novembre 2026). Même geste que le rang de la colonne. */
function entreeClip(clip: ClipState): EntreeFeuille {
  const titre =
    clip.phase === "fait"
      ? "Enregistrer le clip"
      : clip.phase === "en cours"
        ? "Le clip s'emballe…"
        : clip.phase === "attendre"
          ? `Clip possible dans ${clip.seconds}\u00a0s`
          : clip.phase === "raté"
            ? "Le clip a raté"
            : "Garder les 45 dernières secondes";
  const occupe = clip.phase === "en cours" || clip.phase === "attendre";
  return {
    id: "clip",
    titre,
    detail: clipAide(clip),
    alerte: clip.phase === "raté",
    ...(occupe ? { inactif: true as const } : {}),
  };
}

export function entreesDeLaFeuille({
  sonCoupe,
  manette,
  plein,
  pleinActif,
  clip,
  travers = false,
}: EtatFeuille): EntreeFeuille[] {
  const entrees: EntreeFeuille[] = [
    sonCoupe
      ? {
          id: "son",
          titre: "Rallumer le son",
          // Sans l'interrupteur de l'iPhone: le déblocage de `media/sound.ts`
          // fait sortir le son du canal de la sonnerie, et la phrase
          // s'affichait aussi sur un ordinateur (relecture du 22 novembre 2026).
          detail: "Le son est coupé. Touche ici pour le rallumer.",
          alerte: true,
        }
      : {
          id: "son",
          titre: "Tester le son",
          detail: "Un bip, pour vérifier le volume.",
          alerte: false,
        },
    { id: "menu", titre: "Menu du jeu", detail: "Jeux, sauvegardes, réglages.", alerte: false },
  ];
  // En travers, la feuille n'a qu'une colonne dans la bande gauche, et le
  // clip la faisait défiler : 458 px de contenu pour 390 à 844×390
  // (salle-telephone, 23 novembre 2026). Il y reste dans la salle entière.
  if (clip !== null && !travers) entrees.push(entreeClip(clip));
  if (manette !== null)
    entrees.push(
      manette === "montree"
        ? {
            id: "manette",
            titre: `Cacher les ${TACTILE}`,
            detail: "Pour jouer avec une vraie manette.",
            alerte: false,
          }
        : {
            id: "manette",
            titre: `Montrer les ${TACTILE}`,
            detail: "Les touches à l'écran.",
            alerte: false,
          },
    );
  if (plein === "api")
    entrees.push({
      id: "plein-ecran",
      titre: pleinActif ? "Quitter le plein écran" : "Plein écran",
      detail: pleinActif ? "Retrouver les barres du navigateur." : "Sans les barres du navigateur.",
      alerte: false,
    });
  else if (plein === "ecran-accueil")
    entrees.push({
      id: "ecran-accueil",
      titre: "Sur l'écran d'accueil",
      detail: "Pour jouer sans la barre du navigateur.",
      alerte: false,
    });
  // La salle entière en dernier : elle agrandit la feuille au lieu d'ouvrir
  // une seconde couche. Signaler y vit, en tête de la colonne (K25).
  entrees.push({
    id: "toute-la-salle",
    titre: "Toute la salle",
    detail: "Places, qui regarde, signaler, quitter.",
    alerte: false,
  });
  return entrees;
}
