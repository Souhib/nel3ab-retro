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
 * relevés sur photo (`padmap`). L'inscription d'une touche est le début de son
 * nom (« LB » de « LB · bouton d'épaule gauche ») ; seuls les clics de stick
 * ont une inscription à eux, L3 et R3 sur une Switch, LS et RS sur une Xbox,
 * parce que leur nom est une phrase. Un essai vérifie que le losange tactile
 * d'une Xbox met bien A en bas, comme son dessin, et un autre que chaque
 * inscription est bien le début de son nom.
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
 * sans navigateur sur 1 267 tailles d'écran, quatre formats d'image et trois
 * faces (`faces.test.ts`) ; la garde `spikes/m3-browser-drive/manette-garde.mjs`
 * vérifie ensuite ce que le navigateur en fait.
 */
import type { ButtonName } from "../media/pad";
import type { SwitchButton } from "../media/switch";
import { SWITCH_PRO, XBOX_360, type PadMap } from "./padmap";
import { PADS, PRO_PAD } from "./saves";
import { labels as switchLabels, xboxLabels } from "./switch-labels";
import { enBouton, TACTILE } from "./mots";

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
  title: enBouton(TACTILE),
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

/** L'inscription d'une touche Pro : le début de son nom, avant « · ».
 *
 * « LB · bouton d'épaule gauche » s'inscrit LB, « + · pause » s'inscrit +,
 * « Back » s'inscrit Back. Écrite à part, une seconde table aurait pu dire LB
 * pendant que le configurateur disait autre chose. */
export function inscription(name: string): string {
  return name.split(" · ")[0] ?? name;
}

/** Ce qui change d'une manette Pro à l'autre : les noms, les clics de stick et
 * le losange. */
function proFace(
  name: string,
  title: string,
  map: PadMap,
  names: Readonly<Record<string, string>>,
  sticks: Record<"LS" | "RS", string>,
  inked: boolean,
): ProFace {
  type Rangee = "ZL" | "L" | "MINUS" | "LS" | "R" | "ZR" | "RS" | "PLUS";
  const key = (k: Rangee, forme: Forme): Touche<SwitchButton> => ({
    key: k,
    label: k === "LS" || k === "RS" ? sticks[k] : inscription(names[k] ?? k),
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
  PRO_PAD.label,
  "Manette Switch tactile",
  SWITCH_PRO,
  switchLabels,
  { LS: "L3", RS: "R3" },
  false,
);

/** La manette d'une salle Xbox 360 : la même trame, ses propres noms. */
export const XBOX_FACE: ProFace = proFace(
  "manette Xbox 360",
  "Manette Xbox 360 tactile",
  XBOX_360,
  xboxLabels,
  { LS: "LS", RS: "RS" },
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
export const PRO_DEVICE: number = PRO_PAD.id;

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

/** Une pose : les pièces, et ce qu'elle n'a pas su tenir.
 *
 * `degraded` vaut `null` quand tout tient : aucune pièce sur une autre, rien
 * hors de l'écran, chaque geste de page à `CLEAR` pixels au moins de toute
 * touche. Sinon il dit en mots la première faute. Le pavé s'affiche quand
 * même : une manette imparfaite vaut mieux que pas de manette, mais elle ne le
 * fait plus en silence. Avant le 22 novembre 2026, le repli des gestes prenait
 * la place la moins mauvaise sans le dire, à 6 px de L sur un écran de 568 sur
 * 260. */
export type Pose<K extends string> = { pieces: Piece<K>[]; degraded: string | null };

/** Le geste de la PAGE, jamais du jeu: « La salle », qui ouvre la feuille.
 *
 * Il y en avait trois jusqu'au 22 novembre 2026: son, menu, cacher. Trois
 * cibles de page parmi les touches, c'est trois occasions de perdre la partie
 * d'un pouce mal posé; et le plein écran, la salle et le signalement n'avaient
 * pas de place du tout. Un « ••• » les a remplacés ce jour-là; depuis le
 * 23 novembre, il s'appelle « La salle » et ne se pose parmi les touches que
 * quand la barre de la salle manque (téléphone court tenu droit). Ailleurs, la
 * barre ou le cadre (`lib/cadre`) lui donnent sa place, et la pose reçoit une
 * liste vide. Elle sait toujours en placer plusieurs: le compte vient de la
 * liste reçue. */
export type Geste = "feuille";
export const GESTES: readonly Geste[] = ["feuille"];

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
 * - `BAND_PAD`, 4 : ce qu'un groupe rangé dans une bande noire garde de
 *   chaque côté. Les quatre boutons de la GameCube font 148 px au plancher de
 *   44 ; la bande d'un iPhone de 812 sur 375 tenu en travers en fait 156. À 6
 *   px, le groupe sortait de la bande et mordait de 4 px sur l'image.
 * - `ROW_GAP`, 8, et `KEY_GAP`, 6 : entre deux rangées, et entre deux touches
 *   d'une rangée. Ce sont des choix d'aspect, pas des mesures au doigt : la
 *   garde vise un point à 3 px de chaque bord, et tout écart positif lui
 *   suffit. `KEY_GAP` est aussi l'écart minimal accepté entre deux groupes
 *   (voir `STICK_FLOOR`). À 6, la rangée ZL L fait 138 px, et les deux rangées
 *   du haut tiennent côte à côte dès 296 px de large.
 * - `GESTE_W`, 56 : le geste n'a qu'un signe (l'icône de la salle, le nom en
 *   aide), et la largeur porte en plus la
 *   pastille du son coupé dans son coin. 56 sur 44 reste au-dessus du plancher
 *   dans les deux sens. C'était 72 tant que « CACHER » en capitales (60,1 px
 *   mesurés dans Chrome le 22 novembre 2026) devait y tenir.
 * - `GESTE_GAP`, 4 : entre deux gestes de page, quand il y en a plusieurs. Un
 *   doigt qui tombe entre les deux déclenche un geste de page au lieu d'un
 *   autre, les deux se défont. Choisi quand il y en avait trois (deux tenaient
 *   côte à côte dans une bande de 156 px); gardé pour qu'un second geste,
 *   s'il revenait, ait sa règle.
 * - `STICK_FLOOR`, 80 : le plus petit puits (ou croix) que la pose accepte
 *   quand deux groupes du bas se rencontrent. Il ne sert que sous 276 px de
 *   large : à 260, le stick GameCube et les quatre boutons (148 px) ne laissent
 *   que 82 px (balayage du 22 novembre 2026). C'est moins que le puits d'avant
 *   cette date, 88 px au plus petit.
 */
export const SIZES = {
  FLOOR: 44,
  CLEAR: 16,
  MARGIN: 12,
  BAND_PAD: 4,
  ROW_GAP: 8,
  KEY_GAP: 6,
  GESTE_W: 56,
  GESTE_GAP: 4,
  STICK_FLOOR: 80,
} as const;

const clamp = (low: number, value: number, high: number) => Math.max(low, Math.min(high, value));

/** La taille d'une touche simple, et celle d'un stick ou de la croix.
 *
 * - Une touche fait 11,5 % du petit côté, entre 44 et 56 px. Le facteur place
 *   le plancher à 383 px de petit côté : tout téléphone tenu droit a des
 *   touches de 44 px (390 donne 44), un grand téléphone en travers 49 (430), et
 *   une tablette atteint 56 dès 487. Le plafond est un choix, pas une mesure :
 *   à 56, les quatre boutons de la GameCube font déjà 184 px.
 * - Un stick fait 29 % du petit côté, entre 96 et 136 px. Le puits d'avant le
 *   22 novembre 2026 faisait deux fois clamp(44 px, 15vmin, 68 px), soit 30 %
 *   entre 88 et 136 : la même course à un pour cent près. Le plancher monte à
 *   96 parce que la croix prend la même taille et que ses branches font un
 *   tiers du bloc, 32 px.
 */
export function unitsFor(box: { width: number; height: number }): { key: number; stick: number } {
  const smaller = Math.min(box.width, box.height);
  return {
    key: clamp(SIZES.FLOOR, Math.floor(smaller * 0.115), 56),
    stick: clamp(96, Math.floor(smaller * 0.29), 136),
  };
}

/** La largeur d'une touche simple. Une palette se rétrécit en rond quand les
 * rangées des deux côtés se rencontreraient (écran de 280 px de large). */
const widthOf = (touche: Touche<string>, key: number, narrow: boolean) =>
  touche.forme === "palette"
    ? narrow
      ? key
      : Math.round(key * 1.5)
    : touche.forme === "large"
      ? Math.round(key * 1.6)
      : key;

/** La distance entre deux rectangles : zéro quand ils se touchent ou se recouvrent. */
export function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Le nom d'une pièce, pour dire une faute. */
export function pieceName(piece: Piece<string>): string {
  switch (piece.kind) {
    case "touche":
      return piece.touche.key;
    case "geste":
      return piece.geste;
    case "stick":
      return `stick-${piece.side}`;
    case "croix":
      return "croix";
  }
}

/** Une pièce de jeu et le groupe qui l'a posée : deux groupes doivent rester à
 * `KEY_GAP` l'un de l'autre, deux touches d'un même groupe se suivent. */
type Posee<K extends string> = { piece: Piece<K>; group: number };

/** La première faute entre pièces de jeu, ou `null`. */
function gameFault<K extends string>(placed: Posee<K>[], W: number, H: number): string | null {
  for (const { piece } of placed) {
    const r = piece.rect;
    if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H)
      return `${pieceName(piece)} sort de l'écran`;
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!a || !b) continue;
      if (overlaps(a.piece.rect, b.piece.rect))
        return `${pieceName(a.piece)} recouvre ${pieceName(b.piece)}`;
      if (a.group !== b.group && gapBetween(a.piece.rect, b.piece.rect) < SIZES.KEY_GAP)
        return `${pieceName(a.piece)} touche ${pieceName(b.piece)}`;
    }
  }
  return null;
}

