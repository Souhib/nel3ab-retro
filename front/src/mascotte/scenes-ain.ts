/**
 * Les scènes d'Aïn, salle et salon : ce qu'il fait, version complète et
 * courte, et sa pose clé.
 *
 * Recopiées de la proposition validée (`da/ain/_src/5-scenes.js`), sans ce
 * que la maquette faisait à l'interface : dans nel3ab, chaque écran change
 * son interface lui-même (la pastille d'etats, les places de personnes) ;
 * Aïn ne fait que jouer à côté. Une scène ne lit aucune coordonnée écrite :
 * elle demande des ancres (`P.pt("start-3")`). Une ancre absente lève
 * `SansAncre`, et la version suivante prend le relais : la courte, puis la
 * pose animée dans le logo, puis la pose clé.
 *
 * Les ancres que les scènes complètes demandent, et qui les pose :
 *
 * - `start-1` à `start-4` : le haut des boutons START (personnes) ;
 * - `prise` : la prise de la pastille d'état (etats) ;
 * - `toque`, `siege`, `rattrape`, `devant`, `public`, `fiche-sol`,
 *   `branche` : des marques posées sur les sols du cadre (salle) ;
 * - au salon, `salles`, `regle-carnet`, `depot`, `depot-mot`,
 *   `place-libre`, et les sols `etagere-bas` et `etagere-haut` (salon).
 */
import { B_EC, B_ET, B_PLAT, reliefJoueur, type Bulle, type Pose } from "./dessin";
import type { Cle } from "./lecteur";
import {
  accessoire,
  ACCROUPI,
  coinAin,
  MARGE_PX,
  Plan,
  pointPorte,
  SansAncre,
  verifier,
  type Contexte,
  type Decor,
  type Dehors,
  type Point,
} from "./moteur";

type Faire = (P: Plan) => void;
export type DefScene = {
  complete: Faire;
  courte?: Faire;
  /** La pose clé (mouvement réduit, niveau Sobre, ou aucun chemin). */
  cle?: (ctx: Contexte) => Cle | null;
  /** Une scène de panne : Aïn reste dehors tant que l'état dure. */
  reste?: boolean;
};

const fxQ: Bulle[] = [{ t: "question", c: "M" }];
const fxE: Bulle[] = [{ t: "excl", c: "R" }];
const fxZ: Bulle[] = [{ t: "z", c: "W" }];
const fxEtoile = (c = "Y"): Bulle[] => [{ t: "etoile", c }];
const tag = (P: Plan): Bulle[] => [{ t: "tag", j: P.joueur }];
const HEUREUX = [
  { barres: B_ET, pieds: "rentres", oeil: "heureux" },
  { oeil: "heureux" },
] satisfies Pose[];
const POUSSE: Pose[] = [
  { pieds: "arcboute", penche: 2 },
  { pieds: "large", penche: 2 },
];
const PORTE: Pose[] = [
  { pieds: "pas", penche: 1, barres: B_EC },
  { pieds: "passe1", dy: -1 },
  { pieds: "pas", penche: -1, barres: B_EC },
  { pieds: "passe2", dy: -1 },
];
const GRIS = ["W", "g", "s"];
const versX = (P: Plan, x: number) => (x < P.pos[0] ? -1 : 1);
const taille = (nom: string, c: number) => {
  const g = accessoire(nom).g;
  return [g[0].length * c, g.length * c] as const;
};
/** Un saut sur place, puis il se pose : le geste de la plupart des
 * versions courtes. */
function sautille(P: Plan, pose: Pose, d = 300, tient = 420) {
  P.sortir(80);
  P.saute(P.pos, d, 5, { poses: [{ barres: B_ET, pieds: "rentres", ...pose }, pose] });
  if (tient) P.tient(tient, pose);
  P.atterrit(90);
  P.retour = P.t;
}
/** Il reste dans sa place et change d'air un moment. */
function dansLeLogo(P: Plan, poses: [number, Pose][], airFin?: Pose) {
  P.sortir(60);
  for (const [d, pose] of poses) P.tient(d, pose);
  P.atterrit(60);
  P.retour = P.t;
  if (airFin) P.airFin = airFin;
}
/** Le haut du 3 du logo : la cartouche s'y enfonce. */
const hautDuTrois = (P: Plan): Point =>
  P.d.tete
    ? [P.d.logo[0] + 13.5 * P.d.c, P.d.logo[1] + P.d.c]
    : [P.d.logo[0] + 58.5 * P.d.c, P.d.logo[1]];
/** La cartouche s'enfonce dans le haut du 3, un quart à la fois. */
function enfoncer(P: Plan, t0: number, pas = 130) {
  const [x, y] = hautDuTrois(P);
  const [w] = taille("cartouche", P.d.c);
  ["cartouche", "cartouche-1", "cartouche-2", "cartouche-3"].forEach((d, k) => {
    const h = taille(d, P.d.c)[1];
    const ici: Point = [x - w / 2, y - h + P.d.c];
    P.objet("enfonce", t0 + k * pas, t0 + (k + 1) * pas, ici, ici, { dessin: d });
  });
  return t0 + 4 * pas;
}

