import { describe, expect, it } from "vitest";
import type { Liaison } from "../media/liaison";
import { SCENES_DE } from "./scenes-salle";
import { sceneDeLEtat, sceneDeTransition } from "./etat-scene";

const OK: Liaison = { etat: "ok" };
const arrivee = (etape: "salle" | "image", perdue = false): Liaison => ({
  etat: "arrivee",
  etape,
  depuisMs: perdue ? 16_000 : 500,
  perdue,
  salleRepond: etape === "image",
  repondDepuisMs: etape === "image" ? 300 : null,
});
const figee = (niveau: "pastille" | "bandeau"): Liaison => ({
  etat: "figee",
  depuisMs: niveau === "pastille" ? 3000 : 9000,
  son: true,
  manette: true,
  niveau,
  apresRelance: false,
});
const injoignable = (site: "repond" | "relais" | null): Liaison => ({
  etat: "injoignable",
  site,
  arrivee: false,
  depuisMs: 3000,
});

/** Le passage d'une liaison à une autre, sans compte de fermeture. */
const passe = (avant: Liaison, apres: Liaison) =>
  sceneDeTransition({ liaison: avant, fermeDans: 0 }, { liaison: apres, fermeDans: 0 });

describe("la scène de chaque état, jouée à son entrée", () => {
  it("rebrancher à l'arrivée", () => {
    expect(passe(OK, arrivee("salle"))).toBe("rebrancher");
  });
  it("jumeau : la salle qui répond ne rejoue pas l'arrivée", () => {
    expect(passe(arrivee("salle"), arrivee("image"))).toBeNull();
  });
  it("attente quand l'arrivée est perdue, une fois", () => {
    expect(passe(arrivee("image"), arrivee("image", true))).toBe("attente");
    expect(passe(arrivee("image", true), arrivee("image", true))).toBeNull();
  });
  it("arret à l'entrée du gel, pas au passage à la fiche", () => {
    expect(passe(OK, figee("pastille"))).toBe("arret");
    expect(passe(figee("pastille"), figee("bandeau"))).toBeNull();
    expect(passe(OK, { etat: "decodeur", depuisMs: 2500 })).toBe("arret");
  });
  it("coupe pour ton appareil sans réseau, jamais pour un silence", () => {
    expect(passe(OK, { etat: "coupee", cause: "reseau", depuisMs: 1000 })).toBe("coupe");
    expect(passe(OK, { etat: "coupee", cause: "silence", depuisMs: 1000 })).toBe("chercher");
  });
  it("decroche côté salle, chercher derrière un relais", () => {
    expect(passe(OK, injoignable("repond"))).toBe("decroche");
    expect(passe(OK, injoignable(null))).toBe("decroche");
    expect(passe(OK, injoignable("relais"))).toBe("chercher");
  });
  it("redemarre une fois, dort une fois", () => {
    const redemarre: Liaison = { etat: "redemarre", arrivee: false };
    expect(passe(OK, redemarre)).toBe("redemarre");
    expect(passe(redemarre, redemarre)).toBeNull();
    expect(passe(injoignable("repond"), { etat: "fermee" })).toBe("dort");
    expect(passe({ etat: "fermee" }, { etat: "fermee" })).toBeNull();
  });
  it("hoquet quand l'image saute et que la proposition paraît", () => {
    expect(passe(OK, { etat: "irreguliere" })).toBe("hoquet");
  });
  it("jamais premiere-image : la salle la joue seule (K06)", () => {
    for (const avant of [arrivee("image"), figee("bandeau"), injoignable("repond")])
      expect(passe(avant, OK)).toBeNull();
  });
  it("chaque scène rendue est une scène que l'arbitre accorde aux états", () => {
    const etats: Liaison[] = [
      arrivee("salle"),
      arrivee("image", true),
      figee("pastille"),
      { etat: "coupee", cause: "reseau", depuisMs: 1 },
      { etat: "coupee", cause: "silence", depuisMs: 1 },
      injoignable("repond"),
      injoignable("relais"),
      { etat: "redemarre", arrivee: true },
      { etat: "fermee" },
      { etat: "irreguliere" },
    ];
    for (const liaison of etats) {
      const scene = sceneDeLEtat(liaison);
      expect(scene, liaison.etat).not.toBeNull();
      expect(SCENES_DE.etats, String(scene)).toContain(scene);
    }
  });
});

describe("la fermeture proche", () => {
  it("endort quand le compte apparaît", () => {
    expect(sceneDeTransition({ liaison: OK, fermeDans: 0 }, { liaison: OK, fermeDans: 5 })).toBe(
      "endort",
    );
  });
  it("jumeau : le compte qui descend ne rejoue rien", () => {
    expect(
      sceneDeTransition({ liaison: OK, fermeDans: 5 }, { liaison: OK, fermeDans: 4 }),
    ).toBeNull();
  });
  it("pret quand une touche remet le compte à zéro, la salle vivante", () => {
    expect(sceneDeTransition({ liaison: OK, fermeDans: 3 }, { liaison: OK, fermeDans: 0 })).toBe(
      "pret",
    );
  });
  it("jumeau : le compte qui s'efface avec la salle fermée joue dort, jamais pret", () => {
    expect(
      sceneDeTransition(
        { liaison: OK, fermeDans: 1 },
        { liaison: { etat: "fermee" }, fermeDans: 0 },
      ),
    ).toBe("dort");
    const fermee: Liaison = { etat: "fermee" };
    expect(
      sceneDeTransition({ liaison: fermee, fermeDans: 1 }, { liaison: fermee, fermeDans: 0 }),
    ).toBeNull();
  });
});