/**
 * Où va chaque pièce, dans une boîte de `box` pixels avec des bandes noires de
 * `bands.left` et `bands.right` pixels de chaque côté de l'image.
 *
 * Chaque côté est une pile : ses rangées en haut, deux groupes en bas (le plus
 * utilisé sous le pouce). Un groupe qui tient dans sa bande, quatre pixels de
 * chaque côté compris, s'y centre ; sinon il se colle au bord de l'écran, pour
 * mordre sur l'image le moins possible. Quand la hauteur manque pour empiler
 * les deux groupes sous les rangées, le second passe à côté du premier ; quand
 * elle manque même pour un seul, les rangées d'un côté se mettent sur une seule
 * ligne. Quand la largeur manque, les palettes deviennent rondes, puis les
 * sticks rétrécissent jusqu'à `STICK_FLOOR`.
 *
 * Les gestes de page vont d'abord dans les bandes noires, s'il y reste de la
 * place à 16 px de toute touche ; puis en rangée en haut au milieu, sous les
 * rangées, en bas, au milieu de l'écran, et en colonne si aucune rangée ne
 * tient.
 */
export function placePad<K extends string>(
  face: FaceOf<Frame, K>,
  box: { width: number; height: number },
  bands: { left: number; right: number },
  /** Les gestes de page à poser parmi les touches. Aucun quand la barre de la
   * salle porte « La salle » (téléphone tenu droit) ou quand le cadre lui
   * donne sa propre place (en travers) : `lib/cadre`. */
  gestes: readonly Geste[] = GESTES,
  /** Une pièce hors de sa bande est une faute : la pose rétrécit ses sticks
   * plutôt que de poser un groupe à côté d'un autre, sur l'image. Le cadre
   * le demande en travers, où les bandes sont faites pour la manette. */
  dansLesBandes = false,
): Pose<K> {
  const W = box.width;
  const H = box.height;
  const units = unitsFor(box);
  const u = units.key;
  const { MARGIN, BAND_PAD, ROW_GAP, KEY_GAP, STICK_FLOOR } = SIZES;

  const band = (which: "left" | "right") => (which === "left" ? bands.left : bands.right);
  const fits = (which: "left" | "right", w: number) => w + 2 * BAND_PAD <= band(which);
  const xOf = (which: "left" | "right", w: number) =>
    fits(which, w)
      ? which === "left"
        ? (band(which) - w) / 2
        : W - band(which) + (band(which) - w) / 2
      : which === "left"
        ? MARGIN
        : W - MARGIN - w;

  /* La taille d'un groupe : un stick ou la croix font `stick`, les boutons
   * prennent le plus grand pas qui tient dans la bande, sans descendre sous le
   * plancher ; sinon le pas ordinaire, au bord de l'écran. */
  const sized = (which: "left" | "right", groupe: Groupe<K>, stick: number) => {
    if (groupe.kind !== "boutons") return { w: stick, h: stick, cell: stick };
    const extra = groupe.cells.some((one) => one.big) ? 8 : 0;
    const span = (cell: number) => 3 * cell + extra + 2 * groupe.spacing;
    let cell = u;
    if (!fits(which, span(u)) && band(which) > 0) {
      const room = Math.floor((band(which) - 2 * BAND_PAD - extra - 2 * groupe.spacing) / 3);
      if (room >= SIZES.FLOOR) cell = room;
    }
    return { w: span(cell), h: span(cell), cell };
  };

  /* Les rangées d'un côté : sur une seule ligne quand la pile ne tient pas en
   * hauteur au-dessus du groupe du bas. Les rangées suivantes vont vers le
   * milieu de l'écran, comme START vers le centre d'une GameCube. */
  const rowsOf = (cote: Cote<K>, which: "left" | "right", stick: number): Touche<K>[][] => {
    const n = cote.rows.length;
    const lower = sized(which, cote.lower, stick);
    const stack = n * u + (n - 1) * ROW_GAP;
    if (n > 1 && MARGIN + stack + ROW_GAP > H - MARGIN - lower.h)
      return [which === "left" ? cote.rows.flat() : [...cote.rows].reverse().flat()];
    return cote.rows;
  };

  const layout = (narrow: boolean, stick: number) => {
    const placed: Posee<K>[] = [];
    let group = 0;
    const put = (groupe: Groupe<K>, rect: Rect, cell: number) => {
      group += 1;
      if (groupe.kind === "croix") placed.push({ group, piece: { kind: "croix", groupe, rect } });
      else if (groupe.kind === "stick")
        placed.push({ group, piece: { kind: "stick", side: groupe.side, rect } });
      else {
        const big = groupe.cells.some((one) => one.big) ? 8 : 0;
        // Les colonnes et les rangées qui portent le gros bouton sont plus larges.
        const bigCol = groupe.cells.find((one) => one.big)?.col;
        const bigRow = groupe.cells.find((one) => one.big)?.row;
        const sizeCol = (c: number) => cell + (c === bigCol ? big : 0);
        const sizeRow = (r: number) => cell + (r === bigRow ? big : 0);
        const start = (size: (i: number) => number, upTo: number) =>
          Array.from({ length: upTo }, (_, i) => size(i) + groupe.spacing).reduce(
            (a, b) => a + b,
            0,
          );
        for (const one of groupe.cells) {
          const w = sizeCol(one.col);
          const h = sizeRow(one.row);
          const side = one.big ? cell + big : cell;
          placed.push({
            group,
            piece: {
              kind: "touche",
              touche: one.touche,
              rect: {
                x: rect.x + start(sizeCol, one.col) + (w - side) / 2,
                y: rect.y + start(sizeRow, one.row) + (h - side) / 2,
                w: side,
                h: side,
              },
            },
          });
        }
      }
    };

    const sideOf = (cote: Cote<K>, which: "left" | "right") => {
      /* Les rangées du haut. */
      let y = MARGIN;
      const rowRects: Rect[] = [];
      for (const row of rowsOf(cote, which, stick)) {
        group += 1;
        const widths = row.map((touche) => widthOf(touche, u, narrow));
        const total = widths.reduce((sum, w) => sum + w, 0) + KEY_GAP * (row.length - 1);
        let x = xOf(which, total);
        row.forEach((touche, i) => {
          const w = widths[i] ?? u;
          placed.push({ group, piece: { kind: "touche", touche, rect: { x, y, w, h: u } } });
          x += w + KEY_GAP;
        });
        rowRects.push({ x: xOf(which, total), y, w: total, h: u });
        y += u + ROW_GAP;
      }
      const top = rowRects.length ? y - ROW_GAP : 0;

      /* Les deux groupes du bas. */
      const lower = sized(which, cote.lower, stick);
      const lowerRect = { x: xOf(which, lower.w), y: H - MARGIN - lower.h, w: lower.w, h: lower.h };
      put(cote.lower, lowerRect, lower.cell);
      if (cote.upper) {
        const upper = sized(which, cote.upper, stick);
        const stacked = {
          x: xOf(which, upper.w),
          y: lowerRect.y - ROW_GAP - upper.h,
          w: upper.w,
          h: upper.h,
        };
        // Empilé s'il reste loin des rangées, à côté du groupe du bas sinon.
        const clash = rowRects.some((row) => gapBetween(row, stacked) < ROW_GAP);
        const beside = {
          x:
            which === "left"
              ? lowerRect.x + lowerRect.w + ROW_GAP
              : lowerRect.x - ROW_GAP - upper.w,
          y: H - MARGIN - upper.h,
          w: upper.w,
          h: upper.h,
        };
        put(cote.upper, clash ? beside : stacked, upper.cell);
      }
      return top;
    };

    const top = Math.max(sideOf(face.left, "left"), sideOf(face.right, "right"));
    return { placed, top };
  };

  /* La plus grande pose sans faute : palettes larges d'abord, puis rondes, et
   * à chaque fois le plus grand stick qui laisse les groupes à distance. */
  const sticks: number[] = [];
  for (let stick = units.stick; stick > STICK_FLOOR; stick -= 4) sticks.push(stick);
  sticks.push(STICK_FLOOR);
  /* Hors de sa bande : ni dans la gauche, ni dans la droite. */
  const horsBande = (placed: Posee<K>[]): string | null => {
    if (!dansLesBandes) return null;
    const dehors = placed.find(
      ({ piece: { rect } }) => rect.x + rect.w > bands.left && rect.x < W - bands.right,
    );
    return dehors ? `${pieceName(dehors.piece)} sort de sa bande` : null;
  };
  const faute = (placed: Posee<K>[]) => gameFault(placed, W, H) ?? horsBande(placed);
  let chosen = layout(true, STICK_FLOOR);
  let fault = faute(chosen.placed);
  search: for (const narrow of [false, true]) {
    for (const stick of sticks) {
      const pose = layout(narrow, stick);
      if (faute(pose.placed) === null) {
        chosen = pose;
        fault = null;
        break search;
      }
    }
  }
  const pieces = chosen.placed.map((one) => one.piece);
  const gestures = placeGestes(
    pieces.map((piece) => piece.rect),
    W,
    H,
    bands,
    chosen.top,
    gestes.length,
  );
  for (const [i, rect] of gestures.rects.entries()) {
    const geste = gestes[i];
    if (geste) pieces.push({ kind: "geste", geste, rect });
  }
  return { pieces, degraded: fault ?? gestures.degraded };
}

