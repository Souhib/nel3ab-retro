/**
 * Toute la manette, standard et profil appris.
 *
 * Ce fichier remplace un pilote de navigateur qui faisait exactement les mêmes
 * assertions à travers un vrai Chrome, un vrai worker et une vraie session. Ce
 * qu'il vérifie est une **fonction pure**: `readPad` prend ce que le navigateur
 * rapporte et rend ce que le protocole transporte. La faire passer par une page
 * ne prouvait rien de plus, coûtait vingt secondes, et demandait à la page
 * d'exposer une porte de test dont plus personne n'a besoin.
 */
import { describe, expect, it } from "vitest";
import {
  BUTTON,
  CONTROLS,
  controlsFor,
  DEFAULT_KEYS,
  readKeys,
  readPad,
  standardProfile,
  type PadProfile,
  merge,
  type PadReading,
} from "./pad";

/** Une manette synthétique. Ce qui est vérifié est la CORRESPONDANCE, et une
 * correspondance se trompe sur le bouton auquel personne n'a pensé. */
const pad = (buttons: number[], axes: number[], mapping = "standard", id = "test"): Gamepad =>
  ({
    buttons: buttons.map((value) => ({ pressed: value > 0.5, touched: value > 0, value })),
    axes,
    id,
    mapping,
  }) as unknown as Gamepad;

const only = (index: number, length = 17) =>
  Array.from({ length }, (_, slot) => (slot === index ? 1 : 0));

describe("une manette de disposition standard", () => {
  const EXPECTED: [number, keyof typeof BUTTON][] = [
    [0, "A"],
    [1, "B"],
    [2, "X"],
    [3, "Y"],
    [4, "L"],
    [5, "Z"],
    [9, "START"],
    [12, "D_UP"],
    [13, "D_DOWN"],
    [14, "D_LEFT"],
    [15, "D_RIGHT"],
  ];

  it.each(EXPECTED)("l'index %i est %s", (index, name) => {
    expect(readPad(pad(only(index), [0, 0, 0, 0]), null).buttons).toBe(BUTTON[name]);
  });

  // Le jumeau négatif de la table: sans lui, une correspondance qui allumerait
  // TOUS les bits passerait chaque ligne ci-dessus.
  it("ne rapporte aucun bouton quand rien n'est enfoncé", () => {
    expect(readPad(pad(Array(17).fill(0), [0, 0, 0, 0]), null).buttons).toBe(0);
  });

  it("la gâchette est analogique, et clique en fin de course", () => {
    const half = readPad(
      pad(
        only(6).map((v, i) => (i === 6 ? 0.5 : v)),
        [0, 0, 0, 0],
      ),
      null,
    );
    const full = readPad(pad(only(6), [0, 0, 0, 0]), null);
    expect(half.l).toBe(128);
    expect(half.buttons & BUTTON.L).toBe(0);
    expect(full.l).toBe(255);
    expect(full.buttons & BUTTON.L).not.toBe(0);
  });

  it("le haut est positif, et le stick C existe", () => {
    const read = readPad(pad(Array(17).fill(0), [0.5, -0.5, -0.25, 0.75]), null);
    expect(read.x).toBeCloseTo(0.5, 2);
    expect(read.y).toBeCloseTo(0.5, 2);
    expect(read.cx).toBeCloseTo(-0.25, 2);
    expect(read.cy).toBeCloseTo(-0.75, 2);
  });

  it("un stick au repos ne bouge pas", () => {
    const read = readPad(pad(Array(17).fill(0), [0.1, 0.1, 0.1, 0.1]), null);
    // `toEqual` distingue -0 de 0, et un axe inversé rendait -0. Le module le
    // ramène maintenant à 0 (voir `plainZero`), ce que cette ligne vérifie au
    // passage: sans ça la comparaison des deux façons de lire échouait.
    expect([read.x, read.y, read.cx, read.cy]).toEqual([0, 0, 0, 0]);
  });
});

/**
 * Une vraie manette GameCube sur adaptateur annonce une disposition INCONNUE:
 * ses boutons sont à des index à eux, ses gâchettes sont des AXES et non des
 * boutons, et un de ses sticks compte à l'envers. Le profil que la page apprend
 * doit lire les deux formes.
 */
