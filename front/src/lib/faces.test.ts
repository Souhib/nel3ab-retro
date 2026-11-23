/**
 * Les faces des manettes tactiles, et leur place à l'écran.
 *
 * Deux familles d'essais. Les premiers tiennent la table : une face pour chaque
 * console du manifeste, des noms Xbox dans une salle Xbox, et des losanges lus
 * sur les dessins. Les seconds balaient des centaines de tailles d'écran et
 * vérifient ce que l'audit du 22 novembre 2026 a trouvé faux : aucune touche
 * sous une autre, aucun geste de page à moins de 16 px d'une touche de jeu,
 * aucune cible sous 44 px.
 */
import { describe, expect, it } from "vitest";
import manifest from "../../../consoles/consoles.json";
import { CONSOLE_CODES } from "./consoles";
import {
  DOLPHIN_FACE,
  FACES,
  SIZES,
  SWITCH_FACE,
  XBOX_FACE,
  crossFrom,
  deviceLabel,
  diamondOf,
  faceOf,
  gapBetween,
  inscription,
  missingFaces,
  placePad,
  unitsFor,
  type Face,
  type Piece,
  type Rect,
} from "./faces";
import { encombrement } from "./faces";
import { place } from "./fit";
import { GAMECUBE, SWITCH_PRO, XBOX_360, mirrorX, type PadMap } from "./padmap";
import { labels as switchLabels, xboxLabels } from "./switch-labels";

/** Les touches simples d'une face, par nom de trame. */
/** Les touches d'une manette Pro dont le pavé dit un nom à voix haute. */
const PARLEES = ["L", "LS", "MINUS", "PLUS", "R", "RS", "ZL", "ZR"];

function keysOf(face: Face): Map<string, { label: string; spoken?: string }> {
  const found = new Map<string, { label: string; spoken?: string }>();
  for (const cote of [face.left, face.right]) {
    for (const row of cote.rows) for (const one of row) found.set(one.key, one);
    for (const groupe of [cote.upper, cote.lower]) {
      if (groupe?.kind === "boutons")
        for (const cell of groupe.cells) found.set(cell.touche.key, cell.touche);
    }
  }
  return found;
}

/** Où chacun des quatre boutons est rangé, dans la grille de 3 sur 3. */
function cellsOf(face: Face): Record<string, { col: number; row: number }> {
  const lower = face.right.lower;
  if (lower.kind !== "boutons") throw new Error("la face n'a pas de boutons en bas à droite");
  return Object.fromEntries(
    lower.cells.map((cell) => [cell.touche.key, { col: cell.col, row: cell.row }]),
  );
}

describe("une face par console", () => {
  it("chaque console du manifeste a une face, qui parle sa trame", () => {
    expect(CONSOLE_CODES.length).toBeGreaterThan(0);
    expect(missingFaces(CONSOLE_CODES)).toEqual([]);
    for (const console of manifest.consoles) {
      const face = faceOf(console.code);
      expect(face?.frame, console.code).toBe(console.input === "pro" ? "pro" : "dolphin");
    }
  });

  it("refuse une console qu'aucune face ne décrit, même un nom d'objet JavaScript", () => {
    // Le jumeau négatif: une console ajoutée au manifeste sans face doit
    // rougir l'essai d'au-dessus, et non tomber en silence sur une autre.
    expect(missingFaces([...CONSOLE_CODES, "ps2"])).toEqual(["ps2"]);
    expect(faceOf("?")).toBeNull();
    expect(faceOf(undefined)).toBeNull();
    expect(faceOf("toString")).toBeNull();
    expect(Object.keys(FACES).sort()).toEqual([...CONSOLE_CODES].sort());
  });
});

