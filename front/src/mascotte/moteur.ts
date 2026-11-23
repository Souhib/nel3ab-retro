/**
 * Le moteur d'Aïn : le décor lu dans la page, le plan d'une scène, et le
 * planificateur qui refuse tout trajet qui toucherait l'image du jeu.
 *
 * # Le décor
 *
 * Une scène ne connaît aucune coordonnée écrite : elle lit des ANCRES
 * (`[data-ancre="logo"]`, `start-3`, `prise`…), des SOLS (le bord haut des
 * `[data-sol]`) et des ZONES INTERDITES, à l'instant où elle part, en pixels
 * de la fenêtre (`getBoundingClientRect`) :
 *
 * - l'image du jeu (`#screen` dans `[data-zone-jeu]`), plus 4 px, dès
 *   qu'une image du jeu en cours a été peinte (`data-sans-image="non"` sur
 *   la racine du cadre) ;
 * - les lignes d'état et les contrôles (`[data-interdit]`, et tout bouton,
 *   lien ou champ visible de la salle qui n'est ni une ancre ni un sol) ;
 * - les mots de l'événement (`[data-texte]`) : « PRÊT », la pastille, les
 *   noms.
 *
 * # Le planificateur
 *
 * Chaque piste est échantillonnée toutes les 12 ms ; à chaque point, la
 * boîte serrée de chaque image possible d'Aïn, de sa bulle et des objets
 * est comparée aux zones. Un arc qui touche est abaissé (60 %, 30 %, à
 * plat) ; une piste qui touche encore fait refuser le plan, et la scène
 * joue sa version suivante : courte, puis pose animée dans le logo, puis
 * pose clé. Ce module ne peint rien et ne lance aucune boucle.
 */
import {
  ACCESSOIRES,
  B_EC,
  B_ET,
  B_N,
  boiteSerree,
  dessinerAin,
  dessinerTete,
  FENTE_X,
  grilleBulle,
  PIED_X,
  PIED_Y,
  TETE_X,
  TETE_Y,
  type Bulle,
  type Forme,
  type Grille,
  type Joueur,
  type Maison,
  type Pose,
} from "./dessin";

/** Une boîte : [gauche, haut, droite, bas), en pixels de la fenêtre. */
export type Boite = [number, number, number, number];
export type Point = [number, number];
export type Ancre = {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  droite: number;
  bas: number;
};
export type NomZone = "image" | "ligne" | "controle" | "texte";
/** Une zone interdite ; `qui` nomme l'élément, pour dire un refus. */
export type Zone = { nom: NomZone; b: Boite; qui?: string };
export type Sol = { nom: string; x0: number; x1: number; y: number };

/** Ce qu'une scène sait de la page. */
export type Decor = {
  /** Pixels de la fenêtre par pixel d'Aïn. */
  c: number;
  /** La tête seule, dans la barre du téléphone. */
  tete: boolean;
  /** Où sont les pieds d'Aïn quand il est chez lui. */
  maison: Point;
  /** Le coin haut gauche du logo, d'où se mesure tout ce qui y touche. */
  logo: Point;
  ancre(nom: string): Ancre | null;
  zones(): Zone[];
  sols(): Sol[];
  passages(): Point[];
  /** Le rectangle de l'image vivante, `null` sans image. */
  image(): Ancre | null;
  /** La largeur de la fenêtre : un bond hors de la page y finit. */
  largeur: number;
};

/** La marge autour de l'image : 4 px, plus 0,6 px pour l'arrondi des
 * sprites au pixel de l'écran. Les autres zones prennent la moitié. */
export const MARGE_PX = 4;
const MARGE = MARGE_PX + 0.6;

const enAncre = (r: { left: number; top: number; width: number; height: number }): Ancre => ({
  x: r.left,
  y: r.top,
  w: r.width,
  h: r.height,
  cx: r.left + r.width / 2,
  cy: r.top + r.height / 2,
  droite: r.left + r.width,
  bas: r.top + r.height,
});
/** Le rectangle d'un élément visible, ou `null` : caché, sans boîte. */
function rectVisible(el: Element): Ancre | null {
  if (el.closest("[hidden]")) return null;
  // Le contenu d'un <details> fermé garde sa boîte dans Chrome (il est
  // caché par content-visibility) : il ne se voit pas, il ne gêne pas.
  // Sans cette garde, le micro replié sous « Autres réglages » interdisait
  // toute scène au logo du coin (cadre-navigateur, 23 novembre 2026).
  if (el.closest("details:not([open])") && !el.closest("summary")) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  if (getComputedStyle(el).visibility === "hidden") return null;
  return enAncre(r);
}
const elargir = (a: Ancre, m: number): Boite => [a.x - m, a.y - m, a.droite + m, a.bas + m];