/* ── La salle ─────────────────────────────────────────────────────────── */

const arrivee: DefScene = {
  complete(P) {
    const b = P.pt(`start-${P.joueur}`);
    const v = versX(P, b[0]);
    P.sortir(90, { ...ACCROUPI, oeil: "ouvert", rx: v, ry: 1 });
    P.tient(160, { oeil: "ouvert", rx: v, ry: 1 });
    P.aller(b, { pose: { oeil: "ouvert", rx: v } });
    P.base = { relief: reliefJoueur(P.joueur) };
    P.saute(b, 240, 14, {
      poses: [{ barres: B_ET, pieds: "rentres", oeil: "ouvert" }, { oeil: "ouvert" }],
    });
    P.atterrit(90);
    P.tient(
      520,
      [
        { oeil: "heureux", fx: tag(P) },
        { oeil: "heureux", dy: -1, fx: tag(P) },
      ],
      { fps: 4 },
    );
    P.rentre({ pose: { oeil: "ouvert" } });
  },
  courte(P) {
    P.base = { relief: reliefJoueur(P.joueur) };
    sautille(P, { oeil: "heureux", fx: tag(P) });
  },
  cle: (ctx) => ({
    pose: {
      relief: reliefJoueur(ctx.joueur ?? "1"),
      oeil: "heureux",
      fx: [{ t: "tag", j: ctx.joueur ?? "1" }],
    },
    tient: 2700,
  }),
};

const plus1: Bulle[] = [{ t: "plus1", c: "C" }];
const spectateur: DefScene = {
  complete(P) {
    P.sortir(80, { ...ACCROUPI, oeil: "ouvert", ry: -1 });
    P.tient(260, { oeil: "ouvert", ry: -1, rx: P.d.tete ? 1 : -1 });
    P.saute(P.pos, 280, 6, {
      poses: [
        { barres: B_ET, pieds: "rentres", oeil: "ouvert", ry: -1 },
        { oeil: "ouvert", ry: -1, fx: plus1 },
      ],
    });
    P.tient(520, { oeil: "ouvert", ry: -1, fx: plus1 });
    P.atterrit(80);
    P.retour = P.t;
  },
  courte: (P) => dansLeLogo(P, [[700, { oeil: "ouvert", ry: -1, fx: plus1 }]]),
  cle: () => ({ pose: { oeil: "ouvert", ry: -1, fx: plus1 }, tient: 2000 }),
};

const depart: DefScene = {
  complete(P) {
    const b = P.pt(`start-${P.joueur}`);
    const s = P.sol("panneau");
    const v = versX(P, b[0]);
    const Q: Point = [Math.max(s.x0 + 14, Math.min(s.x1 - 14, b[0] - v * 40)), s.y];
    P.sortir(80, { ...ACCROUPI, oeil: "grand", rx: v, ry: -1 });
    P.tient(140, { oeil: "grand", rx: v, ry: -1 });
    P.aller(Q, { pose: { oeil: "grand", ry: -1 } });
    const tA = P.t - 80;
    const e = `etiquette${P.joueur}`;
    const [w, h] = taille(e, P.d.c);
    const surTete = pointPorte(
      P.d,
      "tete",
      accessoire(e).g,
      { ...ACCROUPI, forme: P.forme },
      coinAin(P.d, Q),
    );
    P.objet("etiquette", Math.max(60, tA - 620), tA, [b[0] - w / 2, b[1] - h], surTete, {
      dessin: e,
      arc: 22,
    });
    P.objet("etiquette", tA, tA + 1080, null, null, { dessin: e, sur: "tete", efface: true });
    P.tient(
      280,
      [
        { penche: 1, oeil: "ouvert", ry: -1 },
        { penche: -1, oeil: "ouvert", ry: -1 },
      ],
      { fps: 8 },
    );
    P.tient(580, { oeil: "ouvert", ry: -1, prof: 2 });
    P.rentre();
  },
  courte(P) {
    const b = P.pt(`start-${P.joueur}`);
    const e = `etiquette${P.joueur}`;
    const [w, h] = taille(e, P.d.c);
    const ici: Point = [b[0] - w / 2, b[1] - h / 2];
    P.objet("etiquette", 0, 640, ici, ici, { dessin: e, arc: 8, efface: true });
    dansLeLogo(P, [[640, { oeil: "ouvert", rx: -1, ry: 1, prof: 2 }]]);
  },
  cle: () => ({ pose: { oeil: "ouvert", rx: -1, ry: 1, prof: 2 }, tient: 2200 }),
};

const attente: DefScene = {
  complete(P) {
    const rx = P.d.tete ? 0 : -1;
    dansLeLogo(P, [
      [240, { oeil: "mi", ry: -1 }],
      [920, { oeil: "ouvert", rx, ry: -1, penche: 1 }],
      [380, { oeil: "mi", prof: 4, relief: ["C", "M", "B", "B"], barres: B_ET }],
      [260, { oeil: "mi", barres: B_EC }],
    ]);
  },
  cle: () => null,
};

