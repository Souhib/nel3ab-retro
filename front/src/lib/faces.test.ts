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
  missingFaces,
  placePad,
  type Face,
  type Piece,
  type Rect,
} from "./faces";
import { place } from "./fit";
import { GAMECUBE, SWITCH_PRO, XBOX_360, mirrorX, type PadMap } from "./padmap";
import { labels as switchLabels, xboxLabels } from "./switch-labels";

/** Les touches simples d'une face, par nom de trame. */
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
    // Une seule source pour le pavé et le configurateur: `xboxLabels`.
    for (const [key, one] of keys)
      if (one.spoken) expect(one.spoken, key).toBe(xboxLabels[key as "A"]);
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
    for (const [key, one] of keys)
      if (one.spoken) expect(one.spoken, key).toBe(switchLabels[key as "A"]);
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
];

describe("la place des touches", () => {
  it("la vérification voit une pose fautive", () => {
    // Le jumeau négatif de la vérification: la faute exacte du 22 novembre
    // 2026, « cacher » posé sur R, doit être nommée.
    const pieces = placePad(DOLPHIN_FACE, { width: 390, height: 844 }, { left: 0, right: 0 });
    const r = pieces.find((piece) => piece.kind === "touche" && piece.touche.key === "R");
    const hide = pieces.find((piece) => piece.kind === "geste" && piece.geste === "cacher");
    if (!r || !hide) throw new Error("R ou « cacher » manque à la pose");
    const moved = pieces.map((piece) =>
      piece === hide ? { ...hide, rect: { ...r.rect } } : piece,
    );
    expect(faults(moved, { width: 390, height: 844 })).toContain("R recouvre cacher");
    expect(faults(pieces, { width: 390, height: 844 })).toEqual([]);
  });

  it("à toutes les tailles d'écran, rien ne se recouvre et les gestes restent à distance", () => {
    const failures: string[] = [];
    let cases = 0;
    for (const face of [DOLPHIN_FACE, SWITCH_FACE, XBOX_FACE]) {
      for (let width = 320; width <= 1440; width += 31) {
        for (let height = 320; height <= 1440; height += 29) {
          // Au-delà de 2,4 pour 1, ce n'est plus un écran qu'on tient. Sous
          // 480 px sur le plus grand côté non plus: le plus petit téléphone en
          // fait 568, et un pavé Pro de dix-huit touches de 44 px ne tient pas
          // dans 444 sur 320 (mesuré le 22 novembre 2026, ce n'est pas visé).
          const ratio = Math.max(width, height) / Math.min(width, height);
          if (ratio > 2.4 || Math.max(width, height) < 480) continue;
          for (const picture of PICTURES) {
            const box = { width, height };
            const found = faults(placePad<string>(face, box, bandsFor(box, picture)), box);
            cases += 1;
            if (found.length)
              failures.push(
                `${face.title} ${width}x${height} ${picture.width}x${picture.height}: ${found[0]}`,
              );
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(2000);
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("en paysage avec de larges bandes, la GameCube joue dans le noir", () => {
    for (const box of [
      { width: 844, height: 390 },
      { width: 932, height: 430 },
      { width: 812, height: 375 },
    ]) {
      const bands = bandsFor(box, { width: 640, height: 480 });
      // La précondition, affirmée: sans bande, l'essai ne dirait rien.
      expect(bands.left).toBeGreaterThan(150);
      const picture = { x: bands.left, w: box.width - 2 * bands.left };
      const onPicture = placePad(DOLPHIN_FACE, box, bands)
        .filter((piece) => piece.kind !== "geste")
        .filter(
          (piece) =>
            piece.rect.x < picture.x + picture.w && picture.x < piece.rect.x + piece.rect.w,
        );
      expect(
        onPicture.map((piece) => piece.kind),
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
    const pieces = placePad(SWITCH_FACE, box, bands);
    const stick = pieces.find((piece) => piece.kind === "stick" && piece.side === "l");
    expect(stick?.rect.x).toBe(SIZES.MARGIN);
    // Et avec une bande assez large, le même stick s'y centre.
    const wide = placePad(SWITCH_FACE, box, { left: 200, right: 200 });
    const centred = wide.find((piece) => piece.kind === "stick" && piece.side === "l");
    expect(centred && centred.rect.x + centred.rect.w / 2).toBe(100);
  });
});
