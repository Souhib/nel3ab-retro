import { describe, expect, it } from "vitest";
import {
  FIGEE_BANDEAU_MS,
  FIGEE_MS,
  lireLiaison,
  FENETRE_VIDE,
  fenetrePourProposition,
  MEMOIRE_VIDE,
  type Etat,
  type Liaison,
  type Memoire,
  type Signaux,
} from "./liaison";

/** Une salle qui va bien: un jeu tourne, tout arrive, rien n'est sondé. */
function signaux(
  changes: Partial<Omit<Signaux, "video">> & { video?: Partial<Signaux["video"]> } = {},
): Signaux {
  const { video, ...rest } = changes;
  return {
    jeu: true,
    manetteSeule: false,
    enLigne: true,
    visible: true,
    visibleDepuisMs: 600_000,
    demarrageDepuisMs: null,
    proposer: false,
    sonDepuisMs: 20,
    manetteDepuisMs: 300,
    site: null,
    salle: null,
    ...rest,
    video: {
      connectee: true,
      ouverteDepuisMs: 300_000,
      coupeeDepuisMs: null,
      entenduDepuisMs: 16,
      imageRecueDepuisMs: 16,
      peinteDepuisMs: 16,
      peintes: 18_000,
      recues: 18_000,
      demarreeDepuisMs: 300_000,
      attendRedemarrage: false,
      ...video,
    },
  };
}

const lire = (s: Signaux, memoire: Memoire = MEMOIRE_VIDE, maintenant = 1_000_000) =>
  lireLiaison(s, memoire, maintenant);
const etat = (s: Signaux): Etat => lire(s).liaison.etat;

describe("la salle qui va bien", () => {
  it("ne dit rien quand tout arrive", () => {
    expect(lire(signaux()).liaison).toEqual({ etat: "ok" });
  });
});

