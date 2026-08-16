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
import { BUTTON, readPad, type PadProfile } from "./pad";

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

  // `toBeCloseTo` et non `toEqual`: un axe inversé rend -0, que `Object.is`
  // distingue de 0 alors que rien en aval ne le fait. L'octet envoyé est le
  // même, et une assertion qui échouerait là-dessus décrirait JavaScript plutôt
  // que la manette.
  it("un stick au repos ne bouge pas", () => {
    const read = readPad(pad(Array(17).fill(0), [0.1, 0.1, 0.1, 0.1]), null);
    for (const value of [read.x, read.y, read.cx, read.cy]) expect(value).toBeCloseTo(0, 10);
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
});