/**
 * Les gestes de page (aujourd'hui « La salle », quand la barre manque), loin de
 * toute touche de jeu.
 *
 * D'abord dans les bandes noires : le 22 novembre 2026, les poser en haut au
 * milieu de l'image alors que les bandes étaient libres a mis « menu » sur
 * l'avis de fermeture de la salle et rougi le pilote `touch.mjs`, qui exige que
 * rien ne morde sur l'image quand la bande fait 130 px ou plus. Ils vont
 * ensemble dans une place qui les tient tous ; sinon ils se partagent les places
 * des deux bandes, la plus grande d'abord, et se lisent de gauche à droite.
 */
function placeGestes(
  games: Rect[],
  W: number,
  H: number,
  bands: { left: number; right: number },
  top: number,
  compte: number,
): { rects: Rect[]; degraded: string | null } {
  if (compte === 0) return { rects: [], degraded: null };
  const { GESTE_W: gw, GESTE_GAP: gap, CLEAR, FLOOR, MARGIN, BAND_PAD } = SIZES;
  const room = (rect: Rect) =>
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= W && rect.y + rect.h <= H
      ? Math.min(Infinity, ...games.map((game) => gapBetween(rect, game)))
      : -1;
  const all = (rects: Rect[]) => rects.every((rect) => room(rect) >= CLEAR);

  /* Les places libres de chaque bande : les hauteurs où aucune touche ne passe
   * à moins de CLEAR de l'intérieur de la bande. */
  type Slot = { side: number; x0: number; x1: number; y0: number; y1: number; cols: number };
  const slots: Slot[] = [];
  for (const [side, which] of (["left", "right"] as const).entries()) {
    const wide = which === "left" ? bands.left : bands.right;
    const x0 = which === "left" ? BAND_PAD : W - wide + BAND_PAD;
    const x1 = which === "left" ? wide - BAND_PAD : W - BAND_PAD;
    const cols = Math.floor((x1 - x0 + gap) / (gw + gap));
    if (cols < 1) continue;
    const near = games
      .filter((g) => g.x < x1 + CLEAR && x0 - CLEAR < g.x + g.w)
      .sort((a, b) => a.y - b.y);
    let y: number = MARGIN;
    for (const g of [...near, { x: 0, y: H - MARGIN + CLEAR, w: 0, h: 0 }]) {
      const end = g.y - CLEAR;
      if (end - y >= FLOOR) slots.push({ side, x0, x1, y0: y, y1: end, cols });
      y = Math.max(y, g.y + g.h + CLEAR);
    }
  }
  const capacity = (slot: Slot) =>
    slot.cols * Math.floor((slot.y1 - slot.y0 + gap) / (FLOOR + gap));
  /* `n` gestes dans une place : en lignes centrées, la place centrée aussi. */
  const fill = (slot: Slot, n: number) => {
    const cols = Math.min(slot.cols, n);
    const rows = Math.ceil(n / cols);
    const height = rows * FLOOR + (rows - 1) * gap;
    const y0 = slot.y0 + (slot.y1 - slot.y0 - height) / 2;
    const out: { side: number; rect: Rect }[] = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const width = inRow * gw + (inRow - 1) * gap;
      const x0 = slot.x0 + (slot.x1 - slot.x0 - width) / 2;
      out.push({
        side: slot.side,
        rect: { x: x0 + (i % cols) * (gw + gap), y: y0 + row * (FLOOR + gap), w: gw, h: FLOOR },
      });
    }
    return out;
  };
  const inBands = (): Rect[] | null => {
    const whole = slots.find((slot) => capacity(slot) >= compte);
    let taken: { side: number; rect: Rect }[] = [];
    if (whole) taken = fill(whole, compte);
    else {
      // La plus grande place d'abord ; à égalité, la bande droite, comme avant.
      const order = [...slots].sort((a, b) => capacity(b) - capacity(a) || b.side - a.side);
      for (const slot of order) {
        const left = compte - taken.length;
        if (left <= 0) break;
        taken = [...taken, ...fill(slot, Math.min(left, capacity(slot)))];
      }
    }
    if (taken.length < compte) return null;
    // De gauche à droite et de haut en bas, dans l'ordre de `GESTES`.
    const rects = taken
      .sort((a, b) => a.side - b.side || a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      .map((one) => one.rect);
    return all(rects) ? rects : null;
  };
  const banded = inBands();
  if (banded) return { rects: banded, degraded: null };

  /* Sinon au milieu, en rangée puis en colonne : sur un écran presque carré,
   * le milieu est étroit mais haut. */
  const span = compte * gw + (compte - 1) * gap;
  const tall = compte * FLOOR + (compte - 1) * gap;
  const below = top + CLEAR;
  const row = (y: number) =>
    Array.from({ length: compte }, (_, i) => ({
      x: (W - span) / 2 + i * (gw + gap),
      y,
      w: gw,
      h: FLOOR,
    }));
  const column = (y: number) =>
    Array.from({ length: compte }, (_, i) => ({
      x: (W - gw) / 2,
      y: y + i * (FLOOR + gap),
      w: gw,
      h: FLOOR,
    }));
  const candidates = [
    row(MARGIN),
    row(below),
    row(H - MARGIN - FLOOR),
    row((H - FLOOR) / 2),
    column(MARGIN),
    column(below),
    column((H - tall) / 2),
  ];
  const good = candidates.find(all);
  if (good) return { rects: good, degraded: null };
  // Aucune place ne tient : la moins mauvaise, et la pose le DIT.
  const worst = (rects: Rect[]) => Math.min(...rects.map(room));
  const least = candidates.reduce((best, rects) => (worst(rects) > worst(best) ? rects : best));
  return {
    rects: least,
    degraded: `les gestes de page sont à ${Math.max(0, worst(least)).toFixed(1)} px d'une touche, ${CLEAR} demandés`,
  };
}

