import { describe, expect, it } from "vitest";
import {
  SLACK_CEILING,
  SLACK_FLOOR,
  Window,
  isStarved,
  nextSlack,
  percentile,
  steer,
} from "./clock";

/**
 * La distinction qui a coûté 35 ms de latence sur les jeux PAL: une source plus
 * lente que l'écran laisse forcément des tics sans rien à montrer, et ce n'est
 * pas une famine.
 */
describe("famine ou source plus lente", () => {
  const PAL = 20; // 50 Hz
  const NTSC = 1000 / 60;

  it("ne crie pas famine sur un jeu 50 Hz affiché à 60 Hz", () => {
    // Le pire cas arithmétique: un tic tombe juste avant l'image suivante, donc
    // au plus un rafraîchissement après la dernière arrivée.
    for (const since of [0, 5, 10, 16.7, 19.9]) {
      expect(isStarved(since, PAL)).toBe(false);
    }
  });

  it("crie famine quand une image est vraiment en retard", () => {
    // Une image de 60 Hz qui arrive 10 ms trop tard: la file est vide ET
    // l'attente dépasse une période et demie. C'est ce cas que la marge existe
    // pour absorber, et il doit continuer de compter.
    expect(isStarved(NTSC + 10, NTSC)).toBe(true);
    expect(isStarved(100, PAL)).toBe(true);
    expect(isStarved(2000, NTSC)).toBe(true);
  });

  // Le jumeau négatif de la ligne du dessus: sans lui, une fonction qui rendrait
  // toujours `true` passerait le test précédent.
  it("ne crie pas famine sur une cadence normale", () => {
    expect(isStarved(NTSC, NTSC)).toBe(false);
    expect(isStarved(NTSC * 1.4, NTSC)).toBe(false);
  });

  it("traite une cadence inconnue comme une famine plutôt que de l'ignorer", () => {
    // Zéro veut dire « aucune arrivée mesurée »: se taire là ferait taire la
    // détection de panne au démarrage, qui est le moment où elle sert le plus.
    expect(isStarved(50, 0)).toBe(true);
  });
});

describe("les outils de l'horaire", () => {
  it("prend le rang le plus proche, sans toucher à l'ordre de l'appelant", () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 0.5)).toBe(3);
    expect(values).toEqual([5, 1, 4, 2, 3]);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("garde le meilleur, pas le premier", () => {
    const window = new Window(3);
    expect(window.fastest()).toBeNull();
    for (const value of [50, 12, 30]) window.push(value);
    expect(window.fastest()).toBe(12);
    // Borné: le plus ancien sort, et 50 avec lui.
    window.push(40);
    expect(window.length).toBe(3);
    expect(window.fastest()).toBe(12);
  });

  it("avance vers la cible sans la dépasser", () => {
    expect(steer(0, 100, 5)).toBe(5);
    expect(steer(100, 0, 5)).toBe(95);
    // Plus près que le pas: on arrive, on ne dépasse pas.
    expect(steer(0, 2, 5)).toBe(2);
  });
});

describe("la marge", () => {
  it("monte quand la page a eu faim, et par pas de huit", () => {
    expect(nextSlack(6, 5)).toBe(14);
  });

  it("redescend quand la fenêtre a été calme, et plus lentement qu'elle ne monte", () => {
    // Le jumeau de la ligne du dessus, et la raison pour laquelle elle existe:
    // une marge qui ne redescendrait jamais ferait payer une mauvaise minute à
    // toute la partie.
    expect(nextSlack(40, 0)).toBe(38);
  });

  it("ne bouge pas sur une seule famine", () => {
    // Une famine isolée s'explique par n'importe quoi. Deux dans la même
    // fenêtre décrivent la liaison.
    expect(nextSlack(20, 1)).toBe(20);
  });

  it("s'arrête au plafond plutôt que de grandir sans fin", () => {
    // Attendre répare une liaison irrégulière, pas une liaison trop étroite.
    expect(nextSlack(SLACK_CEILING - 2, 9)).toBe(SLACK_CEILING);
    expect(nextSlack(SLACK_CEILING, 9)).toBe(SLACK_CEILING);
  });

  it("ne descend pas sous le plancher", () => {
    expect(nextSlack(SLACK_FLOOR, 0)).toBe(SLACK_FLOOR);
    expect(nextSlack(SLACK_FLOOR + 1, 0)).toBe(SLACK_FLOOR);
  });
});