describe("un profil appris", () => {
  const profile: PadProfile = {
    id: "adapter",
    buttons: {
      A: { button: 1 },
      B: { button: 2 },
      Z: { button: 7 },
      START: { button: 9 },
      D_UP: { button: 12 },
    },
    // Gâchette au repos -1, à fond +1: la mi-course est donc 0 sur l'axe.
    triggers: { L: { axis: 4, rest: -1, full: 1 }, R: { axis: 5, rest: -1, full: 1 } },
    sticks: {
      x: { axis: 0, sign: 1 },
      y: { axis: 1, sign: -1 },
      cx: { axis: 2, sign: 1 },
      cy: { axis: 3, sign: -1 },
    },
  };
  const none = Array(16).fill(0);
  const rest = [0, 0, 0, 0, -1, -1];
  const read = (buttons: number[], axes: number[]) =>
    readPad(pad(buttons, axes, "", "adapter"), profile);

  it.each([
    [1, "A"],
    [2, "B"],
    [7, "Z"],
    [9, "START"],
    [12, "D_UP"],
  ] as [number, keyof typeof BUTTON][])("l'index %i est %s", (index, name) => {
    expect(read(only(index, 16), rest).buttons).toBe(BUTTON[name]);
  });

  it("lit une gâchette posée sur un axe", () => {
    const half = read(none, [0, 0, 0, 0, 0, -1]);
    const full = read(none, [0, 0, 0, 0, 1, -1]);
    expect(half.l).toBe(128);
    expect(half.buttons & BUTTON.L).toBe(0);
    expect(full.l).toBe(255);
    expect(full.buttons & BUTTON.L).not.toBe(0);
  });

  it("respecte le signe d'un stick qui compte à l'envers", () => {
    const read2 = read(none, [0.5, -0.5, -0.25, 0.75, -1, -1]);
    expect(read2.x).toBeCloseTo(0.5, 2);
    expect(read2.y).toBeCloseTo(0.5, 2);
    expect(read2.cx).toBeCloseTo(-0.25, 2);
    expect(read2.cy).toBeCloseTo(-0.75, 2);
  });

  // Le repos est le piège de cette forme: un profil qui ignorerait `rest`
  // rapporterait 128 avec la main posée à côté, c'est-à-dire un frein tiré à
  // moitié pendant toute la partie.
  it("une gâchette au repos lit zéro, pas la moitié", () => {
    const idle = read(none, rest);
    expect([idle.l, idle.r, idle.buttons]).toEqual([0, 0, 0]);
  });

  // Le même piège, sur le stick, et c'est celui qui gâche une partie: un stick de
  // GameCube ne revient PAS à zéro. Sans repos, la page pousse le personnage dans
  // cette direction en permanence, et il court tout seul du début à la fin.
  it("un stick qui ne revient pas à zéro est quand même au repos", () => {
    const drifting: PadProfile = {
      ...profile,
      sticks: {
        x: { axis: 0, sign: 1, rest: 0.25 },
        y: { axis: 1, sign: -1, rest: -0.3 },
        cx: { axis: 2, sign: 1, rest: 0.4 },
        cy: { axis: 3, sign: -1, rest: 0 },
      },
    };
    const idle = readPad(pad(none, [0.25, -0.3, 0.4, 0], "", "adapter"), drifting);

    expect([idle.x, idle.y, idle.cx, idle.cy]).toEqual([0, 0, 0, 0]);
  });

  it("et il pousse encore quand on le pousse vraiment", () => {
    // Le jumeau: centrer sur le repos ne doit pas rendre le stick sourd, sinon on
    // aurait échangé un personnage qui court tout seul contre un qui ne bouge plus.
    const drifting: PadProfile = {
      ...profile,
      sticks: { ...profile.sticks, x: { axis: 0, sign: 1, rest: 0.25 } },
    };
    const pushed = readPad(pad(none, [1, 0, 0, 0], "", "adapter"), drifting);

    expect(pushed.x).toBeGreaterThan(0.9);
  });

  // Et le troisième endroit où le repos comptait: une commande posée sur un
  // BOUTON. Un adaptateur qui présente une gâchette ainsi lui donne une valeur
  // au repos, et rien ne la soustrayait: la page envoyait 89 sur 255 en
  // permanence, c'est-à-dire un frein tiré au tiers pendant tout le match.
  //
  // Le seuil compte ici: au-dessus de 0,5 de repos, il resterait moins de 0,5 de
  // course, et la leçon ne saurait plus apprendre la commande du tout. Le cas
  // qui existe vraiment est donc le repos PARTIEL, et c'est celui qu'on fixe.
  it("une gâchette posée sur un bouton lit zéro au repos, pas un tiers", () => {
    const partial: PadProfile = {
      ...profile,
      triggers: { ...profile.triggers, L: { button: 6, rest: 0.35 } },
    };
    const idle = [...none];
    idle[6] = 0.35;

    expect(readPad(pad(idle, rest, "", "adapter"), partial).l).toBe(0);
  });

  it("et elle va bien jusqu'au bout quand on l'écrase", () => {
    // Le jumeau: soustraire le repos ne doit pas raboter la course utile, sinon
    // la gâchette n'atteindrait jamais son clic de fin.
    const partial: PadProfile = {
      ...profile,
      triggers: { ...profile.triggers, L: { button: 6, rest: 0.35 } },
    };
    const held = [...none];
    held[6] = 1;
    const crushed = readPad(pad(held, rest, "", "adapter"), partial);

    expect(crushed.l).toBe(255);
    expect(crushed.buttons & BUTTON.L).not.toBe(0);
  });
});

