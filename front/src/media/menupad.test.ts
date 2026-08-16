import { describe, expect, it } from "vitest";
import { MenuPad, directionOf } from "./menupad";
import { BUTTON, type PadReading } from "./pad";

const rest: PadReading = { buttons: 0, x: 0, y: 0, cx: 0, cy: 0, l: 0, r: 0 };
const push = (over: Partial<PadReading>): PadReading => ({ ...rest, ...over });

describe("la direction d'une lecture", () => {
  it("comprend le stick et la croix de la même façon", () => {
    expect(directionOf(push({ y: 1 }))).toBe("up");
    expect(directionOf(push({ buttons: BUTTON.D_UP }))).toBe("up");
    expect(directionOf(push({ x: -1 }))).toBe("left");
    expect(directionOf(push({ buttons: BUTTON.D_RIGHT }))).toBe("right");
  });

  // Le jumeau négatif: un stick qui traîne n'est pas un ordre. Sans ce seuil,
  // une manette usée ferait défiler la liste toute seule.
  it("ne prend pas un stick qui traîne pour une direction", () => {
    expect(directionOf(push({ y: 0.3 }))).toBeNull();
    expect(directionOf(rest)).toBeNull();
  });
});

describe("la cadence d'un menu", () => {
  it("avance d'un cran par poussée, pas de vingt", () => {
    const pad = new MenuPad();
    // La boucle lit la manette toutes les quatre millisecondes. Sans mémoire,
    // une seule poussée traverserait la liste entière.
    expect(pad.feed(push({ y: 1 }), 0)).toBe("up");
    for (let at = 4; at < 400; at += 4) expect(pad.feed(push({ y: 1 }), at)).toBeNull();
  });

  it("répète quand on tient, après un temps de garde", () => {
    const pad = new MenuPad();
    pad.feed(push({ y: -1 }), 0);
    expect(pad.feed(push({ y: -1 }), 399)).toBeNull();
    expect(pad.feed(push({ y: -1 }), 400)).toBe("down");
    expect(pad.feed(push({ y: -1 }), 450)).toBeNull();
    expect(pad.feed(push({ y: -1 }), 510)).toBe("down");
  });

  it("repart à zéro quand on lâche", () => {
    const pad = new MenuPad();
    pad.feed(push({ y: 1 }), 0);
    pad.feed(rest, 100);
    expect(pad.feed(push({ y: 1 }), 200)).toBe("up");
  });

  it("change de sens tout de suite, sans attendre la garde", () => {
    const pad = new MenuPad();
    pad.feed(push({ y: 1 }), 0);
    expect(pad.feed(push({ y: -1 }), 50)).toBe("down");
  });

  it("n'agit sur un bouton qu'au front montant", () => {
    const pad = new MenuPad();
    expect(pad.feed(push({ buttons: BUTTON.A }), 0)).toBe("confirm");
    // Tenu: une seule confirmation, sinon on validerait toute une liste.
    expect(pad.feed(push({ buttons: BUTTON.A }), 4)).toBeNull();
    expect(pad.feed(rest, 8)).toBeNull();
    expect(pad.feed(push({ buttons: BUTTON.A }), 12)).toBe("confirm");
  });

  it("préfère un bouton à une direction tenue en même temps", () => {
    const pad = new MenuPad();
    pad.feed(push({ y: 1 }), 0);
    expect(pad.feed(push({ y: 1, buttons: BUTTON.B }), 4)).toBe("back");
  });
});
