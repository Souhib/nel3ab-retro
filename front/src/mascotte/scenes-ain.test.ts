/**
 * Les scènes d'Aïn : toutes se construisent, tiennent leur durée, et se
 * replient quand une ancre manque ou que l'image grandit sur leur chemin.
 */
import { describe, expect, it } from "vitest";

import {
  accessoire,
  estAin,
  MARGE_PX,
  objetA,
  type Ancre,
  type Boite,
  type Decor,
  type PisteObjet,
  type Plan,
  type Zone,
} from "./moteur";
import { planifier, SCENES_AIN, type IdAin } from "./scenes-ain";

const ancre = (x: number, y: number, w: number, h: number): Ancre => ({
  x,
  y,
  w,
  h,
  cx: x + w / 2,
  cy: y + h / 2,
  droite: x + w,
  bas: y + h,
});

/**
 * Une salle de bureau écrite, 1440 × 900 : l'image en haut à gauche, le
 * panneau dessous avec ses quatre START, la colonne à droite et le logo à
 * son pied. Toutes les ancres des scènes complètes y sont, loin de l'image.
 */
function salle(image: Ancre | null = ancre(16, 44, 1080, 560)): Decor {
  const c = 1.5;
  const logo = ancre(1180, 800, 114 * c, 31 * c);
  const sol = 860;
  const ancres: Record<string, Ancre> = {
    "start-1": ancre(300, 830, 40, 30),
    "start-2": ancre(360, 830, 40, 30),
    "start-3": ancre(420, 830, 40, 30),
    "start-4": ancre(480, 830, 40, 30),
    prise: ancre(800, 836, 8, 8),
    toque: ancre(1060, sol, 2, 1),
    siege: ancre(900, sol, 2, 1),
    rattrape: ancre(860, sol, 2, 1),
    devant: ancre(1150, sol, 2, 1),
    public: ancre(620, sol, 2, 1),
    "fiche-sol": ancre(760, sol, 2, 1),
    branche: ancre(840, sol, 2, 1),
    salles: ancre(200, 200, 600, 300),
    "regle-carnet": ancre(200, 600, 300, 4),
    depot: ancre(700, 600, 300, 120),
    "depot-mot": ancre(760, 690, 200, 20),
    "place-libre": ancre(300, 700, 30, 30),
  };
  const zones = (): Zone[] =>
    image
      ? [
          {
            nom: "image",
            b: [
              image.x - MARGE_PX - 0.6,
              image.y - MARGE_PX - 0.6,
              image.droite + MARGE_PX + 0.6,
              image.bas + MARGE_PX + 0.6,
            ],
          },
        ]
      : [];
  return {
    c,
    tete: false,
    maison: [logo.x + 59 * c, logo.y + 25 * c],
    logo: [logo.x, logo.y],
    largeur: 1440,
    ancre: (nom) => ancres[nom] ?? null,
    zones,
    sols: () => [
      { nom: "panneau", x0: 0, x1: 1110, y: sol },
      { nom: "coin", x0: 1110, x1: 1440, y: logo.y + 25 * c },
      { nom: "etagere-bas", x0: 200, x1: 700, y: 760 },
      { nom: "etagere-haut", x0: 200, x1: 700, y: 730 },
    ],
    passages: () => [],
    image: () => image,
  };
}
/** Le même cadre sans aucune ancre : seul le logo. */
function nue(): Decor {
  const d = salle();
  return { ...d, ancre: () => null, sols: () => [] };
}

const IDS = Object.keys(SCENES_AIN) as IdAin[];
const SALLE: IdAin[] = [
  "arrivee",
  "spectateur",
  "depart",
  "attente",
  "attente-chargement",
  "chercher",
  "premiere-image",
  "rebrancher",
  "arret",
  "hoquet",
  "coupe",
  "decroche",
  "redemarre",
  "endort",
  "pret",
  "fier",
  "dort",
];
const SALON: IdAin[] = [
  "ouvre",
  "range",
  "depot",
  "refus",
  "demo",
  "rebrancher-salon",
  "arret-salon",
  "decroche-salon",
  "redemarre-salon",
  "dort-salon",
];

