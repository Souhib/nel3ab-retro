/**
 * Les rubriques du menu tiennent dans l'écran (audit M12).
 *
 * Le défaut mesuré: à 390 px, « réglages » et « mesures » à 366 et 514 px. La
 * règle vérifiée ici: à l'ouverture, chaque rubrique est entière dans l'écran,
 * de 320 px à 2 560 px de large. Son jumeau garde la croix de la console sur un
 * grand écran: une correction qui figerait tout partout passerait sinon.
 */
import { describe, expect, it } from "vitest";

import { compteUtile, dispositionXmb, entreesVisibles, ETROIT_SOUS, LISTE_MIN } from "./menu-xmb";

const rubriques = (d: ReturnType<typeof dispositionXmb>, nombre: number) =>
  Array.from({ length: nombre }, (_, at) => ({
    gauche: d.rangee + at * d.pas,
    droite: d.rangee + at * d.pas + d.rubrique,
  }));

describe("la rangée des rubriques", () => {
  it("tient entière dans l'écran, à toutes les largeurs et quelle que soit la choisie", () => {
    for (let largeur = 320; largeur <= 2560; largeur += 10) {
      for (let choisi = 0; choisi < 4; choisi += 1) {
        for (const tactile of [false, true]) {
          const d = dispositionXmb({ largeur, hauteur: 800, nombre: 4, choisi, tactile });
          for (const r of rubriques(d, 4)) {
            expect(r.gauche, `${largeur} px, rubrique ${choisi}`).toBeGreaterThanOrEqual(0);
            expect(r.droite, `${largeur} px, rubrique ${choisi}`).toBeLessThanOrEqual(largeur);
          }
          // La liste tient dans l'écran.
          expect(d.colonne.gauche).toBeGreaterThanOrEqual(16);
          expect(d.colonne.gauche + d.colonne.largeur).toBeLessThanOrEqual(largeur - 16);
        }
      }
    }
  });

  it("garde à la liste la largeur d'un libellé entier, même quand la croix avance", () => {
    // Le défaut mesuré à la relecture du 22 novembre 2026: à 768 px (une
    // tablette en portrait), « réglages » faisait avancer la croix à 456 px et
    // la liste, qui la suivait, tombait dans les 296 px de droite. Cinq
    // libellés sur dix y étaient coupés; l'ancienne page, à 476 px, n'en
    // coupait aucun.
    for (let largeur = ETROIT_SOUS; largeur <= 2560; largeur += 1) {
      for (let choisi = 0; choisi < 4; choisi += 1) {
        const d = dispositionXmb({ largeur, hauteur: 900, nombre: 4, choisi, tactile: false });
        expect(d.colonne.largeur, `${largeur} px, rubrique ${choisi}`).toBeGreaterThanOrEqual(
          Math.min(LISTE_MIN, largeur - 32),
        );
      }
    }
  });

  it("pose la liste sous la rubrique choisie tant que la place le permet", () => {
    // Le jumeau du précédent: une correction qui collerait la liste au bord
    // gauche partout passerait sinon. Sur un grand écran, la liste reste sous
    // la rubrique choisie, quelle qu'elle soit.
    for (const largeur of [1280, 1440, 1920, 2560]) {
      for (let choisi = 0; choisi < 4; choisi += 1) {
        const d = dispositionXmb({ largeur, hauteur: 900, nombre: 4, choisi, tactile: false });
        expect(d.colonne.gauche, `${largeur} px, rubrique ${choisi}`).toBe(
          d.rangee + choisi * d.pas,
        );
      }
    }
    // Et à 768 px, « jeux » garde la sienne: seule la croix qui avance trop
    // décroche la liste.
    const jeux = dispositionXmb({
      largeur: 768,
      hauteur: 1024,
      nombre: 4,
      choisi: 0,
      tactile: false,
    });
    expect(jeux.colonne.gauche).toBe(jeux.rangee);
  });

  it("ne glisse pas sur un téléphone: la rangée reste au bord quelle que soit la choisie", () => {
    for (let choisi = 0; choisi < 4; choisi += 1) {
      const d = dispositionXmb({ largeur: 390, hauteur: 844, nombre: 4, choisi, tactile: true });
      expect(d.rangee).toBe(12);
    }
  });

  it("garde la croix de la console sur un grand écran tant que tout tient", () => {
    // Le jumeau: la choisie reste au croisement, à 18 %, par pas de 148 px,
    // aussi longtemps que la première rubrique reste dans l'écran.
    const vue = { largeur: 1440, hauteur: 900, nombre: 4, tactile: false };
    const d0 = dispositionXmb({ ...vue, choisi: 0 });
    const d1 = dispositionXmb({ ...vue, choisi: 1 });
    expect(d0.etroit).toBe(false);
    expect(d0.pas).toBe(148);
    expect(d0.rangee).toBe(259);
    expect(d1.rangee + d1.pas).toBe(259);
    expect(d1.colonne.gauche).toBe(259);
    // Au-delà, la rangée s'arrête au bord au lieu de sortir de l'écran.
    expect(dispositionXmb({ ...vue, choisi: 3 }).rangee).toBe(12);
  });

  it("bascule en rangée fixe juste sous le seuil, pas au-dessus", () => {
    const sous = dispositionXmb({
      largeur: ETROIT_SOUS - 1,
      hauteur: 800,
      nombre: 4,
      choisi: 0,
      tactile: false,
    });
    const dessus = dispositionXmb({
      largeur: ETROIT_SOUS,
      hauteur: 800,
      nombre: 4,
      choisi: 0,
      tactile: false,
    });
    expect(sous.etroit).toBe(true);
    expect(dessus.etroit).toBe(false);
  });
});