/** Les contrôles d'une salle : tout ce qu'on peut viser, sauf les ancres
 * et les sols, où Aïn se pose (un START, la prise de la pastille). */
const CONTROLES =
  'button, a[href], input, select, textarea, summary, [role="button"], [data-interdit]';

/** L'image du jeu, s'il y en a une de peinte dans cette racine. */
export function imageDe(racine: ParentNode): Ancre | null {
  const cadre =
    (racine instanceof Element ? racine.closest("[data-cadre]") : null) ??
    racine.querySelector("[data-cadre]");
  if (cadre?.getAttribute("data-sans-image") === "oui") return null;
  const zone = racine.querySelector("[data-zone-jeu]");
  if (!zone) return null;
  const toile = zone.querySelector("canvas");
  return rectVisible(toile ?? zone);
}

/**
 * Le décor d'une page, lu dans le DOM sous `racine`. `logo` est l'élément
 * qui porte Aïn quand il est chez lui (le logo, ou la tête dans la barre,
 * ou le plateau de l'écran noir) ; sa taille donne l'échelle.
 */
export function lireDecor(
  racine: ParentNode,
  logo: Element,
  o: { tete?: boolean; plateau?: boolean; c?: number } = {},
): Decor {
  const l = rectVisible(logo) ?? enAncre({ left: 0, top: 0, width: 0, height: 0 });
  const tete = !!o.tete;
  const c = o.c ?? ((tete ? l.h / 20 : l.w / 114) || 1);
  const maison: Point = o.plateau
    ? [l.cx, l.bas]
    : tete
      ? [l.x + TETE_X * c, l.y + TETE_Y * c]
      : [l.x + (FENTE_X + 11) * c, l.y + 25 * c];
  const tous = (sel: string) => [...racine.querySelectorAll(sel)];
  return {
    c,
    tete,
    maison,
    logo: [l.x, l.y],
    largeur: globalThis.innerWidth ?? 1024,
    ancre(nom) {
      const el = racine.querySelector(`[data-ancre="${nom}"]`);
      return el ? rectVisible(el) : null;
    },
    image: () => imageDe(racine),
    zones() {
      const res: Zone[] = [];
      const img = imageDe(racine);
      if (img) res.push({ nom: "image", b: elargir(img, MARGE) });
      for (const el of tous(CONTROLES)) {
        if (el.closest("[data-zone-jeu], [data-ancre], [data-sol], [data-hote]")) continue;
        const r = rectVisible(el);
        const nom = el.getAttribute("data-interdit") === "ligne" ? "ligne" : "controle";
        if (r)
          res.push({
            nom,
            b: elargir(r, MARGE / 2),
            qui: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
          });
      }
      for (const el of tous("[data-texte]")) {
        const r = rectVisible(el);
        if (r) res.push({ nom: "texte", b: elargir(r, MARGE / 2) });
      }
      return res;
    },
    sols() {
      return tous("[data-sol]").flatMap((el) => {
        const r = rectVisible(el);
        return r ? [{ nom: el.getAttribute("data-sol") ?? "", x0: r.x, x1: r.droite, y: r.y }] : [];
      });
    },
    passages() {
      return tous('[data-ancre^="passage"]').flatMap((el) => {
        const r = rectVisible(el);
        return r ? [[r.cx, r.y] as Point] : [];
      });
    },
  };
}

export const touche = (a: Boite, b: Boite) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const borne = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ── Les grilles, une fois chacune ────────────────────────────────────── */

