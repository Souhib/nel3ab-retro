/**
 * La manette à l'écran, et les deux défauts classiques du genre.
 */
import { describe, expect, it } from "vitest";
import { BUTTON } from "./pad";
import { clusterKeys, stickFrom, Touch } from "./touch";

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

describe("le groupe des quatre boutons", () => {
  it("tient dans la bande, supplément du gros bouton compris", () => {
    // Le calcul doit compter deux colonnes ordinaires, une colonne large pour
    // A, les deux espaces et la marge. Un premier jet oubliait le supplément de
    // A, et le groupe dépassait de deux pixels sur l'image.
    for (const bar of [130, 143, 160, 200, 320]) {
      const group = clusterKeys(bar);
      const key = Number.parseInt(group.style["--n3-key"] ?? "0", 10);
      const big = Number.parseInt(group.style["--n3-key-big"] ?? "0", 10);
      // La largeur ANNONCÉE doit être celle qu'on retrouve en additionnant les
      // colonnes: c'est la seule chose qui empêche les deux de diverger, ce
      // qu'elles ont déjà fait deux fois.
      expect(group.width, `bande de ${bar}px`).toBe(key * 2 + big + 8);
      expect(group.width, `bande de ${bar}px`).toBeLessThanOrEqual(bar);
    }
  });

  it("ne descend jamais sous la taille d'un doigt", () => {
    // Le jumeau: un calcul qui rétrécirait sans plancher tiendrait dans
    // n'importe quelle bande en rendant les boutons invisables.
    const group = clusterKeys(60);
    expect(Number.parseInt(group.style["--n3-key"] ?? "0", 10)).toBeGreaterThanOrEqual(30);
  });
});

describe("le groupe de boutons dans sa bande", () => {
  /** Où le groupe se pose, du bord de l'écran vers l'intérieur. */
  const posed = (bar: number) => {
    const group = clusterKeys(bar);
    const side = Math.max(6, (bar - group.width) / 2);
    return { debut: side + group.width, width: group.width };
  };

  it("tient dans sa bande, sur toute la plage où on l'affiche", () => {
    // Le défaut du 30 août 2026: la largeur était calculée d'un côté et
    // supposée de l'autre, et les deux ont divergé de seize pixels. Le groupe
    // partait alors sur l'image, d'un pixel, sur un écran 4:3.
    for (let bar = 130; bar <= 400; bar++) {
      const { debut } = posed(bar);
      expect(debut, `bande de ${bar} px`).toBeLessThanOrEqual(bar);
    }
  });

  it("grandit avec la bande, jusqu'à son plafond", () => {
    // Le jumeau: une largeur qui rendrait toujours zéro tiendrait dans
    // n'importe quelle bande sans jamais rien dessiner.
    expect(clusterKeys(130).width).toBeGreaterThan(100);
    expect(clusterKeys(200).width).toBeGreaterThan(clusterKeys(130).width);
    // Et elle cesse de grandir, sinon une bande large donnerait des boutons
    // qu'aucun pouce n'atteint.
    expect(clusterKeys(1000).width).toBe(clusterKeys(400).width);
  });
});
