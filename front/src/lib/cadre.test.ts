import { describe, expect, it } from "vitest";
import {
  BUREAU_DES,
  FEUILLE_MI_MIN,
  EN_PANNE,
  ETATS_DU_CADRE,
  MANETTES,
  PANNEAU,
  PANNEAU_RANGEE,
  SANS_IMAGE,
  SANS_ZONES,
  attributsDuCadre,
  baseDuPanneau,
  emplacementPastille,
  etatDuCadre,
  memePose,
  miseEnPage,
  modeDuCadre,
  lieuDesAvis,
  ouEstLaMascotte,
  panneauAuBureau,
  variablesDuCadre,
  type BaseDuPanneau,
  type DessinManette,
  type Entree,
  type EntreeDuCadre,
  type EtatDuCadre,
  type Rect,
  type ZonesSures,
  premiereImage,
  sansImage,
} from "./cadre";
import { DOLPHIN_FACE, FENTE, gapBetween, placePad, SWITCH_FACE, XBOX_FACE } from "./faces";
import { FITS, place, type Fit, type Size } from "./fit";

const SEIZE_NEUF: Size = { width: 1280, height: 720 };
const GAMECUBE: Size = { width: 1216, height: 896 };
const QUATRE_TIERS: Size = { width: 640, height: 480 };
const FORMATS = [SEIZE_NEUF, GAMECUBE, QUATRE_TIERS];
const AJUSTEMENTS: Fit[] = FITS.map((one) => one.id);

/** Une entrée du cadre. Sa base par défaut est l'image reçue et son
 * réglage, comme après un changement de mise en page (`baseDuPanneau`) ;
 * sans image, aucune. */
const entree = (plus: Partial<Entree>): Entree => {
  const image = plus.image ?? SEIZE_NEUF;
  const ajustement = plus.ajustement ?? "remplir";
  return {
    mode: "bureau",
    fenetre: { width: 1440, height: 900 },
    zonesSures: SANS_ZONES,
    image,
    ajustement,
    base: image.width > 0 && image.height > 0 ? { image, ajustement } : null,
    etat: "vit",
    role: "joueur",
    manette: null,
    largeurColonne: 304,
    largeurPanneau: null,
    agrandie: false,
    ...plus,
  };
};

const coupe = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5 ? w * h : 0;
};

describe("le mode de la fenêtre", () => {
  it("pose le bureau à 900 px au pointeur fin, et l'étroit en dessous", () => {
    const fin = { grossier: false, role: "joueur" as const, hauteur: 800 };
    expect(modeDuCadre({ ...fin, largeur: 900 })).toBe("bureau");
    expect(modeDuCadre({ ...fin, largeur: 1920 })).toBe("bureau");
    // Le jumeau : un pixel de moins, et la colonne passe sous l'image.
    expect(modeDuCadre({ ...fin, largeur: 899 })).toBe("etroit");
    // Le seuil mesuré le 22 novembre 2026 pour le tiroir d'alors.
    expect(BUREAU_DES).toBe(900);
  });

  it("pose le portrait ou le paysage au doigt, à toutes les largeurs", () => {
    const doigt = { grossier: true, role: "joueur" as const };
    expect(modeDuCadre({ ...doigt, largeur: 390, hauteur: 844 })).toBe("portrait");
    expect(modeDuCadre({ ...doigt, largeur: 844, hauteur: 390 })).toBe("paysage");
    // Une tablette tenue en travers, plus large que 900 px : toujours au doigt.
    expect(modeDuCadre({ ...doigt, largeur: 1366, hauteur: 1024 })).toBe("paysage");
    // Le jumeau : la même tablette à la souris est un bureau.
    expect(modeDuCadre({ largeur: 1366, hauteur: 1024, grossier: false, role: "joueur" })).toBe(
      "bureau",
    );
  });

  it("donne à une manette seule le mode tenu, même à la souris", () => {
    expect(modeDuCadre({ largeur: 1440, hauteur: 900, grossier: false, role: "seule" })).toBe(
      "paysage",
    );
    expect(modeDuCadre({ largeur: 390, hauteur: 844, grossier: false, role: "seule" })).toBe(
      "portrait",
    );
  });
});

describe("l'état du cadre", () => {
  const table: [Parameters<typeof etatDuCadre>[0], EtatDuCadre][] = [
    [{ liaison: "ok", chargement: false, jeu: true }, "vit"],
    [{ liaison: "cachee", chargement: false, jeu: true }, "vit"],
    [{ liaison: "irreguliere", chargement: false, jeu: true }, "vit"],
    [{ liaison: "figee", chargement: false, jeu: true }, "figee"],
    [{ liaison: "decodeur", chargement: false, jeu: true }, "figee"],
    [{ liaison: "coupee", chargement: false, jeu: true }, "coupee"],
    [{ liaison: "injoignable", chargement: false, jeu: true }, "injoignable"],
    [{ liaison: "redemarre", chargement: false, jeu: true }, "redemarre"],
    [{ liaison: "fermee", chargement: false, jeu: true }, "fermee"],
    [{ liaison: "demarrage", chargement: false, jeu: false }, "demarrage"],
    [{ liaison: "arrivee", chargement: false, jeu: true }, "connexion"],
    [{ liaison: "ok", chargement: false, jeu: false }, "repos"],
    [{ liaison: "ok", chargement: true, jeu: false }, "demarrage"],
  ];

  it.each(table)("%o rend %s", (donnee, attendu) => {
    expect(etatDuCadre(donnee)).toBe(attendu);
  });

  it("couvre les neuf états, chacun atteint par la table", () => {
    expect(new Set(table.map(([, etat]) => etat))).toEqual(new Set(ETATS_DU_CADRE));
  });

  it("fait passer une panne avant un chargement, et un chargement avant le repos", () => {
    expect(etatDuCadre({ liaison: "injoignable", chargement: true, jeu: false })).toBe(
      "injoignable",
    );
    expect(etatDuCadre({ liaison: "fermee", chargement: true, jeu: false })).toBe("fermee");
    // Le jumeau : sans panne, le chargement passe avant le repos (correction
    // du 12 septembre 2026 : la salle est encore vide pendant le lancement).
    expect(etatDuCadre({ liaison: "ok", chargement: true, jeu: false })).toBe("demarrage");
  });

  it("refuse à la compilation un état de liaison inconnu", () => {
    // @ts-expect-error « eteinte » n'est pas un état de media/liaison.
    expect(() => etatDuCadre({ liaison: "eteinte", chargement: false, jeu: true })).not.toThrow();
  });

  it("range les quatre états sans image et les cinq de panne sans recouvrement faux", () => {
    expect([...SANS_IMAGE].sort()).toEqual(["connexion", "demarrage", "fermee", "repos"]);
    expect(EN_PANNE).not.toContain("vit");
    expect(EN_PANNE).not.toContain("repos");
  });
});

