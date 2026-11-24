/**
 * Le dessin d'Aïn : des grilles de lettres, une lettre par couleur.
 *
 * Aïn est le 3 du logo, vivant (proposition validée du 23 novembre 2026,
 * ADR D46). En arabizi le 3 note la lettre ʿayn, dont le nom veut dire
 * « œil » : il porte un seul grand œil rond dans la boucle du haut, deux
 * petits pieds rouges, et le relief en escalier du logo (cyan, magenta,
 * bleu). Retourné, il devient Ɛ, la forme de ع.
 *
 * Ce module ne touche pas au DOM, sauf `peindre` et `lirePalette`, qui
 * prennent une toile et un document. Tout le reste rend des grilles :
 * une ligne par chaîne, `.` pour un pixel vide. Les grilles sont recopiées
 * de la proposition (`da/ain/_src/3-dessin.js`), sauf le logo, qui lit les
 * glyphes de `lib/logo.ts` : une seule source pour les lettres.
 */
import { GLYPHES } from "../lib/logo";

/** Une image en lettres : une chaîne par ligne, `.` pour vide. */
export type Grille = readonly string[];

/**
 * La palette : chaque lettre lit son jeton de `regie.css`, et retombe sur
 * sa couleur écrite dans une page sans la feuille. Les seize couleurs sont
 * celles du thème ; 5 à 8 sont les teintes sombres des joueurs
 * (`--joueur-N-sombre`), la première marche d'un relief à leur couleur (le
 * jaune de la place 3 contre le corps faisait 1,46:1, la teinte sombre
 * 3,65:1 au moins). `L` et `a` à `c` sont les lettres et le relief du logo,
 * qui changent avec le thème du jour.
 */
export const PALETTE: Readonly<Record<string, readonly [string, string]>> = {
  K: ["--marine-975", "#070811"],
  k: ["--marine-900", "#161a2e"],
  s: ["--marine-700", "#3a4270"],
  g: ["--marine-400", "#9aa3c2"],
  W: ["--mire-blanc", "#eef0f2"],
  Y: ["--mire-jaune", "#f2e14b"],
  C: ["--mire-cyan", "#57d3f0"],
  G: ["--mire-vert", "#63d488"],
  M: ["--mire-magenta", "#d06fd0"],
  R: ["--mire-rouge", "#e0604f"],
  B: ["--mire-bleu", "#4f63e0"],
  "1": ["--joueur-1", "#d9534f"],
  "2": ["--joueur-2", "#4a86d9"],
  "3": ["--joueur-3", "#d9b64a"],
  "4": ["--joueur-4", "#4aab5c"],
  "5": ["--joueur-1-sombre", "#9a3a36"],
  "6": ["--joueur-2-sombre", "#2f5fa8"],
  "7": ["--joueur-3-sombre", "#8a6d1f"],
  "8": ["--joueur-4-sombre", "#2f7a3f"],
  L: ["--logo-lettre", "#eef0f2"],
  a: ["--logo-relief-1", "#57d3f0"],
  b: ["--logo-relief-2", "#d06fd0"],
  c: ["--logo-relief-3", "#4f63e0"],
};

/** Les couleurs de la palette lues dans la page : un jeton absent ou vide
 * retombe sur la couleur écrite. Sans page (un essai, un worker), toutes
 * les couleurs écrites. */
export function lirePalette(doc: Document | null = globalThis.document ?? null) {
  const style = doc?.documentElement ? getComputedStyle(doc.documentElement) : null;
  const res: Record<string, string> = {};
  for (const [lettre, [jeton, repli]] of Object.entries(PALETTE))
    res[lettre] = (jeton && style?.getPropertyValue(jeton).trim()) || repli;
  return res;
}

/* ── Grilles ──────────────────────────────────────────────────────────── */