const attenteChargement: DefScene = {
  complete(P) {
    const pas: [number, Pose][] = [];
    for (let k = 0; k < 2; k++)
      pas.push([200, { pieds: "tape", oeil: "ouvert", rx: -1 }], [240, { oeil: "ouvert", rx: -1 }]);
    dansLeLogo(P, [...pas, [500, { oeil: "mi", rx: -1, ry: 1 }]]);
  },
  cle: () => null,
};

const chercher: DefScene = {
  complete(P) {
    const M = P.maison;
    P.sortir(90, { ...ACCROUPI, oeil: "ouvert", rx: 1 });
    P.tient(200, { oeil: "ouvert", rx: 1 });
    // Hors de la page, chez le serveur, et retour la cartouche sur la tête.
    P.bond([P.d.largeur + 40, M[1]], {
      d: 360,
      arc: 16,
      forme: "e",
      pose: { oeil: "ouvert", rx: 1 },
    });
    P.tient(240, {}, { trajet: true });
    const t0 = P.t;
    P.marche([M[0] + 26 * P.d.c, M[1]], 640, { poses: PORTE, fps: 6, forme: "3" });
    P.tient(160, { barres: B_ET, pieds: "pointe", oeil: "ouvert", ry: -1 });
    P.saute(M, 220, 6, { poses: [{ barres: B_ET, pieds: "rentres" }] });
    P.objet("cartouche", t0, P.t, null, null, { sur: "tete" });
    P.retour = P.t;
    enfoncer(P, P.t);
    P.airFin = { oeil: "heureux" };
  },
  courte(P) {
    const [x, y] = hautDuTrois(P);
    const [w, h] = taille("cartouche", P.d.c);
    P.objet(
      "cartouche",
      0,
      420,
      [x - w / 2, P.d.tete ? -h - 4 : y - h - 22],
      [x - w / 2, y - h + P.d.c],
      { ease: "entre" },
    );
    dansLeLogo(P, [[360, { oeil: "ouvert", ry: -1 }]]);
    enfoncer(P, 420, 110);
  },
  cle: () => ({ pose: { oeil: "ouvert", ry: -1 }, tient: 2200 }),
};

/** La première image : rien ne joue, la scène en cours est coupée. */
const premiereImage: DefScene = {
  complete(P) {
    P.t = 1;
  },
  cle: () => null,
};

const rebrancher: DefScene = {
  complete(P) {
    const c = P.d.c;
    const F = P.pt("fiche-sol");
    const B = P.pt("branche");
    const p = P.ancre("prise");
    const So: Point = [p.cx, p.cy];
    const [, fh] = taille("fiche", c);
    const [fw] = taille("fiche", c);
    // Après une coupe, il attendait dehors, la fiche au bout du 3.
    const tient = P.dehorsDe === "coupe";
    if (tient) P.garde.add("fiche");
    else {
      P.objet("fiche", 0, 1, [F[0] - fw / 2, F[1] - fh], [F[0] - fw / 2, F[1] - fh]);
      P.sortir(80, { ...ACCROUPI, oeil: "ouvert", rx: -1, ry: 1 });
      P.aller([F[0] + 16, F[1]], { pose: { oeil: "ouvert", ry: 1 } });
      P.tient(170, { barres: B_EC, penche: 1, oeil: "ouvert", ry: 1, forme: "3" });
      P.objet("fiche", 1, P.t, [F[0] - fw / 2, F[1] - fh], [F[0] - fw / 2, F[1] - fh]);
    }
    const tPrise = P.t;
    P.marche(B, Math.max(160, Math.min(420, Math.abs(B[0] - P.pos[0]) * 6)), {
      poses: POUSSE,
      fps: 6,
      forme: "3",
    });
    P.tient(200, { penche: 2, barres: B_EC, oeil: "ouvert", ry: 1 });
    const dans: Point = [So[0] - 2 * c, So[1] - fh / 2];
    P.objet("fiche", tPrise, P.t - 120, null, null, { sur: "bec" });
    P.objet("fiche", P.t - 120, P.t, null, "bec");
    const tIn = P.t;
    P.objet("fiche", tIn, tIn + 260, dans, dans);
    const etin: Point = [So[0] - 3.5 * c, So[1] - 3.5 * c];
    P.objet("etincelle", tIn, tIn + 220, etin, etin);
    P.tient(360, { oeil: "heureux" });
    P.rentre();
  },
  courte(P) {
    const c = P.d.c;
    const p = P.d.ancre("prise");
    if (p) {
      const [, fh] = taille("fiche", c);
      P.objet("fiche", 0, 380, [p.cx + 12, p.cy - fh / 2], [p.cx - 2 * c, p.cy - fh / 2], {
        ease: "sort",
      });
      const etin: Point = [p.cx - 3.5 * c, p.cy - 3.5 * c];
      P.objet("etincelle", 380, 600, etin, etin);
    }
    dansLeLogo(P, [
      [340, { oeil: "ouvert", ry: 1 }],
      [420, { oeil: "heureux" }],
    ]);
  },
  cle: () => ({ pose: { oeil: "heureux" }, tient: 2200 }),
};

