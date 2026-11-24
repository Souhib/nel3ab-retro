import { describe, expect, it } from "vitest";
import type { Liaison } from "../media/liaison";
import { LIGNE_LEGERE, modeleEtat, signaleDansLaFiche, type Entree } from "./etat-modele";

const figee = (depuisMs: number, niveau: "pastille" | "bandeau"): Liaison => ({
  etat: "figee",
  depuisMs,
  son: true,
  manette: true,
  niveau,
  apresRelance: false,
});
const ARRIVEE: Liaison = {
  etat: "arrivee",
  etape: "image",
  depuisMs: 900,
  perdue: false,
  salleRepond: true,
  repondDepuisMs: 600,
};
const COUPEE: Liaison = { etat: "coupee", cause: "reseau", depuisMs: 3000 };

const entree = (changes: Partial<Entree> = {}): Entree => ({
  liaison: { etat: "ok" },
  salle: 1,
  contexte: { jeu: "Kart", salon: true },
  fermeDans: 0,
  place: true,
  legerePassee: false,
  legere: false,
  neige: true,
  ...changes,
});

describe("une seule pastille, une seule fiche : la priorité", () => {
  it("le plein cadre passe avant tout, même la fermeture proche", () => {
    const m = modeleEtat(entree({ liaison: ARRIVEE, fermeDans: 3 }));
    expect(m.id).toBe("arrivee");
    expect(m.niveau).toBe("plein");
  });
  it("une connexion coupée passe avant la fermeture proche", () => {
    expect(modeleEtat(entree({ liaison: COUPEE, fermeDans: 3 })).id).toBe("coupee");
  });
  it("jumeau : la fermeture proche passe avant une image figée", () => {
    const m = modeleEtat(entree({ liaison: figee(9000, "bandeau"), fermeDans: 3 }));
    expect(m.id).toBe("fermeture");
    expect(m.titre).toBe("La salle ferme dans 3 min.");
  });
  it("une image figée passe avant l'image légère passée d'elle-même", () => {
    expect(modeleEtat(entree({ liaison: figee(9000, "bandeau"), legerePassee: true })).id).toBe(
      "figee",
    );
  });
  it("jumeau : l'image légère passée seule passe avant la proposition", () => {
    const m = modeleEtat(entree({ liaison: { etat: "irreguliere" }, legerePassee: true }));
    expect(m.id).toBe("legere");
    expect(m.actions).toEqual(["revenir", "garder-legere"]);
  });
  it("la proposition, seule, est une offre", () => {
    const m = modeleEtat(entree({ liaison: { etat: "irreguliere" } }));
    expect(m.id).toBe("irreguliere");
    expect(m.pastille?.offre).toBe(true);
  });
  it("rien quand tout va bien", () => {
    const m = modeleEtat(entree());
    expect(m).toMatchObject({ id: "ok", niveau: "rien", couverture: null, ligneCoin: null });
  });
});

describe("ce qui couvre l'image (K20, ADR D40)", () => {
  it("le plein cadre pour une arrivée, une salle fermée, et une salle muette à l'arrivée", () => {
    for (const liaison of [
      ARRIVEE,
      { etat: "fermee", a: null, pour: null },
      { etat: "redemarre", arrivee: true },
      { etat: "injoignable", site: "repond", arrivee: true, depuisMs: 6000 },
    ] as Liaison[])
      expect(modeleEtat(entree({ liaison })).couverture, liaison.etat).toBe("plein");
  });
  it("la neige pour une connexion coupée, aux niveaux qui ont la neige", () => {
    expect(modeleEtat(entree({ liaison: COUPEE, neige: true })).couverture).toBe("neige");
    expect(
      modeleEtat(entree({ liaison: { etat: "coupee", cause: "silence", depuisMs: 3000 } }))
        .couverture,
    ).toBe("neige");
  });
  it("jumeau : au niveau « sobre », l'image arrêtée assombrie à la place de la neige", () => {
    expect(modeleEtat(entree({ liaison: COUPEE, neige: false })).couverture).toBe("passee");
  });
  it("l'image figée n'est assombrie qu'à la fiche, jamais pendant la pastille", () => {
    expect(modeleEtat(entree({ liaison: figee(9000, "bandeau") })).couverture).toBe("passee");
    expect(modeleEtat(entree({ liaison: figee(3000, "pastille") })).couverture).toBeNull();
  });
  it("jumeau : la neige n'est que pour la connexion coupée, pas pour une salle muette", () => {
    for (const liaison of [
      { etat: "injoignable", site: "repond", arrivee: false, depuisMs: 3000 },
      { etat: "redemarre", arrivee: false },
    ] as Liaison[])
      expect(modeleEtat(entree({ liaison })).couverture, liaison.etat).toBeNull();
  });
  it("jamais rien sur une image qui bouge", () => {
    for (const liaison of [
      { etat: "ok" },
      { etat: "irreguliere" },
      { etat: "cachee" },
    ] as Liaison[])
      for (const changes of [{}, { fermeDans: 3 }, { legerePassee: true }, { legere: true }])
        expect(modeleEtat(entree({ liaison, ...changes })).couverture).toBeNull();
  });
});

describe("la fermeture proche", () => {
  it("qui tient une place a la fiche et « Je reste »", () => {
    const m = modeleEtat(entree({ fermeDans: 4, place: true }));
    expect(m.niveau).toBe("fiche");
    expect(m.actions).toEqual(["rester"]);
  });
  it("jumeau : un spectateur n'a que la pastille", () => {
    const m = modeleEtat(entree({ fermeDans: 4, place: false }));
    expect(m.niveau).toBe("pastille");
    expect(m.actions).toEqual([]);
  });
});

describe("la ligne du coin ne répète pas la fiche", () => {
  it("se tait pendant une fiche ou un plein cadre", () => {
    expect(modeleEtat(entree({ liaison: figee(9000, "bandeau") })).ligneCoin).toBe("");
    expect(modeleEtat(entree({ liaison: ARRIVEE })).ligneCoin).toBe("");
    expect(modeleEtat(entree({ fermeDans: 4 })).ligneCoin).toBe("");
  });
  it("jumeau : parle pendant une pastille seule", () => {
    expect(modeleEtat(entree({ liaison: figee(3000, "pastille") })).ligneCoin).toBeNull();
    expect(modeleEtat(entree({ fermeDans: 4, place: false })).ligneCoin).toBeNull();
  });
  it("dit l'image légère gardée, réglage de la page sans pastille", () => {
    const m = modeleEtat(entree({ legere: true }));
    expect(m.niveau).toBe("rien");
    expect(m.ligneCoin).toBe(LIGNE_LEGERE);
  });
});

describe("Signaler une seule fois à l'écran (K25)", () => {
  it("la fiche d'une panne le porte : la colonne le retire de ses rangs", () => {
    expect(signaleDansLaFiche(modeleEtat(entree({ liaison: figee(14_000, "bandeau") })))).toBe(
      true,
    );
  });
  it("jumeau : une pastille seule, un plein cadre ou rien ne le portent pas", () => {
    expect(signaleDansLaFiche(modeleEtat(entree({ liaison: figee(3000, "pastille") })))).toBe(
      false,
    );
    expect(signaleDansLaFiche(modeleEtat(entree({ liaison: ARRIVEE })))).toBe(false);
    expect(signaleDansLaFiche(modeleEtat(entree()))).toBe(false);
  });
});