const GRILLES = new Map<string, { g: Grille; serre: Boite }>();
function enCache(cle: string, faire: () => Grille) {
  let e = GRILLES.get(cle);
  if (!e) {
    const g = faire();
    e = { g, serre: (boiteSerree(g) ?? [0, 0, 0, 0]) as Boite };
    GRILLES.set(cle, e);
    if (GRILLES.size > 600) GRILLES.delete(GRILLES.keys().next().value as string);
  }
  return { ...e, cle };
}
/** La grille d'Aïn (ou de sa tête) dans une pose, et sa clé de cache. */
export const grilleDe = (pose: Pose, joueur: Joueur, tete: boolean) =>
  enCache(`${tete ? "T" : "A"}${joueur}${JSON.stringify(pose)}`, () =>
    tete ? dessinerTete(pose, joueur) : dessinerAin(pose, joueur),
  );
export const bulleDe = (fx: readonly Bulle[], joueur: Joueur) =>
  enCache(`B${joueur}${JSON.stringify(fx[0])}`, () => grilleBulle(fx[0], joueur));
export const accessoire = (nom: string) => {
  const g = ACCESSOIRES[nom];
  if (!g) throw new Error(`accessoire inconnu: ${nom}`);
  return enCache(`O${nom}`, () => g);
};

/** Le coin haut gauche d'Aïn quand ses pieds sont en `pied`. */
export const coinAin = (d: Decor, pied: Point): Point =>
  d.tete
    ? [pied[0] - TETE_X * d.c, pied[1] - TETE_Y * d.c]
    : [pied[0] - PIED_X * d.c, pied[1] - PIED_Y * d.c];
const serreA = (serre: Boite, coin: Point, c: number): Boite => [
  coin[0] + serre[0] * c,
  coin[1] + serre[1] * c,
  coin[0] + serre[2] * c,
  coin[1] + serre[3] * c,
];
export function boiteAin(d: Decor, pose: Pose, joueur: Joueur, pied: Point) {
  const e = grilleDe(pose, joueur, d.tete);
  return { ...e, b: serreA(e.serre, coinAin(d, pied), d.c) };
}
/** Où se pose la bulle : au-dessus de la tête au bureau, à droite dans la
 * barre. Rend le coin haut gauche. */
export function placeBulle(d: Decor, serreAin: Boite, pied: Point, bulle: Grille): Point {
  const c = d.c;
  const [x0, y0] = coinAin(d, pied);
  const bw = bulle[0].length * c;
  const bh = bulle.length * c;
  if (d.tete)
    return [x0 + serreAin[2] * c + c, y0 + ((serreAin[1] + serreAin[3]) / 2) * c - bh / 2];
  return [x0 + ((serreAin[0] + serreAin[2]) / 2) * c - bw / 2 - c, y0 + serreAin[1] * c - bh - c];
}
/** La bulle quand Aïn est chez lui : au-dessus du logo, ou à droite de la
 * tête dans la barre. */
export function placeBulleMaison(d: Decor, bulle: Grille): Point {
  const c = d.c;
  if (d.tete) return [d.logo[0] + 29 * c, d.logo[1] + 2 * c];
  return [
    d.logo[0] + (FENTE_X + 11) * c - (bulle[0].length * c) / 2,
    d.logo[1] - bulle.length * c - c,
  ];
}
/** Où Aïn porte un objet : sur la tête, ou au bout du 3 (le « bec »). */
export function pointPorte(
  d: Decor,
  mode: "tete" | "bec",
  objet: Grille,
  pose: Pose,
  coin: Point,
): Point {
  const c = d.c;
  const barres = pose.barres ?? B_N;
  const H = barres.reduce((s, v) => s + v, 0);
  const forme = pose.forme ?? "3";
  const by = 4 + (22 - H) + (pose.dy ?? 0);
  const pen = pose.penche ? (forme === "e" ? pose.penche : -pose.penche) : 0;
  const ow = objet[0].length;
  const oh = objet.length;
  if (mode === "tete") return [coin[0] + (14.5 + pen - ow / 2) * c, coin[1] + (by - oh + 1) * c];
  const mid = by + barres[0] + barres[1];
  if (forme === "e") return [coin[0] + (23 + pen * 0.6) * c, coin[1] + (mid - oh / 2 + 2) * c];
  return [coin[0] + (6 - ow + pen * 0.6) * c, coin[1] + (mid - oh / 2 + 2) * c];
}

/* ── Le plan ──────────────────────────────────────────────────────────── */

