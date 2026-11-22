/**
 * La face de chaque manette tactile : quelles touches, sous quels noms, dans
 * quel ordre, et où elles se posent sur l'écran.
 *
 * # Une face par console, et une seule table
 *
 * Jusqu'au 22 novembre 2026, le pavé Switch était le même dans une salle Xbox
 * 360 : il écrivait ZL, ZR, + et −, sa croix était une grille 2 sur 2 où
 * « gauche » se trouvait à droite de « haut », et B était à gauche de A alors
 * qu'il est à droite sur une Xbox. Le configurateur, lui, savait déjà parler
 * Xbox (`SwitchBindings`, `xboxLabels`). Les deux écrans disaient donc deux
 * choses différentes de la même manette.
 *
 * Ici, les noms prononcés d'une salle Pro viennent de `switch-labels`, la table
 * que lit le configurateur, et la place des quatre boutons vient des dessins
 * relevés sur photo (`padmap`). Une seule vérité pour les deux écrans : un essai
 * vérifie que le losange tactile d'une Xbox met bien A en bas, comme son dessin.
 *
 * # Ce qu'une face ne dit pas
 *
 * Une salle Wii présente un appareil PAR PLACE (Wiimote, manette GameCube,
 * guitare). Le pavé tactile envoie la trame Dolphin et ne connaît pas l'appareil
 * de la place : il garde donc les noms de la trame, ceux de la GameCube. Nommer
 * ses touches comme une Wiimote mentirait à qui joue avec la manette GameCube.
 *
 * # La place à l'écran est un calcul pur
 *
 * `placePad` rend un rectangle par pièce, en pixels, à partir de la taille de la
 * boîte et des bandes noires. Pas de CSS qui décide d'une position : les
 * versions d'avant le faisaient, et les mesures du 22 novembre 2026 ont trouvé
 * L sous START, R et Z sous « cacher », Y sous « cacher » en paysage, et la
 * rangée d'outils de la manette Switch posée sur L et L3. Un calcul se vérifie
 * sur des centaines de tailles sans navigateur ; la garde
 * `spikes/m3-browser-drive/manette-garde.mjs` vérifie ensuite ce que le
 * navigateur en fait.
 */
import type { ButtonName } from "../media/pad";
import type { SwitchButton } from "../media/switch";
import { SWITCH_PRO, XBOX_360, type PadMap } from "./padmap";
import { PADS } from "./saves";
import { labels as switchLabels, xboxLabels } from "./switch-labels";

/** La trame qu'un pavé écrit : celle de Dolphin, ou celle de la manette Pro. */
export type Frame = "dolphin" | "pro";

/** La silhouette d'une touche simple. */
export type Forme = "palette" | "rond" | "large";

/** Une touche simple : un appui, tout ou rien. */
export type Touche<K extends string> = {
  key: K;
  /** Ce qui est écrit dessus. */
  label: string;
  /** Ce qu'une synthèse vocale en dit, quand l'inscription ne suffit pas. */
  spoken?: string;
  forme: Forme;
  /** La couleur de la console, pour les touches qui en ont une (GameCube). */
  teinte?: "a" | "b" | "z";
  /** La couleur de la lettre, prise au dessin (Xbox). */
  ink?: string;
};

/** Les quatre boutons d'action, rangés sur une grille de 3 sur 3. */
export type Cellule<K extends string> = {
  touche: Touche<K>;
  col: 0 | 1 | 2;
  row: 0 | 1 | 2;
  /** Le gros A de la GameCube. */
  big?: boolean;
};

export type Groupe<K extends string> =
  | { kind: "croix"; up: K; down: K; left: K; right: K }
  | { kind: "stick"; side: "l" | "r" }
  | { kind: "boutons"; spacing: number; cells: Cellule<K>[] };

/** Un côté du pavé : des rangées en haut, deux groupes en bas. */
export type Cote<K extends string> = {
  /** Les rangées du haut, chacune de gauche à droite à l'écran. */
  rows: Touche<K>[][];
  /** Le groupe posé au-dessus du plus bas, s'il y en a un. */
  upper?: Groupe<K>;
  /** Le groupe du bas, là où le pouce repose. */
  lower: Groupe<K>;
};

