/**
 * La manette à l'écran, et les deux défauts classiques du genre.
 */
import { describe, expect, it } from "vitest";
import { BUTTON } from "./pad";
import { stickFrom, Touch } from "./touch";

const CENTRE = { x: 100, y: 100 };

describe("le stick au pouce", () => {
  it("ne bouge pas tant que le pouce reste au centre", () => {
    // Un pouce posé n'est jamais parfaitement immobile. Sans zone morte, le
    // personnage dérive pendant qu'on ne touche à rien.
    expect(stickFrom(CENTRE, { x: 103, y: 98 }, 60)).toEqual({ x: 0, y: 0 });
  });

  it("bouge dès qu'on sort de la zone morte", () => {
    // Le jumeau: une zone morte qui avalerait tout donnerait une manette morte.
    const pushed = stickFrom(CENTRE, { x: 145, y: 100 }, 60);

    expect(pushed.x).toBeCloseTo(0.75, 2);
    expect(pushed.y).toBe(0);
  });

  it("ne va pas plus vite en diagonale qu'en ligne droite", () => {
    // Le défaut classique des manettes tactiles: un rapport brut donne 1,41
    // fois la course en diagonale, donc un personnage plus rapide de biais.
    const straight = stickFrom(CENTRE, { x: 400, y: 100 }, 60);
    const diagonal = stickFrom(CENTRE, { x: 400, y: 400 }, 60);

    expect(Math.hypot(straight.x, straight.y)).toBeCloseTo(1, 5);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 5);
  });

  it("compte le haut de l'écran comme le haut de la manette", () => {
    // Un écran compte vers le bas, une manette vers le haut.
    expect(stickFrom(CENTRE, { x: 100, y: 40 }, 60).y).toBeGreaterThan(0);
    expect(stickFrom(CENTRE, { x: 100, y: 160 }, 60).y).toBeLessThan(0);
  });

  it("ne divise jamais par zéro sur un rayon absurde", () => {
    expect(stickFrom(CENTRE, { x: 100, y: 100 }, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("ce que les doigts tiennent", () => {
  it("ne dit rien quand personne ne touche", () => {
    // Une manette tactile au repos qui rendrait des zéros écraserait le stick
    // d'une vraie manette tenue en même temps.
    expect(new Touch().reading()).toBeNull();
  });

  it("rend les boutons tenus", () => {
    const touch = new Touch();
    touch.press("A");
    touch.press("START");

    expect(touch.reading()?.buttons).toBe(BUTTON.A | BUTTON.START);
  });

  it("oublie un bouton relâché", () => {
    const touch = new Touch();
    touch.press("A");
    touch.press("B");
    touch.release("A");

    expect(touch.reading()?.buttons).toBe(BUTTON.B);
  });

  it("donne des gâchettes tout ou rien", () => {
    const touch = new Touch();
    touch.press("L");

    expect(touch.reading()?.l).toBe(1);
    expect(touch.reading()?.r).toBe(0);
  });

  it("lâche tout d'un coup", () => {
    // Un bouton resté enfoncé parce qu'un appel est arrivé pendant qu'on tenait
    // A ferait courir le personnage jusqu'à ce que quelqu'un s'en aperçoive.
    const touch = new Touch();
    touch.press("A");
    touch.push(0.9, 0.4);
    touch.releaseAll();

    expect(touch.reading()).toBeNull();
  });

  it("se souvient d'avoir servi, même une fois lâchée", () => {
    const touch = new Touch();
    expect(touch.inUse()).toBe(false);

    touch.press("A");
    touch.releaseAll();

    expect(touch.inUse()).toBe(true);
  });
});
