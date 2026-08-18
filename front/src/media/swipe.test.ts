/**
 * Le glissement, et surtout ce qu'il refuse de deviner.
 */
import { describe, expect, it } from "vitest";
import { STEP, swipeFrom } from "./swipe";

describe("un glissement du doigt", () => {
  it("ne dit rien tant qu'on n'a pas franchi un cran", () => {
    // Un doigt posé n'est jamais immobile, et un menu qui part sur un
    // tremblement est un menu qu'on ne contrôle pas.
    expect(swipeFrom(10, 4)).toBeNull();
    expect(swipeFrom(0, 0)).toBeNull();
  });

  it("compte les crans, vers le bas comme vers le haut", () => {
    expect(swipeFrom(0, STEP * 2)).toEqual({ axis: "y", steps: 2 });
    expect(swipeFrom(0, -STEP * 3)).toEqual({ axis: "y", steps: -3 });
  });

  it("compte aussi de côté, pour changer de rayon", () => {
    expect(swipeFrom(STEP, 0)).toEqual({ axis: "x", steps: 1 });
    expect(swipeFrom(-STEP * 2, 5)).toEqual({ axis: "x", steps: -2 });
  });

  it("refuse un geste trop diagonal plutôt que de deviner", () => {
    // Deviner à la place de la personne donne un menu qui part de travers une
    // fois sur trois, et c'est pire que de ne rien faire.
    expect(swipeFrom(STEP * 2, STEP * 2)).toBeNull();
    expect(swipeFrom(STEP * 2, STEP * 1.6)).toBeNull();
  });

  it("ne mélange jamais les deux axes", () => {
    // Un glissement qui donnerait à la fois du haut et de la droite ferait
    // sauter le menu en biais, et personne ne vise ça.
    const clear = swipeFrom(STEP * 4, STEP);
    expect(clear).toEqual({ axis: "x", steps: 4 });
  });

  it("tronque plutôt que d'arrondir", () => {
    // Un cran et demi vaut un cran: arrondir au supérieur ferait avancer de
    // deux sur un geste qui n'a franchi qu'une ligne et demie.
    expect(swipeFrom(0, STEP * 1.9)).toEqual({ axis: "y", steps: 1 });
  });
});
