import { describe, expect, it } from "vitest";
import { differences, type Occupation } from "./arrivees";

const occ = (tenues: boolean[], noms: [number, string][] = []): Occupation => ({
  tenues,
  noms: new Map(noms),
});

describe("differences", () => {
  it("le premier état reçu n'annonce personne, même une salle pleine", () => {
    const plein = occ([true, true, true, true], [[1, "Ami"]]);
    expect(differences(null, plein, new Set())).toEqual({ arrivees: [], departs: [] });
  });

  it("une prise libre qui devient tenue par un inconnu de la salle est une première", () => {
    const avant = occ([false, false, false, false]);
    const apres = occ([false, true, false, false], [[2, "Ami"]]);
    expect(differences(avant, apres, new Set()).arrivees).toEqual([
      { port: 2, nom: "Ami", facon: "premiere" },
    ]);
  });

  it("la même arrivée d'une personne déjà vue est un retour, pas une première", () => {
    const avant = occ([false, false, false, false]);
    const apres = occ([false, true, false, false], [[2, "Ami"]]);
    expect(differences(avant, apres, new Set(["Ami"])).arrivees).toEqual([
      { port: 2, nom: "Ami", facon: "retour" },
    ]);
  });

  it("une prise tenue sans nom est un fantôme", () => {
    const avant = occ([false, false, false, false]);
    const apres = occ([true, false, false, false]);
    expect(differences(avant, apres, new Set()).arrivees).toEqual([
      { port: 1, nom: null, facon: "fantome" },
    ]);
  });

  it("une prise qui se libère est un départ, et une prise inchangée n'est rien", () => {
    const avant = occ(
      [true, true, false, false],
      [
        [1, "Ami"],
        [2, "Bo"],
      ],
    );
    const apres = occ([true, false, false, false], [[1, "Ami"]]);
    expect(differences(avant, apres, new Set())).toEqual({
      arrivees: [],
      departs: [{ port: 2 }],
    });
  });

  it("une prise qui change de main entre deux états est un départ puis une arrivée", () => {
    const avant = occ([true, false], [[1, "Ami"]]);
    const apres = occ([true, false], [[1, "Bo"]]);
    expect(differences(avant, apres, new Set(["Bo"]))).toEqual({
      arrivees: [{ port: 1, nom: "Bo", facon: "retour" }],
      departs: [{ port: 1 }],
    });
  });

  it("le salon décide d'une première fois, même contre la mémoire du navigateur", () => {
    const avant = occ([false, false, false, false]);
    const apres: Occupation = {
      ...occ([false, true, false, false], [[2, "Ami"]]),
      premieres: new Map([[2, true]]),
    };
    // Ce navigateur a déjà vu Ami, mais le salon dit qu'Ami vient pour la
    // première fois dans cette salle: c'est le salon qui a raison.
    expect(differences(avant, apres, new Set(["Ami"])).arrivees).toEqual([
      { port: 2, nom: "Ami", facon: "premiere" },
    ]);
  });

  it("le salon dit un retour, même à un navigateur qui ne connaît personne", () => {
    const avant = occ([false, false, false, false]);
    const apres: Occupation = {
      ...occ([false, true, false, false], [[2, "Ami"]]),
      premieres: new Map([[2, false]]),
    };
    expect(differences(avant, apres, new Set()).arrivees).toEqual([
      { port: 2, nom: "Ami", facon: "retour" },
    ]);
  });

  it("sans réponse du salon pour cette prise, la mémoire décide comme avant", () => {
    const avant = occ([false, false, false, false]);
    // Le salon répond pour la prise 1, pas pour la 2.
    const apres: Occupation = {
      ...occ(
        [true, true, false, false],
        [
          [1, "Bo"],
          [2, "Ami"],
        ],
      ),
      premieres: new Map([[1, false]]),
    };
    expect(differences(avant, apres, new Set(["Ami"])).arrivees).toEqual([
      { port: 1, nom: "Bo", facon: "retour" },
      { port: 2, nom: "Ami", facon: "retour" },
    ]);
    expect(differences(avant, apres, new Set()).arrivees).toEqual([
      { port: 1, nom: "Bo", facon: "retour" },
      { port: 2, nom: "Ami", facon: "premiere" },
    ]);
  });

  it("un nom qui apparaît sur une prise déjà tenue n'est pas une arrivée", () => {
    // Le salon nomme parfois la prise un état après l'avoir comptée tenue.
    const avant = occ([true, false]);
    const apres = occ([true, false], [[1, "Ami"]]);
    expect(differences(avant, apres, new Set())).toEqual({ arrivees: [], departs: [] });
  });
});