type Toile = string[][];
const vide = (w: number, h: number): Toile =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
const fige = (g: Toile): Grille => g.map((l) => l.join(""));
function mettre(g: Toile, x: number, y: number, c: string) {
  if (c !== "." && c !== " " && y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c;
}
const plein = (g: Toile | Grille, x: number, y: number) =>
  y >= 0 && y < g.length && x >= 0 && x < g[0].length && g[y][x] !== ".";
function rectangle(g: Toile, x: number, y: number, w: number, h: number, c: string) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) mettre(g, x + i, y + j, c);
}
function poser(g: Toile, m: Grille, x: number, y: number) {
  m.forEach((ligne, r) => [...ligne].forEach((ch, c) => mettre(g, x + c, y + r, ch)));
}
/** Un contour d'un pixel noir autour de tout ce qui est dessiné. */
function cerner(g: Toile, c = "K"): Grille {
  const o = g.map((l) => l.slice());
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[0].length; x++)
      if (
        g[y][x] === "." &&
        (plein(g, x, y - 1) || plein(g, x, y + 1) || plein(g, x - 1, y) || plein(g, x + 1, y))
      )
        o[y][x] = c;
  return fige(o);
}
/** Un motif d'une couleur, cerné de noir. */
function vignette(m: Grille, couleur: string): Grille {
  const g = vide(m[0].length + 2, m.length + 2);
  m.forEach((ligne, r) =>
    [...ligne].forEach((ch, c) => ch !== "." && mettre(g, c + 1, r + 1, couleur)),
  );
  return cerner(g);
}
const motif = (lignes: Grille): Grille => {
  const g = vide(lignes[0].length + 2, lignes.length + 2);
  poser(g, lignes, 1, 1);
  return cerner(g);
};

/** La boîte serrée d'une grille : [x0, y0, x1, y1), `null` si vide. */
export function boiteSerree(g: Grille): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  g.forEach((ligne, y) =>
    [...ligne].forEach((ch, x) => {
      if (ch === ".") return;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }),
  );
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/* ── Chiffres et bulles ───────────────────────────────────────────────── */

const CHIFFRES: Record<string, Grille> = {
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  "+": ["...", ".#.", "###", ".#.", "..."],
};
const etiquette = (n: string) => CHIFFRES[n].map((l, r) => `${l}.${CHIFFRES.P[r]}`);

/** Ce qu'une bulle montre. */
export const BULLES = {
  z: ["####", "..#.", ".#..", "####"],
  Z: ["#####", "...#.", "..#..", ".#...", "#####"],
  excl: ["##", "##", "##", "..", "##"],
  question: ["###", "..#", ".##", "...", ".#."],
  etoile: ["..#..", "..#..", "#####", "..#..", "..#.."],
  plus1: CHIFFRES["+"].map((l, r) => `${l}.${CHIFFRES["1"][r]}`),
  coeur: [".#.#.", "#####", "#####", ".###.", "..#.."],
  note: ["..##", "..#.", "..#.", "###.", "##.."],
} satisfies Record<string, Grille>;
export type Joueur = "1" | "2" | "3" | "4";
/** Une bulle : un signe, ou l'étiquette d'une place (`tag`, « 3P »). */
export type Bulle = { t: keyof typeof BULLES; c?: string } | { t: "tag"; j?: Joueur };

/** La bulle à deux fois l'unité d'Aïn, posée au-dessus de sa tête. C'est un
 * sprite à part : le planificateur vérifie sa boîte comme celle d'Aïn. */
export function grilleBulle(b: Bulle, joueur: Joueur = "1"): Grille {
  const tag = b.t === "tag";
  const m = tag ? etiquette(b.j ?? joueur) : BULLES[b.t];
  const couleur = tag ? (b.j ?? joueur) : b.c === "P" ? joueur : (b.c ?? "W");
  const double = m.flatMap((l) => {
    const r = [...l].map((ch) => ch + ch).join("");
    return [r, r];
  });
  return vignette(double, couleur);
}

/* ── Aïn ──────────────────────────────────────────────────────────────── */

/** Les hauteurs des cinq barres du 3 : normal, écrasé, étiré, aplati. */
export const B_N = [4, 5, 4, 5, 4] as const;
export const B_EC = [4, 3, 4, 3, 4] as const;
export const B_ET = [4, 6, 4, 6, 4] as const;
export const B_PLAT = [3, 2, 3, 2, 3] as const;
const PARTIES = [
  "#################....",
  "..............#######",
  "......###########....",
  "..............#######",
  "#################....",
];
const ETROIT = [0, 3, 6, 9, 12, 14, 16, 18, 20];
export type Forme = "3" | "e" | "etroit";

