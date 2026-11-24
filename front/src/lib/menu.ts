/**
 * Le menu de la salle, sans React : ses rubriques, ses lignes, comment on s'y
 * déplace et où il se pose (chantier menus, 24 novembre 2026).
 *
 * Un seul menu remplace les trois formes d'avant (XMB, chaînes Wii, accueil
 * Switch) : quatre rubriques en onglets, des lignes pleine largeur, et rien
 * sur l'image du jeu. Il n'est plus un dialogue modal qui couvre tout (ADR D30
 * amendé) : au bureau il prend la place des rangs de la colonne, tenu en main
 * celle du panneau et de la manette sous l'image, ou une bande à côté d'elle.
 *
 * Ce que le menu MONTRE dépend de qui est là et de ce que la salle joue : la
 * page construit les lignes, ce module dit seulement leur forme et leur
 * ordre, et le composant les dessine.
 */
import type { ReactNode } from "react";
import type { IconePixel } from "../retro/icones";
import type { Geometrie, Rect, ZonesSures } from "./cadre";

/** Les quatre rubriques, dans l'ordre des onglets. */
export const RUBRIQUES = ["jeux", "manettes", "salle", "reglages"] as const;
export type IdRubrique = (typeof RUBRIQUES)[number];

/** L'icône en pixels de chaque rubrique (M14), une par sens, du jeu
 * d'icônes du socle. Elle ne se montre qu'avec l'effet « icones », et
 * l'onglet garde son mot. */
export const ICONE_DE_RUBRIQUE = {
  jeux: "cartouche",
  manettes: "manette",
  salle: "porte",
  reglages: "curseurs",
} as const satisfies Record<IdRubrique, IconePixel>;

/** Une aide se lit d'un coup d'œil : moins de 70 caractères (M8). */
export const AIDE_MAX = 70;

/** Un choix d'une liste courte : une pastille radio. */
export type Choix = { id: string; label: string; hint?: string };

/** Une décision qui s'ouvre dans une fiche, dans le menu : lancer un jeu sur
 * une sauvegarde, fermer le jeu, fermer la salle. La fiche dit ce que le
 * geste fait avant qu'on le fasse, et « Continuer » revient sans rien faire. */
export type FicheDeLigne = {
  /** La conséquence, en gras au-dessus du bouton qui agit. */
  consequence: string;
  /** Le libellé du bouton qui agit : « Lancer », « Fermer le jeu ». */
  agir: string;
  /** Le libellé du bouton qui revient sans rien faire. */
  annuler: string;
  /** Les choix de la fiche (les sauvegardes), cochés par `coche`. */
  choix?: Choix[];
  coche?: string;
  /** Ce que la fiche montre en plus : le résumé de la connexion. */
  contenu?: ReactNode;
  /** Ce qui suit le geste, sous les boutons : « Le jeu part tout de suite. » */
  suite?: string;
  /** Pourquoi cette page ne peut pas agir (B8) : la fiche se lit, ses choix
   * sont grisés et le bouton qui agit n'est pas rendu. */
  refus?: string;
  /** Les choix ne sont pas encore sûrs (les sauvegardes se lisent) : ils
   * sont grisés, et le bouton qui agit aussi. */
  occupe?: boolean;
  /** Le geste, avec le choix coché quand il y en a. */
  onAgir: (choix: string | null) => void;
};

/** Une ligne d'une rubrique. */
export type Ligne = {
  id: string;
  label: string;
  /** L'aide, toujours visible sous le libellé. */
  hint?: string;
  /** Le groupe : un titre posé avant la première ligne qui le porte. */
  group?: string;
  /** Ce que ça vaut en ce moment, à droite : « 70 », « légère ». */
  value?: string;
  /** Une ligne qui existe mais ne se choisit pas, avec sa raison en aide. */
  disabled?: boolean;
  onEnter?: () => void;
  /** Un choix d'une liste courte, appliqué tout de suite. */
  picks?: Choix[];
  picked?: string;
  onPick?: (id: string) => void;
  /** Une valeur continue : un curseur natif nommé. */
  slide?: {
    value: number;
    min: number;
    max: number;
    step: number;
    say: (value: number) => string;
    onSet: (value: number) => void;
  };
  /** Un interrupteur (role=switch) : `onEnter` le bascule. */
  bascule?: boolean;
  /** « Réglages avancés » : il déplie ou replie les lignes suivantes. */
  deplie?: boolean;
  /** Une décision : elle s'ouvre dans une fiche au lieu d'agir. */
  fiche?: FicheDeLigne;
};

export type Rubrique = { id: IdRubrique; label: string; lignes: Ligne[] };

/** Ce qu'une ligne dessine. Une décision l'emporte sur tout le reste : une
 * ligne qui ouvre une fiche n'agit jamais d'un seul geste. */
export type Forme = "fiche" | "choix" | "glissiere" | "bascule" | "depli" | "action";

export function formeDe(ligne: Ligne): Forme {
  if (ligne.fiche) return "fiche";
  if (ligne.deplie !== undefined) return "depli";
  if (ligne.picks) return "choix";
  if (ligne.slide) return "glissiere";
  if (ligne.bascule !== undefined) return "bascule";
  return "action";
}

/** Les lignes par groupe, dans leur ordre. Un groupe qui revient après un
 * autre forme un second bloc plutôt que de déplacer ses lignes. */