export const ACCROUPI: Pose = { barres: B_EC, pieds: "large" };
const SAUT: Pose[] = [{ barres: B_ET, pieds: "rentres" }, { pieds: "rentres" }, { pieds: "large" }];
const MARCHE: Pose[] = [
  { pieds: "pas" },
  { pieds: "passe1", dy: -1 },
  { pieds: "pas" },
  { pieds: "passe2", dy: -1 },
];
const EASE = {
  lin: (u: number) => u,
  sort: (u: number) => 1 - (1 - u) * (1 - u),
  entre: (u: number) => u * u,
};
export type Ease = keyof typeof EASE;

export type PisteAin = {
  qui: "ain";
  t0: number;
  t1: number;
  de: Point;
  vers: Point;
  arc: number;
  ease: Ease;
  poses: Pose[];
  fps: number;
  boucle: boolean;
  forme: Forme;
  base: Pose;
  trajet: boolean;
};
export type PisteObjet = {
  qui: string;
  dessin: string;
  t0: number;
  t1: number;
  de: Point | null;
  vers: Point | "tete" | "bec" | null;
  arc: number;
  ease: Ease;
  sur?: "tete" | "bec";
  efface?: boolean;
  reste?: boolean;
};
export type Piste = PisteAin | PisteObjet;
export const estAin = (p: Piste): p is PisteAin => p.qui === "ain";

/** Ce que la scène sait d'avant : Aïn dehors, où, dans quelle pose. */
export type Dehors = { pose: Pose; pied: Point; scene: string; enLair: boolean };
/** Le contexte d'une scène : le joueur concerné, et sa variante. */
export type Contexte = { joueur?: Joueur; mode?: string };

/** Une ancre qui manque : la version de la scène ne peut pas se jouer ici,
 * la suivante prend le relais. */
export class SansAncre extends Error {}

export class Plan {
  d: Decor;
  id: string;
  ctx: Contexte;
  joueur: Joueur;
  pistes: Piste[] = [];
  evts: { t: number; fn: () => void }[] = [];
  t = 0;
  base: Pose = {};
  maison: Point;
  pos: Point;
  depuisDehors: boolean;
  forme: Forme;
  sortie: number | null;
  retour: number | null = null;
  /** La scène finit dehors : Aïn reste là tant que l'état dure. */
  reste = false;
  finFn: (() => void) | null = null;
  /** L'air que le logo garde quand la scène finit avec Aïn chez lui. */
  airFin: Maison | null = null;
  /** La scène d'où Aïn n'était pas rentré, s'il était dehors. */
  dehorsDe: string | null;
  garde = new Set<string>();
  refus: string | null = null;
  abaisses = 0;

