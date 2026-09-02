/**
 * La lecture de la manette qu'on tient, et le repos qui n'est pas zéro.
 */
import { describe, expect, it } from "vitest";

import { readPad, type PadProfile } from "../media/pad";
import { heldOn, downward, upward, type Raw } from "./wiring";

const pad = (buttons: number[], axes: number[] = []): Raw => ({
  buttons: buttons.map((value) => ({ pressed: value > 0.5, value })),
  axes,
});

const empty: PadProfile = { id: "essai", buttons: {}, triggers: {}, sticks: {} };

describe("ce qui est enfoncé", () => {
  it("nomme les boutons par leur indice brut, pas par une commande", () => {
    // La distinction porte tout l'écran: à droite on montre ce qu'on APPUIE, pas
    // ce que le jeu en fait. Traduire ici effacerait l'écart qu'on vient voir.
    expect(heldOn(pad([0, 1, 0]), empty)).toEqual(["b1"]);
  });

  it("ne voit rien sur une manette au repos", () => {
    expect(heldOn(pad([0, 0, 0], [0, 0]), empty)).toEqual([]);
  });

  it("distingue les deux sens d'un axe", () => {
    expect(heldOn(pad([], [0.9, -0.9]), empty)).toEqual(["a0+", "a1-"]);
  });

  it("compte le REPOS que le profil a mesuré, pas zéro", () => {
    // Un adaptateur GameCube rapporte une gâchette au repos à 0,6. Sans cette
    // soustraction, la moitié du schéma s'allume alors que personne ne touche à
    // rien — et c'est exactement l'écran censé rassurer sur ce que la salle voit.
    const known: PadProfile = {
      ...empty,
      triggers: { L: { button: 4, rest: 0.6 } },
      sticks: { x: { axis: 0, sign: 1, rest: 0.35 } },
    };

    expect(heldOn(pad([0, 0, 0, 0, 0.6], [0.35]), known)).toEqual([]);
  });

  it("voit quand même la gâchette qu'on enfonce depuis ce repos", () => {
    // Le jumeau: une soustraction qui masquerait TOUT rendrait la manette morte
    // à l'écran, ce qui est pire que des pièces allumées à tort.
    const known: PadProfile = { ...empty, triggers: { L: { button: 4, rest: 0.6 } } };

    expect(heldOn(pad([0, 0, 0, 0, 1]), known)).toContain("b4");
  });

  it("se passe d'un profil sans rien casser", () => {
    // Une manette qu'on vient de brancher n'en a pas encore. L'écran doit quand
    // même montrer ce qu'on appuie, sinon il ne sert pas au moment où il sert le
    // plus: quand on ne sait pas encore si la salle voit la manette.
    expect(heldOn(pad([1]), null)).toEqual(["b0"]);
  });
});

describe("l'inclinaison des sticks", () => {
  it("part du repère de l'écran, où le vertical descend", () => {
    // Pousser vers le haut remonte le capot, donc décroît en SVG.
    expect(upward(0.5, 1)).toEqual({ along: 0.5, down: -1 });
    expect(downward(0.5, 1)).toEqual({ along: 0.5, down: 1 });
  });

  // L'essai qui aurait attrapé le défaut, et le seul qui compte ici: les deux
  // schémas partent de nombres différents pour la MÊME poussée, et doivent
  // pencher du même côté. Ils penchaient en sens contraires, et rien ne le
  // disait — le jeu, lui, allait bien.
  it("fait pencher les deux schémas du même côté pour une seule poussée", () => {
    // Stick poussé en haut à droite, dit comme le navigateur le dit.
    const axes = [0.8, -1, 0, 0];
    const held = { buttons: [], axes } as Raw;
    const seen = readPad(held as unknown as Gamepad, null);

    // À gauche on part de la lecture du jeu, à droite des axes bruts.
    const emulated = upward(seen.x, seen.y);
    const physical = downward(axes[0]!, axes[1]!);

    expect(Math.sign(emulated.down)).toBe(Math.sign(physical.down));
    expect(Math.sign(emulated.along)).toBe(Math.sign(physical.along));
    // Et vers le haut de l'écran, pas vers le bas.
    expect(emulated.down).toBeLessThan(0);
  });

  it("ne bouge pas un stick au repos", () => {
    expect(upward(0, 0)).toEqual({ along: 0, down: -0 });
  });
});