/** Le corps du 3 en `#`, pour une forme et des barres. */
export function corps(forme: Forme, barres: readonly number[], n = 5): Grille {
  let m: string[] = [];
  barres.slice(0, n).forEach((h, i) => {
    for (let k = 0; k < h; k++) m.push(PARTIES[i]);
  });
  if (forme === "e") m = m.map((l) => [...l].reverse().join(""));
  else if (forme === "etroit") m = m.map((l) => ETROIT.map((c) => l[c]).join(""));
  return m;
}

/** Les marches du relief : pour chaque marche k (1 à n), les pixels du
 * corps décalés de k×pas vers le bas à droite, qui ne recouvrent ni le
 * corps ni une marche plus proche. */
export function marches(m: Grille, n: number, pas = 1): [number, number][][] {
  const pris = new Set<string>();
  m.forEach((l, r) => [...l].forEach((ch, c) => ch === "#" && pris.add(`${c},${r}`)));
  const res: [number, number][][] = [];
  for (let k = 1; k <= n; k++) {
    const b: [number, number][] = [];
    m.forEach((l, r) =>
      [...l].forEach((ch, c) => {
        if (ch !== "#") return;
        const x = c + k * pas;
        const y = r + k * pas;
        if (!pris.has(`${x},${y}`)) b.push([x, y]);
      }),
    );
    for (const [x, y] of b) pris.add(`${x},${y}`);
    res.push(b);
  }
  return res;
}

export type Oeil = "ouvert" | "mi" | "ferme" | "heureux" | "grand" | "croix";
const OEIL = [
  "...KKK...",
  ".KKWWWKK.",
  ".KWWWWWK.",
  "KWWWWWWWK",
  "KWWWWWWWK",
  "KWWWWWWWK",
  ".KWWWWWK.",
  ".KKWWWKK.",
  "...KKK...",
];
/** L'œil, 9 × 9 : sa forme, et où regarde la pupille (-1, 0, 1). */
export function oeil(forme: Oeil = "ouvert", rx = 0, ry = 0, peau = "Y"): Grille {
  const o = OEIL.map((l) => [...l]);
  const dedans = (x: number, r: number) => OEIL[r]?.[x] === "W";
  const lisse = () => {
    for (let r = 0; r < 9; r++) for (let x = 0; x < 9; x++) if (dedans(x, r)) o[r][x] = peau;
  };
  const traits = (pts: number[][]) => {
    for (const [x, r] of pts) o[r][x] = "K";
  };
  if (forme === "ouvert" || forme === "mi") {
    const x0 = 3 + rx * 2;
    const y0 = 3 + ry;
    for (let r = y0; r < y0 + 3; r++)
      for (let x = x0; x < x0 + 3; x++) if (dedans(x, r)) o[r][x] = "K";
    if (forme === "mi") {
      for (let r = 1; r <= 3; r++) for (let x = 0; x < 9; x++) if (dedans(x, r)) o[r][x] = peau;
      for (let x = 1; x < 8; x++) if (dedans(x, 4)) o[4][x] = "K";
    }
  } else if (forme === "ferme") {
    lisse();
    traits([
      [1, 4],
      [7, 4],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
      [6, 5],
    ]);
  } else if (forme === "heureux") {
    lisse();
    traits([
      [2, 4],
      [3, 3],
      [4, 3],
      [5, 3],
      [6, 4],
      [1, 5],
      [7, 5],
    ]);
  } else if (forme === "grand") {
    o[4][4 + rx] = "K";
  } else {
    traits([
      [2, 2],
      [6, 2],
      [3, 3],
      [5, 3],
      [4, 4],
      [3, 5],
      [5, 5],
      [2, 6],
      [6, 6],
    ]);
  }
  return fige(o);
}

/** Les pieds : [x, y, largeur, hauteur], x depuis le bord gauche du 3 (ils
 * se retournent avec lui), y depuis le bas du corps. */
const PIEDS = {
  repos: [
    [3, 0],
    [11, 0],
  ],
  large: [
    [1, 0],
    [13, 0],
  ],
  pas: [
    [0, 0],
    [14, 0],
  ],
  passe1: [
    [6, -2],
    [9, 0],
  ],
  passe2: [
    [6, 0],
    [9, -2],
  ],
  rentres: [
    [4, -2],
    [10, -2],
  ],
  pointe: [
    [4, 0, 4, 2],
    [10, 0, 4, 2],
  ],
  arcboute: [
    [-1, 0],
    [15, 0],
  ],
  assis: [
    [-1, 0, 5, 3],
    [13, 0, 5, 3],
  ],
  tape: [
    [3, -2],
    [11, 0],
  ],
} satisfies Record<string, number[][]>;
export type Pieds = keyof typeof PIEDS;