const arret: DefScene = {
  reste: true,
  complete(P) {
    const Q = P.pt("toque");
    const I = P.d.image();
    if (!I) throw new Error("arrêt sans image");
    const marge = MARGE_PX + 0.6;
    const v = versX(P, Q[0]);
    P.sortir(80, { ...ACCROUPI, oeil: "grand", rx: v });
    P.aller(Q, { pose: { oeil: "ouvert", rx: v } });
    P.base = { relief: GRIS };
    P.tient(420, { pieds: "pas", oeil: "grand", rx: v, fx: fxE });
    // Il toque deux fois au cadre, de côté : jamais sur l'image.
    const bordX = I.droite + marge + 1;
    for (let k = 0; k < 2; k++) {
      P.tient(110, { oeil: "grand", rx: -1 });
      const tH = P.t + 60;
      P.tient(140, { penche: 2, oeil: "grand", rx: -1, forme: "3" });
      const ici: Point = [bordX, Q[1] - ((k ? 20 : 34) * P.d.c) / 1.5];
      P.objet(`toc${k}`, tH, tH + 1, ici, ici, { dessin: "toc", reste: true });
      P.tient(150, { oeil: "grand", rx: -1 });
      P.atterrit(90, { oeil: "grand" });
      if (!k) P.tient(270, { oeil: "grand", rx: v });
    }
    P.tient(360, { oeil: "grand", fx: fxQ });
    P.reste = true;
  },
  courte: (P) =>
    dansLeLogo(P, [[700, { relief: GRIS, oeil: "grand", fx: fxE }]], {
      relief: GRIS,
      oeil: "grand",
      fx: fxE,
    }),
  cle: () => ({ pose: { relief: GRIS, oeil: "grand", fx: fxE }, reste: true }),
};

const hoquet: DefScene = {
  complete(P) {
    P.sortir(60, { oeil: "mi" });
    P.saute(P.pos, 200, 7, {
      poses: [{ barres: B_ET, pieds: "rentres", oeil: "mi" }, { oeil: "mi" }],
    });
    P.atterrit(90, { oeil: "mi" });
    P.tient(260, { oeil: "mi" });
    P.saute(P.pos, 130, 3, { poses: [{ barres: B_ET, pieds: "rentres", oeil: "mi" }] });
    P.atterrit(90, { oeil: "mi" });
    P.tient(240, { oeil: "mi" });
    P.retour = P.t;
  },
  courte(P) {
    P.sortir(60, { oeil: "mi" });
    P.saute(P.pos, 180, 4, { poses: [{ barres: B_ET, pieds: "rentres", oeil: "mi" }] });
    P.atterrit(90, { oeil: "mi" });
    P.retour = P.t;
  },
  cle: () => ({ pose: { oeil: "mi" }, tient: 1800 }),
};

const SANS_RESEAU: Pose = { oeil: "grand", relief: ["s", "s", "s"], fx: fxQ };
const coupe: DefScene = {
  reste: true,
  complete(P) {
    const c = P.d.c;
    const p = P.ancre("prise");
    const R = P.pt("rattrape");
    const [, fh] = taille("fiche", c);
    P.sortir(70, { ...ACCROUPI, oeil: "grand", rx: -1, ry: 1 });
    P.tient(110, { oeil: "grand", rx: -1 });
    P.aller(R, { pose: { oeil: "grand", rx: -1 }, d: 300, arc: 10 });
    const tA = P.t - 80;
    const cible = pointPorte(
      P.d,
      "bec",
      accessoire("fiche").g,
      { ...ACCROUPI, forme: P.forme },
      coinAin(P.d, R),
    );
    const tPop = Math.max(40, tA - 520);
    P.objet("fiche", tPop, tA, [p.cx - 2 * c, p.cy - fh / 2], cible, { arc: 26 });
    P.objet("fiche", tA, tA + 1, null, null, { sur: "bec", reste: true });
    P.tient(
      200,
      [
        { penche: 1, oeil: "grand" },
        { penche: -1, oeil: "grand" },
      ],
      { fps: 8 },
    );
    P.tient(560, { ...SANS_RESEAU, oeil: "ouvert", ry: -1 });
    P.objet("fiche", tA + 1, P.t, null, null, { sur: "bec", reste: true });
    P.reste = true;
  },
  courte(P) {
    const c = P.d.c;
    const p = P.d.ancre("prise");
    if (p) {
      const [, fh] = taille("fiche", c);
      P.objet("fiche", 0, 520, [p.cx - 2 * c, p.cy - fh / 2], [p.cx + 10, p.cy - fh / 2], {
        arc: 10,
        efface: true,
      });
    }
    dansLeLogo(P, [[700, SANS_RESEAU]], SANS_RESEAU);
  },
  cle: () => ({ pose: SANS_RESEAU, reste: true }),
};

