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
  compact: true,
  tiroir: false,
  feuille: false,
  manette: true,
  voile: false,
  bare: true,
};
const ORDINATEUR: EtatDesCouches = { ...TELEPHONE, compact: false, manette: false, bare: false };

describe("les couches de la salle", () => {
  it("n'ouvre pas de tiroir sur un grand écran, même demandé", () => {
    // Le cul-de-sac: un grand écran au pointeur fin, la manette à l'écran
    // réglée sur « toujours ». « La salle » posait `tiroir` hors du mode
    // compact; la manette se démontait et rien ne s'ouvrait à sa place.
    const couches = couchesDeLaSalle({ ...ORDINATEUR, manette: true, bare: true, tiroir: true });
    expect(couches.tiroir).toBe(false);
    expect(couches.pave).toBe(true);
  });

  it("ouvre le tiroir d'un téléphone et y démonte la manette (le jumeau)", () => {
    const couches = couchesDeLaSalle({ ...TELEPHONE, tiroir: true });
    expect(couches.tiroir).toBe(true);
    expect(couches.colonne).toBe("tiroir");
    expect(couches.pave).toBe(false);
  });

  it("garde le « ••• » seul monté sous la feuille, pour lui rendre le focus", () => {
    const sansManette = { ...TELEPHONE, manette: false };
    expect(couchesDeLaSalle(sansManette).plusSeul).toBe(true);
    expect(couchesDeLaSalle({ ...sansManette, feuille: true }).plusSeul).toBe(true);
    // Le jumeau: sous le tiroir, plein écran tenu droit, il n'a rien à faire.
    expect(couchesDeLaSalle({ ...sansManette, tiroir: true }).plusSeul).toBe(false);
  });

  it("démonte la manette sous la feuille, ce qui relâche les touches tenues", () => {
    expect(couchesDeLaSalle({ ...TELEPHONE, feuille: true }).pave).toBe(false);
    expect(couchesDeLaSalle(TELEPHONE).pave).toBe(true);
  });

  it("pose la colonne à côté d'un grand écran, et nulle part une fois repliée", () => {
    expect(couchesDeLaSalle(ORDINATEUR).colonne).toBe("a-cote");
    expect(couchesDeLaSalle({ ...ORDINATEUR, bare: true }).colonne).toBe(null);
    expect(couchesDeLaSalle(TELEPHONE).colonne).toBe(null);
  });
});

describe("« La salle »", () => {
  it("ouvre le tiroir d'un téléphone", () => {
    expect(ouvrirLaSalle(true)).toEqual({ tiroir: true });
  });

  it("déplie la colonne d'un grand écran au lieu d'un tiroir qui ne viendra pas", () => {
    expect(ouvrirLaSalle(false)).toEqual({ bare: false });
  });
});

describe("Ctrl seule, en mode tiroir", () => {
  const FERME = { tiroir: false, menu: false, feuille: false, touches: false };

  it("ouvre le tiroir quand rien n'est ouvert, et le ferme ensuite", () => {
    expect(apresCtrl(FERME)).toEqual({ tiroir: true, menu: false, feuille: false });
    expect(apresCtrl({ ...FERME, tiroir: true })).toEqual({
      tiroir: false,
      menu: false,
      feuille: false,
    });
  });

  it("ferme le menu au lieu d'empiler le tiroir dessus", () => {
    // L'aide du rayon « La salle » invite à presser Ctrl depuis le menu:
    // deux dialogues modaux empilés laissaient le bouton « menu » du tiroir
    // sans effet, puisque le menu était déjà ouvert dessous.
    expect(apresCtrl({ ...FERME, menu: true })).toEqual({
      tiroir: true,
      menu: false,
      feuille: false,
    });
    expect(apresCtrl({ ...FERME, feuille: true })).toEqual({
      tiroir: true,
      menu: false,
      feuille: false,
    });
  });

  it("ne fait rien pendant le réglage des touches, qui lit le clavier", () => {
    expect(apresCtrl({ ...FERME, touches: true })).toBe(null);
    expect(apresCtrl({ ...FERME, touches: true, menu: true })).toBe(null);
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
  it("revient au « ••• » quand ce qui l'avait a disparu", () => {
    expect(focusApresFermeture({ perdu: true, plus: true })).toBe("plus");
  });

  it("revient au jeu quand il n'y a pas de « ••• »", () => {
    expect(focusApresFermeture({ perdu: true, plus: false })).toBe("jeu");
  });

  it("ne bouge pas quand le navigateur l'a déjà rendu à sa place", () => {
    expect(focusApresFermeture({ perdu: false, plus: true })).toBe(null);
    expect(focusApresFermeture({ perdu: false, plus: false })).toBe(null);
  });
});
