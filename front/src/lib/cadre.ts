/**
 * Le cadre de la salle : où se pose chaque chose autour de l'image.
 *
 * # Une seule règle, et elle est absolue
 *
 * L'image du jeu est le seul occupant de son rectangle. Rien ne se pose
 * dessus, rien ne la voile, rien ne la déplace pendant une partie. Jusqu'au
 * 23 novembre 2026, sept calques s'y posaient ou lui prenaient de la hauteur :
 * la pile des avis du haut (manette branchée, fermeture proche, clavier en
 * pause), l'avis de l'image légère, les boutons de coin à 30 %, la manette
 * tactile, l'état de la liaison, la bande d'apprentissage. Le cadre leur donne
 * à chacun un emplacement HORS de l'image, calculé ici.
 *
 * # Une fonction pure, appelée rarement
 *
 * `miseEnPage` rend la géométrie entière à partir de ce que la salle sait :
 * le mode, la fenêtre, les zones sûres, la taille de l'image reçue, le réglage
 * de la pose (`lib/fit`), l'état, le rôle, la manette tactile, la largeur de
 * la colonne. Elle se recalcule sur un redimensionnement, une taille d'image,
 * un réglage ou un état, jamais à chaque image : React n'est pas sur le
 * chemin d'image (ADR D13), et le cadre non plus.
 *
 * # Le panneau de commande se décide sur la VRAIE pose
 *
 * Le panneau de commande de la borne (les places START 1P à 4P, le crédit,
 * le temps de jeu) se pose sous l'image seulement si l'image garde exactement
 * sa taille avec lui. La maquette décidait sur « 64 px libres sous une image
 * qui remplit » : c'est faux en « entier » et en « origine », où l'image est
 * plus petite et laisse bien plus de place. On calcule donc la pose avec et
 * sans le panneau, par `place` de `lib/fit`, et on compare.
 *
 * Cette pose est celle de la BASE (`baseDuPanneau`) : le format attendu de
 * la console tant qu'aucun changement de mise en page n'a suivi la première
 * image, la vraie image ensuite. La première image ne déplace donc rien
 * (24 novembre 2026).
 *
 * # La manette tactile se mesure dans sa propre pose
 *
 * Les dimensions des manettes (`MANETTES`) viennent de `encombrement` dans
 * `lib/faces`, qui interroge la pose des touches elle-même. Jusqu'au
 * 23 novembre 2026, elles venaient des dessins de la maquette, et la pose
 * réelle ne tenait pas dedans (voir `encombrement`).
 */
import type { Etat as EtatDeLiaison } from "../media/liaison";
import { DOLPHIN_FACE, encombrement, FENTE, SWITCH_FACE, type Encombrement } from "./faces";
import { place, type Fit, type Placed, type Size } from "./fit";

/** Un rectangle en pixels de la fenêtre : la même forme que `faces.Rect`. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Les marges qu'un téléphone réserve (encoche, barre d'accueil), en pixels. */
export type ZonesSures = { haut: number; droite: number; bas: number; gauche: number };

export const SANS_ZONES: ZonesSures = { haut: 0, droite: 0, bas: 0, gauche: 0 };

/* ── Les modes ────────────────────────────────────────────────────────── */

export const MODES = ["bureau", "etroit", "portrait", "paysage"] as const;
export type Mode = (typeof MODES)[number];

/**
 * Le seuil du bureau : 900 px, celui que `lib/disposition` mesurait pour le
 * tiroir, gardé plutôt que les 760 px de la maquette. À 900 px, la colonne
 * de 304 px laisse 596 px à l'image, les deux tiers de la fenêtre.
 */
export const BUREAU_DES = 900;

export const ROLES = ["joueur", "regarde", "seule"] as const;
/** Qui tient cette page : une place, un spectateur, ou une manette seule. */
export type Role = (typeof ROLES)[number];

/**
 * Le mode d'une fenêtre.
 *
 * - bureau : pointeur fin, 900 px de large ou plus ; l'image à gauche, la
 *   colonne à droite ;
 * - étroit : pointeur fin, moins de 900 px ; l'image en haut sur toute la
 *   largeur, la colonne dessous, qui défile en elle-même. Plus de tiroir ;
 * - portrait et paysage : au doigt, ou pour une manette seule, selon que la
 *   fenêtre est plus haute que large ou non.
 */
export function modeDuCadre(e: {
  largeur: number;
  hauteur: number;
  /** Le pointeur principal est grossier (un doigt). */
  grossier: boolean;
  role: Role;
}): Mode {
  if (e.grossier || e.role === "seule") return e.largeur > e.hauteur ? "paysage" : "portrait";
  return e.largeur >= BUREAU_DES ? "bureau" : "etroit";
}

/* ── Les états ────────────────────────────────────────────────────────── */

export const ETATS_DU_CADRE = [
  "vit",
  "figee",
  "coupee",
  "injoignable",
  "redemarre",
  "repos",
  "demarrage",
  "connexion",
  "fermee",
] as const;
export type EtatDuCadre = (typeof ETATS_DU_CADRE)[number];

/** Les états où l'écran est noir : pas d'image à poser, le plateau à la place. */
export const SANS_IMAGE: readonly EtatDuCadre[] = ["repos", "demarrage", "connexion", "fermee"];

export const sansImage = (etat: EtatDuCadre): boolean => SANS_IMAGE.includes(etat);

/** K06 : la scène « premiere-image » joue au passage d'un état sans image à
 * « vit », et seulement là. Le retour à « vit » après une image figée ne
 * joue rien : une image figée est une image. */
export const premiereImage = (avant: EtatDuCadre, apres: EtatDuCadre): boolean =>
  apres === "vit" && sansImage(avant);

/** Les états d'une panne : la fiche d'état parle, les scènes des autres se
 * taisent (`lib/scenes-salle`). */
export const EN_PANNE: readonly EtatDuCadre[] = [
  "figee",
  "coupee",
  "injoignable",
  "redemarre",
  "fermee",
];

export const enPanne = (etat: EtatDuCadre): boolean => EN_PANNE.includes(etat);

/** Les états qui prennent la place du panneau sur un écran court : il y a
 * quelque chose à réparer ou à lire, et ça passe avant les places. */
export const A_REPARER: readonly EtatDuCadre[] = ["figee", "coupee", "injoignable", "redemarre"];

/**
 * L'état du cadre, tiré de la liaison, du chargement et du jeu.
 *
 * Les textes restent dans `lib/liaison-mots` : le cadre ne dit rien, il
 * range. Un état de liaison inconnu ne compile pas (le `never` du bas).
 *
 * L'ordre compte : une panne de la liaison passe avant un chargement (une
 * salle injoignable ne charge rien), un chargement passe avant le repos (au
 * tout premier lancement, la salle est encore sans jeu pendant que le worker
 * redémarre : correction du 12 septembre 2026, gardée).
 */
export function etatDuCadre(e: {
  liaison: EtatDeLiaison;
  /** Un lancement vu par cette page est en cours (`booting`). */
  chargement: boolean;
  /** Un jeu tourne dans la salle (`room.game`). */
  jeu: boolean;
}): EtatDuCadre {
  const liaison = e.liaison;
  switch (liaison) {
    case "fermee":
      return "fermee";
    case "injoignable":
      return "injoignable";
    case "redemarre":
      return "redemarre";
    case "coupee":
      return "coupee";
    case "demarrage":
      return "demarrage";
    case "arrivee":
      return e.chargement ? "demarrage" : "connexion";
    case "figee":
    case "decodeur":
      // Le décodeur qui ne rend plus rien laisse la dernière image à
      // l'écran : pour le cadre, c'est une image arrêtée.
      return e.chargement ? "demarrage" : e.jeu ? "figee" : "repos";
    case "ok":
    case "cachee":
    case "irreguliere":
      return e.chargement ? "demarrage" : e.jeu ? "vit" : "repos";
    default: {
      const jamais: never = liaison;
      return jamais;
    }
  }
}