const DECROCHE: Pose = { oeil: "croix", sansRelief: true, fx: fxQ };
const SEP = [
  [1, 1],
  [1, 1],
  [1, 1],
] as const;
const decroche: DefScene = {
  reste: true,
  complete(P) {
    const D = P.pt("devant");
    const c = P.d.c;
    P.sortir(70, { ...ACCROUPI, oeil: "grand" });
    P.aller(D, { pose: { oeil: "grand" }, d: 260, arc: 10 });
    P.tient(220, { oeil: "grand", sep: SEP });
    const tD = P.t;
    const [x, y] = coinAin(P.d, P.pos);
    P.base = { sansRelief: true };
    P.objet("relief", tD, tD + 320, [x, y], [x + 12 * c, y + c], { ease: "entre", reste: true });
    P.tient(340, { oeil: "croix" });
    P.tient(300, { forme: "e", oeil: "ouvert", rx: 1, ry: 1 });
    P.tient(240, { forme: "e", penche: 2, oeil: "ouvert", rx: 1, ry: 1 });
    P.tient(520, { forme: "e", oeil: "croix", fx: fxQ });
    P.reste = true;
  },
  courte: (P) =>
    dansLeLogo(
      P,
      [
        [200, { oeil: "grand", sep: SEP }],
        [560, DECROCHE],
      ],
      DECROCHE,
    ),
  cle: () => ({ pose: DECROCHE, reste: true }),
};

const redemarre: DefScene = {
  reste: true,
  complete: (P) =>
    dansLeLogo(
      P,
      [
        [260, { barres: B_EC, gris: true, oeil: "ferme", pieds: "large" }],
        [300, { barres: B_PLAT, gris: true, oeil: "ferme", sansRelief: true, pieds: "large" }],
        [250, { oeil: "ferme", remplir: 0.34, prof: 1 }],
        [250, { oeil: "ferme", remplir: 0.67, prof: 2 }],
        [300, { oeil: "mi", remplir: 1, prof: 3 }],
        [820, { oeil: "mi", rx: -1 }],
        [140, { oeil: "ferme" }],
        [240, { oeil: "mi" }],
      ],
      { oeil: "mi" },
    ),
  courte: (P) =>
    dansLeLogo(
      P,
      [
        [300, { barres: B_EC, gris: true, oeil: "ferme" }],
        [420, { oeil: "mi" }],
      ],
      { oeil: "mi" },
    ),
  cle: () => ({ pose: { oeil: "mi" }, reste: true }),
};

const endort: DefScene = {
  reste: true,
  complete(P) {
    const Q = P.pt("siege");
    P.sortir(60, { oeil: "ouvert" });
    P.tient(460, { barres: B_ET, oeil: "ferme" });
    P.tient(220, { oeil: "mi" });
    P.aller(Q, { pose: { oeil: "mi" }, d: 420, arc: 14 });
    P.tient(260, { barres: B_EC, pieds: "assis", oeil: "mi" });
    P.tient(280, { barres: B_EC, pieds: "assis", penche: 1, oeil: "mi" });
    P.tient(460, { barres: B_EC, pieds: "assis", oeil: "ferme", fx: fxZ });
    P.reste = true;
  },
  courte: (P) =>
    dansLeLogo(
      P,
      [
        [420, { barres: B_ET, oeil: "ferme" }],
        [400, { oeil: "mi", fx: fxZ }],
      ],
      { oeil: "mi", fx: fxZ },
    ),
  cle: () => ({ pose: { oeil: "ferme", fx: fxZ }, reste: true }),
};

/** Prêt : `mode` « un » (un joueur, `joueur`), « tous », ou « reveil »
 * (« Je reste » : la salle ne ferme plus). */