describe("les noms des touches", () => {
  it("une salle Xbox 360 dit LB, LT, Back et Start, avec les noms du configurateur", () => {
    // Par le code de la salle, comme le pavé la reçoit, et pas par la constante.
    const face = faceOf("x360");
    if (face?.frame !== "pro") throw new Error("la salle Xbox 360 n'a pas de face Pro");
    const keys = keysOf(face);
    expect(keys.get("L")?.label).toBe("LB");
    expect(keys.get("ZL")?.label).toBe("LT");
    expect(keys.get("R")?.label).toBe("RB");
    expect(keys.get("ZR")?.label).toBe("RT");
    expect(keys.get("MINUS")?.label).toBe("Back");
    expect(keys.get("PLUS")?.label).toBe("Start");
    // Une seule source pour le pavé et le configurateur: `xboxLabels`. La
    // précondition d'abord: sans elle, un pavé qui perdrait tous ses noms dits
    // laisserait la boucle vide et l'essai vert (vérification finale du
    // 22 novembre 2026).
    const parlees = [...keys].filter(([, one]) => one.spoken !== undefined);
    expect(parlees.map(([key]) => key).sort()).toEqual(PARLEES);
    for (const [key, one] of parlees) expect(one.spoken, key).toBe(xboxLabels[key as "A"]);
    expect(face.names).toBe(xboxLabels);
    const said = [...keys.values()].map((one) => `${one.label} ${one.spoken ?? ""}`).join(" ");
    expect(said).not.toMatch(/ZL|ZR|[+−]/);
  });

  it("une salle Switch garde ZL, ZR, + et −, et ses propres noms", () => {
    // Le jumeau: les noms Xbox ne fuient pas dans une salle Switch.
    const face = faceOf("switch");
    if (!face) throw new Error("la salle Switch n'a pas de face");
    const keys = keysOf(face);
    expect(keys.get("ZL")?.label).toBe("ZL");
    expect(keys.get("PLUS")?.label).toBe("+");
    expect(keys.get("MINUS")?.label).toBe("−");
    const parlees = [...keys].filter(([, one]) => one.spoken !== undefined);
    expect(parlees.map(([key]) => key).sort()).toEqual(PARLEES);
    for (const [key, one] of parlees) expect(one.spoken, key).toBe(switchLabels[key as "A"]);
    const said = [...keys.values()].map((one) => one.label).join(" ");
    expect(said).not.toMatch(/LB|LT|Back|Start/);
    expect(faceOf("switch2")).toBe(SWITCH_FACE);
  });

  it("une salle GameCube ou Wii nomme la trame Dolphin, sans aucun nom Pro", () => {
    expect(faceOf("gc")).toBe(DOLPHIN_FACE);
    expect(faceOf("wii")).toBe(DOLPHIN_FACE);
    expect([...keysOf(DOLPHIN_FACE).keys()].sort()).toEqual([
      "A",
      "B",
      "L",
      "R",
      "START",
      "X",
      "Y",
      "Z",
    ]);
  });
});

describe("les quatre boutons, lus sur le dessin", () => {
  it("Xbox: Y en haut, X à gauche, B à droite, A en bas", () => {
    expect(diamondOf(XBOX_360)).toEqual({ top: "Y", left: "X", right: "B", bottom: "A" });
    expect(cellsOf(XBOX_FACE)).toEqual({
      Y: { col: 1, row: 0 },
      X: { col: 0, row: 1 },
      B: { col: 2, row: 1 },
      A: { col: 1, row: 2 },
    });
  });

  it("Switch: X en haut, Y à gauche, A à droite, B en bas", () => {
    expect(diamondOf(SWITCH_PRO)).toEqual({ top: "X", left: "Y", right: "A", bottom: "B" });
    expect(cellsOf(SWITCH_FACE).A).toEqual({ col: 2, row: 1 });
  });

  it("le losange suit le dessin et non une liste écrite à la main", () => {
    // Le dessin retourné de gauche à droite donne le losange retourné. Une
    // table recopiée ne bougerait pas.
    const mirrored: PadMap = {
      ...XBOX_360,
      parts: XBOX_360.parts.map((part) => ({
        ...part,
        x: 100 - part.x,
        d: part.d && mirrorX(part.d),
      })),
    };
    expect(diamondOf(mirrored)).toEqual({ top: "Y", left: "B", right: "X", bottom: "A" });
    const broken: PadMap = {
      ...XBOX_360,
      parts: XBOX_360.parts.filter((part) => part.key !== "B"),
    };
    expect(() => diamondOf(broken)).toThrow(/B/);
  });

  it("GameCube: la grille tactile garde les places du dessin autour du gros A", () => {
    const at = (key: string) => {
      const part = GAMECUBE.parts.find((one) => one.key === key);
      if (!part) throw new Error(key);
      return part;
    };
    const cells = cellsOf(DOLPHIN_FACE);
    // Y au-dessus de A, X à sa droite, B à sa gauche et plus bas: sur le
    // dessin, et sur la grille.
    expect(at("Y").y).toBeLessThan(at("A").y);
    expect(cells.Y?.row).toBeLessThan(cells.A?.row ?? -1);
    expect(at("X").x).toBeGreaterThan(at("A").x);
    expect(cells.X?.col).toBeGreaterThan(cells.A?.col ?? 9);
    expect(at("B").x).toBeLessThan(at("A").x);
    expect(at("B").y).toBeGreaterThan(at("A").y);
    expect(cells.B?.col).toBeLessThan(cells.A?.col ?? -1);
    expect(cells.B?.row).toBeGreaterThan(cells.A?.row ?? 9);
  });
});