/* ── Les mesures ──────────────────────────────────────────────────────── */

/**
 * Le panneau de commande au bureau.
 *
 * - 64 px au moins : deux rangées de places de 44 px n'y tiennent pas, une
 *   rangée de quatre START avec leur étiquette, si (maquette du 22 novembre) ;
 * - 88 px au plus : au-delà, le panneau ne montre rien de plus ;
 * - sans image, 64 px sous 820 px de haut et 88 au-dessus : l'écran noir
 *   garde le reste.
 */
export const PANNEAU = { min: 64, max: 88, sansImageBas: 820 } as const;

/** Le fronton : la bande noire au-dessus de l'image, quand elle fait 40 px
 * ou plus. La pastille d'état et l'ancre de l'annonce s'y posent. */
export const FRONTON_MIN = 40;

/** L'ancre de l'annonce du socle (`retro/lettres`) : un seul élément
 * `[data-ancre="annonce"]` à la fois, sur la ligne du titre et jamais sur
 * l'image. Le fronton au bureau, sinon l'en-tête de la colonne ; la barre
 * au téléphone, sinon la bande. Un appelant l'écrit avec
 * `annoncerLettres(ancre, texte, …)`, et la ligne parlée reste celle de la
 * salle. */
export const ANCRE_ANNONCE = '[data-ancre="annonce"]';

/** Le décor de borne sur les bandes latérales : 72 px au moins, et seulement
 * quand elles ne portent pas la manette. */
export const BORNE_MIN = 72;

/** La barre du téléphone : la tête de la mascotte, « Salle N », Son, La salle. */
export const BARRE = 52;

/**
 * La largeur d'un panneau tenu en main qui porte les quatre places START en
 * rangée : quatre ronds de 44 px et trois écarts de 8 (200 px, la requête de
 * conteneur de `places.css`, chantier personnes), plus 12 px de chaque côté
 * du panneau (`telephone.css`). En dessous, un seul bouton les montre en
 * lampes, et ta place ne s'y lit plus : ton étiquette se pose ailleurs
 * (`Geometrie.etiquette`). Mesuré dans Chrome le 24 novembre 2026 à 667×375 :
 * 241 px de panneau donnent une rangée de 217 px (Xbox 360), 209 px donnent
 * les lampes (GameCube). `cadre.test.ts` relit les deux feuilles de style.
 */
export const PANNEAU_RANGEE = 224;

/** La rangée des quatre places tient-elle dans ce panneau ? */
const rangeeTient = (panneau: Rect | null): boolean =>
  panneau !== null && panneau.w >= PANNEAU_RANGEE;

/**
 * Où se lit ta place quand la rangée du panneau ne la porte pas
 * (en-jeu-tactile.5). Une chose, une fois : avec la rangée, ton étiquette
 * est sur ta place START, et nulle part ailleurs.
 *
 * - fente : tenu droit, dans le creux de la manette, sur sa vraie pose
 *   (`fente`, `lib/faces`) ;
 * - cote : en travers, sous « La salle », au-dessus de la grappe gauche ;
 * - bande : en travers, quand le panneau n'a que ses lampes, en tête de la
 *   bande, sous « La salle ». Le cadre donne son rectangle (`BANDE_BORD`),
 *   que le menu évite (`placeDuMenu`, décision du 24 novembre 2026).
 */
export type LieuEtiquette =
  | { lieu: "fente" }
  | { lieu: "cote"; rect: Rect }
  | { lieu: "bande"; rect: Rect };

/** Les bords intérieurs de la bande du téléphone, en px : ceux de `.n3-bande`
 * dans `components/telephone.css` (`padding: 8px 12px`), que `cadre.test.ts`
 * relit. Ton étiquette s'y pose en tête, sur la hauteur de la fente et au
 * plus sur sa largeur (`FENTE`, `.n3-etiquette-bande`). */
export const BANDE_BORD = { haut: 8, cote: 12 } as const;

/** Le rectangle de ton étiquette en tête de la bande. */
const enTeteDeBande = (b: Rect): Rect => ({
  x: b.x + BANDE_BORD.cote,
  y: b.y + BANDE_BORD.haut,
  w: Math.max(0, Math.min(b.w - 2 * BANDE_BORD.cote, FENTE.MAX)),
  h: FENTE.HAUT,
});

/**
 * La hauteur la plus petite de la feuille « La salle » à mi-hauteur, tenue
 * droite : ses cinq entrées sur deux colonnes de 44 px, son en-tête et la
 * barre d'accueil d'un iPhone (34 px). Mesuré dans Chrome le 23 novembre
 * 2026 (salle-telephone, bas du dernier enfant de la feuille) : 275 px de
 * contenu à 375 et à 390 px de large. C'était 300 px, pris à la maquette ; à
 * 375×667, la feuille montait alors de 13 px sur l'image.
 */
export const FEUILLE_MI_MIN = 276;

/** Au mode étroit, la colonne garde au moins cette hauteur sous l'image. */
export const COLONNE_ETROITE_MIN = 240;

/** Le format supposé quand l'image n'est pas encore connue (4:3). */
export const FORMAT_PAR_DEFAUT = 4 / 3;

/** Les mêmes proportions, pour un jeu dont la console n'annonce pas de
 * format (« ? », un disque muet) : la base de `baseDuPanneau`. */
export const PROPORTIONS_PAR_DEFAUT: Size = { width: 4, height: 3 };

/**
 * Ce que chaque manette tactile demande au cadre, lu dans sa pose
 * (`encombrement`) : la hauteur de sa boîte tenue droite pour une largeur, et
 * la largeur de chaque grappe en travers pour une hauteur. La manette Xbox 360
 * a la forme de la manette Pro (`faces.test.ts` le vérifie).
 */
export type DessinManette = Encombrement;

export const MANETTES: Readonly<Record<"dolphin" | "pro", DessinManette>> = {
  dolphin: encombrement(DOLPHIN_FACE),
  pro: encombrement(SWITCH_FACE),
};

/* ── La géométrie ─────────────────────────────────────────────────────── */

/**
 * Ce sur quoi la mise en page à la souris se décide : la place du panneau de
 * commande au bureau, la façon de la manette « toujours », la hauteur de
 * l'image en fenêtre étroite. `null` sans jeu : le panneau se pose alors
 * comme sous un écran noir. `baseDuPanneau` la tient.
 */
export type BaseDuPanneau = { image: Size; ajustement: Fit } | null;

export type Entree = {
  mode: Mode;
  /** La fenêtre entière, zones sûres comprises. */
  fenetre: Size;
  zonesSures: ZonesSures;
  /** La taille de l'image REÇUE, 0×0 tant qu'aucune n'est décodée. */
  image: Size;
  ajustement: Fit;
  /** Ce sur quoi la souris se décide (`baseDuPanneau`) : le format attendu
   * de la console, puis la vraie image après le premier changement de mise
   * en page qui la suit. L'image reçue (`image`) reste celle qui se pose. */
  base: BaseDuPanneau;
  etat: EtatDuCadre;
  role: Role;
  /** Le dessin de la manette tactile montrée, ou `null` sans elle. */
  manette: DessinManette | null;
  /** La largeur choisie de la colonne (`lib/column`). */
  largeurColonne: number;
  /** La colonne élargie par un panneau qui la remplace (réglage des
   * touches), ou `null`. */
  largeurPanneau: number | null;
  /** L'image agrandie par Ctrl : la colonne et le panneau s'effacent. */
  agrandie: boolean;
  /** Le panneau « Touches et manettes » est ouvert. Tenu en main, le cadre
   * lui donne sa place (`Geometrie.reglage`) ; au bureau et en fenêtre
   * étroite, il vit dans la colonne (`largeurPanneau`). */
  reglage: boolean;
};

