import { describe, expect, it } from "vitest";
import {
  CATCHUP_SLACK_MAX,
  GIVE_UP_WINDOWS,
  QUEUE_CEILING,
  QUEUE_FLOOR,
  SLACK_CEILING,
  SLACK_FLOOR,
  SLACK_START,
  Window,
  isStarved,
  margeDeLAdresse,
  nextSlack,
  nextSlackLisse,
  slackLisse,
  pacingGaveUp,
  percentile,
  roomFor,
  steer,
  stuckAtCeiling,
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

describe("la place dans la file", () => {
  it("suit l'horaire: cent quatre-vingts millisecondes tiennent onze images", () => {
    // 180 / 16,7 = 10,8, arrondi à 11, plus quatre places de rafale.
    expect(roomFor(180, 16.667)).toBe(15);
  });

  it("retombe sur le plancher pour une bonne liaison", () => {
    // La propriété qui compte: qui n'achète presque rien garde le comportement
    // d'avant, huit images, et ne paie pas de mémoire pour rien.
    expect(roomFor(3, 16.667)).toBe(QUEUE_FLOOR);
    expect(roomFor(0, 16.667)).toBe(QUEUE_FLOOR);
  });

  it("s'arrête au plafond", () => {
    expect(roomFor(10_000, 16.667)).toBe(QUEUE_CEILING);
  });

  it("tient compte d'une source plus lente", () => {
    // Un jeu PAL produit toutes les 20 ms: la même marge tient donc en MOINS
    // d'images. Compter en images sans regarder la cadence surdimensionnerait
    // la file de vingt pour cent sur tous les jeux européens.
    expect(roomFor(180, 20)).toBe(13);
  });

  it("ne divise jamais par zéro", () => {
    // Le jumeau: la cadence est mesurée, donc elle peut valoir zéro avant la
    // première image, et une file infinie serait pire qu'une file trop petite.
    expect(roomFor(180, 0)).toBe(QUEUE_CEILING);
  });
});

describe("la marge face à une image jetée", () => {
  it("ne grandit pas quand la file a débordé, même en ayant eu faim", () => {
    // Jeter veut dire que l'horaire est trop tard pour la file. Grandir le
    // retarderait encore: c'est l'emballement mesuré le 2026-08-17.
    expect(nextSlack(121, 9, 1)).toBe(121);
  });

  it("et grandit toujours quand rien n'a été jeté", () => {
    // Le jumeau, sans lequel « ne grandit pas » pourrait vouloir dire « ne
    // grandit jamais ».
    expect(nextSlack(121, 9, 0)).toBe(129);
  });
});

describe("quand l'allure a renoncé", () => {
  it("compte les fenêtres passées au plafond, et repart de zéro dès qu'on en sort", () => {
    let held = 0;
    for (const slack of [SLACK_CEILING, SLACK_CEILING, SLACK_CEILING]) {
      held = stuckAtCeiling(held, slack);
    }
    expect(held).toBe(3);
    // Une seule fenêtre en dessous efface le compte: ce qu'on cherche est un
    // état QUI DURE, pas un total de mauvais moments répartis sur une soirée.
    expect(stuckAtCeiling(held, SLACK_CEILING - 1)).toBe(0);
  });

  it("ne conclut pas avant dix secondes de plafond", () => {
    expect(pacingGaveUp(GIVE_UP_WINDOWS - 1)).toBe(false);
    expect(pacingGaveUp(GIVE_UP_WINDOWS)).toBe(true);
  });

  // Le jumeau négatif, et c'est lui qui protège quelqu'un dont le lien va bien:
  // une marge qui monte SANS atteindre le plafond est l'allure qui fait son
  // travail. Conclure là ferait réduire l'image de gens qui n'ont qu'un hoquet.
  it("ne conclut rien d'une marge qui monte mais absorbe", () => {
    let held = 0;
    for (const slack of [40, 90, 150, 170, 179]) held = stuckAtCeiling(held, slack);
    expect(held).toBe(0);
    expect(pacingGaveUp(held)).toBe(false);
  });
});

describe("la marge qui sait pourquoi elle a jeté (VID-1, 27 novembre 2026)", () => {
  it("grandit sur des famines quand les jets sont des rattrapages", () => {
    expect(nextSlackLisse(SLACK_START, 2, 0, 5)).toBe(SLACK_START + 8);
  });

  it("ne dépasse pas trente millisecondes au-dessus du départ par ce chemin", () => {
    expect(CATCHUP_SLACK_MAX).toBe(SLACK_START + 30);
    expect(nextSlackLisse(CATCHUP_SLACK_MAX - 2, 9, 0, 5)).toBe(CATCHUP_SLACK_MAX);
    expect(nextSlackLisse(CATCHUP_SLACK_MAX, 9, 0, 5)).toBe(CATCHUP_SLACK_MAX);
  });

  it("redescend sans famine, même avec des rattrapages", () => {
    expect(nextSlackLisse(20, 0, 0, 5)).toBe(18);
    expect(nextSlackLisse(SLACK_FLOOR, 0, 0, 5)).toBe(SLACK_FLOOR);
  });

  // Les jumeaux : là où la règle d'avant s'applique, elle s'applique ENTIÈRE.
  it("ne grandit pas quand la file a débordé, rattrapages ou non", () => {
    expect(nextSlackLisse(20, 9, 1, 0)).toBe(20);
    expect(nextSlackLisse(20, 9, 1, 5)).toBe(20);
  });

  it("garde la règle d'avant au-dessus du plafond du rattrapage", () => {
    expect(nextSlackLisse(CATCHUP_SLACK_MAX + 8, 9, 0, 5)).toBe(CATCHUP_SLACK_MAX + 8);
    expect(nextSlackLisse(CATCHUP_SLACK_MAX + 8, 0, 0, 5)).toBe(CATCHUP_SLACK_MAX + 8);
  });

  it("rend la règle d'avant partout où elle s'applique, et jamais plus haut que son plafond ailleurs", () => {
    // Une grille plutôt que des exemples : la correction seule ne porte
    // jamais la marge au plafond `SLACK_CEILING`.
    for (let current = SLACK_FLOOR; current <= SLACK_CEILING; current += 1)
      for (const starved of [0, 1, 2, 9])
        for (const overflowed of [0, 1, 3])
          for (const caughtUp of [0, 1, 4]) {
            const lisse = nextSlackLisse(current, starved, overflowed, caughtUp);
            const avant = nextSlack(current, starved, overflowed + caughtUp);
            if (overflowed > 0 || caughtUp === 0 || current > CATCHUP_SLACK_MAX)
              expect(lisse, `${current} ${starved} ${overflowed} ${caughtUp}`).toBe(avant);
            else expect(lisse).toBeLessThanOrEqual(Math.max(avant, CATCHUP_SLACK_MAX));
          }
  });
});

describe("la marge que l'adresse demande", () => {
  it("rend l'ancienne règle sur `?marge=ancienne`", () => {
    expect(margeDeLAdresse("?marge=ancienne")).toBe("ancienne");
    expect(margeDeLAdresse("?entrer=jouer&marge=ancienne")).toBe("ancienne");
  });

  it("garde la nouvelle partout ailleurs, faute de frappe comprise", () => {
    expect(margeDeLAdresse("")).toBe("lisse");
    expect(margeDeLAdresse("?marge=Ancienne")).toBe("lisse");
    expect(margeDeLAdresse("?marge=lisse")).toBe("lisse");
    expect(margeDeLAdresse("?entrer=jouer")).toBe("lisse");
  });
});

describe("la marge lisse, bornée par la règle d'avant", () => {
  it("ne prend pas les 8 ms de la règle d'avant au-dessus du plafond du rattrapage", () => {
    // Une fenêtre sans aucun jet, affamée, à 36 ms : la règle d'avant
    // ajouterait 8 ms, alors qu'elle-même n'aurait posé que 12 ms.
    expect(slackLisse(CATCHUP_SLACK_MAX, 12, 9, 0, 0)).toBe(CATCHUP_SLACK_MAX);
  });

  // Le jumeau : quand la règle d'avant monte d'elle-même, sur un lien trop
  // étroit, la nouvelle la suit jusqu'au plafond `SLACK_CEILING`.
  it("suit la règle d'avant quand elle-même dépasse ce plafond", () => {
    expect(slackLisse(100, 108, 9, 0, 0)).toBe(108);
    expect(slackLisse(SLACK_CEILING - 2, SLACK_CEILING, 9, 0, 0)).toBe(SLACK_CEILING);
  });

  it("ne dépasse jamais la plus grande de la règle d'avant et du plafond du rattrapage", () => {
    for (let current = SLACK_FLOOR; current <= SLACK_CEILING; current += 1)
      for (let avant = SLACK_FLOOR; avant <= SLACK_CEILING; avant += 7)
        for (const starved of [0, 1, 2, 9])
          for (const [overflowed, caughtUp] of [
            [0, 0],
            [0, 4],
            [1, 0],
            [1, 4],
          ])
            expect(
              slackLisse(current, avant, starved, overflowed, caughtUp),
              `${current} ${avant} ${starved} ${overflowed} ${caughtUp}`,
            ).toBeLessThanOrEqual(Math.max(avant, CATCHUP_SLACK_MAX));
  });
});