/* ── La fente de l'étiquette ──────────────────────────────────────────── */

/**
 * Les mesures de la fente où l'étiquette tapée du joueur se pose dans le
 * creux de la manette, quand aucun panneau ne la porte (plan salle,
 * en-jeu-tactile.5).
 *
 * - `ECART`, 6 : la distance à toute pièce, touche ou geste. L'étiquette ne
 *   prend pas le pointeur : un pouce qui glisse dessus ne fait rien, mais une
 *   étiquette collée à une touche se lirait comme son nom. C'est l'écart que
 *   la pose garde entre deux groupes (`KEY_GAP`).
 * - `HAUT`, 24 : une ligne de `--text-note` en Pixelify, ses deux pixels de
 *   marge et la pastille du numéro.
 * - `MIN`, 64 : le numéro « 1P » et trois lettres d'arcade. Sous ce seuil
 *   l'étiquette ne dit plus rien de lisible : pas de fente.
 * - `MAX`, 180 : au-delà, un nom long étirerait la fente jusqu'aux pouces.
 */
export const FENTE = { ECART: 6, HAUT: 24, MIN: 64, MAX: 180 } as const;

/**
 * La fente de l'étiquette dans une pose, ou `null`.
 *
 * À `ECART` pixels au moins de chaque pièce, gestes compris, et dans les
 * marges de la boîte. À chaque hauteur, le plus large passage libre entre les
 * pièces de cette hauteur ; la fente s'y pose au plus près du milieu de la
 * boîte. La plus large gagne ; à largeur égale, la plus proche du milieu :
 * sur une manette Pro, le creux sous − et + ; sur une GameCube dont « La
 * salle » occupe le creux, à côté de lui, au-dessus de la croix.
 */