export const FORMES_PANNEAU = ["sous", "colonne", "debout", "petit", "absent"] as const;
/**
 * - sous : sous l'écran, sur toute sa largeur ;
 * - colonne : au pied de la colonne, en deux rangées de places ;
 * - debout : dans la bande gauche d'un téléphone en travers ;
 * - petit : sous l'image d'un téléphone court, en une rangée compacte ;
 * - absent : nulle part (image agrandie, écran trop court).
 */
export type FormePanneau = (typeof FORMES_PANNEAU)[number];

export const LIEUX_PASTILLE = [
  "fronton",
  "bordure",
  "panneau",
  "bande",
  "barre",
  "colonne",
  "grappe-droite",
] as const;
export type LieuPastille = (typeof LIEUX_PASTILLE)[number];

/** Où la mascotte peut jouer dans la salle. Un seul à la fois. */
export const HOTES = ["plateau", "coin", "barre", "bord-panneau"] as const;
export type Hote = (typeof HOTES)[number];

export type Geometrie = {
  mode: Mode;
  etat: EtatDuCadre;
  role: Role;
  agrandie: boolean;
  /** L'écran noir : la boîte où l'image est posée, centrée. `null` pour une
   * manette seule, qui n'a pas d'image. */
  ecran: Rect | null;
  /** Le rectangle de l'image posée, `null` sans image. */
  image: Rect | null;
  /** La pose de `lib/fit`, `null` sans image. */
  pose: Placed | null;
  panneau: { forme: FormePanneau; rect: Rect | null };
  colonne: Rect | null;
  barre: Rect | null;
  bande: Rect | null;
  /** La manette tactile : sa boîte, et ses deux grappes en paysage ou à la
   * souris quand elle se tient sur les côtés. `null` sans manette. La pose
   * des touches dans la boîte est celle de `placePad`, avec pour bandes les
   * grappes. */
  manette: { rect: Rect; grappes: { g: Rect; d: Rect } | null } | null;
  /** À la souris (bureau et étroit), la place que la manette « toujours »
   * prend autour de l'image, dans la zone de `<main>` : les marges de la
   * boîte de l'écran. `null` sans manette, et toujours tenu en main, où
   * chaque pièce est posée en absolu. */
  margesManette: { gauche: number; droite: number; bas: number } | null;
  /** Le bouton « La salle » posé hors de la barre : en haut de la bande gauche
   * ou dans la bande du panneau, en paysage. */
  boutonSalle: Rect | null;
  /** « La salle » se pose parmi les touches (`placePad`, geste « feuille ») :
   * un téléphone tenu droit trop court pour sa barre, et la manette
   * « toujours » à la souris (il déplie la colonne repliée). */
  salleDansLaManette: boolean;
  /** Où se lit ta place hors de la rangée du panneau : `null` quand la
   * rangée la porte, ou sans place (spectateur, manette seule, sans manette
   * tactile, à la souris). */
  etiquette: LieuEtiquette | null;
  /** La bande noire au-dessus de l'image, quand elle fait 40 px ou plus. */
  fronton: Rect | null;
  /** Les bandes latérales du décor de borne, 72 px ou plus, sans manette. */
  bordures: { g: Rect; d: Rect } | null;
  /** La feuille « La salle » du téléphone, à mi-hauteur et agrandie. */
  feuille: { mi: Rect; agrandie: Rect } | null;
  /** Le panneau a cédé sa place à l'état (écran court, état à réparer). */
  cedeAuxEtats: boolean;
  /** Tenu en main, la place du panneau « Touches et manettes » ouvert : sous
   * l'image tenu droit, à sa droite en travers (`reglageTenu`). `null`
   * fermé, et au bureau, où il vit dans la colonne. */
  reglage: Rect | null;
};

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** Deux poses identiques : même taille, même lissage, même pas entier. */
export const memePose = (a: Placed, b: Placed): boolean =>
  a.width === b.width &&
  a.height === b.height &&
  a.smooth === b.smooth &&
  a.prescale === b.prescale;

const connue = (image: Size): boolean => image.width > 0 && image.height > 0;

const formatDe = (image: Size): number =>
  connue(image) ? image.width / image.height : FORMAT_PAR_DEFAUT;

/** La plus grande boîte au format qui tient : la « remplir » de la maquette. */
function remplir(w: number, h: number, format: number): { w: number; h: number } {
  const l = Math.max(0, Math.min(w, h * format));
  return { w: Math.floor(l), h: Math.floor(l / format) };
}

/** L'image posée et centrée dans l'écran, selon le réglage. */
function poser(e: Entree, ecran: Rect | null): { image: Rect | null; pose: Placed | null } {
  if (!ecran || sansImage(e.etat) || !connue(e.image)) return { image: null, pose: null };
  const pose = place(e.ajustement, e.image, { width: ecran.w, height: ecran.h });
  const w = Math.min(ecran.w, pose.width);
  const h = Math.min(ecran.h, pose.height);
  return {
    image: rect(ecran.x + (ecran.w - w) / 2, ecran.y + (ecran.h - h) / 2, w, h),
    pose,
  };
}

const vide = (e: Entree): Omit<Geometrie, "ecran" | "image" | "pose" | "panneau"> => ({
  mode: e.mode,
  etat: e.etat,
  role: e.role,
  agrandie: e.agrandie,
  colonne: null,
  barre: null,
  bande: null,
  manette: null,
  margesManette: null,
  boutonSalle: null,
  salleDansLaManette: false,
  etiquette: null,
  fronton: null,
  bordures: null,
  feuille: null,
  cedeAuxEtats: false,
  reglage: null,
});

/** Ce que la salle donne à `useGeometrie` : l'entrée du cadre, avec le
 * format attendu de la console au lieu de la base, que le crochet tient. */
export type EntreeDuCadre = Omit<Entree, "base"> & {
  /** Le format qu'annonce la console du jeu (`formatAttendu` de
   * `lib/consoles`, 4:3 faute de mieux), `null` sans jeu. */
  formatAttendu: Size | null;
};

const memeTaille = (a: Size | null, b: Size | null): boolean =>
  a === b || (a !== null && b !== null && a.width === b.width && a.height === b.height);

/** Un changement de mise en page « naturel » : une fenêtre redimensionnée
 * ou tournée (taille, zones sûres, mode), un panneau qui s'ouvre ou se
 * ferme, la colonne élargie, l'image agrandie, un autre réglage de la pose.
 * Ni l'image reçue, ni l'état, ni le rôle, ni la manette : le rôle et la
 * manette suivent la place, que la salle donne seule à l'entrée, souvent
 * après la première image (une place tenue rangeait alors le panneau du
 * bureau dans la colonne, sonde du 24 novembre 2026). */
function changementNaturel(a: EntreeDuCadre, b: EntreeDuCadre): boolean {
  return (
    a.mode !== b.mode ||
    a.fenetre.width !== b.fenetre.width ||
    a.fenetre.height !== b.fenetre.height ||
    a.zonesSures.haut !== b.zonesSures.haut ||
    a.zonesSures.droite !== b.zonesSures.droite ||
    a.zonesSures.bas !== b.zonesSures.bas ||
    a.zonesSures.gauche !== b.zonesSures.gauche ||
    a.ajustement !== b.ajustement ||
    a.largeurColonne !== b.largeurColonne ||
    a.largeurPanneau !== b.largeurPanneau ||
    a.agrandie !== b.agrandie ||
    a.reglage !== b.reglage
  );
}

