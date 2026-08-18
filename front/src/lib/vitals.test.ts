/**
 * Le relevé du navigateur, et les deux façons dont il pourrait mentir.
 *
 * Un relevé est le genre de code qui a l'air trop simple pour se tromper, et qui
 * se trompe exactement là où on ne regarde pas: à la remise à zéro des compteurs
 * et à la première fenêtre. Les deux ont leur test.
 */
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../media/session";
import { Struggling, Trailing, vitals, worthWriting } from "./vitals";

/** Un instantané complet, dont chaque test ne change que ce qui l'intéresse. */
function snap(video: Partial<Snapshot["video"]> = {}, rest: Partial<Snapshot> = {}): Snapshot {
  return {
    video: {
      painted: 0,
      shown: 0,
      undecoded: 0,
      stalls: 0,
      restarts: 0,
      keyFramesAsked: 0,
      slackMs: 0,
      starved: 0,
      skipped: 0,
      connected: true,
      reconnects: 0,
      heldRefreshes: { p05: 4, p50: 4, p95: 4 },
      waitMs: { p50: 0, p95: 0 },
      gapMs: { p50: 16, p95: 17, max: 20 },
      jitterMs: 0,
      room: 8,
      picture: { width: 1216, height: 896 },
      half: false,
      sourceHz: 60,
      refreshHz: 240,
      backlog: 2,
      fastestLag: 12,
      addedMs: 0,
      ...video,
    },
    sound: {
      state: "running",
      chunks: 0,
      gaps: 0,
      playedSeconds: 0,
      leadMs: 90,
      sampleRate: 48000,
      outputMs: 10,
      browserMs: 20,
      fastestLag: 8,
      ...rest.sound,
    },
    input: {
      port: 1,
      watching: false,
      refused: false,
      sent: 0,
      padId: null,
      padLayout: null,
      learning: null,
      pressed: [],
      displaced: false,
      players: 4,
      busy: [true, false, false, false],
      capturing: null,
      profile: null,
      keys: {} as Snapshot["input"]["keys"],
      pads: [],
      using: null,
      ...rest.input,
    },
    soundGapMs: null,
  };
}

describe("le relevé d'une fenêtre", () => {
  it("compte ce qui s'est passé PENDANT la fenêtre, pas depuis l'ouverture", () => {
    const before = snap({ shown: 41_230, painted: 41_180, skipped: 50 });
    const now = snap({ shown: 41_830, painted: 41_778, skipped: 52 });

    const sample = vitals(now, before, 10_000);

    expect(sample.vues).toBe(600);
    expect(sample.peintes).toBe(598);
    expect(sample.jetées).toBe(2);
    expect(sample.s).toBe(10);
  });

  it("prend les totaux quand c'est la première fenêtre", () => {
    // Le jumeau du précédent: sans lui, un relevé qui rendrait toujours zéro
    // faute de comparaison satisferait le test d'au-dessus.
    const sample = vitals(snap({ shown: 600, painted: 598 }), null, 10_000);

    expect(sample.vues).toBe(600);
    expect(sample.peintes).toBe(598);
  });

  it("ne rend jamais un écart négatif quand les compteurs repartent de zéro", () => {
    // Ce qui arrive à chaque changement de jeu et à chaque coupure: le flux se
    // rouvre et la page recompte. Une fenêtre qui enjambe la reprise annoncerait
    // « moins quarante mille images peintes », et un chiffre absurde est un
    // journal qu'on cesse de croire.
    const before = snap({ shown: 41_230, painted: 41_180 });
    const now = snap({ shown: 12, painted: 11, reconnects: 1 });

    const sample = vitals(now, before, 10_000);

    expect(sample.vues).toBe(0);
    expect(sample.peintes).toBe(0);
    expect(sample.rouvertes).toBe(1);
  });

  it("prend les jauges telles quelles, parce que ce sont des états", () => {
    const sample = vitals(
      snap({ jitterMs: 47.4, addedMs: 180, room: 14, backlog: 9, half: true }),
      snap({ jitterMs: 0, addedMs: 0, room: 8, backlog: 2 }),
      10_000,
    );

    expect(sample.gigue).toBe(47);
    expect(sample.horaire).toBe(180);
    expect(sample.file).toBe(14);
    expect(sample.encours).toBe(9);
    expect(sample.demi).toBe(true);
  });

  it("dit le format que le DÉCODEUR a produit", () => {
    // Et pas celui qu'on a demandé: c'est la seule mesure qui ne peut pas
    // mentir sur ce qui arrive vraiment chez quelqu'un.
    const sample = vitals(snap({ picture: { width: 608, height: 448 }, half: true }), null, 10_000);

    expect(sample.format).toBe("608x448");
  });

  it("dit zéro de retard sur une liaison qui n'en demande pas", () => {
    // Le jumeau du précédent, et la raison pour laquelle ce champ a changé: la
    // page publiait son ANCRE, un instant pris sur l'horloge du worker, dont
    // celle du navigateur est décalée. Une séance saine s'écrivait
    // « horaire -15268 ms », ce qui n'a jamais voulu dire quoi que ce soit.
    expect(vitals(snap({ addedMs: 0 }), null, 10_000).horaire).toBe(0);
  });
});

