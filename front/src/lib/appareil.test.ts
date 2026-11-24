/**
 * Les aides suivent l'appareil (audit T02).
 *
 * Le défaut: « A choisit » au clavier, où la touche A ne choisit rien et envoie
 * Z au jeu. Chaque appareil a donc son essai, et chacun vérifie aussi qu'il ne
 * parle pas la langue d'un autre.
 */
import { describe, expect, it } from "vitest";

import {
  appareilDe,
  aideDeLaSalle,
  ouvrirLeMenu,
  piedDuMenu,
  phrase,
  pour,
  type Appareil,
} from "./appareil";

const texte = (appareil: Appareil, partie = true) =>
  piedDuMenu(appareil, partie)
    .map((one) => `${one.touche} ${one.fait}`)
    .join(" · ");

describe("ce qu'on tient", () => {
  it("une manette qui a parlé l'emporte, même sur un téléphone", () => {
    expect(appareilDe("Xbox Wireless Controller", false)).toBe("manette");
    expect(appareilDe("Xbox Wireless Controller", true)).toBe("manette");
  });

  it("sans manette: le doigt sur un écran tactile, le clavier ailleurs", () => {
    expect(appareilDe(null, true)).toBe("tactile");
    expect(appareilDe(null, false)).toBe("clavier");
  });
});

describe("le pied du menu (M6)", () => {
  it("au clavier, dit les rubriques et Échap, jamais A ni B", () => {
    expect(texte("clavier")).toBe("← → rubriques · Échap revenir au jeu");
    expect(texte("clavier")).not.toMatch(/\bA\b|\bB\b|Start/);
  });

  it("à la manette, dit A, B et Start, jamais Entrée ni Échap", () => {
    expect(texte("manette")).toBe("A valider · B revenir · Start au jeu");
    expect(texte("manette")).not.toMatch(/Entrée|Échap/);
  });

  // Au doigt, la sortie est un vrai bouton en tête du menu : pas de pied.
  it("au doigt, n'a pas de pied", () => {
    expect(piedDuMenu("tactile")).toEqual([]);
    expect(phrase(piedDuMenu("tactile"))).toBe("");
  });

  // Le jumeau sans partie : « revenir au jeu » mentirait dans une salle au
  // repos, où Échap ferme le menu.
  it("sans partie, ne promet pas le jeu", () => {
    expect(texte("clavier", false)).toBe("← → rubriques · Échap fermer le menu");
    expect(texte("manette", false)).toBe("A valider · B revenir · Start fermer le menu");
    expect(texte("clavier", false)).not.toMatch(/jeu/);
  });
});

describe("les aides des entrées", () => {
  it("disent la touche de l'appareil", () => {
    expect(pour("clavier", "ouvrir la glissière")).toBe("Entrée pour ouvrir la glissière");
    expect(pour("manette", "ouvrir la glissière")).toBe("A pour ouvrir la glissière");
    // « Touche » voulait dire une touche du clavier partout ailleurs dans la
    // page (relecture du 22 novembre 2026).
    expect(pour("tactile", "ouvrir la glissière")).toBe("Appuie pour ouvrir la glissière");
  });

  it("disent comment ouvrir le menu sans promettre Échap à qui n'a pas de clavier", () => {
    expect(ouvrirLeMenu("clavier")).toMatch(/Échap/);
    expect(ouvrirLeMenu("tactile")).not.toMatch(/Échap/);
    expect(ouvrirLeMenu("manette")).not.toMatch(/Échap/);
  });
});

describe("l'aide de « la salle », dans le menu", () => {
  it("nomme Ctrl au clavier, qui ouvre aussi le tiroir", () => {
    expect(aideDeLaSalle("clavier")).toMatch(/Ctrl/);
  });

  it("ne nomme pas Ctrl au doigt ni à la manette, qui n'en ont pas", () => {
    // Le jumeau: l'aide disait « (Ctrl) » sur un téléphone (relecture du
    // 22 novembre 2026).
    expect(aideDeLaSalle("tactile")).not.toMatch(/Ctrl/);
    expect(aideDeLaSalle("manette")).not.toMatch(/Ctrl/);
    expect(aideDeLaSalle("tactile")).toMatch(/place/);
  });
});