  constructor(d: Decor, id: string, ctx: Contexte = {}, dehors: Dehors | null = null) {
    this.d = d;
    this.id = id;
    this.ctx = ctx;
    this.joueur = ctx.joueur ?? "1";
    this.maison = d.maison;
    this.pos = dehors ? [...dehors.pied] : [...d.maison];
    this.depuisDehors = dehors !== null;
    this.dehorsDe = dehors?.scene ?? null;
    this.forme = dehors?.pose.forme ?? "3";
    this.sortie = dehors ? 0 : null;
    if (dehors?.enLair) this.retombe();
  }
  /** L'ancre `nom` ; une ancre absente lève `SansAncre`. */
  ancre(nom: string): Ancre {
    const a = this.d.ancre(nom);
    if (!a) throw new SansAncre(nom);
    return a;
  }
  /** Le milieu du bord haut d'une ancre : là où Aïn se pose. */
  pt(nom: string): Point {
    const a = this.ancre(nom);
    return [a.cx, a.y];
  }
  /** Le sol `nom` ; absent, `SansAncre`. */
  sol(nom: string): Sol {
    const s = this.d.sols().find((x) => x.nom === nom);
    if (!s) throw new SansAncre(nom);
    return s;
  }
  piste(
    duree: number,
    vers: Point | null,
    poses: Pose | Pose[],
    o: {
      forme?: Forme;
      arc?: number;
      ease?: Ease;
      fps?: number;
      etale?: boolean;
      base?: Pose;
      trajet?: boolean;
    } = {},
  ) {
    const de: Point = [...this.pos];
    const fin: Point = vers ? [...vers] : [...de];
    const forme = o.forme ?? (fin[0] < de[0] - 0.5 ? "3" : fin[0] > de[0] + 0.5 ? "e" : this.forme);
    this.forme = forme;
    const liste = Array.isArray(poses) ? poses : [poses];
    this.pistes.push({
      qui: "ain",
      t0: this.t,
      t1: this.t + duree,
      de,
      vers: fin,
      arc: o.arc ?? 0,
      ease: o.ease ?? "lin",
      poses: liste,
      fps: o.fps ?? (o.etale ? (liste.length * 1000) / duree : 10),
      boucle: !o.etale,
      forme,
      base: { ...this.base, ...o.base },
      trajet: !!o.trajet,
    });
    this.t += duree;
    this.pos = fin;
    return this;
  }
  /** Aïn sort du logo : le logo montre sa place en pointillés. */
  sortir(duree = 90, pose: Pose = ACCROUPI) {
    if (this.sortie !== null) return this;
    this.sortie = this.t;
    return this.tient(duree, pose);
  }
  tient(
    duree: number,
    poses: Pose | Pose[] = {},
    o: { fps?: number; trajet?: boolean; forme?: Forme } = {},
  ) {
    return this.piste(duree, null, poses, o);
  }
  saute(
    vers: Point,
    duree: number,
    arc = 16,
    o: { poses?: Pose[]; forme?: Forme; trajet?: boolean; ease?: Ease } = {},
  ) {
    return this.piste(duree, vers, o.poses ?? SAUT, { arc, etale: true, ...o });
  }
  /** Un bond : se ramasser, sauter, s'écraser en touchant le sol. */
  bond(vers: Point, o: BondOptions = {}) {
    const dist = Math.hypot(vers[0] - this.pos[0], vers[1] - this.pos[1]);
    const duree = o.d ?? borne(dist * 1.3 + 170, 220, 460);
    const arc = o.arc ?? borne(dist * 0.22 + 8, 10, 40);
    const pose = o.pose ?? {};
    this.tient(o.prise ?? 70, { ...ACCROUPI, ...pose });
    this.saute(vers, duree, arc, {
      trajet: true,
      poses: SAUT.map((p) => Object.assign({}, p, pose)),
      forme: o.forme,
    });
    return this.atterrit(o.atterrit ?? 80, pose);
  }
  marche(vers: Point, duree: number, o: { poses?: Pose[]; fps?: number; forme?: Forme } = {}) {
    return this.piste(duree, vers, o.poses ?? MARCHE, { fps: 10, ...o });
  }
  atterrit(duree = 90, pose: Pose = {}) {
    return this.piste(duree, null, { ...ACCROUPI, ...pose });
  }
  /** Retomber droit sur le sol de dessous (une scène coupée en l'air). */
  retombe() {
    const s = solSous(this.d, this.pos);
    if (!s || Math.abs(s.y - this.pos[1]) < 1) return this;
    return this.piste(
      borne((s.y - this.pos[1]) * 4, 80, 260),
      [this.pos[0], s.y],
      { barres: B_ET, pieds: "rentres" },
      { ease: "entre" },
    );
  }
  /**
   * Aller quelque part : un bond direct si son arc passe, sinon par les
   * points de passage du décor. Sans chemin libre, le bond direct reste, et
   * le planificateur refusera le plan.
   */
  aller(vers: Point, o: BondOptions = {}) {
    const Z = this.d.zones();
    const pas = this.d.passages();
    const routes: Point[][] = [[vers], ...pas.map((q) => [q, vers])];
    if (pas.length > 1) routes.push([...pas, vers], [...pas.slice().reverse(), vers]);
    const route = routes.find((r) => this.libre(r, o, Z)) ?? routes[0];
    route.forEach((q, i) => {
      if (i === route.length - 1) {
        this.bond(q, o);
        return;
      }
      const dist = Math.hypot(q[0] - this.pos[0], q[1] - this.pos[1]);
      this.bond(q, {
        ...o,
        d: borne(dist * 1.1 + 100, 160, 300),
        arc: borne(dist * 0.15 + 4, 4, 18),
        prise: i ? 0 : 50,
        atterrit: 40,
      });
    });
    return this;
  }
  private libre(route: Point[], o: BondOptions, Z: Zone[]) {
    let pos = this.pos;
    for (const [i, q] of route.entries()) {
      const dist = Math.hypot(q[0] - pos[0], q[1] - pos[1]);
      const der = i === route.length - 1;
      const duree = der
        ? (o.d ?? borne(dist * 1.3 + 170, 220, 460))
        : borne(dist * 1.1 + 100, 160, 300);
      const arc = der ? (o.arc ?? borne(dist * 0.22 + 8, 10, 40)) : borne(dist * 0.15 + 4, 4, 18);
      const p: PisteAin = {
        qui: "ain",
        t0: 0,
        t1: duree,
        de: pos,
        vers: q,
        arc,
        ease: "lin",
        poses: SAUT.map((x) => Object.assign({}, x, o.pose)),
        fps: 10,
        boucle: false,
        forme: q[0] < pos[0] ? "3" : "e",
        base: this.base,
        trajet: true,
      };
      const essai = { d: this.d, joueur: this.joueur, dehorsA: () => true };
      if (![1, 0.6, 0.3, 0].some((f) => ((p.arc = arc * f), !pisteTouche(essai, p, Z))))
        return false;
      pos = q;
    }
    return true;
  }
  /** Rentrer au logo, d'où qu'il soit. */
  rentre(o: BondOptions = {}) {
    const m = this.maison;
    if (Math.hypot(m[0] - this.pos[0], m[1] - this.pos[1]) > 2)
      this.aller(m, { forme: m[0] < this.pos[0] ? "3" : "e", ...o });
    this.retour = this.t;
    return this;
  }
  a(t: number, fn: () => void) {
    this.evts.push({ t, fn });
    return this;
  }
  ici(fn: () => void, dt = 0) {
    return this.a(this.t + dt, fn);
  }
  objet(
    nom: string,
    t0: number,
    t1: number,
    de: Point | null,
    vers: PisteObjet["vers"],
    o: {
      dessin?: string;
      arc?: number;
      ease?: Ease;
      sur?: "tete" | "bec";
      efface?: boolean;
      reste?: boolean;
    } = {},
  ) {
    accessoire(o.dessin ?? nom);
    this.pistes.push({
      qui: nom,
      dessin: o.dessin ?? nom,
      t0,
      t1,
      de,
      vers: vers ?? de,
      arc: o.arc ?? 0,
      ease: o.ease ?? "lin",
      sur: o.sur,
      efface: o.efface,
      reste: o.reste,
    });
    return this;
  }
  fin(fn: () => void) {
    this.finFn = fn;
    return this;
  }
  get duree() {
    let d = this.t;
    for (const p of this.pistes) d = Math.max(d, p.t1);
    for (const e of this.evts) d = Math.max(d, e.t);
    return d;
  }
  dehorsA(t: number) {
    return this.sortie !== null && t >= this.sortie && (this.retour === null || t < this.retour);
  }
}
type BondOptions = {
  d?: number;
  arc?: number;
  pose?: Pose;
  prise?: number;
  atterrit?: number;
  forme?: Forme;
};