/** Une pose d'Aïn. Tout est facultatif : la pose de repos est `{}`. */
export type Pose = {
  forme?: Forme;
  barres?: readonly number[];
  oeil?: Oeil;
  rx?: number;
  ry?: number;
  pieds?: Pieds;
  /** Les marches du relief, de la plus proche à la plus lointaine. `P` et
   * `p` lisent la couleur du joueur et sa teinte sombre. */
  relief?: readonly string[];
  prof?: number;
  sansRelief?: boolean;
  gris?: boolean;
  corps?: string;
  /** Le corps se rallume du bas vers le haut, de 0 à 1 (le redémarrage). */
  remplir?: number;
  /** Les marches se détachent : un décalage par marche. */
  sep?: readonly (readonly [number, number])[];
  penche?: number;
  dx?: number;
  dy?: number;
  sansPieds?: boolean;
  fx?: readonly Bulle[] | null;
};

/** La grille d'Aïn, 32 × 36 : le sol est à la ligne 29 (le contour sous
 * ses pieds), le milieu de la figure, relief compris, à la colonne 15. La
 * tête seule, 30 × 20, base à la ligne 18. */
export const AW = 32;
export const AH = 36;
export const PIED_X = 15;
export const PIED_Y = 29;
export const TW = 30;
export const TH = 20;
export const TETE_X = 14;
export const TETE_Y = 18;

const sombre = (j: string) => String(Number(j) + 4);
/** Le relief aux couleurs d'un joueur : sombre, vif, sombre. */
export const reliefJoueur = (j: Joueur) => [sombre(j), j, sombre(j)];
const couleursRelief = (p: Pose, joueur: Joueur) =>
  p.gris
    ? ["s", "s", "k"]
    : (p.relief ?? ["C", "M", "B"]).map((c) =>
        c === "P" ? joueur : c === "p" ? sombre(joueur) : c,
      );

function relief(g: Toile, m: Grille, p: Pose, joueur: Joueur, bx: number, by: number) {
  const prof = p.sansRelief ? 0 : (p.prof ?? 3);
  const coul = couleursRelief(p, joueur);
  const bs = marches(m, Math.max(prof, 1));
  for (let k = prof; k >= 1; k--) {
    const [sx, sy] = p.sep?.[k - 1] ?? [0, 0];
    for (const [x, y] of bs[k - 1])
      mettre(g, bx + x + sx, by + y + sy, coul[k - 1] ?? coul[coul.length - 1]);
  }
}
function remplirCorps(g: Toile, m: Grille, p: Pose, bx: number, by: number) {
  const peau = p.gris ? "s" : (p.corps ?? "Y");
  const seuil = p.remplir === undefined ? -1 : Math.round(m.length * (1 - p.remplir));
  m.forEach((l, r) =>
    [...l].forEach((ch, c) => ch === "#" && mettre(g, bx + c, by + r, r < seuil ? "s" : peau)),
  );
  return seuil > 1 ? "s" : peau;
}

/** Aïn entier, dans une pose. */
export function dessinerAin(p: Pose, joueur: Joueur = "1", seulRelief = false): Grille {
  const g = vide(AW, AH);
  const forme = p.forme ?? "3";
  const m = corps(forme, p.barres ?? B_N);
  const w = m[0].length;
  const H = m.length;
  const bx = 4 + Math.floor((21 - w) / 2) + (p.dx ?? 0);
  const by = 4 + (22 - H) + (p.dy ?? 0);
  relief(g, m, p, joueur, bx, by);
  if (seulRelief) return cerner(g);
  const peau = remplirCorps(g, m, p, bx, by);
  if (forme !== "etroit")
    poser(g, oeil(p.oeil, p.rx ?? 0, p.ry ?? 0, peau), bx + (forme === "e" ? w - 18 : 9), by + 1);
  let h = g;
  if (p.penche) {
    const s = forme === "e" ? p.penche : -p.penche;
    const bas = by + H;
    h = vide(AW, AH);
    for (let y = 0; y < AH; y++) {
      const d = Math.round((s * Math.max(0, bas - y)) / H);
      for (let x = 0; x < AW; x++) if (g[y][x] !== ".") mettre(h, x + d, y, g[y][x]);
    }
  }
  const pieds =
    forme === "etroit"
      ? [
          [1, 0, 3, 3],
          [5, 0, 3, 3],
        ]
      : PIEDS[p.pieds ?? "repos"];
  if (!p.sansPieds)
    for (const [fx, fy, fw = 4, fh = 3] of pieds) {
      const x = forme === "e" ? bx + (w - fx - fw) : bx + fx;
      const y = by + H + fy;
      rectangle(h, x, y, fw, fh, "R");
      mettre(h, x, y, "W");
      mettre(h, x + 1, y, "W");
    }
  return cerner(h);
}