describe("les 27 scènes", () => {
  it("17 de la salle, 10 du salon, et deux de la page", () => {
    expect(SALLE).toHaveLength(17);
    expect(SALON).toHaveLength(10);
    expect([...IDS].sort()).toEqual([...SALLE, ...SALON, "clic", "retour"].sort());
  });

  it("chacune se planifie là où tout est à sa place, en 2,75 s au plus", () => {
    for (const id of IDS) {
      // Le salon n'a pas d'image de jeu.
      const d = SALON.includes(id) ? salle(null) : salle();
      const r = planifier(id, "complete", d, { joueur: "3", mode: "tous" });
      expect(r.plan, `${id} : ${r.refus.join(" ; ")}`).not.toBeNull();
      if (!r.plan) continue;
      expect(r.version, `${id} : ${r.refus.join(" ; ")}`).toBe("complete");
      if (id !== "demo") expect(r.plan.duree, id).toBeLessThanOrEqual(2750);
    }
  });

  /* L'essai sautait en silence une scène dont un plan manquait, et
     comparait à elle-même une scène sans version courte (relecture d'Aïn,
     24 novembre 2026) : il ne compare plus que les scènes qui en ont une,
     exige les deux plans, et une courte strictement plus courte. */
  it("la version courte est plus courte que la complète", () => {
    const avecCourte = IDS.filter((id) => SCENES_AIN[id].courte !== undefined);
    expect(avecCourte.length).toBeGreaterThan(10);
    for (const id of avecCourte) {
      const d = SALON.includes(id) ? salle(null) : salle();
      const longue = planifier(id, "complete", d, { joueur: "2", mode: "tous" });
      const courte = planifier(id, "courte", d, { joueur: "2", mode: "tous" });
      expect(longue.plan, `${id} complète : ${longue.refus.join(" ; ")}`).not.toBeNull();
      expect(courte.plan, `${id} courte : ${courte.refus.join(" ; ")}`).not.toBeNull();
      expect(longue.version, id).toBe("complete");
      expect(courte.version, id).toBe("courte");
      expect((courte.plan as Plan).duree, id).toBeLessThan((longue.plan as Plan).duree);
    }
  });

  it("jumeau : une scène sans version courte n'en joue pas une, elle joue la complète", () => {
    const sans = IDS.filter((id) => SCENES_AIN[id].courte === undefined);
    expect(sans).toContain("attente");
    for (const id of sans) {
      const d = SALON.includes(id) ? salle(null) : salle();
      expect(planifier(id, "courte", d, { joueur: "2", mode: "tous" }).version, id).toBe(
        "complete",
      );
    }
  });
});

describe("les replis", () => {
  it("sans ancre, la scène joue sa version courte dans le logo, et dit pourquoi", () => {
    const r = planifier("arrivee", "complete", nue(), { joueur: "3" });
    expect(r.plan).not.toBeNull();
    expect(r.refus[0]).toMatch(/start-3/);
    if (r.plan) {
      expect(r.version).toBe("courte");
      // Dans le logo : il ne s'éloigne pas de sa maison de plus d'un saut.
      for (const p of r.plan.pistes)
        if (estAin(p)) expect(Math.abs(p.vers[0] - r.plan.maison[0])).toBeLessThan(1);
    }
  });

  it("ROUGE : l'image grandit sur le panneau, les scènes qui y vont se replient", () => {
    // L'image descend jusqu'à 880 px et s'élargit jusqu'à la colonne : les
    // START et les marques du sol sont dessous.
    const grande = salle(ancre(16, 44, 1150, 836));
    for (const id of [
      "arrivee",
      "depart",
      "fier",
      "arret",
      "coupe",
      "endort",
      "rebrancher",
    ] as IdAin[]) {
      const r = planifier(id, "complete", grande, { joueur: "1", mode: "tous" });
      expect(r.version, `${id} : ${r.refus.join(" ; ")}`).not.toBe("complete");
      expect(r.refus.join(" ; "), id).toMatch(/image du jeu/);
    }
  });

  it("jumeau : la même image à sa place laisse jouer les versions complètes", () => {
    for (const id of [
      "arrivee",
      "depart",
      "fier",
      "arret",
      "coupe",
      "endort",
      "rebrancher",
    ] as IdAin[]) {
      expect(planifier(id, "complete", salle(), { joueur: "1", mode: "tous" }).version, id).toBe(
        "complete",
      );
    }
  });

  it("quand le logo lui-même touche l'image, rien ne bouge : la pose clé", () => {
    const d = salle(ancre(1100, 700, 300, 200));
    const r = planifier("arrivee", "complete", d, { joueur: "2" });
    expect(r.plan).toBeNull();
    expect(r.refus.some((x) => x.startsWith("pose"))).toBe(true);
  });

  it("depuis dehors, une scène de panne part de là où il attendait", () => {
    const d = salle();
    const r = planifier(
      "rebrancher",
      "complete",
      d,
      {},
      { pose: {}, pied: [860, 860], scene: "coupe", enLair: false },
    );
    expect(r.plan?.depuisDehors).toBe(true);
    expect(r.plan?.garde.has("fiche")).toBe(true);
  });
});

