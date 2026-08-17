/**
 * Le relevé du navigateur, et les deux façons dont il pourrait mentir.
 *
 * Un relevé est le genre de code qui a l'air trop simple pour se tromper, et qui
 * se trompe exactement là où on ne regarde pas: à la remise à zéro des compteurs
 * et à la première fenêtre. Les deux ont leur test.
 */
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../media/session";
import { vitals, worthWriting } from "./vitals";

/** Un instantané complet, dont chaque test ne change que ce qui l'intéresse. */
function snap(video: Partial<Snapshot["video"]> = {}, rest: Partial<Snapshot> = {}): Snapshot {
  return {
    video: {
      painted: 0,
      shown: 0,
      undecoded: 0,
      stalls: 0,
      restarts: 0,
      keyFramesAsked: 0,
      slackMs: 0,
      starved: 0,
      skipped: 0,
      connected: true,
      reconnects: 0,
      heldRefreshes: { p05: 4, p50: 4, p95: 4 },
      waitMs: { p50: 0, p95: 0 },
      gapMs: { p50: 16, p95: 17, max: 20 },
      jitterMs: 0,
      room: 8,
      picture: { width: 1216, height: 896 },
      half: false,
      sourceHz: 60,
      refreshHz: 240,
      backlog: 2,
      fastestLag: 12,
      addedMs: 0,
      ...video,
    },
    sound: {
      state: "running",
      chunks: 0,
      gaps: 0,
      playedSeconds: 0,
      leadMs: 90,
      sampleRate: 48000,
      outputMs: 10,
      browserMs: 20,
      fastestLag: 8,
      ...rest.sound,
    },
    input: {
      port: 1,
      watching: false,
      refused: false,
      sent: 0,
      padId: null,
      padLayout: null,
      learning: null,
      pressed: [],
      displaced: false,
      players: 4,
      busy: [true, false, false, false],
      capturing: null,
      profile: null,
      keys: {} as Snapshot["input"]["keys"],
      pads: [],
      using: null,
      ...rest.input,
    },
    soundGapMs: null,
  };
}

describe("le relevé d'une fenêtre", () => {
  it("compte ce qui s'est passé PENDANT la fenêtre, pas depuis l'ouverture", () => {
    const before = snap({ shown: 41_230, painted: 41_180, skipped: 50 });
    const now = snap({ shown: 41_830, painted: 41_778, skipped: 52 });

    const sample = vitals(now, before, 10_000);

    expect(sample.vues).toBe(600);
    expect(sample.peintes).toBe(598);
    expect(sample.jetées).toBe(2);
    expect(sample.s).toBe(10);
  });

  it("prend les totaux quand c'est la première fenêtre", () => {
    // Le jumeau du précédent: sans lui, un relevé qui rendrait toujours zéro
    // faute de comparaison satisferait le test d'au-dessus.
    const sample = vitals(snap({ shown: 600, painted: 598 }), null, 10_000);

    expect(sample.vues).toBe(600);
    expect(sample.peintes).toBe(598);
  });

  it("ne rend jamais un écart négatif quand les compteurs repartent de zéro", () => {
    // Ce qui arrive à chaque changement de jeu et à chaque coupure: le flux se
    // rouvre et la page recompte. Une fenêtre qui enjambe la reprise annoncerait
    // « moins quarante mille images peintes », et un chiffre absurde est un
    // journal qu'on cesse de croire.
    const before = snap({ shown: 41_230, painted: 41_180 });
    const now = snap({ shown: 12, painted: 11, reconnects: 1 });

    const sample = vitals(now, before, 10_000);

    expect(sample.vues).toBe(0);
    expect(sample.peintes).toBe(0);
    expect(sample.rouvertes).toBe(1);
  });

  it("prend les jauges telles quelles, parce que ce sont des états", () => {
    const sample = vitals(
      snap({ jitterMs: 47.4, addedMs: 180, room: 14, backlog: 9, half: true }),
      snap({ jitterMs: 0, addedMs: 0, room: 8, backlog: 2 }),
      10_000,
    );

    expect(sample.gigue).toBe(47);
    expect(sample.horaire).toBe(180);
    expect(sample.file).toBe(14);
    expect(sample.encours).toBe(9);
    expect(sample.demi).toBe(true);
  });

  it("dit le format que le DÉCODEUR a produit", () => {
    // Et pas celui qu'on a demandé: c'est la seule mesure qui ne peut pas
    // mentir sur ce qui arrive vraiment chez quelqu'un.
    const sample = vitals(snap({ picture: { width: 608, height: 448 }, half: true }), null, 10_000);

    expect(sample.format).toBe("608x448");
  });

  it("dit zéro de retard sur une liaison qui n'en demande pas", () => {
    // Le jumeau du précédent, et la raison pour laquelle ce champ a changé: la
    // page publiait son ANCRE, un instant pris sur l'horloge du worker, dont
    // celle du navigateur est décalée. Une séance saine s'écrivait
    // « horaire -15268 ms », ce qui n'a jamais voulu dire quoi que ce soit.
    expect(vitals(snap({ addedMs: 0 }), null, 10_000).horaire).toBe(0);
  });
});

describe("ce qui mérite d'être écrit", () => {
  it("écrit une fenêtre saine, parce que savoir que tout allait bien date un problème", () => {
    expect(worthWriting(vitals(snap({ shown: 600, painted: 600 }), null, 10_000))).toBe(true);
  });

  it("n'écrit pas une fenêtre sans une seule image", () => {
    // Un onglet en arrière-plan produit six relevés vides par minute, qui
    // noieraient les vrais dans un journal gardé deux jours.
    expect(worthWriting(vitals(snap(), null, 10_000))).toBe(false);
  });
});
