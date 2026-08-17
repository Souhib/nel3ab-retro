import { beforeEach, describe, expect, it } from "vitest";
import { FITS, place, storedFit } from "./fit";

/** Une place d'écran ordinaire, et les deux formats que le worker envoie. */
const ROOM = { width: 1136, height: 860 };
const BIG = { width: 1216, height: 896 };
const SMALL = { width: 608, height: 448 };

describe("où poser l'image", () => {
  it("remplit en gardant les proportions", () => {
    const at = place("remplir", SMALL, ROOM);
    expect(at.width).toBe(1136);
    // 608x448 est en 4/3, donc 1136 de large font 837 de haut, pas 860: il
    // reste des bandes, et c'est voulu.
    expect(at.height).toBe(837);
    expect(at.smooth).toBe(true);
  });

  it("remplit à la même taille sans lisser, quand on le demande", () => {
    const smooth = place("remplir", SMALL, ROOM);
    const crisp = place("remplir-net", SMALL, ROOM);
    expect(crisp.width).toBe(smooth.width);
    expect(crisp.height).toBe(smooth.height);
    expect(crisp.smooth).toBe(false);
  });

  it("double exactement quand le doublement tient", () => {
    // Un vrai plein écran: 1080/448 vaut 2,41, donc deux fois tient.
    expect(place("entier", SMALL, { width: 1920, height: 1080 })).toEqual({
      width: 1216,
      height: 896,
      smooth: false,
      prescale: 1,
    });
  });

  it("ne double pas quand le doublement ne tient pas", () => {
    // Le jumeau, et il compte: sur une fenêtre de 1136 de large, doubler 608
    // donnerait 1216, soit plus que la place. Un agrandissement entier qui
    // déborde serait une image coupée, donc il reste à une fois.
    expect(place("entier", SMALL, ROOM)).toEqual({
      width: 608,
      height: 448,
      smooth: false,
      prescale: 1,
    });
  });

  it("rend l'image telle quelle en taille d'origine", () => {
    expect(place("origine", SMALL, ROOM)).toEqual({
      width: 608,
      height: 448,
      smooth: false,
      prescale: 1,
    });
  });

  /** Le premier cas limite. Sur une petite fenêtre, une taille fixe déborderait
   * et l'image serait COUPÉE, ce qui est pire qu'une image réduite. */
  it("retombe sur remplir quand la taille demandée ne tient pas", () => {
    const tight = { width: 700, height: 500 };
    const whole = place("entier", BIG, tight);
    const native = place("origine", BIG, tight);
    expect(whole.width).toBeLessThanOrEqual(tight.width);
    expect(whole.height).toBeLessThanOrEqual(tight.height);
    expect(native.width).toBeLessThanOrEqual(tight.width);
    expect(native.height).toBeLessThanOrEqual(tight.height);
  });

  it("ne déborde jamais, quel que soit le choix", () => {
    // Le jumeau général: aucune des quatre options ne doit pouvoir sortir de la
    // place, sinon l'image est tronquée sans que rien ne le dise.
    for (const choice of FITS) {
      for (const room of [ROOM, { width: 700, height: 500 }, { width: 320, height: 240 }]) {
        for (const picture of [BIG, SMALL]) {
          const at = place(choice.id, picture, room);
          expect(at.width, `${choice.id} sur ${room.width}`).toBeLessThanOrEqual(room.width);
          expect(at.height, `${choice.id} sur ${room.height}`).toBeLessThanOrEqual(room.height);
        }
      }
    }
  });

  /** Le second: avant la première image décodée, la taille vaut zéro. Diviser
   * par elle donnerait l'infini, et un élément infini casse la mise en page. */
  it("survit à une image qui n'existe pas encore", () => {
    const at = place("entier", { width: 0, height: 0 }, ROOM);
    expect(Number.isFinite(at.width)).toBe(true);
    expect(at.width).toBeLessThanOrEqual(ROOM.width);
  });

  it("survit à une place nulle, comme une colonne repliée", () => {
    const at = place("remplir", SMALL, { width: 0, height: 0 });
    expect(at.width).toBe(0);
    expect(Number.isFinite(at.height)).toBe(true);
  });
});

describe("le choix retenu", () => {
  beforeEach(() => localStorage.clear());

  it("rend un choix valide quand rien n'est retenu", () => {
    expect(FITS.some((choice) => choice.id === storedFit())).toBe(true);
  });

  it("retombe sur un choix valide quand le stockage dit n'importe quoi", () => {
    localStorage.setItem("nel3ab:fit", "une taille qui n'existe pas");
    expect(FITS.some((choice) => choice.id === storedFit())).toBe(true);
  });
});

describe("l'agrandissement en deux temps", () => {
  it("dessine la toile au pas entier quand il y a la place", () => {
    // 1920/608 vaut 3,16 et 1080/448 vaut 2,41: le pas est de deux.
    expect(place("remplir", SMALL, { width: 1920, height: 1080 }).prescale).toBe(2);
  });

  it("ne fait rien de plus quand il n'y a pas la place", () => {
    // Le jumeau qui compte: en pleine taille, 1216 dans 1616 ne laisse pas la
    // place d'un pas entier. Rien ne change donc pour qui a une bonne connexion.
    expect(place("remplir", BIG, { width: 1616, height: 1080 }).prescale).toBe(1);
  });

  it("laisse « net » sans deux temps", () => {
    // Lisser à la fin est exactement ce que ce choix refuse.
    expect(place("remplir-net", SMALL, { width: 1920, height: 1080 }).prescale).toBe(1);
  });

  it("n'en a pas besoin pour un agrandissement déjà entier", () => {
    expect(place("entier", SMALL, { width: 1920, height: 1080 }).prescale).toBe(1);
    expect(place("origine", SMALL, ROOM).prescale).toBe(1);
  });
});
