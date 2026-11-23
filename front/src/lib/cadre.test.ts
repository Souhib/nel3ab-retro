import { describe, expect, it } from "vitest";
import {
  BUREAU_DES,
  FEUILLE_MI_MIN,
  EN_PANNE,
  ETATS_DU_CADRE,
  MANETTES,
  PANNEAU,
  SANS_IMAGE,
  SANS_ZONES,
  attributsDuCadre,
  emplacementPastille,
  etatDuCadre,
  memePose,
  miseEnPage,
  modeDuCadre,
  lieuDesAvis,
  ouEstLaMascotte,
  panneauAuBureau,
  variablesDuCadre,
  type DessinManette,
  type Entree,
  type EtatDuCadre,
  type Rect,
  type ZonesSures,
  premiereImage,
  sansImage,
} from "./cadre";
import { DOLPHIN_FACE, placePad, SWITCH_FACE, XBOX_FACE } from "./faces";
import { FITS, place, type Fit, type Size } from "./fit";

const SEIZE_NEUF: Size = { width: 1280, height: 720 };
const GAMECUBE: Size = { width: 1216, height: 896 };
const QUATRE_TIERS: Size = { width: 640, height: 480 };
const FORMATS = [SEIZE_NEUF, GAMECUBE, QUATRE_TIERS];
const AJUSTEMENTS: Fit[] = FITS.map((one) => one.id);

const entree = (plus: Partial<Entree>): Entree => ({
  mode: "bureau",
  fenetre: { width: 1440, height: 900 },
  zonesSures: SANS_ZONES,
  image: SEIZE_NEUF,
  ajustement: "remplir",
  etat: "vit",
  role: "joueur",
  manette: null,
  largeurColonne: 304,
  largeurPanneau: null,
  agrandie: false,
  ...plus,
});

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
    expect(grand.etiquetteManette).toBeNull();
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
            geo.etiquetteManette,
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