/**
 * Rendre la disposition standard modifiable ne doit RIEN changer tant que
 * personne ne la modifie.
 *
 * C'est l'invariant qui rend le bouton « personnaliser » sans danger: le jour où
 * il matérialise la table, la manette doit se comporter exactement pareil. Sans
 * ce test, une case oubliée dans la matérialisation ne se verrait qu'à la
 * manette, sur le bouton auquel personne ne pense.
 */
describe("matérialiser la disposition standard", () => {
  const cases: [string, number[], number[]][] = [
    ["rien", Array(17).fill(0), [0, 0, 0, 0]],
    ["chaque bouton", Array.from({ length: 17 }, (_, i) => (i % 2 === 0 ? 1 : 0)), [0, 0, 0, 0]],
    ["l'autre moitié", Array.from({ length: 17 }, (_, i) => (i % 2 === 1 ? 1 : 0)), [0, 0, 0, 0]],
    [
      "les gâchettes à mi-course",
      Array.from({ length: 17 }, (_, i) => (i === 6 || i === 7 ? 0.5 : 0)),
      [0, 0, 0, 0],
    ],
    ["les sticks", Array(17).fill(0), [0.5, -0.5, -0.25, 0.75]],
    ["les sticks au repos", Array(17).fill(0), [0.1, -0.1, 0.05, -0.05]],
  ];

  it.each(cases)("donne la même lecture: %s", (_what, buttons, axes) => {
    const gamepad = pad(buttons, axes);
    expect(readPad(gamepad, standardProfile("test"))).toEqual(readPad(gamepad, null));
  });
});

describe("le clavier", () => {
  const held = (...codes: string[]) => new Set(codes);

  it("envoie ce que la disposition par défaut promet", () => {
    expect(readKeys(held("KeyX"), DEFAULT_KEYS).buttons).toBe(BUTTON.A);
    expect(readKeys(held("Enter"), DEFAULT_KEYS).buttons).toBe(BUTTON.START);
    expect(readKeys(held("ArrowUp"), DEFAULT_KEYS).y).toBe(1);
    expect(readKeys(held("ArrowLeft"), DEFAULT_KEYS).x).toBe(-1);
  });

  it("met une gâchette à fond, et le clic qui va avec", () => {
    const read = readKeys(held("KeyQ"), DEFAULT_KEYS);
    expect(read.l).toBe(255);
    // Une gâchette de GameCube clique en fin de course, et les jeux lisent ce
    // clic comme un bouton. Une touche n'ayant pas de demi-course, elle clique.
    expect(read.buttons & BUTTON.L).not.toBe(0);
    expect(read.r).toBe(0);
  });

  it("annule deux directions opposées, comme un stick qu'on ne pousse pas", () => {
    expect(readKeys(held("ArrowLeft", "ArrowRight"), DEFAULT_KEYS).x).toBe(0);
  });

  it("additionne plusieurs touches tenues ensemble", () => {
    const read = readKeys(held("KeyX", "KeyC", "ArrowUp"), DEFAULT_KEYS);
    expect(read.buttons).toBe(BUTTON.A | BUTTON.B);
    expect(read.y).toBe(1);
  });

  // Le jumeau négatif: sans lui, une lecture qui allumerait tout passerait les
  // quatre assertions du dessus.
  it("n'envoie rien quand rien n'est tenu", () => {
    expect(readKeys(held(), DEFAULT_KEYS)).toEqual({
      buttons: 0,
      x: 0,
      y: 0,
      cx: 0,
      cy: 0,
      l: 0,
      r: 0,
    });
  });

  it("ignore une touche qui n'est dans aucun profil", () => {
    expect(readKeys(held("KeyM"), DEFAULT_KEYS).buttons).toBe(0);
  });
});