describe("ce qui mérite d'être écrit", () => {
  it("écrit une fenêtre saine, parce que savoir que tout allait bien date un problème", () => {
    expect(worthWriting(vitals(snap({ shown: 600, painted: 600 }), null, 10_000))).toBe(true);
  });

  it("n'écrit pas une fenêtre sans une seule image", () => {
    // Un onglet en arrière-plan produit six relevés vides par minute, qui
    // noieraient les vrais dans un journal gardé deux jours.
    expect(worthWriting(vitals(snap(), null, 10_000))).toBe(false);
  });
});

describe("la trace des deux dernières minutes", () => {
  /** Une trace nourrie d'une seconde par tour, chacune valant `each`. */
  function run(seconds: number, each: Partial<Snapshot["video"]> = {}, step = 1000): Trailing {
    const trail = new Trailing();
    let total = { shown: 0, painted: 0, skipped: 0 };
    for (let tick = 0; tick <= seconds; tick += 1) {
      total = {
        shown: total.shown + (each.shown ?? 60),
        painted: total.painted + (each.painted ?? 60),
        skipped: total.skipped + (each.skipped ?? 0),
      };
      trail.push(snap({ ...each, ...total }), tick * step);
    }
    return trail;
  }

  it("date chaque seconde par rapport au signalement, donc en négatif", () => {
    const rows = run(5).trail(5000).lignes;

    // Cinq lignes pour six pousses: la première pose le point de départ.
    expect(rows.map((row) => row[0])).toEqual([-4, -3, -2, -1, 0]);
  });

  it("ne remonte pas plus loin que deux minutes", () => {
    const rows = run(300).trail(300_000).lignes;

    expect(rows.length).toBeLessThanOrEqual(121);
    expect(rows[0]?.[0]).toBeGreaterThanOrEqual(-120);
  });

  it("ne retient jamais plus de deux minutes en mémoire", () => {
    // Sur la DURÉE et non sur le nombre de lignes. Le cas qui distingue les deux
    // est l'onglet en arrière-plan, dont le navigateur ralentit les minuteurs à
    // une fois par minute: couper au nombre de lignes lui ferait garder deux
    // heures en croyant garder deux minutes.
    //
    // Assertion sur la MÉMOIRE et pas sur ce qui est rendu, parce que la lecture
    // filtre une seconde fois: le premier jet de ce test regardait la sortie, et
    // remplacer la coupe par « garder les cent vingt dernières » le laissait
    // vert.
    const minutes = run(20, {}, 60_000);
    expect(minutes.held()).toBeLessThanOrEqual(3);

    const seconds = run(600);
    expect(seconds.held()).toBeLessThanOrEqual(121);
  });

  it("ne rend jamais une ligne plus vieille que deux minutes", () => {
    // Le cas qui distingue les deux: un onglet en arrière-plan, dont le
    // navigateur ralentit les minuteurs à une fois par minute. Couper au nombre
    // de lignes lui ferait remonter deux heures en croyant remonter deux
    // minutes, et la trace mentirait sur ce qu'elle couvre.
    const rows = run(20, {}, 60_000).trail(20 * 60_000).lignes;

    expect(rows.every((row) => (row[0] ?? -9999) >= -120)).toBe(true);
  });

  it("ramène les compteurs à la seconde quand un tour arrive en retard", () => {
    // Sans ça, la seconde qui suit un retour au premier plan annonce « 1800
    // images peintes » à côté de voisines qui en annoncent soixante, et
    // l'échelle de toute la trace est perdue.
    const late = run(3, {}, 30_000).trail(90_000).lignes;

    expect(late.every((row) => row[1] === 2)).toBe(true);
  });

  it("garde le compte des images JETÉES tel quel, parce que c'en est un", () => {
    const rows = run(4, { skipped: 3 }).trail(4000).lignes;

    expect(rows.map((row) => row[3])).toEqual([3, 3, 3, 3]);
  });

  it("tient dans ce qu'une socket accepte", () => {
    // La borne du salon est de seize kilo-octets pour un signalement. Une trace
    // pleine doit y tenir avec de la marge, sinon le repère qu'on vient de poser
    // est refusé au moment précis où il servait.
    const full = JSON.stringify(run(200).trail(200_000));

    expect(full.length).toBeLessThan(8_000);
  });

  it("ne rend rien tant qu'aucune seconde n'est passée", () => {
    // Le jumeau: une trace qui rendrait une ligne dès la première pousse la
    // remplirait des totaux depuis l'ouverture de la page.
    const trail = new Trailing();
    trail.push(snap({ shown: 41_000, painted: 40_000 }), 1000);

    expect(trail.trail(1000).lignes).toEqual([]);
  });
});