/** La tête seule, pour la barre du téléphone : le haut du 3, la barre du
 * milieu et l'œil, avec son relief. */
export function dessinerTete(p: Pose, joueur: Joueur = "1"): Grille {
  const g = vide(TW, TH);
  const forme = p.forme === "e" ? "e" : "3";
  const m = corps(forme, p.barres ?? B_N, 3);
  const w = m[0].length;
  const bx = 3;
  const by = 1 + (16 - m.length) + (p.dy ?? 0);
  relief(g, m, p, joueur, bx, by);
  const peau = remplirCorps(g, m, p, bx, by);
  poser(g, oeil(p.oeil, p.rx ?? 0, p.ry ?? 0, peau), bx + (forme === "e" ? w - 18 : 9), by + 1);
  return cerner(g);
}

/* ── Les accessoires ──────────────────────────────────────────────────── */

const ACC = {
  cartouche: motif([
    ".gggggggggggg.",
    "gWWWWWWWWWWWWg",
    "gWYYYYYYYYYYWg",
    "gWRRRRRRRRRRWg",
    "gWBBBBBBYYBBWg",
    "gWBBBBBBBBBBWg",
    "gWWWWWWWWWWWWg",
    "gggggggggggggg",
    ".gsgsgsgsgsgg.",
    "..ssssssssss..",
  ]),
  /* la fiche : broches à gauche, le bout de câble à droite */
  fiche: motif([
    ".....WWWWWWWW.....",
    "YYYY.WggggggW.....",
    ".....WgKggKgWsssss",
    "YYYY.WggggggWsssss",
    ".....WWWWWWWW.....",
  ]),
  boite: motif([
    "YYYYYYYYYYYY",
    "YBYBYBYBYBYY",
    "RRRRRRRRRRRR",
    "MMMMMMMMMMMM",
    "BBBBBBBYYYBB",
    "BBBBBBYYYYYB",
    "BBBBBBBYYYBB",
    "GGGGGsssGGGG",
    "GGGGsssssGGG",
    "GGGssWssssGG",
    "GGsssssWsssG",
    "GsssWsssssss",
    "ssssssssWsss",
    "WWWWWWWWWWWW",
  ]),
  etincelle: motif(["...Y...", ".Y.Y.Y.", "..YWY..", "YYWWWYY", "..YWY..", ".Y.Y.Y.", "...Y..."]),
  /* le « toc » : un petit choc en étoile, posé contre le bord du cadre */
  toc: motif(["W.....W", ".W...W.", "..W.W..", ".......", "..W.W..", ".W...W.", "W.....W"]),
};
/** Les accessoires, par nom : la cartouche (et son haut, quand elle
 * s'enfonce dans le logo), la fiche, la boîte, l'étincelle, le choc, les
 * étiquettes des places, et le relief seul qui se détache. */
export const ACCESSOIRES: Readonly<Record<string, Grille>> = {
  ...ACC,
  ...Object.fromEntries(
    ([1, 2, 3] as const).map((k) => [
      `cartouche-${k}`,
      ACC.cartouche.slice(0, ACC.cartouche.length - k * 3),
    ]),
  ),
  ...Object.fromEntries(
    (["1", "2", "3", "4"] as const).map((j) => [`etiquette${j}`, vignette(etiquette(j), j)]),
  ),
  relief: dessinerAin({}, "1", true),
};

/* ── Le logo, à l'unité d'Aïn ─────────────────────────────────────────── */