describe("l'image figée côté salle (le 21 novembre 2026)", () => {
  // La salle envoie ses messages vides toutes les 500 ms, le son continue,
  // plus aucune image n'arrive. La page a regardé ça vingt minutes sans un mot.
  const gel = (depuis: number) =>
    signaux({
      video: { entenduDepuisMs: 200, imageRecueDepuisMs: depuis, peinteDepuisMs: depuis },
    });

  it("le dit dès deux secondes sans image, socket ouverte et octets qui arrivent", () => {
    const vu = lire(gel(FIGEE_MS + 500)).liaison;
    expect(vu).toMatchObject({ etat: "figee", son: true, manette: true, niveau: "pastille" });
  });

  it("jumeau: une image qui a 1,8 s de retard n'est pas un gel", () => {
    expect(etat(gel(1800))).toBe("ok");
  });

  it("jumeau: des images qui arrivent ne déclenchent rien", () => {
    expect(etat(gel(16))).toBe("ok");
  });

  it("passe au bandeau à cinq secondes, et reste une pastille avant", () => {
    expect(lire(gel(FIGEE_BANDEAU_MS + 100)).liaison).toMatchObject({ niveau: "bandeau" });
    expect(lire(gel(FIGEE_BANDEAU_MS - 100)).liaison).toMatchObject({ niveau: "pastille" });
  });

  it("dit si le son et la manette passent encore, et seulement s'ils passent", () => {
    const muet = signaux({
      sonDepuisMs: 4000,
      manetteDepuisMs: 6000,
      video: { entenduDepuisMs: 200, imageRecueDepuisMs: 3000, peinteDepuisMs: 3000 },
    });
    expect(lire(muet).liaison).toMatchObject({ etat: "figee", son: false, manette: false });
    const sansSon = signaux({
      sonDepuisMs: null,
      manetteDepuisMs: null,
      video: { entenduDepuisMs: 200, imageRecueDepuisMs: 3000, peinteDepuisMs: 3000 },
    });
    expect(lire(sansSon).liaison).toMatchObject({ etat: "figee", son: false, manette: false });
  });

  it("jumeau: sans aucun octet, ce n'est plus un gel de la salle mais une liaison muette", () => {
    const silence = signaux({
      video: { entenduDepuisMs: 2500, imageRecueDepuisMs: 2500, peinteDepuisMs: 2500 },
    });
    expect(etat(silence)).not.toBe("figee");
  });

  it("ne compte pas le temps passé onglet caché: au retour, il laisse deux secondes à l'image", () => {
    const retour = (depuisRetour: number) =>
      signaux({
        visibleDepuisMs: depuisRetour,
        video: { entenduDepuisMs: 100, imageRecueDepuisMs: 60_000, peinteDepuisMs: 60_000 },
      });
    expect(etat(retour(800))).toBe("ok");
    // Jumeau: deux secondes et demie après le retour, toujours rien.
    expect(etat(retour(2500))).toBe("figee");
  });

  it("ne compte pas une reconnexion toute neuve comme un gel", () => {
    const neuve = (ouverte: number) =>
      signaux({
        video: { ouverteDepuisMs: ouverte, entenduDepuisMs: 100, imageRecueDepuisMs: 30_000 },
      });
    expect(etat(neuve(900))).toBe("ok");
    expect(etat(neuve(2600))).toBe("figee");
  });

  it("ne se tait pas pour une image isolée: il faut une seconde de vraie cadence", () => {
    // Le 21 novembre, une image arrivait toutes les 35 s. Sortir du gel sur
    // elle ferait clignoter le message.
    let t = 1_000_000;
    let m: Memoire = MEMOIRE_VIDE;
    const pas = (s: Signaux, ms: number) => {
      t += ms;
      const lu = lireLiaison(s, m, t);
      m = lu.memoire;
      return lu.liaison;
    };
    expect(pas(gel(10_000), 0).etat).toBe("figee");
    const isolee = signaux({
      video: { entenduDepuisMs: 100, imageRecueDepuisMs: 30, recues: 18_001 },
    });
    const apres = signaux({
      video: { entenduDepuisMs: 100, imageRecueDepuisMs: 530, recues: 18_001 },
    });
    const duree = (l: Liaison) => (l as Extract<Liaison, { etat: "figee" }>).depuisMs;
    const vu = pas(isolee, 500);
    expect(vu.etat).toBe("figee");
    // L'image isolée n'efface pas le gel: la durée ne repart pas de zéro. Elle
    // s'arrête le temps d'un relevé, celui d'une reprise qui commence (voir
    // `figee`, relecture du 22 novembre 2026), puis continue.
    expect(duree(vu)).toBeGreaterThanOrEqual(10_000);
    const ensuite = pas(apres, 500);
    expect(ensuite.etat).toBe("figee");
    expect(duree(ensuite)).toBeGreaterThanOrEqual(11_000);
    expect(pas(apres, 500).etat).toBe("figee");
  });

  it("jumeau: une seconde d'images à la cadence du jeu le fait sortir", () => {
    let t = 1_000_000;
    let m: Memoire = MEMOIRE_VIDE;
    const pas = (s: Signaux, ms: number) => {
      t += ms;
      const lu = lireLiaison(s, m, t);
      m = lu.memoire;
      return lu.liaison;
    };
    expect(pas(gel(10_000), 0).etat).toBe("figee");
    const flux = (recues: number) =>
      signaux({ video: { entenduDepuisMs: 10, imageRecueDepuisMs: 10, recues } });
    expect(pas(flux(18_001), 500).etat).toBe("figee");
    expect(pas(flux(18_031), 500).etat).toBe("figee");
    expect(pas(flux(18_061), 600).etat).toBe("ok");
  });

  it("garde le gel pendant la seconde où l'on relance l'image", () => {
    let m: Memoire = lire(gel(8000)).memoire;
    const relance = signaux({
      video: { connectee: false, coupeeDepuisMs: 300, ouverteDepuisMs: null },
    });
    const lu = lireLiaison(relance, m, 1_000_300);
    m = lu.memoire;
    expect(lu.liaison.etat).toBe("figee");
    // Jumeau: une socket qui reste fermée n'est plus un gel.
    const tombee = signaux({
      video: { connectee: false, coupeeDepuisMs: 3000, ouverteDepuisMs: null },
    });
    expect(lireLiaison(tombee, m, 1_003_000).liaison.etat).not.toBe("figee");
  });

  it("ne parle pas de gel pendant un démarrage, ni dans une salle sans jeu", () => {
    expect(etat({ ...gel(9000), demarrageDepuisMs: 4000 })).toBe("demarrage");
    expect(etat({ ...gel(9000), jeu: false })).toBe("ok");
  });
});