/**
 * La base de la mise en page à la souris, d'un calcul au suivant
 * (décision du chef de chantier, 24 novembre 2026).
 *
 * Jusque-là, le panneau de commande se décidait sur l'image reçue : à
 * 1440×900, l'écran noir d'une arrivée le posait sous l'écran, puis la
 * première image 4:3 le rangeait dans la colonne et poussait tout ce qui
 * était dessous de 204 px (`colonne-stable` d'etats.mjs). Il se décide
 * maintenant sur le FORMAT ATTENDU de la console, connu avant la première
 * image (GameCube et Wii 4:3, Switch, Switch 2 et Xbox 360 16:9), posé en
 * « remplir » : sa vraie taille n'est pas connue avant elle.
 *
 * - au premier calcul, et chaque fois que le format attendu change (un
 *   autre jeu), la base est ce format ;
 * - la première image, et toute autre taille d'image ou tout autre état, ne
 *   changent rien : la place reste celle du format attendu, même si l'image
 *   réelle diffère ;
 * - au premier changement naturel (`changementNaturel`) qui trouve une
 *   image, la base devient cette image et son réglage.
 *
 * Pure : la salle lui passe ce qu'elle a retenu du calcul d'avant.
 */
export function baseDuPanneau(
  avant: { entree: EntreeDuCadre; base: BaseDuPanneau } | null,
  e: EntreeDuCadre,
): BaseDuPanneau {
  const attendue: BaseDuPanneau = e.formatAttendu
    ? { image: e.formatAttendu, ajustement: "remplir" }
    : null;
  if (avant === null || !memeTaille(avant.entree.formatAttendu, e.formatAttendu)) return attendue;
  if (changementNaturel(avant.entree, e) && connue(e.image) && !sansImage(e.etat)) {
    return { image: e.image, ajustement: e.ajustement };
  }
  return avant.base;
}

/** La décision du bureau : le panneau sous l'écran si l'image n'y perd rien. */
export function panneauAuBureau(e: {
  ecran: Size;
  image: Size;
  ajustement: Fit;
  sansImage: boolean;
}): { forme: "sous" | "colonne"; hauteur: number } {
  if (e.sansImage || !connue(e.image)) {
    return {
      forme: "sous",
      hauteur: e.ecran.height <= PANNEAU.sansImageBas ? PANNEAU.min : PANNEAU.max,
    };
  }
  const sans = place(e.ajustement, e.image, e.ecran);
  const libre = e.ecran.height - sans.height;
  if (libre < PANNEAU.min) return { forme: "colonne", hauteur: 0 };
  const hauteur = Math.min(PANNEAU.max, Math.floor(libre));
  const avec = place(e.ajustement, e.image, {
    width: e.ecran.width,
    height: e.ecran.height - hauteur,
  });
  return memePose(sans, avec) ? { forme: "sous", hauteur } : { forme: "colonne", hauteur: 0 };
}

/**
 * La manette à l'écran d'une fenêtre à la souris, réglée sur « toujours ».
 *
 * Jusqu'à la relecture du 23 novembre 2026, elle se posait par-dessus
 * l'écran, rangée dans les bandes noires quand il y en avait : à 1280×720,
 * onze pièces tombaient sur l'image vivante. La règle du propriétaire ne
 * connaît pas d'exception (« jamais rien sur une image vivante ») : le cadre
 * lui réserve sa place, comme au doigt. Deux façons sont essayées dans la
 * zone, et la plus grande image gagne, comme en travers :
 *
 * - « cotes » : une grappe dans une bande de chaque côté de l'image, aussi
 *   haute que la zone (la manette du paysage) ;
 * - « dessous » : la pose tenue droite sous l'image, sur toute la largeur.
 *
 * Une 4:3 à 1440×900 garde 808 px de large sur les côtés et 901 dessous ;
 * une 16:9, 808 et 1136. « La salle » reste parmi les touches : il déplie la
 * colonne repliée. `null` quand rien ne tient : la manette n'est alors pas
 * montée, plutôt que posée sur l'image.
 */
type ALaSouris = {
  variante: "cotes" | "dessous";
  ecran: Rect;
  manette: { rect: Rect; grappes: { g: Rect; d: Rect } | null };
  marges: { gauche: number; droite: number; bas: number };
};

function manetteALaSouris(
  D: DessinManette,
  zone: Rect,
  format: number,
  imposee?: ALaSouris["variante"],
): ALaSouris | null {
  const m = 4;
  const essais: ALaSouris[] = [];
  const gh = zone.h - 2 * m;
  const gl = gh >= 150 ? D.largeur(gh) : null;
  if (gl !== null && zone.w - 2 * (gl + 2 * m) > 0) {
    const cote = gl + 2 * m;
    essais.push({
      variante: "cotes",
      ecran: rect(zone.x + cote, zone.y, zone.w - 2 * cote, zone.h),
      manette: {
        rect: rect(zone.x + m, zone.y + m, zone.w - 2 * m, gh),
        grappes: {
          g: rect(zone.x + m, zone.y + m, gl, gh),
          d: rect(zone.x + zone.w - m - gl, zone.y + m, gl, gh),
        },
      },
      marges: { gauche: cote, droite: cote, bas: 0 },
    });
  }
  const besoin = D.hauteur(zone.w);
  if (besoin !== null && zone.h - besoin - 2 * m > 0) {
    essais.push({
      variante: "dessous",
      ecran: rect(zone.x, zone.y, zone.w, zone.h - besoin - 2 * m),
      manette: { rect: rect(zone.x, zone.y + zone.h - besoin - m, zone.w, besoin), grappes: null },
      marges: { gauche: 0, droite: 0, bas: besoin + 2 * m },
    });
  }
  let meilleur: ALaSouris | null = null;
  let aire = -1;
  for (const un of essais) {
    if (imposee && un.variante !== imposee) continue;
    const b = remplir(un.ecran.w, un.ecran.h, format);
    if (b.w * b.h > aire) {
      aire = b.w * b.h;
      meilleur = un;
    }
  }
  return meilleur;
}

/** Ce que la manette à la souris donne à la géométrie. */
const champsALaSouris = (
  pave: ALaSouris | null,
): Pick<Geometrie, "manette" | "margesManette" | "salleDansLaManette"> =>
  pave
    ? { manette: pave.manette, margesManette: pave.marges, salleDansLaManette: true }
    : { manette: null, margesManette: null, salleDansLaManette: false };

function bureau(e: Entree): Geometrie {
  const { width: W, height: H } = e.fenetre;
  const voulue = e.largeurPanneau ?? e.largeurColonne;
  const col = e.agrandie ? 0 : Math.max(0, Math.min(Math.floor(W / 2), Math.round(voulue)));
  const largeur = W - col;
  const colonne = e.agrandie ? null : rect(largeur, 0, col, H);
  // La base, pas l'image reçue : la première image ne déplace rien
  // (`baseDuPanneau`).
  const format = formatDe(e.base?.image ?? e.image);
  if (e.agrandie) {
    const zone = rect(0, 0, W, H);
    const pave = e.manette ? manetteALaSouris(e.manette, zone, format) : null;
    const ecran = pave?.ecran ?? zone;
    return {
      ...vide(e),
      ecran,
      ...poser(e, ecran),
      panneau: { forme: "absent", rect: null },
      colonne,
      ...champsALaSouris(pave),
    };
  }
  // La manette « toujours » se décide sur toute la hauteur, puis le panneau
  // sur la boîte qu'elle laisse à l'image ; elle se repose ensuite au-dessus
  // du panneau, dans la même façon.
  const avant = e.manette ? manetteALaSouris(e.manette, rect(0, 0, largeur, H), format) : null;
  const boite = avant?.ecran ?? rect(0, 0, largeur, H);
  const decision = panneauAuBureau({
    ecran: { width: boite.w, height: boite.h },
    image: e.base?.image ?? { width: 0, height: 0 },
    ajustement: e.base?.ajustement ?? e.ajustement,
    sansImage: e.base === null,
  });
  const p = decision.forme === "sous" ? decision.hauteur : 0;
  const zone = rect(0, 0, largeur, H - p);
  const pave =
    e.manette && avant ? manetteALaSouris(e.manette, zone, format, avant.variante) : null;
  const ecran = pave?.ecran ?? zone;
  return {
    ...vide(e),
    ecran,
    ...poser(e, ecran),
    panneau: {
      forme: decision.forme,
      rect: decision.forme === "sous" ? rect(0, H - p, largeur, p) : null,
    },
    colonne,
    ...champsALaSouris(pave),
  };
}