/** Le logo fait 38 × 10 pixels de logo ; un pixel de logo fait 3 pixels
 * d'Aïn. Le 3 du logo est la fente où Aïn habite, à la colonne 48. */
export const LOGO_W = 114;
export const LOGO_H = 31;
export const FENTE_X = 48;
const LETTRES = (() => {
  const pts: [number, number][] = [];
  let x = 0;
  for (const ch of ["n", "e", "l", "3", "a", "b"] as const) {
    const gl = GLYPHES[ch];
    if (ch !== "3")
      gl.forEach((l, r) => [...l].forEach((p, c) => p === "#" && pts.push([x + c, r])));
    x += gl[0].length + 1;
  }
  return pts;
})();
/** Le contour en pointillés de la place d'Aïn, quand il est sorti. */
const CONTOUR = (() => {
  const m = corps("3", B_N);
  const dedans = (x: number, y: number) => m[y]?.[x] === "#";
  const res: [number, number][] = [];
  for (let y = -1; y <= m.length; y++)
    for (let x = -1; x <= 21; x++)
      if (
        !dedans(x, y) &&
        (dedans(x - 1, y) || dedans(x + 1, y) || dedans(x, y - 1) || dedans(x, y + 1))
      )
        res.push([x, y]);
  return res;
})();

/** L'air d'Aïn quand il est chez lui, dans le logo. */
export type Maison = Pose & { eteint?: boolean; joueur?: Joueur | null };

/** Le logo : les lettres et leur relief, et Aïn dans la fente, ou sa place
 * en pointillés quand il est dehors (`present` faux). */
export function dessinerLogo(present: boolean, o: Maison = {}): Grille {
  const g = vide(LOGO_W, LOGO_H);
  const lettre = o.eteint ? "s" : "L";
  const prof = o.eteint ? ["k", "k", "k"] : ["a", "b", "c"];
  const m = corps("3", B_N);
  const sien = present ? marches(m, 3, 3) : null;
  const rel = o.eteint || o.gris ? ["s", "s", "k"] : (o.relief ?? ["a", "b", "c"]);
  for (let k = 3; k >= 1; k--) {
    for (const [px, py] of LETTRES) rectangle(g, 3 * (px + k), 3 * (py + k), 3, 3, prof[k - 1]);
    if (sien && !o.sansRelief)
      for (const [x, y] of sien[k - 1])
        mettre(g, FENTE_X + x, y, rel[k - 1] ?? rel[rel.length - 1]);
  }
  for (const [px, py] of LETTRES) rectangle(g, 3 * px, 3 * py, 3, 3, lettre);
  if (present) {
    const peau = remplirCorps(g, m, { ...o, corps: o.eteint ? "7" : o.corps }, FENTE_X, 0);
    poser(
      g,
      oeil(o.eteint ? "ferme" : (o.oeil ?? "ouvert"), o.rx ?? 0, o.ry ?? 0, peau),
      FENTE_X + 9,
      1,
    );
  } else {
    for (const [x, y] of CONTOUR) if ((x + y) % 2 === 0) mettre(g, FENTE_X + x, y, "g");
  }
  return fige(g);
}

/* ── Peindre ──────────────────────────────────────────────────────────── */

/**
 * Peint une grille dans une toile, `k` pixels d'écran par pixel du dessin.
 * Une lettre hors de la palette est une erreur : un pixel d'une couleur
 * inventée ne doit pas passer pour un trou.
 */
export function peindre(cv: HTMLCanvasElement, g: Grille, k: number, pal: Record<string, string>) {
  const W = g[0].length;
  const H = g.length;
  const pw = Math.max(1, Math.round(W * k));
  const ph = Math.max(1, Math.round(H * k));
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw;
    cv.height = ph;
  }
  const c = cv.getContext("2d");
  if (!c) return;
  c.clearRect(0, 0, pw, ph);
  g.forEach((ligne, y) =>
    [...ligne].forEach((ch, x) => {
      if (ch === "." || ch === " ") return;
      const couleur = pal[ch];
      if (!couleur) throw new Error(`couleur inconnue: ${ch}`);
      c.fillStyle = couleur;
      const x0 = Math.round(x * k);
      const y0 = Math.round(y * k);
      c.fillRect(x0, y0, Math.round((x + 1) * k) - x0, Math.round((y + 1) * k) - y0);
    }),
  );
}