describe("fondre deux lectures", () => {
  const at = (over: Partial<PadReading> = {}): PadReading => ({
    buttons: 0,
    x: 0,
    y: 0,
    cx: 0,
    cy: 0,
    l: 0,
    r: 0,
    ...over,
  });

  it("additionne les boutons des deux", () => {
    expect(merge(at({ buttons: 0b0011 }), at({ buttons: 0b0110 })).buttons).toBe(0b0111);
  });

  it("garde la gâchette la plus enfoncée", () => {
    expect(merge(at({ l: 0.2 }), at({ l: 0.9 })).l).toBe(0.9);
    expect(merge(at({ l: 0.9 }), at({ l: 0.2 })).l).toBe(0.9);
  });

  it("garde le stick le plus poussé, dans un sens comme dans l'autre", () => {
    expect(merge(at({ x: 0.1 }), at({ x: -1 })).x).toBe(-1);
    expect(merge(at({ x: -1 }), at({ x: 0.1 })).x).toBe(-1);
  });

  // Le jumeau qui explique le choix: « la première non nulle » ferait gagner
  // une manette au repos qui dérive d'un cheveu contre une qu'on pousse à fond.
  it("ne laisse pas une dérive minuscule battre une vraie poussée", () => {
    expect(merge(at({ y: 0.02 }), at({ y: 1 })).y).toBe(1);
  });

  it("rend l'autre lecture quand l'une ne dit rien", () => {
    const pushed = at({ buttons: 0b1000, x: 0.7, r: 0.5 });
    expect(merge(at(), pushed)).toEqual(pushed);
    expect(merge(pushed, at())).toEqual(pushed);
  });
});

describe("les commandes nommées pour ce qu'on tient", () => {
  it("garde les noms GameCube sur un jeu GameCube", () => {
    const said = controlsFor("gc", 2).map((one) => one.label);

    expect(said).toContain("A");
    expect(said).not.toContain("verte");
  });

  it("garde les noms GameCube quand on tient une manette GameCube sur un jeu Wii", () => {
    // Le worker écrit alors un fichier de manette GameCube: demander « le bouton
    // A de la Wiimote » à quelqu'un qui tient une manette GameCube serait faux.
    expect(controlsFor("wii", 0).map((one) => one.label)).toContain("A");
  });

  it("dit Wiimote et guitare avec des mots DIFFÉRENTS", () => {
    // Le jumeau qui compte: une fonction qui rendrait toujours la même table
    // passerait tous les essais positifs et laisserait la guitare sans ses
    // frettes. Ce qui est vérifié est que les trois profils se distinguent.
    const gc = controlsFor("wii", 0)
      .map((one) => one.label)
      .join(" ");
    const wii = controlsFor("wii", 1)
      .map((one) => one.label)
      .join(" ");
    const guitar = controlsFor("wii", 2)
      .map((one) => one.label)
      .join(" ");

    expect(new Set([gc, wii, guitar]).size).toBe(3);
    expect(wii).toContain("1");
    // La secousse a remplacé « moins ». Sans cette ligne, personne ne verrait
    // qu'un bouton a changé de sens, et on chercherait « moins » à l'écran.
    expect(wii).toContain("secouer");
    expect(wii).not.toContain("−");
    expect(guitar).toContain("verte");
  });

  it("nomme les cinq frettes et le grattage", () => {
    const said = controlsFor("wii", 2);
    const label = (key: string) => said.find((one) => one.key === key)?.label;

    expect([label("A"), label("B"), label("X"), label("Y"), label("Z")]).toEqual([
      "verte",
      "rouge",
      "jaune",
      "bleue",
      "orange",
    ]);
    expect(label("D_UP")).toBe("gratter ↑");
    expect(label("D_DOWN")).toBe("gratter ↓");
  });

  it("garde les seize commandes quoi qu'on tienne", () => {
    // Renommer ne doit rien perdre. Une table partielle mal appliquée
    // laisserait l'écran des touches avec des lignes en moins, donc des
    // commandes que personne ne peut plus assigner.
    for (const held of [0, 1, 2] as const) {
      expect(controlsFor("wii", held)).toHaveLength(CONTROLS.length);
      expect(controlsFor("wii", held).map((one) => one.key)).toEqual(
        CONTROLS.map((one) => one.key),
      );
    }
  });
});
