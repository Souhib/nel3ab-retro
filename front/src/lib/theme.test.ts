import { beforeEach, describe, expect, it } from "vitest";
import { SHELLS, THEMES, showsTouchPad, storedShell, storedTheme, storedTouch } from "./theme";

describe("le choix retenu", () => {
  beforeEach(() => localStorage.clear());

  it("rend ce qui a été retenu quand ça existe encore", () => {
    localStorage.setItem("nel3ab:shell", "wii");
    expect(storedShell()).toBe("wii");
  });

  /** Le cas réel: le menu Xbox 360 a existé et a été retiré. Quelqu'un qui
   * l'avait choisi garde son nom dans le navigateur, et rendre ce nom-là
   * donnerait une salle sans menu — un écran vide, sans erreur nulle part. */
  it("retombe sur un menu qui existe quand celui d'avant a disparu", () => {
    localStorage.setItem("nel3ab:shell", "xbox360");
    const found = storedShell();
    expect(SHELLS.some((choice) => choice.id === found)).toBe(true);
  });

  it("retombe aussi sur n'importe quoi d'autre", () => {
    // Le jumeau: un stockage bricolé à la main ne doit pas casser la page non
    // plus, et c'est la même ligne de code qui répond.
    localStorage.setItem("nel3ab:shell", "n'importe quoi");
    expect(SHELLS.some((choice) => choice.id === storedShell())).toBe(true);
  });

  it("rend un menu valide quand rien n'a jamais été retenu", () => {
    expect(SHELLS.some((choice) => choice.id === storedShell())).toBe(true);
  });

  it("applique la même règle aux ambiances", () => {
    localStorage.setItem("nel3ab:theme", "une ambiance qui n'existe pas");
    expect(THEMES.some((choice) => choice.id === storedTheme())).toBe(true);
  });
});

describe("la manette à l'écran", () => {
  it("suit l'appareil quand on ne lui a rien dit", () => {
    expect(showsTouchPad("auto", true)).toBe(true);
    expect(showsTouchPad("auto", false)).toBe(false);
  });

  it("obéit à un choix explicite, contre l'appareil", () => {
    // La détection se trompe des deux côtés: un portable tactile n'en veut pas,
    // une tablette avec un clavier peut en vouloir une.
    expect(showsTouchPad("off", true)).toBe(false);
    expect(showsTouchPad("on", false)).toBe(true);
  });

  it("retombe sur l'automatique devant une valeur inconnue", () => {
    localStorage.setItem("nel3ab:touchpad", "peut-être");
    expect(storedTouch()).toBe("auto");
    localStorage.removeItem("nel3ab:touchpad");
  });
});