/** Le sol sous un point : le plus haut des sols qui passent sous lui. */
export function solSous(d: Decor, [x, y]: Point): Sol | null {
  let meilleur: Sol | null = null;
  for (const s of d.sols())
    if (x >= s.x0 - 2 && x <= s.x1 + 2 && s.y >= y - 1 && (!meilleur || s.y < meilleur.y))
      meilleur = s;
  return meilleur;
}

export function interp(
  p: { t0: number; t1: number; de: Point; vers: Point; arc: number; ease: Ease },
  t: number,
): Point {
  const u = p.t1 > p.t0 ? borne((t - p.t0) / (p.t1 - p.t0), 0, 1) : 1;
  const e = EASE[p.ease](u);
  return [
    p.de[0] + (p.vers[0] - p.de[0]) * e,
    p.de[1] + (p.vers[1] - p.de[1]) * e - p.arc * 4 * u * (1 - u),
  ];
}
export function poseA(p: PisteAin, t: number): Pose {
  const n = p.poses.length;
  const i = p.boucle
    ? Math.floor((Math.max(0, t - p.t0) * p.fps) / 1000) % n
    : borne(Math.floor(((t - p.t0) / Math.max(1, p.t1 - p.t0)) * n), 0, n - 1);
  return { forme: p.forme, ...p.base, ...p.poses[i] };
}
export function pisteAinA(P: Plan, t: number): PisteAin | null {
  let pa: PisteAin | null = null;
  for (const p of P.pistes) if (estAin(p) && p.t0 <= t) pa = p;
  return pa;
}
/** Où est un objet au temps t : porté par Aïn, ou sur sa propre piste. */
export function objetA(P: Plan, p: PisteObjet, t: number): Point | null {
  const g = accessoire(p.dessin).g;
  if (p.sur || typeof p.vers === "string") {
    const pa = pisteAinA(P, t);
    if (!pa) return null;
    const q = pointPorte(
      P.d,
      p.sur ?? (p.vers as "tete" | "bec"),
      g,
      poseA(pa, t),
      coinAin(P.d, interp(pa, t)),
    );
    if (p.sur || !p.de) return q;
    return interp({ ...p, de: p.de, vers: q }, t);
  }
  if (!p.de) return null;
  return interp({ ...p, de: p.de, vers: (p.vers as Point | null) ?? p.de }, t);
}