export function fente(
  pieces: readonly Piece<string>[],
  box: { width: number; height: number },
): Rect | null {
  const { ECART, HAUT, MIN, MAX } = FENTE;
  const { MARGIN } = SIZES;
  const W = box.width;
  const H = box.height;
  let best: { rect: Rect; loin: number } | null = null;
  for (let y = MARGIN; y + HAUT <= H - MARGIN; y += 2) {
    // Les pièces à cette hauteur, écart compris, de gauche à droite.
    const prises = pieces
      .map((piece) => piece.rect)
      .filter((r) => r.y < y + HAUT + ECART && y - ECART < r.y + r.h)
      .map((r) => ({ de: r.x - ECART, a: r.x + r.w + ECART }))
      .sort((a, b) => a.de - b.de);
    let x: number = MARGIN;
    for (const prise of [...prises, { de: W - MARGIN, a: W - MARGIN }]) {
      const libre = Math.min(prise.de, W - MARGIN) - x;
      if (libre >= MIN) {
        const w = Math.min(MAX, libre);
        const gauche = Math.max(x, Math.min(W / 2 - w / 2, x + libre - w));
        const rect = { x: gauche, y, w, h: HAUT };
        const loin = Math.hypot(gauche + w / 2 - W / 2, y + HAUT / 2 - H / 2);
        if (!best || w > best.rect.w || (w === best.rect.w && loin < best.loin))
          best = { rect, loin };
      }
      x = Math.max(x, prise.a);
    }
  }
  return best?.rect ?? null;
}

