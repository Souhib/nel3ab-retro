import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLUMN, clampColumn, rememberColumn, storedColumn, widest } from "./column";

describe("les bornes de la colonne", () => {
  it("garde une largeur comprise entre les bornes", () => {
    expect(clampColumn(COLUMN.min)).toBe(COLUMN.min);
    expect(clampColumn(352)).toBe(352);
    expect(clampColumn(COLUMN.max)).toBe(COLUMN.max);
  });

  it("refuse de descendre sous la borne basse ou de dépasser la borne haute", () => {
    expect(clampColumn(COLUMN.min - 1)).toBe(COLUMN.min);
    expect(clampColumn(-500)).toBe(COLUMN.min);
    expect(clampColumn(COLUMN.max + 1)).toBe(COLUMN.max);
  });

  it("ne prend jamais plus de la moitié de la fenêtre", () => {
    expect(widest(800)).toBe(400);
    expect(clampColumn(480, 800)).toBe(400);
    // Le jumeau: une grande fenêtre ne relève pas la borne haute.
    expect(clampColumn(900, 2560)).toBe(COLUMN.max);
  });

  it("garde la borne basse même quand la moitié de la fenêtre est plus petite", () => {
    expect(clampColumn(300, 400)).toBe(COLUMN.min);
  });

  it("retombe sur la largeur d'origine devant autre chose qu'un nombre", () => {
    expect(clampColumn(Number.NaN)).toBe(COLUMN.normal);
  });
});

describe("la largeur retenue", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("vaut la largeur d'origine quand rien n'est retenu", () => {
    expect(storedColumn()).toBe(COLUMN.normal);
  });

  it("relit ce qui a été rangé, ramené entre les bornes", () => {
    rememberColumn(352);
    expect(storedColumn()).toBe(352);
    rememberColumn(10);
    expect(storedColumn()).toBe(COLUMN.min);
    localStorage.setItem("nel3ab:colonne", "9999");
    expect(storedColumn()).toBe(COLUMN.max);
  });

  it.each(["", "abc", "304px", "-300", "3.5"])(
    "ignore une valeur que la page n'écrit pas: %j",
    (raw) => {
      localStorage.setItem("nel3ab:colonne", raw);
      expect(storedColumn()).toBe(COLUMN.normal);
    },
  );

  it("survit à un navigateur qui refuse le stockage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("refusé");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("refusé");
    });
    expect(() => rememberColumn(352)).not.toThrow();
    expect(storedColumn()).toBe(COLUMN.normal);
  });
});