/** Les boîtes serrées d'un objet de la scène, toutes les 12 ms. */
function boitesDe(P: Plan, qui: string): Boite[] {
  const res: Boite[] = [];
  for (const p of P.pistes) {
    if (estAin(p) || p.qui !== qui) continue;
    const o = p as PisteObjet;
    const { serre } = accessoire(o.dessin);
    for (let t = o.t0; t <= o.t1; t += 12) {
      const xy = objetA(P, o, t);
      if (!xy) continue;
      const c = P.d.c;
      res.push([
        xy[0] + serre[0] * c,
        xy[1] + serre[1] * c,
        xy[0] + serre[2] * c,
        xy[1] + serre[3] * c,
      ]);
    }
  }
  return res;
}

/* L'étiquette de « depart » : le START est le rond de la place, et son nom
   est écrit au ras du haut du bouton (« 2P libre »). La version courte la
   posait à cheval sur le haut du START, sur le nom : vu à 1280 × 720,
   1440 × 900 et 390 × 844 dans le vrai cadre (cadre-navigateur, intégration
   B1, 24 novembre 2026). */
describe("depart : l'étiquette du joueur ne passe jamais sur sa place", () => {
  for (const version of ["courte", "complete"] as const)
    it(`version ${version} : elle se pose au-dessus du START, sans le chevaucher`, () => {
      const d = salle();
      const r = planifier("depart", version, d, { joueur: "2" });
      expect(r.plan, r.refus.join(" ; ")).not.toBeNull();
      expect(r.version).toBe(version);
      const start = d.ancre("start-2") as Ancre;
      const boites = boitesDe(r.plan as Plan, "etiquette");
      expect(boites.length).toBeGreaterThan(10);
      for (const b of boites) {
        const dessus = b[3] <= start.y + 0.01;
        const aCote = b[2] <= start.x || b[0] >= start.droite;
        expect(dessus || aCote, `étiquette ${b.map(Math.round).join(",")}`).toBe(true);
      }
    });

  it("jumeau : un mot posé juste au-dessus du START fait refuser la version courte", () => {
    const d = salle();
    const start = d.ancre("start-2") as Ancre;
    const mot: Zone = {
      nom: "texte",
      b: [start.x - 6, start.y - 12, start.droite + 6, start.y - 2],
    };
    const avecMot: Decor = { ...d, zones: () => [...d.zones(), mot] };
    const r = planifier("depart", "courte", avecMot, { joueur: "2" });
    expect(r.version).not.toBe("courte");
    expect(r.refus.join(" ; ")).toMatch(/l'objet etiquette toucherait les mots de l'événement/);
  });
});

describe("sur le plateau, chercher vise Aïn et non le coin du plateau", () => {
  it("la cartouche s'enfonce dans sa tête, sous la phrase de l'écran éteint", () => {
    const c = 2.5;
    const maison: [number, number] = [628, 496];
    let phrase: Zone = { nom: "texte", b: [414, 300, 722, 326] };
    const d: Decor = {
      c,
      tete: false,
      maison,
      // Le logo virtuel du plateau (moteur.ts, `lireDecor`).
      logo: [maison[0] - 59 * c, maison[1] - 25 * c],
      largeur: 1440,
      ancre: () => null,
      zones: () => [phrase],
      sols: () => [{ nom: "plateau", x0: 500, x1: 756, y: 496 }],
      passages: () => [],
      image: () => null,
    };
    const r = planifier("chercher", "courte", d);
    expect(r.refus).toEqual([]);
    expect(r.version).toBe("courte");
    const enfonce = r.plan?.pistes.filter((p) => p.qui === "enfonce") ?? [];
    expect(enfonce.length).toBe(4);
    for (const p of enfonce) {
      if (estAin(p) || !p.de) throw new Error("piste d'objet sans départ");
      // Au-dessus de la tête, au milieu, et jamais sur la phrase.
      expect(Math.abs(p.de[0] + 10 - maison[0])).toBeLessThan(15);
      expect(p.de[1]).toBeGreaterThan(326);
    }
    // Le jumeau : la phrase juste au-dessus du plateau, la cartouche qui
    // tombe la toucherait ; la courte est refusée pour ses mots.
    phrase = { nom: "texte", b: [414, 360, 722, 386] };
    const pres = planifier("chercher", "courte", d);
    expect(pres.version).not.toBe("courte");
    expect(pres.refus.join()).toContain("les mots de l'événement");
  });
});