export type FaceOf<F extends Frame, K extends string> = {
  frame: F;
  /** Le nom de la manette, tel qu'une fiche de jeu le dit. */
  name: string;
  /** Pour la page d'essai et les étiquettes d'accessibilité. */
  title: string;
  left: Cote<K>;
  right: Cote<K>;
};

export type DolphinFace = FaceOf<"dolphin", ButtonName>;
export type ProFace = FaceOf<"pro", SwitchButton> & {
  /** Les noms complets de chaque commande, sticks compris : ceux du
   * configurateur, pour la fiche d'un jeu. */
  names: Readonly<Record<string, string>>;
};
export type Face = DolphinFace | ProFace;

/** La touche que la trame appelle `key`, dessinée sur la manette `map`. */
function spot(map: PadMap, key: string): { x: number; y: number; ink?: string } {
  const part = map.parts.find((one) => one.key === key);
  if (!part) throw new Error(`${map.id} n'a pas de touche ${key}`);
  return { x: part.x, y: part.y, ink: part.ink };
}

/**
 * Les quatre boutons d'une manette, rangés en losange d'après son DESSIN.
 *
 * Lu sur le plan plutôt qu'écrit ici : le plan est relevé sur une photo, et
 * c'est lui que le configurateur montre. Le plus haut va en haut, le plus à
 * gauche à gauche, et ainsi de suite. Sur une Xbox, A est en bas et B à
 * droite ; sur une Switch, A est à droite et B en bas.
 */
export function diamondOf(map: PadMap): Record<"top" | "left" | "right" | "bottom", SwitchButton> {
  const four = (["A", "B", "X", "Y"] as const).map((key) => {
    const { x, y } = spot(map, key);
    return { key, x, y };
  });
  const pick = (better: (a: (typeof four)[number], b: (typeof four)[number]) => boolean) =>
    four.reduce((best, one) => (better(one, best) ? one : best)).key;
  const placed = {
    top: pick((a, b) => a.y < b.y),
    bottom: pick((a, b) => a.y > b.y),
    left: pick((a, b) => a.x < b.x),
    right: pick((a, b) => a.x > b.x),
  };
  if (new Set(Object.values(placed)).size !== 4)
    throw new Error(`${map.id} ne range pas ses quatre boutons en losange`);
  return placed;
}

/** Les quatre boutons en losange, avec la couleur des lettres si on la veut. */
function diamond(map: PadMap, inked: boolean): Groupe<SwitchButton> {
  const at = diamondOf(map);
  const cell = (key: SwitchButton, col: 0 | 1 | 2, row: 0 | 1 | 2): Cellule<SwitchButton> => ({
    touche: { key, label: key, forme: "rond", ink: inked ? spot(map, key).ink : undefined },
    col,
    row,
  });
  return {
    kind: "boutons",
    // Pas d'écart : en losange, deux voisins ne se touchent que par la
    // diagonale, et deux ronds de 44 px sur une diagonale de 62 laissent 18 px.
    spacing: 0,
    cells: [cell(at.top, 1, 0), cell(at.left, 0, 1), cell(at.right, 2, 1), cell(at.bottom, 1, 2)],
  };
}

/** La manette GameCube : la trame de Dolphin, nommée comme elle. */
export const DOLPHIN_FACE: DolphinFace = {
  frame: "dolphin",
  name: "manette GameCube",
  title: "Manette tactile",
  left: {
    rows: [[{ key: "L", label: "L", spoken: "gâchette gauche", forme: "palette" }]],
    // La croix au-dessus du stick : elle sert surtout dans les menus, le stick
    // sert tout le temps, et c'est lui qui va sous le pouce au repos.
    upper: { kind: "croix", up: "D_UP", down: "D_DOWN", left: "D_LEFT", right: "D_RIGHT" },
    lower: { kind: "stick", side: "l" },
  },
  right: {
    rows: [
      [
        // Z est une petite touche mauve contre R, comme sur la console.
        { key: "Z", label: "Z", spoken: "bouton Z", forme: "rond", teinte: "z" },
        { key: "R", label: "R", spoken: "gâchette droite", forme: "palette" },
      ],
      [{ key: "START", label: "START", forme: "large" }],
    ],
    // A gros au milieu, B en bas à gauche, X à droite, Y au-dessus : la
    // géométrie de la console. Un essai la compare au dessin `GAMECUBE`.
    lower: {
      kind: "boutons",
      spacing: 4,
      cells: [
        { touche: { key: "Y", label: "Y", forme: "rond" }, col: 1, row: 0 },
        { touche: { key: "A", label: "A", forme: "rond", teinte: "a" }, col: 1, row: 1, big: true },
        { touche: { key: "X", label: "X", forme: "rond" }, col: 2, row: 1 },
        { touche: { key: "B", label: "B", forme: "rond", teinte: "b" }, col: 0, row: 2 },
      ],
    },
  },
};

