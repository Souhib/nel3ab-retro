import { afterEach, describe, expect, it } from "vitest";
import { armer, ATTRIBUT, jetons, lever, retirer, vues } from "./couverture";

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