const pret: DefScene = {
  complete(P) {
    if (P.ctx.mode === "reveil") {
      P.sortir(60);
      P.tient(200, {
        barres: P.depuisDehors ? B_EC : undefined,
        pieds: P.depuisDehors ? "assis" : "repos",
        oeil: "grand",
        fx: [{ t: "excl", c: "Y" }],
      });
      if (P.depuisDehors) {
        P.rentre({ pose: { oeil: "heureux" } });
        return;
      }
      P.saute(P.pos, 240, 6, { poses: [{ barres: B_ET, pieds: "rentres", oeil: "heureux" }] });
      P.atterrit(80);
      P.retour = P.t;
      return;
    }
    if (P.ctx.mode !== "tous") {
      P.base = { relief: reliefJoueur(P.joueur) };
      sautille(P, { oeil: "heureux" }, 260, 0);
      return;
    }
    const Q = P.pt("public");
    P.sortir(70, { ...ACCROUPI, oeil: "ouvert", rx: -1 });
    P.aller(Q, { pose: { oeil: "ouvert", rx: -1 }, forme: "3" });
    // Un hochement par « PRÊT ! » : quatre tiennent dans les 2,75 s.
    for (let i = 0; i < 4; i++) {
      P.tient(110, { forme: "3", oeil: "ouvert", rx: -1, ry: 1, dy: 1 });
      P.tient(i === 3 ? 220 : 130, { forme: "3", oeil: "ouvert", rx: -1, ry: 1 });
    }
    P.base = { prof: 4, relief: ["4", "3", "2", "1"] };
    P.saute(P.pos, 300, 12, { poses: HEUREUX });
    P.atterrit(90, { oeil: "heureux" });
    P.rentre();
  },
  courte(P) {
    if (P.ctx.mode === "reveil" || P.ctx.mode !== "tous") {
      pret.complete(P);
      return;
    }
    P.base = { prof: 4, relief: ["4", "3", "2", "1"] };
    sautille(P, { oeil: "heureux" }, 280, 0);
  },
  cle: (ctx) =>
    ctx.mode === "reveil"
      ? { pose: { oeil: "ouvert", fx: [{ t: "excl", c: "Y" }] }, tient: 1600 }
      : {
          pose: {
            oeil: "heureux",
            relief: ctx.mode === "tous" ? ["4", "3", "2", "1"] : reliefJoueur(ctx.joueur ?? "1"),
            prof: ctx.mode === "tous" ? 4 : 3,
          },
          tient: 2000,
        },
};

const QUATRE: Pose = { oeil: "heureux", prof: 4, relief: ["4", "3", "2", "1"], fx: fxEtoile() };
const fier: DefScene = {
  complete(P) {
    const b = ([1, 2, 3, 4] as const).map((j) => P.pt(`start-${j}`));
    P.sortir(70, { ...ACCROUPI, oeil: "ouvert", rx: -1 });
    P.aller(b[0], { pose: { oeil: "ouvert" }, prise: 60 });
    const couleurs: string[] = [];
    for (let j = 1; j <= 4; j++) {
      if (j > 1)
        P.saute(b[j - 1], 200, 10, { poses: [{ barres: B_ET, pieds: "rentres", oeil: "ouvert" }] });
      couleurs.unshift(String(j));
      P.base = { prof: j, relief: couleurs.slice() };
      P.atterrit(90, { oeil: "ouvert" });
    }
    P.tient(
      420,
      [
        { oeil: "heureux", fx: fxEtoile() },
        { oeil: "heureux", dy: -1, fx: fxEtoile() },
      ],
      { fps: 5 },
    );
    P.rentre({ pose: { oeil: "ouvert" } });
  },
  courte(P) {
    P.base = { prof: 4, relief: ["4", "3", "2", "1"] };
    sautille(P, { oeil: "heureux", fx: fxEtoile() }, 280, 520);
  },
  cle: () => ({ pose: QUATRE, tient: 2200 }),
};

const DORT: Pose = { relief: ["s", "s", "s"], corps: "7", oeil: "ferme" };
const dort: DefScene = {
  complete(P) {
    P.sortir(60);
    if (P.depuisDehors) P.aller(P.maison, { pose: { oeil: "mi" }, d: 420, arc: 8 });
    P.tient(420, { barres: B_ET, oeil: "ferme" });
    P.tient(320, { barres: B_EC, pieds: "large", ...DORT });
    P.tient(420, { ...DORT, fx: fxZ });
    P.tient(380, { ...DORT, fx: [{ t: "Z", c: "W" }] });
    P.retour = P.t;
    P.airFin = { eteint: true };
  },
  courte(P) {
    P.sortir(60);
    if (P.depuisDehors) P.aller(P.maison, { pose: { oeil: "mi" }, d: 380, arc: 8 });
    P.tient(460, { ...DORT, fx: fxZ });
    P.retour = P.t;
    P.airFin = { eteint: true };
  },
  cle: () => ({ pose: { ...DORT, fx: fxZ }, reste: true }),
};

/* ── Le salon ─────────────────────────────────────────────────────────── */

const ouvre: DefScene = {
  complete(P) {
    const z = P.ancre("salles");
    const L: Point = [z.x + 70, z.y + 8];
    P.sortir(90);
    P.bond(L, { pose: { oeil: "ouvert", ry: 1 }, d: 440, arc: 22 });
    P.saute(L, 260, 10, { poses: HEUREUX });
    P.atterrit(90, { oeil: "heureux" });
    P.tient(
      420,
      [
        { oeil: "heureux", fx: fxEtoile("G") },
        { oeil: "heureux", dy: -1, fx: fxEtoile("G") },
      ],
      { fps: 5 },
    );
    P.rentre();
  },
  courte: (P) => sautille(P, { oeil: "heureux" }, 300, 0),
  cle: () => ({ pose: { oeil: "heureux" }, tient: 1800 }),
};

