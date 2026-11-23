/**
 * Ce que la salle monte par-dessus l'image, et ce que Ctrl, « La salle » et la
 * fermeture d'une couche y changent.
 *
 * Écrit après la relecture du 22 novembre 2026: chaque cas d'ici a été vu en
 * navigateur sur l'arbre d'avant (`salle-telephone.mjs`), et chaque jumeau
 * empêche la correction de passer en cassant le cas voisin.
 */
import { describe, expect, it } from "vitest";
import {
  apresCtrl,
  couchesDeLaSalle,
  focusApresFermeture,
  ouvrirLaSalle,
  voileSurImage,
  type EtatDesCouches,
} from "./disposition";

const TELEPHONE: EtatDesCouches = {
  tenu: true,
  etroit: false,
  feuille: null,
  manette: true,
  voile: false,
  bare: true,
};
const ORDINATEUR: EtatDesCouches = { ...TELEPHONE, tenu: false, manette: false, bare: false };

describe("les couches de la salle", () => {
  it("monte la manette d'une salle tenue en main, sans colonne tant que la feuille est fermée", () => {
    expect(couchesDeLaSalle(TELEPHONE)).toEqual({ pave: true, colonne: null });
  });

  it("met la colonne dans la feuille agrandie, et pas à mi-hauteur", () => {
    expect(couchesDeLaSalle({ ...TELEPHONE, feuille: "agrandie" }).colonne).toBe("feuille");
    expect(couchesDeLaSalle({ ...TELEPHONE, feuille: "mi" }).colonne).toBe(null);
  });

  it("démonte la manette sous la feuille, à ses deux hauteurs, ce qui relâche les touches tenues", () => {
    expect(couchesDeLaSalle({ ...TELEPHONE, feuille: "mi" }).pave).toBe(false);
    expect(couchesDeLaSalle({ ...TELEPHONE, feuille: "agrandie" }).pave).toBe(false);
  });

  it("pose la colonne à côté d'un grand écran, et nulle part une fois repliée", () => {
    expect(couchesDeLaSalle(ORDINATEUR).colonne).toBe("a-cote");
    expect(couchesDeLaSalle({ ...ORDINATEUR, bare: true }).colonne).toBe(null);
  });

  it("pose la colonne sous l'image d'une fenêtre étroite à la souris, jamais dans une feuille", () => {
    const etroit = { ...ORDINATEUR, etroit: true };
    expect(couchesDeLaSalle(etroit).colonne).toBe("dessous");
    // Une feuille demandée hors d'une salle tenue en main n'emporte rien.
    expect(couchesDeLaSalle({ ...etroit, feuille: "agrandie" }).colonne).toBe("dessous");
  });
});

describe("« La salle »", () => {
  it("agrandit la feuille d'une salle tenue en main", () => {
    expect(ouvrirLaSalle(true)).toEqual({ feuille: "agrandie" });
  });

  it("déplie la colonne à la souris au lieu d'une feuille qui ne viendra pas", () => {
    expect(ouvrirLaSalle(false)).toEqual({ bare: false });
  });
});

describe("Ctrl seule, dans une salle tenue en main", () => {
  const RIEN = { feuille: null, menu: false, touches: false } as const;

  it("ouvre la salle entière quand rien n'est ouvert, et la ferme ensuite", () => {
    expect(apresCtrl(RIEN)).toEqual({ feuille: "agrandie", menu: false });
    expect(apresCtrl({ ...RIEN, feuille: "agrandie" })).toEqual({ feuille: null, menu: false });
    expect(apresCtrl({ ...RIEN, feuille: "mi" })).toEqual({ feuille: null, menu: false });
  });

  it("ferme le menu au lieu d'empiler la feuille dessus", () => {
    expect(apresCtrl({ ...RIEN, menu: true })).toEqual({ feuille: "agrandie", menu: false });
  });

  it("ne fait rien pendant le réglage des touches, qui lit le clavier", () => {
    expect(apresCtrl({ ...RIEN, touches: true })).toBe(null);
  });
});

describe("le voile sur l'image", () => {
  const RIEN = { repos: false, chargement: false, rideau: false, padOnly: false };

  it("couvre l'image d'un chargement quand elle est montrée", () => {
    expect(voileSurImage({ ...RIEN, chargement: true })).toBe(true);
  });

  it("ne couvre pas la manette d'une page « manette seule » qui charge", () => {
    // Sans image, le chargement ne s'efface jamais (il attend une image
    // peinte): la manette restait démontée après chaque lancement.
    expect(voileSurImage({ ...RIEN, chargement: true, padOnly: true })).toBe(false);
    expect(voileSurImage({ ...RIEN, rideau: true, padOnly: true })).toBe(false);
  });

  it("couvre toujours la salle au repos, image ou pas", () => {
    expect(voileSurImage({ ...RIEN, repos: true })).toBe(true);
    expect(voileSurImage({ ...RIEN, repos: true, padOnly: true })).toBe(true);
    expect(voileSurImage(RIEN)).toBe(false);
  });
});

describe("le focus, à la fermeture", () => {
  it("revient à « La salle » quand ce qui l'avait a disparu", () => {
    expect(focusApresFermeture({ perdu: true, salle: true })).toBe("salle");
  });

  it("revient au jeu quand aucun bouton « La salle » n'est monté", () => {
    expect(focusApresFermeture({ perdu: true, salle: false })).toBe("jeu");
  });

  it("ne bouge pas quand le navigateur l'a déjà rendu à sa place", () => {
    expect(focusApresFermeture({ perdu: false, salle: true })).toBe(null);
    expect(focusApresFermeture({ perdu: false, salle: false })).toBe(null);
  });
});