/** Ce qui change d'une manette Pro à l'autre : les inscriptions et le losange. */
function proFace(
  name: string,
  title: string,
  map: PadMap,
  names: Readonly<Record<string, string>>,
  short: Record<"ZL" | "L" | "MINUS" | "LS" | "R" | "ZR" | "RS" | "PLUS", string>,
  inked: boolean,
): ProFace {
  const key = (k: keyof typeof short, forme: Forme): Touche<SwitchButton> => ({
    key: k,
    label: short[k],
    spoken: names[k],
    forme,
  });
  return {
    frame: "pro",
    name,
    title,
    names,
    left: {
      rows: [
        [key("ZL", "palette"), key("L", "palette")],
        [key("MINUS", "rond"), key("LS", "rond")],
      ],
      upper: { kind: "croix", up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT" },
      lower: { kind: "stick", side: "l" },
    },
    right: {
      rows: [
        [key("R", "palette"), key("ZR", "palette")],
        [key("RS", "rond"), key("PLUS", "rond")],
      ],
      upper: { kind: "stick", side: "r" },
      lower: diamond(map, inked),
    },
  };
}

/** La manette Pro d'une salle Switch ou Switch 2. */
export const SWITCH_FACE: ProFace = proFace(
  "manette Pro",
  "Manette Switch tactile",
  SWITCH_PRO,
  switchLabels,
  { ZL: "ZL", L: "L", MINUS: "−", LS: "L3", R: "R", ZR: "ZR", RS: "R3", PLUS: "+" },
  false,
);

/** La manette d'une salle Xbox 360 : la même trame, ses propres noms. */
export const XBOX_FACE: ProFace = proFace(
  "manette Xbox 360",
  "Manette Xbox 360 tactile",
  XBOX_360,
  xboxLabels,
  { ZL: "LT", L: "LB", MINUS: "Back", LS: "LS", R: "RB", ZR: "RT", RS: "RS", PLUS: "Start" },
  true,
);

/** Une face par console du manifeste. Un essai refuse une console sans face. */
export const FACES: Readonly<Record<string, Face>> = {
  gc: DOLPHIN_FACE,
  wii: DOLPHIN_FACE,
  switch: SWITCH_FACE,
  switch2: SWITCH_FACE,
  x360: XBOX_FACE,
};

/** La face d'une console, ou rien pour un code qu'aucune face ne décrit. */
export function faceOf(code: string | undefined): Face | null {
  return code !== undefined && Object.hasOwn(FACES, code) ? (FACES[code] ?? null) : null;
}

/** Les codes qui n'ont pas de face. Vide quand chaque console en a une. */
export function missingFaces(codes: readonly string[]): string[] {
  return codes.filter((code) => faceOf(code) === null);
}

/** L'appareil que la trame Pro présente au jeu, dans les fiches et le manifeste. */
export const PRO_DEVICE = 4;

/**
 * Le nom d'un appareil, dans une salle donnée. Rien pour un code qu'elle ne
 * connaît pas.
 *
 * L'ancien `padLabel(4)` rendait « manette GameCube » pour la manette Pro d'un
 * jeu Switch : le code 4 n'était pas dans sa table et le repli tombait sur la
 * GameCube. Un appareil inconnu reste inconnu ici, et c'est à l'écran de le
 * dire.
 */
export function deviceLabel(device: number, code: string | undefined): string | null {
  const face = faceOf(code);
  if (face?.frame === "pro") return device === PRO_DEVICE ? face.name : null;
  if (face?.frame === "dolphin") return PADS.find((one) => one.id === device)?.label ?? null;
  return null;
}

/**
 * Où le doigt appuie sur une croix d'un seul bloc : jusqu'à deux directions.
 *
 * Quatre boutons de 28 px laissaient le doigt tomber entre deux branches
 * (mesuré le 22 novembre 2026, sous le plancher de 44 px). Un bloc lu à l'angle
 * se vise partout, donne les diagonales, et se suit en glissant d'une
 * direction à l'autre.
 *
 * Chaque direction couvre 120 degrés centrés sur son axe : les diagonales sont
 * donc les 30 degrés où deux directions se recouvrent. Une croix de menu se
 * vise rarement en diagonale, et une bande diagonale étroite évite de
 * descendre d'une ligne en voulant aller à droite. Le centre est mort, comme
 * celui du stick : un pouce posé sans pousser ne dit rien.
 */
export function crossFrom(
  centre: { x: number; y: number },
  point: { x: number; y: number },
  radius: number,
  dead = 0.2,
): { up: boolean; down: boolean; left: boolean; right: boolean } {
  const dx = point.x - centre.x;
  // Vers le HAUT, comme une manette ; l'écran compte vers le bas.
  const dy = centre.y - point.y;
  if (Math.hypot(dx, dy) < dead * Math.max(1, radius))
    return { up: false, down: false, left: false, right: false };
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    right: Math.abs(angle) < 60,
    up: angle > 30 && angle < 150,
    left: Math.abs(angle) > 120,
    down: angle < -30 && angle > -150,
  };
}

