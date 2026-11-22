/**
 * Les défauts que la relecture adverse du 22 novembre 2026 a reproduits dans un
 * vrai navigateur, rejoués ici sur la règle pure. Chacun a été vu ROUGE contre
 * la règle d'avant (journal `rouge-relecture.log` du chantier).
 *
 * Les relevés suivent la session: un toutes les 500 ms.
 */
import { describe, expect, it } from "vitest";
import {
  fenetrePourProposition,
  lireLiaison,
  MEMOIRE_VIDE,
  type Etat,
  type Liaison,
  type Memoire,
  type Signaux,
} from "./liaison";
import { phraseLiaison } from "../lib/liaison-mots";

type Video = Partial<Signaux["video"]>;

function signaux(changes: Partial<Omit<Signaux, "video">> & { video?: Video } = {}): Signaux {
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

/** Une suite de relevés, avec la mémoire passée de l'un à l'autre. */
function suite(depart = 1_000_000) {
  let t = depart;
  let m: Memoire = MEMOIRE_VIDE;
  const vus: Liaison[] = [];
  return {
    vus,
    get t() {
      return t;
    },
    pas(s: Signaux, ms = 500): Liaison {
      t += ms;
      const lu = lireLiaison(s, m, t);
      m = lu.memoire;
      vus.push(lu.liaison);
      return lu.liaison;
    },
  };
}

/** Un chargement de 3 s (messages vides, plus d'image), puis le jeu repart à
 * `ips` images par seconde. La règle ne lit plus la cadence de la source: la
 * page la mesure comme une MÉDIANE d'instants de capture alignés sur les tics
 * du compositeur, donc « 60 » pour un jeu à 45 (écarts de 1, 1 et 2 tics), et
 * la première version exigeait 90 % de ce faux 60. */
function chargementPuisJeu(ips: number, secondes: number) {
  const s = suite();
  let recues = 18_000;
  s.pas(
    signaux({
      video: { entenduDepuisMs: 200, imageRecueDepuisMs: 3000, peinteDepuisMs: 3000 },
    }),
    0,
  );
  for (let i = 0; i < secondes * 2; i++) {
    recues += ips / 2;
    s.pas(
      signaux({
        video: {
          entenduDepuisMs: 10,
          imageRecueDepuisMs: 10,
          peinteDepuisMs: 12,
          recues: Math.floor(recues),
        },
      }),
    );
  }
  return s.vus;
}

describe("la sortie du gel ne dépend plus d'une cadence médiane quantifiée", () => {
  it("un jeu Switch qui repart à 45 images par seconde sort du gel en 1,5 s", () => {
    const vus = chargementPuisJeu(45, 30);
    expect(vus[0].etat).toBe("figee");
    // Trois relevés après la reprise, soit 1,5 s: la page dit « en marche ».
    expect(vus[3].etat).toBe("ok");
    expect(vus.at(-1)?.etat).toBe("ok");
  });

  it("un jeu Xbox 360 qui repart à 55 images par seconde, pareil", () => {
    const vus = chargementPuisJeu(55, 30);
    expect(vus[3].etat).toBe("ok");
    expect(vus.at(-1)?.etat).toBe("ok");
  });

  it("jumeau: une image toutes les 35 s ne fait pas sortir du gel", () => {
    // Le 21 novembre 2026. Relevée chaque demi-seconde pendant 70 s.
    const s = suite();
    s.pas(signaux({ video: { entenduDepuisMs: 200, imageRecueDepuisMs: 10_000 } }), 0);
    let recues = 18_000;
    let derniere = 0;
    for (let ms = 500; ms <= 70_000; ms += 500) {
      if (ms % 35_000 === 0) {
        recues += 1;
        derniere = ms;
      }
      const vu = s.pas(
        signaux({
          video: { entenduDepuisMs: 200, imageRecueDepuisMs: ms - derniere + 10, recues },
        }),
      );
      expect(vu.etat).toBe("figee");
    }
  });

  it("pendant une reprise, la durée ne monte plus et la pastille ne devient pas bandeau", () => {
    // Un gel de 4,5 s (une pastille), puis des images: la reprise ne doit pas
    // faire monter le compteur vers le bandeau de cinq secondes.
    const s = suite();
    expect(
      s.pas(signaux({ video: { entenduDepuisMs: 200, imageRecueDepuisMs: 4500 } }), 0),
    ).toMatchObject({ etat: "figee", niveau: "pastille" });
    let recues = 18_000;
    for (let i = 0; i < 2; i++) {
      recues += 22;
      const vu = s.pas(signaux({ video: { entenduDepuisMs: 10, imageRecueDepuisMs: 10, recues } }));
      expect(vu).toMatchObject({ etat: "figee", niveau: "pastille", depuisMs: 4500 });
    }
  });
});

describe("une socket muette, fermée par le chien de garde, puis rouverte muette", () => {
  // `video.ts` fait maintenant partir la coupure de la dernière preuve de vie
  // (le dernier message), pas de l'instant où le chien de garde ferme.
  const muette = (entendu: number) =>
    signaux({
      site: "repond",
      salle: "ouverte",
      video: { entenduDepuisMs: entendu, imageRecueDepuisMs: entendu, peinteDepuisMs: entendu },
    });
  const fermee = (depuisDernier: number) =>
    signaux({
      site: "repond",
      salle: "ouverte",
      video: {
        connectee: false,
        ouverteDepuisMs: null,
        coupeeDepuisMs: depuisDernier,
        entenduDepuisMs: depuisDernier,
        imageRecueDepuisMs: depuisDernier,
        peinteDepuisMs: depuisDernier,
      },
    });
  const rouverte = (ouverte: number, depuisDernier: number) =>
    signaux({
      site: "repond",
      salle: "ouverte",
      video: {
        ouverteDepuisMs: ouverte,
        entenduDepuisMs: depuisDernier,
        imageRecueDepuisMs: depuisDernier,
        peinteDepuisMs: depuisDernier,
      },
    });

  it("reste « injoignable » d'un bout à l'autre, et ne dit jamais « revenue »", () => {
    const s = suite();
    const etats = [
      s.pas(muette(1600), 0),
      s.pas(muette(2100)),
      s.pas(fermee(2600)),
      s.pas(fermee(3100)),
      s.pas(rouverte(300, 3600)),
      s.pas(rouverte(800, 4100)),
      s.pas(fermee(4600)),
    ].map((vu) => vu.etat);
    expect(etats).toEqual(Array(7).fill("injoignable"));
    for (let i = 1; i < s.vus.length; i++)
      expect(phraseLiaison(s.vus[i - 1], s.vus[i], 1, 1)).not.toBe("L'image est revenue.");
  });

  it("une socket rouverte qui n'apporte que des messages vides ne dit pas « revenue »", () => {
    const s = suite();
    s.pas(fermee(3000), 0);
    // La salle répond de nouveau (un message vide), sans image.
    const vu = s.pas(
      signaux({
        site: "repond",
        salle: "ouverte",
        video: {
          ouverteDepuisMs: 200,
          entenduDepuisMs: 100,
          imageRecueDepuisMs: 3500,
          peinteDepuisMs: 3500,
        },
      }),
    );
    expect(vu.etat).not.toBe("ok");
    expect(phraseLiaison(s.vus[0], vu, 1, 1)).not.toBe("L'image est revenue.");
  });

  it("jumeau: une image arrivée sur la socket rouverte, c'est revenu, et c'est dit", () => {
    const s = suite();
    s.pas(fermee(3000), 0);
    const vu = s.pas(
      signaux({
        site: "repond",
        salle: "ouverte",
        video: {
          ouverteDepuisMs: 200,
          entenduDepuisMs: 10,
          imageRecueDepuisMs: 10,
          peinteDepuisMs: 12,
        },
      }),
    );
    expect(vu.etat).toBe("ok");
    expect(phraseLiaison(s.vus[0], vu, 1, 1)).toBe("L'image est revenue.");
  });
});

describe("« Relancer l'image » pendant un gel, avec une poignée de main de 1,2 s", () => {
  it("reste « figée » pendant la relance, et après, tant qu'aucune image n'arrive", () => {
    const s = suite();
    expect(
      s.pas(signaux({ video: { entenduDepuisMs: 200, imageRecueDepuisMs: 12_000 } }), 0).etat,
    ).toBe("figee");
    // La relance ferme la socket; la nouvelle met 1,2 s à s'ouvrir.
    for (const coupee of [500, 1000])
      expect(
        s.pas(
          signaux({
            video: {
              connectee: false,
              ouverteDepuisMs: null,
              coupeeDepuisMs: coupee,
              entenduDepuisMs: coupee + 200,
              imageRecueDepuisMs: 12_000 + coupee,
            },
          }),
        ).etat,
      ).toBe("figee");
    const ouverte = s.pas(
      signaux({
        video: { ouverteDepuisMs: 300, entenduDepuisMs: 100, imageRecueDepuisMs: 13_500 },
      }),
    );
    expect(ouverte.etat).toBe("figee");
    expect(phraseLiaison(s.vus[2], ouverte, 1, 1)).not.toBe("L'image est revenue.");
  });

  it("jumeau: une socket qui ne se rouvre pas au bout de 3 s n'est plus un gel", () => {
    const s = suite();
    s.pas(signaux({ video: { entenduDepuisMs: 200, imageRecueDepuisMs: 12_000 } }), 0);
    const vu = s.pas(
      signaux({ video: { connectee: false, ouverteDepuisMs: null, coupeeDepuisMs: 3500 } }),
      3500,
    );
    expect(vu.etat).toBe("injoignable");
  });
});

describe("la salle fermée, et la salle qui redémarre", () => {
  const tombee = (changes: Partial<Signaux>, arrivee = false) =>
    signaux({
      ...changes,
      video: {
        connectee: false,
        coupeeDepuisMs: 6000,
        ouverteDepuisMs: null,
        ...(arrivee
          ? { peintes: 0, recues: 0, imageRecueDepuisMs: null, peinteDepuisMs: null }
          : {}),
      },
    });

  it("une salle que le site dit en redémarrage n'est pas fermée", () => {
    const vu = lireLiaison(tombee({ site: "repond", salle: "redemarre" }), MEMOIRE_VIDE, 1e6);
    expect(vu.liaison).toMatchObject({ etat: "redemarre" });
  });
  it("jumeau: une salle que le site dit fermée (confirmé) est fermée", () => {
    const vu = lireLiaison(tombee({ site: "repond", salle: "fermee" }), MEMOIRE_VIDE, 1e6);
    expect(vu.liaison.etat).toBe("fermee");
  });
});

describe("le relais qui répond 502 n'est pas le site qui répond", () => {
  it("une salle tombée avec un relais seul est injoignable, sans « le site répond »", () => {
    const vu = lireLiaison(
      signaux({
        site: "relais",
        video: { connectee: false, coupeeDepuisMs: 3000, ouverteDepuisMs: null },
      }),
      MEMOIRE_VIDE,
      1e6,
    ).liaison;
    expect(vu).toMatchObject({ etat: "injoignable", site: "relais" });
  });
});

describe("l'arrivée refusée n'est pas une salle qui « ne répond plus »", () => {
  const refus = (peintes: number) =>
    signaux({
      site: "repond",
      salle: "ouverte",
      video: {
        connectee: false,
        coupeeDepuisMs: 6000,
        ouverteDepuisMs: null,
        peintes,
        recues: peintes,
        ...(peintes === 0 ? { imageRecueDepuisMs: null, peinteDepuisMs: null } : {}),
      },
    });
  it("à l'arrivée, l'état le dit", () => {
    expect(lireLiaison(refus(0), MEMOIRE_VIDE, 1e6).liaison).toMatchObject({
      etat: "injoignable",
      arrivee: true,
    });
  });
  it("jumeau: en cours de partie, ce n'est pas une arrivée", () => {
    expect(lireLiaison(refus(18_000), MEMOIRE_VIDE, 1e6).liaison).toMatchObject({
      etat: "injoignable",
      arrivee: false,
    });
  });
});

describe("ce que la proposition de format réduit fait d'une fenêtre", () => {
  const f = (vus: Etat[], gelSalle = false) =>
    fenetrePourProposition({ vus: new Set(vus), gelSalle });

  it("une coupure compte: c'est la liaison qui cale, le cas des 22 et 25 septembre 2026", () => {
    expect(f(["ok", "injoignable"])).toBe("compter");
    expect(f(["ok", "coupee"])).toBe("compter");
  });
  it("un gel de la salle, son et manette continus, ne compte pas", () => {
    expect(f(["ok", "figee"], true)).toBe("ignorer");
  });
  it("jumeau: un gel sans le son ou sans l'écho compte, la page ne sait pas de quel côté", () => {
    expect(f(["ok", "figee"], false)).toBe("compter");
  });
  it("ce que la salle dit d'elle-même, l'appareil, l'onglet et l'arrivée ne comptent pas", () => {
    for (const vu of ["fermee", "redemarre", "decodeur", "cachee", "arrivee"] as Etat[])
      expect(f(["ok", vu]), vu).toBe("ignorer");
  });
  it("un démarrage tient la proposition, comme avant", () => {
    expect(f(["demarrage"])).toBe("tenir");
  });
  it("jumeau: une fenêtre en marche compte", () => {
    expect(f(["ok", "irreguliere"])).toBe("compter");
    expect(f([])).toBe("compter");
  });
});
