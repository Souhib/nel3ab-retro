import { afterEach, describe, expect, it } from "vitest";
import { armer, ATTRIBUT, boiteJuste, decouvrir, jetons, lever, retirer, vues } from "./couverture";

const attribut = () => document.documentElement.getAttribute(ATTRIBUT);

afterEach(() => {
  for (const jeton of jetons()) retirer(jeton);
});

describe("la couverture de l'image", () => {
  it("pose son jeton sur la racine quand aucune image plus neuve n'existe", () => {
    expect(armer("plein", vues())).toBe(true);
    expect(attribut()).toBe("plein");
    expect(jetons()).toEqual(["plein"]);
  });

  it("se lève dans le MÊME appel que l'image peinte", () => {
    armer("plein", vues());
    armer("neige", vues());
    const avant = vues();
    lever();
    // Pas au prochain relevé : maintenant, avant que l'appel ne rende.
    expect(attribut()).toBeNull();
    expect(jetons()).toEqual([]);
    expect(vues()).toBe(avant + 1);
  });

  it("refuse de couvrir quand une image a été peinte depuis la décision", () => {
    const decide = vues();
    lever();
    expect(armer("passee", decide)).toBe(false);
    expect(attribut()).toBeNull();
  });

  it("jumeau : la même décision sans image peinte entre-temps couvre", () => {
    const decide = vues();
    expect(armer("passee", decide)).toBe(true);
    expect(attribut()).toBe("passee");
  });

  it("refuse un compte plus vieux de quatre images, comme le plan le décrit", () => {
    const decide = vues();
    for (let i = 0; i < 4; i += 1) lever();
    expect(armer("plein", decide + 3)).toBe(false);
    expect(armer("plein", decide + 4)).toBe(true);
  });

  it("garde plusieurs jetons, et en retire un seul", () => {
    armer("plein", vues());
    armer("neige", vues());
    expect(attribut()?.split(" ").sort()).toEqual(["neige", "plein"]);
    retirer("plein");
    expect(attribut()).toBe("neige");
    retirer("neige");
    expect(attribut()).toBeNull();
  });

  it("ne réécrit pas la racine pour un jeton déjà posé ou absent", () => {
    armer("plein", vues());
    document.documentElement.setAttribute(ATTRIBUT, "témoin");
    armer("plein", vues());
    retirer("neige");
    expect(attribut()).toBe("témoin");
  });

  it("une image peinte sans couverture ne touche pas la racine", () => {
    document.documentElement.setAttribute(ATTRIBUT, "témoin");
    lever();
    // Rien n'était posé : l'attribut d'un autre n'est pas le sien.
    expect(attribut()).toBe("témoin");
    document.documentElement.removeAttribute(ATTRIBUT);
  });
});

/**
 * La couverture ne se lève que sur une toile taillée pour l'image peinte
 * (relecture finale du 25 novembre 2026). Levée à la première image dans
 * une toile encore taillée en carré, elle montrait 13 images étirées à
 * 1440x900 avant que React ne retaille la toile.
 */
describe("la couverture attend une boîte juste", () => {
  it("reste posée quand la boîte n'a pas le format, et l'image compte quand même", () => {
    armer("plein", vues());
    const avant = vues();
    expect(lever(() => false)).toBe(false);
    expect(attribut()).toBe("plein");
    expect(vues()).toBe(avant + 1);
    // Le tic suivant, la boîte est juste : la couverture part, sans compter
    // une image de plus.
    expect(decouvrir(() => true)).toBe(true);
    expect(attribut()).toBeNull();
    expect(vues()).toBe(avant + 1);
  });
  it("jumeau : une boîte juste lève dans le même appel", () => {
    armer("plein", vues());
    expect(lever(() => true)).toBe(true);
    expect(attribut()).toBeNull();
  });
  it("jumeau : sans couverture, la boîte n'est pas même lue", () => {
    let lue = false;
    expect(
      lever(() => {
        lue = true;
        return false;
      }),
    ).toBe(true);
    expect(lue).toBe(false);
  });
  it("decouvrir laisse une couverture dont la boîte est encore fausse", () => {
    armer("plein", vues());
    expect(decouvrir(() => false)).toBe(false);
    expect(attribut()).toBe("plein");
  });
});

describe("une boîte juste", () => {
  const toile = (boite?: string, proportions = false) => {
    const c = document.createElement("canvas");
    if (boite !== undefined) c.dataset.boite = boite;
    if (proportions) c.dataset.proportions = "";
    return c;
  };
  it("au pixel près pour « entier » et « origine »", () => {
    expect(boiteJuste(toile("640x480"), { width: 640, height: 480 })).toBe(true);
    expect(boiteJuste(toile("640x480"), { width: 1280, height: 960 })).toBe(false);
    expect(boiteJuste(toile("4x3"), { width: 640, height: 480 })).toBe(false);
  });
  it("aux proportions près, à 2 %, pour « remplir »", () => {
    expect(boiteJuste(toile("4x3", true), { width: 640, height: 480 })).toBe(true);
    expect(boiteJuste(toile("640x480", true), { width: 1280, height: 960 })).toBe(true);
    // Une GameCube en 640x528 dans une boîte 4:3 : 9 % d'écart.
    expect(boiteJuste(toile("4x3", true), { width: 640, height: 528 })).toBe(false);
    expect(boiteJuste(toile("16x9", true), { width: 640, height: 480 })).toBe(false);
  });
  it("jamais pour une boîte taillée sans image ni format", () => {
    expect(boiteJuste(toile("0x0"), { width: 640, height: 480 })).toBe(false);
    expect(boiteJuste(toile("0x0", true), { width: 640, height: 480 })).toBe(false);
  });
  it("toujours pour une toile que personne ne taille", () => {
    // Sans boîte dite, la toile a sa taille intrinsèque : celle de l'image.
    expect(boiteJuste(toile(), { width: 640, height: 480 })).toBe(true);
  });
});