/** Un rectangle d'écran, en pixels, depuis le coin haut gauche de la boîte. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Une pièce posée : ce qu'elle est, et où. */
export type Piece<K extends string> =
  | { kind: "touche"; touche: Touche<K>; rect: Rect }
  | { kind: "croix"; groupe: Extract<Groupe<K>, { kind: "croix" }>; rect: Rect }
  | { kind: "stick"; side: "l" | "r"; rect: Rect }
  | { kind: "geste"; geste: Geste; rect: Rect };

/** Les trois gestes de la PAGE, jamais du jeu. */
export type Geste = "son" | "menu" | "cacher";
export const GESTES: readonly Geste[] = ["son", "menu", "cacher"];

/**
 * Les mesures du pavé, en pixels.
 *
 * Chacune a sa raison :
 *
 * - `FLOOR`, 44 : le plancher usuel d'une cible tactile (WCAG 2.5.5, Apple).
 *   Mesuré le 22 novembre 2026 : la croix faisait 28 px et L, R, Z 31 px de
 *   haut sur un iPhone.
 * - `CLEAR`, 16 : l'écart entre un geste de page et une touche de jeu. L'audit
 *   en demande 12 ; quatre de plus pour qu'un arrondi ou une police plus large
 *   ne fasse pas rougir la garde à 11,5.
 * - `MARGIN`, 12 : le bord de l'écran, où le doigt glisse hors du verre.
 * - `GESTE_W`, 80 : « CACHER » en capitales espacées déborde de 72 px (vu sur
 *   les captures de la garde, le 22 novembre 2026).
 * - `BAND_PAD`, 4 : ce qu'un groupe rangé dans une bande noire garde de
 *   chaque côté. Les quatre boutons de la GameCube font 148 px au plancher de
 *   44 ; la bande d'un iPhone de 812 sur 375 tenu en travers en fait 156. À 6
 *   px, le groupe sortait de la bande et mordait de 4 px sur l'image.
 */
export const SIZES = {
  FLOOR: 44,
  CLEAR: 16,
  MARGIN: 12,
  BAND_PAD: 4,
  ROW_GAP: 8,
  KEY_GAP: 6,
  GESTE_W: 80,
  GESTE_GAP: 8,
} as const;

const clamp = (low: number, value: number, high: number) => Math.max(low, Math.min(high, value));