describe("l'appareil qui ne décode plus", () => {
  const coince = (peinte: number, ouverte = 300_000) =>
    signaux({
      video: { imageRecueDepuisMs: 10, peinteDepuisMs: peinte, ouverteDepuisMs: ouverte },
    });

  it("le dit quand les images arrivent et qu'aucune n'est peinte depuis deux secondes", () => {
    expect(lire(coince(2500)).liaison).toMatchObject({ etat: "decodeur" });
  });
  it("jumeau: une image peinte il y a 100 ms", () => {
    expect(etat(coince(100))).toBe("ok");
  });
  it("jumeau: une socket qui vient de s'ouvrir attend sa première image-clé", () => {
    expect(etat(coince(2500, 900))).toBe("ok");
  });
});

describe("ma connexion coupée", () => {
  it("le dit dès que le navigateur n'a plus de réseau", () => {
    expect(lire(signaux({ enLigne: false })).liaison).toMatchObject({
      etat: "coupee",
      cause: "reseau",
    });
  });
  it("le dit quand ni la salle ni le reste du site ne répondent", () => {
    const rien = signaux({
      site: "muet",
      video: { connectee: false, coupeeDepuisMs: 3000, ouverteDepuisMs: null },
    });
    expect(lire(rien).liaison).toMatchObject({ etat: "coupee", cause: "silence" });
  });
  it("jumeau: le site répond, donc c'est la salle", () => {
    const salle = signaux({
      site: "repond",
      salle: "ouverte",
      video: { connectee: false, coupeeDepuisMs: 3000, ouverteDepuisMs: null },
    });
    expect(etat(salle)).toBe("injoignable");
  });
});

describe("la salle injoignable, et la salle fermée", () => {
  const tombee = (changes: Partial<Signaux>, coupee = 3000) =>
    signaux({
      ...changes,
      video: { connectee: false, coupeeDepuisMs: coupee, ouverteDepuisMs: null },
    });

  it("dit que le reste du site répond quand la sonde l'a vu", () => {
    expect(lire(tombee({ site: "repond", salle: "ouverte" })).liaison).toMatchObject({
      etat: "injoignable",
      site: "repond",
    });
  });
  it("ne suppose rien tant que la sonde n'a pas répondu", () => {
    expect(lire(tombee({ site: null })).liaison).toMatchObject({
      etat: "injoignable",
      site: null,
    });
  });
  it("jumeau: un hoquet de moins d'une seconde ne montre rien", () => {
    expect(etat(tombee({ site: "repond", salle: "ouverte" }, 600))).toBe("ok");
  });
  it("une salle que le site dit fermée est fermée", () => {
    expect(etat(tombee({ site: "repond", salle: "fermee" }))).toBe("fermee");
  });
  it("jumeau: une salle ouverte qui ne répond pas n'est pas fermée", () => {
    expect(etat(tombee({ site: "repond", salle: "ouverte" }))).not.toBe("fermee");
  });
  it("une socket ouverte qui n'entend plus rien est une salle qui ne répond pas", () => {
    const muette = signaux({
      site: "repond",
      salle: "ouverte",
      video: { entenduDepuisMs: 1800, imageRecueDepuisMs: 1800, peinteDepuisMs: 1800 },
    });
    expect(etat(muette)).toBe("injoignable");
  });
});

describe("le démarrage d'un jeu", () => {
  it("annoncé par le salon ou demandé ici", () => {
    expect(lire(signaux({ demarrageDepuisMs: 3000 })).liaison).toEqual({
      etat: "demarrage",
      depuisMs: 3000,
    });
    expect(etat(signaux({ video: { attendRedemarrage: true } }))).toBe("demarrage");
  });
  it("jumeau: sans annonce, une salle qui tombe est injoignable, pas en démarrage", () => {
    const tombee = signaux({
      video: { connectee: false, coupeeDepuisMs: 3000, ouverteDepuisMs: null },
    });
    expect(etat(tombee)).toBe("injoignable");
  });
});