function etroit(e: Entree): Geometrie {
  const { width: W, height: H } = e.fenetre;
  // La hauteur de l'écran, et donc le haut de la colonne, sur la base
  // (`baseDuPanneau`) : une image 16:9 qui arrive ne remonte pas la colonne.
  const format = formatDe(e.base?.image ?? e.image);
  if (e.agrandie) {
    const zone = rect(0, 0, W, H);
    const pave = e.manette ? manetteALaSouris(e.manette, zone, format) : null;
    const ecran = pave?.ecran ?? zone;
    return {
      ...vide(e),
      ecran,
      ...poser(e, ecran),
      panneau: { forme: "absent", rect: null },
      ...champsALaSouris(pave),
    };
  }
  const plafond = Math.max(120, H - COLONNE_ETROITE_MIN);
  // La manette « toujours » prend sa place dans la hauteur de l'écran : la
  // zone garde l'image et la manette, la colonne le reste.
  const avant = e.manette ? manetteALaSouris(e.manette, rect(0, 0, W, plafond), format) : null;
  let haut = Math.max(0, Math.min(plafond, Math.round(W / format)));
  let pave: ALaSouris | null = null;
  if (e.manette && avant) {
    const b = remplir(avant.ecran.w, avant.ecran.h, format);
    haut = avant.variante === "dessous" ? Math.min(plafond, b.h + avant.marges.bas) : plafond;
    pave = manetteALaSouris(e.manette, rect(0, 0, W, haut), format, avant.variante) ?? avant;
    if (pave === avant) haut = plafond;
  }
  const ecran = pave?.ecran ?? rect(0, 0, W, haut);
  return {
    ...vide(e),
    ecran,
    ...poser(e, ecran),
    panneau: { forme: "colonne", rect: null },
    colonne: rect(0, haut, W, H - haut),
    ...champsALaSouris(pave),
  };
}

/**
 * Le portrait : barre, image, panneau, bande, manette, dans cet ordre, dans la
 * zone sûre.
 *
 * L'ordre des sacrifices quand l'écran est court : la bande (152, 104, 48,
 * puis 0 px), le panneau compact (72 puis 56 px), le panneau, la barre ;
 * l'image en dernier. Il ne dépend que de la taille de l'écran, jamais de
 * l'état : la manette ne bouge pas d'un pixel entre une image vivante et une
 * image figée.
 *
 * La manette prend toute la largeur (moins 16 px de chaque côté sur une
 * tablette, pour que les pouces restent aux bords) et la hauteur que sa pose
 * demande pour cette largeur (`encombrement`). Sans barre, « La salle » se
 * pose parmi ses touches, et cette hauteur l'a déjà compté.
 */
function portrait(e: Entree): Geometrie {
  const sa = e.zonesSures;
  const x0 = sa.gauche;
  const y0 = sa.haut;
  const W = Math.max(0, e.fenetre.width - sa.gauche - sa.droite);
  const H = Math.max(0, e.fenetre.height - sa.haut - sa.bas);
  const tablette = W >= 600;
  const largeurManette = tablette ? W - 32 : W;
  const besoin = e.manette ? e.manette.hauteur(largeurManette) : null;
  const format = formatDe(e.image);
  const ih = Math.round(W / format);
  const C0 = tablette ? 88 : 72;
  const C1 = 56;
  const sans = sansImage(e.etat);

  type G = { barre: number; image: number; chant: number; bande: number; m: number; iw: number };
  let g: G;
  let cede = false;
  if (e.role === "seule" && besoin !== null) {
    g = {
      barre: BARRE,
      image: 0,
      chant: Math.max(0, H - BARRE - besoin - 8),
      bande: 0,
      m: besoin,
      iw: 0,
    };
  } else if (besoin === null) {
    // Pas de manette tactile : spectateur, vraie manette, salle sans jeu.
    const voulu = sans ? Math.max(ih, Math.min(H - BARRE - C0 - 170, Math.round(W * 1.05))) : ih;
    const imgH = Math.max(0, Math.min(voulu, H - BARRE - C0));
    g = {
      barre: BARRE,
      image: imgH,
      chant: Math.min(C0, Math.max(0, H - BARRE - imgH)),
      bande: Math.max(0, H - BARRE - imgH - C0),
      m: 0,
      iw: imgH === ih || sans ? W : Math.min(W, Math.round(imgH * format)),
    };
  } else {
    const essais: [number, number, number][] = [
      [BARRE, C0, H >= 800 ? 152 : 104],
      [BARRE, C0, 104],
      [BARRE, C0, 48],
      [BARRE, C0, 0],
      [BARRE, C1, 0],
      [BARRE, 0, 0],
      [0, 0, 0],
    ];
    let trouve: G | null = null;
    for (const [b, c, bd] of essais) {
      if (H - b - ih - c - bd - 8 >= besoin) {
        trouve = { barre: b, image: ih, chant: c, bande: bd, m: besoin, iw: W };
        break;
      }
    }
    if (!trouve) {
      // Dernier recours : l'image rapetisse, la manette garde sa pose.
      const im = Math.max(120, H - besoin - 8);
      trouve = {
        barre: 0,
        image: im,
        chant: 0,
        bande: 0,
        m: besoin,
        iw: Math.min(W, Math.round(im * format)),
      };
    }
    g = trouve;
    // Un état à réparer prend la place du panneau quand la bande est trop
    // petite pour le dire (critique du 22 novembre : à 390×664, « Relancer
    // l'image » était à deux touchers alors que le panneau gardait 56 px).
    // Rien d'autre ne bouge.
    if (A_REPARER.includes(e.etat) && g.bande < 48 && g.chant + g.bande >= 48) {
      g = { ...g, bande: g.bande + g.chant, chant: 0 };
      cede = true;
    }
  }

  let y = y0;
  const barre = g.barre > 0 ? rect(x0, y, W, g.barre) : null;
  y += g.barre;
  const ecran = g.image > 0 ? rect(x0 + (W - g.iw) / 2, y, g.iw, g.image) : null;
  y += g.image;
  const panneauRect = g.chant > 0 ? rect(x0, y, W, g.chant) : null;
  y += g.chant;
  const bande = g.bande > 0 ? rect(x0, y, W, g.bande) : null;

  const manette: Geometrie["manette"] =
    g.m > 0
      ? {
          rect: rect(x0 + (W - largeurManette) / 2, y0 + H - g.m - 8, largeurManette, g.m),
          grappes: null,
        }
      : null;

  const feuilleHaut = g.barre + sa.haut;
  const sous = feuilleHaut + g.image + g.chant;
  const delta = Math.max(
    0,
    Math.min(sous - feuilleHaut, e.fenetre.height - feuilleHaut - FEUILLE_MI_MIN),
  );
  return {
    ...vide(e),
    ecran,
    ...poser(e, ecran),
    panneau: {
      forme: panneauRect === null ? "absent" : g.chant < 70 ? "petit" : "sous",
      rect: panneauRect,
    },
    barre,
    bande,
    manette,
    salleDansLaManette: manette !== null && barre === null,
    etiquette:
      e.role === "joueur" && manette !== null && !rangeeTient(panneauRect)
        ? { lieu: "fente" }
        : null,
    feuille: {
      mi: rect(0, feuilleHaut + delta, e.fenetre.width, e.fenetre.height - feuilleHaut - delta),
      agrandie: rect(0, feuilleHaut, e.fenetre.width, e.fenetre.height - feuilleHaut),
    },
    cedeAuxEtats: cede,
  };
}

