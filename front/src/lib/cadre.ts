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
 * # Ce qui reste à rapprocher
 *
 * Les dimensions des manettes tactiles (`MANETTES`) sont celles des dessins de
 * la maquette, à l'échelle 1. L'étape du téléphone (étape 4 du chantier salle)
 * les fera lire dans `lib/faces.ts`, qui pose les touches pour de vrai ; d'ici
 * là, la géométrie du portrait et du paysage est un squelette vérifié par
 * balayage, pas encore la pose des touches.
 */
import type { Etat as EtatDeLiaison } from "../media/liaison";
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

/** Le décor de borne sur les bandes latérales : 72 px au moins, et seulement
 * quand elles ne portent pas la manette. */
export const BORNE_MIN = 72;

/** La barre du téléphone : la tête de la mascotte, « Salle N », Son, La salle. */
export const BARRE = 52;

/** Au mode étroit, la colonne garde au moins cette hauteur sous l'image. */
export const COLONNE_ETROITE_MIN = 240;

/** Le format supposé quand l'image n'est pas encore connue (4:3). */
export const FORMAT_PAR_DEFAUT = 4 / 3;

/**
 * Les dessins des manettes tactiles, à l'échelle 1 (maquette du 22 novembre).
 *
 * - portrait : une boîte de 390 px de large, sous l'image ; `fente` est le
 *   creux où se range « La salle » quand la barre manque, `fenteEtiquette`
 *   celui de ton étiquette quand le panneau manque ; `pouce` la largeur d'un
 *   groupe de pouce, pour la tablette qui les écarte aux bords ;
 * - paysage : deux grappes de 128 px de large, à gauche et à droite.
 *
 * Une touche y fait 48 px au moins : à l'échelle la plus petite admise
 * (0,92), elle garde 44 px.
 */
export type DessinManette = {
  portrait: { l: number; h: number; fente: Rect; fenteEtiquette: Rect; pouce: number };
  paysage: { l: number; g: number; d: number };
};

export const MANETTES: Readonly<Record<"dolphin" | "pro", DessinManette>> = {
  dolphin: {
    portrait: {
      l: 390,
      h: 272,
      fente: { x: 122, y: 210, w: 76, h: 56 },
      fenteEtiquette: { x: 122, y: 166, w: 76, h: 36 },
      pouce: 150,
    },
    paysage: { l: 128, g: 312, d: 308 },
  },
  pro: {
    portrait: {
      l: 390,
      h: 300,
      fente: { x: 130, y: 136, w: 96, h: 48 },
      fenteEtiquette: { x: 130, y: 92, w: 96, h: 36 },
      pouce: 150,
    },
    paysage: { l: 128, g: 320, d: 332 },
  },
};

/** L'échelle la plus petite d'une manette : ses touches de 48 px y font 44. */
export const ECHELLE_MIN = 0.92;

/* ── La géométrie ─────────────────────────────────────────────────────── */

export type Entree = {
  mode: Mode;
  /** La fenêtre entière, zones sûres comprises. */
  fenetre: Size;
  zonesSures: ZonesSures;
  /** La taille de l'image REÇUE, 0×0 tant qu'aucune n'est décodée. */
  image: Size;
  ajustement: Fit;
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
  /** La manette tactile : sa boîte et son échelle, et ses deux grappes en
   * paysage. `null` sans manette. */
  manette: { rect: Rect; echelle: number; grappes: { g: Rect; d: Rect } | null } | null;
  /** Le bouton « La salle » posé hors de la barre (dans la fente de la
   * manette, ou en haut de la bande gauche en paysage). */
  boutonSalle: Rect | null;
  /** Ton étiquette tapée, collée dans la manette quand le panneau manque. */
  etiquetteManette: Rect | null;
  /** La bande noire au-dessus de l'image, quand elle fait 40 px ou plus. */
  fronton: Rect | null;
  /** Les bandes latérales du décor de borne, 72 px ou plus, sans manette. */
  bordures: { g: Rect; d: Rect } | null;
  /** La feuille « La salle » du téléphone, à mi-hauteur et agrandie. */
  feuille: { mi: Rect; agrandie: Rect } | null;
  /** Le panneau a cédé sa place à l'état (écran court, état à réparer). */
  cedeAuxEtats: boolean;
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
  boutonSalle: null,
  etiquetteManette: null,
  fronton: null,
  bordures: null,
  feuille: null,
  cedeAuxEtats: false,
});

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