/** La taille d'une touche simple, et celle d'un stick ou de la croix. */
export function unitsFor(box: { width: number; height: number }): { key: number; stick: number } {
  const smaller = Math.min(box.width, box.height);
  return {
    key: clamp(SIZES.FLOOR, Math.floor(smaller * 0.115), 56),
    // Le puits d'avant faisait deux fois clamp(44, 15vmin, 68) : la même course.
    stick: clamp(96, Math.floor(smaller * 0.29), 136),
  };
}

const widthOf = (touche: Touche<string>, key: number) =>
  touche.forme === "palette"
    ? Math.round(key * 1.5)
    : touche.forme === "large"
      ? Math.round(key * 1.6)
      : key;

/** Les bords qui se touchent ou se recouvrent, à `gap` près. */
export function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * Où va chaque pièce, dans une boîte de `box` pixels avec des bandes noires de
 * `bands.left` et `bands.right` pixels de chaque côté de l'image.
 *
 * Chaque côté est une pile : ses rangées en haut, deux groupes en bas (le plus
 * utilisé sous le pouce). Un groupe qui tient dans sa bande, quatre pixels de
 * chaque côté compris, s'y centre ; sinon il se colle au bord de l'écran, pour
 * mordre sur l'image le moins possible. Quand la hauteur manque pour empiler
 * les deux groupes sous les rangées, le second passe à côté du premier.
 *
 * Les gestes de page prennent la première place libre à 16 px de toute touche :
 * en rangée en haut au milieu, puis sous les rangées, puis en bas, puis au
 * milieu de l'écran ; en colonne au milieu si aucune rangée ne tient.
 */
