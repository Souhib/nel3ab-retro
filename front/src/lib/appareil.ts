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
  tactile: { choisir: "Touche", retour: "", deplacer: "Glisse" },
};

export function gestes(appareil: Appareil): Gestes {
  return GESTES[appareil];
}

/** Une touche et ce qu'elle fait, pour le pied d'un menu. */
export type Repere = { touche: string; fait: string };

/**
 * Le pied d'un menu: comment se déplacer, choisir, revenir.
 *
 * « rubrique » et « entrée » ont disparu de cette ligne: « entrée » y voulait
 * dire une ligne de la liste, alors que les jeux disaient « entrée: … » pour
 * la touche Entrée (audit T13). On dit ce qu'on FAIT, pas le nom des pièces.
 *
 * Au doigt, pas de touche à nommer: on glisse et on touche, et la sortie est
 * un vrai bouton, à part.
 */
export function piedDuMenu(appareil: Appareil): Repere[] {
  const ici = gestes(appareil);
  if (appareil === "tactile")
    return [
      { touche: ici.deplacer, fait: "pour te déplacer" },
      { touche: ici.choisir, fait: "pour choisir" },
    ];
  return [
    { touche: ici.deplacer, fait: "se déplacer" },
    { touche: ici.choisir, fait: "choisir" },
    { touche: ici.retour, fait: "retour" },
  ];
}

/** « Entrée pour ouvrir la glissière », « A pour… », « Touche pour… ». */
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

/** Au doigt, pas de touche à dessiner: une phrase. « Glisse » dans une
 * pastille ressemblait à une touche qu'on chercherait sur le téléphone. */
export function phrase(liste: readonly Repere[]): string {
  const dite = liste
    .map((one, at) => `${at === 0 ? one.touche : one.touche.toLowerCase()} ${one.fait}`)
    .join(", ");
  return dite ? `${dite}.` : "";
}