function bureau(e: Entree): Geometrie {
  const { width: W, height: H } = e.fenetre;
  const voulue = e.largeurPanneau ?? e.largeurColonne;
  const col = e.agrandie ? 0 : Math.max(0, Math.min(Math.floor(W / 2), Math.round(voulue)));
  const largeur = W - col;
  const colonne = e.agrandie ? null : rect(largeur, 0, col, H);
  if (e.agrandie) {
    const ecran = rect(0, 0, W, H);
    return {
      ...vide(e),
      ecran,
      ...poser(e, ecran),
      panneau: { forme: "absent", rect: null },
      colonne,
    };
  }
  const decision = panneauAuBureau({
    ecran: { width: largeur, height: H },
    image: e.image,
    ajustement: e.ajustement,
    sansImage: sansImage(e.etat),
  });
  const p = decision.forme === "sous" ? decision.hauteur : 0;
  const ecran = rect(0, 0, largeur, H - p);
  return {
    ...vide(e),
    ecran,
    ...poser(e, ecran),
    panneau: {
      forme: decision.forme,
      rect: decision.forme === "sous" ? rect(0, H - p, largeur, p) : null,
    },
    colonne,
  };
}

function etroit(e: Entree): Geometrie {
  const { width: W, height: H } = e.fenetre;
  if (e.agrandie) {
    const ecran = rect(0, 0, W, H);
    return { ...vide(e), ecran, ...poser(e, ecran), panneau: { forme: "absent", rect: null } };
  }
  const haut = Math.max(
    0,
    Math.min(Math.max(120, H - COLONNE_ETROITE_MIN), Math.round(W / formatDe(e.image))),
  );
  const ecran = rect(0, 0, W, haut);
  return {
    ...vide(e),
    ecran,
    ...poser(e, ecran),
    panneau: { forme: "colonne", rect: null },
    colonne: rect(0, haut, W, H - haut),
  };
}

/** Une case du dessin portrait, posée à l'échelle `s` depuis (ox, oy). */
const caseDe = (f: Rect, ox: number, oy: number, s: number): Rect =>
  rect(ox + f.x * s, oy + f.y * s, f.w * s, f.h * s);

/**
 * Le portrait : barre, image, panneau, bande, manette, dans cet ordre, dans la
 * zone sûre.
 *
 * L'ordre des sacrifices quand l'écran est court : la bande (152, 104, 48,
 * puis 0 px), le panneau compact (72 puis 56 px), le panneau, la barre ;
 * l'image en dernier. Il ne dépend que de la taille de l'écran, jamais de
 * l'état : la manette ne bouge pas d'un pixel entre une image vivante et une
 * image figée.
 */
