import { describe, expect, it } from "vitest";
import {
  echapFermeLaCarte,
  formeDesPlaces,
  gesteDe,
  lesPlaces,
  nomDePlace,
  phraseDuRole,
  type EntreePlaces,
} from "./places";

const entree = (e: Partial<EntreePlaces> = {}): EntreePlaces => ({
  places: 4,
  tenues: [false, false, false, false],
  noms: new Map(),
  micros: [false, false, false, false],
  chef: null,
  mienne: null,
  ...e,
});

describe("les places du panneau", () => {
  it("donne à chaque place son état, son nom et ses lettres", () => {
    const places = lesPlaces(
      entree({
        tenues: [true, true, false, true],
        noms: new Map([
          [1, "Lina"],
          [2, "Bilel"],
          [4, "Lina"],
        ]),
        mienne: 1,
      }),
    );
    expect(places.map((p) => p.etat)).toEqual(["mine", "busy", "free", "busy"]);
    expect(places.map((p) => p.nom)).toEqual(["Lina", "Bilel", null, "Lina"]);
    // Deux « Lina » : chacune prend son numéro (lib/etiquette).
    expect(places.map((p) => p.lettres)).toEqual(["LI1", "BIL", null, "LI4"]);
  });

  it("n'invente pas de prénom pour une place tenue sans nom", () => {
    const [p] = lesPlaces(entree({ tenues: [true, false, false, false] }));
    expect(p?.nom).toBeNull();
    expect(p?.lettres).toBeNull();
    expect(nomDePlace(p!)).toBe("Place 1, tenue : la reprendre");
  });

  it("ne garde pas le nom d'une place que le salon nomme mais qui est libre", () => {
    // Un nom qui traîne d'un état précédent ne fait pas une place tenue.
    const [p] = lesPlaces(entree({ noms: new Map([[1, "Bo"]]) }));
    expect(p?.etat).toBe("free");
    expect(p?.nom).toBeNull();
  });

  it("couronne qui choisit le jeu, et jamais une place libre", () => {
    const tenue = lesPlaces(
      entree({ tenues: [false, true, false, false], noms: new Map([[2, "Bilel"]]), chef: 2 }),
    );
    expect(tenue[1]?.chef).toBe(true);
    // Le jumeau : le salon désigne la place 3, libre ; pas de couronne.
    const libre = lesPlaces(entree({ chef: 3 }));
    expect(libre[2]?.chef).toBe(false);
    // Ni sur une place tenue sans nom.
    const sansNom = lesPlaces(entree({ tenues: [true, false, false, false], chef: 1 }));
    expect(sansNom[0]?.chef).toBe(false);
  });

  it("compte autant de places que la console en a", () => {
    expect(lesPlaces(entree({ places: 2 }))).toHaveLength(2);
  });
});

describe("le nom accessible d'une place", () => {
  it("dit la place, qui la tient et ce que fait un toucher", () => {
    const places = lesPlaces(
      entree({
        tenues: [true, true, true, false],
        noms: new Map([
          [1, "Moi"],
          [2, "Bilel"],
          [3, "JO"],
        ]),
        micros: [true, true, false, false],
        chef: 2,
        mienne: 1,
      }),
    );
    expect(places.map(nomDePlace)).toEqual([
      "Place 1 : toi",
      "Place 2 : Bilel, choisit le jeu : lui demander sa place",
      "Place 3 : JO, micro coupé : lui demander sa place",
      "Place 4, libre : la prendre",
    ]);
  });

  it("dit à qui choisit le jeu que c'est lui", () => {
    const [p] = lesPlaces(
      entree({ tenues: [true], noms: new Map([[1, "Moi"]]), micros: [true], chef: 1, mienne: 1 }),
    );
    expect(nomDePlace(p!)).toBe("Place 1 : toi, tu choisis le jeu");
  });
});

describe("ce que fait un toucher", () => {
  it("prend une place libre, ouvre la carte d'une place tenue ou de la sienne", () => {
    const places = lesPlaces(
      entree({ tenues: [true, true, false, false], noms: new Map([[2, "Bo"]]), mienne: 1 }),
    );
    expect(places.map(gesteDe)).toEqual(["carte", "carte", "prendre", "prendre"]);
  });
});

describe("la phrase du rôle", () => {
  it("dit les trois rôles", () => {
    expect(phraseDuRole(null, 2)).toBe("Tu regardes : prends une place libre pour jouer.");
    expect(phraseDuRole(null, 0)).toBe(
      "Tu regardes : touche la place d'un joueur pour la lui demander.",
    );
    expect(phraseDuRole(2, 0)).toBe("Tu joues à la place 2.");
  });
});

describe("la forme de la rangée", () => {
  it("suit la forme du panneau", () => {
    expect(formeDesPlaces("sous")).toBe("rangee");
    expect(formeDesPlaces("colonne")).toBe("deux-rangees");
    expect(formeDesPlaces("debout")).toBe("debout");
    expect(formeDesPlaces("petit")).toBe("petite");
  });
});

describe("Échap et la carte", () => {
  it("ferme la carte depuis la carte ou sa place, et pas depuis ailleurs", () => {
    document.body.innerHTML = `<button id="p"></button><div id="c"><button id="dedans"></button></div><div id="jeu" tabindex="0"></div>`;
    const carte = document.querySelector("#c");
    const place = document.querySelector("#p");
    expect(echapFermeLaCarte(document.querySelector("#dedans"), carte, place)).toBe(true);
    expect(echapFermeLaCarte(place, carte, place)).toBe(true);
    // Les jumeaux : depuis la zone de jeu, Échap garde son sens ; sans carte, rien.
    expect(echapFermeLaCarte(document.querySelector("#jeu"), carte, place)).toBe(false);
    expect(echapFermeLaCarte(place, null, place)).toBe(false);
  });
});
