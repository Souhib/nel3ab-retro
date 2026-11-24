/**
 * Ce que la personne tient en main, et les mots qui vont avec.
 *
 * # Pourquoi
 *
 * Le menu disait « A choisit » à tout le monde. Au clavier, la touche A ne
 * choisit rien dans le menu, et dans le jeu elle envoie Z (audit T02, 22
 * novembre 2026). La plupart des invités arrivent sur un MacBook ou un PC sans
 * manette: l'aide parlait donc d'un objet qu'ils n'avaient pas.
 *
 * La page sait déjà ce qu'on tient. `padId` est nul tant qu'aucune manette n'a
 * parlé, et un écran tactile se reconnaît à son pointeur grossier. Une aide ne
 * dit donc plus que les touches de l'appareil qu'on a.
 *
 * # Ce que ça ne sait pas
 *
 * Une personne qui a une manette branchée et joue quand même au clavier lit les
 * mots de la manette. Le navigateur ne dit pas lequel des deux on touche avant
 * qu'on ait touché, et deviner au premier appui ferait changer l'aide sous les
 * yeux. La manette gagne parce qu'elle est le cas le moins courant: si elle est
 * là, c'est qu'on l'a branchée exprès.
 */

export type Appareil = "clavier" | "manette" | "tactile";

/** Ce qu'on tient, d'après la manette vue par la page et le pointeur. */
export function appareilDe(padId: string | null, tactile: boolean): Appareil {
  if (padId !== null) return "manette";
  return tactile ? "tactile" : "clavier";
}

/** Les noms des trois gestes d'un menu, pour cet appareil. */
export type Gestes = {
  /** Ce qui valide: « Entrée », « A », ou le doigt. */
  choisir: string;
  /** Ce qui revient en arrière ou ferme. Vide au doigt: il y a un bouton. */
  retour: string;
  /** Ce qui déplace le curseur. */
  deplacer: string;
};

const GESTES: Record<Appareil, Gestes> = {
  clavier: { choisir: "Entrée", retour: "Échap", deplacer: "↑ ↓ ← →" },
  manette: { choisir: "A", retour: "B", deplacer: "croix" },
  // « Appuie » et non « Touche »: partout ailleurs, « touche » veut dire une
  // touche du clavier (relecture du 22 novembre 2026).
  tactile: { choisir: "Appuie", retour: "", deplacer: "Glisse" },
};

export function gestes(appareil: Appareil): Gestes {
  return GESTES[appareil];
}

/** Une touche et ce qu'elle fait, pour le pied d'un menu. */
export type Repere = { touche: string; fait: string };

/**
 * Le pied du menu: une ligne, dite après un premier usage du clavier ou de la
 * manette (M6 du chantier menus, 24 novembre 2026).
 *
 * Au clavier, ↑ ↓ et Entrée font ce qu'ils font partout dans la page: la ligne
 * ne dit que ce qui est propre au menu, ← → qui changent de rubrique et Échap
 * qui en sort. À la manette, Start rend la main au jeu (`menupad`). Au doigt,
 * pas de pied: la sortie est un vrai bouton en tête du menu.
 *
 * `partie` faux, dans une salle au repos, Échap et Start ferment le menu: il
 * n'y a pas de jeu où revenir.
 */
export function piedDuMenu(appareil: Appareil, partie = true): Repere[] {
  const sortie = partie ? "revenir au jeu" : "fermer le menu";
  if (appareil === "tactile") return [];
  if (appareil === "manette")
    return [
      { touche: "A", fait: "valider" },
      { touche: "B", fait: "revenir" },
      { touche: "Start", fait: partie ? "au jeu" : "fermer le menu" },
    ];
  return [
    { touche: "← →", fait: "rubriques" },
    { touche: "Échap", fait: sortie },
  ];
}

/** « Entrée pour ouvrir la glissière », « A pour… », « Appuie pour… ». */
export function pour(appareil: Appareil, quoi: string): string {
  return `${gestes(appareil).choisir} pour ${quoi}`;
}

/** Le pied d'un sélecteur: valider et annuler, nommés pour cet appareil. */
export function piedDuSelecteur(appareil: Appareil): { valider: string; annuler: string } {
  if (appareil === "tactile") return { valider: "Valider", annuler: "Annuler" };
  const ici = gestes(appareil);
  return { valider: `${ici.choisir} valider`, annuler: `${ici.retour} annuler` };
}

/** Comment on ouvre le menu, dit dans la colonne. Il n'existe pas de bouton de
 * manette pour l'ouvrir: une manette passe par le bouton « menu ». */
export function ouvrirLeMenu(appareil: Appareil): string {
  if (appareil === "clavier") return "Échap ouvre le menu.";
  return "Le bouton « menu » ouvre le menu.";
}

/** L'aide de l'entrée « la salle » du menu, en mode tiroir. */
export function aideDeLaSalle(appareil: Appareil): string {
  // Ctrl n'existe qu'au clavier: l'aide l'écrivait en dur, et un téléphone
  // lisait « (Ctrl) » (relecture du 22 novembre 2026).
  const quoi = "prendre ou demander une place, signaler, quitter";
  return appareil === "clavier"
    ? `${pour(appareil, quoi)}. En jeu, Ctrl seule l'ouvre aussi`
    : pour(appareil, quoi);
}

/** Au doigt, pas de touche à dessiner: une phrase. « Glisse » dans une
 * pastille ressemblait à une touche qu'on chercherait sur le téléphone. */
export function phrase(liste: readonly Repere[]): string {
  const dite = liste
    .map((one, at) => `${at === 0 ? one.touche : one.touche.toLowerCase()} ${one.fait}`)
    .join(", ");
  return dite ? `${dite}.` : "";
}
