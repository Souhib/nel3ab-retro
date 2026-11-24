/**
 * Le relevé du navigateur, et les deux façons dont il pourrait mentir.
 *
 * Un relevé est le genre de code qui a l'air trop simple pour se tromper, et qui
 * se trompe exactement là où on ne regarde pas: à la remise à zéro des compteurs
 * et à la première fenêtre. Les deux ont leur test.
 */
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../media/session";
import {
  HiddenTime,
  COLLAPSE_MS,
  GRACE_WINDOWS,
  PAD_NAME_MAX,
  QUIET_WINDOWS,
  rough,
  Struggling,
  Trailing,
  vitals,
  worthWriting,
} from "./vitals";
import { sourceRate } from "../media/video";

/** Un instantané complet, dont chaque test ne change que ce qui l'intéresse. */
function snap(video: Partial<Snapshot["video"]> = {}, rest: Partial<Snapshot> = {}): Snapshot {
  return {
    video: {
      painted: 0,
      fastestLag: null,
      shown: 0,
      undecoded: 0,
      stalls: 0,
      restarts: 0,
      overloaded: false,
      keyFramesAsked: 0,
      slackMs: 0,
      starved: 0,
      skipped: 0,
      connected: true,
      reconnects: 0,
      paintedSince: 0,
      awaitingRestart: false,
      heldRefreshes: { p05: 4, p50: 4, p95: 4 },
      waitMs: { p50: 0, p95: 0 },
      gapMs: { p50: 16, p95: 17, max: 20 },
      jitterMs: 0,
      room: 8,
      picture: { width: 1216, height: 896 },
      dark: false,
      probeMs: { p50: 0, p95: 0, max: 0 },
      half: false,
      halfDenied: false,
      sourceHz: 60,
      sinceArrivalMs: 16,
      sinceHeardMs: 16,
      sinceUnitMs: 16,
      units: 0,
      sincePaintedMs: 16,
      sinceOpenedMs: 60_000,
      downForMs: null,
      sinceStartedMs: 60_000,
      refreshHz: 240,
      backlog: 2,
      addedMs: 0,
      ...video,
    },
    sound: {
      state: "running",
      chunks: 0,
      sinceChunkMs: null,
      gaps: 0,
      playedSeconds: 0,
      leadMs: 90,
      sampleRate: 48000,
      outputMs: 10,
      browserMs: 20,
      unlocked: "joue",
      gain: 0.7,
      output: 0,
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
      lesson: null,
      lessonResult: null,
      suspendu: null,
      neutre: null,
      activite: { suivies: new Set(), actives: new Set() },
      pressed: [],
      displaced: false,
      players: 4,
      busy: [true, false, false, false],
      mics: [false, false, false, false],
      deciding: false,
      closingIn: 0,
      capturing: null,
      profile: null,
      keys: {} as Snapshot["input"]["keys"],
      keyProfiles: ["défaut"],
      keyProfile: "défaut",
      lockedProfiles: [],
      pads: [],
      using: null,
      roundTripMs: null,
      sinceHeardMs: null,
      ...rest.input,
    },
    soundGapMs: null,
    soundSyncMs: 0,
    mic: "off",
    padOnly: false,
    liaison: { etat: "ok" },
    couvertureVue: 0,
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

describe("ce que la boîte noire lit dans un relevé", () => {
  const pad = (input: Partial<Snapshot["input"]>) =>
    snap({}, { input: { ...snap().input, ...input } });

  it("dit l'écart entre deux images reçues, arrondi", () => {
    const sample = vitals(snap({ gapMs: { p50: 16.4, p95: 18.6, max: 104.7 } }), null, 10_000);

    expect(sample.arrivées).toEqual([16, 19, 105]);
  });

  it("dit l'aller-retour de la manette et le nom de celle qui joue", () => {
    const xbox = "Xbox 360 Controller (XInput STANDARD GAMEPAD)";
    const sample = vitals(pad({ roundTripMs: 23, padId: xbox }), null, 10_000);

    expect(sample.manette.allerRetour).toBe(23);
    expect(sample.manette.modèle).toBe(xbox);
  });

  it("dit nul, et pas zéro, sans mesure ni manette", () => {
    // Le jumeau: un zéro annoncerait une liaison parfaite et une manette sans
    // nom là où il n'y a ni mesure ni manette.
    const sample = vitals(pad({ roundTripMs: null, padId: null }), null, 10_000);

    expect(sample.manette.allerRetour).toBeNull();
    expect(sample.manette.modèle).toBeNull();
  });

  it("coupe un nom de manette trop long, et le relevé tient dans la borne du salon", () => {
    const sample = vitals(pad({ padId: "x".repeat(500) }), null, 10_000, {
      visible: false,
      cachéeMs: 10_000,
    });

    expect(sample.manette.modèle).toHaveLength(PAD_NAME_MAX);
    // `VITALS_MAX` côté salon: deux kilo-octets, en caractères une fois remis en JSON.
    expect(JSON.stringify(sample).length).toBeLessThan(2048);
  });

  it("porte l'état de l'onglet quand la page le donne", () => {
    const sample = vitals(snap(), null, 10_000, { visible: false, cachéeMs: 4000 });

    expect(sample.page).toEqual({ visible: false, cachéeMs: 4000 });
  });

  it("n'invente pas d'onglet quand on ne le donne pas", () => {
    // La trace fine ne mesure pas l'onglet: un `visible: true` par défaut y
    // mentirait sur une page qui était peut-être cachée.
    expect("page" in vitals(snap(), null, 10_000)).toBe(false);
  });
});

describe("le temps caché de l'onglet", () => {
  it("compte le temps entre caché et montré", () => {
    const hidden = new HiddenTime(false, 0);
    hidden.change(true, 1000);
    hidden.change(false, 4000);

    expect(hidden.take(10_000)).toBe(3000);
  });

  it("repart de zéro après une lecture", () => {
    const hidden = new HiddenTime(false, 0);
    hidden.change(true, 1000);
    hidden.change(false, 4000);
    hidden.take(10_000);

    expect(hidden.take(20_000)).toBe(0);
  });

  it("ne compte rien pour un onglet resté visible", () => {
    expect(new HiddenTime(false, 0).take(10_000)).toBe(0);
  });

  it("compte un onglet encore caché jusqu'à la lecture, sans le recompter ensuite", () => {
    const hidden = new HiddenTime(true, 0);

    expect(hidden.take(10_000)).toBe(10_000);
    expect(hidden.take(20_000)).toBe(10_000);
    hidden.change(false, 25_000);
    expect(hidden.take(30_000)).toBe(5000);
  });

  it("ne compte pas deux fois un état répété", () => {
    const hidden = new HiddenTime(false, 0);
    hidden.change(true, 1000);
    hidden.change(true, 5000);
    hidden.change(false, 6000);
    hidden.change(false, 9000);

    expect(hidden.take(10_000)).toBe(5000);
  });

  it("laisse un signalement lire sans voler la fenêtre du relevé suivant", () => {
    const hidden = new HiddenTime(false, 0);
    hidden.change(true, 0);
    hidden.change(false, 2000);

    expect(hidden.peek(3000)).toBe(2000);
    expect(hidden.take(10_000)).toBe(2000);
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

  it("écrit la fenêtre vide d'un jeu qui tourne et dont l'image ne vient plus", () => {
    // Le gel de Sonic, 21 novembre 2026: plus une image depuis 12 secondes.
    const gelee = vitals(snap({ sinceArrivalMs: 12_000 }), null, 10_000, undefined, true);
    expect(gelee.attente).toBe(12_000);
    expect(worthWriting(gelee)).toBe(true);
  });

  it("ne compte pas l'attente sans jeu: un onglet ouvert sur une salle au repos se tait", () => {
    const auRepos = vitals(snap({ sinceArrivalMs: 12_000 }), null, 10_000, undefined, false);
    expect(auRepos.attente).toBe(0);
    expect(worthWriting(auRepos)).toBe(false);
  });

  it("ne compte pas l'attente avant la première image", () => {
    const neuve = vitals(snap({ sinceArrivalMs: null }), null, 10_000, undefined, true);
    expect(neuve.attente).toBe(0);
    expect(worthWriting(neuve)).toBe(false);
  });

  it("n'écrit pas une attente plus courte qu'un gel", () => {
    const juste = vitals(snap({ sinceArrivalMs: 499 }), null, 10_000, undefined, true);
    expect(worthWriting(juste)).toBe(false);
  });
});

describe("la cadence de la source", () => {
  it("n'est pas dite avec moins de trente écarts", () => {
    // Elle se rabattait sur l'écran: 250 images par seconde pendant un gel.
    expect(sourceRate(29, 4)).toBe(0);
    expect(sourceRate(0, 0)).toBe(0);
  });

  it("se lit sur l'écart médian quand il y en a assez", () => {
    expect(sourceRate(30, 16)).toBe(62.5);
    expect(sourceRate(600, 20)).toBe(50);
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
  /** Une fenêtre de dix secondes, telle que la page l'envoie. */
  const over = (video: Partial<Snapshot["video"]>) =>
    vitals(snap({ shown: 600, painted: 600, ...video }), null, 10_000);
  /** Une fenêtre où l'image s'est arrêtée: 900 ms sans image reçue. */
  const freeze = over({ gapMs: { p50: 17, p95: 20, max: 900 } });
  /** Une fenêtre où il n'arrive que 45 images par seconde pour un jeu à 60. */
  const slow = over({ shown: 450 });
  /** Une page qui a passé son démarrage: les premières fenêtres ne comptent pas. */
  const settledIn = () => {
    const watching = new Struggling();
    for (let fenetre = 0; fenetre < GRACE_WINDOWS; fenetre++) watching.saw(over({}));
    return watching;
  };

  it("ne dit rien sur une fenêtre saine", () => {
    const watching = settledIn();
    expect(watching.saw(over({}))).toBe(false);
    expect(watching.saw(over({}))).toBe(false);
  });

  it("ne dit rien à Souhib, qui ne sentait rien le 25 septembre", () => {
    // Sa fenêtre réelle de 00:02:03: 12 images jetées, 6 files vides, un écart
    // de 133 ms au pire, 60 images par seconde. L'ancienne règle la trouvait
    // mauvaise, et lui a proposé le format réduit 37 fois dans la soirée.
    const watching = settledIn();
    const souhib = over({
      shown: 607,
      painted: 589,
      skipped: 12,
      starved: 6,
      gapMs: { p50: 15, p95: 35, max: 133 },
    });
    for (let fenetre = 0; fenetre < 10; fenetre++) expect(watching.saw(souhib)).toBe(false);
  });

  it("propose à Hyde quand son image s'arrête vraiment", () => {
    // Le 22 septembre à 23:25: 43,9 images par seconde, puis 8,9 s sans image.
    const watching = settledIn();
    expect(watching.saw(over({ shown: 439, gapMs: { p50: 17, p95: 34, max: 65 } }))).toBe(false);
    expect(watching.saw(over({ shown: 163, gapMs: { p50: 17, p95: 43, max: 8954 } }))).toBe(true);
  });

  it("attend deux fenêtres mauvaises d'affilée", () => {
    // Un gel isolé arrive à tout le monde: le 22 septembre, Souhib a eu 4,7 s
    // sans image à 22:04 et rien ensuite.
    const watching = settledIn();
    expect(watching.saw(freeze)).toBe(false);
    expect(watching.saw(freeze)).toBe(true);
  });

  it("repart de zéro quand une bonne fenêtre s'intercale", () => {
    const watching = settledIn();
    expect(watching.saw(freeze)).toBe(false);
    expect(watching.saw(over({}))).toBe(false);
    expect(watching.saw(slow)).toBe(false);
  });

  it("des images jetées ou des files vides seules ne disent rien de la liaison", () => {
    // Elles ne séparent personne: Souhib, qui ne sentait rien, en avait plus que
    // Hyde, qui gelait.
    const watching = settledIn();
    for (let fenetre = 0; fenetre < 5; fenetre++) {
      expect(watching.saw(over({ skipped: 200, starved: 40 }))).toBe(false);
    }
  });

  it("ne compte rien pendant qu'un jeu démarre, ni juste après", () => {
    // Le 25 septembre, presque toutes les mauvaises fenêtres des joueurs qui ne
    // sentaient rien suivaient un changement de jeu de moins d'une minute.
    const watching = settledIn();
    for (let fenetre = 0; fenetre < 4; fenetre++) {
      watching.hold();
      expect(watching.saw(freeze)).toBe(false);
    }
    for (let fenetre = 0; fenetre < GRACE_WINDOWS; fenetre++) {
      expect(watching.saw(freeze)).toBe(false);
    }
    // Le jumeau: passé le démarrage, un vrai gel compte de nouveau.
    expect(watching.saw(freeze)).toBe(false);
    expect(watching.saw(freeze)).toBe(true);
  });

  it("ne compte rien pendant les premières fenêtres de la page", () => {
    const watching = new Struggling();
    for (let fenetre = 0; fenetre < GRACE_WINDOWS; fenetre++) {
      expect(watching.saw(freeze)).toBe(false);
    }
    expect(watching.saw(freeze)).toBe(false);
    expect(watching.saw(freeze)).toBe(true);
  });

  it("ne prend pas un gel de la salle pour une liaison qui rame", () => {
    // Le 22 novembre 2026, l'audit des états a vu la proposition sortir douze
    // secondes après un gel de la salle (E4): la fenêtre n'avait reçu qu'une
    // image isolée, donc `rough` la trouvait mauvaise. Le format réduit ne
    // change rien à une capture arrêtée.
    const gel = vitals(
      snap({
        shown: 1,
        painted: 1,
        gapMs: { p50: 17, p95: 20, max: 35_000 },
        sinceArrivalMs: 9000,
      }),
      null,
      10_000,
      undefined,
      true,
    );
    expect(gel.attente).toBe(9000);
    expect(rough(gel)).toBe(false);
  });

  it("jumeau: une liaison qui rame, images qui arrivent, reste une mauvaise fenêtre", () => {
    const rame = vitals(
      snap({
        shown: 400,
        painted: 400,
        gapMs: { p50: 17, p95: 120, max: 900 },
        sinceArrivalMs: 16,
      }),
      null,
      10_000,
      undefined,
      true,
    );
    expect(rough(rame)).toBe(true);
  });

  it("ne propose rien à qui est déjà en format réduit", () => {
    const watching = settledIn();
    watching.saw(over({ half: true, gapMs: { p50: 17, p95: 20, max: 900 } }));
    expect(watching.saw(over({ half: true, gapMs: { p50: 17, p95: 20, max: 900 } }))).toBe(false);
  });

  it("une proposition restée sans réponse n'est pas répétée à chaque fenêtre", () => {
    // Le 25 septembre 2026, trois pages ont écrit « proposé » 53, 54 et 16 fois:
    // la bannière restait affichée, et chaque mauvaise fenêtre la redemandait.
    const watching = settledIn();
    watching.saw(freeze);
    expect(watching.saw(freeze)).toBe(true);
    for (let fenetre = 0; fenetre < QUIET_WINDOWS + 5; fenetre++) {
      expect(watching.saw(freeze)).toBe(false);
    }
  });

  it("n'en reparle plus une fois la question réglée", () => {
    const watching = settledIn();
    watching.saw(freeze);
    expect(watching.saw(freeze)).toBe(true);
    watching.settled();
    watching.saw(freeze);
    expect(watching.saw(freeze)).toBe(false);
  });

  it("revient à la charge quand la liaison s'effondre, longtemps après", () => {
    // Le 16 septembre 2026: un joueur prend le réduit, revient au plein, et sa
    // liaison s'écroule quinze minutes durant sans que la page ne dise plus rien.
    const watching = settledIn();
    watching.settled();
    let repropose = false;
    for (let fenetre = 0; fenetre < QUIET_WINDOWS + 2; fenetre++) {
      repropose ||= watching.saw(over({ gapMs: { p50: 17, p95: 40, max: COLLAPSE_MS } }));
    }

    expect(repropose).toBe(true);
  });

  it("ne revient pas avant cinq minutes de silence", () => {
    const watching = settledIn();
    watching.settled();
    let repropose = false;
    for (let fenetre = 0; fenetre < 4; fenetre++) {
      repropose ||= watching.saw(over({ gapMs: { p50: 17, p95: 40, max: COLLAPSE_MS } }));
    }

    expect(repropose).toBe(false);
  });

  it("ne revient pas pour un gel seulement ordinaire", () => {
    // Le jumeau du seuil: un gel de 900 ms est ce que la personne a accepté de
    // vivre en refusant; il faut bien pire pour revenir.
    const watching = settledIn();
    watching.settled();
    let repropose = false;
    for (let fenetre = 0; fenetre < QUIET_WINDOWS + 5; fenetre++) {
      repropose ||= watching.saw(freeze);
    }

    expect(repropose).toBe(false);
  });

  it("ne dit rien à qui est déjà en réduit, même effondré", () => {
    const watching = settledIn();
    watching.settled();
    let repropose = false;
    for (let fenetre = 0; fenetre < QUIET_WINDOWS + 5; fenetre++) {
      repropose ||= watching.saw(
        over({ half: true, gapMs: { p50: 17, p95: 40, max: COLLAPSE_MS * 2 } }),
      );
    }

    expect(repropose).toBe(false);
  });

  /* La relecture du 22 novembre 2026: chaque fenêtre qui avait vu un gel ou une
     coupure appelait `hold()`, qui remet le compte à zéro et aveugle la
     proposition quarante secondes. Une liaison qui cale toutes les seize
     secondes ne se voyait plus jamais rien proposer. */
  it("une fenêtre ignorée ne compte ni pour ni contre: deux mauvaises autour proposent", () => {
    const watching = settledIn();
    expect(watching.saw(freeze)).toBe(false);
    watching.ignore();
    expect(watching.saw(freeze)).toBe(true);
  });

  it("jumeau: tenir, lui, remet le compte à zéro et attend", () => {
    const watching = settledIn();
    expect(watching.saw(freeze)).toBe(false);
    watching.hold();
    expect(watching.saw(freeze)).toBe(false);
    expect(watching.saw(freeze)).toBe(false);
  });

  it("une fenêtre ignorée pendant le démarrage use quand même la grâce", () => {
    // Le temps passe: une page restée sur un onglet caché pendant ses trente
    // premières secondes n'a pas à attendre trente secondes de plus.
    const watching = new Struggling();
    for (let fenetre = 0; fenetre < GRACE_WINDOWS; fenetre++) watching.ignore();
    expect(watching.saw(freeze)).toBe(false);
    expect(watching.saw(freeze)).toBe(true);
  });
});
