/**
 * Où vit la colonne de la salle, et ce qui se monte par-dessus l'image.
 *
 * Sur un grand écran, la colonne vit à droite de l'image et se replie par Ctrl
 * (`fullscreen.ts`). Sur un téléphone, elle était repliée d'office et ses
 * fonctions n'existaient nulle part ailleurs (audit P5 et E2, 22 novembre
 * 2026) ; dépliée, elle prenait la moitié de la largeur (audit M6). Elle est
 * devenue un tiroir ce jour-là, à côté d'une feuille du bas : deux couches
 * pour une même salle.
 *
 * Depuis le 23 novembre 2026, il n'y en a plus qu'une. Une salle tenue en
 * main (`lib/cadre`, portrait et paysage) a sa feuille « La salle », à deux
 * hauteurs : les gestes de la partie à mi-hauteur, toute la salle agrandie.
 * Une fenêtre étroite à la souris pose la colonne sous l'image.
 *
 * Le mode lui-même (bureau, étroit, tenu en main) se décide dans `lib/cadre`
 * (`modeDuCadre`, `BUREAU_DES`), qui a repris le seuil de 900 px mesuré ici
 * le 22 novembre 2026, et la règle du pointeur grossier : une tablette de
 * 1024 px tenue en travers a la place d'une colonne, mais pas celle d'une
 * colonne ET de la manette à l'écran.
 */
/** Les deux hauteurs de la feuille « La salle » d'une salle tenue en main :
 * à mi-hauteur les gestes de la partie, agrandie toute la salle (ce qui était
 * le tiroir jusqu'au 23 novembre 2026). */
export type HauteurFeuille = "mi" | "agrandie";

/** Ce que la salle sait au moment de poser ses couches. */
export type EtatDesCouches = {
  /** La salle est tenue en main : portrait ou paysage (`lib/cadre`). */
  tenu: boolean;
  /** Une fenêtre étroite à la souris : la colonne passe sous l'image. */
  etroit: boolean;
  /** La feuille « La salle », et sa hauteur, ou `null` fermée. */
  feuille: HauteurFeuille | null;
  /** La manette à l'écran est voulue, et une session existe pour elle. */
  manette: boolean;
  /** Un écran couvre l'image (`voileSurImage`). */
  voile: boolean;
  /** La colonne est repliée par Ctrl (souris seulement). */
  bare: boolean;
  /** Le réglage des touches est ouvert : la manette à l'écran n'est pas
   * montée, elle enverrait au jeu ce qu'on essaie (chantier manettes). */
  reglage?: boolean;
};

/** Ce qui est monté : la manette à l'écran, et où vit la colonne. Une seule
 * fonction, pour qu'aucune condition de montage ne lise un état que les
 * autres ont oublié. */
export type Couches = {
  pave: boolean;
  /** À côté de l'image (bureau), dessous (étroit), dans la feuille agrandie
   * (tenu en main), ou nulle part (repliée, ou feuille fermée). */
  colonne: "a-cote" | "dessous" | "feuille" | null;
};

export function couchesDeLaSalle(e: EtatDesCouches): Couches {
  // La manette n'est pas montée sous la feuille : le démontage relâche ce
  // qu'un doigt tenait encore (audit M6). Sa PLACE reste réservée par le
  // cadre, qui la compte qu'elle soit montée ou non : l'image ne bouge pas.
  const pave = e.manette && !e.voile && e.feuille === null && !e.reglage;
  const colonne = e.tenu
    ? e.feuille === "agrandie"
      ? "feuille"
      : null
    : e.bare
      ? null
      : e.etroit
        ? "dessous"
        : "a-cote";
  return { pave, colonne };
}

/** « La salle », depuis le menu ou le détail de la liaison : la feuille
 * agrandie quand la salle est tenue en main, la colonne dépliée sinon. */
export function ouvrirLaSalle(tenu: boolean): { feuille: "agrandie" } | { bare: false } {
  return tenu ? { feuille: "agrandie" } : { bare: false };
}

/** Ce que Ctrl seule change dans une salle tenue en main. `null` : rien. */
export function apresCtrl(e: {
  feuille: HauteurFeuille | null;
  menu: boolean;
  /** Le réglage des touches est ouvert. */
  touches: boolean;
}): { feuille: HauteurFeuille | null; menu: boolean } | null {
  // Le réglage des touches lit le clavier, et une feuille par-dessus le
  // rendrait inerte au milieu d'une capture.
  if (e.touches) return null;
  // Le menu se ferme : deux dialogues modaux empilés laissaient le bouton
  // « menu » sans effet (relecture du 22 novembre 2026).
  return { feuille: e.feuille === null ? "agrandie" : null, menu: false };
}

/** Un écran couvre-t-il toute l'image ? */
export function voileSurImage(e: {
  /** La salle au repos, sans menu ni préparation par-dessus. */
  repos: boolean;
  /** Un changement de jeu se charge. */
  chargement: boolean;
  /** Le rideau d'une arrivée sans image. */
  rideau: boolean;
}): boolean {
  return e.repos || e.chargement || e.rideau;
}

/** Où rendre le focus quand la feuille se ferme. */
export function focusApresFermeture(e: {
  /** Le focus est retombé sur le document: ce qui l'avait a disparu. */
  perdu: boolean;
  /** Un bouton « La salle » est monté pour le reprendre. */
  salle: boolean;
}): "salle" | "jeu" | null {
  if (!e.perdu) return null;
  return e.salle ? "salle" : "jeu";
}