describe("l'arrivée dans la salle", () => {
  const arrivee = (video: Partial<Signaux["video"]>, changes: Partial<Signaux> = {}) =>
    signaux({
      ...changes,
      video: {
        peintes: 0,
        recues: 0,
        imageRecueDepuisMs: null,
        peinteDepuisMs: null,
        demarreeDepuisMs: 2000,
        ...video,
      },
    });

  it("a ses propres étapes: d'abord la salle, puis l'image", () => {
    expect(
      lire(arrivee({ connectee: false, coupeeDepuisMs: 1500, ouverteDepuisMs: null })).liaison,
    ).toMatchObject({ etat: "arrivee", etape: "salle", perdue: false });
    expect(lire(arrivee({ connectee: true, ouverteDepuisMs: 800 })).liaison).toMatchObject({
      etat: "arrivee",
      etape: "image",
    });
  });
  it("a une fin à quinze secondes, et pas avant", () => {
    expect(lire(arrivee({ demarreeDepuisMs: 15_000 })).liaison).toMatchObject({ perdue: true });
    expect(lire(arrivee({ demarreeDepuisMs: 14_000 })).liaison).toMatchObject({ perdue: false });
  });
  it("dit si la salle répond pendant qu'on attend l'image", () => {
    expect(lire(arrivee({ entenduDepuisMs: 200 })).liaison).toMatchObject({ salleRepond: true });
    expect(lire(arrivee({ entenduDepuisMs: 4000 })).liaison).toMatchObject({ salleRepond: false });
  });
  it("devient « salle injoignable » après cinq secondes de refus si le site répond", () => {
    const refus = (coupee: number) =>
      arrivee(
        { connectee: false, coupeeDepuisMs: coupee, ouverteDepuisMs: null },
        { site: "repond", salle: "ouverte" },
      );
    expect(etat(refus(5500))).toBe("injoignable");
    expect(etat(refus(4000))).toBe("arrivee");
  });
  it("devient « salle fermée » si le site la dit fermée", () => {
    const fermee = arrivee(
      { connectee: false, coupeeDepuisMs: 6000, ouverteDepuisMs: null },
      { site: "repond", salle: "fermee" },
    );
    expect(etat(fermee)).toBe("fermee");
  });
  it("jumeau: une page qui a déjà peint n'est plus en arrivée", () => {
    expect(etat(signaux({ video: { connectee: false, coupeeDepuisMs: 1500 } }))).not.toBe(
      "arrivee",
    );
  });
});

describe("la liaison irrégulière", () => {
  it("vient de la proposition de format réduit", () => {
    expect(etat(signaux({ proposer: true }))).toBe("irreguliere");
  });
  it("jumeau: sans proposition, rien", () => {
    expect(etat(signaux({ proposer: false }))).toBe("ok");
  });
  it("cède la place à un gel: on ne propose pas le format réduit pour une image figée", () => {
    const gel = signaux({
      proposer: true,
      video: { entenduDepuisMs: 200, imageRecueDepuisMs: 6000, peinteDepuisMs: 6000 },
    });
    expect(etat(gel)).toBe("figee");
  });
});

describe("l'onglet caché, la page-manette et la salle sans jeu", () => {
  it("un onglet caché n'a rien à dire", () => {
    expect(etat(signaux({ visible: false }))).toBe("cachee");
    expect(etat(signaux({ visible: true }))).not.toBe("cachee");
  });
  it("une page-manette n'attend pas d'image", () => {
    const sansImage = signaux({
      manetteSeule: true,
      video: { connectee: false, coupeeDepuisMs: 60_000, peintes: 0 },
    });
    expect(etat(sansImage)).toBe("ok");
    expect(etat({ ...sansImage, enLigne: false })).toBe("coupee");
  });
  it("une salle sans jeu n'envoie pas d'image, et ce n'est pas une panne", () => {
    const repos = signaux({ jeu: false, video: { connectee: false, coupeeDepuisMs: 60_000 } });
    expect(etat(repos)).toBe("ok");
    expect(etat({ ...repos, jeu: true })).toBe("injoignable");
  });
});

describe("ce que la proposition de format réduit fait d'une fenêtre", () => {
  // Les cas détaillés, et la raison du changement, sont dans
  // `liaison-relecture.test.ts`.
  it("un démarrage la tient, ce que la salle dit d'elle-même l'ignore", () => {
    expect(fenetrePourProposition({ vus: new Set<Etat>(["demarrage"]), gelSalle: false })).toBe(
      "tenir",
    );
    expect(fenetrePourProposition({ vus: new Set<Etat>(["fermee"]), gelSalle: false })).toBe(
      "ignorer",
    );
  });
  it("jumeau: une fenêtre qui n'a vu que la salle en marche ou irrégulière compte", () => {
    expect(
      fenetrePourProposition({ vus: new Set<Etat>(["ok", "irreguliere"]), gelSalle: false }),
    ).toBe("compter");
    expect(fenetrePourProposition(FENETRE_VIDE)).toBe("compter");
  });
});