/* ── Le planificateur ─────────────────────────────────────────────────── */

type Essai = { d: Decor; joueur: Joueur; dehorsA: (t: number) => boolean };
export type Contact = { t: number; zone: NomZone; qui: string; ou?: string };

/** Le premier contact d'une piste d'Aïn (lui ou sa bulle) avec une zone. */
export function pisteTouche(P: Essai, p: PisteAin, Z: Zone[]): Contact | null {
  const N = Math.max(6, Math.ceil((p.t1 - p.t0) / 12));
  for (let i = 0; i <= N; i++) {
    const t = p.t0 + (p.t1 - p.t0) * (i / N);
    if (!P.dehorsA(Math.min(t, p.t1 - 0.01))) continue;
    const pos = interp(p, t);
    for (const pz of p.poses) {
      const pose = { forme: p.forme, ...p.base, ...pz };
      const A = boiteAin(P.d, pose, P.joueur, pos);
      for (const z of Z)
        if (touche(A.b, z.b)) return { t: Math.round(t), zone: z.nom, qui: "Aïn", ou: z.qui };
      if (pose.fx?.length) {
        const B = bulleDe(pose.fx, P.joueur);
        const bb = serreA(B.serre, placeBulle(P.d, A.serre, pos, B.g), P.d.c);
        for (const z of Z)
          if (touche(bb, z.b)) return { t: Math.round(t), zone: z.nom, qui: "sa bulle" };
      }
    }
  }
  return null;
}
function objetTouche(P: Plan, p: PisteObjet, Z: Zone[]): Contact | null {
  const { serre } = accessoire(p.dessin);
  const N = Math.max(4, Math.ceil((p.t1 - p.t0) / 12));
  for (let i = 0; i <= N; i++) {
    const t = p.t0 + (p.t1 - p.t0) * (i / N);
    const xy = objetA(P, p, t);
    if (!xy) continue;
    const b = serreA(serre, xy, P.d.c);
    for (const z of Z)
      if (touche(b, z.b)) return { t: Math.round(t), zone: z.nom, qui: p.qui, ou: z.qui };
  }
  return null;
}
const NOMS: Record<NomZone, string> = {
  image: "l'image du jeu",
  ligne: "la ligne d'état",
  controle: "un contrôle",
  texte: "les mots de l'événement",
};

/** Vérifie un plan contre les zones lues maintenant. Abaisse les arcs qui
 * touchent ; rend faux, avec `P.refus`, si une piste touche encore. */
export function verifier(P: Plan, Z: Zone[] = P.d.zones()): boolean {
  P.abaisses = 0;
  const essayer = (p: Piste, test: () => Contact | null) => {
    const arc0 = p.arc;
    let r = test();
    for (const f of [0.6, 0.3, 0]) {
      if (!r || !arc0) break;
      p.arc = arc0 * f;
      P.abaisses++;
      r = test();
    }
    return r;
  };
  // Aïn d'abord : un objet qu'il porte suit ses arcs, abaissés ou non.
  const ordre = [...P.pistes.filter(estAin), ...P.pistes.filter((p) => !estAin(p))];
  for (const p of ordre) {
    const r = estAin(p)
      ? essayer(p, () => pisteTouche(P, p, Z))
      : essayer(p, () => objetTouche(P, p, Z));
    if (r) {
      const ou = r.ou ? ` (${r.ou})` : "";
      P.refus = `${estAin(p) ? r.qui : `l'objet ${r.qui}`} toucherait ${NOMS[r.zone]}${ou} à ${r.t} ms`;
      return false;
    }
  }
  return true;
}