/**
 * Le paysage : l'image au milieu, une grappe de chaque côté, dans la zone
 * sûre. Trois façons de ranger « La salle » et ton étiquette sont essayées à
 * plusieurs échelles, et la plus grande image gagne (à image égale, celle qui
 * montre le panneau). Sur une tablette, la manette du portrait sous l'image,
 * pouces aux bords, gagne quand elle donne une plus grande image (16:9).
 */
function paysage(e: Entree): Geometrie {
  const sa = e.zonesSures;
  const L = sa.gauche;
  const T = sa.haut;
  const W0 = e.fenetre.width;
  const H0 = e.fenetre.height;
  const W = Math.max(0, W0 - sa.gauche - sa.droite);
  const H = Math.max(0, H0 - sa.haut - sa.bas);
  const D = e.manette;
  const tablette = Math.min(W0, H0) >= 600;
  const m = 4;
  const C0 = tablette ? 88 : 56;
  const format = formatDe(e.image);
  // « La salle » (44 px) à 20 px au moins de la première épaule : 72 px
  // au-dessus de la grappe, ou 100 avec ton étiquette entre les deux.
  const PLUS = { nu: 0, "tete-etiquette": 100, tete: 72 } as const;
  type Variante = "seule" | "nu" | "tete-etiquette" | "tete" | "bas";
  type Choix = {
    /** La hauteur des grappes, et la largeur de chacune (`encombrement`). */
    gh: number;
    gl: number;
    cote: number;
    variante: Variante;
    iw: number;
    ih: number;
    score: number;
  };
  let best: Choix | null = null;
  /** Les grappes d'une hauteur `gh` : leur largeur, ou `null` si la pose ne
   * tient pas à cette hauteur. */
  const grappeDe = (gh: number) => (D && gh >= 150 ? D.largeur(gh) : null);

  // Les grappes descendent jusqu'au bas de la zone sûre : la pose garde déjà
  // 12 px de marge en dedans (`SIZES.MARGIN`). Avec une marge de plus, un
  // iPhone 12 mini en travers (375 px, barre d'accueil de 21) laissait 346 px
  // à la manette Pro, qui en demande 348 pour tenir dans sa bande de 140 px ;
  // sinon il lui en faut 308 (sonde du 23 novembre 2026).
  if (e.role === "seule" && D) {
    const gh = H - m;
    const gl = grappeDe(gh) ?? 0;
    best = { gh, gl, cote: gl + 2 * m, variante: "seule", iw: 0, ih: 0, score: 0 };
  } else if (!D) {
    const b = remplir(W, H, format);
    best = { gh: 0, gl: 0, cote: (W - b.w) / 2, variante: "nu", iw: b.w, ih: b.h, score: 0 };
  } else {
    for (const v of ["nu", "tete-etiquette", "tete"] as const) {
      const gh = H - m - PLUS[v];
      const gl = grappeDe(gh);
      if (gl === null) continue;
      const cote = gl + 2 * m;
      const b = remplir(W - 2 * cote, H - (v === "nu" ? C0 : 0), format);
      const score = b.w * b.h * (v === "nu" ? 1.01 : 1);
      if (!best || score > best.score)
        best = { gh, gl, cote, variante: v, iw: b.w, ih: b.h, score };
    }
    if (tablette) {
      const lm = W - 32;
      const besoin = D.hauteur(lm);
      if (besoin !== null) {
        const b = remplir(W, H - BARRE - besoin - 16, format);
        const score = b.w * b.h * 1.01;
        if (b.h > 200 && (!best || score > best.score)) {
          best = { gh: besoin, gl: 0, cote: 0, variante: "bas", iw: b.w, ih: b.h, score };
        }
      }
    }
    if (!best) {
      // Rien ne tient en hauteur (une fenêtre de moins de 160 px) : les
      // grappes au plancher, et la pose le dira (`data-degradee`).
      const gh = H - m;
      const gl = 160;
      const cote = gl + 2 * m;
      const b = remplir(W - 2 * cote, H, format);
      best = { gh, gl, cote, variante: "nu", iw: b.w, ih: b.h, score: 0 };
    }
  }

  const g = best;
  const C = W - 2 * g.cote;
  const xg = L + g.cote;
  const base = vide(e);
  let ecran: Rect | null = null;
  let barre: Rect | null = null;
  let bande: Rect | null = null;
  let panneau: Geometrie["panneau"] = { forme: "absent", rect: null };
  let boutonSalle: Rect | null = null;
  let manette: Geometrie["manette"] = null;

  const grappes = () => ({
    g: rect(L + m, T + H - g.gh, g.gl, g.gh),
    d: rect(W0 - sa.droite - m - g.gl, T + H - g.gh, g.gl, g.gh),
  });

  if (g.variante === "seule") {
    barre = rect(xg, T, C, BARRE);
    panneau = { forme: "sous", rect: rect(xg, T + 60, C, H - 60) };
  } else if (g.variante === "bas" && D) {
    // Barre, image, puis en bas la manette du portrait, pouces aux bords ; le
    // panneau et la bande entre l'image et elle.
    barre = rect(L, T, W, BARRE);
    ecran = rect(L + (W - g.iw) / 2, T + BARRE, g.iw, g.ih);
    const oy = T + H - g.gh - 8;
    manette = { rect: rect(L + 16, oy, W - 32, g.gh), grappes: null };
    const yb = T + BARRE + g.ih + 8;
    const haut = Math.max(0, Math.min(C0, oy - yb));
    panneau = haut >= 44 ? { forme: "sous", rect: rect(L, yb, W, haut) } : panneau;
    const reste = oy - yb - haut;
    bande = reste >= 48 ? rect(L, yb + haut, W, reste) : null;
  } else if (g.variante === "nu") {
    if (!D && !tablette) {
      // Téléphone sans manette tactile (spectateur, vraie manette) : l'image
      // au centre ; à gauche « La salle » puis le panneau debout ; à droite
      // ce que tu peux faire. Une bande de moins de 120 px garde tout dans
      // la feuille.
      ecran = rect(xg, T + (H - g.ih) / 2, g.iw, g.ih);
      const larg = g.cote;
      const assez = larg >= 120;
      boutonSalle = rect(L + 6, T + 6, Math.max(48, Math.min(larg - 12, 150)), 44);
      if (assez) {
        panneau = { forme: "debout", rect: rect(L + 6, T + 58, larg - 12, H - 58 - 6) };
        bande = rect(W0 - sa.droite - larg, T, larg, H);
      }
    } else {
      const libreV = H - g.ih;
      const avecBarre = tablette && libreV >= BARRE + C0 + 48;
      let y = T;
      if (avecBarre) {
        barre = rect(xg, T, C, BARRE);
        y = T + BARRE;
      }
      ecran = rect(xg + (C - g.iw) / 2, y, g.iw, g.ih);
      y += g.ih;
      const hautGrappe = T + H - g.gh;
      const enHaut = !avecBarre && hautGrappe - (T + m + 44) >= 20;
      const xt = avecBarre || enHaut ? xg : xg + 130;
      panneau = {
        forme: C0 < 70 ? "petit" : "sous",
        rect: rect(xt, y, C - (xt - xg), C0),
      };
      if (!avecBarre) {
        boutonSalle = enHaut
          ? rect(L + m + 2, T + m, Math.max(118, g.gl - 4), 44)
          : rect(xg + 4, y + (C0 - 44) / 2, 122, 44);
      }
      y += C0;
      bande = T + H - y >= 48 ? rect(xg, y, C, T + H - y) : null;
    }
  } else {
    // « tete » et « tete-etiquette » : l'image passe sous la barre
    // d'accueil (elle ne se touche pas), les touches restent dans la zone
    // sûre.
    const b = remplir(C, H0, format);
    ecran = rect(xg + (C - b.w) / 2, (H0 - b.h) / 2, b.w, b.h);
    const l = g.gl;
    boutonSalle = rect(L + m + 2, T + m, l - 4, 44);
  }

  if (g.gl > 0 && D && g.variante !== "bas") {
    const deux = grappes();
    manette = { rect: rect(L + m, deux.g.y, W - 2 * m, g.gh), grappes: deux };
  }

  // Ta place se lit une fois : sur la rangée du panneau, sinon sur ton
  // étiquette (relecture du 24 novembre 2026). « tete-etiquette » lui a
  // gardé 36 px sous « La salle ». « tete » n'a que les 28 px entre « La
  // salle » et la grappe, où la pose garde encore 12 px (`SIZES.MARGIN`) :
  // la hauteur de la fente y tient, à 6 px de l'un et de l'autre. Un
  // panneau qui n'a que ses lampes la laisse en tête de la bande, sous
  // « La salle » ; sans bande (moins de 48 px), juste sous lui. Sous
  // l'image d'une tablette (« bas »), la manette est celle du portrait :
  // sa fente. Reste sans étiquette une fenêtre couchée de moins de 370 px
  // de haut où ni la bande ni cette ligne ne tiennent : 2 179 cas sur
  // 424 080 d'un balayage de 480 à 1 400 px de large, deux manettes, trois
  // formats, avec et sans zones sûres (24 novembre 2026), aucun parmi les
  // tailles de téléphone de `cadre.test.ts`.
  let etiquette: LieuEtiquette | null = null;
  if (e.role === "joueur" && D && !rangeeTient(panneau.rect)) {
    if (g.variante === "bas") {
      etiquette = { lieu: "fente" };
    } else if (g.variante === "tete-etiquette") {
      etiquette = { lieu: "cote", rect: rect(L + m + 4, T + m + 52, g.gl - 8, 36) };
    } else if (g.variante === "tete") {
      const y = T + m + 44 + FENTE.ECART;
      etiquette = { lieu: "cote", rect: rect(L + m + 4, y, g.gl - 8, FENTE.HAUT) };
    } else if (bande) {
      etiquette = { lieu: "bande", rect: enTeteDeBande(bande) };
    } else if (panneau.rect) {
      const y = panneau.rect.y + panneau.rect.h + m;
      if (T + H - y >= FENTE.HAUT + m) {
        etiquette = { lieu: "cote", rect: rect(xg + 4, y, Math.min(C - 8, FENTE.MAX), FENTE.HAUT) };
      }
    }
  }

  // À mi-hauteur, la feuille ne prend que la bande gauche (la critique :
  // 42 % de l'image couverts) ; agrandie, 380 px.
  const bandeG = Math.floor(L + g.cote);
  return {
    ...base,
    ecran,
    ...poser(e, ecran),
    panneau,
    barre,
    bande,
    manette,
    boutonSalle,
    etiquette,
    feuille: {
      mi: rect(0, 0, Math.max(132, bandeG), H0),
      agrandie: rect(0, 0, Math.min(380, Math.round(W0 * 0.5)), H0),
    },
  };
}