export function placePad<K extends string>(
  face: FaceOf<Frame, K>,
  box: { width: number; height: number },
  bands: { left: number; right: number },
): Piece<K>[] {
  const W = box.width;
  const H = box.height;
  const { key: u, stick: s } = unitsFor(box);
  const { MARGIN, BAND_PAD, ROW_GAP, KEY_GAP } = SIZES;
  const pieces: Piece<K>[] = [];

  const sideOf = (cote: Cote<K>, which: "left" | "right") => {
    const band = which === "left" ? bands.left : bands.right;
    const fits = (w: number) => w + 2 * BAND_PAD <= band;
    const xOf = (w: number) =>
      fits(w)
        ? which === "left"
          ? (band - w) / 2
          : W - band + (band - w) / 2
        : which === "left"
          ? MARGIN
          : W - MARGIN - w;

    /* Les rangées du haut. */
    let y = MARGIN;
    const rowRects: Rect[] = [];
    for (const row of cote.rows) {
      const widths = row.map((touche) => widthOf(touche, u));
      const total = widths.reduce((sum, w) => sum + w, 0) + KEY_GAP * (row.length - 1);
      let x = xOf(total);
      row.forEach((touche, i) => {
        const rect = { x, y, w: widths[i] ?? u, h: u };
        pieces.push({ kind: "touche", touche, rect });
        x += (widths[i] ?? u) + KEY_GAP;
      });
      rowRects.push({ x: xOf(total), y, w: total, h: u });
      y += u + ROW_GAP;
    }
    const top = cote.rows.length ? y - ROW_GAP : 0;

    /* Les deux groupes du bas. */
    const sized = (groupe: Groupe<K>) => {
      if (groupe.kind !== "boutons") return { w: s, h: s, cell: s };
      // Le plus grand pas qui tient dans la bande, sans descendre sous le
      // plancher ; sinon le pas ordinaire, au bord de l'écran.
      const extra = groupe.cells.some((one) => one.big) ? 8 : 0;
      const span = (cell: number) => 3 * cell + extra + 2 * groupe.spacing;
      let cell = u;
      if (!fits(span(u)) && band > 0) {
        const room = Math.floor((band - 2 * BAND_PAD - extra - 2 * groupe.spacing) / 3);
        if (room >= SIZES.FLOOR) cell = room;
      }
      return { w: span(cell), h: span(cell), cell };
    };
    const lower = sized(cote.lower);
    const lowerRect = { x: xOf(lower.w), y: H - MARGIN - lower.h, w: lower.w, h: lower.h };
    const put = (groupe: Groupe<K>, rect: Rect, cell: number) => {
      if (groupe.kind === "croix") pieces.push({ kind: "croix", groupe, rect });
      else if (groupe.kind === "stick") pieces.push({ kind: "stick", side: groupe.side, rect });
      else {
        const big = groupe.cells.some((one) => one.big) ? 8 : 0;
        // Les colonnes et les rangées qui portent le gros bouton sont plus larges.
        const bigCol = groupe.cells.find((one) => one.big)?.col;
        const bigRow = groupe.cells.find((one) => one.big)?.row;
        const sizeCol = (c: number) => cell + (c === bigCol ? big : 0);
        const sizeRow = (r: number) => cell + (r === bigRow ? big : 0);
        const startCol = (c: number) =>
          Array.from({ length: c }, (_, i) => sizeCol(i) + groupe.spacing).reduce(
            (a, b) => a + b,
            0,
          );
        const startRow = (r: number) =>
          Array.from({ length: r }, (_, i) => sizeRow(i) + groupe.spacing).reduce(
            (a, b) => a + b,
            0,
          );
        for (const one of groupe.cells) {
          const w = sizeCol(one.col);
          const h = sizeRow(one.row);
          const side = one.big ? cell + big : cell;
          pieces.push({
            kind: "touche",
            touche: one.touche,
            rect: {
              x: rect.x + startCol(one.col) + (w - side) / 2,
              y: rect.y + startRow(one.row) + (h - side) / 2,
              w: side,
              h: side,
            },
          });
        }
      }
    };
    put(cote.lower, lowerRect, lower.cell);
    if (cote.upper) {
      const upper = sized(cote.upper);
      const stacked = {
        x: xOf(upper.w),
        y: lowerRect.y - ROW_GAP - upper.h,
        w: upper.w,
        h: upper.h,
      };
      // Empilé s'il reste loin des rangées, à côté du groupe du bas sinon.
      const clash = rowRects.some((row) => gapBetween(row, stacked) < ROW_GAP);
      const beside = {
        x: which === "left" ? lowerRect.x + lowerRect.w + ROW_GAP : lowerRect.x - ROW_GAP - upper.w,
        y: H - MARGIN - upper.h,
        w: upper.w,
        h: upper.h,
      };
      put(cote.upper, clash ? beside : stacked, upper.cell);
    }
    return { top };
  };

  const left = sideOf(face.left, "left");
  const right = sideOf(face.right, "right");

  /* Les gestes de page, là où ils restent loin de toute touche.
   *
   * En rangée d'abord, puis en colonne quand la rangée ne trouve pas de place :
   * sur un écran presque carré, le milieu est étroit mais haut. */
  const { GESTE_W, GESTE_GAP, CLEAR, FLOOR } = SIZES;
  const span = GESTES.length * GESTE_W + (GESTES.length - 1) * GESTE_GAP;
  const tall = GESTES.length * FLOOR + (GESTES.length - 1) * GESTE_GAP;
  const games = pieces.map((piece) => piece.rect);
  const below = Math.max(left.top, right.top) + CLEAR;
  const row = (y: number) => ({ x: (W - span) / 2, y, w: span, h: FLOOR, column: false });
  const column = (y: number) => ({ x: (W - GESTE_W) / 2, y, w: GESTE_W, h: tall, column: true });
  const candidates = [
    row(MARGIN),
    row(below),
    row(H - MARGIN - FLOOR),
    row((H - FLOOR) / 2),
    column(MARGIN),
    column(below),
    column((H - tall) / 2),
  ];
  const room = (rect: Rect) =>
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= W && rect.y + rect.h <= H
      ? Math.min(...games.map((game) => gapBetween(rect, game)))
      : -1;
  const chosen =
    candidates.find((rect) => room(rect) >= CLEAR) ??
    candidates.reduce((best, rect) => (room(rect) > room(best) ? rect : best));
  GESTES.forEach((geste, i) => {
    const step = i * (FLOOR + GESTE_GAP);
    pieces.push({
      kind: "geste",
      geste,
      rect: chosen.column
        ? { x: chosen.x, y: chosen.y + step, w: GESTE_W, h: FLOOR }
        : { x: chosen.x + i * (GESTE_W + GESTE_GAP), y: chosen.y, w: GESTE_W, h: FLOOR },
    });
  });
  return pieces;
}