describe("le nom de l'appareil d'une fiche", () => {
  it("nomme la manette Pro selon la salle", () => {
    expect(deviceLabel(4, "switch")).toBe("manette Pro");
    expect(deviceLabel(4, "switch2")).toBe("manette Pro");
    expect(deviceLabel(4, "x360")).toBe("manette Xbox 360");
    expect(deviceLabel(0, "gc")).toBe("manette GameCube");
    expect(deviceLabel(1, "wii")).toBe("Wiimote et Nunchuk");
  });

  it("ne retombe jamais sur la GameCube pour un code que la salle ne connaît pas", () => {
    expect(deviceLabel(4, "gc")).toBeNull();
    expect(deviceLabel(0, "switch")).toBeNull();
    expect(deviceLabel(7, "wii")).toBeNull();
    expect(deviceLabel(4, "?")).toBeNull();
  });
});

describe("la croix d'un seul bloc", () => {
  const centre = { x: 50, y: 50 };
  const at = (degrees: number, reach = 40) => ({
    x: 50 + reach * Math.cos((degrees * Math.PI) / 180),
    y: 50 - reach * Math.sin((degrees * Math.PI) / 180),
  });
  const held = (degrees: number, reach?: number) => {
    const got = crossFrom(centre, at(degrees, reach), 50);
    return (Object.keys(got) as (keyof typeof got)[]).filter((one) => got[one]).sort();
  };

  it("une direction franche ne donne qu'elle", () => {
    expect(held(0)).toEqual(["right"]);
    expect(held(90)).toEqual(["up"]);
    expect(held(180)).toEqual(["left"]);
    expect(held(-90)).toEqual(["down"]);
    expect(held(25)).toEqual(["right"]);
  });

  it("une diagonale franche en donne deux, et le centre aucune", () => {
    expect(held(45)).toEqual(["right", "up"]);
    expect(held(-135)).toEqual(["down", "left"]);
    expect(held(45, 5)).toEqual([]);
    // Hors du bloc, le doigt gardé par la capture continue de diriger.
    expect(held(90, 200)).toEqual(["up"]);
  });
});

/* ------------------------------------------------------------------------ */