/**
 * La place du panneau « Touches et manettes » tenu en main (décision du chef
 * de chantier, 24 novembre 2026 ; L6 du chantier manettes).
 *
 * Jusque-là, il vivait dans la feuille agrandie de la salle, qui couvrait
 * l'image : à 390×844, 113 880 px² de panneau sur elle (`place-tenu` de
 * reglage.mjs). Pendant un réglage, les autres jouent.
 *
 * - tenu droit : l'image ne bouge pas, et le panneau prend tout ce qui est
 *   sous elle (le panneau de commande, la bande et la place de la manette,
 *   qui n'est pas montée pendant un réglage). S'il y reste moins de
 *   `hauteurMin`, l'image rapetisse au-dessus de lui, jamais l'inverse ;
 * - en travers : le panneau prend une colonne à droite, `part` de la largeur
 *   entre `largeurMin` et `largeurMax`, et l'image se pose dans le reste,
 *   comme au bureau quand le panneau élargit la colonne (K24). « La salle »
 *   et la barre s'effacent : « Fermer » et Échap ferment le panneau.
 *
 * L'état, les places et la manette reviennent tels quels à la fermeture,
 * qui est un changement de mise en page ordinaire.
 */
export const REGLAGE_TENU = {
  /** Tenu droit : de quoi montrer l'en-tête, les onglets et la première
   * ligne du panneau sans défiler. */
  hauteurMin: 280,
  /** En travers : la colonne du panneau, en px et en part de la largeur. */
  largeurMin: 300,
  largeurMax: 520,
  part: 0.42,
} as const;

function reglageTenu(e: Entree, geo: Geometrie): Geometrie {
  if (e.mode !== "portrait" && e.mode !== "paysage") return geo;
  const sa = e.zonesSures;
  const L = sa.gauche;
  const T = sa.haut;
  const W = Math.max(0, e.fenetre.width - sa.gauche - sa.droite);
  const H = Math.max(0, e.fenetre.height - sa.haut - sa.bas);
  const libere: Geometrie = {
    ...geo,
    panneau: { forme: "absent", rect: null },
    bande: null,
    manette: null,
    salleDansLaManette: false,
    etiquette: null,
    cedeAuxEtats: false,
  };
  if (e.mode === "portrait" || geo.ecran === null) {
    let ecran = geo.ecran;
    if (ecran && T + H - (ecran.y + ecran.h) < REGLAGE_TENU.hauteurMin) {
      const h = Math.max(0, T + H - REGLAGE_TENU.hauteurMin - ecran.y);
      const w = Math.min(W, Math.floor(h * formatDe(e.image)));
      ecran = h > 0 && w > 0 ? rect(L + (W - w) / 2, ecran.y, w, h) : null;
    }
    const haut = ecran ? ecran.y + ecran.h : geo.barre ? geo.barre.y + geo.barre.h : T;
    return { ...libere, ecran, ...poser(e, ecran), reglage: rect(L, haut, W, T + H - haut) };
  }
  const P = Math.min(
    W,
    Math.max(
      REGLAGE_TENU.largeurMin,
      Math.min(REGLAGE_TENU.largeurMax, Math.round(W * REGLAGE_TENU.part)),
    ),
  );
  const ecran = W - P > 0 ? rect(L, T, W - P, H) : null;
  return {
    ...libere,
    barre: null,
    boutonSalle: null,
    ecran,
    ...poser(e, ecran),
    reglage: rect(L + W - P, T, P, H),
  };
}

/** Les bandes autour de l'image : le fronton au-dessus, la borne sur les côtés. */
function bandes(geo: Geometrie): Pick<Geometrie, "fronton" | "bordures"> {
  const { ecran, image } = geo;
  if (!ecran || !image) return { fronton: null, bordures: null };
  const dessus = image.y - ecran.y;
  const cote = image.x - ecran.x;
  const fronton = dessus >= FRONTON_MIN ? rect(ecran.x, ecran.y, ecran.w, dessus) : null;
  const bordures =
    cote >= BORNE_MIN && geo.manette === null
      ? {
          g: rect(ecran.x, ecran.y, cote, ecran.h),
          d: rect(image.x + image.w, ecran.y, ecran.x + ecran.w - (image.x + image.w), ecran.h),
        }
      : null;
  return { fronton, bordures };
}

/** La géométrie entière de la salle. */
export function miseEnPage(e: Entree): Geometrie {
  const brute =
    e.mode === "bureau"
      ? bureau(e)
      : e.mode === "etroit"
        ? etroit(e)
        : e.mode === "portrait"
          ? portrait(e)
          : paysage(e);
  const geo = e.reglage ? reglageTenu(e, brute) : brute;
  return { ...geo, ...bandes(geo) };
}

/* ── Les emplacements ─────────────────────────────────────────────────── */