/* ── Ce que la boîte d'une manette doit mesurer ──────────────────────── */

/**
 * La place qu'une manette demande au cadre (`lib/cadre`), lue dans la pose.
 *
 * Jusqu'au 23 novembre 2026, le cadre gardait les dimensions d'une maquette :
 * des grappes de 128 px en travers, une boîte de 390 × 272 tenue droite. La
 * pose réelle ne les tenait pas. Les quatre boutons de la GameCube font
 * 148 px au plancher de 44, et une sonde a trouvé, à 844 × 390, B, Z et le
 * geste de page sur l'image ; à 375 × 667, la croix de la manette Pro sur son
 * stick droit. Le cadre lit donc ses mesures ici, dans le même calcul qui pose
 * les touches.
 *
 * - `hauteur(largeur)` : la plus petite hauteur d'une boîte tenue droite, sans
 *   bandes, où la pose ne fait aucune faute, geste « La salle » compris (il y
 *   vit quand la barre manque, et la boîte ne change pas de taille selon) ;
 * - `largeur(hauteur)` : la plus petite bande, de chaque côté d'une boîte en
 *   travers, où chaque pièce tient sans faute. Sans geste : en travers, le
 *   cadre pose « La salle » au-dessus de la grappe.
 *
 * Les deux cherchent par pas de 4 et 2 px, de bas en haut, et retiennent leurs
 * réponses : le cadre les demande à chaque redimensionnement. `null` quand
 * rien ne tient sous le plafond : le cadre essaie alors autre chose, au lieu
 * de recevoir un plafond qu'il prendrait pour une mesure.
 */
