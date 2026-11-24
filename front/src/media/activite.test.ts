import { describe, expect, it } from "vitest";
import { activiteDolphin, activitePro } from "./activite";
import { BUTTON } from "./pad";
import { emptySwitch, SWITCH_BUTTONS } from "./switch";

const repos = { buttons: 0, x: 0, y: 0, cx: 0, cy: 0, l: 0, r: 0 };

describe("l'activité de la trame Dolphin", () => {
  it("suit les douze boutons et les quatre axes des sticks", () => {
    const { suivies } = activiteDolphin(null);
    expect([...suivies].sort()).toEqual([...Object.keys(BUTTON), "x", "y", "cx", "cy"].sort());
  });

  it("dit les boutons, les sticks et la gâchette à mi-course", () => {
    const lu = { ...repos, buttons: BUTTON.A | BUTTON.D_UP, x: -0.4, cy: 1, l: 200 };
    expect([...activiteDolphin(lu).actives].sort()).toEqual(["A", "D_UP", "L", "cy", "x"]);
  });

  it("ne dit rien d'une trame neutre ni d'une gâchette effleurée", () => {
    expect(activiteDolphin(repos).actives.size).toBe(0);
    expect(activiteDolphin({ ...repos, r: 100 }).actives.size).toBe(0);
    expect(activiteDolphin(null).actives.size).toBe(0);
  });
});

describe("l'activité de la trame Pro", () => {
  it("suit seize boutons et les huit sens des sticks", () => {
    const { suivies } = activitePro(null);
    expect(suivies.size).toBe(24);
    expect(suivies.has("lx+") && suivies.has("ry-") && suivies.has("ZL")).toBe(true);
    // Le jumeau : une commande Dolphin n'est pas une commande Pro.
    expect(suivies.has("Z")).toBe(false);
    expect(suivies.has("x")).toBe(false);
  });

  it("dit chaque bouton par son bit, et le sens de chaque axe", () => {
    const lu = { ...emptySwitch(), lx: 0.8, ry: -1 };
    lu.buttons = (1 << SWITCH_BUTTONS.indexOf("ZR")) | (1 << SWITCH_BUTTONS.indexOf("A"));
    expect([...activitePro(lu).actives].sort()).toEqual(["A", "ZR", "lx+", "ry-"]);
  });

  it("ne dit rien d'une trame neutre", () => {
    expect(activitePro(emptySwitch()).actives.size).toBe(0);
  });
});