const range: DefScene = {
  complete(P) {
    const tk = P.ancre("regle-carnet");
    const debut: Point = [tk.droite - 10, tk.y];
    P.sortir(90);
    P.bond(debut, { pose: { oeil: "ouvert" }, d: 440, arc: 14, forme: "3" });
    P.marche([debut[0] - 44, debut[1]], 480, { forme: "3", poses: POUSSE, fps: 6 });
    P.tient(260, { oeil: "heureux" });
    P.rentre();
  },
  courte: (P) => sautille(P, { oeil: "heureux" }, 300, 0),
  cle: () => ({ pose: { oeil: "heureux" }, tient: 1800 }),
};

/** Le dépôt : la boîte tombe dans la zone, devant ses mots. */
function chute(P: Plan) {
  const c = P.d.c;
  const dp = P.ancre("depot");
  const [bw, bh] = taille("boite", c);
  const Z = P.ancre("depot-mot").y - (MARGE_PX + 0.6) / 2 - 2.5;
  const xb = dp.x + 100;
  P.objet("boite", 0, 380, [xb - bw / 2, dp.y - bh], [xb - bw / 2, Z - bh], { ease: "entre" });
  return { xb, Z, bw, bh };
}
const depot: DefScene = {
  complete(P) {
    const bas = P.sol("etagere-bas");
    const haut = P.sol("etagere-haut");
    const spot = P.ancre("place-libre");
    const { xb, Z, bw, bh } = chute(P);
    const pose: Point = [xb - bw / 2, Z - bh];
    P.objet("boite", 380, 1000, pose, pose);
    P.sortir(90, { oeil: "ouvert", ry: 1 });
    P.bond([xb + 26, Z], { pose: { oeil: "ouvert", ry: 1 }, d: 430, arc: 16 });
    P.marche([xb, Z], 160, { forme: "3" });
    P.tient(120, { barres: B_EC, oeil: "ouvert", ry: 1 });
    const tP = P.t;
    P.objet("boite", 1000, tP, pose, pose);
    P.tient(160, { barres: B_EC, pieds: "large", oeil: "mi" });
    P.objet("boite", tP, tP + 160, pose, "tete");
    P.bond([bas.x0 + 120, bas.y], { pose: { barres: B_EC, oeil: "ouvert" }, d: 360, arc: 16 });
    P.objet("boite", tP + 160, P.t, null, null, { sur: "tete" });
    P.tient(200, { barres: B_ET, pieds: "pointe", oeil: "ouvert", ry: -1 });
    P.objet("boite", P.t - 200, P.t, null, [spot.x, haut.y - bh], { reste: true });
    P.tient(220, { oeil: "heureux" });
    P.rentre();
  },
  courte(P) {
    const dp = P.ancre("depot");
    const haut = P.sol("etagere-haut");
    const spot = P.ancre("place-libre");
    const [bw, bh] = taille("boite", P.d.c);
    P.objet("boite", 0, 600, [dp.x + 100 - bw / 2, dp.y - bh], [spot.x, haut.y - bh], { arc: 30 });
    sautille(P, { oeil: "heureux" }, 300, 0);
  },
  cle: () => ({ pose: { oeil: "heureux" }, tient: 1800 }),
};

const refus: DefScene = {
  complete(P) {
    const { xb, Z, bw, bh } = chute(P);
    const pose: Point = [xb - bw / 2, Z - bh];
    P.objet("boite", 380, 1500, pose, pose);
    P.sortir(90, { oeil: "ouvert", ry: 1 });
    P.bond([xb - 34, Z], { pose: { oeil: "ouvert", ry: 1 }, d: 420, arc: 16, forme: "e" });
    P.tient(380, { forme: "e", penche: 2, oeil: "ouvert", rx: 1, ry: 1 });
    P.tient(300, { forme: "e", oeil: "ouvert", rx: 1, fx: fxQ });
    const tR = P.t;
    P.objet("boite", tR, tR + 380, pose, [pose[0] + 40, pose[1]], { efface: true, ease: "sort" });
    P.tient(240, { forme: "e", barres: B_EC, penche: 2, fx: fxQ });
    P.rentre();
  },
  courte: (P) => dansLeLogo(P, [[620, { oeil: "ouvert", rx: -1, ry: 1, fx: fxQ }]]),
  cle: () => ({ pose: { oeil: "ouvert", rx: -1, ry: 1, fx: fxQ }, tient: 2200 }),
};

const demo: DefScene = {
  complete(P) {
    const mi = P.ancre("salles");
    const sens = P.ctx.mode === "retour" ? -1 : 1;
    const x0 = sens > 0 ? mi.x + 22 : mi.droite - 22;
    const x1 = sens > 0 ? mi.droite - 22 : mi.x + 22;
    P.sortir(80);
    P.bond([x0, mi.bas], { pose: { oeil: "ouvert" }, d: 400, arc: 18 });
    P.marche([x1, mi.bas], 1500, { fps: 8 });
    P.rentre({ d: 380 });
  },
  cle: () => null,
};

/** Les variantes du salon : dans le logo du rail, sans trajet. */
const auSalon = (poses: [number, Pose][], cle: Pose): DefScene => ({
  complete: (P) => dansLeLogo(P, poses),
  cle: () => ({ pose: cle, tient: 2000 }),
});