export type Encombrement = {
  hauteur: (largeur: number) => number | null;
  largeur: (hauteur: number) => number | null;
};

/** Le plafond des deux recherches : au-delà, la pose ne tiendra plus. */
const ENCOMBREMENT_MAX = { hauteur: 900, largeur: 420 } as const;

/** La boîte en travers est plus large que tout écran tenu en travers : seule
 * sa hauteur compte pour la taille des touches (`unitsFor`). */
const LARGE = 4000;

export function encombrement<K extends string>(face: FaceOf<Frame, K>): Encombrement {
  const hauteurs = new Map<number, number | null>();
  const largeurs = new Map<number, number | null>();
  const hauteur = (largeur: number): number | null => {
    const w = Math.round(largeur);
    const connue = hauteurs.get(w);
    if (connue !== undefined) return connue;
    let h = 120;
    while (
      h < ENCOMBREMENT_MAX.hauteur &&
      placePad(face, { width: w, height: h }, { left: 0, right: 0 }).degraded !== null
    )
      h += 4;
    const rendue = h < ENCOMBREMENT_MAX.hauteur ? h : null;
    hauteurs.set(w, rendue);
    return rendue;
  };
  const largeur = (haut: number): number | null => {
    const h = Math.round(haut);
    const connue = largeurs.get(h);
    if (connue !== undefined) return connue;
    const tient = (b: number) => {
      // `dansLesBandes` : la pose rétrécit ses sticks pour rester dans la
      // bande. Sans lui, à 361 px de haut (un iPhone en travers, barre
      // d'accueil ôtée), la manette Pro posait son stick droit À CÔTÉ de ses
      // quatre boutons et demandait 356 px de chaque côté.
      const pose = placePad(face, { width: LARGE, height: h }, { left: b, right: b }, [], true);
      return pose.degraded === null;
    };
    let b = 60;
    while (b < ENCOMBREMENT_MAX.largeur && !tient(b)) b += 2;
    const rendue = b < ENCOMBREMENT_MAX.largeur ? b : null;
    largeurs.set(h, rendue);
    return rendue;
  };
  return { hauteur, largeur };
}
