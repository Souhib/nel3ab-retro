import { describe, expect, it } from "vitest";

import { FLOOR, LEAD_MAX, LEAD_MIN, RESYNC, scheduleAt, trimmed } from "./sound";

describe("les bornes de l'avance", () => {
  it("laisse assez de marge pour un téléphone", () => {
    // Mesuré le 18 août 2026 sur un iPhone: l'avance montait à 378 ms avant que
    // le son ne sorte. Un plafond en dessous de ça coupe le son du téléphone
    // pour économiser une latence que personne n'entend.
    expect(LEAD_MAX).toBeGreaterThanOrEqual(0.3);
  });

  it("part quand même au plus bas", () => {
    // Le plafond est un secours, pas un réglage: une salle qui va bien tient
    // dix millisecondes, et démarrer haut coûterait à tout le monde le prix du
    // pire cas.
    expect(LEAD_MIN).toBeLessThanOrEqual(0.02);
    expect(LEAD_MIN).toBeLessThan(LEAD_MAX);
  });

  it("reste AU-DESSUS de l'avance maximale", () => {
    // La relation qui manquait le 18 août: avec `RESYNC` sous `LEAD_MAX`, un
    // flux qui atteint son plafond se trouve trop en avance à chaque morceau.
    expect(RESYNC).toBeGreaterThan(LEAD_MAX);
  });

  it("garde une marge, et pas seulement un cheveu", () => {
    expect(RESYNC - LEAD_MAX).toBeGreaterThanOrEqual(0.05);
  });
});

describe("où poser le morceau qui arrive", () => {
  it("laisse un morceau bien placé exactement où il est", () => {
    const placed = scheduleAt(10, 10 + LEAD_MIN, LEAD_MIN);

    expect(placed).toEqual({ playAt: 10 + LEAD_MIN, lead: LEAD_MIN, gap: false });
  });

  it("rattrape un morceau qui est déjà en retard", () => {
    // Sans ce rattrapage, le morceau serait demandé dans le passé, jouerait
    // immédiatement, et tous les suivants s'empileraient sur lui.
    const placed = scheduleAt(10, 10 - 0.5, LEAD_MIN);

    expect(placed.playAt).toBeGreaterThan(10);
    expect(placed.gap).toBe(true);
  });

  it("rattrape un morceau qui est trop en avance", () => {
    const placed = scheduleAt(10, 10 + RESYNC + 0.1, LEAD_MIN);

    expect(placed.playAt).toBeLessThan(10 + RESYNC);
    expect(placed.gap).toBe(true);
  });

  it("ne compte pas le tout premier morceau comme une cassure", () => {
    // `playAt` vaut zéro avant qu'on ait rien posé. Compter ce départ ferait
    // démarrer chaque séance avec un trou qui n'a pas eu lieu, et le compteur
    // de trous est ce qu'on regarde pour savoir si le son va mal.
    const placed = scheduleAt(10, 0, LEAD_MIN);

    expect(placed).toEqual({ playAt: 10 + LEAD_MIN, lead: LEAD_MIN, gap: false });
  });

  it("ne pousse jamais l'avance au-dessus de son plafond", () => {
    // Sans ce plafond, chaque cassure ajoute dix millisecondes pour toujours et
    // le son finit par arriver une seconde après l'image.
    let lead = LEAD_MAX;
    for (let round = 0; round < 100; round++) lead = scheduleAt(10, 10 - 1, lead).lead;

    expect(lead).toBe(LEAD_MAX);
  });

  it("un morceau posé à l'avance MAXIMALE n'est pas jugé trop en avance", () => {
    // Le test qui aurait attrapé la panne du 18 août 2026. Quand l'avance a
    // atteint son plafond après une mauvaise minute, chaque morceau suivant
    // était déclaré trop en avance, se réancrait, et poussait l'avance encore:
    // 1 001 trous pour 1 000 morceaux, et un silence complet.
    const placed = scheduleAt(10, 10 + LEAD_MAX, LEAD_MAX);

    expect(placed.gap).toBe(false);
  });
});

describe("mille morceaux d'affilée", () => {
  /** Fait tourner la boucle comme le fait un vrai flux, et rend le nombre de
   * trous. Le contexte avance de la durée du morceau à chaque tour, exactement
   * comme une horloge matérielle. */
  function play(chunks: number, lead: number, jolt = 0): number {
    const LENGTH = 0.02; // vingt millisecondes, ce que le worker envoie
    let now = 0;
    let playAt = 0;
    let gaps = 0;
    for (let index = 0; index < chunks; index++) {
      // La secousse: l'horloge saute une fois, comme quand l'onglet revient
      // d'un passage en arrière-plan.
      if (index === 1 && jolt) now += jolt;
      const placed = scheduleAt(now, playAt, lead);
      playAt = placed.playAt + LENGTH;
      lead = placed.lead;
      if (placed.gap) gaps += 1;
      now += LENGTH;
    }
    return gaps;
  }

  it("un flux régulier ne produit aucun trou", () => {
    expect(play(1000, LEAD_MIN)).toBe(0);
  });

  it("après une secousse, le flux se recale et se tait", () => {
    // Le jumeau du test au-dessus, et le cœur de la panne: une seule secousse
    // ne doit coûter qu'un seul trou. Avec `RESYNC` sous `LEAD_MAX`, elle en
    // coûtait un par morceau jusqu'à la fin de la partie.
    expect(play(1000, LEAD_MIN, 2)).toBe(1);
  });

  it("même en partant de l'avance maximale, la boucle ne s'emballe pas", () => {
    expect(play(1000, LEAD_MAX, 2)).toBe(1);
  });
});

describe("l'avance qui redescend", () => {
  it("redescend quand rien n'a cassé depuis le dernier regard", () => {
    expect(trimmed(0.2, 7, 7)).toBeCloseTo(0.199, 6);
  });

  it("ne bouge pas quand un trou vient d'arriver", () => {
    // Sinon on rendrait au son la marge qui vient de lui manquer.
    expect(trimmed(0.2, 8, 7)).toBe(0.2);
  });

  it("ne descend jamais sous le plancher", () => {
    expect(trimmed(LEAD_MIN, 3, 3)).toBe(LEAD_MIN);
  });
});

describe("le seuil de retard", () => {
  it("est petit, parce qu'il ne décrit pas un confort mais une limite", () => {
    // Sous ce seuil, le morceau est demandé dans le passé et joue tout de
    // suite: le poser plus haut retarderait tout le monde pour rien.
    expect(FLOOR).toBeGreaterThan(0);
    expect(FLOOR).toBeLessThan(LEAD_MIN);
  });
});