describe("la liste et le pied", () => {
  it("prend toute la largeur d'un téléphone, avec une ligne pour deux lignes de nom", () => {
    const d = dispositionXmb({ largeur: 390, hauteur: 844, nombre: 4, choisi: 0, tactile: true });
    expect(d.colonne).toEqual({ gauche: 16, largeur: 358 });
    expect(d.rang).toBeGreaterThan(74);
  });

  it("laisse au pied tactile la place d'un bouton de 44 px", () => {
    for (const [largeur, hauteur] of [
      [390, 844],
      [844, 390],
    ]) {
      const d = dispositionXmb({ largeur, hauteur, nombre: 4, choisi: 0, tactile: true });
      expect(d.pied, `${largeur}x${hauteur}`).toBeGreaterThanOrEqual(44 + 16);
    }
  });

  it("montre au moins trois entrées sur un téléphone couché", () => {
    // L'entrée choisie commence 46 px sous la croix (voir `Xmb`).
    const d = dispositionXmb({ largeur: 844, hauteur: 390, nombre: 4, choisi: 0, tactile: true });
    const visibles = Math.floor((390 - d.pied - (d.croixY + 46)) / d.rang);
    expect(d.bas).toBe(true);
    expect(visibles).toBeGreaterThanOrEqual(3);
    // Le jumeau: à la croix de 40 %, il n'en tenait que deux.
    expect(Math.floor((390 - d.pied - (Math.round(390 * 0.4) + 46)) / d.rang)).toBeLessThan(3);
  });
});

describe("le compte des entrées", () => {
  it("se tait quand toute la liste tient à l'écran", () => {
    // « 1/2 » flottait seul au-dessus des rubriques, pour une liste qu'on
    // voyait en entier (relecture du 22 novembre 2026).
    const d = dispositionXmb({ largeur: 1440, hauteur: 900, nombre: 4, choisi: 2, tactile: false });
    expect(compteUtile(d, 900, 2)).toBe(false);
  });

  it("le jumeau: parle quand des entrées sont cachées sous le bas de la liste", () => {
    const d = dispositionXmb({ largeur: 1440, hauteur: 900, nombre: 4, choisi: 0, tactile: false });
    expect(compteUtile(d, 900, 14)).toBe(true);
    // Le seuil exact: autant d'entrées que de places, puis une de plus.
    const places = entreesVisibles(d, 900);
    expect(compteUtile(d, 900, places)).toBe(false);
    expect(compteUtile(d, 900, places + 1)).toBe(true);
  });
});
