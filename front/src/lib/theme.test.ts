import { beforeEach, describe, expect, it } from "vitest";
import {
  LOBBIES,
  SHELLS,
  THEMES,
  applyTheme,
  rememberTheme,
  rememberPadOnly,
  showsTouchPad,
  storedPadOnly,
  rememberLobby,
  storedLobby,
  storedShell,
  storedTheme,
  storedTouch,
} from "./theme";

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

describe("les deux régies, et le système", () => {
  beforeEach(() => localStorage.clear());

  it("suit l'appareil quand rien n'a été choisi", () => {
    // Une personne en mode clair sur son téléphone recevait une page noire:
    // le défaut était « instrument sombre », quoi que dise le système.
    expect(storedTheme()).toBe("auto");
  });

  it("propose exactement trois choix: l'appareil, la nuit, le jour", () => {
    expect(THEMES.map((choice) => choice.id)).toEqual(["auto", "nuit", "jour"]);
  });

  it("garde un choix déjà fait dans l'ancien vocabulaire, du bon côté", () => {
    // Le cas réel: sept ambiances ont existé jusqu'au 22 novembre 2026, et
    // chaque navigateur garde la sienne. Quelqu'un qui avait choisi un fond
    // clair le retrouve clair, quelqu'un qui avait choisi un fond sombre le
    // retrouve sombre: un choix fait n'est pas effacé par une mise à jour.
    const sombres = ["instrument-sombre", "phosphore", "ambre"];
    const clairs = ["instrument-clair", "indigo", "famicom", "gameboy"];
    for (const ancien of sombres) {
      localStorage.setItem("nel3ab:theme", ancien);
      expect(storedTheme(), ancien).toBe("nuit");
    }
    for (const ancien of clairs) {
      localStorage.setItem("nel3ab:theme", ancien);
      expect(storedTheme(), ancien).toBe("jour");
    }
  });

  it("rend le choix tel quel quand il est déjà dans le nouveau vocabulaire", () => {
    for (const id of ["auto", "nuit", "jour"] as const) {
      rememberTheme(id);
      expect(storedTheme()).toBe(id);
    }
  });

  it("retombe sur l'appareil, et non sur la nuit, devant n'importe quoi d'autre", () => {
    // Le jumeau négatif de la table ci-dessus: une valeur inconnue ne doit pas
    // être prise pour un ancien thème sombre.
    for (const bricole of ["", "INSTRUMENT-CLAIR", "clair", "dark", "nuit "]) {
      localStorage.setItem("nel3ab:theme", bricole);
      expect(storedTheme(), JSON.stringify(bricole)).toBe("auto");
    }
  });

  it("pose le choix sur <html>, où la feuille le lit avant le premier rendu", () => {
    applyTheme("jour");
    expect(document.documentElement.dataset.theme).toBe("jour");
    applyTheme("auto");
    expect(document.documentElement.dataset.theme).toBe("auto");
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

  it("s'efface en automatique devant une vraie manette, et revient sans elle", () => {
    // Au téléphone, une vraie manette branchée rend l'image entière
    // (en-jeu-manette.4) ; débranchée, les touches reviennent d'elles-mêmes.
    expect(showsTouchPad("auto", true, true)).toBe(false);
    expect(showsTouchPad("auto", true, false)).toBe(true);
    // Un choix explicite tient, manette ou pas.
    expect(showsTouchPad("on", true, true)).toBe(true);
    expect(showsTouchPad("off", true, false)).toBe(false);
  });

  it("retombe sur l'automatique devant une valeur inconnue", () => {
    localStorage.setItem("nel3ab:touchpad", "peut-être");
    expect(storedTouch()).toBe("auto");
    localStorage.removeItem("nel3ab:touchpad");
  });
});

describe("la manette seule", () => {
  it("est absente par défaut", () => {
    // Quelqu'un qui ouvre la salle veut voir le jeu. Le mode manette est un
    // choix, pas un état où on se retrouve sans l'avoir demandé.
    localStorage.clear();
    expect(storedPadOnly()).toBe(false);
  });

  it("se garde dans les deux sens", () => {
    // Le jumeau du test au-dessus: sans lui, une fonction qui rendrait toujours
    // faux le satisferait sans rien garder du tout.
    rememberPadOnly(true);
    expect(storedPadOnly()).toBe(true);
    rememberPadOnly(false);
    expect(storedPadOnly()).toBe(false);
  });
});

/* Le même contrat que les coquilles, et pour la même raison: une valeur retenue
   qui ne serait plus dans la liste afficherait un dessin qui n'existe pas. Le
   jumeau négatif est le stockage corrompu, seul cas qui distingue une lecture
   prudente d'un simple `getItem`. */
it("ne retient jamais un dessin d'entrée inconnu", () => {
  localStorage.setItem("nel3ab:lobby", "cables");
  expect(storedLobby()).toBe("cables");
  localStorage.setItem("nel3ab:lobby", "regie-secrete");
  expect(storedLobby()).toBe("classique");
  expect(LOBBIES.some((choice) => choice.id === storedLobby())).toBe(true);
});

it("garde le dessin choisi d'une visite à l'autre", () => {
  rememberLobby("cables");
  expect(storedLobby()).toBe("cables");
  rememberLobby("classique");
  expect(storedLobby()).toBe("classique");
});