describe("le panneau de commande au bureau", () => {
  const BUREAUX: Size[] = [
    { width: 1024, height: 640 },
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];

  it.each(SANS_IMAGE)(
    "se pose sous l'écran noir en « %s », à toutes les tailles de bureau",
    (etat) => {
      for (const fenetre of BUREAUX) {
        const geo = miseEnPage(entree({ etat, fenetre, image: { width: 0, height: 0 } }));
        expect(geo.panneau.forme).toBe("sous");
        const { ecran } = geo;
        const panneau = geo.panneau.rect;
        if (!ecran || !panneau) throw new Error("écran ou panneau absent");
        // Le bas de l'écran touche le haut du panneau, de même largeur.
        expect(ecran.y + ecran.h).toBe(panneau.y);
        expect(panneau.w).toBe(ecran.w);
        expect(panneau.y + panneau.h).toBe(fenetre.height);
        expect(geo.image).toBeNull();
      }
    },
  );

  it("pose une Switch 16:9 à 1440×900 sous l'écran, et l'image garde 1136×639", () => {
    const geo = miseEnPage(entree({}));
    expect(geo.panneau.forme).toBe("sous");
    expect(geo.pose).toMatchObject({ width: 1136, height: 639 });
    // La même que sans panneau.
    expect(place("remplir", SEIZE_NEUF, { width: 1136, height: 900 })).toMatchObject({
      width: 1136,
      height: 639,
    });
  });

  it("range une GameCube à 1280×720 au pied de la colonne, image inchangée", () => {
    const geo = miseEnPage(entree({ fenetre: { width: 1280, height: 720 }, image: GAMECUBE }));
    expect(geo.panneau.forme).toBe("colonne");
    expect(geo.panneau.rect).toBeNull();
    expect(geo.pose).toEqual(place("remplir", GAMECUBE, { width: 976, height: 720 }));
  });

  it("dit « colonne » à 63 px libres et « sous » à 64", () => {
    // 1136 px de large font une image 16:9 de 639 px de haut.
    const a = panneauAuBureau({
      ecran: { width: 1136, height: 639 + 63 },
      image: SEIZE_NEUF,
      ajustement: "remplir",
      sansImage: false,
    });
    expect(a.forme).toBe("colonne");
    const b = panneauAuBureau({
      ecran: { width: 1136, height: 639 + 64 },
      image: SEIZE_NEUF,
      ajustement: "remplir",
      sansImage: false,
    });
    expect(b).toEqual({ forme: "sous", hauteur: 64 });
  });

  it("ne prend jamais plus que la place libre : 88 px fixes feraient perdre un cran en « entier »", () => {
    // 640×480 en « entier » dans 1596×1030 : deux fois, 960 px, 70 libres.
    const ecran = { width: 1596, height: 1030 };
    const decision = panneauAuBureau({
      ecran,
      image: QUATRE_TIERS,
      ajustement: "entier",
      sansImage: false,
    });
    expect(decision).toEqual({ forme: "sous", hauteur: 70 });
    // Le piège : 88 px auraient ramené l'image à un agrandissement de un.
    expect(place("entier", QUATRE_TIERS, { width: 1596, height: 1030 - 88 }).width).toBe(640);
    expect(place("entier", QUATRE_TIERS, ecran).width).toBe(1280);
  });

  it("décide sur la vraie pose : la règle de la maquette se trompe en « entier »", () => {
    // 4:3 à 1440×900 : en « remplir », 48 px libres seulement, et la maquette
    // rangeait le panneau dans la colonne. En « entier », l'image fait
    // 640×480 et laisse 420 px : le panneau tient sous elle.
    const geo = miseEnPage(entree({ image: QUATRE_TIERS, ajustement: "entier" }));
    expect(geo.panneau.forme).toBe("sous");
    const remplie = place("remplir", QUATRE_TIERS, { width: 1136, height: 900 });
    const maquette = 900 - remplie.height >= PANNEAU.min;
    expect(maquette).toBe(false);
  });

  it("balaye 1024 à 1920 par 900 tailles, trois formats et quatre réglages sans faire perdre un pixel", () => {
    let sous = 0;
    let colonne = 0;
    for (let W = 1024; W <= 1920; W += 32) {
      for (let H = 640; H <= 1200; H += 16) {
        for (const image of FORMATS) {
          for (const ajustement of AJUSTEMENTS) {
            const geo = miseEnPage(entree({ fenetre: { width: W, height: H }, image, ajustement }));
            const largeur = W - Math.min(Math.floor(W / 2), 304);
            const sans = place(ajustement, image, { width: largeur, height: H });
            if (!geo.pose) throw new Error("pas de pose avec une image connue");
            if (geo.panneau.forme === "sous") {
              sous += 1;
              // Calcul indépendant : la pose sur toute la hauteur.
              expect(memePose(geo.pose, sans)).toBe(true);
              expect(geo.panneau.rect?.h).toBeGreaterThanOrEqual(PANNEAU.min);
              expect(geo.panneau.rect?.h).toBeLessThanOrEqual(PANNEAU.max);
            } else {
              colonne += 1;
              expect(geo.panneau.forme).toBe("colonne");
              const libre = H - sans.height;
              const avec = place(ajustement, image, {
                width: largeur,
                height: H - Math.min(PANNEAU.max, libre),
              });
              expect(libre < PANNEAU.min || !memePose(avec, sans)).toBe(true);
            }
          }
        }
      }
    }
    // Le balayage voit les deux issues : un balayage qui ne verrait que l'une
    // ne prouverait rien de la frontière.
    expect(sous).toBeGreaterThan(1000);
    expect(colonne).toBeGreaterThan(1000);
  });

  it("efface la colonne et le panneau quand l'image est agrandie", () => {
    const geo = miseEnPage(entree({ agrandie: true, fenetre: { width: 1920, height: 1080 } }));
    expect(geo.colonne).toBeNull();
    expect(geo.panneau.forme).toBe("absent");
    expect(geo.image).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("élargit la colonne pour un panneau qui la remplace, jamais au-delà de la moitié", () => {
    const geo = miseEnPage(entree({ largeurPanneau: 640 }));
    expect(geo.colonne?.w).toBe(640);
    const etroite = miseEnPage(
      entree({ largeurPanneau: 700, fenetre: { width: 1024, height: 768 } }),
    );
    expect(etroite.colonne?.w).toBe(512);
  });
});

describe("la base du panneau : la première image ne déplace rien", () => {
  const XBOX: Size = { width: 16, height: 9 };
  const CUBE: Size = { width: 4, height: 3 };
  const RIEN: Size = { width: 0, height: 0 };
  /** Ce que la salle donne à `useGeometrie`, avant l'image. */
  const arrivee = (plus: Partial<EntreeDuCadre> = {}): EntreeDuCadre => ({
    mode: "bureau",
    fenetre: { width: 1440, height: 900 },
    zonesSures: SANS_ZONES,
    image: RIEN,
    ajustement: "remplir",
    formatAttendu: XBOX,
    etat: "connexion",
    role: "joueur",
    manette: null,
    largeurColonne: 304,
    largeurPanneau: null,
    agrandie: false,
    ...plus,
  });
  /** Les calculs successifs, comme `useGeometrie` les enchaîne. */
  const suite = (entrees: EntreeDuCadre[]) => {
    let avant: { entree: EntreeDuCadre; base: BaseDuPanneau } | null = null;
    return entrees.map((e) => {
      const base = baseDuPanneau(avant, e);
      avant = { entree: e, base };
      return { base, geo: miseEnPage({ ...e, base }) };
    });
  };

  it("garde le panneau d'une Xbox 360 sous l'écran quand une image 4:3 arrive à 1440×900", () => {
    // Le défaut de colonne-stable : sur l'image reçue, la première image 4:3
    // rangeait le panneau dans la colonne (48 px libres sous elle).
    const [noir, image] = suite([arrivee(), arrivee({ image: QUATRE_TIERS, etat: "vit" })]);
    expect(noir.geo.panneau).toEqual({ forme: "sous", rect: { x: 0, y: 812, w: 1136, h: 88 } });
    expect(image.geo.panneau).toEqual(noir.geo.panneau);
    expect(image.geo.ecran).toEqual(noir.geo.ecran);
    expect(image.base).toEqual({ image: XBOX, ajustement: "remplir" });
    // L'image reçue est bien celle qui se pose, dans l'écran gardé.
    expect(image.geo.pose).toEqual(place("remplir", QUATRE_TIERS, { width: 1136, height: 812 }));
    // Le jumeau : décidé sur l'image reçue, le même calcul la range.
    expect(miseEnPage(entree({ image: QUATRE_TIERS })).panneau.forme).toBe("colonne");
  });

  it("range le panneau d'une GameCube dans la colonne dès l'écran noir, et l'y laisse", () => {
    const [noir, image] = suite([
      arrivee({ formatAttendu: CUBE }),
      arrivee({ formatAttendu: CUBE, image: GAMECUBE, etat: "vit" }),
    ]);
    expect(noir.geo.panneau).toEqual({ forme: "colonne", rect: null });
    expect(image.geo.panneau).toEqual(noir.geo.panneau);
    // Le jumeau : l'écran noir sans format attendu (aucun jeu) garde le
    // panneau sous lui, comme avant.
    const [repos] = suite([arrivee({ formatAttendu: null, etat: "repos" })]);
    expect(repos.geo.panneau.forme).toBe("sous");
  });

  it("ne change la base ni pour une taille d'image ni pour un état", () => {
    const [, , figee, autre] = suite([
      arrivee(),
      arrivee({ image: QUATRE_TIERS, etat: "vit" }),
      arrivee({ image: QUATRE_TIERS, etat: "figee" }),
      arrivee({ image: GAMECUBE, etat: "vit" }),
    ]);
    expect(figee.base).toEqual({ image: XBOX, ajustement: "remplir" });
    expect(autre.base).toEqual({ image: XBOX, ajustement: "remplir" });
    expect(autre.geo.panneau.forme).toBe("sous");
  });

  it("prend la vraie image au premier changement naturel qui la trouve", () => {
    const image = arrivee({ image: QUATRE_TIERS, etat: "vit" });
    const changes: [string, Partial<EntreeDuCadre>][] = [
      ["un redimensionnement", { fenetre: { width: 1440, height: 899 } }],
      ["un panneau qui se ferme", { largeurPanneau: null }],
      ["la colonne élargie", { largeurColonne: 320 }],
      ["un autre réglage de la pose", { ajustement: "remplir-net" }],
      ["l'image agrandie", { agrandie: true }],
    ];
    for (const [quoi, change] of changes) {
      const depart = quoi === "un panneau qui se ferme" ? { largeurPanneau: 560 } : {};
      const [, , apres] = suite([
        arrivee(depart),
        { ...image, ...depart },
        { ...image, ...change },
      ]);
      expect(apres.base, quoi).toEqual({
        image: QUATRE_TIERS,
        ajustement: change.ajustement ?? "remplir",
      });
    }
    // Revenue à la même taille, la fenêtre garde la base de l'image : la
    // place ne revient pas au format attendu d'avant.
    const [, , , retour] = suite([
      arrivee(),
      image,
      { ...image, fenetre: { width: 1440, height: 899 } },
      image,
    ]);
    expect(retour.geo.panneau.forme).toBe("colonne");
    // Le jumeau : un changement naturel sans image (encore l'écran noir)
    // garde le format attendu.
    const [, encoreNoir] = suite([arrivee(), arrivee({ fenetre: { width: 1400, height: 900 } })]);
    expect(encoreNoir.base).toEqual({ image: XBOX, ajustement: "remplir" });
  });

  it("repart du format attendu quand le jeu change de console", () => {
    const [, , , cube] = suite([
      arrivee(),
      arrivee({ image: QUATRE_TIERS, etat: "vit" }),
      arrivee({ image: QUATRE_TIERS, etat: "vit", fenetre: { width: 1440, height: 899 } }),
      arrivee({ formatAttendu: CUBE, etat: "demarrage", fenetre: { width: 1440, height: 899 } }),
    ]);
    expect(cube.base).toEqual({ image: CUBE, ajustement: "remplir" });
    // Le jumeau : le même format attendu, écrit dans un nouvel objet, ne
    // compte pas pour un changement de console.
    const [, , memeFormat] = suite([
      arrivee(),
      arrivee({ image: QUATRE_TIERS, etat: "vit", fenetre: { width: 1440, height: 899 } }),
      arrivee({
        image: QUATRE_TIERS,
        etat: "vit",
        fenetre: { width: 1440, height: 899 },
        formatAttendu: { ...XBOX },
      }),
    ]);
    expect(memeFormat.base).toEqual({ image: QUATRE_TIERS, ajustement: "remplir" });
  });

  it("décide aussi la hauteur de l'écran étroit sur la base", () => {
    const etroit = { mode: "etroit" as const, fenetre: { width: 860, height: 900 } };
    const [noir, image] = suite([
      arrivee(etroit),
      arrivee({ ...etroit, image: QUATRE_TIERS, etat: "vit" }),
    ]);
    // 860 px de large en 16:9 : 484 px d'écran, et la colonne dessous.
    expect(noir.geo.colonne).toEqual({ x: 0, y: 484, w: 860, h: 416 });
    expect(image.geo.colonne).toEqual(noir.geo.colonne);
    // Le jumeau : sur l'image reçue, la colonne descendait à 645 px.
    expect(miseEnPage(entree({ ...etroit, image: QUATRE_TIERS })).colonne?.y).toBe(645);
  });
});

describe("le mode étroit", () => {
  it("pose l'image en haut sur toute la largeur et la colonne dessous", () => {
    const geo = miseEnPage(entree({ mode: "etroit", fenetre: { width: 800, height: 900 } }));
    expect(geo.ecran).toEqual({ x: 0, y: 0, w: 800, h: 450 });
    expect(geo.colonne).toEqual({ x: 0, y: 450, w: 800, h: 450 });
    expect(geo.panneau.forme).toBe("colonne");
  });

  it("laisse toujours 240 px à la colonne", () => {
    const geo = miseEnPage(
      entree({ mode: "etroit", fenetre: { width: 880, height: 700 }, image: GAMECUBE }),
    );
    expect(geo.colonne?.h).toBe(240);
    expect(geo.image && geo.image.h).toBeLessThanOrEqual(460);
  });
});

/** Les tailles des preuves au doigt, et le balayage du portrait. */
const pad = (nom: "dolphin" | "pro"): DessinManette => MANETTES[nom];

describe("le portrait", () => {
  it("garde l'image sur toute la largeur dès que l'image et la plus petite manette tiennent", () => {
    let vus = 0;
    for (let W = 320; W <= 430; W += 5) {
      for (let H = 540; H <= 932; H += 8) {
        for (const nom of ["dolphin", "pro"] as const) {
          for (const image of FORMATS) {
            const geo = miseEnPage(
              entree({
                mode: "portrait",
                fenetre: { width: W, height: H },
                image,
                manette: pad(nom),
              }),
            );
            const besoin = pad(nom).hauteur(W);
            if (besoin === null) throw new Error(`${nom} ne tient pas à ${W} px`);
            const ih = Math.round(W / (image.width / image.height));
            const tient = ih + besoin + 8 <= H;
            if (!geo.manette) throw new Error("la manette manque");
            // La manette reçoit toute la largeur et la hauteur que sa pose
            // demande : ses touches gardent 44 px (`encombrement`).
            expect(geo.manette.rect).toMatchObject({ w: W, h: besoin });
            if (tient) {
              vus += 1;
              expect(geo.ecran?.w).toBe(W);
            }
            // Rien ne touche l'image.
            const img = geo.image;
            if (!img) throw new Error("pas d'image");
            for (const autre of [geo.manette.rect, geo.panneau.rect, geo.bande, geo.barre]) {
              if (autre) expect(coupe(img, autre)).toBe(0);
            }
          }
        }
      }
    }
    expect(vus).toBeGreaterThan(500);
  });

  it("descend jusqu'à 320 px de large, où les poses cassaient le 22 novembre 2026", () => {
    const geo = miseEnPage(
      entree({ mode: "portrait", fenetre: { width: 320, height: 568 }, manette: pad("pro") }),
    );
    expect(geo.ecran?.w).toBe(320);
    expect(geo.manette?.rect.x).toBeGreaterThanOrEqual(0);
    expect((geo.manette?.rect.x ?? 0) + (geo.manette?.rect.w ?? 0)).toBeLessThanOrEqual(320);
  });

  it("retire la barre avant de rétrécir l'image, à 375×548", () => {
    const geo = miseEnPage(
      entree({
        mode: "portrait",
        fenetre: { width: 375, height: 548 },
        image: GAMECUBE,
        manette: pad("dolphin"),
      }),
    );
    expect(geo.barre).toBeNull();
    expect(geo.ecran).toMatchObject({ w: 375, h: 276 });
    // « La salle » passe parmi les touches : la pose le place, et la hauteur
    // de la manette l'a compté (`encombrement`).
    expect(geo.salleDansLaManette).toBe(true);
    // La mascotte suit : la tête dans le bouton, toujours un seul endroit.
    expect(ouEstLaMascotte(geo)).toBe("barre");
    // Le jumeau : avec sa barre, « La salle » n'est pas dans la manette.
    const haut = miseEnPage(
      entree({
        mode: "portrait",
        fenetre: { width: 375, height: 812 },
        image: GAMECUBE,
        manette: pad("dolphin"),
      }),
    );
    expect(haut.barre).not.toBeNull();
    expect(haut.salleDansLaManette).toBe(false);
  });

  it("ne déplace pas la manette d'un pixel entre vit et figée, à toutes les tailles", () => {
    for (let W = 320; W <= 430; W += 10) {
      for (let H = 540; H <= 932; H += 12) {
        const vit = miseEnPage(
          entree({ mode: "portrait", fenetre: { width: W, height: H }, manette: pad("pro") }),
        );
        const figee = miseEnPage(
          entree({
            mode: "portrait",
            fenetre: { width: W, height: H },
            manette: pad("pro"),
            etat: "figee",
          }),
        );
        expect(figee.manette?.rect).toEqual(vit.manette?.rect);
      }
    }
  });

  it("cède le panneau à l'état quand la bande est trop petite pour le dire", () => {
    const base = {
      mode: "portrait" as const,
      fenetre: { width: 390, height: 664 },
      manette: pad("pro"),
    };
    const vit = miseEnPage(entree(base));
    const figee = miseEnPage(entree({ ...base, etat: "figee" }));
    expect(vit.cedeAuxEtats).toBe(false);
    expect(figee.cedeAuxEtats).toBe(true);
    expect(figee.panneau.forme).toBe("absent");
    expect(figee.bande?.h).toBeGreaterThanOrEqual(48);
    // Le jumeau : une image vivante garde son panneau.
    expect(vit.panneau.forme).not.toBe("absent");
  });

  it("colle ton étiquette dans la manette seulement quand le panneau manque", () => {
    const grand = miseEnPage(
      entree({ mode: "portrait", fenetre: { width: 390, height: 844 }, manette: pad("pro") }),
    );
    expect(grand.panneau.rect).not.toBeNull();
    expect(grand.etiquette).toBeNull();
    // Le jumeau : à 375×548, le panneau manque, et l'étiquette va dans la
    // fente que la manette trouve sur sa vraie pose.
    const petit = miseEnPage(
      entree({ mode: "portrait", fenetre: { width: 375, height: 548 }, manette: pad("pro") }),
    );
    expect(petit.panneau.rect).toBeNull();
    expect(petit.etiquette).toEqual({ lieu: "fente" });
  });

  it("monte la feuille à mi-hauteur sous le panneau, jamais à moins de 276 px", () => {
    const geo = miseEnPage(
      entree({ mode: "portrait", fenetre: { width: 390, height: 844 }, manette: pad("dolphin") }),
    );
    const panneau = geo.panneau.rect;
    if (!panneau || !geo.feuille) throw new Error("panneau ou feuille absents");
    expect(geo.feuille.mi.y).toBe(panneau.y + panneau.h);
    expect(geo.feuille.mi.h).toBeGreaterThanOrEqual(FEUILLE_MI_MIN);
    // À 375×548, il reste assez de place sous le panneau.
    const court = miseEnPage(
      entree({ mode: "portrait", fenetre: { width: 375, height: 548 }, manette: pad("dolphin") }),
    );
    expect(court.feuille?.mi.h).toBeGreaterThanOrEqual(FEUILLE_MI_MIN);
    // Plus court encore, la feuille garde sa hauteur la plus petite et monte
    // sur ce qui est au-dessus : un geste choisi, qui se referme.
    const tres = miseEnPage(
      entree({ mode: "portrait", fenetre: { width: 320, height: 420 }, manette: pad("dolphin") }),
    );
    expect(tres.feuille?.mi.h).toBe(FEUILLE_MI_MIN);
  });

  it("sans manette tactile, garde la barre, l'image, le panneau et la bande", () => {
    const geo = miseEnPage(entree({ mode: "portrait", fenetre: { width: 390, height: 844 } }));
    expect(geo.manette).toBeNull();
    expect(geo.barre?.h).toBe(52);
    expect(geo.ecran?.w).toBe(390);
    expect(geo.panneau.forme).toBe("sous");
    expect(geo.bande?.h).toBeGreaterThan(0);
  });
});

describe("le paysage", () => {
  const TAILLES: Size[] = [
    { width: 844, height: 390 },
    { width: 932, height: 430 },
    { width: 1133, height: 744 },
    { width: 1180, height: 820 },
    { width: 1366, height: 1024 },
  ];

  it("ne pose aucune touche sur l'image, pour chaque manette, format et taille", () => {
    for (const fenetre of TAILLES) {
      for (const nom of ["dolphin", "pro"] as const) {
        for (const image of FORMATS) {
          const geo = miseEnPage(entree({ mode: "paysage", fenetre, image, manette: pad(nom) }));
          const img = geo.image;
          if (!img || !geo.manette) throw new Error("image ou manette absente");
          const pieces = geo.manette.grappes
            ? [geo.manette.grappes.g, geo.manette.grappes.d]
            : [geo.manette.rect];
          for (const piece of pieces) expect(coupe(img, piece)).toBe(0);
          for (const autre of [
            geo.boutonSalle,
            geo.etiquette?.lieu === "cote" ? geo.etiquette.rect : null,
            geo.panneau.rect,
            geo.bande,
          ]) {
            if (autre) expect(coupe(img, autre)).toBe(0);
          }
        }
      }
    }
  });

  it("pose la manette du portrait sous une image 16:9 d'une tablette à 1366×1024", () => {
    const geo = miseEnPage(
      entree({ mode: "paysage", fenetre: { width: 1366, height: 1024 }, manette: pad("pro") }),
    );
    expect(geo.manette?.grappes).toBeNull();
    const img = geo.image;
    if (!img || !geo.manette) throw new Error("image ou manette absente");
    expect(geo.manette.rect.y).toBeGreaterThanOrEqual(img.y + img.h);
  });

  it("donne à une GameCube 380 des 390 px d'un téléphone, sa vraie manette posée", () => {
    // La maquette promettait 529×390 avec des grappes de 128 px ; les quatre
    // boutons de la GameCube en demandent 156 (`encombrement`). 10 px de
    // hauteur perdus, mesurés le 23 novembre 2026.
    const geo = miseEnPage(
      entree({
        mode: "paysage",
        fenetre: { width: 844, height: 390 },
        image: GAMECUBE,
        manette: pad("dolphin"),
      }),
    );
    expect(geo.image?.h).toBe(380);
    expect(geo.manette?.grappes?.g.w).toBe(156);
  });

  it("pose le panneau debout dans la bande gauche d'un spectateur, places empilées", () => {
    const geo = miseEnPage(
      entree({
        mode: "paysage",
        fenetre: { width: 844, height: 390 },
        image: GAMECUBE,
        role: "regarde",
      }),
    );
    expect(geo.panneau.forme).toBe("debout");
    const r = geo.panneau.rect;
    if (!r) throw new Error("pas de panneau");
    // Quatre places l'une sous l'autre, 48×44 au moins chacune.
    expect(r.w).toBeGreaterThanOrEqual(48);
    expect(r.h / 4).toBeGreaterThanOrEqual(44);
  });

  it("garde tout dans la feuille quand la bande fait moins de 120 px (16:9)", () => {
    const geo = miseEnPage(
      entree({ mode: "paysage", fenetre: { width: 844, height: 390 }, role: "regarde" }),
    );
    expect(geo.panneau.forme).toBe("absent");
    expect(geo.bande).toBeNull();
  });

  it("ne prend à mi-hauteur que la bande gauche, au moins 132 px", () => {
    const geo = miseEnPage(
      entree({ mode: "paysage", fenetre: { width: 844, height: 390 }, manette: pad("dolphin") }),
    );
    if (!geo.feuille || !geo.image) throw new Error("feuille ou image absente");
    expect(geo.feuille.mi.w).toBeGreaterThanOrEqual(132);
    expect(geo.feuille.agrandie.w).toBe(380);
  });
});

describe("ta place se lit tenue en main (en-jeu-tactile.5)", () => {
  // Relecture du 24 novembre 2026 : en travers, la variante « tete » ne
  // posait pas d'étiquette, et un panneau trop étroit pour la rangée ne
  // montrait que ses lampes. Ni l'un ni l'autre ne disait quelle place on
  // tenait (740×360 et 932×430, 568×320 et 667×375 en GameCube).
  const TRAVERS: Size[] = [
    { width: 568, height: 320 },
    { width: 640, height: 360 },
    { width: 667, height: 375 },
    { width: 740, height: 360 },
    { width: 780, height: 360 },
    { width: 812, height: 375 },
    { width: 844, height: 390 },
    { width: 896, height: 414 },
    { width: 915, height: 412 },
    { width: 932, height: 430 },
    { width: 1024, height: 600 },
    { width: 1133, height: 744 },
    { width: 1180, height: 820 },
    { width: 1366, height: 1024 },
  ];
  const DROIT: Size[] = [
    { width: 320, height: 480 },
    { width: 360, height: 600 },
    { width: 375, height: 548 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
  ];
  /** Sans zones, et celles d'un iPhone tenu comme le mode le dit. */
  const ZONES = {
    paysage: [SANS_ZONES, { haut: 0, droite: 47, bas: 21, gauche: 47 }],
    portrait: [SANS_ZONES, { haut: 47, droite: 0, bas: 34, gauche: 0 }],
  } as const satisfies Record<string, ZonesSures[]>;
  const cas = function* (role: "joueur" | "regarde") {
    for (const [mode, tailles] of [
      ["paysage", TRAVERS],
      ["portrait", DROIT],
    ] as const) {
      for (const fenetre of tailles) {
        for (const zonesSures of ZONES[mode]) {
          for (const nom of ["dolphin", "pro"] as const) {
            for (const image of FORMATS) {
              const dit = `${mode} ${nom} ${fenetre.width}×${fenetre.height} ${image.width}×${image.height} zones ${zonesSures.gauche}/${zonesSures.haut}`;
              yield {
                dit,
                geo: miseEnPage(
                  entree({ mode, fenetre, zonesSures, image, role, manette: pad(nom) }),
                ),
              };
            }
          }
        }
      }
    }
  };
  /** La rangée des quatre START tient dans le panneau. */
  const rangee = (geo: ReturnType<typeof miseEnPage>) =>
    geo.panneau.rect !== null && geo.panneau.rect.w >= PANNEAU_RANGEE;

  it("un joueur la voit une fois : sur la rangée du panneau, sinon sur son étiquette", () => {
    const lieux = new Set<string>();
    let vus = 0;
    for (const { dit, geo } of cas("joueur")) {
      expect(geo.etiquette !== null, dit).toBe(!rangee(geo));
      if (geo.etiquette) lieux.add(geo.etiquette.lieu);
      vus += 1;
    }
    expect(vus).toBe((TRAVERS.length + DROIT.length) * 2 * 2 * FORMATS.length);
    // Chaque lieu est exercé : la fente tenue droite, sous « La salle » et
    // dans la bande en travers.
    expect([...lieux].sort()).toEqual(["bande", "cote", "fente"]);
  });

  it("le jumeau : sans place, ni étiquette, même sans panneau", () => {
    let sansPanneau = 0;
    for (const { dit, geo } of cas("regarde")) {
      expect(geo.etiquette, dit).toBeNull();
      if (!rangee(geo)) sansPanneau += 1;
    }
    // Le jumeau voit des cas où le joueur aurait son étiquette.
    expect(sansPanneau).toBeGreaterThan(0);
  });

  it("pose l'étiquette là où la relecture n'en voyait aucune", () => {
    const lieu = (fenetre: Size, nom: "dolphin" | "pro") =>
      miseEnPage(entree({ mode: "paysage", fenetre, image: QUATRE_TIERS, manette: pad(nom) }))
        .etiquette?.lieu;
    // Les lampes seules dans le panneau : l'étiquette en tête de la bande.
    expect(lieu({ width: 568, height: 320 }, "dolphin")).toBe("bande");
    expect(lieu({ width: 667, height: 375 }, "dolphin")).toBe("bande");
    // La variante « tete » : sous « La salle ».
    expect(lieu({ width: 740, height: 360 }, "dolphin")).toBe("cote");
    expect(lieu({ width: 932, height: 430 }, "pro")).toBe("cote");
    // Le jumeau : la rangée tient dans le panneau d'une Xbox 360 à 667×375.
    expect(lieu({ width: 667, height: 375 }, "pro")).toBeUndefined();
  });

  it("le reste sans étiquette : couché et bas, ni bande ni ligne sous la rangée", () => {
    // L'exception écrite dans le cadre, mesurée le 24 novembre 2026 : sous
    // 370 px de haut, une fenêtre large peut n'avoir que les lampes, sans
    // bande ni 28 px sous la rangée. Le cadre ne prend pas l'image pour y
    // loger l'étiquette. Si une place s'y trouve un jour, cet essai le dit.
    const geo = miseEnPage(
      entree({
        mode: "paysage",
        fenetre: { width: 640, height: 300 },
        image: QUATRE_TIERS,
        manette: pad("dolphin"),
      }),
    );
    const p = geo.panneau.rect;
    if (!p) throw new Error("pas de panneau");
    expect(rangee(geo)).toBe(false);
    expect(geo.bande).toBeNull();
    expect(300 - (p.y + p.h + 4)).toBeLessThan(FENTE.HAUT + 4);
    expect(geo.etiquette).toBeNull();
  });

  it("tire le seuil de la rangée de places.css et telephone.css", () => {
    // La rangée passe en lampes sous 200 px (`places.css`, chantier
    // personnes), et le panneau tenu en main garde 0,75 rem de chaque côté
    // (`telephone.css`) : le cadre doit le savoir pour poser l'étiquette.
    type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
    const lire = async (relatif: string) =>
      ((await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs).readFileSync(
        new URL(relatif, import.meta.url).pathname,
        "utf-8",
      );
    return Promise.all([
      lire("../components/places.css"),
      lire("../components/telephone.css"),
    ]).then(([places, telephone]) => {
      const lampes =
        /@container \(width < (\d+)px\)\s*\{\s*\.n3-places-rangee\s*\{\s*display: none;/.exec(
          places,
        );
      const bords = /\.n3-panneau-tenu > \.n3-panneau \{[^}]*padding: [\d.]+rem ([\d.]+)rem;/.exec(
        telephone,
      );
      if (!lampes || !bords)
        throw new Error("la règle des lampes ou les bords du panneau manquent");
      expect(Number(lampes[1]) + 2 * Number(bords[1]) * 16).toBe(PANNEAU_RANGEE);
    });
  });
});

describe("la vraie pose des touches dans la boîte du cadre", () => {
  const FACES_TENUES = [
    ["dolphin", DOLPHIN_FACE],
    ["pro", SWITCH_FACE],
    ["pro", XBOX_FACE],
  ] as const;
  const IPHONE_TRAVERS: ZonesSures = { haut: 0, droite: 47, bas: 21, gauche: 47 };
  const IPHONE_DROIT: ZonesSures = { haut: 47, droite: 0, bas: 34, gauche: 0 };
  /** Les pièces posées par `placePad` dans la boîte de la manette, en
   * coordonnées de la fenêtre, comme `Pave` les pose. */
  const pieces = (geo: ReturnType<typeof miseEnPage>, face: (typeof FACES_TENUES)[number][1]) => {
    const m = geo.manette;
    if (!m) throw new Error("pas de manette");
    const bandes = m.grappes
      ? { left: m.grappes.g.w, right: m.grappes.d.w }
      : { left: 0, right: 0 };
    const pose = placePad(
      face,
      { width: m.rect.w, height: m.rect.h },
      bandes,
      geo.salleDansLaManette ? ["feuille"] : [],
      m.grappes !== null,
    );
    return {
      degradee: pose.degraded,
      rects: pose.pieces.map((one) => ({
        ...one.rect,
        x: one.rect.x + m.rect.x,
        y: one.rect.y + m.rect.y,
      })),
    };
  };

  it("en travers, aucune pièce sur l'image ni hors de la zone sûre, quatre tailles, zones ou non", () => {
    let vus = 0;
    for (const fenetre of [
      { width: 844, height: 390 },
      { width: 932, height: 430 },
      { width: 667, height: 375 },
      { width: 1180, height: 820 },
    ]) {
      for (const zonesSures of [SANS_ZONES, IPHONE_TRAVERS]) {
        for (const [nom, face] of FACES_TENUES) {
          for (const image of FORMATS) {
            const geo = miseEnPage(
              entree({ mode: "paysage", fenetre, zonesSures, image, manette: pad(nom) }),
            );
            const img = geo.image;
            if (!img) throw new Error("pas d'image");
            const { degradee, rects } = pieces(geo, face);
            const dit = `${face.title} ${fenetre.width}×${fenetre.height} ${image.width}`;
            expect(degradee, dit).toBeNull();
            for (const r of rects) {
              expect(coupe(img, r), dit).toBe(0);
              expect(r.x, dit).toBeGreaterThanOrEqual(zonesSures.gauche);
              expect(r.x + r.w, dit).toBeLessThanOrEqual(fenetre.width - zonesSures.droite);
              expect(r.y + r.h, dit).toBeLessThanOrEqual(fenetre.height - zonesSures.bas);
              if (geo.boutonSalle) expect(coupe(geo.boutonSalle, r), dit).toBe(0);
            }
            vus += 1;
          }
        }
      }
    }
    expect(vus).toBe(4 * 2 * 3 * 3);
  });

  it("en travers, l'étiquette sous « La salle » garde 6 px de chaque touche et de lui, hors de l'image", () => {
    // La variante « tete » n'avait pas d'étiquette (relecture du 24 novembre
    // 2026) : elle se pose maintenant dans les 28 px entre « La salle » et la
    // grappe gauche, sur la vraie pose de `placePad`. Sous la rangée d'un
    // panneau à lampes sans bande, elle se pose sous « La salle » aussi.
    let vus = 0;
    const hauteurs = new Set<number>();
    const lieux = new Set<string>();
    for (let W = 560; W <= 1000; W += 20) {
      for (const H of [320, 344, 360, 375, 390, 414, 430]) {
        if (W <= H) continue;
        for (const zonesSures of [SANS_ZONES, IPHONE_TRAVERS]) {
          for (const [nom, face] of FACES_TENUES) {
            for (const image of FORMATS) {
              const geo = miseEnPage(
                entree({
                  mode: "paysage",
                  fenetre: { width: W, height: H },
                  zonesSures,
                  image,
                  manette: pad(nom),
                }),
              );
              if (geo.etiquette?.lieu !== "cote") continue;
              const e = geo.etiquette.rect;
              const dit = `${face.title} ${W}×${H} ${image.width} zones ${zonesSures.gauche}`;
              const { rects } = pieces(geo, face);
              for (const r of rects)
                expect(gapBetween(e, r), dit).toBeGreaterThanOrEqual(FENTE.ECART);
              if (!geo.boutonSalle) throw new Error(`pas de « La salle » : ${dit}`);
              expect(gapBetween(e, geo.boutonSalle), dit).toBeGreaterThanOrEqual(FENTE.ECART);
              if (geo.image) expect(coupe(geo.image, e), dit).toBe(0);
              expect(e.w, dit).toBeGreaterThanOrEqual(FENTE.MIN);
              expect(e.x, dit).toBeGreaterThanOrEqual(zonesSures.gauche);
              expect(e.y, dit).toBeGreaterThanOrEqual(zonesSures.haut);
              hauteurs.add(e.h);
              const grappe = geo.manette?.grappes?.g;
              if (!grappe) throw new Error(`pas de grappes : ${dit}`);
              lieux.add(e.y + e.h <= grappe.y ? "sur la grappe" : "sous la rangée");
              vus += 1;
            }
          }
        }
      }
    }
    // Les deux emplacements sont vus : 36 px quand la grappe a la place
    // (« tete-etiquette »), la hauteur de la fente sinon (« tete »).
    expect([...hauteurs].sort()).toEqual([FENTE.HAUT, 36]);
    expect([...lieux].sort()).toEqual(["sous la rangée", "sur la grappe"]);
    expect(vus).toBeGreaterThan(50);
  });

  it("tenu droit, aucune pièce sur l'image ni hors de la zone sûre, de 320 à 430 px", () => {
    let vus = 0;
    for (let W = 320; W <= 430; W += 10) {
      for (const H of [548, 568, 667, 740, 844, 932]) {
        for (const zonesSures of [SANS_ZONES, IPHONE_DROIT]) {
          for (const [nom, face] of FACES_TENUES) {
            const geo = miseEnPage(
              entree({
                mode: "portrait",
                fenetre: { width: W, height: H },
                zonesSures,
                image: GAMECUBE,
                manette: pad(nom),
              }),
            );
            const { degradee, rects } = pieces(geo, face);
            const dit = `${face.title} ${W}×${H}`;
            expect(degradee, dit).toBeNull();
            for (const r of rects) {
              if (geo.image) expect(coupe(geo.image, r), dit).toBe(0);
              expect(r.y, dit).toBeGreaterThanOrEqual(zonesSures.haut);
              expect(r.y + r.h, dit).toBeLessThanOrEqual(H - zonesSures.bas);
            }
            vus += 1;
          }
        }
      }
    }
    expect(vus).toBe(12 * 6 * 2 * 3);
  });

  it("à la souris, la manette « toujours » ne pose aucune pièce sur l'image, au bureau et en fenêtre étroite", () => {
    // Relecture du 23 novembre 2026 : réglée sur « toujours », elle se posait
    // par-dessus l'image vivante (onze pièces à 1280×720).
    let vus = 0;
    const tailles = [
      ["bureau", 1024, 640],
      ["bureau", 1280, 720],
      ["bureau", 1366, 768],
      ["bureau", 1440, 900],
      ["bureau", 1920, 1080],
      ["etroit", 820, 900],
      ["etroit", 700, 800],
      ["etroit", 600, 1000],
    ] as const;
    for (const [mode, width, height] of tailles) {
      for (const agrandie of [false, true]) {
        for (const [nom, face] of FACES_TENUES) {
          for (const image of FORMATS) {
            const geo = miseEnPage(
              entree({ mode, fenetre: { width, height }, image, manette: pad(nom), agrandie }),
            );
            const dit = `${face.title} ${mode} ${width}×${height} ${image.width} agrandie ${agrandie}`;
            const img = geo.image;
            if (!img || !geo.ecran) throw new Error(`pas d'image : ${dit}`);
            // « La salle » parmi les touches : il déplie la colonne repliée.
            expect(geo.salleDansLaManette, dit).toBe(true);
            const { degradee, rects } = pieces(geo, face);
            expect(degradee, dit).toBeNull();
            // La zone de <main> : à gauche de la colonne, au-dessus du panneau.
            const droite = geo.colonne && mode === "bureau" ? geo.colonne.x : width;
            const bas = geo.panneau.rect
              ? geo.panneau.rect.y
              : geo.colonne && mode === "etroit"
                ? geo.colonne.y
                : height;
            for (const r of rects) {
              expect(coupe(img, r), dit).toBe(0);
              expect(r.x, dit).toBeGreaterThanOrEqual(0);
              expect(r.x + r.w, dit).toBeLessThanOrEqual(droite);
              expect(r.y + r.h, dit).toBeLessThanOrEqual(bas);
            }
            // Les marges et l'écran remplissent la zone : la page pose l'écran
            // dans ses marges, et la manette dans la zone.
            const marges = geo.margesManette;
            if (!marges) throw new Error(`pas de marges : ${dit}`);
            expect(marges.gauche + geo.ecran.w + marges.droite, dit).toBe(droite);
            expect(geo.ecran.y + geo.ecran.h + marges.bas, dit).toBe(bas);
            vus += 1;
          }
        }
      }
    }
    expect(vus).toBe(8 * 2 * 3 * 3);
  });

  it("le jumeau : sans manette à la souris, l'écran garde toute la zone, sans marges", () => {
    for (const mode of ["bureau", "etroit"] as const) {
      const fenetre =
        mode === "bureau" ? { width: 1280, height: 720 } : { width: 820, height: 900 };
      const sans = miseEnPage(entree({ mode, fenetre, image: QUATRE_TIERS }));
      const avec = miseEnPage(
        entree({ mode, fenetre, image: QUATRE_TIERS, manette: pad("dolphin") }),
      );
      expect(sans.manette, mode).toBeNull();
      expect(sans.margesManette, mode).toBeNull();
      expect(sans.salleDansLaManette, mode).toBe(false);
      // L'image cède de la place à la manette : sans elle, elle était dessous.
      expect(avec.image!.w * avec.image!.h, mode).toBeLessThan(sans.image!.w * sans.image!.h);
    }
  });

  it("le jumeau : la boîte de la maquette (128 px) met des touches sur l'image", () => {
    // Les grappes de la maquette, rejouées : la pose les déborde. C'est la
    // faute que la sonde du 23 novembre 2026 a vue.
    const geo = miseEnPage(
      entree({
        mode: "paysage",
        fenetre: { width: 844, height: 390 },
        image: GAMECUBE,
        manette: { hauteur: () => 272, largeur: () => 128 },
      }),
    );
    const img = geo.image;
    if (!img) throw new Error("pas d'image");
    const m = geo.manette;
    if (!m?.grappes) throw new Error("pas de grappes");
    const pose = placePad(
      DOLPHIN_FACE,
      { width: m.rect.w, height: m.rect.h },
      { left: m.grappes.g.w, right: m.grappes.d.w },
      [],
    );
    const sur = pose.pieces.filter(
      (one) => coupe(img, { ...one.rect, x: one.rect.x + m.rect.x, y: one.rect.y + m.rect.y }) > 0,
    );
    expect(sur.length).toBeGreaterThan(0);
  });
});

describe("les places sur le panneau", () => {
  it("donne au moins 48×44 px à chacune des quatre places, à 375 px de large", () => {
    for (const H of [548, 667, 812]) {
      const geo = miseEnPage(
        entree({ mode: "portrait", fenetre: { width: 375, height: H }, manette: null }),
      );
      const r = geo.panneau.rect;
      if (!r) throw new Error(`pas de panneau à 375×${H}`);
      expect(r.w / 4).toBeGreaterThanOrEqual(48);
      expect(r.h).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("les emplacements", () => {
  it("pose la pastille dans le fronton quand la bande du haut fait 40 px", () => {
    const geo = miseEnPage(entree({}));
    expect(geo.fronton?.h).toBeGreaterThanOrEqual(40);
    expect(emplacementPastille(geo)?.lieu).toBe("fronton");
  });

  it("pose la pastille dans la colonne d'une GameCube sans bande, à 1366×768", () => {
    const geo = miseEnPage(entree({ fenetre: { width: 1366, height: 768 }, image: GAMECUBE }));
    expect(geo.fronton).toBeNull();
    expect(emplacementPastille(geo)?.lieu).toBe("colonne");
  });

  it("pose la pastille d'une GameCube agrandie dans une bande latérale", () => {
    const geo = miseEnPage(entree({ agrandie: true, image: GAMECUBE }));
    expect(emplacementPastille(geo)?.lieu).toBe("bordure");
  });

  it("ne pose rien sur une image 16:9 agrandie à 1920×1080", () => {
    const geo = miseEnPage(entree({ agrandie: true, fenetre: { width: 1920, height: 1080 } }));
    expect(emplacementPastille(geo)).toBeNull();
  });

  it("pose la pastille en tête de la grappe droite en paysage (K12)", () => {
    const geo = miseEnPage(
      entree({
        mode: "paysage",
        fenetre: { width: 844, height: 390 },
        image: GAMECUBE,
        manette: pad("dolphin"),
      }),
    );
    const lieu = emplacementPastille(geo);
    expect(lieu?.lieu).toBe("grappe-droite");
    if (!lieu?.rect || !geo.image) throw new Error("emplacement ou image absents");
    expect(coupe(lieu.rect, geo.image)).toBe(0);
  });

  it("ne pose jamais la pastille sur l'image, partout où elle a un rectangle", () => {
    for (const mode of ["bureau", "portrait", "paysage"] as const) {
      for (const image of FORMATS) {
        for (const fenetre of [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
          { width: 844, height: 390 },
        ]) {
          const geo = miseEnPage(entree({ mode, image, fenetre, manette: pad("pro") }));
          const lieu = emplacementPastille(geo);
          if (lieu?.rect && geo.image) expect(coupe(lieu.rect, geo.image)).toBe(0);
        }
      }
    }
  });

  it("pose le décor de borne sur des bandes latérales de 72 px, sans manette", () => {
    const geo = miseEnPage(entree({ agrandie: true, image: GAMECUBE }));
    expect(geo.bordures).not.toBeNull();
    // Le jumeau : une image qui remplit la largeur n'a pas de bordure.
    expect(miseEnPage(entree({})).bordures).toBeNull();
  });
});

describe("où joue la mascotte", () => {
  it("joue sur le plateau sans image, au coin avec une image, au bord du panneau pour une arrivée", () => {
    const repos = miseEnPage(entree({ etat: "repos", image: { width: 0, height: 0 } }));
    expect(ouEstLaMascotte(repos)).toBe("plateau");
    const vit = miseEnPage(entree({}));
    expect(ouEstLaMascotte(vit)).toBe("coin");
    expect(vit.panneau.forme).toBe("sous");
    expect(ouEstLaMascotte(vit, "arrivee")).toBe("bord-panneau");
    // Le jumeau : panneau dans la colonne, l'arrivée reste au coin.
    const gc = miseEnPage(entree({ fenetre: { width: 1280, height: 720 }, image: GAMECUBE }));
    expect(ouEstLaMascotte(gc, "arrivee")).toBe("coin");
  });

  it("joue dans la barre au téléphone, et nulle part sur une image agrandie", () => {
    const tel = miseEnPage(
      entree({ mode: "portrait", fenetre: { width: 390, height: 844 }, manette: pad("pro") }),
    );
    expect(ouEstLaMascotte(tel)).toBe("barre");
    expect(ouEstLaMascotte(miseEnPage(entree({ agrandie: true })))).toBeNull();
  });

  it("garde la tête dans la barre d'une manette seule, jamais sur un plateau", () => {
    const seule = miseEnPage(
      entree({
        mode: "portrait",
        role: "seule",
        etat: "repos",
        fenetre: { width: 390, height: 844 },
        manette: pad("pro"),
      }),
    );
    expect(seule.ecran).toBeNull();
    expect(ouEstLaMascotte(seule)).toBe("barre");
  });
});

describe("ce que la racine reçoit", () => {
  it("écrit quatre variables par rectangle, à 0 px quand il manque", () => {
    const geo = miseEnPage(entree({ fenetre: { width: 1280, height: 720 }, image: GAMECUBE }));
    const vars = variablesDuCadre(geo);
    expect(Object.keys(vars)).toHaveLength(7 * 4);
    expect(vars["--cadre-panneau-hauteur"]).toBe("0px");
    expect(vars["--cadre-colonne-largeur"]).toBe("304px");
    for (const valeur of Object.values(vars)) expect(valeur).toMatch(/^-?\d+px$/);
  });

  it("dit le mode, l'état, le rôle et le panneau en attributs", () => {
    const geo = miseEnPage(entree({ etat: "repos", image: { width: 0, height: 0 } }));
    expect(attributsDuCadre(geo)).toEqual({
      "data-mode": "bureau",
      "data-etat": "repos",
      "data-role": "joueur",
      "data-panneau": "sous",
      "data-sans-image": "oui",
      "data-agrandie": "non",
    });
  });
});

describe("la pile des avis dans la page montée", () => {
  const zone = { width: 1136, height: 900 };
  const image = { x: 0, y: 130, w: 1136, h: 640 };

  it("va dans une bande noire d'abord, au pied de la colonne ensuite, jamais sur l'image", () => {
    expect(lieuDesAvis({ zone, image, colonneACote: true, hauteur: 80 }).lieu).toBe("fronton");
    const pleine = { x: 0, y: 10, w: 1136, h: 880 };
    expect(lieuDesAvis({ zone, image: pleine, colonneACote: true, hauteur: 80 }).lieu).toBe(
      "colonne",
    );
    // Le jumeau : sans colonne à côté, la même image fait entrer la pile dans le flux.
    expect(lieuDesAvis({ zone, image: pleine, colonneACote: false, hauteur: 80 }).lieu).toBe(
      "flux",
    );
  });

  it("va dans le fronton quand la pile y tient entière, sinon dans le bas", () => {
    expect(lieuDesAvis({ zone, image, colonneACote: false, hauteur: 80 }).lieu).toBe("fronton");
    const haute = lieuDesAvis({
      zone,
      image: { ...image, y: 60 },
      colonneACote: false,
      hauteur: 80,
    });
    expect(haute.lieu).toBe("pied");
    expect(haute.rect?.y).toBe(700);
  });

  it("entre dans le flux plutôt que de couvrir l'image, sans bande assez haute", () => {
    const pleine = { x: 0, y: 0, w: 1136, h: 900 };
    expect(lieuDesAvis({ zone, image: pleine, colonneACote: false, hauteur: 20 }).lieu).toBe(
      "flux",
    );
    // Le jumeau : 39 px de bande ne suffisent pas même à une pile vide.
    const etroite = { x: 0, y: 39, w: 1136, h: 822 };
    expect(lieuDesAvis({ zone, image: etroite, colonneACote: false, hauteur: 0 }).lieu).toBe(
      "flux",
    );
  });

  it("ne pose jamais la pile, à sa hauteur mesurée, sur l'image", () => {
    for (let y = 0; y <= 200; y += 7) {
      for (const hauteur of [0, 30, 60, 120]) {
        const img = { x: 0, y, w: 1136, h: 900 - 2 * y };
        const lieu = lieuDesAvis({ zone, image: img, colonneACote: false, hauteur });
        if (lieu.rect) {
          const pile = { ...lieu.rect, h: hauteur + 16 };
          const posee = lieu.lieu === "fronton" ? pile : { ...pile, y: lieu.rect.y };
          expect(coupe(posee, img)).toBe(0);
        }
      }
    }
  });
});

describe("K06 : la première image, un seul déclencheur", () => {
  it("joue au passage d'un état sans image à vit", () => {
    for (const avant of ["repos", "demarrage", "connexion", "coupee"] as const)
      expect(premiereImage(avant, "vit")).toBe(sansImage(avant));
    expect(premiereImage("demarrage", "vit")).toBe(true);
  });

  it("ne joue pas au retour d'une image figée, ni sans passer à vit", () => {
    expect(premiereImage("figee", "vit")).toBe(false);
    expect(sansImage("figee")).toBe(false);
    expect(premiereImage("vit", "vit")).toBe(false);
    expect(premiereImage("repos", "demarrage")).toBe(false);
  });
});