/** Ce qui est faux dans une pose, dit en mots. Vide quand tout va bien. */
function faults(pieces: Piece<string>[], box: { width: number; height: number }): string[] {
  const bad: string[] = [];
  const name = (piece: Piece<string>) =>
    piece.kind === "touche"
      ? piece.touche.key
      : piece.kind === "geste"
        ? piece.geste
        : piece.kind === "stick"
          ? `stick-${piece.side}`
          : "croix";
  const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const games = pieces.filter((piece) => piece.kind !== "geste");
  const pages = pieces.filter((piece) => piece.kind === "geste");
  for (const piece of pieces) {
    const r = piece.rect;
    if (Math.min(r.w, r.h) < SIZES.FLOOR) bad.push(`${name(piece)} fait ${r.w}x${r.h}`);
    if (r.x < 0 || r.y < 0 || r.x + r.w > box.width || r.y + r.h > box.height)
      bad.push(`${name(piece)} sort de l'écran`);
  }
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i];
      const b = pieces[j];
      if (a && b && overlap(a.rect, b.rect)) bad.push(`${name(a)} recouvre ${name(b)}`);
    }
  }
  for (const page of pages) {
    for (const game of games) {
      const gap = gapBetween(page.rect, game.rect);
      if (gap < 12) bad.push(`${name(page)} à ${gap.toFixed(1)} px de ${name(game)}`);
    }
  }
  return bad;
}

/** Les bandes noires que la salle calculerait pour cette image. */
function bandsFor(
  box: { width: number; height: number },
  picture: { width: number; height: number },
) {
  const bar = Math.max(0, (box.width - place("remplir", picture, box).width) / 2);
  return { left: bar, right: bar };
}

const PICTURES = [
  { width: 640, height: 480 },
  { width: 854, height: 480 },
  { width: 1280, height: 720 },
  { width: 1280, height: 960 },
];

/**
 * Les boîtes que la manette doit tenir, et pourquoi ces bornes.
 *
 * - 260 px sur le petit côté : un téléphone de 568 sur 320 tenu en travers,
 *   barres du navigateur affichées, en garde à peu près 260 (relevé de la
 *   revue du 22 novembre 2026, 700 sur 260, où START tombait sur Y).
 * - 280 px de large en portrait : l'écran extérieur d'un Galaxy Fold, 280 sur
 *   653, où L tombait sur R le même jour.
 * - 560 px sur le grand côté : le plus petit téléphone en fait 568.
 * - 2,8 pour 1 au plus : 844 sur 390 avec la barre d'onglets de Safari donne
 *   environ 844 sur 300, soit 2,81. Au-delà, ce n'est plus un écran qu'on
 *   tient.
 */
const GRID: [number, number][] = [];
for (let width = 260; width <= 1440; width += 31) {
  for (let height = 260; height <= 1440; height += 29) {
    const short = Math.min(width, height);
    const long = Math.max(width, height);
    if (short >= 260 && long >= 560 && long / short <= 2.82) GRID.push([width, height]);
  }
}
const GRID_SIZES = 1267;

/** Des écrans réels, avec et sans les barres du navigateur. */
const REAL: [number, number][] = [
  [320, 568],
  [568, 320],
  [568, 260],
  [360, 640],
  [640, 360],
  [640, 280],
  [360, 740],
  [740, 360],
  [740, 300],
  [360, 800],
  [800, 360],
  [800, 320],
  [375, 667],
  [667, 375],
  [667, 325],
  [375, 553],
  [390, 664],
  [375, 812],
  [812, 375],
  [812, 300],
  [390, 844],
  [844, 390],
  [844, 340],
  [844, 300],
  [393, 852],
  [852, 393],
  [412, 915],
  [915, 412],
  [414, 896],
  [896, 414],
  [430, 932],
  [932, 430],
  [932, 380],
  [430, 740],
  [732, 338],
  [700, 260],
  [280, 653],
  [653, 280],
  [300, 600],
  [768, 1024],
  [1024, 768],
  [820, 1180],
  [1180, 820],
  [1024, 1366],
  [1366, 1024],
  [600, 960],
  [960, 600],
  [507, 1024],
  [694, 1024],
  [438, 1180],
];