describe("proposer le format réduit", () => {
  const over = (video: Partial<Snapshot["video"]>) =>
    vitals(snap({ shown: 600, painted: 600, ...video }), null, 10_000);

  it("ne dit rien sur une fenêtre saine", () => {
    const watching = new Struggling();
    expect(watching.saw(over({}))).toBe(false);
    expect(watching.saw(over({}))).toBe(false);
  });

  it("attend deux fenêtres mauvaises d'affilée", () => {
    // Une seule mauvaise fenêtre arrive à tout le monde, et une page qui
    // propose de baisser la qualité au premier hoquet est une page qu'on
    // apprend à ignorer.
    const watching = new Struggling();
    expect(watching.saw(over({ skipped: 14 }))).toBe(false);
    expect(watching.saw(over({ skipped: 28 }))).toBe(true);
  });

  it("repart de zéro quand une bonne fenêtre s'intercale", () => {
    const watching = new Struggling();
    expect(watching.saw(over({ skipped: 14 }))).toBe(false);
    expect(watching.saw(over({}))).toBe(false);
    expect(watching.saw(over({ skipped: 28 }))).toBe(false);
  });

  it("compte une file vide plus vite que des images jetées", () => {
    // Les deux ne disent pas la même chose: une file vide veut dire qu'il
    // n'arrivait plus rien, une image jetée qu'il en arrivait trop à la fois.
    const watching = new Struggling();
    watching.saw(over({ starved: 2 }));
    expect(watching.saw(over({ starved: 4 }))).toBe(true);
  });

  it("ne propose rien à qui est déjà en format réduit", () => {
    const watching = new Struggling();
    watching.saw(over({ skipped: 14, half: true }));
    expect(watching.saw(over({ skipped: 28, half: true }))).toBe(false);
  });

  it("n'en reparle plus une fois la question réglée", () => {
    // Le jumeau qui compte: une proposition qu'on décline et qui revient est
    // une proposition qu'on finit par ne plus lire.
    const watching = new Struggling();
    watching.saw(over({ skipped: 14 }));
    expect(watching.saw(over({ skipped: 28 }))).toBe(true);
    watching.settled();
    watching.saw(over({ skipped: 42 }));
    expect(watching.saw(over({ skipped: 56 }))).toBe(false);
  });
});