function portrait(e: Entree): Geometrie {
  const sa = e.zonesSures;
  const x0 = sa.gauche;
  const y0 = sa.haut;
  const W = Math.max(0, e.fenetre.width - sa.gauche - sa.droite);
  const H = Math.max(0, e.fenetre.height - sa.haut - sa.bas);
  const P = e.manette?.portrait ?? null;
  const tablette = W >= 600;
  const format = formatDe(e.image);
  const ih = Math.round(W / format);
  const sMax = tablette ? 1.4 : 1.1;
  const C0 = tablette ? 88 : 72;
  const C1 = 56;
  const sans = sansImage(e.etat);

  type G = { barre: number; image: number; chant: number; bande: number; s: number; iw: number };
  let g: G;
  let cede = false;
  if (e.role === "seule" && P) {
    const s = Math.min(W / P.l, (H - BARRE - 180 - 8) / P.h, sMax);
    g = { barre: BARRE, image: 0, chant: Math.max(0, H - BARRE - P.h * s - 8), bande: 0, s, iw: 0 };
  } else if (!P) {
    // Pas de manette tactile : spectateur, vraie manette, salle sans jeu.
    const voulu = sans ? Math.max(ih, Math.min(H - BARRE - C0 - 170, Math.round(W * 1.05))) : ih;
    const imgH = Math.max(0, Math.min(voulu, H - BARRE - C0));
    g = {
      barre: BARRE,
      image: imgH,
      chant: Math.min(C0, Math.max(0, H - BARRE - imgH)),
      bande: Math.max(0, H - BARRE - imgH - C0),
      s: 0,
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
      const reste = H - b - ih - c - bd;
      const s = Math.min(W / P.l, (reste - 8) / P.h, sMax);
      if (s >= ECHELLE_MIN) {
        trouve = { barre: b, image: ih, chant: c, bande: bd, s, iw: W };
        break;
      }
    }
    if (!trouve) {
      // Dernier recours : l'image rapetisse, les touches gardent 44 px.
      const s = Math.min(ECHELLE_MIN, W / P.l);
      const im = Math.max(120, H - P.h * s - 8);
      trouve = {
        barre: 0,
        image: im,
        chant: 0,
        bande: 0,
        s,
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

  let manette: Geometrie["manette"] = null;
  let boutonSalle: Rect | null = null;
  let etiquetteManette: Rect | null = null;
  if (g.s > 0 && P) {
    const s = g.s;
    const oy = y0 + H - P.h * s - 8;
    const ox = x0 + (W - P.l * s) / 2;
    manette = {
      rect: tablette ? rect(x0 + 16, oy, W - 32, P.h * s) : rect(ox, oy, P.l * s, P.h * s),
      echelle: s,
      grappes: null,
    };
    if (g.barre === 0 && e.role !== "seule") boutonSalle = caseDe(P.fente, ox, oy, s);
    if (g.chant === 0 && e.role === "joueur") {
      etiquetteManette = caseDe(g.barre ? P.fente : P.fenteEtiquette, ox, oy, s);
    }
  }

  const feuilleHaut = g.barre + sa.haut;
  const sous = feuilleHaut + g.image + g.chant;
  const delta = Math.max(0, Math.min(sous - feuilleHaut, e.fenetre.height - feuilleHaut - 300));
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
    boutonSalle,
    etiquetteManette,
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
    s: number;
    cote: number;
    variante: Variante;
    iw: number;
    ih: number;
    score: number;
  };
  let best: Choix | null = null;

  if (e.role === "seule" && D) {
    const s = Math.min(tablette ? 1.4 : 1.15, (H - 2 * m) / Math.max(D.paysage.g, D.paysage.d));
    best = { s, cote: D.paysage.l * s + 2 * m, variante: "seule", iw: 0, ih: 0, score: 0 };
  } else if (!D) {
    const b = remplir(W, H, format);
    best = { s: 0, cote: (W - b.w) / 2, variante: "nu", iw: b.w, ih: b.h, score: 0 };
  } else {
    for (const v of ["nu", "tete-etiquette", "tete"] as const) {
      for (const s of [0.92, 0.96, 1, 1.1, 1.2, 1.3]) {
        if (s > (tablette ? 1.3 : 1)) continue;
        if (Math.max(D.paysage.g + PLUS[v], D.paysage.d) * s > H - 2 * m) continue;
        const cote = D.paysage.l * s + 2 * m;
        const b = remplir(W - 2 * cote, H - (v === "nu" ? C0 : 0), format);
        const score = b.w * b.h * (v === "nu" ? 1.01 : 1) + s;
        if (!best || score > best.score) best = { s, cote, variante: v, iw: b.w, ih: b.h, score };
      }
    }
    if (tablette) {
      for (const s of [0.92, 1, 1.1, 1.2]) {
        const bas = D.portrait.h * s + 16;
        const b = remplir(W, H - BARRE - bas, format);
        const score = b.w * b.h * 1.01 + s;
        if (b.h > 200 && (!best || score > best.score)) {
          best = { s, cote: 0, variante: "bas", iw: b.w, ih: b.h, score };
        }
      }
    }
    if (!best) {
      const s = ECHELLE_MIN;
      const cote = D.paysage.l * s + 2 * m;
      const b = remplir(W - 2 * cote, H, format);
      best = { s, cote, variante: "tete", iw: b.w, ih: b.h, score: 0 };
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
  let etiquetteManette: Rect | null = null;
  let manette: Geometrie["manette"] = null;

  const grappes = (s: number) => {
    if (!D) return null;
    const l = D.paysage.l * s;
    return {
      g: rect(L + m, T + H - m - D.paysage.g * s, l, D.paysage.g * s),
      d: rect(W0 - sa.droite - m - l, T + H - m - D.paysage.d * s, l, D.paysage.d * s),
    };
  };

  if (g.variante === "seule") {
    barre = rect(xg, T, C, BARRE);
    panneau = { forme: "sous", rect: rect(xg, T + 60, C, H - 60) };
  } else if (g.variante === "bas" && D) {
    // Barre, image, puis en bas : pouce gauche, panneau et bande, pouce droit.
    barre = rect(L, T, W, BARRE);
    ecran = rect(L + (W - g.iw) / 2, T + BARRE, g.iw, g.ih);
    const s = g.s;
    const oy = T + H - D.portrait.h * s - 8;
    manette = { rect: rect(L + 16, oy, W - 32, D.portrait.h * s), echelle: s, grappes: null };
    const finG = L + 16 + D.portrait.pouce * s + 16;
    const debD = L + W - 16 - D.portrait.pouce * s - 16;
    const yb = T + BARRE + g.ih + 8;
    panneau = { forme: "sous", rect: rect(finG, yb, debD - finG, C0) };
    const reste = T + H - yb - C0;
    bande = reste >= 48 ? rect(finG, yb + C0, debD - finG, reste) : null;
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
      const premiere = D ? D.paysage.g : 0;
      const hautGrappe = T + H - m - premiere * g.s;
      const enHaut = !avecBarre && hautGrappe - (T + m + 44) >= 20;
      const xt = avecBarre || enHaut ? xg : xg + 130;
      panneau = {
        forme: C0 < 70 ? "petit" : "sous",
        rect: rect(xt, y, C - (xt - xg), C0),
      };
      if (!avecBarre) {
        boutonSalle = enHaut
          ? rect(L + m + 2, T + m, Math.max(118, (D?.paysage.l ?? 128) * g.s - 4), 44)
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
    const l = (D?.paysage.l ?? 128) * g.s;
    boutonSalle = rect(L + m + 2, T + m, l - 4, 44);
    if (g.variante === "tete-etiquette" && e.role === "joueur") {
      etiquetteManette = rect(L + m + 4, T + m + 52, l - 8, 36);
    }
  }

  if (g.s > 0 && D && g.variante !== "bas") {
    const deux = grappes(g.s);
    if (deux) {
      const haut = Math.min(deux.g.y, deux.d.y);
      manette = {
        rect: rect(L + m, haut, W - 2 * m, T + H - m - haut),
        echelle: g.s,
        grappes: deux,
      };
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
    etiquetteManette,
    feuille: {
      mi: rect(0, 0, Math.max(132, bandeG), H0),
      agrandie: rect(0, 0, Math.min(380, Math.round(W0 * 0.5)), H0),
    },
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
  const geo =
    e.mode === "bureau"
      ? bureau(e)
      : e.mode === "etroit"
        ? etroit(e)
        : e.mode === "portrait"
          ? portrait(e)
          : paysage(e);
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
  if (geo.barre || geo.boutonSalle) return "barre";
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
