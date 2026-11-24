/** Les chiffres des mesures : comptés, datés, et absents tant qu'ils ne sont
 * pas mesurés (jamais une valeur de repli). */
import { describe, expect, it } from "vitest";
import type { Liaison } from "../media/liaison";
import type { VideoStats } from "../media/video";
import { cadence, chiffres, ECARTS_MIN, ligneDeLaLiaison } from "./mesures";

const video = (extra: Partial<{ sourceHz: number; paintedSince: number; p95: number }> = {}) => ({
  sourceHz: extra.sourceHz ?? 60,
  paintedSince: extra.paintedSince ?? 500,
  gapMs: { p50: 16, p95: extra.p95 ?? 33, max: 50 },
});

describe("cadence", () => {
  it("120 images peintes en 2,0 s font 60 par seconde", () => {
    expect(cadence({ a: 10_000, peintes: 400 }, { a: 12_000, peintes: 520 })).toBe(60);
  });

  it("jumeau : sans relevé d'avant, ou sur moins d'une seconde, rien", () => {
    expect(cadence(null, { a: 1, peintes: 1 })).toBeNull();
    expect(cadence({ a: 0, peintes: 0 }, { a: 999, peintes: 60 })).toBeNull();
  });

  it("jumeau : un compteur qui recule n'est pas une cadence négative", () => {
    expect(cadence({ a: 0, peintes: 100 }, { a: 2000, peintes: 10 })).toBeNull();
  });

  it("une image figée se compte zéro, mesuré", () => {
    expect(cadence({ a: 0, peintes: 100 }, { a: 2000, peintes: 100 })).toBe(0);
  });
});

describe("chiffres", () => {
  it("lit le jeu, l'aller-retour et l'écart au pire", () => {
    expect(chiffres(video(), 31.6, 60)).toEqual({
      peintes: 60,
      jeu: 60,
      allerRetour: 32,
      pire: 33,
      sousLeJeu: false,
    });
  });

  it("jumeau : un jeu pas encore mesuré est absent, jamais une cadence de repli ni un zéro", () => {
    const c = chiffres(video({ sourceHz: 0 }), null, 250);
    expect(c.jeu).toBeNull();
    expect(c.allerRetour).toBeNull();
    // Sans le jeu, rien ne se dit « moins que le jeu ».
    expect(c.sousLeJeu).toBe(false);
  });

  it("jumeau : un écart au pire sur moins de trente images est absent", () => {
    expect(chiffres(video({ paintedSince: ECARTS_MIN - 1, p95: 0 }), 20, 0).pire).toBeNull();
    expect(chiffres(video({ paintedSince: ECARTS_MIN, p95: 40 }), 20, 0).pire).toBe(40);
  });

  it("dit « moins que le jeu » sous 90 %, et pas à 90 %", () => {
    expect(chiffres(video({ sourceHz: 60 }), 20, 53).sousLeJeu).toBe(true);
    expect(chiffres(video({ sourceHz: 60 }), 20, 54).sousLeJeu).toBe(false);
  });
});

describe("la ligne de la liaison en clair", () => {
  const image = (v: Partial<VideoStats> = {}): VideoStats =>
    ({
      awaitingRestart: false,
      paintedSince: 5000,
      backlog: 0,
      overloaded: false,
      refreshHz: 60,
      sourceHz: 60,
      half: false,
      halfDenied: false,
      ...v,
    }) as VideoStats;

  it("dit « Tout arrive » quand rien ne manque", () => {
    expect(ligneDeLaLiaison({ etat: "ok" }, image())).toEqual({
      texte: "Tout arrive",
      bonne: true,
    });
  });

  it("dit « L'image saute », jamais par la couleur seule, sur une liaison irrégulière ou débordée", () => {
    expect(ligneDeLaLiaison({ etat: "irreguliere" }, image())).toEqual({
      texte: "L'image saute",
      bonne: false,
    });
    expect(ligneDeLaLiaison({ etat: "ok" }, image({ overloaded: true }))).toEqual({
      texte: "L'image saute",
      bonne: false,
    });
  });

  it("dit l'état de la liaison quand elle n'est pas en marche, avec sa majuscule", () => {
    expect(ligneDeLaLiaison({ etat: "fermee" } as Liaison, image())).toEqual({
      texte: "Salle fermée",
      bonne: false,
    });
  });

  it("ne dit pas « Tout arrive » quand l'écran affiche moins que le jeu, ni avant la première image", () => {
    expect(ligneDeLaLiaison({ etat: "ok" }, image({ refreshHz: 30, sourceHz: 60 })).bonne).toBe(
      false,
    );
    expect(ligneDeLaLiaison({ etat: "ok" }, image({ paintedSince: 0 })).texte).toBe(
      "Image en préparation",
    );
  });
});
