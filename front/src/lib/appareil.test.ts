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
  piedDuSelecteur,
  pour,
  type Appareil,
} from "./appareil";

const texte = (appareil: Appareil) =>
  piedDuMenu(appareil)
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

describe("le pied du menu", () => {
  it("au clavier, dit Entrée et Échap et jamais A ni B", () => {
    const pied = texte("clavier");
    expect(pied).toContain("Entrée choisir");
    expect(pied).toContain("Échap retour");
    expect(pied).not.toMatch(/\bA\b|\bB\b/);
  });

  it("à la manette, dit A et B et jamais Entrée ni Échap", () => {
    const pied = texte("manette");
    expect(pied).toContain("A choisir");
    expect(pied).toContain("B retour");
    expect(pied).not.toMatch(/Entrée|Échap/);
  });

  it("au doigt, ne nomme aucune touche", () => {
    const pied = texte("tactile");
    expect(pied).toMatch(/Glisse/);
    expect(pied).not.toMatch(/Entrée|Échap|\bA\b|\bB\b/);
  });

  it("au doigt, se dit en une phrase et pas en touches dessinées", () => {
    expect(phrase(piedDuMenu("tactile"))).toBe("Glisse pour te déplacer, appuie pour choisir.");
    expect(phrase([])).toBe("");
  });

  it("ne parle plus de « rayon » ni d'« entrée » au sens de ligne", () => {
    for (const appareil of ["clavier", "manette", "tactile"] as const) {
      expect(texte(appareil)).not.toMatch(/rayon|↑ ↓ entrée/);
    }
  });
});

describe("les aides des entrées et du sélecteur", () => {
  it("disent la touche de l'appareil", () => {
    expect(pour("clavier", "ouvrir la glissière")).toBe("Entrée pour ouvrir la glissière");
    expect(pour("manette", "ouvrir la glissière")).toBe("A pour ouvrir la glissière");
    // « Touche » voulait dire une touche du clavier partout ailleurs dans la
    // page (relecture du 22 novembre 2026).
    expect(pour("tactile", "ouvrir la glissière")).toBe("Appuie pour ouvrir la glissière");
  });

  it("valident et annulent avec les mots de l'appareil", () => {
    expect(piedDuSelecteur("clavier")).toEqual({
      valider: "Entrée valider",
      annuler: "Échap annuler",
    });
    expect(piedDuSelecteur("manette")).toEqual({ valider: "A valider", annuler: "B annuler" });
    expect(piedDuSelecteur("tactile")).toEqual({ valider: "Valider", annuler: "Annuler" });
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