export function enGroupes(lignes: readonly Ligne[]): { group: string | null; lignes: Ligne[] }[] {
  const blocs: { group: string | null; lignes: Ligne[] }[] = [];
  for (const ligne of lignes) {
    const group = ligne.group ?? null;
    const dernier = blocs.at(-1);
    if (dernier && dernier.group === group) dernier.lignes.push(ligne);
    else blocs.push({ group, lignes: [ligne] });
  }
  return blocs;
}

/** Les aides trop longues pour se lire d'un coup d'œil (M8). */
export function aidesTropLongues(rubriques: readonly Rubrique[], max = AIDE_MAX): string[] {
  return rubriques.flatMap((r) =>
    r.lignes.filter((l) => (l.hint ?? "").length >= max).map((l) => `${r.id}/${l.id}`),
  );
}

/** Une action du clavier ou de la manette dans le menu. */
export type Geste = "haut" | "bas" | "gauche" | "droite";

/** Ce qui a le focus quand la flèche arrive. */
export type Sous = "onglet" | "ligne" | "choix" | "glissiere" | "ailleurs";

/** Ce que fait une flèche : passer à la ligne voisine, à la rubrique voisine,
 * ou rien (le navigateur garde la touche). */
export type Pas = { vers: "ligne" | "rubrique"; sens: 1 | -1 } | null;

/** Les pastilles d'un choix sont posées sur leur ligne, côte à côte : ← → y
 * changent le choix, comme le navigateur le fait dans un groupe de radios, et
 * ↑ ↓ passent à la ligne voisine. Un curseur garde ← → pour sa valeur. Sans
 * cette règle, ← sur « légère » changeait de rubrique au lieu de choix, et ↓
 * dans un groupe de radios cochait le choix suivant au lieu de descendre. */
export function pas(geste: Geste, sous: Sous): Pas {
  if (sous === "ailleurs") return null;
  const lateral = geste === "gauche" || geste === "droite";
  if (lateral) {
    if (sous === "choix" || sous === "glissiere") return null;
    return { vers: "rubrique", sens: geste === "droite" ? 1 : -1 };
  }
  if (sous === "onglet") return geste === "bas" ? { vers: "ligne", sens: 1 } : null;
  return { vers: "ligne", sens: geste === "bas" ? 1 : -1 };
}

/** L'index voisin, sans faire le tour : après la dernière ligne, ↓ reste sur
 * la dernière (M4). Un tour silencieux renvoyait en tête une personne qui
 * descendait la liste, et elle croyait avoir perdu sa place. */
export function voisin(index: number, n: number, sens: 1 | -1): number {
  if (n <= 0) return 0;
  return Math.min(n - 1, Math.max(0, index + sens));
}

/** Où le menu se pose (M2) : jamais sur l'image du jeu.
 *
 * - au bureau et en fenêtre étroite, dans la colonne, à la place de ses rangs ;
 * - tenu droit, sous l'image, à la place du panneau, de la bande et de la
 *   manette à l'écran (la place reste réservée : l'image ne bouge pas) ;
 * - couché, dans la plus large des deux bandes à côté de l'image.
 *
 * Couché, une image 16:9 ne laisse que deux bandes de 75 px : il n'y a pas
 * de place à côté d'elle. Le menu prend alors la feuille agrandie de la salle,
 * qui couvre le bord de l'image, et `surImage` le dit (`data-sur-image`) :
 * c'est un défaut connu, à trancher avec le chantier salle, plutôt qu'un
 * menu de 75 px qu'on ne peut pas lire. */
export type PlaceDuMenu =
  | { lieu: "colonne" }
  | { lieu: "sous" | "cote"; rect: Rect; surImage: boolean };

/** La bande la plus étroite où le menu se lit encore. */
export const BANDE_MIN = 150;

export function placeDuMenu(
  geo: Geometrie,
  fenetre: { width: number; height: number },
  zones: ZonesSures,
): PlaceDuMenu {
  if (geo.mode === "bureau" || geo.mode === "etroit") return { lieu: "colonne" };
  const bas = fenetre.height - zones.bas;
  if (geo.mode === "portrait") {
    const haut = geo.ecran
      ? geo.ecran.y + geo.ecran.h
      : geo.barre
        ? geo.barre.y + geo.barre.h
        : zones.haut;
    return {
      lieu: "sous",
      rect: {
        x: zones.gauche,
        y: haut,
        w: fenetre.width - zones.gauche - zones.droite,
        h: bas - haut,
      },
      surImage: false,
    };
  }
  const haut = zones.haut;
  const gauche = geo.ecran ? Math.floor(geo.ecran.x) - zones.gauche : 0;
  const droite = geo.ecran
    ? fenetre.width - zones.droite - Math.ceil(geo.ecran.x + geo.ecran.w)
    : 0;
  if (Math.max(gauche, droite) >= BANDE_MIN) {
    const x = gauche >= droite ? zones.gauche : fenetre.width - zones.droite - droite;
    const w = gauche >= droite ? gauche : droite;
    // « La salle » se pose en haut de la bande gauche (`boutonSalle`) : le
    // menu commence sous lui, sinon le bouton couvrait sa sortie.
    const bouton = geo.boutonSalle;
    const y =
      bouton && bouton.x < x + w && bouton.x + bouton.w > x ? bouton.y + bouton.h + 4 : haut;
    return { lieu: "cote", rect: { x, y, w, h: bas - y }, surImage: false };
  }
  const repli = geo.feuille?.agrandie ?? {
    x: 0,
    y: 0,
    w: Math.min(380, fenetre.width),
    h: fenetre.height,
  };
  return { lieu: "cote", rect: repli, surImage: true };
}