describe("la place des touches", () => {
  it("la vérification voit une pose fautive", () => {
    // Le jumeau négatif de la vérification: la faute exacte du 22 novembre
    // 2026, un geste de page (« cacher », ce jour-là) posé sur R, doit être
    // nommée.
    const { pieces } = placePad(DOLPHIN_FACE, { width: 390, height: 844 }, { left: 0, right: 0 });
    const r = pieces.find((piece) => piece.kind === "touche" && piece.touche.key === "R");
    const page = pieces.find((piece) => piece.kind === "geste" && piece.geste === "feuille");
    if (!r || !page) throw new Error("R ou « ••• » manque à la pose");
    const moved = pieces.map((piece) =>
      piece === page ? { ...page, rect: { ...r.rect } } : piece,
    );
    expect(faults(moved, { width: 390, height: 844 })).toContain("R recouvre feuille");
    expect(faults(pieces, { width: 390, height: 844 })).toEqual([]);
  });

  it("à toutes les tailles d'écran prises en charge, rien ne se recouvre et les gestes restent à distance", () => {
    const failures: string[] = [];
    let cases = 0;
    for (const face of [DOLPHIN_FACE, SWITCH_FACE, XBOX_FACE]) {
      for (const [width, height] of GRID) {
        for (const picture of PICTURES) {
          const box = { width, height };
          const pose = placePad<string>(face, box, bandsFor(box, picture));
          // L'oracle indépendant d'abord, puis l'accord de la pose avec lui:
          // une pose qui se dirait dégradée sans faute, ou l'inverse, est fausse.
          const found = faults(pose.pieces, box);
          if (pose.degraded !== null) found.push(`pose dégradée: ${pose.degraded}`);
          cases += 1;
          if (found.length)
            failures.push(
              `${face.title} ${width}x${height} ${picture.width}x${picture.height}: ${found[0]}`,
            );
        }
      }
    }
    // Le compte exact : une grille qui rétrécirait en silence passerait encore.
    expect(GRID.length).toBe(GRID_SIZES);
    expect(cases).toBe(GRID_SIZES * 3 * PICTURES.length);
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("aux tailles d'écrans réels, barres du navigateur comprises, rien ne se recouvre", () => {
    const failures: string[] = [];
    for (const face of [DOLPHIN_FACE, SWITCH_FACE, XBOX_FACE]) {
      for (const [width, height] of REAL) {
        for (const picture of PICTURES) {
          const box = { width, height };
          const pose = placePad<string>(face, box, bandsFor(box, picture));
          const found = faults(pose.pieces, box);
          if (pose.degraded !== null) found.push(`pose dégradée: ${pose.degraded}`);
          if (found.length)
            failures.push(
              `${face.title} ${width}x${height} ${picture.width}x${picture.height}: ${found[0]}`,
            );
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("en paysage avec de larges bandes, la GameCube joue dans le noir, gestes de page compris", () => {
    // Les gestes aussi : le pilote `touch.mjs` compte « #touchpad button », et
    // la première version du 22 novembre 2026 posait son, menu et cacher en haut
    // au milieu de l'image alors que les bandes étaient libres.
    for (const box of [
      { width: 844, height: 390 },
      { width: 932, height: 430 },
      { width: 812, height: 375 },
    ]) {
      const bands = bandsFor(box, { width: 640, height: 480 });
      // La précondition, affirmée: sans bande, l'essai ne dirait rien.
      expect(bands.left).toBeGreaterThan(150);
      const picture = { x: bands.left, w: box.width - 2 * bands.left };
      const { pieces } = placePad(DOLPHIN_FACE, box, bands);
      expect(pieces.filter((piece) => piece.kind === "geste")).toHaveLength(1);
      const onPicture = pieces.filter(
        (piece) => piece.rect.x < picture.x + picture.w && picture.x < piece.rect.x + piece.rect.w,
      );
      expect(
        onPicture.map((piece) => (piece.kind === "geste" ? piece.geste : piece.kind)),
        `${box.width}x${box.height}`,
      ).toEqual([]);
    }
  });

  it("un groupe qui tient dans sa bande s'y range, celui qui ne tient pas se colle au bord", () => {
    // 16:9 sur un téléphone tenu en travers: 76 px de bande. Aucun groupe Pro
    // n'y tient, donc chacun se colle au bord pour mordre le moins possible.
    const box = { width: 844, height: 390 };
    const bands = bandsFor(box, { width: 1280, height: 720 });
    expect(bands.left).toBeGreaterThan(70);
    expect(bands.left).toBeLessThan(80);
    const { pieces } = placePad(SWITCH_FACE, box, bands);
    const stick = pieces.find((piece) => piece.kind === "stick" && piece.side === "l");
    expect(stick?.rect.x).toBe(SIZES.MARGIN);
    // Et avec une bande assez large, le même stick s'y centre.
    const wide = placePad(SWITCH_FACE, box, { left: 200, right: 200 }).pieces;
    const centred = wide.find((piece) => piece.kind === "stick" && piece.side === "l");
    expect(centred && centred.rect.x + centred.rect.w / 2).toBe(100);
  });

  it("une boîte trop petite donne une pose dégradée qui dit sa faute", () => {
    // 240 sur 240: aucune des trois faces n'y tient. La pose est rendue quand
    // même, et elle le dit, au lieu de choisir en silence la moins mauvaise.
    for (const face of [DOLPHIN_FACE, SWITCH_FACE, XBOX_FACE]) {
      const box = { width: 240, height: 240 };
      const pose = placePad<string>(face, box, { left: 0, right: 0 });
      // La faute des TOUCHES, pas celle des gestes: c'est elle qui compte ici.
      expect(pose.degraded, face.title).toMatch(/recouvre|touche [A-Z]|sort de l'écran/);
      expect(faults(pose.pieces, box).length, face.title).toBeGreaterThan(0);
      expect(pose.pieces.filter((piece) => piece.kind === "geste")).toHaveLength(1);
    }
    // Le jumeau: une taille ordinaire n'est pas dégradée.
    expect(
      placePad(SWITCH_FACE, { width: 390, height: 844 }, { left: 0, right: 0 }).degraded,
    ).toBeNull();
  });

  it("à 280 px de large, les palettes s'arrondissent et les sticks gardent leur taille", () => {
    // L'écran extérieur d'un Galaxy Fold: ZL L et R ZR, en palettes de 66 px,
    // se recouvraient au milieu (revue du 22 novembre 2026). Les palettes
    // deviennent rondes; les sticks, eux, n'ont aucune raison de rétrécir.
    const box = { width: 280, height: 653 };
    const { pieces, degraded } = placePad(SWITCH_FACE, box, { left: 0, right: 0 });
    expect(degraded).toBeNull();
    const width = (key: string) =>
      pieces.find((piece) => piece.kind === "touche" && piece.touche.key === key)?.rect.w;
    expect(width("L")).toBe(unitsFor(box).key);
    const stick = pieces.find((piece) => piece.kind === "stick" && piece.side === "l");
    expect(stick?.rect.w).toBe(unitsFor(box).stick);
    // Le jumeau: là où la place suffit, la palette reste une palette.
    const wide = placePad(SWITCH_FACE, { width: 390, height: 844 }, { left: 0, right: 0 });
    expect(
      wide.pieces.find((piece) => piece.kind === "touche" && piece.touche.key === "L")?.rect.w,
    ).toBe(66);
  });

  it("sous 276 px de large, le stick GameCube rétrécit juste assez pour laisser les boutons", () => {
    // 270 demande 92 px, 260 demande 80: deux tailles, pour qu'un repli tout
    // fait sur le plancher ne passe pas pour une recherche.
    for (const width of [260, 270]) {
      const box = { width, height: 600 };
      const { pieces, degraded } = placePad(DOLPHIN_FACE, box, { left: 0, right: 0 });
      expect(degraded).toBeNull();
      const stick = pieces.find((piece) => piece.kind === "stick");
      const b = pieces.find((piece) => piece.kind === "touche" && piece.touche.key === "B");
      if (!stick || !b) throw new Error("stick ou B manque à la pose");
      expect(stick.rect.w, `${width}`).toBeLessThan(unitsFor(box).stick);
      expect(stick.rect.w, `${width}`).toBeGreaterThanOrEqual(SIZES.STICK_FLOOR);
      const gap = gapBetween(stick.rect, b.rect);
      expect(gap, `${width}`).toBeGreaterThanOrEqual(SIZES.KEY_GAP);
      // Et pas plus qu'il ne faut: quatre pixels de stick en plus le collent
      // aux boutons.
      expect(gap, `${width}`).toBeLessThan(SIZES.KEY_GAP + 4);
    }
  });

  it("des gestes de page qui ne trouvent pas leur place le disent", () => {
    // 568 sur 260, la Switch: les touches tiennent, et la première version
    // posait alors les gestes à 6 px de L, sans rien dire. Dans une boîte où
    // les touches tiennent mais pas les gestes, la faute doit les nommer.
    // 256 sur 376 depuis que le seul « ••• » reste (22 novembre 2026): la boîte
    // de 330 sur 330 qui refusait trois gestes en tient un. Trouvée par un
    // balayage de 200 à 1200 px, où elle fait partie des 534 cas de ce genre.
    const box = { width: 256, height: 376 };
    const pose = placePad<string>(SWITCH_FACE, box, { left: 0, right: 0 });
    const games = pose.pieces.filter((piece) => piece.kind !== "geste");
    // La précondition: les touches de jeu, seules, ne se recouvrent pas.
    expect(faults(games, box)).toEqual([]);
    expect(pose.degraded).toMatch(/gestes de page sont à [0-9.]+ px d'une touche, 16 demandés/);
  });
});

describe("les inscriptions des touches Pro", () => {
  it("chaque inscription est le début du nom du configurateur, sauf les clics de stick", () => {
    for (const face of [SWITCH_FACE, XBOX_FACE]) {
      let compared = 0;
      for (const [key, one] of keysOf(face)) {
        const name = face.names[key];
        if (name === undefined) throw new Error(`${face.title}: ${key} n'a pas de nom`);
        if (key === "LS" || key === "RS") continue;
        expect(one.label, `${face.title} ${key}`).toBe(inscription(name));
        compared += 1;
      }
      // Les huit touches des rangées sans les deux clics, et les quatre boutons.
      expect(compared, face.title).toBe(10);
    }
    expect(inscription("LB · bouton d'épaule gauche")).toBe("LB");
    expect(inscription("Back")).toBe("Back");
  });

  it("les clics de stick ont une inscription courte, propre à chaque manette", () => {
    const at = (face: Face, key: string) => keysOf(face).get(key)?.label;
    expect([at(SWITCH_FACE, "LS"), at(SWITCH_FACE, "RS")]).toEqual(["L3", "R3"]);
    expect([at(XBOX_FACE, "LS"), at(XBOX_FACE, "RS")]).toEqual(["LS", "RS"]);
  });

  it("aucune inscription ne dépasse cinq caractères", () => {
    // Le garde-fou de la dérivation: un nom sans « · » serait écrit en entier
    // sur une touche de 44 px. « Start » en fait cinq.
    for (const face of [DOLPHIN_FACE, SWITCH_FACE, XBOX_FACE])
      for (const [key, one] of keysOf(face))
        expect(one.label.length, `${face.title} ${key}`).toBeLessThanOrEqual(5);
  });
});

describe("la place qu'une manette demande au cadre", () => {
  const FACES_TENUES = [DOLPHIN_FACE, SWITCH_FACE, XBOX_FACE] as const;
  const dans = (b: number, W: number) => (r: { x: number; w: number }) =>
    r.x + r.w <= b || r.x >= W - b;

  it("tenue droite, la hauteur rendue tient toute la pose, geste compris, de 320 à 1024 px", () => {
    let vus = 0;
    for (const face of FACES_TENUES) {
      const { hauteur } = encombrement(face);
      for (let w = 320; w <= 1024; w += 8) {
        const h = hauteur(w);
        if (h === null) throw new Error(`${face.title} : rien ne tient à ${w} px de large`);
        const pose = placePad(face, { width: w, height: h }, { left: 0, right: 0 });
        expect(pose.degraded, `${face.title} ${w}×${h}`).toBeNull();
        // La plus petite : 4 px de moins, et la pose fait une faute. Sans ce
        // jumeau, rendre 900 partout passerait.
        const moins = placePad(face, { width: w, height: h - 4 }, { left: 0, right: 0 });
        expect(moins.degraded, `${face.title} ${w}×${h - 4}`).not.toBeNull();
        vus += 1;
      }
    }
    expect(vus).toBeGreaterThan(250);
  });

  it("en travers, la largeur rendue garde chaque pièce dans sa bande, et 2 px de moins non", () => {
    for (const face of FACES_TENUES) {
      const { largeur } = encombrement(face);
      for (let h = 200; h <= 900; h += 10) {
        const b = largeur(h);
        // Un téléphone tenu en travers, 320 px utiles sous la barre d'accueil,
        // tient toujours ses grappes ; plus bas, `null` le dit.
        if (b === null) {
          expect(h, `${face.title} : aucune grappe à ${h} px`).toBeLessThan(300);
          continue;
        }
        for (const W of [600, 844, 1366]) {
          if (W < 2 * b + 40) continue;
          const pose = placePad(face, { width: W, height: h }, { left: b, right: b }, [], true);
          expect(pose.degraded, `${face.title} h=${h} b=${b} W=${W}`).toBeNull();
          expect(pose.pieces.every((one) => dans(b, W)(one.rect))).toBe(true);
        }
        const W = 1366;
        const etroite = placePad(
          face,
          { width: W, height: h },
          { left: b - 2, right: b - 2 },
          [],
          true,
        );
        // Le jumeau mesure lui-même, sans croire la faute de la pose.
        const tient =
          etroite.degraded === null && etroite.pieces.every((one) => dans(b - 2, W)(one.rect));
        expect(tient, `${face.title} h=${h} : ${b - 2} px suffisaient`).toBe(false);
      }
    }
  });

  it("donne aux quatre boutons de la GameCube les 148 px du plancher, plus 4 de chaque côté", () => {
    // La maquette du 22 novembre donnait 128 px aux grappes : B, Z et le geste
    // tombaient sur l'image à 844×390 (sonde du 23 novembre 2026).
    expect(encombrement(DOLPHIN_FACE).largeur(374)).toBe(156);
  });

  it("donne la même place à la manette Switch et à celle de la Xbox 360", () => {
    const sw = encombrement(SWITCH_FACE);
    const xb = encombrement(XBOX_FACE);
    for (let w = 320; w <= 1024; w += 32) expect(xb.hauteur(w)).toBe(sw.hauteur(w));
    expect(sw.hauteur(390)).not.toBeNull();
    for (let h = 200; h <= 900; h += 50) expect(xb.largeur(h)).toBe(sw.largeur(h));
  });

  it("rétrécit les sticks pour rester dans les bandes quand on le lui demande", () => {
    // 361 px : un iPhone de 390 tenu en travers, sans sa barre d'accueil.
    const box = { width: 844, height: 353 };
    const bands = { left: 160, right: 160 };
    const libre = placePad(SWITCH_FACE, box, bands, []);
    const tenue = placePad(SWITCH_FACE, box, bands, [], true);
    const dehors = (pose: typeof libre) =>
      pose.pieces.filter((one) => !dans(160, 844)(one.rect)).length;
    expect(dehors(libre)).toBeGreaterThan(0);
    expect(tenue.degraded).toBeNull();
    expect(dehors(tenue)).toBe(0);
  });

  it("ne pose aucun geste quand la liste est vide, et le geste de la salle sinon", () => {
    const box = { width: 390, height: 300 };
    const sans = placePad(SWITCH_FACE, box, { left: 0, right: 0 }, []);
    const avec = placePad(SWITCH_FACE, box, { left: 0, right: 0 }, ["feuille"]);
    expect(sans.pieces.filter((one) => one.kind === "geste")).toHaveLength(0);
    expect(avec.pieces.filter((one) => one.kind === "geste")).toHaveLength(1);
  });
});