/**
 * Où se pose la pastille d'état (etats), l'indication du clavier et la
 * pastille de l'image agrandie : jamais sur l'image.
 *
 * Une bande noire d'abord, s'il y en a une de 40 px : le fronton au-dessus
 * de l'image, sinon la bande de droite (une GameCube agrandie à 1440×900
 * n'a que des bandes latérales). Puis le panneau sous l'image ; puis, au
 * téléphone, la bande ou la barre ; en paysage, la tête de la grappe droite
 * (K12 : calculée ici, pas par le chantier manettes) ; au bureau, la tête de
 * la colonne. Image agrandie sans bande noire : rien, la ligne parlée le dit.
 */
export function emplacementPastille(
  geo: Geometrie,
): { lieu: LieuPastille; rect: Rect | null } | null {
  if (geo.fronton) return { lieu: "fronton", rect: geo.fronton };
  if (geo.ecran && geo.image) {
    const droite = geo.ecran.x + geo.ecran.w - (geo.image.x + geo.image.w);
    if (droite >= FRONTON_MIN && geo.manette === null) {
      return {
        lieu: "bordure",
        rect: rect(geo.image.x + geo.image.w, geo.ecran.y, droite, geo.ecran.h),
      };
    }
  }
  if (geo.agrandie) return null;
  const { panneau } = geo;
  if ((geo.mode === "bureau" || geo.mode === "etroit") && panneau.forme === "sous") {
    return { lieu: "panneau", rect: panneau.rect };
  }
  if (geo.mode === "bureau" || geo.mode === "etroit") return { lieu: "colonne", rect: null };
  if (geo.mode === "paysage" && geo.manette?.grappes) {
    const d = geo.manette.grappes.d;
    const haut = geo.barre ? geo.barre.y + geo.barre.h : 4;
    const libre = d.y - haut - 8;
    if (libre >= 44) return { lieu: "grappe-droite", rect: rect(d.x, haut + 4, d.w, 44) };
  }
  if (panneau.rect && (panneau.forme === "sous" || panneau.forme === "petit")) {
    return { lieu: "panneau", rect: panneau.rect };
  }
  if (geo.bande) return { lieu: "bande", rect: geo.bande };
  if (geo.barre) return { lieu: "barre", rect: geo.barre };
  return null;
}

/**
 * Où joue la mascotte, à un seul endroit à la fois.
 *
 * - le plateau : l'écran noir sans image (repos, démarrage, connexion,
 *   fermée), où elle se tient en grand sur le panneau ;
 * - le coin : au pied de la colonne, au bureau et au mode étroit ;
 * - le bord du panneau : une arrivée ou un départ, quand le panneau est sous
 *   l'image au bureau (les places sont là) ;
 * - la barre : la tête de la mascotte, au téléphone ; sans barre, la tête
 *   passe dans le bouton « La salle » de la manette.
 *
 * Image agrandie : nulle part. La première image coupe la scène du plateau
 * dans la même tâche (`Cadre`).
 */
export function ouEstLaMascotte(geo: Geometrie, scene?: string): Hote | null {
  if (geo.agrandie) return null;
  if (sansImage(geo.etat) && geo.ecran !== null && geo.role !== "seule") return "plateau";
  if (geo.mode === "bureau" || geo.mode === "etroit") {
    if ((scene === "arrivee" || scene === "depart") && geo.panneau.forme === "sous") {
      return "bord-panneau";
    }
    return "coin";
  }
  if (geo.barre || geo.boutonSalle || geo.salleDansLaManette) return "barre";
  return null;
}

/* ── Ce que la racine reçoit ──────────────────────────────────────────── */

/** Les attributs de la racine de la salle : les feuilles de chaque chantier
 * lisent ces attributs plutôt que de recalculer. */
export function attributsDuCadre(geo: Geometrie): Record<string, string> {
  return {
    "data-mode": geo.mode,
    "data-etat": geo.etat,
    "data-role": geo.role,
    "data-panneau": geo.panneau.forme,
    "data-sans-image": geo.image === null ? "oui" : "non",
    "data-agrandie": geo.agrandie ? "oui" : "non",
  };
}

const NOMS_RECTS = ["ecran", "image", "colonne", "barre", "bande", "fronton"] as const;

/**
 * Les variables CSS de géométrie, en pixels entiers : `--cadre-<nom>-gauche`,
 * `-haut`, `-largeur` et `-hauteur` pour l'écran, l'image, le panneau, la
 * colonne, la barre, la bande et le fronton. Un rectangle absent écrit ses
 * quatre valeurs à 0 px, pour qu'une variable lue n'hérite jamais d'un état
 * précédent.
 */
export function variablesDuCadre(geo: Geometrie): Record<string, string> {
  const sortie: Record<string, string> = {};
  const ecrire = (nom: string, r: Rect | null) => {
    sortie[`--cadre-${nom}-gauche`] = `${Math.round(r?.x ?? 0)}px`;
    sortie[`--cadre-${nom}-haut`] = `${Math.round(r?.y ?? 0)}px`;
    sortie[`--cadre-${nom}-largeur`] = `${Math.round(r?.w ?? 0)}px`;
    sortie[`--cadre-${nom}-hauteur`] = `${Math.round(r?.h ?? 0)}px`;
  };
  for (const nom of NOMS_RECTS) ecrire(nom, geo[nom]);
  ecrire("panneau", geo.panneau.rect);
  return sortie;
}

/* ── Les avis, dans la page telle qu'elle est montée ──────────────────── */

export const LIEUX_DES_AVIS = ["fronton", "pied", "colonne", "flux"] as const;
export type LieuDesAvis = (typeof LIEUX_DES_AVIS)[number];

/**
 * Où poser la pile des avis (manette branchée, fermeture proche, clavier en
 * pause, image légère, image agrandie) dans la page telle qu'elle est montée
 * aujourd'hui, tant que le panneau, la barre et la bande ne le sont pas
 * (étapes 3 et 4 du chantier salle).
 *
 * Jusqu'au 23 novembre 2026, la pile se posait EN HAUT DE L'IMAGE. Elle n'y
 * revient jamais :
 *
 * - la bande noire du haut (le fronton), si la pile y tient entière, puis
 *   celle du bas ; `hauteur` est la hauteur mesurée de la pile ;
 * - sinon la tête de la colonne, quand elle est à côté de l'image ; l'avis
 *   du clavier y naît du clic même qui quitte l'image, et la salle le retient
 *   le temps du clic (`useApresLeClic` de `components/Cadre`) : sans cela, la
 *   pile poussait le bouton pressé sous le pointeur (`clic-colonne` de
 *   focus.mjs, `place-suit-adresse` de parcours.mjs, 23 novembre 2026) ;
 * - sinon la pile entre dans le flux, au-dessus de l'écran : elle prend de la
 *   hauteur à l'image le temps de l'avis, mais ne la couvre pas. Ce dernier
 *   cas n'arrive qu'au doigt, en travers, quand la manette tient les bandes.
 *
 * Les coordonnées sont celles de la zone de l'image (`<main>`).
 */
export function lieuDesAvis(e: {
  zone: Size;
  /** L'image posée dans la zone, `null` sans image. */
  image: Rect | null;
  colonneACote: boolean;
  /** La pile mesurée, 0 avant la première mesure. */
  hauteur: number;
}): { lieu: LieuDesAvis; rect: Rect | null } {
  const besoin = Math.max(FRONTON_MIN, e.hauteur + 16);
  if (e.image === null) return { lieu: "fronton", rect: rect(0, 0, e.zone.width, besoin) };
  const dessus = e.image.y;
  if (dessus >= besoin) return { lieu: "fronton", rect: rect(0, 0, e.zone.width, dessus) };
  const bas = e.image.y + e.image.h;
  const dessous = e.zone.height - bas;
  if (dessous >= besoin) return { lieu: "pied", rect: rect(0, bas, e.zone.width, dessous) };
  if (e.colonneACote) return { lieu: "colonne", rect: null };
  return { lieu: "flux", rect: null };
}