/* ── Les scènes de la page ────────────────────────────────────────────── */

/** Un clic sur Aïn, au niveau Tout : il se retourne en Ɛ, content. */
const clic: DefScene = {
  complete(P) {
    P.sortir(90);
    P.saute(P.pos, 300, 5, {
      poses: [
        { barres: B_ET, pieds: "rentres", forme: "etroit" },
        { forme: "e", oeil: "heureux" },
      ],
    });
    P.tient(320, { forme: "e", oeil: "heureux" });
    P.tient(120, { forme: "etroit" });
    P.tient(150, { forme: "3", oeil: "ouvert" });
    P.atterrit(90);
    P.retour = P.t;
  },
  cle: () => null,
};
/** Le retour au logo quand l'image revient d'une panne : un bond depuis là
 * où il attendait, rien de plus. */
const retour: DefScene = {
  complete(P) {
    if (P.depuisDehors) {
      P.rentre({ pose: { oeil: "ouvert" } });
      return;
    }
    P.t = 1;
  },
  cle: () => null,
};

/** Les 27 scènes (17 de la salle, 10 du salon), et les deux de la page. */
export const SCENES_AIN = {
  arrivee,
  spectateur,
  depart,
  attente,
  "attente-chargement": attenteChargement,
  chercher,
  "premiere-image": premiereImage,
  rebrancher,
  arret,
  hoquet,
  coupe,
  decroche,
  redemarre,
  endort,
  pret,
  fier,
  dort,
  ouvre,
  range,
  depot,
  refus,
  demo,
  "rebrancher-salon": auSalon(
    [
      [700, { oeil: "ouvert", rx: 1, ry: 1 }],
      [420, { oeil: "heureux" }],
    ],
    { oeil: "heureux" },
  ),
  "arret-salon": auSalon([[700, { oeil: "grand", fx: fxE }]], { oeil: "grand", fx: fxE }),
  "decroche-salon": auSalon(
    [
      [220, { oeil: "grand", sep: SEP }],
      [760, DECROCHE],
    ],
    DECROCHE,
  ),
  "redemarre-salon": auSalon(
    [
      [280, { gris: true, oeil: "ferme", barres: B_EC }],
      [240, { oeil: "ferme", remplir: 0.5, prof: 1 }],
      [300, { oeil: "mi", remplir: 1, prof: 3 }],
    ],
    { oeil: "mi" },
  ),
  "dort-salon": auSalon(
    [
      [420, { barres: B_ET, oeil: "ferme" }],
      [520, { oeil: "ferme", fx: fxZ }],
    ],
    { oeil: "ferme", fx: fxZ },
  ),
  clic,
  retour,
} satisfies Record<string, DefScene>;
export type IdAin = keyof typeof SCENES_AIN;

/** Les scènes qui ont une variante au salon : jouées dans un logo du salon,
 * la variante prend leur place. */
export const AU_SALON: Partial<Record<IdAin, IdAin>> = {
  rebrancher: "rebrancher-salon",
  arret: "arret-salon",
  decroche: "decroche-salon",
  redemarre: "redemarre-salon",
  dort: "dort-salon",
};

export type Version = "complete" | "courte";
export type Choix =
  | { plan: Plan; version: Version | "pose"; refus: string[] }
  | { plan: null; version: "cle"; refus: string[] };

/**
 * Le plan d'une scène, avec ses replis : la version demandée, puis la
 * courte, puis la pose animée dans le logo. Chaque refus est dit (une ancre
 * absente, un contact). `null` : la pose clé, sans mouvement.
 */
export function planifier(
  id: IdAin,
  version: Version,
  d: Decor,
  ctx: Contexte = {},
  dehors: Dehors | null = null,
): Choix {
  const def: DefScene = SCENES_AIN[id];
  const essais: Version[] = version === "complete" || !def.courte ? ["complete"] : ["courte"];
  if (version === "complete" && def.courte) essais.push("courte");
  const raisons: string[] = [];
  for (const v of essais) {
    const faire = v === "courte" ? def.courte : def.complete;
    if (!faire) continue;
    const P = new Plan(d, id, ctx, dehors);
    try {
      faire(P);
    } catch (e) {
      if (!(e instanceof SansAncre)) throw e;
      raisons.push(`${v} : pas d'ancre « ${e.message} »`);
      continue;
    }
    if (verifier(P)) return { plan: P, version: v, refus: raisons };
    raisons.push(`${v} : ${P.refus}`);
  }
  const cle = def.cle?.(ctx);
  if (cle) {
    const P = new Plan(d, id, ctx, dehors);
    if (dehors) P.rentre();
    sautille(P, cle.pose, 260, 700);
    if (cle.reste) P.airFin = cle.pose;
    if (verifier(P)) return { plan: P, version: "pose", refus: raisons };
    raisons.push(`pose : ${P.refus}`);
  }
  return { plan: null, version: "cle", refus: raisons };
}
